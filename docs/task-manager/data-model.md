# 任务数据模型（data-model）

> 返回 [任务管理总览](../task-manager.md)

任务管理涉及的数据分散在**三份事实源**里：内存注册表（运行态）、SQLite（工作流任务的持久化权威）、画布定义文件（LLM 终态结果）。本文只描述**数据形状与存储位置**：每张表/每个结构的字段、谁写谁读、哪些字段不广播、时间格式的坑。行为链路（创建→领取→执行→中断→恢复）见 [lifecycle.md](./lifecycle.md)，执行细节见 [execution.md](./execution.md)，传输层见 [events.md](./events.md)。

| 事实源 | 位置 | 覆盖的字段 | 生命周期 |
|--------|------|-----------|----------|
| 统一任务注册表 | `server/src/tasks/registry.ts`（`Map`，**仅内存**） | 工作流 / ffmpeg / LLM 三类的**运行态** | 终态即移出活跃区；服务重启清空 |
| SQLite | `data/workflow.db` 的 `tasks` / `task_logs` 表 | **工作流任务**的参数、状态、日志 | 任务行永久保留；日志按保留期清理（见 [log.md](./log.md)） |
| LLM 会话 | `server/src/llm/session-manager.ts`（**仅内存**）+ 终态写画布定义文件 | LLM 会话的流式累计与终态结果 | 会话终态即移出；结果落 `canvas.json` |

> 命名坑：`server/src/db.ts` 与 `server/src/tasks/registry.ts` **各有一个 `TaskRecord`**，字段完全不同（前者是 SQLite 行，后者是内存任务）。读代码时先看 import 来源，别混用。

## 一、SQLite：`tasks` 表

建库路径 `state.dbPath`（默认 `data/workflow.db`，由 `server/src/db.ts` 相对 `server/src` 解析）；`openDatabase()` 幂等建表并启用 `journal_mode = WAL`。建表 DDL（`SCHEMA_SQL` 原文）：

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  project      TEXT NOT NULL,
  workflow_id  TEXT NOT NULL,
  impl         TEXT NOT NULL DEFAULT 'default',
  status       TEXT NOT NULL DEFAULT 'pending',
  params       TEXT NOT NULL,
  result       TEXT,
  error_msg    TEXT,
  retry_count  INTEGER DEFAULT 0,
  max_retries  INTEGER DEFAULT 3,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
```

| 列 | 类型 | 约束 / 默认 | 含义 |
|----|------|------------|------|
| `id` | TEXT | PRIMARY KEY | 任务 id（路由用 `uuidv4()` 生成；同时是注册表任务 id、LLM 会话 id 的取值来源） |
| `project` | TEXT | NOT NULL | 项目名（对应 `design/{project}/`） |
| `workflow_id` | TEXT | NOT NULL | 工作流类型 id（如 `image-edit`、`image-to-video`、`tts-voice-design`） |
| `impl` | TEXT | NOT NULL DEFAULT `'default'` | 工作流实现标识；创建时**必须显式指定**（`validateWorkflowImpl`，不兜底） |
| `status` | TEXT | NOT NULL DEFAULT `'pending'` | `pending` / `running` / `completed` / `failed`。**没有 `cancelled`**（见下方说明） |
| `params` | TEXT | NOT NULL | 任务参数 JSON 字符串，键见下表 |
| `result` | TEXT | 可空 | 成功结果 JSON（如 `{"path":"assert/scene/1/1/canvas/xxx/output.png"}`） |
| `error_msg` | TEXT | 可空 | 失败原因；用户中断写固定文案 `用户中断` |
| `retry_count` | INTEGER | DEFAULT 0 | 重试计数；`incrementRetry()` 目前**无生产调用方** |
| `max_retries` | INTEGER | DEFAULT 3 | 预留列；引擎失败即终态，不读取该列（无自动重试，理由见 [lifecycle.md](./lifecycle.md#五启动对账与手动重试)） |
| `created_at` | TEXT | NOT NULL DEFAULT `datetime('now')` | 创建时间（UTC `YYYY-MM-DD HH:MM:SS`） |
| `updated_at` | TEXT | NOT NULL DEFAULT `datetime('now')` | 最近更新时间（每次 `updateTaskStatus` / `updateTaskParams` / `incrementRetry` 刷新） |
| `completed_at` | TEXT | 可空 | 终态时间；`status` 为 `completed` / `failed` 时由 `updateTaskStatus` 写入 |
| `batch_id` | TEXT | 可空（**迁移列**） | 批次 id；`null` = 单任务 |
| `phase` | INTEGER | NOT NULL DEFAULT 0（**迁移列**） | 批次内执行阶段（0/1/2），引擎按它排序与放行 |

**`status` 不含 `cancelled`**：SQLite 侧用 `failed` + `error_msg = '用户中断'` 表达取消（`cancelWorkflowTask`），前端把 `failed` 且原因为中断的任务显示为错误/中断态。注册表（内存）与前端 `TaskStatus` 才有 `cancelled`。

### 1.1 `params` JSON 的键

| 键 | 写入方 | 含义 |
|----|--------|------|
| `vars` | `buildRunTaskParams` / 批量创建 | 工作流变量（`episode` / `shot` / `index` / `prompt` / `seed` …），用户参数已由 `normalizeUserParams` 合并进来 |
| `promptPaths` | 同上 | 提示词文件相对路径列表 |
| `outputPath` | 同上（必填） | 产物相对路径（`assert/` 下，固定文件名 `output.{ext}`） |
| `video` | 画布【生成视频】节点 | 视频自包含提交参数（wire 形态，引擎经 `resolveVideoSubmitData` 转 File） |
| `sizeConfig` | 路由 | 统一尺寸配置（比例/尺寸档 + 自定义宽高） |
| `comfyuiProviderId` | `extractComfyuiProviderId` | Easy Bridge 执行实例 id（仅 `comfyui-bridge` 实现；不混入 `vars`） |
| `nodeId` / `canvas` | 画布提交 | 画布定位，见本文第六节。**批量任务不写这两个键** |
| `remoteTaskId` | 引擎提交远端成功后 `updateTaskParams` | 远端任务 id（`/workflow/tasks/:id/cancel` 与注册表可中断性判定用） |
| `cancelRequested` | `markCancelRequested` | 延迟取消标记（仅 `deferredCancel` 工作流），见 [lifecycle.md](./lifecycle.md#四中断统一入口) |

### 1.2 索引与迁移

| 语句 | 说明 |
|------|------|
| `CREATE INDEX idx_tasks_project ON tasks(project)` | 项目过滤（任务历史页签） |
| `CREATE INDEX idx_tasks_status ON tasks(status)` | 状态过滤（画布恢复补查 `pending`/`running`） |
| `CREATE INDEX idx_task_logs_task ON task_logs(task_id)` | 按任务读日志 |
| `CREATE INDEX idx_tasks_batch ON tasks(batch_id)` | 批次汇总 / 分组 |

| 迁移 | 语句 | 写法 |
|------|------|------|
| 批次 id | `ALTER TABLE tasks ADD COLUMN batch_id TEXT;` | `try/catch` 吞掉「列已存在」错误（幂等重放） |
| 执行阶段 | `ALTER TABLE tasks ADD COLUMN phase INTEGER NOT NULL DEFAULT 0;` | 同上；历史库缺列时补齐，旧任务落到 `phase = 0` |

### 1.3 读写函数（`server/src/db.ts`）

| 函数 | 语义 |
|------|------|
| `createTask({id, project, workflow_id, impl, params, batch_id?, phase?})` | 插入任务行（`params` 序列化；`batch_id` 缺省 `null`、`phase` 缺省 `0`） |
| `getTask(id)` | 按主键取一行（`TaskRecord`） |
| `updateTaskStatus(id, status, extra?)` | 更新状态 + `updated_at`；`extra.result` / `extra.error_msg` 可选；终态时写 `completed_at` |
| `updateTaskParams(id, params)` | 覆盖 `params`（远端任务 id、取消标记写入用；调用方必须先 `getTask` 取最新再合并，避免覆盖并发写入的 `cancelRequested`） |
| `incrementRetry(id)` | `retry_count + 1`（当前无调用方） |
| `getPendingTasks()` | `status IN ('pending','running')` **按 `phase ASC, created_at ASC` 排序**（引擎每 2s 调用的唯一入口） |
| `listTasks(options)` | 过滤 + 分页查询，见下表 |
| `getBatchSummary(batchId)` | 批次汇总（`total/completed/failed/running/pending`），`GET /api/workflow/batch/:batchId` 用 |

**`ListTasksOptions`（全部可选）**

| 选项 | 类型 | 语义 |
|------|------|------|
| `project` | string | 项目过滤 |
| `status` | string | 状态过滤 |
| `batchId` | string | 批次过滤 |
| `since` | string | `created_at >= datetime(?, 'utc')`（ISO 串或 `YYYY-MM-DD`，含） |
| `until` | string | `created_at <= datetime(?, 'utc')`（含） |
| `limit` | number | 分页大小；缺省不分页（返回全部） |
| `offset` | number | 分页偏移；仅 `limit` 生效时有意义 |

**`ListTasksResult`**：`{ tasks: TaskRecord[], total: number }`（`total` 为满足条件的总数，不受 `limit`/`offset` 影响；`tasks` 按 `created_at DESC`）。路由层 `GET /api/workflow/tasks` 用 `parsePositiveInt` 过滤脏分页参数（非法值按「不传」处理），并把行转成 `toTaskResponse`（`taskId/workflowId/impl/status/result/errorMsg/createdAt/updatedAt/params`）。

## 二、SQLite：`task_logs` 表

```sql
CREATE TABLE IF NOT EXISTS task_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  level      TEXT NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL,
  metadata   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

| 列 | 类型 | 含义 |
|----|------|------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | 自增主键；前端列表稳定 key，也是「按 id 增量拉取」的游标 |
| `task_id` | TEXT | 所属任务 id（外键指向 `tasks.id`） |
| `level` | TEXT | `info` / `debug` / `warn` / `error`（分级语义见 [log.md](./log.md)） |
| `message` | TEXT | 日志正文（中英混排，如 `Starting workflow: ...`、`进度更新：status=... progress=...`） |
| `metadata` | TEXT | 可选结构化附加信息（JSON 字符串），当前写入点基本为 `null` |
| `created_at` | TEXT | 写入时间（UTC `YYYY-MM-DD HH:MM:SS`） |

**`LogEntry`（读取结果）**：`{ id, level, message, metadata?, created_at }`。

| 函数 | 语义 |
|------|------|
| `addLog(taskId, level, message, metadata?)` | 追加一条日志 |
| `getTaskLogs(taskId)` | 全量读取（`ORDER BY id` 正序） |
| `getRecentTaskLogs(taskId, limit)` | 最后 N 条（`ORDER BY id DESC LIMIT ?` 再 `reverse()`）；`limit <= 0` 或非整数退化为全量。画布轮询用 `limit = 1` 命中主键索引 |
| `getTaskLogCount(taskId)` | 行数（日志接口的 `total`/`truncated` 判定） |
| `countCleanableLogs(retentionDays, now)` | 可清理行数：`created_at < datetime(?, 'utc')` 且任务 `status IN ('completed','failed')` |
| `getLogStats(retentionDays, now)` | 采集 `LogStats`：`totalRows` / `oldestAt` / `tableBytes` / `indexBytes` / `fileBytes` / `allocatedBytes` / `freelistBytes` / `freelistCount` / `cleanableRows` / `activeRows`（表/索引占用走 `dbstat`，不可用时退化为 0 并打日志） |
| `cleanupTaskLogs({retentionDays, now?, vacuum?})` | 分批删除（`CLEANUP_BATCH_SIZE = 5000`）超期**终态任务**日志，然后 `wal_checkpoint(TRUNCATE)` + `VACUUM`，返回 `LogCleanupResult` |
| `purgeTaskLogs({vacuum?})` | 忽略保留期，一次清空终态任务日志（手动「清空历史日志」） |

**安全边界（与 [log.md](./log.md) 一致）**：只删 `completed`/`failed` 任务的日志，**`pending`/`running` 任务的日志永不删除**；`tasks` 行与产物文件一律保留。空间是否回收看 `freelist_count`，不要看文件大小。

## 三、内存注册表：`TaskRecord`（`server/src/tasks/registry.ts`）

```ts
type TaskType = 'workflow' | 'llm' | 'ffmpeg'
type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
```

| 字段 | 类型 | 可选 | 含义 |
|------|------|------|------|
| `id` | string | 否 | 任务 id（`randomUUID()`；`idOverride` 可指定——LLM 会话 id、工作流 SQLite 主键都走这条） |
| `type` | `TaskType` | 否 | 任务类型 |
| `status` | `TaskStatus` | 否 | 状态；终态即移出活跃区 |
| `label` | string | 否 | 展示名（`拼接视频` / `获取视频帧` / 工作流实现名 / `AI文本生成`） |
| `project` | string | 是 | 项目名（前端按项目过滤） |
| `nodeId` | string | 是 | 发起节点 id（画布恢复按节点定位） |
| `canvas` | `CanvasDefTarget` | 是 | 画布定位（前端按 scope 过滤恢复），见第六节 |
| `progress` | number | 是 | 0~100；缺省 = 不确定进度（工作流、LLM 均不写 → UI 走不确定动画） |
| `startedAt` | number | 否 | 登记时间（**毫秒时间戳**，列表倒序排序用） |
| `updatedAt` | number | 否 | 最近更新时间（毫秒时间戳） |
| `finishedAt` | number | 是 | 终态时间（毫秒时间戳，仅终态有值） |
| `error` | string | 是 | 错误信息（仅 failed） |
| `cancelable` | boolean | 否 | 是否可中断；`false` 时 UI 置灰并展示 `cancelBlockReason` |
| `cancelBlockReason` | string | 是 | 不可中断原因（注册表用空串表示「无原因」并删除该字段） |
| `payload` | `Record<string, unknown>` | 是 | 类型自有字段（见第五节） |
| `handle` | `TaskHandle` | 是 | 中断凭据，**仅内存持有，绝不广播** |
| `seq` | number | 是 | 登记序号（同毫秒排序用，**仅内部使用，不广播**） |

### 3.1 不变量（改动前必须知道）

| 不变量 | 说明 |
|--------|------|
| **仅内存** | 注册表是 `Map`，不落盘；`clear()` 仅测试用。服务重启后活跃区为空（工作流的持久化权威是 SQLite，LLM 终态已落盘，ffmpeg 产物已写文件系统） |
| **`handle` / `seq` 不广播** | `task-ws.ts` 的 `toTaskInfo()` 是白名单序列化：只输出 `id/type/label/status/progress/startedAt/project/nodeId/canvas/cancelable/cancelBlockReason/payload/error`（LLM 另补 `phase`/`modelName`）。新增字段若需前端可见，必须同时改 `toTaskInfo()` |
| **同 nodeId 单飞** | `register()` 遍历活跃区，命中同 `nodeId` 抛 `TaskError('NODE_BUSY')`；任务终态移出活跃区后即可再次登记 |
| **全局上限 32** | `MAX_ACTIVE_TASKS = 32`，超出抛 `TaskError('TASK_LIMIT')`。**上限检查在单飞检查之前**，错误信息直接返回给前端 |
| **终态即移出** | `finish()` 从活跃 `Map` 删除并存入 `finished` Map（保留终态快照） |
| **`finish` 幂等** | 重复 `finish` 返回 `finished` Map 中的同一对象，不会返回 `null`；任务从未存在才返回 `null` |
| **「取消优先」由执行器保证** | 注册表 `finish(id, outcome)` 只记录调用方给的终态；ffmpeg 看 `state.cancelRequested`、LLM 看 `s.cancelled` 才把成功改成 `cancelled` |
| **`update` 忽略终态** | 任务不存在或已终态时 `update` 直接返回（幂等）；`payload` 与既有值**浅合并**；`progress` 钳制到 0~100；`id`/`type`/`startedAt` 不可变 |
| **`cancel` 不阻塞** | `handle.cancel()` 返回 Promise 时不 await（中断结果由执行器经 `finish` 收敛）；不可中断返回 `{ok:false, reason}`，异常只打日志 |
| **监听器异常不影响任务** | `emit()` 内部逐个 `try/catch`，只打 `[task-registry]` 日志 |
| **列表稳定** | `listActive()` 按 `startedAt` 倒序，同毫秒用 `seq` 兜底 |

### 3.2 方法与错误码

| 方法 | 语义 |
|------|------|
| `register(input: TaskRegisterInput)` | 登记（校验上限与单飞，生成 `id`，`emit({type:'begin'})`） |
| `update(id, patch: TaskUpdatePatch)` | 合并更新（`emit({type:'update'})`） |
| `finish(id, outcome?)` | 终态收敛 + 移出活跃区（`emit({type:'finish'})`）；`progress` 未定义且 `completed` 时补 100 |
| `cancel(id)` | 委托 `handle.cancel()`，返回 `{ok:true}` 或 `{ok:false, reason}` |
| `listActive()` | 活跃任务数组（含 `handle`，调用方自行裁剪后广播） |
| `on(listener)` | 订阅 `begin`/`update`/`finish`，返回退订函数 |
| `get(id)` | 按 id 取活跃任务 |

| 错误 | 码 | 触发 |
|------|----|------|
| `TaskError` | `NODE_BUSY` | 同 `nodeId` 已有活跃任务 → 路由返回 **409** |
| `TaskError` | `TASK_LIMIT` | 活跃任务已达 32 → 路由返回 **429** （映射见 `routes/canvas.ts: respondTaskError`） |
| `LlmSessionError` | `NODE_BUSY` / `SESSION_LIMIT` | LLM 会话单飞 / 全局上限 8 → 409 / 429 |

## 四、执行器门面与类型自有字段

`server/src/tasks/executor.ts` 只放接口（避免 `registry.ts` 与具体执行器循环 import）：

| 结构 | 说明 |
|------|------|
| `TaskHandle` | `cancel(): Promise<void> \| void`——运行态中断凭据，注册表只调它 |
| `TaskMeta` | `Omit<TaskRegisterInput, 'type' \| 'handle'>` |
| `TaskExecutor<TParams>` | `type` / `create(meta, params)` / `run(taskId, params)` / `cancel(taskId)` / `onProgress?` |
| `createTaskHandle(cancel)` | 把取消实现包成 `TaskHandle` |
| `finishTask(taskId, outcome?)` | 安全收敛（转发 `taskRegistry.finish`） |

| 执行器 | 文件 | 登记入口 | payload 字段 | 中断实现 |
|--------|------|----------|--------------|----------|
| 工作流 | `tasks/workflow-executor.ts` | `workflowExecutor.create()`（引擎 `runTask` 开始时；已登记则复用） | `workflowId` / `impl` / `outputPath?` / `remoteTaskId?` | `cancelWorkflowTask()`（Bridge cancel / `deferredCancel` 标记 + provider cancel） |
| ffmpeg | `tasks/ffmpeg-executor.ts` | `ffmpegExecutor.create()`（经 `tasks/ffmpeg-task.ts: startFfmpegTask`） | `FfmpegCommandSpec.info`（模式/输出尺寸等）+ 附加 `payload` | `kill('SIGKILL')` + 删除半截产物 |
| LLM | `tasks/llm-executor.ts` | `llmExecutor.create()`（`routes/llm.ts` 会话创建后，`idOverride = 会话 id`） | `modelName?` / `phase?`（`thinking` \| `responding`） | `sessionManager.cancel()` → `abortController.abort()` |

**ffmpeg 执行参数**（`FfmpegTaskParams`，不广播）：`outputAbs`（产物绝对路径，中断清理用）、`build(cmd)`（命令构建器，由 `assets/*.ts` 的 `buildXxxCommand()` 提供）、`duration?`（秒；> 0 才计算百分比）、`removeOnCancel?`（缺省 true）。进度换算：`parseTimemarkSeconds(timemark)` → `computeProgressPercent(当前秒, duration)`（**钳制 0~99**，永不显示 100，100 由 `finish` 补齐）。

## 五、LLM 会话（`server/src/llm/session-manager.ts`）

```ts
type LlmSessionStatus = 'running' | 'completed' | 'failed' | 'cancelled'
type LlmSessionPhase = 'thinking' | 'responding'
```

| 字段 | 类型 | 含义 |
|------|------|------|
| `taskId` | string | 会话 id（`begin()` 时 `randomUUID()` 生成）。**会话 id 即任务 id**：`llmExecutor.create({idOverride: session.taskId})`，前端只需一个凭据即可订阅流式事件、订阅任务广播与中断 |
| `nodeId` | string | 发起节点 id（画布恢复过滤 + 终态落盘定位） |
| `providerInstanceId` / `modelId` | string | 服务商实例 id / 模型 id |
| `label` | string | 节点名（会话列表展示） |
| `project` | string | 项目名 |
| `canvas` | `CanvasDefTarget` | 画布定位（终态落盘时 `canvasDefRelPath(session.canvas)` 定位 `canvas.json`） |
| `inputSent` | string | 本次实际发送的用户侧文本（历史归档兜底） |
| `snapshot` | `LlmSessionSnapshot` | 归档快照：`modelName?` / `presetName?` / `mediaLabels?` / `userInput?` |
| `status` | `LlmSessionStatus` | 会话状态（活跃区只可能是 `running`） |
| `phase` | `LlmSessionPhase` | 阶段：`thinking` → 首个 `text` 增量到达时切 `responding` |
| `thinking` | string | 思考内容累计（**仅内部展示，绝不写入 `config.output`**） |
| `text` | string | 正文累计（终态写入 `config.output`） |
| `warnings` | string[] | 警告（媒体输入被忽略等） |
| `error?` | string | 错误信息（落盘失败时也会附加到这里） |
| `createdAt` / `startedAt` | number | 创建时间 / 实际启动时间（**毫秒时间戳**） |
| `completedAt?` | number | 终态时间（毫秒时间戳） |
| `cancelled` | boolean | 用户已请求取消（等待执行器收敛） |
| `persistRev?` / `persistPrevRev?` | number | 落盘后的新 `rev` / 落盘前的 `rev`（`finished` 广播携带，前端 `savedRev` 对齐） |
| `persistPatch?` | `{ output?, outputHistory? }` | 实际写入画布的 `config` 补丁 |
| `abortController` | `AbortController` | 上游中止控制器（`cancel` 即 `abort()`） |
| `lifecycle?` | `LlmSessionLifecycle` | 注册表同步回调（`onPhase` / `onFinish`），由 `routes/llm.ts` 注入 `llmExecutor.lifecycleOf(taskId)`，避免 `session-manager → llm-executor → session-manager` 模块环 |

**上限与错误**：`LLM_MAX_ACTIVE_SESSIONS = 8`；同 `nodeId` 单飞（活跃区只保留 `running` 会话，终态即 `delete`，故单飞检查等价于只对运行中会话生效）；`finish()` 幂等（已终态会话直接返回，不再落盘）。

**终态落盘产物**（`llm/result-persist.ts` → `assets/canvas-def.ts`）：写入画布定义文件 `canvas.json` 中该节点的 `config`：

| 落盘字段 | 规则 |
|----------|------|
| `config.output` | `completed`：会话正文；`cancelled`/`failed`：已累计正文（保留部分输出，无正文则不写） |
| `config.outputHistory` | 仅 `completed` 且正文非空时追加一条（`MAX_TEXT_HISTORY_VERSIONS = 50`，超出丢最旧） |

`LlmTextHistoryEntry`：`id`（`${毫秒36进制}-${随机6位}`）、`createdAt`（**ISO 字符串**）、`input`（优先 `snapshot.userInput`，回退 `inputSent`）、`output`、`modelName?`、`presetName?`、`mediaLabels?`。写入走 `saveCanvasDef` CAS + `withPathLock`，`VERSION_CONFLICT` 重读重试 ≤ 3 次。

## 六、画布定位字段：`nodeId` + `canvas`

```ts
/** 画布定位（server/src/assets/canvas-def.ts；前端 canvas/taskSocket.ts 的 LlmCanvasTarget 同构） */
interface CanvasDefTarget {
  kind: 'scene' | 'stage'
  episode?: string   // scene：集数
  shot?: string      // scene：分镜号
  stage?: string     // stage：场景名
  label?: string     // stage：子场景标签
}
```

| 任务类型 | 提交入口 | **存储位置** | 登记进注册表的来源 |
|----------|----------|--------------|--------------------|
| `workflow` | `POST /api/workflow/run` 的 `params.nodeId` / `params.canvas` | **SQLite `tasks.params`（持久化）** | 引擎 `runTask` 读 `paramsObj.nodeId` / `paramsObj.canvas` → `workflowExecutor.create()` |
| `ffmpeg` | 四个 `/api/canvas/*` 请求体的 `nodeId` / `canvas` | **仅注册表（内存）** | `parseTaskTarget(req.body)` → `startFfmpegTask()` |
| `llm` | `POST /api/llm/chat` 的 `body.nodeId` / `body.canvas` | **会话 + 注册表（内存）** | `sessionManager.begin()` / `llmExecutor.create()` |

批量任务（`POST /api/workflow/batch-run`）**不写** `nodeId` / `canvas`：它没有画布来源，不参与画布 Loading 恢复。

**用途**：

| 用途 | 说明 |
|------|------|
| 任务管理器展示 | 面板显示任务来自哪个项目 / 画布 / 节点 |
| 画布 Loading 恢复过滤 | `useCanvasGeneration.restore()` 按「项目一致 + 画布 scope 一致 + 节点仍在当前画布上」筛选（见 [lifecycle.md](./lifecycle.md#六刷新--重启后的前端恢复)） |
| LLM 终态落盘定位 | `canvasDefRelPath(session.canvas)`：`scene` → `prompt/scene/{episode}/{shot}/canvas.json`；`stage` → `prompt/stage/{stage}/canvas/{label}.json` |
| 产物路径推导 | `useCanvasGeneration.getScope()` 把 `canvas` 转成 `CanvasScope` 用于 `canvasNodeOutputPath()` |

**解析严格度不同，别记错**：

| 解析点 | 行为 |
|--------|------|
| `tasks/task-target.ts: parseTaskTarget()` | **宽松**：`kind` 未知或必填字段缺失/非字符串时**丢弃该字段**而不抛错（定位只是辅助元数据，不该因它拒绝一次真实生成请求） |
| `routes/llm.ts: normalizeCanvasTarget()` | **严格**：非法返回 `null` → 路由 400（LLM 终态必须知道写哪张画布） |
| 前端 `GenTarget` | 画布侧提交时构造，字段与 `CanvasDefTarget` 一致（`kind` 为 `CanvasKind`） |

## 七、前端模型

### 7.1 `GenerateStatus`（`frontend/src/canvas/useCanvasGeneration.ts`）

节点上挂的**纯展示态**（`statusByNode: Record<nodeId, GenerateStatus>`），不持久化、不跨页面存活：

```ts
interface GenerateStatus {
  status: 'running' | 'success' | 'error'
  progress?: number
  lastLog?: string
  errorMsg?: string
  taskId?: string
}
```

| 字段 | 写入方 | 说明 |
|------|--------|------|
| `status` | `poll()`（工作流）/ `onTaskUpdate`（ffmpeg）/ `beginClientRun`/`endClientRun`/`setLlmError`（LLM） | `running` → 节点渲染通用 loading 遮罩 |
| `progress` | `trackFfmpegTask()` 初始 0，随后由任务广播刷新 | 仅 ffmpeg 有真实百分比 |
| `lastLog` | 工作流取日志最后一条（`limit = 1`）；ffmpeg 用阶段文案；LLM 为 `Thinking…`/`正在响应…` | 遮罩文案 |
| `errorMsg` | 失败/中断/产物缺失 | 错误遮罩红字；「详情」按钮读完整日志 |
| `taskId` | 提交返回或 `restore()` | 中断凭据（`taskIdByNode` 与之配合） |

工作流轮询只更新展示：`poll()` 每 `POLL_INTERVAL_MS = 2000` 调 `GET /api/workflow/tasks/:id` + `GET /api/workflow/tasks/:id/log?limit=1`，终态时清定时器、删 `taskIdByNode[nodeId]`，`completed` 时回调 `onResult(nodeId, outputPath)` 刷新产物。

### 7.2 `TaskInfo` / `TaskType` / `TaskStatus`（`frontend/src/canvas/taskSocket.ts`）

与服务端 `tasks/task-ws.ts: TaskInfo` **字段同构**（WS `tasks` 全量 + `task-update` 增量都发这个形状）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 任务 id（LLM 会话 id 即任务 id） |
| `type` | `'workflow' \| 'llm' \| 'ffmpeg'` | 任务类型 |
| `label` | string | 展示名 |
| `status` | `'pending' \| 'running' \| 'completed' \| 'failed' \| 'cancelled'` | 状态（**比 SQLite 多 `cancelled`**） |
| `progress?` | number | 0~100；缺省 = 不确定进度 |
| `startedAt` | number | **毫秒时间戳**（耗时由客户端自行刷新） |
| `project?` / `nodeId?` / `canvas?` | — | 画布定位（`canvas` 为 `LlmCanvasTarget`） |
| `cancelable` / `cancelBlockReason?` | boolean / string | 中断能力与置灰原因（任务管理器 tooltip） |
| `payload?` | Record | 类型自有字段 |
| `error?` | string | 错误信息（仅 failed） |
| `phase?` / `modelName?` | — | 仅 `type = 'llm'` |

`taskSocket` 暴露的响应式状态：`tasks`（全部活跃任务）、`connected`、`snapshotReady`（本次连接的首个 `tasks` 全量是否已到达；断线重置为 `false`）、`sessions`（`computed`：按 `type === 'llm'` 过滤并补 `taskId`，兼容既有 LLM 视图）。另有 `LlmSnapshotInfo`（订阅即发的累计 `thinking`/`text`/`warnings`）与 `LlmFinishedInfo`（LLM 终态全局广播载荷：`taskId/nodeId/status/project/canvas/error?/output?/outputHistory?/rev?/prevRev?`）。HTTP 兜底形状见 `frontend/src/api/tasks.ts` 的 `TaskInfo`。

## 八、谁持久化 / 谁不持久化

| 维度 | 工作流任务（`workflow`） | ffmpeg 任务（`ffmpeg`） | LLM 会话（`llm`） |
|------|--------------------------|--------------------------|-------------------|
| 内存注册表 | ✅ 引擎开始执行时登记 | ✅ 路由登记后立即运行 | ✅ 会话 id 即任务 id |
| SQLite `tasks` / `task_logs` | ✅ **持久化权威**（参数、状态、日志） | ❌ 完全不落盘 | ❌ 完全不落盘（无 SQLite 行） |
| 会话对象 | ❌ | ❌ | ✅ `sessionManager` 活跃区（仅内存） |
| 结果落点 | `design/{project}/assert/...` 产物文件 | 固定产物文件（`output.{ext}`）；中断时删除半截文件 | 画布定义文件 `canvas.json` 的节点 `config.output` / `outputHistory` |
| 服务重启后 | 注册表为空；SQLite 中 `pending`/`running` 会被启动对账重置为 `pending` 后重跑；终态任务与日志仍在（历史页签可查） | 任务与进度**丢失**（无任何记录），已成为文件的产物保留 | 活跃会话**丢失**，未终态会话的累计输出丢失；已终态结果在 `canvas.json` 里 |
| 能查历史吗 | ✅ `GET /api/workflow/tasks*` | ❌ 只能看产物文件与任务管理器「进行中」 | ⚠️ 结果看画布节点 `output`/`outputHistory` |
| 日志 | ✅ `task_logs`（按保留期清理） | ❌ | ❌ |

> 因此：**画布 Loading 恢复必须同时读注册表与 SQLite**——注册表覆盖 ffmpeg 与已登记的工作流任务，SQLite 补齐「已入库但引擎还没领取 / 重启后尚未重跑」的工作流任务。

## 九、时间格式（真实的坑）

| 来源 | 格式 | 示例 | 涉及字段 |
|------|------|------|----------|
| SQLite `datetime('now')` | UTC、**无毫秒、无时区后缀**、空格分隔 | `2026-09-11 04:30:15` | `tasks.created_at` / `updated_at` / `completed_at`、`task_logs.created_at` |
| 服务端 `new Date().toISOString()` | ISO 8601、带 `T` 与毫秒、`Z` 结尾 | `2026-09-11T04:30:15.000Z` | 系统设置 `taskLog.lastRunAt` / `trash.lastRunAt`（`system/config/system.json`）、`computeNextRunAt()` 计算基准、`db.cutoffIso()`、画布文件 `updatedAt`、LLM 历史条目 `createdAt`、产物 `history` 的 `mtime` |
| JS 毫秒时间戳 | `number` | `1789000000000` | 注册表 `startedAt`/`updatedAt`/`finishedAt`、LLM 会话 `createdAt`/`startedAt`/`completedAt`、前端 `TaskInfo.startedAt` |

**正确写法**（`db.ts` 真实用法）：把 ISO 串交给 SQLite 归一化后再比，**绝不字符串直比**：

```sql
-- listTasks：时间范围过滤
created_at >= datetime(?, 'utc')
created_at <= datetime(?, 'utc')

-- 日志清理：只删早于截止时间且任务已终态的日志
WHERE created_at < datetime(?, 'utc')
  AND task_id IN (SELECT id FROM tasks WHERE status IN ('completed', 'failed'))
```

**为什么不能直比**：`'2026-09-11 04:30:15' < '2026-09-11T04:30:15.000Z'` 在 SQLite 里按字典序成立（空格 `0x20` < `T` 0x54），于是「同一天的 ISO 上界」会被判成大于所有当天记录、ISO 下界会把当天记录全部排除——`since`/`until` 静默失效。`datetime(?, 'utc')` 把 ISO 串转成同一套 `YYYY-MM-DD HH:MM:SS` UTC 形态，比较才有意义。

**跨源比较**：设置里的 `lastRunAt`（ISO）与数据库里的时间（SQLite 形态）**不要直接比字符串**；需要比较时统一转 `Date.parse()` 或交给 SQLite `datetime()`。前端展示毫秒时间戳时自行格式化，不要把秒级/毫秒级混用（`startedAt` 是**毫秒**）。

## 相关文档

| 文档 | 关系 |
|------|------|
| [lifecycle.md](./lifecycle.md) | 生命周期：创建 / 领取 / 执行 / 中断 / 恢复，本文的行为侧 |
| [execution.md](./execution.md) | 三类执行器的实现细节（provider 解析、命令构建、流式处理） |
| [events.md](./events.md) | WS 消息协议与前端接入（`tasks` / `task-update` / `finished`） |
| [api.md](./api.md) | 任务查询 / 日志 / 中断 / 清理接口清单 |
| [log.md](./log.md) | `task_logs` 的分级、降噪、保留期与清理口径 |
| [ui.md](./ui.md) | 任务管理器与日志查看器的界面字段映射 |
| [development.md](./development.md) | 新增任务类型的接入清单与常见坑 |
| [`../canvas/task-architecture.md`](../canvas/task-architecture.md) | 画布视角的统一异步任务架构（分层图、三类接入表） |
| [`../canvas/data-model.md`](../canvas/data-model.md) | 画布自身的 `canvas.json` / 节点数据模型 |
| [`../asset-layout.md`](../asset-layout.md) | 产物与历史版本的文件布局 |
