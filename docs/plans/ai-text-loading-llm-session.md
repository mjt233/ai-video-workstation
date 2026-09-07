# AI文本生成节点 Loading 状态 + LLM 活跃会话管理（WebSocket，后端落盘）

> 本文档汇总资产画布「AI文本生成」节点系列需求的**任务目标**（含多轮讨论演化）、**现状结论**、**最终开发实现方案**（v3.2）与**数据流设计**，作为后续实施与评审的唯一依据。
>
> **v3.2 修订要点（相对 v3）**：不再依赖 localStorage；运行中状态恢复由服务端活跃会话注册表驱动（会话携带 nodeId + 画布 scope）；终态结果更新与文本历史存档由**后端独占完成**（直接写画布定义文件 canvas.json，CAS + 路径锁），前端不参与落盘与存档决策；流式期间前端仅内存显示（不写盘），**仅终态写盘一次**。

---

## 1. 任务需求目标

### 1.1 原始需求

资产画布「AI文本生成」节点中，模型 **Thinking（思考）和正在响应** 时，节点应该属于 **Loading 状态**：

1. 核查当前实现是否使用了节点标准的 Loading 状态；
2. 若未使用，设计并实现，**不修改原有 UI 交互效果**。

### 1.2 需求演化（多轮讨论后确定）

| 轮次 | 新增/澄清的需求 |
|------|-----------------|
| 第 1 轮 | 节点思考/响应期间应进入标准 Loading 状态；不修改原有 UI 交互效果 |
| 第 2 轮 | **节点 Loading 状态需在切换画布 / 刷新页面后保持**；完成后（离线期间）能结束 Loading 并更新 AI 响应内容 |
| 第 3 轮 | 设计 **LLM 活跃会话管理机制**：所有正在调用 LLM 的异步任务记录到会话列表（**仅内存保存，不持久化**）；AI文本节点开始执行时后台创建会话任务，思考+响应完成后从会话列表移除；**前后端使用 WebSocket 替换 SSE** |
| 第 4 轮 | 会话列表作为**全站全局功能**：系统 Header 右上角新增独立图标（+ 活跃数徽标 + 面板） |
| 第 5 轮 | **移除 localStorage 依赖**：Loading 恢复由服务端活跃会话注册表驱动（会话携带 nodeId + 画布 scope，画布加载/切换/WS 重连时按 scope 过滤恢复）；**最终结果更新与历史存档由后端完成**——会话终态时后端直接把 `config.output`（及完成时的 `outputHistory` 条目）写入画布定义文件，前端在 finished 时仅做视图同步，不参与落盘；流式期间前端仅内存显示（不写文件），**仅终态写盘** |

### 1.3 已确认的关键决策

1. **Loading 接入方式**：仅接入标准状态机（`statusByNode`），且遮罩实现采用**更通用、可扩展**方案——节点原型可在注册表自行声明自己的 Loading 遮罩组件（`NodePrototype.statusOverlay`）；AI文本节点注册自研遮罩。
2. **遮罩形态**：AI文本节点自定义遮罩为**非阻塞轻量遮罩**（spinner + 阶段日志 + 可点「中断」；不拦截流式输出与节点内「停止」按钮的交互）。
3. **会话列表落地**：全局 Header（`App.vue` 的 `v-app-bar`）右上角新增独立图标。
4. **会话存储**：仅内存（服务重启即失效）；**运行中状态恢复不靠 localStorage**——服务端活跃会话注册表是唯一事实源（会话携带 nodeId + 画布 scope，按 scope 过滤恢复）。
5. **传输通道**：WebSocket 彻底替换 SSE（当前 LLM 调用点全库唯一：`POST /api/llm/chat`，消费方唯一：`AiTextGenerateNode`，无兼容负担）。
6. **终态结果与历史落盘**：**后端独占**——会话终态时 `result-persist` 把 `config.output`（completed 时连同 `outputHistory` 条目）写入画布定义文件（CAS + 路径锁 + 冲突重试）；前端在 finished 时经 `adoptExternalChange` 仅做视图同步（含撤销栈对齐），不参与落盘与存档决策。
7. **流式期间不写盘**：前端纯内存显示（`viewOnlyUpdate`，不触发保存）；仅终态由后端一次性写盘。**接受取舍**：服务崩溃丢失本次部分输出（cancelled/failed 终态仍由后端写入部分输出，保持「停止保留部分输出」语义）。

---

## 2. 现状分析（已核实）

### 2.1 当前实现未使用标准 Loading 状态

- **标准机制**：`CanvasNodeCard` 按 `status` prop（`GenerateStatus`）在节点内容上叠加通用遮罩——`running` 显示加载动画 + 最近日志 + 「中断」按钮（`CanvasNodeCard.vue`）；数据源为 `useCanvasGeneration.statusByNode`，由 `AssetCanvas` 透传 `:status="statusByNode[id]"`。
- **AI文本节点现状**（`nodes/AiTextGenerateNode.vue`）：
  - 生成中状态为**节点内私有** `generating` ref + 自绘「Thinking...」状态条 + 内部「停止」按钮（`AbortController`），从未写入 `statusByNode` → 标准遮罩恒不出现；
  - 生成链路完全绕过标准管线：`useCanvasNodeOps.generateNode` 无 `text-ai` 分支（非 image-generate 直接 return），`gen.interrupt` 对 text-ai 无效（无 running 状态提前返回）；
  - 违反 `docs/asset-canvas.md` §13.1 约定「节点主体不应自行渲染 running/error 遮罩」——唯一例外。
- **SSE 现状**（`server/src/routes/llm.ts`）：`POST /api/llm/chat` 为 SSE 流式转发，**客户端断开即中止上游**（`req.on('close')` → abort），刷新/切换画布即任务丢失——无法满足「Loading 跨页面存活」。

### 2.2 画布定义文件 CAS 机制（后端落盘的事实基础）

- `canvas.json` 顶层 `rev`（保存版本号）由**后端统一维护**（`server/src/assets/canvas-def.ts`）：`saveCanvasDef` 为 CAS 写（`expectedRev !== 当前 rev` 返回 409 `VERSION_CONFLICT`，写入内容由后端注入 `rev+1` 与 `updatedAt`）；`withPathLock` 提供路径级进程内互斥串行写。
- **已有「后端外部改写画布」先例**：`bumpCanvasRevInJsonText`（shot 重编号/移动等后端改写引用时推进 rev），停留页面的旧版本在下次自动保存时经既有冲突横幅收敛——终态后端写盘复用同一套冲突兜底语义。

### 2.3 关键冲突

标准遮罩为整体覆盖式（`rgba(255,255,255,0.85)` + 拦截点击），直接置 `running` 会盖住流式输出、挡住节点内「停止」按钮，与「不修改原有 UI 交互效果」冲突 → 由「节点自定义遮罩」+「轻量非阻塞形态」化解。

---

## 3. 最终实施方案（v3.2）

### 3.1 总体架构

```
客户端（浏览器）                          服务端（Express，内存）            画布定义文件 / 上游 LLM
─────────────────                       ────────────────────────          ─────────────────────
App 启动 ──连接 WS(/llm-ws 全局单例)──▶   session-ws 枢纽（订阅注册表）
   │  ◀── sessions 全量/增量广播 ────        begin/finish → 广播（含 nodeId + scope）
   │                                        └─ 连接建立即推全量活跃列表
节点生成 ──POST /api/llm/chat──────────▶   session-manager.begin()（活跃区登记，立即返回 taskId）
   │  ──subscribe(taskId)──▶                │ 后台执行 createLlmStream（会话 abortController）──▶ 上游流
   │  ◀── snapshot / thinking / text ──     │  pushEvent：累计 thinking/text/warnings + phase 切换
   │  ◀── finished ──                       │  finish：终态 result-persist 写 canvas.json ──▶ config.output / outputHistory
刷新/切换 ◀── sessions 按 scope 过滤 ────    恢复订阅（快照补齐）→ 纯内存显示；终态 adopt 视图同步
停止/中断 ──cancel（HTTP 兜底）───────▶   取消会话（abort 上游 + cancelled + 写部分输出）
```

### 3.2 通用扩展点：`NodePrototype.statusOverlay`（前端）

- `frontend/src/canvas/registry.ts`：`NodePrototype` 新增**可选字段** `statusOverlay?: Component`——节点原型自行声明运行/错误状态遮罩组件；未声明时 `CanvasNodeCard` 渲染现有默认遮罩（**其余全部节点行为与视觉零变化**）。
- `CanvasNodeCard.vue`：遮罩渲染改为——存在 `statusOverlay` → 渲染自定义组件（props：`status`/`node`/`project`；emits：`interrupt(nodeId)`/`retry(nodeId)` 与默认遮罩一致）；否则默认遮罩原样。

### 3.3 状态机接入与视图同步（前端）

`useCanvasGeneration` 扩展（复用标准机制，**不含任何持久化记录**）：

- `GenerateStatus` 不变；新增 API：`beginClientRun(nodeId, lastLog?)`（置 running）、`updateClientRun(nodeId, log)`（阶段日志）、`endClientRun(nodeId)`（清状态）、`interruptLlm(nodeId)`（取消会话 + 收敛超时兜底 + `endClientRun`）。
- **恢复来源为服务端会话列表**（非 localStorage）：`AssetCanvas` 按 `llmSocket.sessions` 过滤（`project` + 画布 scope 匹配）→ 会话 `nodeId` 存在于 `nodeMap` → `beginClientRun('Thinking…')` + 恢复订阅（快照补齐）；WS 重连后对账：本端已知 taskId 不在新列表中 → `endClientRun`（结果以文件为准，无幽灵 Loading）。

`useCanvasStore` 新增两个方法：

- `viewOnlyUpdate(nodeId, patch)`：**纯内存补丁**——合并进 `data.nodes` 但不入撤销栈、不 `markDirty`、不触发保存（流式期间显示用；下游文本消费者读取同一 store 数据，保持现有实时联动）。
- `adoptExternalChange(nodeId, patch, newRev)`：**终态视图同步**——合并后端已落盘的 `config.output`/`outputHistory` 补丁 + 入撤销栈（保持「单次撤销可回退到生成前状态」语义）+ `savedRev` 对齐服务端新 rev（**不触发写盘**：内容已在文件）。

### 3.4 LLM 活跃会话管理器（服务端，内存 only，无完成区）

新增 `server/src/llm/session-manager.ts`：

```ts
interface LlmSession {
  taskId, nodeId, providerInstanceId, modelId
  label            // 节点名（会话列表展示）
  project, canvas  // 画布位置（CanvasDefTarget：画布定义文件定位 + 展示用）
  inputSent        // 本次实际发送文本（终态历史归档凭据）
  snapshot         // { modelName, presetName, mediaLabels } —— 终态历史归档凭据
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  phase: 'thinking' | 'responding'   // 首个 text 增量到达时切换
  thinking, text, warnings[], error?
  createdAt, startedAt, completedAt?
  abortController  // 服务端持有；取消即中止上游
}
```

- **仅活跃区** `Map<taskId, LlmSession>`：`begin()` 登记（**同节点单飞**：该 nodeId 已有活跃会话时拒绝并返回错误）→ `pushEvent()` 累加/改 phase → `finish()` 先执行**终态落盘**（`result-persist`，见 3.5）再从活跃区移除。
- **无完成区 / TTL / 清扫**：终态结果已持久化在文件系统，注册表无需留存终态数据。
- API：`begin / get / pushEvent / finish / cancel / listActive`。
- **所有 LLM 异步调用统一经此登记**（当前唯一调用点为 AI文本节点；未来新增调用点同样走此门槛）。
- **全局活跃会话上限 8**：超出时 `begin()` 拒绝（`POST` 返回 JSON 错误提示），防止误操作打满上游连接与内存。

### 3.5 终态结果落盘（服务端，后端独占）

新增 `server/src/llm/result-persist.ts`：

```
finish(status) → persistLlmResult(session)
  ├─ 读画布定义文件（resolveProjectPath + canvasDefRelPath；文件不存在 → 跳过）
  ├─ 校验 nodeId 仍存在于 nodes（节点被删除 → 跳过写盘，仅移除会话）
  ├─ completed：
  │    config.output = session.text
  │    config.outputHistory 追加一条（规则镜像前端 aiTextHistory.ts：
  │      id / createdAt 生成、input = inputSent、output = text、
  │      modelName/presetName/mediaLabels 取 snapshot、上限 50 裁剪最旧）
  ├─ cancelled / failed：config.output = 累计文本（保持「停止保留部分输出、不存档」语义；
  │      无任何累计文本时跳过写入）
  └─ 写入：saveCanvasDef（expectedRev = 当前 rev）+ withPathLock 串行化；
       VERSION_CONFLICT → 重读 rev 重试（≤3 次）；最终失败 → 会话标 failed
       + 广播「结果写入画布失败」+ console 日志（不静默）
```

- **历史由后端单写者追加**：多页签同时打开同一画布也不会产生重复历史条目（v3 的「终态幂等」与重复历史风险消除）。
- FE/BE 历史规则双份（`aiTextHistory.ts` / `result-persist.ts`）：双端单测覆盖同一组用例（id 格式、createdAt、50 条裁剪、meta 可选字段），文档互链防漂移。

### 3.6 WebSocket 枢纽（服务端）

新增 `server/src/llm/session-ws.ts`，依赖 `ws`（新增 `ws` + `@types/ws` 依赖）：

- 挂载于 `http.createServer(app)`（`index.ts` 由 `app.listen` 改为 `httpServer.listen`）的 `/llm-ws` 路径。
- **连接建立即推送 `sessions` 全量活跃列表**（含 `taskId/nodeId/label/modelName/phase/startedAt/status/project/scope`，供画布按 scope 过滤恢复与全局面板展示；**耗时由客户端按 startedAt 自行刷新**）；begin/finish 时增量广播。
- **socket close 时清理该连接的全部订阅**（防僵尸订阅造成广播浪费）。
- 协议（JSON）：

| 方向 | 消息 | 说明 |
|---|---|---|
| C→S | `{type:'subscribe', taskId}` | 订阅会话（生成开始 / 恢复订阅；未连接时客户端入队，连接后自动发送） |
| C→S | `{type:'unsubscribe', taskId}` | 节点卸载/切换画布退订（**任务继续**） |
| C→S | `{type:'cancel', taskId}` | 中断命令 |
| S→C | `{type:'sessions', sessions:[...]}` | 活跃列表（连接即全量 + begin/finish 增量） |
| S→C | `{type:'snapshot', ...会话全量}` | 订阅即发：运行中 = 累计进度（部分文本补齐显示） |
| S→C | `{type:'thinking'\|'text'\|'warning', delta/message}` | 实时增量广播（多页签天然同步） |
| S→C | `{type:'finished', taskId, status, ...}` | 终态（completed/failed/cancelled；后端已完成落盘） |
| S→C | `{type:'not-found', taskId}` | 订阅时会话已结束/不存在（**仅结束 Loading；结果已在文件，无需提示中断**） |

### 3.7 路由改造（服务端）

`server/src/routes/llm.ts`：

- `POST /api/llm/chat`：请求体**扩展** `nodeId/label/canvas（CanvasDefTarget：kind + episode/shot 或 stage/label）/snapshot{modelName,presetName,mediaLabels}` 并逐字段 `unknown` 校验（与现有风格一致）；原有项目/实例/模型校验与媒体能力过滤逻辑**不变** → `sessionManager.begin(...)`（失败/超上限返回 4xx JSON）→ **后台异步执行** `createLlmStream`（会话 `abortController`）→ 立即返回 `{ taskId, status:'running' }`。
- 后台执行器：逐事件 `pushEvent` + `wsHub.broadcast`；流正常结束 → `finish(completed)`；**取消判定**（`abortController.signal.aborted` 或会话已标 cancelled）→ `finish(cancelled)`，**AbortError 不得归类为 failed**；其余异常 → `finish(failed, error)`。
- **删除全部 SSE 代码**；新增 `POST /api/llm/chat/tasks/:taskId/cancel` 作 **HTTP 兜底**（WS 断连时停止仍可用，幂等；会话不存在返回 404，客户端视为已终态）。
- 启动无需对账：内存为空，画布加载查无活跃会话即无 Loading。

### 3.8 前端 WS 客户端与事件层

- 新增 `frontend/src/canvas/llmSocket.ts`（全局单例）：原生 `WebSocket`；App 挂载即连接；断线指数退避重连；连接建立/重连后自动重订阅全部已知 taskId；`subscribe(taskId, handler)` 未连接时入队；`cancel(taskId)`（WS 优先，失败自动 HTTP 兜底）；`sessions` 响应式列表（含 `nodeId/scope/startedAt`）。
- 新增 `frontend/src/canvas/llmEvents.ts`：把流式消费逻辑抽成纯函数 `applyLlmEvent(state, event)`（thinking/text/warning/finished/not-found → 阶段切换 + 累计 + 终态判定），**连接态（节点）与恢复态（AssetCanvas）共用同一消费器**，双路径行为严格一致、可单测；同时提供 500ms 节流 helper 供两路径共用（内存显示提交用）。
- `frontend/src/api/llm.ts`：`startLlmTask(req): Promise<{taskId}>`；移除 `chatLlmStream`。
- `frontend/vite.config.ts`：代理增加 `'/llm-ws': { target: 'ws://localhost:3001', ws: true }`（生产同源无需代理）。

### 3.9 AI 文本节点改造（`AiTextGenerateNode.vue`）

- **不修改原有交互逻辑**：停止按钮、Thinking 条、禁用控件、流式输出、历史存档语义全部保持。
- 节点新增 prop `canvasTarget`（画布 scope，经 CanvasNodeCard 从 AssetCanvas 透传），供生成请求携带会话定位信息。
- `onGenerate`：本地校验与快照（不变）→ `startLlmTask({..., nodeId, label, canvas: canvasTarget, snapshot: {modelName, presetName, mediaLabels}})` 取 taskId → `llmSocket.subscribe(taskId, handler)`，handler 走 `applyLlmEvent`：thinking 阶段「Thinking…」、首条 text 切「正在响应…」、`outputText += delta`、500ms 节流 `update:config-quiet`（**父级路由到 `viewOnlyUpdate`：仅内存显示，不写盘、不入撤销栈**）、错误红字、终态收敛（completed/cancelled/failed 均等待服务端 `finished`）。
- 生成期 `stream-state` emit（running/log/idle）；`isRunning` 由父级按 `statusByNode` 下发：**恢复态同样禁用控件、显示 Thinking 条，且「停止」按钮保持可用**（`disabled = !(generating || isRunning)`，恢复态经 cancel 中断）。
- 停止：`llmSocket.cancel(taskId)`（+ HTTP 兜底），等待服务端 `finished(cancelled)` 收敛；**3 秒收敛超时兜底**——HTTP 兜底已确认但 WS 已断时本地结束 Loading（幂等，重连后快照再校准）。
- finally：`unsubscribe` + `stream-state idle`；卸载/切换画布：仅 `unsubscribe`（任务继续，回到画布由 sessions 过滤恢复接管）。
- 新增 `nodes/AiTextStatusOverlay.vue` 并注册进 registry text-ai 条目：**非阻塞轻量遮罩**——spinner + 阶段日志 + 可点「中断」（容器 `pointer-events:none` 仅按钮 `auto`，近透明背景），支持 `failed` 态非阻塞红字提示；节点内 Thinking 条/停止按钮保持不变。

### 3.10 恢复数据流（刷新 / 切换画布 / WS 重连，sessions 驱动）

```
画布加载/切换/WS 重连 → llmSocket.sessions 按 项目 + 画布 scope 过滤
  ├─ 会话 running 且 nodeId 存在于 nodeMap → beginClientRun('Thinking…') → 恢复订阅
  │    ├─ snapshot（累计文本）→ 纯内存显示（viewOnlyUpdate 节流；输出区填充后滚动到底部）
  │    ├─ thinking/text/warning 增量 → 同消费器实时更新
  │    ├─ finished(completed) → adoptExternalChange（output+历史已由后端落盘；
  │    │                        入撤销栈 + savedRev 对齐）+ endClientRun → ✅ Loading 结束且结果已更新
  │    ├─ finished(failed) → statusByNode=error（自定义遮罩红字，可点生成重试）
  │    ├─ finished(cancelled) → 静默结束（后端已写部分输出）
  │    └─ not-found → 仅 endClientRun（结果已在文件，无需任何提示）
  └─ 重连对账：本端已知 taskId 不在服务端新列表 → endClientRun
        （服务重启后注册表为空 → 无 Loading 恢复、无幽灵 Loading；本次部分输出丢失为预期取舍）
```

- 节点被删除后终态到达：后端 `result-persist` 校验 nodeId 不存在 → 跳过写盘；前端 nodeMap 查无此节点 → 仅移除本地 running 标记。

### 3.11 全局 Header 会话面板

- `App.vue` `v-app-bar` 右上角（配置齿轮旁）新增图标按钮 `mdi-broadcast` + **活跃会话数徽标**（数据来自 `llmSocket.sessions`）。
- 点击展开「LLM 活跃会话」面板（全站可用）：节点名 / 模型名 / 阶段（Thinking… / 正在响应…，耗时按 `startedAt` 客户端每秒刷新）/ 状态；每行「中断」操作（`cancel(taskId)` + snackbar；中断非删除，无需 confirm）；空态「暂无进行中的 LLM 会话」；服务端 begin/finish 广播实时刷新。

---

## 4. 思考/响应阶段数据流（v3.2）

> 上游 `createLlmStream` 的阶段相关增量为两类：`reasoning-delta → {type:'thinking'}`、`text-delta → {type:'text'}`（`server/src/llm/runtime.ts`）；另有 `warning`（媒体过滤产生）、`error`/`done`（终态事件）。思考阶段只有 thinking 事件，正文阶段只有 text 事件。

### 4.1 发起（点击生成）

```
AiTextGenerateNode.onGenerate()
  ├─ 本地校验（模型/输入/多文本输入）——不变
  ├─ POST /api/llm/chat（项目/实例/模型/思考挡位/输入/媒体/snapshot/nodeId/label/canvas）
  │     ↑ 服务端：校验 + 媒体能力过滤（同现状）→ sessionManager.begin()（running，同节点单飞）
  │     ↑ 服务端：后台启动 createLlmStream（会话 abortController）→ 立即返回 { taskId }
  ├─ emit stream-state { running, log:'Thinking…' } → 状态机 running（标准 Loading）
  ├─ llmSocket.subscribe(taskId) → 收到 snapshot（初始空进度）
  └─ 本地：outputText=''、generating=true（控件禁用，同现状）；全程不再写盘
```

### 4.2 思考阶段（Thinking）

```
上游 reasoning-delta×N → createLlmStream → {type:'thinking', delta}
  ├─ 服务端：pushEvent（session.thinking += delta，phase=thinking）
  └─ WS 广播：
        node（连接态）→ applyLlmEvent → 阶段信号「Thinking…」（首条才发，防高频）
           ├─ 输出区仍为空（思考内容不进 config.output，与现状一致）
           ├─ 节点顶部「Thinking...」条 + 自定义遮罩 spinner + 遮罩日志「Thinking…」
           └─ sessions 广播 phase=thinking → Header 徽标/面板反映
```

### 4.3 响应阶段（正在响应）

```
上游 text-delta×N → {type:'text', delta}
  ├─ 服务端：pushEvent（session.text += delta，phase 切为 responding）
  └─ WS 广播：
        node → 首条 text 切「正在响应…」
           ├─ outputText += delta（本地累计）
           ├─ 500ms 节流 update:config-quiet → viewOnlyUpdate（纯内存显示：
           │     下游文本消费者同步可见；不入撤销栈、不触发保存）
           └─ 自动滚动到底部（用户上滚暂停跟随）——现状逻辑不变
```

### 4.4 终止路径（终态由后端落盘）

| 场景 | 行为 |
|---|---|
| 正常完成 | 上游 done → 后端 `result-persist` 写 `config.output` + 追加 `outputHistory`（CAS+重试）→ `finish(completed)` 广播 → 前端 `adoptExternalChange` 视图同步 + `endClientRun`（单次撤销语义保留） |
| 停止 / 中断 | `cancel`（WS，HTTP 兜底）→ abort 上游 → `finish(cancelled)` → **后端写 `config.output` = 部分输出**（无历史）→ 前端静默收敛（3s 超时兜底） |
| 上游异常 | `finish(failed)` → 后端写 `config.output` = 已累计文本（若有）→ 前端红字提示 |
| 刷新 / 切换 | 仅退订，服务端继续；恢复走 sessions 过滤 + 快照（纯内存显示），终态由后端落盘 |
| 服务重启 | 注册表空 → 无 Loading 恢复、无幽灵 Loading；本次未终态会话的部分输出丢失（预期取舍） |
| 终态写盘失败 | 重试 3 次仍失败 → 会话标 failed + 广播「结果写入画布失败」+ console 日志（不静默） |

### 4.5 竞态与兜底

| 场景 | 保障 |
|---|---|
| 生成中刷新/切换 | 服务端不因断连中止；恢复由服务端活跃列表驱动（无客户端指针可丢） |
| 生成期间再次点击生成 | `generating \|\| isRunning` 双守卫 + 服务端同节点单飞 |
| 多页签同类画布 | 同一 taskId 多订阅广播显示同步；**历史由后端单写者追加，无重复归档**；页签间写盘交错仍走既有 CAS 冲突横幅兜底 |
| 订阅时会话刚结束 | 回复 not-found/finished → 仅结束 Loading（结果已在文件） |
| 节点被删除后终态到达 | 后端跳过写盘；前端仅移除 running 标记 |
| WS 瞬时不可用 | 自动重连 + 重订阅快照补齐 + 重连对账；停止走 HTTP 兜底 |
| 服务端崩溃（流式期间） | 未终态会话与部分输出丢失（仅终态写盘的既定取舍；cancelled/failed 不会发生即无写盘） |
| 会话列表膨胀 | 仅活跃区，终态即移除；无任何持久数据 |

---

## 5. 方案演进对照（v1 → v2 → v3 → v3.2）

| 维度 | v1（首版） | v2（跨页面存活） | v3 | **v3.2（最终）** |
|---|---|---|---|---|
| 标准 Loading 状态机 | 接入 | 接入 | 接入 | 接入 |
| 节点自定义遮罩（`statusOverlay`） | ✅ | ✅ | ✅ | ✅ |
| 刷新/切换后 Loading 保持 | ❌ | ✅ HTTP 轮询恢复 | ✅ WS 快照恢复 | ✅ **服务端会话列表 scope 过滤恢复** |
| 完成后更新响应内容 | ❌ | ✅（SQLite 任务 + 轮询） | ✅（会话完成区 + finished） | ✅ **后端终态直接写 canvas.json** |
| 任务存储 | — | SQLite（持久化） | 内存注册表（不持久化） | 内存注册表（不持久化，**无完成区**） |
| 实时通道 | SSE | SSE + 轮询 | WebSocket 替换 SSE | WebSocket 替换 SSE |
| 会话可见性 | — | — | Header 全局图标 + 徽标 + 面板 | 同 v3 |
| 服务重启语义 | — | 置失败收敛 | 会话清空 → not-found 收敛为中断 | **注册表空 → 无 Loading、部分输出丢失（文件为准）** |
| 终态结果/历史落盘 | 前端 | 前端 | 前端终态提交（幂等缓解多页签） | **后端独占（单写者，历史零重复）** |
| 流式期间落盘 | 前端 500ms 节流 | 前端 | 前端 500ms 节流 | **不写盘（纯内存显示；仅终态一次写盘）** |
| 单次撤销语义 | ✅ | ✅ | ✅ | ✅（`adoptExternalChange` 入撤销栈保持） |
| 文本历史归档凭据 | 节点内存 | 任务记录 inputSent/snapshot | 会话快照 inputSent/snapshot | 会话快照 inputSent/snapshot（后端归档） |

> v2 曾设计的 SQLite `llm_tasks` 表、HTTP 轮询端点（`GET /api/llm/chat/tasks/:taskId`）已被内存会话 + WS 订阅取代；v3 的 localStorage 任务指针、完成区/TTL、not-found 中断语义已被 v3.2 的服务端会话列表 + 后端终态落盘取代，不再实施。

---

## 6. 涉及文件清单

**服务端**

| 文件 | 改动 |
|---|---|
| `server/src/llm/session-manager.ts`（新增） | 内存活跃区（begin/get/pushEvent/finish/cancel/listActive；同节点单飞；全局上限 8） |
| `server/src/llm/result-persist.ts`（新增） | 终态写盘：读 canvas.json → 校验节点存在 → output/outputHistory 补丁 → `saveCanvasDef` CAS + `withPathLock` + 冲突重试；失败广播+日志 |
| `server/src/llm/session-ws.ts`（新增） | WS 枢纽（订阅注册表、连接即推 sessions 全量、快照/增量/终态/活跃列表广播、not-found、close 清理订阅） |
| `server/src/routes/llm.ts` | `POST /api/llm/chat` 请求体扩展校验 + begin + 后台执行 + 立即返回 taskId；删除 SSE；新增 HTTP cancel 兜底 |
| `server/src/index.ts` | `http.createServer(app)` 并挂载 WSS |
| `server/package.json` | 新增 `ws` / `@types/ws`（并更新锁文件） |

**前端**

| 文件 | 改动 |
|---|---|
| `frontend/src/api/llm.ts` | `startLlmTask`；移除 `chatLlmStream` |
| `frontend/src/canvas/llmSocket.ts`（新增） | 全局单例 WS 客户端（连接/重连/订阅入队与复用/取消 HTTP 兜底/sessions 响应式） |
| `frontend/src/canvas/llmEvents.ts`（新增） | `applyLlmEvent` 事件消费纯函数（连接态/恢复态共用）+ 500ms 节流 helper |
| `frontend/src/canvas/useCanvasGeneration.ts` | `beginClientRun/updateClientRun/endClientRun/interruptLlm`（**无持久化记录、无 restore llm 分支**） |
| `frontend/src/canvas/useCanvasStore.ts` | `viewOnlyUpdate`（纯内存补丁不保存）+ `adoptExternalChange`（终态同步 + 撤销栈 + savedRev 对齐） |
| `frontend/src/canvas/registry.ts` | `NodePrototype.statusOverlay` 字段；text-ai 注册自研遮罩 |
| `frontend/src/components/canvas/CanvasNodeCard.vue` | 自定义遮罩渲染分支；`isRunning`/`canvasTarget` 透传；`stream-state`/`interrupt` 转发 |
| `frontend/src/components/canvas/nodes/AiTextGenerateNode.vue` | WS 订阅化生成流程；纯内存显示；停止走 cancel + 收敛超时；Thinking 条/停止按钮跟随 `isRunning`；原有交互逻辑保持 |
| `frontend/src/components/canvas/nodes/AiTextStatusOverlay.vue`（新增） | 非阻塞轻量遮罩（running/failed） |
| `frontend/src/components/canvas/composables/useCanvasNodeOps.ts` | `generateNode` 增加 text-ai 分支（重试入口）；`onInterrupt` 分流 text-ai → `interruptLlm` |
| `frontend/src/components/canvas/AssetCanvas.vue` | sessions 按 scope 过滤恢复 + 重连对账 + adopt 编排；stream-state 接线；canvasTarget 透传 |
| `frontend/src/App.vue` | Header 右上角图标 + 徽标 + 面板入口 |
| `frontend/src/components/LlmSessionsDialog.vue`（新增） | 活跃会话面板（列表/阶段/耗时（startedAt 客户端计时）/中断） |
| `frontend/vite.config.ts` | `/llm-ws` WS 代理 |

**文档**：`docs/asset-canvas.md`（§2.3 Loading 跨页面存活、§3 text-ai 条目、§8 生成流程、§13.1 开发指南 + 新增「LLM 活跃会话机制」章节）。

---

## 7. 测试与验证计划

- **服务端单测**：`session-manager.test.ts`（登记/同节点单飞/推流/终态移除活跃区/取消/上限）；`session-ws.test.ts`（mock 连接：连接即推全量/subscribe/snapshot/广播/close 清理订阅）；`result-persist.test.ts`（正常补丁、cancelled/failed 部分输出、节点删除跳过、50 条上限裁剪、CAS 冲突重试、写盘失败收敛、canvas 文件不存在跳过）。
- **前端单测**：`llmEvents.test.ts`（事件应用器：thinking/text 累计、阶段切换、终态）；llmSocket 订阅入队/复用纯逻辑；`useCanvasStore` 的 `viewOnlyUpdate`（不 dirty 不保存）与 `adoptExternalChange`（撤销栈 + savedRev 对齐）测试；历史规则与后端 `result-persist` 同组用例（防 FE/BE 漂移）。
- **约束校验**：`npm run typecheck` + `npm run lint`（服务端仅允许 `refs.ts` 既有 warning）。
- **浏览器实测**：
  1. 生成中刷新/切换画布 → 徽标与 Loading 恢复、Thinking/文本增量可见；
  2. **生成中关闭全部页签**，离线期间完成 → 重开画布：`config.output` / `config.outputHistory` 已由后端落盘、无重复历史；
  3. 完成瞬间刷新 → 终态收敛、视图同步（单次撤销可用）；
  4. Header 面板实时显示/中断；多页签同步且历史不重复；
  5. 停止 → 部分输出落盘、无历史误存；错误 → 红字提示 + 部分输出落盘；
  6. 服务重启 → 无幽灵 Loading（部分输出丢失为预期）；
  7. 生成中另一页签编辑其他节点 → 终态后保存走既有 CAS 冲突横幅兜底。

---

## 8. 待确认 / 风险提示

1. **服务重启丢未终态任务**（内存 only 固有取舍）：无幽灵 Loading，未终态会话部分输出丢失；已终态结果已在文件系统。
2. **流式期间不写盘**（仅终态写盘的既定取舍）：服务崩溃丢失本次全部部分输出；cancelled/failed 终态仍由后端写入部分输出。
3. **FE/BE 历史规则双份**（`aiTextHistory.ts` / `result-persist.ts`）：双端同组单测 + 文档互链防漂移。
4. **终态写盘与页签保存 CAS 交错**：复用既有冲突横幅兜底；`finished` 时 `adoptExternalChange` 对齐 savedRev 缩小冲突窗口。
5. **生成中另一页签编辑 output**：终态后端写入可能覆盖该编辑（与现有多页签竞态同级，列入风险）。
6. **长会话内存占用**：对话正文、thinking 与媒体 base64（单文件≤20MB）在流期间驻留内存，终态即释放；全局活跃上限 8 兜底。
7. **WS 升级与 Express 中间件**：`ws` 的 upgrade 事件先于 Express 中间件处理，`/llm-ws` 不会被 `app.get('*')` 兜底拦截（实施时验证）。
