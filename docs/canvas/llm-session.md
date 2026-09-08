# LLM 活跃会话机制（AI 文本节点 Loading / WebSocket / 全局面板）

> 返回 [总览与定位](./README.md)

> 设计文档与演进过程见 `../plans/ai-text-loading-llm-session.md`（任务需求目标、现状结论、v3.2 最终方案与数据流）。

## 目标与总体架构

- **标准 Loading**：AI 文本节点思考/响应期间进入标准状态机（`statusByNode`，`CanvasNodeCard` 渲染原型自定义遮罩 `statusOverlay`——非阻塞轻量形态，不修改原有 UI 交互效果）；节点内 Thinking 条/「停止」按钮/禁用控件/流式输出/自动滚动全部保持。
- **跨页面存活**：Loading 恢复由**服务端活跃会话注册表**驱动（会话携带 nodeId + 画布 scope；**仅内存，不持久化、无 localStorage 参与**）；完成后能结束 Loading 并更新响应内容（终态由后端落盘）。
- **LLM 活跃会话管理**：所有正在调用 LLM 的异步任务统一登记（当前唯一调用点为 AI 文本节点；**全局上限 8**，同节点单飞）；思考+响应完成后从列表移除。
- **WebSocket 替换 SSE**：`/llm-ws`（全局单例连接，`ws` 库挂载于 `http.createServer(app)`；upgrade 不经 Express 中间件与 SPA 兜底路由）；客户端断开**不再中止上游**。
- **全局面板**：Header 右上角独立图标（`mdi-broadcast` + 活跃数徽标）→ `LlmSessionsDialog.vue`（全站可用：节点名/模型名/阶段/耗时（按 `startedAt` 客户端每秒刷新）/状态；每行「中断」（取消非删除，无需 confirm）；空态提示）。

```
客户端（浏览器）                          服务端（Express，内存）            画布定义文件 / 上游 LLM
App 启动 ──连接 WS(/llm-ws 全局单例)──▶   session-ws 枢纽（订阅注册表）
   │  ◀── sessions 全量/增量广播 ────        begin/finish → 广播（含 nodeId + scope）
节点生成 ──POST /api/llm/chat──────────▶   session-manager.begin()（活跃区登记，立即返回 taskId）
   │  ──subscribe(taskId)──▶                │ 后台执行 createLlmStream（会话 abortController）──▶ 上游流
   │  ◀── snapshot / thinking / text ──     │  pushEvent：累计 thinking/text/warnings + phase 切换
   │  ◀── finished ──                       │  finish：终态 result-persist 写 canvas.json ──▶ config.output / outputHistory
刷新/切换 ◀── sessions 按 scope 过滤 ────    恢复订阅（快照补齐）→ 纯内存显示；终态 adopt 视图同步
停止/中断 ──cancel（WS + HTTP 兜底）───▶   取消会话（abort 上游 + cancelled + 写部分输出）
```

## 服务端

- **`server/src/llm/session-manager.ts`**（新增）：内存活跃区 `Map<taskId, LlmSession>`（**无完成区/TTL**——终态结果已持久化到文件系统）。`LlmSession` 含 `taskId/nodeId/providerInstanceId/modelId/label/project/canvas/inputSent/snapshot/status/phase/thinking/text/warnings/error/startedAt/completedAt/cancelled/abortController` 与终态写入凭据 `persistRev/persistPatch`。API：`begin`（同节点单飞 NODE_BUSY + 全局上限 SESSION_LIMIT）/`get`/`pushEvent`/`cancel`（幂等）/`finish`（终态落盘后移除）/`listActive`/`on`（begin/update/finish 事件，wsHub 订阅）。`finish` 取消优先（cancel 标记后即使流正常结束也按 cancelled 收敛）；落盘失败时 completed 降级为 failed（广播「结果写入画布失败」+ console 日志，不静默），cancelled/failed 保持原状态。
- **`server/src/llm/result-persist.ts`**（新增）：终态结果落盘（**后端独占，历史单写者**）——读画布定义文件（不存在/节点已删除 → 跳过仅移除会话）→ completed：`config.output = 正文` + 追加历史（规则镜像前端 `aiTextHistory.ts`：id/createdAt 生成、`input = inputSent`、快照元信息、上限 50 裁剪最旧）；cancelled/failed：`config.output = 累计正文`（若有），**不追加历史**（无累计文本跳过）→ `saveCanvasDef`（CAS + `withPathLock` 进程内串行）+ VERSION_CONFLICT 重读重试（≤3 次）；**思考内容绝不写入 `config.output`**（仅内部展示）。
- **`server/src/llm/session-ws.ts`**（新增，`ws` + `@types/ws` 依赖）：`wsHub.attach(server)` 挂载 `/llm-ws`；**连接建立即推 `sessions` 全量活跃列表**（`taskId/nodeId/label/modelName/phase/status/startedAt/project/canvas`）；begin/update（阶段切换/警告/错误）/finish 时全量广播；`subscribe`（存在 → snapshot 快照补齐；不存在 → not-found）/`unsubscribe`（任务继续）/`cancel`（命令下发）；socket close 清理该连接全部订阅。
- **`server/src/routes/llm.ts`** 改造：`POST /api/llm/chat` 请求体扩展 `nodeId/label/canvas/snapshot`（逐字段校验；项目/实例/模型/媒体能力过滤逻辑不变）→ `sessionManager.begin` → 后台执行 `createLlmStream`（会话 `abortController`）→ 立即返回 `{ taskId, status: 'running' }`；后台执行器逐事件 `pushEvent` + `wsHub.taskEvent`；流结束 → `finish(completed)`；取消判定（`abortController.signal.aborted` 或 `cancelled`）→ `finish(cancelled)`（**AbortError 不归类 failed**）；其余异常 → `finish(failed, error)`。删除全部 SSE 代码；新增 `POST /api/llm/chat/tasks/:taskId/cancel`（HTTP 兜底，幂等，不存在 404）。
- **`server/src/index.ts`**：`app.listen` → `http.createServer(app)` + `wsHub.attach(server)` + `server.listen`。

## 前端

- **`frontend/src/canvas/llmSocket.ts`**（新增，全局单例）：原生 `WebSocket`；App 挂载即 `connect()`；断线指数退避重连（1s→15s 封顶）；连接建立/重连后**自动重订阅全部已知 taskId**（服务端回 snapshot/not-found 对齐）；`subscribe(taskId, handler)` 未连接入队，同任务多订阅方，返回退订函数；`unsubscribe(taskId)`；`cancel(taskId)`（WS 优先 + `cancelLlmTask` HTTP 兜底，404 视为已终态）；`sessions` 响应式列表（Header 徽标/面板/画布恢复消费）。
- **`frontend/src/canvas/llmEvents.ts`**（新增）：`applyLlmEvent(state, event)` 纯函数（**连接态节点与恢复态 AssetCanvas 共用同一消费器**，双路径行为严格一致、可单测；thinking 仅内部累计、snapshot 整体替换进度、finished 置终态 / not-found 静默终态）+ `createThrottledCommit`（500ms 节流 helper，两路径共用）。
- **`frontend/src/canvas/useCanvasGeneration.ts`**：新增 `beginClientRun(nodeId, lastLog?, taskId?)` / `updateClientRun` / `endClientRun` / `setLlmError` / `interruptLlm`（cancel + 3 秒收敛超时兜底）；**无持久化记录、无 restore llm 分支**（LLM 恢复由 AssetCanvas 按服务端会话列表编排）。
- **`frontend/src/canvas/useCanvasStore.ts`**：`viewOnlyUpdate(nodeId, patch)`——纯内存补丁（**不入撤销栈、不置脏、不触发保存**；流式期间下游文本消费者读取同一 store 数据实时联动）；`adoptExternalChange(nodeId, patch, newRev)`——终态视图同步（合并后端已落盘补丁 + 入撤销栈（单次撤销可回退到生成前状态）+ `savedRev` 对齐，**不触发写盘**）。
- **`frontend/src/canvas/registry.ts`**：`NodePrototype.statusOverlay?: Component`（自定义状态遮罩扩展点；未声明时 `CanvasNodeCard` 默认遮罩原样）；`text-ai` 注册 `AiTextStatusOverlay.vue`。
- **`frontend/src/components/canvas/CanvasNodeCard.vue`**：`statusOverlay` 声明时 running/error 渲染自定义组件（props `status/node/project`；emits `interrupt(nodeId)/retry(nodeId)` 一致）；body 组件透传 `isRunning`/`activeTaskId`/`runningLog`/`canvasTarget`；转发 `update:output-view` 与 `stream-state` 事件。
- **`frontend/src/components/canvas/nodes/AiTextGenerateNode.vue`**：`onGenerate` → `startLlmTask`（携带 `nodeId/label/canvas/snapshot`）→ `llmSocket.subscribe`；事件经 `applyLlmEvent`（thinking 仅展示 / 首条 text 切「正在响应…」/ 500ms 节流 `update:output-view`）；`stream-state` 上抛（进入/更新/终态 Loading）；停止 → `llmSocket.cancel` + 3 秒收敛超时兜底；卸载/切换画布**仅退订（任务继续）**；`active = generating || isRunning`（恢复态同样禁用控件、Thinking 条显示、「停止」可用）；**不再自行追加历史**（后端完成）。
- **`frontend/src/components/canvas/composables/useCanvasNodeOps.ts`**：`onInterrupt` 分流 text-ai → `gen.interruptLlm`；`generateNode` text-ai 分支防御提示（生成入口在节点内）。
- **`frontend/src/components/canvas/AssetCanvas.vue`**：`canvasTarget` 透传；`update:output-view` → `store.viewOnlyUpdate`；`stream-state` → `beginClientRun`/`adoptExternalChange`/`endClientRun`/`setLlmError`；**恢复编排** `restoreLlmSessions()`（画布加载/切换/WS 重连时按「项目 + scope」过滤 `llmSocket.sessions` → running 且 nodeId 在 nodeMap → `beginClientRun` + 恢复订阅（`subscribeRestoreTask`，与在线路径共用 `applyLlmEvent`：快照补齐 → text 节流 `viewOnlyUpdate` → 终态 `adoptExternalChange` + `endClientRun`）；`reconcileLlmRestore()` 重连对账（已订阅任务不在活跃列表 → `endClientRun`，无幽灵 Loading）；卸载 `resetLlmRestore()`。
- **`frontend/src/App.vue` + `frontend/src/components/LlmSessionsDialog.vue`**：Header 右上角图标 + `v-badge` 活跃数徽标（数据来自 `llmSocket.sessions`）+ 面板（阶段/耗时/中断/空态/完成计数提示）；App 挂载 `llmSocket.connect()`。
- **`frontend/vite.config.ts`**：代理增加 `'/llm-ws': { target: 'ws://localhost:3001', ws: true }`（生产同源无需代理）。

## 数据流要点

- **一源三出口**：上游增量 → 服务端 `pushEvent`（会话累计）+ `wsHub.taskEvent`（WS 广播给订阅者）+ 阶段信号（首次 text 切 responding，sessions 列表广播）；在线路径与恢复路径都以 `applyLlmEvent` 消费，收敛到同一终态处理（后端落盘 → finished → 前端 adopt）。
- **思考内容不写 `config.output`**：thinking 仅内存展示（Thinking 条/遮罩日志/snapshot 的 `thinking` 字段），`config.output` 只保存最终正文（终态由后端写入）。
- **终止路径**：正常完成 → 后端写 `output` + 追加历史 → finished(completed) → `adoptExternalChange`（单次撤销可回退）+ `endClientRun`；停止/中断 → cancel → 后端写部分输出（无历史）→ finished(cancelled) → 静默收敛；上游异常 → 后端写已累计文本（若有）→ finished(failed) → 红字提示；刷新/切换 → 仅退订，服务端继续；服务重启 → 注册表空 → 无幽灵 Loading（未终态部分输出丢失为预期取舍）。
- **竞态兜底**：生成中再点生成 `active` 双守卫 + 服务端同节点单飞；多页签同画布同 taskId 多订阅广播同步、历史由后端单写者无重复；订阅时会话刚结束 → not-found（仅结束 Loading，结果已在文件）；节点删除后终态到达 → 后端跳过写盘、前端仅移除 running 标记；WS 瞬时不可用 → 自动重连 + 重订阅快照补齐 + 重连对账，停止走 HTTP 兜底；终态写盘 CAS 冲突 → 重试 ≤3 次，仍失败标 failed + 广播 + 日志。
