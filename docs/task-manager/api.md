# 任务管理 API

> 返回 [任务管理总览](../task-manager.md)

本文件列出任务管理相关的全部 HTTP 接口（以服务端实际注册的路由为准），以及前端 `frontend/src/api/` 的调用封装。数据模型见 [data-model.md](./data-model.md)，日志语义、保留期与清理规则见 [log.md](./log.md)，界面如何消费这些接口见 [ui.md](./ui.md)。

所有路由都挂在 `/api` 前缀下（`server/src/index.ts` 中逐个子路由 `app.use('/api', xxxRouter)`）；前端开发服务器把 `/api` 代理到 `localhost:3001`。

| 源码文件 | 覆盖面 |
|----------|--------|
| `server/src/tasks/routes.ts` | 统一任务注册表（工作流 / ffmpeg / LLM 三类）的活跃列表与**统一中断** |
| `server/src/routes/workflow.ts` | 工作流任务提交、批量提交、列表查询、单任务、日志、中断、重试、工作流类型 |
| `server/src/routes/canvas.ts` | 画布本地 ffmpeg 操作的**异步**接口、产物信息查询 |
| `server/src/routes/system.ts` | 系统设置、任务日志统计与清理、回收站（对照） |

## 一、统一任务接口（`server/src/tasks/routes.ts`）

面向**内存注册表** `taskRegistry`：这是「现在在跑什么」的 HTTP 视角。任务管理器主通道是 WS 广播（`/llm-ws`），本接口是 WS 不可用时的降级与调试路径；`ffmpeg` / `llm` 任务不落 SQLite，只有这里能看到它们。

| 方法 | 路径 | 说明 | 关键参数 | 响应要点 |
|------|------|------|----------|----------|
| GET | `/api/tasks` | 当前活跃任务列表（仅 `pending` / `running`） | query `project`（可选，精确匹配任务的项目名；空串视为不过滤） | `{ tasks: TaskInfo[] }` |
| POST | `/api/tasks/:taskId/cancel` | **统一中断入口**，按 taskId 路由到注册表中该任务的中断句柄（ffmpeg kill 子进程 / LLM abort 上游 / 工作流 Bridge 取消） | path `taskId` | 受理：`{ success: true, taskId }`，同时向订阅者广播 `cancelling` 事件；不可中断：**404** `{ error: <原因>, code: 'NOT_CANCELABLE' }`；taskId 为空：400 `{ error: 'taskId 必填', code: 'INVALID' }` |

`TaskInfo`（WS 与 REST 共用，`toTaskInfo()` 生成）字段：

| 字段 | 含义 |
|------|------|
| `id` / `type` / `label` / `status` | 任务 id；类型 `workflow` \| `llm` \| `ffmpeg`；展示名；状态 `pending` \| `running` \| `completed` \| `failed` \| `cancelled` |
| `progress?` | 百分比 0~100（仅 ffmpeg 有真实进度；缺省表示不确定进度） |
| `startedAt` | 登记时间（毫秒时间戳） |
| `project?` / `nodeId?` / `canvas?` | 画布定位（`canvas` 为 `{kind:'scene',episode,shot}` 或 `{kind:'stage',stage,label}`） |
| `cancelable` / `cancelBlockReason?` | 是否可中断；不可中断原因（UI tooltip 文案） |
| `payload?` / `error?` | 类型自有字段；失败原因（仅 `failed`） |
| `phase?` / `modelName?` | LLM 任务补充：`thinking` \| `responding`；模型名 |

**404 的 `error` 文案**来自 `taskRegistry.cancel()`，可能取值：「任务不存在或已结束」「任务已结束」「该任务不支持中断」「该任务暂不支持中断」「中断请求失败」（最后一类为句柄调用失败）。

## 二、工作流任务接口（`server/src/routes/workflow.ts`）

| 方法 | 路径 | 说明 | 关键参数 | 响应要点 |
|------|------|------|----------|----------|
| POST | `/api/workflow/run` | 提交单个生成任务（入库 `tasks` 为 `pending`，由引擎领取） | body `project`、`workflowId`、`impl`、`params.outputPath`（三者必填）；`params` 另含 `vars`、`promptPaths`、`userParams`、`video`、`sizeConfig`、`nodeId`、`canvas` | 成功 `{ taskId, status: 'pending' }`；缺字段 400 `{ error: 'Missing required fields: project, workflowId, params.outputPath' }`；`impl` 缺失/不可用 400 `{ error: 'workflow_impl_required' \| 'workflow_impl_not_found', message }` |
| POST | `/api/workflow/batch-run` | 批量提交（按资产类型发现任务，按 `ASSET_PHASE` 分 0/1/2 阶段，同一 `batchId`） | body `project`、`assetTypes[]`（必填）；`concurrency`（服务端夹到 1~10，缺省 1）、`overwrite`、`implByAssetType`、`userParamsByAssetType`、`sizeConfigByAssetType` | 成功 `{ batchId, totalTasks, project }`；无符合条件资产 `{ batchId: null, totalTasks: 0, project }`（不建空批次）；任一任务实现非法 → 400 `{ error: 'workflow_impl_required', message: <汇总> }`（整体拒绝，不建半截批次）；异常 500 `{ error: 'Batch creation failed: ...' }` |
| GET | `/api/workflow/batch/:batchId` | 批次汇总（`db.getBatchSummary`） | path `batchId` | `{ batch_id, project, total, completed, failed, running, pending }`；不存在 **404** `{ error: 'Batch not found' }` |
| GET | `/api/workflow/tasks` | **任务列表（分页 + 过滤）**，任务管理器「历史」页签的数据源 | query 全部可选：`project`、`status`、`batchId`、`since`、`until`、`limit`、`offset` | `{ tasks: TaskResponse[], total, limit, offset }`；`tasks` 按 `created_at DESC`；`total` 为满足条件的总数（不受分页影响）；`limit` 未传时为 **`null`**，`offset` 未传时为 `0` |
| GET | `/api/workflow/tasks/:taskId` | 单任务详情（含 `params`，节点「任务详情」对话框摘要用） | path `taskId` | `TaskResponse`；不存在 404 `{ error: 'Task not found' }` |
| GET | `/api/workflow/tasks/:taskId/log` | 任务日志（正序返回） | query `limit`（见下方「向后兼容」） | `{ logs: LogEntry[], total, limit, truncated }` |
| POST | `/api/workflow/tasks/:taskId/cancel` | 中断工作流任务（本地排队直接失败 / 运行中调远端 cancel） | path `taskId` | `{ taskId, status }`：`status` 为 `'failed'`（立即收敛）或 `'cancelling'`（实现声明 `deferredCancel`，终态由引擎执行完成后收敛）；404 `{ error: 'Task not found' }`；400 `{ error: 'not_cancelable' \| 'invalid_status' \| 'no_remote_task', message }`；502 `{ error: 'cancel_failed', message }` |
| POST | `/api/workflow/retry/:taskId` | 重试失败任务（复制原 `params` 与原实现，创建**新** taskId） | path `taskId` | `{ taskId, status: 'pending' }`；404 `{ error: 'Task not found' }`；原实现已失效 400 `{ error: 'workflow_impl_not_found', message }` |
| GET | `/api/workflows` | 工作流类型及其**可执行**实现（未绑定服务商实例的候选不返回） | 无 | `{ workflows: WorkflowInfo[] }`：`{ type, implementations: [{ impl, name, description?, provider?, providerInstanceId?, providerName?, params?, capabilities? }] }` |
| GET | `/api/workflow-types` | 系统支持的**工作流类型键**列表（注册表真实键集合，`getAllWorkflowTypes()`） | 无 | `{ types: string[] }` |

`TaskResponse`（`toTaskResponse()`）：`taskId`、`workflowId`、`impl`、`status`、`result`（`{path}` 或 `null`）、`errorMsg`、`createdAt`、`updatedAt`、`params`（已解析的 JSON 对象，含 `nodeId` / `canvas`）。`LogEntry`：`{ id, level, message, metadata?, created_at }` —— `created_at` 为 SQLite UTC 串 `YYYY-MM-DD HH:MM:SS`。

**`/api/workflow/tasks` 查询参数语义**：

| 参数 | 语义 |
|------|------|
| `project` / `status` / `batchId` | 等值过滤（`status` 取值 `pending` / `running` / `completed` / `failed`） |
| `since` / `until` | 创建时间下界 / 上界（**含边界**）；ISO 串或 `YYYY-MM-DD`，服务端统一经 `datetime(?, 'utc')` 归一化后比较（`created_at` 是 UTC 无毫秒格式，直接字符串比较会出错） |
| `limit` / `offset` | 分页；`limit` 只有是**正整数**才生效（生效时才拼 `LIMIT ? OFFSET ?`），`offset` 仅在 `limit` 生效时参与 |

## 三、画布 ffmpeg 异步接口（`server/src/routes/canvas.ts`）

四个操作型接口**均为异步**：登记统一任务注册表的 ffmpeg 任务后立即返回，进度与终态经 WS（`/llm-ws`）推送；产物写入前会把旧产物归档到 history 目录。`videoPath` / `audioPath` / `outputPath` 等路径必须位于 `assert/` 前缀下，否则 **403**。

| 方法 | 路径 | 说明 | 关键参数 | 响应要点 |
|------|------|------|----------|----------|
| POST | `/api/canvas/concat-video` | 拼接视频 | `project`、`videoPaths[]`、`outputPath`（必填）；`mode` = `copy`（无损，各段编码/分辨率/帧率/音轨结构须一致，否则 400）\| `reencode`（逐段归一化后单次编码，缺省）；`sizeMode` = `custom` \| `max` \| `min`（仅 reencode 生效）；`width` / `height`（`sizeMode=custom` 时必填且为正数）；`transition`（布尔）、`crossfadeDuration`（0.1~5 秒，仅 `transition=true` 时生效，非法 400）；`nodeId?`、`canvas?` | `{ taskId, status: 'running' }` |
| POST | `/api/canvas/trim-video` | 裁剪视频（重编码输出，保证帧索引/小数秒切口准确） | `project`、`videoPath`、`outputPath`、`duration`（> 0 秒）；`startTime`（≥ 0 秒，小数）**或** `startFrame`（≥ 0 整数）必填其一；`nodeId?`、`canvas?` | `{ taskId, status: 'running' }` |
| POST | `/api/canvas/trim-audio` | 裁剪音频（重编码输出） | `project`、`audioPath`、`outputPath`、`startTime`（≥ 0 秒）、`duration`（> 0 秒）；`format?` = `'---'`（原格式）/ `wav` / `flac` / `mp3`；`mp3Bitrate?` = `128` / `192` / `320`；`nodeId?`、`canvas?`。`outputPath` 必须是画布节点固定产物 `output.{音频扩展名}`，否则 400 | `{ taskId, status: 'running' }` |
| POST | `/api/canvas/extract-frame` | 提取视频帧 | `project`、`videoPath`、`outputPath`；`time`（秒，≥ 0，提供时按时间点精确取帧）**或** `frameIndex`（整数：`0` 首帧、`1` 第二帧、`-1` 尾帧、`-2` 倒数第二帧，越界 400 `FRAME_INDEX_OUT_OF_RANGE`）；`nodeId?`、`canvas?` | `{ taskId, status: 'running' }` |
| GET | `/api/canvas/node-info` | 画布节点产物文件事实（存在性 / mtime / 大小） | query `project`、`path`（必填，`assert/` 下） | `{ success, exists, mtime, size }`；文件不存在时 `exists: false` 且仍是 200 |

补充（同文件内的**同步**查询接口，非任务接口）：`GET /api/canvas/video-info`（`{ success, duration, fps, width, height, codec, hasAudio }`）、`GET /api/canvas/audio-info`（`{ success, duration }`）。

**`nodeId` / `canvas` 的解析**统一走 `parseTaskTarget()`（`server/src/tasks/task-target.ts`）：结构不合法时**丢弃该字段而不报错**——定位信息只是辅助元数据，不值得为它拒绝一次真实生成请求。

**任务登记冲突**（`respondTaskError()`）：同节点已有活跃任务 → **409** `{ error, code: 'NODE_BUSY' }`；全局活跃任务达上限 → **429** `{ error, code: 'TASK_LIMIT' }`。

## 四、系统设置与任务日志接口（`server/src/routes/system.ts`）

| 方法 | 路径 | 说明 | 关键参数 | 响应要点 |
|------|------|------|----------|----------|
| GET | `/api/system/settings` | 读取系统设置（含回收站统计、任务日志统计与两组「下次执行时间」） | 无 | `{ settings, trashStats, nextRunAt, taskLogStats, taskLogNextRunAt }`（见下方示例） |
| PUT | `/api/system/settings` | 局部更新系统设置：`trash.autoClean` 与 `taskLog` 各自可只传部分字段（未传字段保持原值） | body `{ trash?: { autoClean?: { enabled?, intervalDays?, retentionDays? } }, taskLog?: { autoClean?: { enabled?, intervalHours?, retentionDays? }, heartbeatSeconds? } }` | 更新后的完整 settings payload（同 GET）；越界/非整数 → 400 `{ error: '<字段>必须是 min~max 之间的整数（单位）', code: 'INVALID' }` |
| GET | `/api/system/task-log/stats` | 任务日志占用统计 | 无 | `db.getLogStats(retentionDays)` + `retentionDays` / `heartbeatSeconds` / `lastRunAt` / `nextRunAt`（见下方示例） |
| POST | `/api/system/task-log/clean` | **立即清理超期日志**（手动触发，`force: true`，忽略「启用」开关，沿用配置的保留期并 `VACUUM` 回收） | 无 body | `{ ran, deleted, allocatedBytesBefore, allocatedBytesAfter, freelistAfter, remaining, retentionDays, cutoff }`（见下方示例） |
| POST | `/api/system/task-log/purge` | **清空全部已终态任务日志**（忽略保留期；`pending` / `running` 任务日志受保护） | 无 body | `{ deleted, fileBytesBefore, fileBytesAfter, allocatedBytesBefore, allocatedBytesAfter, freelistAfter, cutoff, protectedRows }`（见下方示例） |
| GET | `/api/system/trash` | 全局回收站内容（对照：子类 `trash` 的界面数据源） | 无 | `{ batches: [{ batchId, createdAt, items: [...], count, size }], count, totalSize, retentionDays }` |
| POST | `/api/system/trash/restore` | 恢复回收站条目到原项目位置 | body `items[]`（`{ batchId, project, relPath }`，不能为空数组） | `{ restored: [{ project, path }], skipped: [{ path, reason }] }` |
| POST | `/api/system/trash/purge` | 彻底删除回收站条目 | body `items?` / `batchId?` / `all?`（三者至少一个，优先级 `all` > `batchId` > `items`） | `{ deleted, freed }` |
| POST | `/api/system/trash/auto-clean` | 立即执行一次回收站自动清理（手动触发，忽略开关） | 无 body | `{ ran, deleted, freed, remaining, retentionDays }` |

**配置字段的合法范围**（服务端 `system/system-settings.ts` 与前端表单规则一致）：执行间隔 1~720 小时（`HOURS_MIN`~`HOURS_MAX`）、保留期 1~3650 天（`DAYS_MIN`~`DAYS_MAX`）、心跳间隔 0~3600 秒（`0` = 不写心跳）。默认值：`trash.autoClean = { enabled: true, intervalDays: 7, retentionDays: 7 }`、`taskLog.autoClean = { enabled: true, intervalHours: 24, retentionDays: 14 }`、`taskLog.heartbeatSeconds = 60`。配置落盘 `server/config/system.json`（临时文件 + rename 原子写）；`lastRunAt` 由服务端调度器维护，前端不可写。

### 响应示例

`GET /api/system/task-log/stats`（`oldestAt` 为 SQLite UTC 串；`tableBytes` / `indexBytes` 由 `dbstat` 实测，SQLite 未编译该模块时退化为 0 并打日志）：

```json
{
  "totalRows": 128430,
  "oldestAt": "2026-05-02 11:20:07",
  "tableBytes": 41943040,
  "indexBytes": 8388608,
  "fileBytes": 52428800,
  "allocatedBytes": 51380224,
  "freelistBytes": 1048576,
  "freelistCount": 16,
  "cleanableRows": 91300,
  "activeRows": 412,
  "retentionDays": 14,
  "heartbeatSeconds": 60,
  "lastRunAt": "2026-09-08T03:00:00.000Z",
  "nextRunAt": "2026-09-09T03:00:00.000Z"
}
```

`POST /api/system/task-log/clean`：

```json
{
  "ran": true,
  "deleted": 91300,
  "allocatedBytesBefore": 51380224,
  "allocatedBytesAfter": 12451840,
  "freelistAfter": 0,
  "remaining": 37130,
  "retentionDays": 14,
  "cutoff": "2026-08-25T03:00:00.000Z"
}
```

`POST /api/system/task-log/purge`（`protectedRows` = 运行中任务受保护的日志行数）：

```json
{
  "deleted": 36718,
  "fileBytesBefore": 13631488,
  "fileBytesAfter": 294912,
  "allocatedBytesBefore": 12451840,
  "allocatedBytesAfter": 262144,
  "freelistAfter": 0,
  "cutoff": "2026-09-08T03:05:11.482Z",
  "protectedRows": 412
}
```

`GET /api/system/settings`（`taskLogStats` 结构同 stats 端点，此处省略）：

```json
{
  "settings": {
    "trash": {
      "autoClean": { "enabled": true, "intervalDays": 7, "retentionDays": 7 },
      "lastRunAt": "2026-09-01T02:00:00.000Z"
    },
    "taskLog": {
      "autoClean": { "enabled": true, "intervalHours": 24, "retentionDays": 14 },
      "heartbeatSeconds": 60,
      "lastRunAt": "2026-09-08T03:00:00.000Z"
    }
  },
  "trashStats": { "count": 12, "totalSize": 348192000 },
  "nextRunAt": "2026-09-08T02:00:00.000Z",
  "taskLogStats": { "totalRows": 128430, "cleanableRows": 91300, "activeRows": 412, "retentionDays": 14 },
  "taskLogNextRunAt": "2026-09-09T03:00:00.000Z"
}
```

`GET /api/workflow/tasks?limit=2&offset=0&status=failed`：

```json
{
  "tasks": [
    {
      "taskId": "6f1c…",
      "workflowId": "scene-stage-image",
      "impl": "seedream",
      "status": "failed",
      "result": null,
      "errorMsg": "远端任务超时",
      "createdAt": "2026-09-08 03:01:22",
      "updatedAt": "2026-09-08 03:06:40",
      "params": { "vars": {}, "promptPaths": ["prompt/scene/1/3/stage.json"], "outputPath": "assert/scene/1/3/stage/0.jpg", "nodeId": "n_12", "canvas": { "kind": "scene", "episode": "1", "shot": "3" } }
    }
  ],
  "total": 7,
  "limit": 2,
  "offset": 0
}
```

`GET /api/workflow/tasks/<taskId>/log?limit=200`：

```json
{
  "logs": [
    { "id": 90124, "level": "info", "message": "Task created: scene-stage-image/seedream", "metadata": null, "created_at": "2026-09-08 03:01:22" },
    { "id": 90131, "level": "debug", "message": "poll: running 30%", "metadata": null, "created_at": "2026-09-08 03:02:22" }
  ],
  "total": 1432,
  "limit": 200,
  "truncated": true
}
```

## 五、前端调用封装

| 前端函数（文件） | 端点 | 返回（前端形态） |
|------------------|------|------------------|
| `listTasks(project?)`（`frontend/src/api/tasks.ts`） | `GET /api/tasks` | `TaskInfo[]`（剥掉外层 `{tasks}`） |
| `cancelTask(taskId)`（`frontend/src/api/tasks.ts`） | `POST /api/tasks/:taskId/cancel` | `void`（`taskId` 经 `encodeURIComponent`） |
| `runWorkflow(body)` / `runBatch(body)`（`frontend/src/api/workflow.ts`） | `POST /api/workflow/run` / `batch-run` | `{ taskId, status }` / `{ batchId, totalTasks, project }` |
| `getBatchStatus(batchId)` | `GET /api/workflow/batch/:batchId` | `BatchSummary` |
| `listTasks(options)`（`workflow.ts`，与 `tasks.ts` 同名不同文件） | `GET /api/workflow/tasks` | `{ tasks: TaskResponse[], total }`——**丢弃 `limit` / `offset` 回显**，`total` 缺失时回退 `tasks.length` |
| `getTaskStatus(taskId)` | `GET /api/workflow/tasks/:taskId` | `TaskResponse` |
| `getTaskLogs(taskId, { limit })` | `GET /api/workflow/tasks/:taskId/log` | `{ logs, total, limit, truncated }`——`total` / `limit` / `truncated` 缺失时分别回退 `logs.length` / `0` / `false`（兼容旧服务端） |
| `cancelWorkflow(taskId)` | `POST /api/workflow/tasks/:taskId/cancel` | `{ taskId, status }` |
| `retryTask(taskId)` | `POST /api/workflow/retry/:taskId` | `{ taskId, status }` |
| `getWorkflows()` | `GET /api/workflows` | `WorkflowInfo[]` |
| `getSystemSettings()` / `updateSystemSettings(patch)`（`frontend/src/api/system.ts`） | `GET` / `PUT /api/system/settings` | `SystemSettingsPayload`（`updateSystemSettings` 会把 `patch.trash` 包成 `{ trash: { autoClean: … } }`） |
| `getTaskLogStats()` / `cleanTaskLogs()` / `purgeTaskLogs()` | `POST/GET /api/system/task-log/*` | `TaskLogStats` / `TaskLogCleanResult` |
| `getTrash()` / `restoreTrash()` / `purgeTrash()` / `runTrashAutoClean()` | `/api/system/trash*` | 见 `frontend/src/api/system.ts` 类型定义 |

WS 侧：`frontend/src/canvas/taskSocket.ts` 的 `taskSocket.cancel(taskId)` 为**WS 优先 + HTTP 兜底**（`cancelTask`）——WS 可用时直接发消息，保证低延迟；失败或断线时回落到统一 HTTP 端点，保证可靠（端点幂等）。协议见 [events.md](./events.md)。

## 六、向后兼容（重要）

| 场景 | 行为 |
|------|------|
| `GET /api/workflow/tasks/:taskId/log` **不传 `limit`** | 返回**全量**日志（服务端把 `limit` 归为 `0`，`truncated` 恒为 `false`）。老调用方语义不变 |
| `?limit=0` | 同样表示**全量**（与不传等价） |
| `?limit=N`（正整数） | 只返回**最后 N 条**（内部 `ORDER BY id DESC LIMIT N` 后反转为正序）；`truncated = total > logs.length` |
| `?limit=` 非法值（非数字 / 负数 / 小数 / 空串） | 按「不传」处理 → **全量**。分页与限流参数容错优先，脏参数不会导致 500 |
| `GET /api/workflow/tasks` **不传任何新参数** | 与旧实现完全一致：只按 `project` / `status` / `batchId` 过滤，不拼 `LIMIT`，返回全部任务 |
| `GET /api/workflow/tasks` 新增的 `total` / `limit` / `offset` | 是**附加**字段；旧前端只读 `data.tasks`，不受影响 |
| `?limit=abc` / `?offset=-1` | `parsePositiveInt()` 返回 `undefined` → 视为未传（不分页 / offset 归 0） |
| 两个中断端点并存 | `/api/tasks/:taskId/cancel` 是**统一入口**（面向注册表，覆盖三类任务）；`/api/workflow/tasks/:taskId/cancel` 保留（面向 SQLite 任务记录，带 `canCancelTask` 的工作流能力判定与 `deferredCancel` 语义），新代码优先用统一入口 |

## 七、设计取舍与注意

- **为什么有两个中断端点**：统一入口按注册表句柄中断（ffmpeg / LLM / 工作流都能用），但工作流还需要基于数据库状态判断「pending 可直接本地取消 / running 需已提交远端」，以及 `deferredCancel`（远端不支持取消、等执行完自然收敛为 `cancelling`）。因此工作流专用端点保留，返回的 `status` 也就有了 `cancelling` 这个中间态。
- **分页放服务端而不是前端切片**：`listTasks` 在 SQL 层拼 `LIMIT/OFFSET`，并单独 `COUNT(*)` 得到 `total`——避免把整表任务搬到浏览器再切片；`offset` 只在 `limit` 生效时才有意义（无 `limit` 时忽略 `offset`），因此 `limit` 未传时回显 `null` 而不是 `0`，让调用方区分「不分页」和「第一页」。
- **日志默认按尾部取**：单任务日志可达上千行，轮询只需要最后一条（`limit=1`），查看器用尾部 200 条 + 按需「查看全部」（`limit=0`）。默认值仍保留「不传即全量」是为了不破坏既有调用方——**新代码必须显式带 `limit`**（见 [log.md](./log.md)）。
- **`since` / `until` 必须在 SQL 侧归一化**：`tasks.created_at` 由 SQLite `datetime('now')` 写入（UTC、无毫秒），直接与 ISO 串做字符串比较会得到错误结果，故统一走 `datetime(?, 'utc')`。
- **清理的安全边界由服务端保证**，不依赖前端：`clean` 与 `purge` 的删除子查询都限定 `task_id IN (SELECT id FROM tasks WHERE status IN ('completed','failed'))`；`purge` 额外回传 `protectedRows`（= `getLogStats().activeRows`）供界面提示「保留运行中 N 行」。
- **手动清理忽略「启用」开关**：两个 POST 端点内部都以 `force: true` 调用清理器，因此返回的 `ran` 恒为 `true`；开关只影响定时调度器。
- **`purge` 响应体与前端类型不完全一致**：服务端返回的是 `LogCleanupResult` + `protectedRows`（无 `ran` / `remaining` / `retentionDays`），而 `frontend/src/api/system.ts` 的 `TaskLogCleanResult` 把这三个字段声明为必填；界面实际只读 `deleted` 与 `protectedRows`，所以不受影响。新增消费方请以服务端字段为准。
- **取消/中断不需要二次确认**：中断不是删除，任务记录与产物都保留，且可 `retry`；而 `task-log/purge`、`trash/purge` 这类不可撤销操作在前端一律走 `confirm`（见 [ui.md](./ui.md)）。
- **`/api/system/trash*` 与任务日志无关**，列在此处只因它们与「日志」同属系统设置子类、共用 `GET/PUT /api/system/settings` 的 payload；回收站细节见 [../asset-layout.md](../asset-layout.md)。

相关文档：[data-model.md](./data-model.md)（表结构与字段来源）、[log.md](./log.md)（日志级别、保留期与清理实现）、[lifecycle.md](./lifecycle.md)（提交到终态的完整链路）、[ui.md](./ui.md)（界面消费方式）、[development.md](./development.md)（改动这类接口的验证方式）。
