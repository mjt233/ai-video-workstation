# 任务管理开发指南：新增任务类型、常见坑、测试与验证

> 返回 [任务管理总览](../task-manager.md)

本文面向**动手改任务体系**的场景：新增一种异步任务类型、给任务加中断能力、给系统加一类定时维护任务，以及改完之后怎么测、怎么在真实数据上安全验证。

配套阅读：[data-model.md](./data-model.md)（模型字段）、[lifecycle.md](./lifecycle.md)（生命周期与中断全链路）、[execution.md](./execution.md)（执行器实现）、[events.md](./events.md)（WS 与前端接入）、[log.md](./log.md)（日志与清理口径）、[api.md](./api.md)（接口清单）、[ui.md](./ui.md)（任务管理器界面）。

## 零、代码地图

| 文件 | 职责 |
|------|------|
| `server/src/tasks/registry.ts` | 统一任务注册表（**仅内存**）：`register` / `update` / `finish` / `cancel` / `listActive` / `on`，`TaskRecord`、`TaskError`（`NODE_BUSY` / `TASK_LIMIT`）、`MAX_ACTIVE_TASKS = 32` |
| `server/src/tasks/executor.ts` | 执行器门面：`TaskExecutor<TParams>` / `TaskMeta` / `TaskHandle` / `createTaskHandle()` / `finishTask()`（只放接口，避免与执行器循环依赖） |
| `server/src/tasks/ffmpeg-executor.ts` | **完整实现**的参考执行器：登记 → `spawn` → 解析 `-progress` → 终态收敛；中断 = kill + 删半截产物 |
| `server/src/tasks/workflow-executor.ts` | **镜像适配器**：引擎侧登记/推进/收敛 + `workflowCancelability()` + `cancelWorkflowTask()` |
| `server/src/tasks/llm-executor.ts` | **薄适配**：会话 id 即任务 id，`lifecycleOf()` 注入回调，中断委托 `sessionManager.cancel` |
| `server/src/tasks/ffmpeg-task.ts` | ffmpeg 任务统一入口 `startFfmpegTask()`（登记 + 后台跑 + 立即返回 taskId） |
| `server/src/tasks/task-target.ts` | `parseTaskTarget(req.body)` → `{ nodeId, canvas }`（宽松解析，不合法丢字段） |
| `server/src/tasks/task-ws.ts` | `/llm-ws` 枢纽：注册表事件 → `task-update` / `tasks` 广播、`subscribe`/`unsubscribe`/`cancel`、`toTaskInfo()` 裁剪 |
| `server/src/tasks/routes.ts` | `GET /api/tasks`、`POST /api/tasks/:taskId/cancel` |
| `server/src/assets/ffmpeg-command.ts` | `FfmpegCommandSpec`（`outputAbs` / `build` / `duration?` / `info?`），assets 与 tasks 的共享类型 |
| `frontend/src/canvas/taskSocket.ts` | 前端任务模型 `TaskInfo` 与 `taskSocket` 单例（`tasks` / `snapshotReady` / `onTaskUpdate` / `onFinished` / `subscribe` / `cancel`） |
| `frontend/src/canvas/useCanvasGeneration.ts` | 提交 → 跟踪 → 终态收敛 → `restore()` 恢复 |
| `frontend/src/components/TaskManagerDialog.vue` | 任务管理器（「进行中」读 `taskSocket.tasks`，「历史」读 SQLite） |

## 一、新增一种任务类型的接入清单

按顺序做，每一步都写清要改的文件与函数。

### 1. 写执行器：`server/src/tasks/<xxx>-executor.ts`

实现 `TaskExecutor<TParams>`（`tasks/executor.ts`）：

| 成员 | 要求 |
|------|------|
| `readonly type: TaskType` | 本执行器负责的类型 |
| `create(meta: TaskMeta, params): TaskRecord` | 调 `taskRegistry.register({ ...meta, type: this.type, handle: ... })`；`TaskMeta = Omit<TaskRegisterInput, 'type' \| 'handle'>`，即 `type`/`handle` 由执行器自己填 |
| `run(taskId, params): Promise<void>` | 真正执行；**终态必须由执行器收敛**（成功/失败/中断都调 `taskRegistry.finish`），否则任务永远留在活跃区 |
| `cancel(taskId): boolean` | 受理中断（不可中断返回 `false`）；做「真中断 + 清理半截产物」 |
| `onProgress?(taskId, progress)` | 可选，接口预留；现有三个执行器都没实现，`ffmpeg-executor.ts` 直接在 `cmd.on('progress')` 里调 `taskRegistry.update(taskId, { progress })` |

参考写法（`ffmpeg-executor.ts`）：

- 中断句柄用闭包注入：`let taskId = ''` → `register(...)` → `taskId = task.id`，`handle: createTaskHandle(() => this.cancel(taskId))`；
- `run()` 的 catch 分支用 `state.cancelRequested` 区分「中断导致的失败」与真实错误，前者按 `cancelled` 收敛、后者带 `extractFfmpegError()` 的详情按 `failed` 收敛；
- 执行器内部状态（子进程、AbortController）自己用 `Map<taskId, ...>` 持有，执行结束即 `delete`；
- 收尾可用 `finishTask(taskId, { status, error })`（`executor.ts` 的安全封装）。

若执行权在别的模块（如会话管理器），**不要让那个模块 import 执行器**：由执行器提供生命周期回调（`llm-executor.ts` 的 `lifecycleOf(taskId)` → `onPhase` / `onFinish`），或经桥接器注入查询实现（`llm-bridge.ts` 的 `setLlmSessionLookup`），避免模块环。

### 2. 登记时把定位与中断声明给全

`taskRegistry.register()` 入参（`TaskRegisterInput`）逐字段检查：

| 字段 | 要点 |
|------|------|
| `type` / `label` | `label` 是任务管理器展示名（如「拼接视频」「AI文本生成」） |
| `project` | 前端按项目过滤恢复 |
| `nodeId` / `canvas` | **画布恢复的两个关键字段**；缺了刷新后恢复不到 Loading。服务端从请求体取用 `parseTaskTarget(req.body)`（`tasks/task-target.ts`） |
| `status` | 缺省 `running`；本地排队用 `pending` |
| `progress` | 0~100；缺省 = 不确定进度（UI 显示 indeterminate） |
| `cancelable` / `cancelBlockReason` | 见第二节 |
| `payload` | 类型自有字段（`update()` 时**浅合并**）；想给前端用（如产物路径 `outputPath`）就放这里 |
| `handle` | 中断凭据，经 `createTaskHandle()`；**只内存持有，不进广播载荷** |
| `idOverride` | 复用外部 id（工作流用 SQLite 主键、LLM 用会话 id）；同 id 的终态快照会被清掉，可安全复用 |

同 `nodeId` 单飞（`NODE_BUSY`）与全局上限（`TASK_LIMIT`，`MAX_ACTIVE_TASKS = 32`）都由 `register()` 抛 `TaskError`，路由层用 `respondTaskError(err, res)` 映射为 HTTP 错误；不要在执行器里自己判重。

启动入口参考 `tasks/ffmpeg-task.ts: startFfmpegTask()`：`create()` → `void executor.run(task.id, params)` 后台执行 → 立即返回 `task.id`（路由 `res.json({ taskId, status: 'running' })`）。

### 3. 扩展 `TaskType` 联合类型（5 处，容易漏）

`TaskType` 是写死的字面量联合，服务端与前端各写了一份：

| 文件 | 位置 |
|------|------|
| `server/src/tasks/registry.ts` | `export type TaskType = 'workflow' \| 'llm' \| 'ffmpeg'` |
| `server/src/tasks/task-ws.ts` | `interface TaskInfo { type: 'workflow' \| 'llm' \| 'ffmpeg' }` |
| `frontend/src/canvas/taskSocket.ts` | `export type TaskType` |
| `frontend/src/api/tasks.ts` | `interface TaskInfo { type: ... }` |
| `frontend/src/components/TaskManagerDialog.vue` | `typeLabel()` / `typeColor()` / `statusText()`（if/else 兜底，新类型会落到「视频处理」/teal/「运行中…」） |

漏掉前四处 → `npm run typecheck` 报错；漏掉第五处 → 类型检查通过但 UI 显示错。

### 4. WS 出口：走注册表广播就**不用改**

`task-ws.ts` 只在 `attach(server)` 里 `taskRegistry.on(...)` 订阅一次，之后：

- `begin` / `update` / `finish` → 广播 `task-update`（增量）+ `tasks`（全量活跃列表）；
- 连接建立即推 `tasks` 全量（供任务管理器与画布按 scope 恢复）；
- `toTaskInfo()` 裁掉 `handle` / `seq` 等不可序列化字段；
- 客户端 `cancel` 命令 → `taskRegistry.cancel(taskId)`，失败回 `not-found`；HTTP 兜底 `POST /api/tasks/:taskId/cancel` 走同一个注册表入口。

**结论：只要任务经注册表登记、且不引入类型专属的额外通道，`task-ws.ts` 与 `tasks/routes.ts` 一行都不用改。**

只有两种情况需要动它：

1. 类型特有字段要暴露给前端 —— 参照 LLM 的 `phase` / `modelName` 经 `llmSessionLookup` 补进 `toTaskInfo()`；
2. 需要 LLM 那种「不依赖订阅的终态全局广播」（`finished`，带 `project`/`canvas`/`rev` 供画布对账）或流式增量通道。

流式增量（`thinking` / `text` / `warning`）**不进任务模型**：它们只按 `taskId` 订阅推送，否则每个增量都会触发一次全量任务列表广播。

### 5. 前端跟踪 + `restore` 支持（`frontend/src/canvas/useCanvasGeneration.ts`）

- **提交**：调接口时带 `taskTarget(nodeId)`（`{ nodeId, canvas }`），拿到 `taskId`。
- **跟踪**：`trackFfmpegTask(nodeId, taskId, outputPath, runningLog, onResult)` 登记 `taskIdByNode` / `ffmpegOutputByNode` / `ffmpegResultCbByNode` 并置 `running`；进度与终态在 `taskSocket.onTaskUpdate(...)` 里按 `taskId` 反查节点收敛（`completed` → `success` + 回调刷新产物；`cancelled` → 「已中断」；其余 → `task.error`）。额外 `taskSocket.subscribe(taskId, ...)` 只为处理「订阅时任务已结束」的 `not-found` 竞态。
- **恢复**：`restore(knownNodeIds)` ← `collectRunningTasks(knownNodeIds)` → 数据源是 `activeRegistryTasks()`（WS 快照就绪时用 `taskSocket.tasks`，否则 HTTP 兜底 `listTasks(project)`）；过滤条件是 `isCurrentScope(task)`（项目 + 画布 scope）+ 节点仍在当前画布上（`knownNodeIds`）。
- **新类型要参与恢复**：`RestoreEntry.kind` 目前是 `'ffmpeg' | 'workflow'`，需要在 `collectRunningTasks()` 的注册表分支放开类型判断、在 `restore()` 的 `entry.kind` 分支加跟踪方式（工作流是续跑 `poll()`，ffmpeg 是重订阅 WS）。
- **终态不等于产物存在**：`onFfmpegTaskFinished()` 用 `getCanvasNodeInfo(project, finalPath)` 核验产物，缺失时提示「任务已结束但未生成产物，请重新执行」——新类型的恢复路径也要做同样的核验。
- **中断**：统一走 `cancelTask(taskId)`（`POST /api/tasks/:taskId/cancel`）；被拒（404 `NOT_CANCELABLE`）时**保持 running 态**并经 `onCancelRejected` 提示，不要本地预置「已中断」。

### 6. 补测试

见第四节；至少覆盖：登记字段（含 `nodeId`/`canvas`）、终态收敛（成功/失败/中断三条路径）、`cancel` 的真实效果（如产物被删）、前端 `restore` 的 scope 过滤。

## 二、中断能力的声明

| 声明 | 位置 | 语义 |
|------|------|------|
| `cancelable` | `TaskRecord.cancelable`（`register()` 缺省 `true`：`input.cancelable !== false`） | `false` 时注册表 `cancel()` 直接拒绝，返回 `cancelBlockReason`，UI 置灰 |
| `cancelBlockReason` | 同上；`update()` 传**空串**表示「无原因」（删除字段） | 面向用户的原因文案，经路由 404 `NOT_CANCELABLE` 的 `error` 返回、前端 `onCancelRejected` 提示 |
| `handle` | `createTaskHandle(cancel)` | 注册表只调 `handle.cancel()`，不关心机制；返回 Promise 时**不阻塞调用方**，结果由执行器经 `finish` 收敛。`cancelable=true` 但没有 `handle` 仍会被拒（「该任务暂不支持中断」） |
| `deferredCancel` | `WorkflowCapabilities.deferredCancel`（`server/src/workflows/types.ts`） | 「写标记 + 尽力中止」的延迟取消语义，**同步执行类 provider 声明** |

工作流的可中断性由纯函数 `workflowCancelability(workflowId, impl, status, remoteTaskId)` 判定（`tasks/workflow-executor.ts`），并在**登记时**与**每次 `update()`** 时重算（`status` 或 `remoteTaskId` 任一变化都要重算，缺省回退注册表当前状态 / SQLite 已落盘值，避免把已提交远端的任务算回不可中断）。规则：

| 场景 | 判定 |
|------|------|
| 实现未声明 `capabilities.cancelable` | 不可中断（「该工作流不支持中断」） |
| `status === 'pending'`（本地排队） | 可中断 |
| `status` 不是 `pending` / `running` | 不可中断 |
| `running` 且无 `remoteTaskId` 且未声明 `deferredCancel` | 不可中断（「任务尚未提交到远端，无法中断」） |
| `running` + 有 `remoteTaskId`（异步 provider，如 Bridge） | 可中断：`notifyProviderCancel()` 按工作流绑定的 `providerInstanceId` 定位实例后调 `provider.cancel(remoteTaskId)` |
| `running` + `deferredCancel`（同步 provider：火山方舟 seedream、OpenAI 兼容、自定义同步工作流） | 可中断：先 `markCancelRequested(params)` 落盘（引擎写产物前检查 → **绝不落产物**），再尽力通知 provider 中止在途请求；通知失败只告警，任务仍收敛为「用户中断」，原因文案「已请求取消将在执行完成后生效」 |

三个必须知道的点：

1. **同步 provider 必须声明 `deferredCancel`**，否则 `execute` 尚未返回 `remoteTaskId` 的窗口内取消会被拒；
2. **中断优先级由执行器保证，不是注册表**：ffmpeg 在 `cancel()` 里置 `cancelRequested` 并在 `run()` 的 catch 分支收敛 `cancelled`；工作流由引擎检查 `cancelRequested` 标记后写 `failed('用户中断')`。`registry.finish()` 本身只按传入的 `outcome.status` 落状态（其 JSDoc 里「取消优先」的说法在方法体中没有实现，不要依赖）；
3. **中断必须清理半截产物**：`FfmpegTaskParams.removeOnCancel` 缺省 `true` → `cancel()` 里 `fs.unlink(outputAbs)`，删除失败只 `console.warn`（不阻断中断收敛），产物目录保留上一次成功结果。

## 三、常见坑

| 症状 | 原因 | 规则 |
|------|------|------|
| 服务重启后画布上跑着的任务不再显示 Loading，任务管理器「进行中」清空 | 注册表**仅内存**（`registry.ts` 文件头即写明重启即空），ffmpeg / LLM 任务无持久化 | 运行态事实源只有注册表，但恢复必须叠加持久态：`collectRunningTasks()` 同时查注册表与 SQLite `pending\|running`。不要把注册表当历史，也不要只信它做恢复 |
| 刚提交的工作流任务在管理器里看不到；刷新后画布漏恢复 | 工作流只在**引擎领取执行**时登记（`workflow-engine.ts: runTask` 里的 `workflowExecutor.create`），本地排队窗口内注册表为空；登记异常也只 `console.warn` | 恢复路径必须补查 SQLite：`listWorkflowTasks({ project, status, limit: 1000 })`，再用 `params.nodeId` + `params.canvas` 过滤。SQLite 才是工作流任务的持久化权威 |
| `finish()` 被调了两次；任务已终态后执行器又调 `finish` | 终态即移出活跃区 | `finish` 幂等：任务已移除时返回缓存的同一份终态快照、**不再广播**；未知 id 返回 `null`。执行器的成功/失败/中断三条路径都必须收敛一次，漏一次任务就永远留在活跃区、画布 Loading 不消失 |
| 同一节点第二次点生成报「该节点已有进行中的任务」 | `register()` 按 `nodeId` 单飞（**跨类型**扫描，不限 `type`），以及全局 `MAX_ACTIVE_TASKS = 32` | 同节点同时只允许一个活跃任务；重试前先确认旧任务已收敛，不要把 `NODE_BUSY` 当 bug 绕过 |
| ffmpeg 任务没有进度、点「中断」无效 | 直接 `Ffmpeg().save()` 自己执行，绕过了执行器（没有 `-progress` 解析、没有 kill 入口） | 本地 ffmpeg 操作必须导出 `buildXxxCommand()`（`assets/concat-video.ts` / `trim-video.ts` / `trim-audio.ts` / `extract-frame.ts`）返回 `FfmpegCommandSpec`，交给 `tasks/ffmpeg-executor.ts` 统一 `save()`；`build` 回调里**不要调 `save()`** |
| 中断后目录里留下半截 `output.mp4`，把上一次成功产物覆盖成损坏文件 | 只 kill 子进程、不删产物 | `cancel()` 必须清理半截产物（`removeOnCancel` 缺省 `true` → `fs.unlink(outputAbs)`）；因此命令构建必须给出 `outputAbs` |
| 按时间筛选「超期」数据查不到 / 比较结果不对 | `created_at` 由 SQLite `datetime('now')` 写入，形如 `2026-09-11 04:30:15`（**UTC、无时区、无毫秒**），而代码里传的是 ISO 串 | 一律 `created_at < datetime(?, 'utc')`（`db.ts` 的 `countCleanableLogs` / `cleanupTaskLogs` / `listTasks` 都这么做）；不要把 ISO 串直接跟 `created_at` 比字符串 |
| 清理后数据库文件大小没变小，误判「没回收」 | `VACUUM` 在 Windows 上截断文件后仍保留磁盘分配，`stat` 大小可能不变 | 判定空间回收看 `freelist_count`（`VACUUM` 后为 0）与 `page_count × page_size` 得到的 `allocatedBytes`，**不要用文件大小**；`scripts/verify-log-cleanup.mjs` 的 PASS/FAIL 也按这套口径 |
| 删了几万行日志，`page_count` 与占用纹丝不动 | SQLite 只把页放回空闲链表，文件高水位（`page_count`）不下降 | 「腾出空间」的信号是 `freelist_count > 0`（`LogStats.freelistCount` / `freelistBytes`）；要真正回落需 `wal_checkpoint(TRUNCATE)` + `VACUUM` |
| `VACUUM` 报错（事务内无法执行） | `VACUUM` **不能在事务里执行** | 清理路径不使用显式事务，靠分批 `DELETE`（`CLEANUP_BATCH_SIZE = 5000`）的原子性保证一致性；`VACUUM` 前先 `wal_checkpoint(TRUNCATE)`（否则 WAL 仍占旧空间） |
| 新类型加完了，`typecheck` 报错或任务管理器标签显示成「视频处理」 | `TaskType` 联合在服务端/前端各写死一份，UI 用 if/else 兜底 | 同步改 5 处：`tasks/registry.ts`、`tasks/task-ws.ts`（`TaskInfo.type`）、`canvas/taskSocket.ts`、`api/tasks.ts`、`TaskManagerDialog.vue` |
| 执行器在 `finish` 之后又 `update`，前端毫无反应 | `update()` 对终态任务直接 `return`（不广播） | 终态信息一次给全；需要额外载荷就放进 `finish` 前的 `payload`，或走类型专属通道（如 LLM 的 `finished` 广播） |
| `startFfmpegTask` 传 spec 时类型不对 | `buildTrimAudioCommand()` 返回 `{ spec, result }`（附带产物相对路径与实际时长），其余三个 `buildXxxCommand()` 直接返回 `FfmpegCommandSpec` | 调用处先解构：`const { spec } = await buildTrimAudioCommand(...)`（见 `routes/canvas.ts`） |
| 恢复后节点直接报成功，但产物其实不存在 | 任务终态（尤其 `not-found`、订阅时任务已结束）≠ 产物已落盘 | 收敛 `completed` 前用 `getCanvasNodeInfo()` 做产物存在性核验，缺失时提示重试；新类型的恢复路径照做 |
| `cancelBlockReason` 改不掉 / 前端一直显示旧原因 | `update()` 只在传**空串**时删除该字段，传 `undefined` 保持原值 | 可中断性要成对重算并写入 `cancelable` + `cancelBlockReason`（`workflow-executor.update()` 的写法：无原因时显式传 `''`） |
| LLM 输出时任务列表频繁重渲染 | 流式增量若进任务模型，每个 token 都会触发一次 `tasks` 全量广播 | `thinking` / `text` / `warning` 只走按 `taskId` 的订阅通道，不进注册表；任务模型只放低频字段（阶段、进度） |

## 四、测试与验证

### 4.1 怎么跑

| 命令 | 说明 |
|------|------|
| `cd server && npm run test` | `vitest run`；`server/vitest.config.ts` 的 `environment: 'node'`，`include: ['src/**/*.test.ts']` |
| `cd server && npx vitest run src/tasks/registry.test.ts` | 单文件（改任务注册表/执行器时最常用） |
| `cd frontend && npm run test` | `vitest run`；`frontend/vitest.config.ts` 的 `environment: 'jsdom'` |
| `npm run typecheck`（根目录） | `typecheck:server`（`tsc --noEmit`）+ `typecheck:frontend`（`vue-tsc --noEmit --skipLibCheck`） |
| `npm run lint` / `npm run lint:fix` | ESLint flat config |

**工作区硬约束：改完代码必须跑 `npm run typecheck` 与 `npm run lint`，两者都要零错误。**

现成的测试样板：

| 测试文件 | 覆盖 |
|----------|------|
| `server/src/db.test.ts` | 日志读取/清理/统计/列表分页；临时库注入的样板 |
| `server/src/system/log-cleaner.test.ts` | 清理「只删终态超期日志 + 运行中受保护 + VACUUM 回收」，走真实临时库 |
| `server/src/system/log-scheduler.test.ts` | 调度时机与重入/停止语义，模块级 mock |
| `server/src/workflow-engine.test.ts` | 引擎侧 `runTask`（provider 解析、注册表登记透传、轮询日志降噪） |
| `frontend/src/canvas/useCanvasGeneration.test.ts` | 提交参数、进度/终态广播收敛、`restore` 对账（含 HTTP 兜底与 SQLite 补查） |
| `server/src/tasks/registry.test.ts` / `workflow-executor.test.ts` / `task-target.test.ts` | 注册表语义、可中断性判定、定位解析 |

### 4.2 临时数据库注入模式

```ts
let dir = '';
let dbPath = '';
let originalPath = '';

beforeEach(async () => {
  originalPath = state.dbPath;                                  // 1. 存原路径
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'log-cleaner-'));
  dbPath = path.join(dir, 'workflow.db');
  resetDatabase(dbPath);                                        // 2. 切到临时库并重建连接
});

afterEach(async () => {
  stopTaskLogCleanScheduler();
  resetDatabase(originalPath);                                  // 3. 还原，避免污染其它测试文件
  await fs.rm(dir, { recursive: true, force: true });
});
```

- `state.dbPath` + `resetDatabase(path)` 是唯一的换库入口（`server/src/db.ts`），**绝不能让测试写真实 `data/workflow.db`**。
- 「历史时间」只能写 SQL 回填：表默认值是 `datetime('now')`，插入时无法指定时间。做法是先取 `SELECT COALESCE(MAX(id), 0) FROM task_logs`，插入后用 `UPDATE task_logs SET created_at = ? WHERE task_id = ? AND id > ?` **只改本次插入的行**。
- 时间相关的逻辑一律通过参数注入 `now`（`runTaskLogAutoClean({ now })`、`previewTaskLogClean({ now })`），不要动系统时间。

### 4.3 `vi.mock` + `vi.hoisted`

`vi.mock` 的工厂会被 hoist 到文件顶部，因此工厂里引用的 mock 与可变状态**必须**用 `vi.hoisted` 定义（`workflow-engine.test.ts` 顶部的写法），否则报 `Cannot access '...' before initialization`。同一文件里：

- mock 掉 `./db.js`、`./workflows/registry.js`、`./providers/*`、`./system/system-settings.js` 等边界；
- 把产物路径指到 `os.tmpdir()`（mock `./assets/paths.js`）并要求 `node:fs/promises` 的 `mkdir` / `writeFile` 为 no-op —— **测试不允许往真实 `design/` 写文件**；
- 有些 mock 用 `importOriginal` 展开真实实现只替换一个函数（`vi.mock('./log-cleaner.js', async (importOriginal) => ({ ...await importOriginal(), runTaskLogAutoClean: mockRunClean }))`）。

### 4.4 模块级 mock 必须单独成文件

`log-scheduler.test.ts` 对 `./log-cleaner.js` 取模块级 mock，而 **`vi.mock` 会作用于同一模块注册表内的所有导入方**。所以：

- `log-scheduler.test.ts` 只验证**调度时机**（启动补跑、间隔判断、禁用跳过、重入、幂等 start、失败不外抛），清理逻辑全交给替身；
- `log-cleaner.test.ts` 用**真实实现 + 真实临时库**验证「清理什么」，并且不 mock `log-cleaner`；
- 结论：同一个被测模块的「逻辑」与「时机」分文件写，混在一起会互相污染。

### 4.5 假定时器 vs 真实定时器（涉及文件写入时）

- 纯 mock 依赖的用例可以用假定时器：`useCanvasGeneration.test.ts` 里 `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(2000)` 推进 2 秒轮询，`emitTaskUpdateForTest()` 模拟服务端广播，直接设 `taskSocket.snapshotReady.value` 覆盖「快照未就绪 → HTTP 兜底」分支。
- **混入真实磁盘 / 真实 DB I/O 时改用真实定时器 + 注入极短间隔**：`log-scheduler.test.ts` 的 `startTaskLogCleanScheduler({ configPath, startupDelayMs: 60, checkIntervalMs: 120 })` 再 `await wait(400)`。假定时器推进不保证真实 I/O 回调的完成时序，容易写出偶发失败的用例。
- 这就是 `startTaskLogCleanScheduler` / `runTaskLogAutoClean` 把 `configPath`、`checkIntervalMs`、`startupDelayMs`、`now`、`vacuum` 全部做成可注入参数的原因 —— **新的定时任务也必须这么做**。

### 4.6 副本演练脚本

`scripts/verify-log-cleanup.mjs`（**在真实库的副本上演练，绝不碰真实库**）：

```powershell
node scripts/verify-log-cleanup.mjs 14    # 参数 = 保留期天数，缺省 14
```

做的事：把 `data/workflow.db`（连 `-wal` / `-shm`）复制到 `os.tmpdir()` → 在副本上按与 `db.cleanupTaskLogs` 同口径的 SQL 分批删除 → `wal_checkpoint(TRUNCATE)` + `VACUUM` → 打印清理前后行数、`dbstat` 表/索引占用、文件占用、`page_count` / `freelist_count`，并输出四行判定：

```
任务行不变:            PASS   （tasks 行不受影响）
运行中日志零删除:      PASS   （pending/running 任务日志受保护）
删除行数 == 可清理行数: PASS
VACUUM 后无空闲页:      PASS   （freelist_count == 0）
```

最后删掉副本并打印「真实库未被触碰」。脚本用 `createRequire` 从 `server/node_modules` 解析 `better-sqlite3`（根目录没装），所以直接用 `node` 跑即可。

> ⚠️ `scripts/seed-expired-logs.mjs` 是**一次性数据准备**脚本，与上面相反：它**直接写真实库**——把最近 30 个已终态任务的日志回填到 30 天前，并插入一个 `running` 任务 `e2e-running-protected` + 5 条超期日志，用来验证「运行中任务日志永不删除」。只在确实需要造超期数据做端到端验证时运行一次，**不要当成演练脚本**；验证本身始终走 `verify-log-cleanup.mjs` 的副本路径（与 AGENTS.md 的要求一致：验证此类改动须在数据库副本上演练，不得对真实库执行清理）。

## 五、可选：新增系统级定时维护任务

照抄 `server/src/system/log-scheduler.ts` + `log-cleaner.ts` 的形态（回收站那套 `trash-scheduler.ts` / `trash-cleaner.ts` 是同一个模子，只有间隔粒度不同）。八个要点：

1. **轮询 + 到点才执行**：`CHECK_INTERVAL_MS`（默认 1 小时）轮询一次配置，用纯函数 `shouldRunXxx(lastRunAt, interval, now)` 判断是否达到执行间隔（默认 24 小时）；
2. **启动补跑**：`STARTUP_DELAY_MS`（默认 60 秒）后跑一次 `reason='startup'`，从未执行或已超期才真正执行；延迟是为了不和引擎、目录扫描等服务启动动作争 I/O；
3. **重入保护**：`state.running` 标志，上一轮没结束就打印「上一轮尚未结束，跳过本轮」并 return（`VACUUM` 会长时间持锁，绝不能并发）；导出 `isXxxRunning()` 让手动触发也能避让；
4. **配置热生效**：每轮重新 `readSystemSettings(configPath)`，改开关/间隔/保留期无需重启；
5. **统一日志前缀**（如 `[tasklog-auto-clean]`），只在「启用状态变化」「真正触发」「执行失败」时打印，空闲轮询不刷屏；
6. **定时器 `unref?.()`**，不阻止进程退出；
7. **`start` 幂等**（先进 `stop`，避免双份定时器），并导出 `stopXxxScheduler()` 供测试收尾；
8. **失败不外抛**：`try / catch` 打完整错误，且**失败不更新 `lastRunAt`**（下一轮自动重试）；被禁用时返回 `{ ran: false, deleted: 0 }` 空结果。

要改的文件清单：

| 文件 | 改动 |
|------|------|
| `server/src/system/system-settings.ts` | 新增子类接口（如 `XxxSettings`）、`DEFAULT_SYSTEM_SETTINGS` 默认值、`normalizeXxxAutoClean()`、`normalizeSystemSettings()` 分支、`updateXxxSettings()`（字段校验：整数范围 + `enabled` 布尔，抛 `code: 'INVALID'`）、`markXxxRun()`（服务端维护 `lastRunAt`）、必要时加 `computeNextRunAtHours()` |
| `server/src/system/<xxx>-cleaner.ts` | `shouldRunXxx()` 纯函数（便于单测）、`previewXxx()` 预演、`runXxxAutoClean({ reason, force, configPath, now })`；`reason` 取 `'scheduled' \| 'startup' \| 'manual'`，`force` 用于手动触发时忽略开关 |
| `server/src/system/<xxx>-scheduler.ts` | `CHECK_INTERVAL_MS` / `STARTUP_DELAY_MS` / `startXxxScheduler({ configPath, checkIntervalMs, startupDelayMs })` / `stopXxxScheduler()` / `isXxxRunning()` |
| `server/src/index.ts` | 在 `discoverProviders().then(discoverWorkflows().then(...))` 里、`startEngine()` 之后调用 `startXxxScheduler()`（现有两行：`startTrashAutoCleanScheduler()`、`startTaskLogCleanScheduler()`） |
| `server/src/routes/system.ts` | `GET /api/system/xxx/stats`（统计）、`POST /api/system/xxx/clean`（手动触发，`force: true`） |
| `frontend/src/components/system-settings/SystemSettingsPanel.vue` + 新 `XxxSettingsSection.vue` | 新增子类页签（现有两个：回收站、日志）；表单 `variant="outlined"`，删除类操作走 `confirm` 工具函数 |
| `server/src/system/<xxx>-cleaner.test.ts` / `<xxx>-scheduler.test.ts` | **分成两个文件**（4.4 节的原因）：前者真实临时库，后者模块级 mock |
| `scripts/verify-<xxx>.mjs` | 副本演练脚本，输出 PASS/FAIL 判定行 |

安全边界照抄日志清理：**只动属于已终态任务的数据，运行中/进行中的对象一律保护**（`pending` / `running` 不动），并且在文档与 UI 提示里写明「哪些不受影响」（`tasks` 行、产物文件、产物历史）。

## 六、提交前自查

- [ ] 新增执行器实现了 `create` / `run` / `cancel`，且**所有终态分支都调了 `finish`**；
- [ ] `nodeId` / `canvas` 随登记透传，画布刷新后能恢复 Loading；
- [ ] `cancelable` / `cancelBlockReason` 声明正确，中断能真中断并清理半截产物；
- [ ] `TaskType` 五处、任务管理器标签与颜色都补齐；
- [ ] 未新增 localStorage 任务记录（既有约束），未在 `build` 回调里调 `save()`；
- [ ] 新测试通过；`npm run typecheck`、`npm run lint` 零错误；
- [ ] 涉及清理/回收的改动已在**数据库副本**上用 `scripts/verify-log-cleanup.mjs` 演练过。
