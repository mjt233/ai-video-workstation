# 任务事件与前端接入：WS 枢纽 / taskSocket / HTTP 兜底

> 返回 [任务管理总览](../task-manager.md)

本文讲「运行态怎么从服务端流到界面」：`/llm-ws` 消息协议、全局单例客户端 `taskSocket`、HTTP 兜底路径，以及画布如何按 scope 恢复节点 Loading。任务模型见 [data-model.md](./data-model.md)，执行侧见 [execution.md](./execution.md)，中断语义见 [lifecycle.md](./lifecycle.md)。

## 一、端到端数据流

```
tasks/registry.ts（内存，运行态唯一事实源）
   │ on(begin|update|finish)              ← 事件订阅，不依赖传输
   ▼
tasks/task-ws.ts  wsHub（挂载 /llm-ws）
   │ tasks 全量 + task-update 增量 + LLM 专属消息
   ▼
frontend/src/canvas/taskSocket.ts（全局单例）
   ├─ tasks（响应式）→ App.vue → TaskManagerDialog（进行中页签）
   ├─ onTaskUpdate(task) → useCanvasGeneration（ffmpeg 进度/终态）
   ├─ onFinished(info)   → AssetCanvas（LLM 终态补丁 + savedRev 对齐）
   └─ subscribe(taskId)  → LLM 流式增量（thinking/text/warning）
                    ▲
                    │ snapshotReady=false 时
frontend/src/api/tasks.ts  listTasks() ──► GET /api/tasks ──┐
frontend/src/api/tasks.ts  cancelTask() ──► POST /api/tasks/:taskId/cancel（HTTP 兜底）
                                                            └─ tasks/routes.ts
```

一句话：**注册表产生事实 → 枢纽翻译成消息 → 单例客户端持有响应式副本 → 各消费方按自己的 scope 过滤**。前端从不"拥有"任务，只持有服务端事实的一个投影。

## 二、服务端 WS 枢纽（`server/src/tasks/task-ws.ts`）

### 2.1 挂载

| 项 | 值 |
|----|-----|
| 挂载点 | `wsHub.attach(server)`，由 `server/src/index.ts` 在 `http.createServer(app)` 之后调用；`attach` **幂等**（重复调用忽略） |
| 路径 | **`/llm-ws`**（`new WebSocketServer({ server, path: '/llm-ws' })`） |
| 为什么路径不改名 | 由原 `llm/session-ws.ts` 改造而来，生产同源、vite 代理已配，改名无收益（路径保持，**载荷**从"仅 LLM 活跃会话"升级为"系统全部异步任务"） |
| 与 Express 的关系 | ws 库自行处理 HTTP upgrade，**不经过** Express 中间件与 SPA 兜底路由 |
| 单例 | `export const wsHub = new TaskWsHub()`；`TaskWsHub` 内部持有 `wss`、`subscriptions: Map<WebSocket, Set<taskId>>`、注册表退订句柄 `offTaskEvents` |

### 2.2 服务端 → 客户端消息

| type | 载荷字段 | 发送时机 | 含义 / 消费方 |
|------|----------|----------|---------------|
| `tasks` | `tasks: TaskInfo[]` | ① 连接建立即推；② 注册表 `begin` / `update` / `finish` 每次事件后广播全量 | 当前**活跃**任务全量列表（终态任务已移出，故列表里不含刚结束的任务）。任务管理器「进行中」页签、画布恢复对账 |
| `task-update` | `task: TaskInfo` | 注册表 `begin` / `update` / `finish` 每次事件 | 单条任务增量（含 ffmpeg 真实进度、工作流状态、LLM 阶段）。画布 `onTaskUpdate` 的**终态来源**——终态任务已不在 `tasks` 里，只有这条消息能带来 `completed`/`failed`/`cancelled` |
| `snapshot` | `taskId`, `session: LlmSnapshotInfo` | 客户端 `subscribe` 且**该任务仍有活跃 LLM 会话**时 | 累加态补齐（`thinking` / `text` / `warnings`），供恢复态继续显示 |
| `thinking` \| `text` | `taskId`, `delta` | LLM 流式增量产生时，**只推给该 taskId 的订阅者** | 思考/正文增量（拼接即可） |
| `warning` | `taskId`, `message` | 会话产生警告（如媒体输入被忽略） | 会话级警告 |
| `finished` | `info: LlmFinishedInfo` | LLM 任务 `finish` 时**全局广播给全部连接**（不依赖按任务订阅） | 终态载荷：`taskId/nodeId/status/project/canvas/error?/output?/outputHistory?/rev?/prevRev?`。前端按 项目 + 画布 scope 过滤，并以 `savedRev === prevRev` 决定是否采纳补丁 |
| `not-found` | `taskId` | `subscribe` 时任务既不在注册表、又无活跃 LLM 会话；或 `cancel` 未被受理 | 「任务已结束/不存在」的确认（客户端据此结束 Loading，不报错） |
| `cancelling` | `taskId` | **仅 HTTP 取消路由**（`tasks/routes.ts`）受理成功后经 `wsHub.taskEvent` 推给该任务的订阅者 | 「中断已受理」，终态稍后由执行器收敛后广播 |

`TaskInfo`（广播与 REST 兜底共用的可序列化摘要，`toTaskInfo`）：`id / type / label / status / progress? / startedAt / project? / nodeId? / canvas? / cancelable / cancelBlockReason? / payload? / error?`，LLM 任务额外补 `phase`（`thinking`|`responding`）与 `modelName`（经 `llm-bridge` 反查会话）。

### 2.3 客户端 → 服务端消息

| type | 载荷 | 服务端行为 |
|------|------|-----------|
| `subscribe` | `taskId` | **按任务类型分流**：① 任务仍在注册表（ffmpeg / 工作流等）→ 只登记订阅关系，进度/终态由 `task-update` 广播推送；② 任务不在注册表但 LLM 会话仍活跃 → 回 `snapshot`；③ 两者都没有 → 回 `not-found`。`taskId` 非字符串或为空则**静默忽略**；JSON 解析失败打日志后忽略 |
| `unsubscribe` | `taskId` | 从该连接的订阅集合移除 |
| `cancel` | `taskId` | 转发 `taskRegistry.cancel(taskId)`；未受理（不存在/已终态/不可中断）时向该连接回 `not-found` |

### 2.4 广播时机与消息顺序（重要）

`onTaskEvent(e)` 的固定顺序：

```
1. e.type === 'finish' && e.task.type === 'llm'  →  全局广播 { type:'finished', taskId, info }
2. 广播 { type:'task-update', task }              ← 终态快照（此时任务已移出活跃区）
3. 广播 { type:'tasks', tasks: listActive() }     ← 全量列表，已不含该任务
```

由此产生两条必须知道的结论：

| 结论 | 说明 |
|------|------|
| **终态只能从 `task-update` 或 `finished` 拿到** | `tasks` 全量快照是不含终态任务的；客户端 `mergeTask` 会先把终态任务写进 `tasks`，紧接着被第 3 条全量列表**整体替换**掉——所以 `tasks` 的最终状态就是"活跃任务列表"，画布不能靠轮询 `tasks` 判断某个任务是否结束 |
| **`finished` 只对 LLM 全局广播** | 其他两类任务的终态靠 `task-update`（需要订阅方自己按 `nodeId`/`taskId` 匹配）。LLM 之所以额外全局广播，是因为它要在服务端落盘后让**任意**已连接客户端对齐 `rev`/`prevRev`（恢复路径对账退订后仍能收到） |

### 2.5 订阅关系生命周期

| 时机 | 处理 |
|------|------|
| 连接建立 | `subscriptions.set(socket, new Set())` → 立即 `send(socket, {type:'tasks', tasks: listActive()})` → 挂 `message`/`close`/`error` |
| 连接关闭 | `subscriptions.delete(socket)` —— **清理该连接的全部订阅**，防僵尸订阅造成广播浪费 |
| 连接异常 | 只 `console.error('[task-ws] 连接异常: ...')`，不断开其他连接 |
| 广播过滤 | `taskEvent` 只发给 `subs.has(taskId)` 且 `readyState === OPEN` 的 socket；`broadcast` 发给全部 OPEN 连接 |

### 2.6 设计决策：LLM 流式增量**不进**任务模型

`thinking` / `text` 增量**不写入 `TaskRecord`、不触发注册表事件**，仍按 `taskId` 订阅单独推送（`wsHub.taskEvent`），原因写在 `task-ws.ts` 头部注释里：

> 若把流式增量也纳入统一任务模型，则**每个 token 都会触发一次 `update` 事件 → 一次 `task-update` 广播 + 一次 `tasks` 全量列表广播**。一次回答上千个增量就是上千轮全量列表序列化与广播。

配套的取舍：

| 取舍 | 表现 |
|------|------|
| 任务列表里的 LLM 任务**不显示正文** | 只显示阶段（`Thinking…` / `正在响应…`）与模型名 |
| 正文只在**订阅者**那里可见 | 画布 AI 文本节点打开时订阅该 taskId 接收增量 |
| 订阅时用 `snapshot` 补齐累计态 | 中途订阅/刷新恢复也能拿到已累计的 `thinking` / `text` |
| 终态用全局 `finished` 兜底 | 即使订阅关系已退订，落盘后的终态补丁仍能到达（见 §2.4） |

### 2.7 载荷裁剪

`toTaskInfo(t)` 显式构造白名单字段：**`handle` 与内部 `seq` 不进入广播**（`handle` 是运行态中断凭据，仅内存持有；`seq` 仅用于同毫秒登记的稳定排序）。`TaskInfo` 与 REST `GET /api/tasks` 共用同一函数，保证两条路径载荷一致。

## 三、前端全局单例（`frontend/src/canvas/taskSocket.ts`）

`export const taskSocket = new TaskSocketClient()` —— **模块级单例**，`App.vue` 在 `onMounted(() => taskSocket.connect())` 连接一次（`started` 标记防止热重载重复连接）。

### 3.1 响应式状态

| 字段 | 类型 | 含义 |
|------|------|------|
| `tasks` | `ref<TaskInfo[]>` | 全部活跃任务（`tasks` 全量替换 + `task-update` 增量合并驱动），按 `startedAt` 倒序 |
| `connected` | `ref<boolean>` | WS 是否已建立 |
| `snapshotReady` | `ref<boolean>` | **本次连接是否已收到首个 `tasks` 全量快照**。连接建立到快照到达之间存在窗口，此期间 `tasks` 仍是空/旧值；`onclose` 时重置为 `false`（旧快照可能过期）→ 恢复方据此改走 HTTP 兜底 |
| `sessions` | `computed<LlmSessionInfo[]>` | LLM 视图：`tasks` 中 `type==='llm' && nodeId && canvas` 的项，补 `taskId` 字段。**兼容既有画布恢复/面板代码**，新代码直接用 `tasks` |

### 3.2 方法

| 方法 | 语义 |
|------|------|
| `connect()` | 建立全局连接（幂等：`started` 已置则忽略） |
| `subscribe(taskId, handler)` | 订阅某任务；**同一任务支持多订阅方**（`handlers: Map<taskId, Set<handler>>`）；未连接时入队 `pendingSubscribes`，连接后自动补发；返回取消订阅函数（仅移除本 handler，无剩余时通知服务端 `unsubscribe`） |
| `unsubscribe(taskId)` | 移除该任务的全部处理器并通知服务端（任务继续在服务端执行） |
| `cancel(taskId)` | **WS 优先** `{type:'cancel',taskId}` + **HTTP 兜底** `cancelTask(taskId)`（失败只 `console.error`）。两条都幂等 |
| `cancelLlm(taskId)` | 等价于 `cancel`（兼容既有 LLM 调用点语义） |
| `onFinished(listener)` | 订阅全局 `finished`（LLM 终态）；返回取消监听函数 |
| `onTaskUpdate(listener)` | 订阅 `task-update` 增量（画布 ffmpeg 进度/终态）；返回取消监听函数 |
| `getTask(taskId)` / `hasSubscribers(taskId)` | 查询辅助（对账/调试） |
| `emitTaskUpdateForTest` / `emitTaskEventForTest` | **仅测试**：本地触发监听器，模拟服务端广播 |

### 3.3 消息处理（`onMessage`）

| 收到 | 处理 |
|------|------|
| `tasks` | 数组则整体替换 `tasks.value`；**置 `snapshotReady = true`** |
| `task-update` | `mergeTask(task)`（按 id 找，命中替换、未命中 push，再按 `startedAt` 倒序重排并整体赋值以触发响应式）→ 依次调 `taskUpdateListeners`（单个监听器异常只打日志） |
| 其他 | `dispatch(event)` 按 `taskId` 分发给订阅处理器；若 `type === 'finished'` 再通知全部 `finishedListeners` |

### 3.4 重连与重订阅

| 项 | 值 |
|----|-----|
| URL | `${proto}//${window.location.host}/llm-ws`（`https:` → `wss:`），**同源**，不经过 axios baseURL |
| 退避 | `RECONNECT_BASE_MS = 1000` → 每次失败 ×2 → `RECONNECT_MAX_MS = 15000` 封顶；`onopen` 时重置为 1s |
| 重订阅 | `onopen` 里 `for (const taskId of this.handlers.keys()) send({type:'subscribe', taskId})`，再 `flushPending()` 补发队列 |
| 对账 | 服务端在连接建立时主动推 `tasks` 全量 → 与本地 `tasks` 对齐；同时 `snapshotReady` 先置 `false`（`onclose`）再置 `true`（首个快照） |

## 四、兼容层（`frontend/src/canvas/llmSocket.ts`）

统一任务架构落地后，原 LLM 专属 WS 客户端升级为 `canvas/taskSocket.ts`（同一连接承载"全部任务列表 + LLM 流式事件"）。`llmSocket.ts` 现在只有一条 `export { taskSocket, taskSocket as llmSocket, type ... } from './taskSocket'`：**纯兼容再导出**，让既有 `llmSocket.xxx` 调用点无需一次性改动。新代码直接用 `taskSocket`。

## 五、HTTP 兜底（`frontend/src/api/tasks.ts` + `server/src/tasks/routes.ts`）

| 客户端函数 | 请求 | 服务端实现 | 语义 |
|-----------|------|-----------|------|
| `listTasks(project?)` | `GET /api/tasks?project=` | `taskRegistry.listActive().filter(project).map(toTaskInfo)` | 活跃任务列表（**WS 不可用时的降级/调试路径**；任务管理器主通道是 WS） |
| `cancelTask(taskId)` | `POST /api/tasks/:taskId/cancel` | `taskRegistry.cancel(taskId)`；`ok=false` → `404 {error, code:'NOT_CANCELABLE'}`；成功 → `wsHub.taskEvent(taskId, {type:'cancelling', taskId})` | **统一中断入口**（路由到任务句柄：ffmpeg kill / LLM abort / 工作流 Bridge cancel）；**幂等**，任务已结束返回 404 |

axios 实例 `client` 的 `baseURL = '/api'`，故代码里的 `/tasks` 即 `/api/tasks`。

## 六、画布如何消费（`frontend/src/canvas/useCanvasGeneration.ts`）

### 6.1 `onTaskUpdate`：ffmpeg 的进度与终态

composable 生命周期内**只订阅一次**：

```ts
const offTaskUpdate = taskSocket.onTaskUpdate((task) => {
  if (task.type !== 'ffmpeg') return;                       // 工作流走本地轮询、LLM 走 finished
  const nodeId = Object.keys(taskIdByNode.value).find(id => taskIdByNode.value[id] === task.id);
  if (!nodeId) return;                                      // 非本画布/非本会话跟踪的任务
  if (task.status === 'running' || task.status === 'pending') { /* 写 s.progress / s.lastLog */ return; }
  /* 终态：清映射 → completed 刷新产物 / cancelled、failed 写错误 */
})
```

| 分支 | 行为 |
|------|------|
| `running` / `pending` 且有 `progress` | `s.progress = task.progress`；`s.lastLog = \`处理中 ${progress}%\``（节点遮罩进度条） |
| `completed` | 产物路径取本地记录 `ffmpegOutputByNode[nodeId]`，为空则回退 `task.payload.outputPath`；置 `success` 并调 `onResult(nodeId, finalPath)` 刷新产物展示 |
| `cancelled` | `statusByNode[nodeId] = { status: 'error', errorMsg: '已中断' }` |
| `failed` | `errorMsg = task.error ?? '任务失败'` |

即：**ffmpeg 的进度与终态完全由广播驱动，前端不轮询**。

> 工作流的进度**不走这条广播**（本监听第一行就把非 `ffmpeg` 任务挡掉）：它由本地轮询读 `GET /api/workflow/tasks/:id` 的 `progress` 标准字段写入同一个 `GenerateStatus.progress`。两条路径最终都汇到 `nodeProgressPercent()` 决定遮罩是渲染确定百分比还是不确定动画。注册表里工作流任务的 `progress` 由引擎每轮 `poll` 远端后写入，因此 WS 广播其实也带该字段——画布不用它，任务管理器用。

### 6.2 提交与 `not-found` 竞态

`trackFfmpegTask(nodeId, taskId, outputPath, runningLog, onResult?)`：登记 `taskIdByNode` / `ffmpegOutputByNode` / `ffmpegResultCbByNode` 三张表，置 `running`，并额外 `taskSocket.subscribe(taskId, handler)`——只为处理"**订阅时任务已结束**"（刷新/重连竞态）：收到 `not-found` 即退订并按完成收敛，**且做产物存在性核验**（`getCanvasNodeInfo`）：产物在 → 调 `onResult` 刷新；产物不在 → 置 `errorMsg = '任务已结束但未生成产物，请重新执行'`（而非误报成功）。

> 这条核验是真实缺陷的回归产物：早期 `subscribe` 分支只用 `llmSessionLookup` 判断任务是否存在，订阅 ffmpeg 任务（无 LLM 会话）时立即回 `not-found`，前端误判结束并清空映射，导致后续 `task-update` 因找不到节点而被忽略（表现为"拼接完成后节点预览不刷新，刷新页面才可见"）。修复为「先查注册表、再查 LLM 会话」，两者都没有才回 `not-found`。

### 6.3 `restore()` / `collectRunningTasks()`：两路事实源合并

`restore(knownNodeIds?)` 在画布加载 / 切换目标回到本画布时调用，数据来自 `collectRunningTasks()`——**两路合并、按 `taskId` 去重**：

| 路 | 来源 | 覆盖 | 过滤与读出 |
|----|------|------|-----------|
| ① 统一任务注册表 | `activeRegistryTasks()`：`taskSocket.snapshotReady === true` 时用 `taskSocket.tasks.value`，否则 `await listActiveTasks(project)`（`GET /api/tasks`） | `ffmpeg` + 已登记的 `workflow` 任务 | 逐条筛 `type ∈ {ffmpeg, workflow}`、有 `nodeId`、`status ∈ {running, pending}`、`isCurrentScope(task)`、`knownNodeIds.has(nodeId)`；记 `outputPath = payload.outputPath` |
| ② SQLite 工作流任务 | `listWorkflowTasks({ project, status, limit: 1000 })`，`status` 依次取 `running` / `pending`（`GET /api/workflow/tasks`） | 工作流任务的**持久化权威** | 用 `task.params.nodeId` / `task.params.canvas` 做同样过滤；`entries.has(taskId)` 命中则跳过（去重）；读出 `params.outputPath` |

统一过滤条件（缺一不可）：

| 条件 | 代码 |
|------|------|
| 项目一致 | `task.project === project` |
| 画布 scope 一致 | `isCurrentScope(task)`：`canvas.kind` 相同；`scene` 比 `episode`+`shot`，`stage` 比 `stage`+`label`；当前画布定位不完整（`canvasTarget()` 返回 `null`）时一律不恢复 |
| 节点仍在当前画布 | `knownNodeIds.has(nodeId)`——已删除节点的任务不恢复 |
| 仍在运行 | `status ∈ {running, pending}` |

恢复动作（`restore`）：

```ts
for (const entry of await collectRunningTasks(knownNodeIds)) {
  if (statusByNode.value[entry.nodeId]?.status === 'running') continue;   // 本会话已跟踪，不重复接管
  taskIdByNode.value[nodeId] = taskId;
  statusByNode.value[nodeId] = { status: 'running', lastLog: '任务进行中…', taskId };
  if (entry.kind === 'workflow') { poll(taskId, nodeId, outputPath); continue; }   // 续跑本地轮询
  const off = taskSocket.subscribe(taskId, (event) => {                            // ffmpeg：重订阅 WS
    if (event.type !== 'not-found') return;
    off(); onFfmpegTaskFinished(nodeId, outputPath, 'completed');
  });
}
```

### 6.4 为什么工作流任务仍保留本地轮询

| 理由 | 说明 |
|------|------|
| **SQLite 是工作流任务的持久化权威** | 注册表只有运行态、且服务重启即清空；任务状态、阶段日志、`result`/`error_msg` 都在 `tasks` 表 |
| **引擎是状态推进的唯一来源** | 远端轮询、失败原因、产物路径都由引擎写入 DB；WS 广播只给"当前状态快照"，给不了阶段日志 |
| 需要阶段文案 | `poll()` 每 2 秒 `getTaskStatus(taskId)` + `getTaskLogs(taskId, { limit: 1 })` 取**最后一条日志**用于节点遮罩展示（`limit=1` 是硬要求：不传 `limit` 会拉回全量，单任务可达上千行，见 [log.md](./log.md)） |
| 首次立即查询 | `tick()` 先执行一次再 `setInterval`，避免结果已就绪时白等 2 秒 |

`POLL_INTERVAL_MS = 2000`；终态后 `clearInterval` + 清 `taskIdByNode`；轮询是**纯体验层**——结果落盘不依赖它，即使轮询全部中断，重新进入画布时产物按固定路径直接可见。轮询异常被 `catch {}` 吞掉（有意：下一轮重试，注释已说明）。

### 6.5 `reset()`：只清展示态

切换画布目标 / 卸载组件时清掉 `pollTimers`、`llmConvergeTimers`、`statusByNode`、`taskIdByNode`、`ffmpegOutputByNode` 等本地映射——**不动服务端任务**。任务继续执行，回到本画布时由 `restore()` 按 scope 重新接管。这正是"Loading 跨页面保留"的前端半边。

## 七、任务管理器（`frontend/src/components/TaskManagerDialog.vue`）

| 项 | 实现 |
|----|------|
| 数据源 | 由 `App.vue` 注入 `:tasks="taskSocket.tasks.value"`（**进行中页签只读 `taskSocket.tasks`**，无自己的请求） |
| 活跃列表 | `props.tasks.filter(t => t.status==='running' \|\| 'pending').sort(by startedAt desc)` |
| 页签 | `active`（进行中，内存注册表）/ `history`（历史，`<TaskHistoryPanel>` 走 SQLite 任务 + 日志） |
| 展示 | 类型标记（AI 生成 / LLM 会话 / 视频处理）、状态文案（`排队中` / `Thinking…` / `正在响应…` / `处理中 {n}%` / `运行中…`）、进度条、已运行时长（客户端每秒刷新）、画布位置（`分镜第{episode}集 {shot}#` 或 `场景 {stage} / {label}`） |
| 中断 | `taskSocket.cancel(t.id)`（WS + HTTP 兜底）；`cancelable === false` 置灰并以 `title` 显示 `cancelBlockReason` |
| 完成提示 | 面板打开期间监听活跃数量下降 → 「已完成 N 个」计数；关闭时复位页签并停止计时器 |

## 八、三个"为什么"

### 8.1 为什么要有 HTTP 兜底

| 场景 | 只靠 WS 会怎样 | 兜底路径 |
|------|----------------|----------|
| **`snapshotReady === false` 窗口**：WS 刚连上、`tasks` 全量还没到（或断线重连中） | 画布此刻加载 → `taskSocket.tasks` 为空/旧值 → 漏恢复运行中任务，节点 Loading 被误清除（用户以为任务没了） | `activeRegistryTasks()` 改走 `GET /api/tasks?project=`，服务端注册表是同一份事实，无窗口 |
| WS 完全不可用（代理/企业网络） | 任务列表永远空白 | 任务管理器主通道仍是 WS，但恢复路径与 `cancelTask` 都有 HTTP 版 |

兜底本身的失败处理是**不阻断加载**：HTTP 也失败 → `console.error` + 回退 `taskSocket.tasks.value`（可能为空）。语义排序始终是「WS 快照（新鲜）> HTTP（权威但多一跳）> 空列表」。

### 8.2 为什么"Loading 跨页面保留"

| 机制 | 说明 |
|------|------|
| 客户端是**全局单例** | `taskSocket` 定义在模块作用域，`App.vue` 挂载时 `connect()` 一次；路由切换、画布组件卸载都**不会**断开连接或清空 `tasks`。任务列表的生存期 = 页面会话，而不是某个组件的生存期 |
| 任务真相在**服务端** | 离开画布只调 `reset()` 清本地展示态；任务照旧执行，注册表照旧广播 |
| 回来时**重新投影** | `restore()` 按「项目 + 画布 scope + 节点仍存在」从注册表 + SQLite 重建 Loading，而不是从"上次离开时的内存状态"恢复 |
| 全站共享一份 | 任务管理器（任意页面均可打开）与画布读的是同一个 `tasks`；不存在"这个页面的任务列表"和"那个页面的任务列表" |

### 8.3 为什么删掉旧的 localStorage 任务记录

原实现把 ffmpeg 任务写进 `localStorage`（`dsh.asset-canvas.tasks.*`）用于刷新恢复，现已**全部删除**（前端源码中已无任务相关 `localStorage`，仅剩侧边栏折叠、视图模式等纯 UI 偏好）。删除的理由：

| 问题 | 服务端注册表方案 |
|------|------------------|
| `localStorage` 是**浏览器本地真相**：换浏览器/换设备/清缓存即失忆；多标签页各存一份，互不同步 | 真相在服务端，所有标签页/浏览器/设备订阅同一份广播，天然一致 |
| **幽灵 Loading**：记录残留但任务早已结束（或被服务重启清掉），刷新后节点永远转圈；反过来任务在跑而记录丢了则漏恢复 | 恢复数据源是**当前**活跃任务；任务不在活跃列表就不恢复，且 ffmpeg 分支还有 `not-found` + 产物存在性核验双保险 |
| **两套真相对账**：本地记录与 SQLite/注册表可能矛盾，需要额外合并规则 | 单一事实源（注册表 + 工作流任务补查 SQLite），无对账成本 |
| 需要自己维护 key 命名、清理时机与版本迁移 | 无需持久化格式，服务重启即清空是**已确认取舍**（工作流任务的 DB 记录不受影响） |

约束（已写入仓库 `AGENTS.md`）：**不要再引入 `localStorage` 任务记录**。

## 九、常见坑

| 坑 | 现象 | 根因与对策 |
|----|------|-----------|
| **`subscribe` 不能只用 `llmSessionLookup` 判定存在性** | 订阅 ffmpeg/工作流任务被立刻回 `not-found`，进度与终态被忽略 | `subscribe` 必须「先查 `taskRegistry.get(taskId)`、再查 `llmSessionLookup`」，两者都没有才回 `not-found`。教训：传输层的"订阅确认"语义必须**按任务类型分流**，统一注册表才是权威源 |
| **终态任务会"闪一下又消失"** | `task-update` 先把终态任务写进 `tasks`，紧接着 `tasks` 全量列表把它替换掉 | 这是服务端固定顺序（§2.4）；消费终态要用 `onTaskUpdate`/`onFinished`，不要轮询 `tasks` |
| **`snapshotReady` 忘判** | 刷新时代画布偶尔漏恢复 Loading | 恢复前必须 `if (taskSocket.snapshotReady.value) 用 tasks; else 走 HTTP`；`onclose` 已把该标记重置为 `false`，但消费方仍要读它 |
| **恢复不做 scope 过滤** | 切到别的分镜，看到本项目其它画布的 Loading | 必须同时判 `project` + `canvas.kind/episode/shot`（或 `stage/label`）+ `knownNodeIds.has(nodeId)`；`isCurrentScope` 与 `collectRunningTasks` 是唯一入口 |
| **删除的节点被恢复成 Loading** | 节点已删，任务还在跑，界面出现无处可点的加载态 | `restore(knownNodeIds)` 必须传当前画布的节点 id 集合 |
| **只查注册表恢复工作流任务** | 提交后立刻刷新页面 → 任务在排队（引擎 2s tick 尚未领取）→ 注册表里没有 → Loading 丢失 | 必须补查 SQLite `pending\|running`（§6.3 路②）。画布定位要靠 `params.nodeId` / `params.canvas` 持久化，否则重启后无处可查 |
| **同节点单飞** | 同一节点并发任务，产物互相覆盖 | 服务端 `register` 按 `nodeId` 拒绝（`NODE_BUSY`）；前端提交前也按 `statusByNode[nodeId].status === 'running'` 拦截 |
| **`getTaskLogs` 不传 `limit`** | 每 2 秒搬上千行日志 | 轮询用 `limit: 1`；日志查看器用尾部 200 条 + 按需"查看全部" |
| **监听器异常拖垮广播** | 一个消费方抛错，其他消费方收不到消息 | 客户端每个监听器调用都包 `try/catch` 并打日志；服务端 `registry.emit` 同样处理 |
| **`cancel` 只发 WS** | WS 断连时中断点了没反应 | `taskSocket.cancel` 是「WS 优先 + HTTP 兜底」两条都发，服务端两侧都幂等 |
| **HTTP 404 被当成错误弹窗** | 任务刚好结束仍提示失败 | `POST /api/tasks/:id/cancel` 对已结束任务返回 404 是**预期语义**（幂等），客户端只 `console.error`，不打扰用户 |
| **`reset()` 误当作"取消任务"** | 以为切走画布就把任务停了 | `reset()` 只清内存展示态与定时器；真正停止要显式 `cancel` |

## 相关文档

- [data-model.md](./data-model.md) —— `TaskInfo` / `TaskRecord` / LLM 会话字段对照
- [lifecycle.md](./lifecycle.md) —— 中断三种语义与服务重启恢复策略
- [execution.md](./execution.md) —— 引擎、ffmpeg 执行器、LLM 适配、provider 传输层
- [log.md](./log.md) —— 日志读取的 `limit/truncated` 与降噪规则
- [ui.md](./ui.md) —— 任务管理器、日志查看器、错误「详情」按钮
- [`../canvas/task-architecture.md`](../canvas/task-architecture.md) —— 画布视角的分层图与接入表
- [`../canvas/llm-session.md`](../canvas/llm-session.md) —— AI 文本节点的流式显示与 Loading 恢复
