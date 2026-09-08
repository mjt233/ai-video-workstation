# 修复：AI文本生成节点跨刷新恢复后终态导致画布版本冲突

## 摘要

AI 文本生成节点进入 loading 后刷新页面，等待执行完成后再编辑画布，自动保存报「画布版本冲突」。根因：服务端 `finish` 时**先**广播 sessions 列表（会话已移除）、**后**发送 finished 终态事件（仅发给订阅者），恢复路径（AssetCanvas）收到 sessions 列表即对账退订，导致携带版本号的 finished 事件无人消费，`savedRev` 不对齐 → 下次编辑 409。

按用户建议采用更简单的方案：**终态落盘完成后向所有已连接客户端全局广播「执行完成通知」，携带落盘前后版本号（prevRev/rev）与实际写入的节点补丁；前端若当前 `savedRev === prevRev`，则只单独更新该 AI 文本节点的数据并把 `savedRev` 对齐为 `rev`**。终态投递与「按任务订阅」彻底解耦，不依赖订阅时序，也无需 not-found 重读兜底。

## 根因分析（时序）

服务端 `sessionManager.finish()`（[session-manager.ts](file:///c:/Users/xiaotao/code/ai-video-workstation/server/src/llm/session-manager.ts)）先落盘（CAS，rev R→R+1）→ 会话移出注册表 → `emit('finish')`；wsHub finish 分支（[session-ws.ts#L110-L127](file:///c:/Users/xiaotao/code/ai-video-workstation/server/src/llm/session-ws.ts#L110-L127)）按此顺序发消息：

1. `broadcastSessions()`（列表**不含**该任务）→ 客户端恢复路径 `reconcileLlmRestore()`：任务不在活跃列表 → `endClientRun` + **退订** + 删除恢复条目（[AssetCanvas.vue#L1041-L1052](file:///c:/Users/xiaotao/code/ai-video-workstation/frontend/src/components/canvas/AssetCanvas.vue#L1041-L1052)），**未 adopt**，`savedRev` 仍为 R；
2. `taskEvent(taskId, finished)`（含 rev=R+1，仅订阅者）→ 处理器已被移除 → 事件丢弃。

结果 `savedRev=R` vs 服务端 R+1，用户编辑 → 自动保存 409 → 冲突弹窗、自动保存停止。不刷新时在线路径（`AiTextGenerateNode` 自身订阅）不受 `reconcileLlmRestore` 影响，故仅刷新后必现。

## 修改方案

### 1. 服务端：落盘结果带 prevRev，finished 改为全局广播

- **`server/src/llm/result-persist.ts`**：`LlmPersistResult` 增加 `prevRev?: number`（写入前读到的画布 rev；`wrote=true` 时返回）。`persistLlmResult` 在 CAS 成功分支返回 `{ wrote: true, rev, prevRev, patch }`。
- **`server/src/llm/session-manager.ts`**：`LlmSession` 增加 `persistPrevRev?: number`；`finish()` 落盘成功后记录。
- **`server/src/llm/session-ws.ts`**（`onSessionEvent` finish 分支）：
  - `LlmFinishedInfo` 增加 `project: string`、`canvas: CanvasDefTarget`、`prevRev?: number`（取自会话）；
  - finished 由「仅发订阅者」（`taskEvent`）改为**广播给全部已连接客户端**（新增 `broadcastFinished`，消息仍为 `{ type:'finished', taskId, info }`）；
  - 发送顺序：先 finished、后 sessions 列表（全局广播下顺序已不影响正确性，仅让「输出先更新、Loading 后结束」视觉更自然）。

### 2. 前端：全局完成通知监听 + savedRev 对齐

- **`frontend/src/canvas/llmSocket.ts`**：
  - `LlmFinishedInfo` 增加 `project`、`canvas`、`prevRev?` 字段（与服务端对齐）；
  - 新增全局终态监听 `onFinished(listener): () => void`（Set 存储）；`onMessage` 收到 `finished` 时：先按现有 `dispatch` 分发给该 taskId 的订阅处理器（在线节点 settle 流程不变），再通知全部全局监听器。
- **`frontend/src/canvas/llmEvents.ts`**：
  - 把 `sameCanvasTarget` 从 AssetCanvas 迁出为导出纯函数（恢复路径与全局通知共用）；
  - 新增纯函数 `buildLlmFinishedAdopt(info, project, target, savedRev)`：校验 `info.project === project`、`sameCanvasTarget(info.canvas, target)`、`prevRev/rev` 均为数字且 **`savedRev === info.prevRev`**（即用户提出的「前端当前版本号 = 落盘前版本号」），并提取实际落盘补丁 `{ output?, outputHistory? }`；任一不满足返回 null。
- **`frontend/src/components/canvas/AssetCanvas.vue`**：
  - 注册全局监听（onMounted 注册、onUnmounted 退订）：`buildLlmFinishedAdopt(store.savedRev.value, …)` 非空且 `nodeMap` 中该节点存在且为 `text-ai` → `adoptLlmResult(nodeId, patch, rev)`（现有入口：入撤销栈 + `savedRev = rev` + 仅合并该节点 config，**不触发写盘**；按 rev 幂等，与在线/恢复路径双投递天然去重）；
  - 守卫：`store.loaded` 为假（切换画布进行中）时跳过；
  - `onRestoreTaskEvent` 内的补丁提取逻辑抽为共用小函数（与全局通知一致），其余恢复订阅/对账流程不变（对账仍负责结束 Loading 与清理）。

### 3. 测试

- **`server/src/llm/result-persist.test.ts`**：新增/补充断言——写入成功返回 `prevRev`（= 写入前文件 rev）与 `rev`（= prevRev + 1）。
- **`server/src/llm/session-ws.test.ts`**：
  - finish 后**未订阅**的第二个客户端也能收到 finished（全局广播），载荷含 `prevRev/rev/project/canvas`；
  - 顺序断言：`finished` 消息下标早于「不含该任务的 sessions」消息下标（防回归）；
  - 既有用例（订阅者收到 finished、sessions 移除等）保持通过。
- **`frontend/src/canvas/llmEvents.test.ts`**：新增 `buildLlmFinishedAdopt` 用例——`savedRev === prevRev` 且补丁存在 → 返回；版本号不匹配 / prevRev 缺失 / 项目或画布不符 / 无 output 且无 outputHistory → null。
- 前端 `llmSocket.test.ts` / `llmEvents.test.ts` 既有夹具若构造了 finished info，补齐新增字段。

### 4. 文档同步

**`docs/asset-canvas.md`** §14.2 / §14.4：
- session-ws 条目更新为「finish 先全局广播 finished（含 project/canvas/prevRev/rev 与落盘补丁，订阅与否均可收），再广播 sessions 列表」；
- 竞态兜底补充：「前端按 `savedRev === prevRev` 采纳终态补丁并对齐 savedRev（`buildLlmFinishedAdopt`），终态投递不再依赖按任务订阅，恢复路径对账退订不会丢失版本对齐」。

## 假设与决策

- **finished 改全局广播是本方案核心**：终态对齐不再依赖「订阅处理器存活」，从根上消除「sessions 先到 → 对账退订 → finished 丢失」的时序耦合；在线节点路径（settle 展示）仍走原 taskId 处理器，行为不变。
- **`savedRev === prevRev` 严格相等才采纳**（用户方案）：客户端已跟上所有外部写入时精确对齐；若不匹配（如有其他页签写入），本端数据整体过期，维持现状走既有冲突弹窗（备份/强制覆盖/重新加载），不做部分合并，避免静默覆盖他人修改。
- **不做 not-found 重读兜底**：全局广播已覆盖绝大多数时序（含刷新后订阅晚于完成）；仅剩「WS 断连恰好横跨完成广播」的罕见窗口由冲突弹窗兜底，符合简化目标。
- 双投递去重：在线路径（stream-state adopt）与全局通知可能先后采纳同一 rev，沿用现有 `adoptedLlmRevByNode` 按 rev 幂等。

## 验证

1. `cd server && npm test`、`cd frontend && npm test`。
2. `npm run typecheck`、`npm run lint`（仓库强制约束）。
3. 浏览器手工验证（`npm run dev`，需已配置 LLM 服务商）：
   - 复现路径：AI 文本节点「生成」→ loading → 刷新页面 → loading 恢复 → 等待完成 → 节点显示最终正文 → 编辑画布（移动节点/改提示词）→ **不再出现**版本冲突，自动保存正常；
   - 回归：不刷新的常规生成→完成→编辑；生成中「停止」（部分输出仍落盘、无冲突）；两个 AI 文本节点先后完成后编辑；双页签同画布各编辑一次。
