# Bug 排查：AI 文本生成节点完成后卡 Thinking、停止按钮不收敛

> 日期：2026-09-09
> 状态：已定位根因，**未修复**（本文档仅记录排查结论与修复方案）
> 现象报告：资产画布 AI 文本生成节点中，AI 响应已完成、任务管理器任务列表也及时清空，但节点依然显示 Thinking、停止按钮依旧可用；刷新页面或重新加载画布后状态才正常。

## 一、现象拆解

| 观察到的现象 | 说明 |
| --- | --- |
| AI 响应正常流式输出并完成 | thinking / text 增量走 WS per-task 订阅通道，不受影响 |
| 任务管理器任务列表及时清空 | 统一任务注册表 `finish()` 正常执行，`task-update` / `tasks` 广播正常 |
| 节点永远显示 Thinking、停止按钮可点 | 节点收不到 `finished` 终态事件 → `settle()` 不执行 → 本地 `generating` 卡在 true；`active = generating || props.isRunning` 恒真 |
| 刷新页面 / 重新加载画布后正常 | 本地状态清零；服务端会话已终态，恢复循环无活跃会话可恢复 |
| （隐藏）此时点「停止」反而能恢复 | cancel 打到已结束任务 → 服务端回 `not-found` → 节点按 cancelled 收敛（副作用：输出被标记为 cancelled 语义，但后端已 completed 落盘，无数据损坏） |

## 二、根因：服务端 `finished` 终态广播从未发出（时序回归）

### 证据链

1. **会话终态收敛顺序错误**（`server/src/llm/session-manager.ts` `finish()`）：

   ```ts
   this.sessions.delete(taskId);            // ① 先把会话移出活跃区
   this.emit({ type: 'finish', session: s }); // ② 会话事件（生产代码无监听者）
   // 注释声称「在 emit 之后调用，保证终态广播（task-ws 读会话快照）时会话仍在活跃区」
   s.lifecycle?.onFinish?.(effective);        // ③ 之后才通知统一任务注册表
   ```

   L354 注释与实现矛盾：会话在 ③ 之前两行已被 ① 删除。

2. **终态广播依赖活跃区反查**（`server/src/tasks/task-ws.ts`）：

   注册表 `finish` 事件触发 `onTaskEvent` → `finishedInfoOf(task)` → `llmSessionLookup(t.id)`。而 `llmSessionLookup` 由 `tasks/llm-executor.ts` 注入的实现为 `sessionManager.get(taskId)` —— **只查活跃区**。会话已删 → 返回 `undefined` → `finishedInfoOf` 返回 `null` → `broadcastFinished` 被跳过。

   结论：**每一次 LLM 会话终态，`finished` 全局广播都不会发出**（100% 必现）。

3. **回归来源**：提交 `5bc139b`（统一异步任务架构）。

   - 旧版（`1b0738c`）：wsHub 经 `sessionManager.on()` 订阅会话事件，监听器直接拿到 session 对象广播，不依赖活跃区查找，`delete` 在前无碍；
   - 新版：广播改由 `taskRegistry.finish` 事件驱动，需要经 `llmSessionLookup` 反查会话；`sessionManager.on()` 在生产代码中已无人使用（仅测试引用），时序耦合断裂。

### 前端为何卡死（在线路径无对账兜底）

- **在线路径**（画布内点击生成）：节点订阅 per-task 事件，等 `finished` / `not-found` 收敛（`AiTextGenerateNode.vue` `settle()`）。`finished` 永不到达； spontaneous `not-found` 也不会出现 → 永久卡死。
- **恢复路径**（生成中刷新页面）：`AssetCanvas.vue` 的 `reconcileLlmRestore()` 会在终态后随 sessions 变更自愈结束 Loading —— 所以「生成中刷新」的观感是正常的，掩盖了问题。
- **全局 finished 监听**（`AssetCanvas.vue` `onFinished`）按设计只做视图 adopt（补丁/rev 对齐），不负责结束 Loading —— 职责划分正确，不能靠它兜底。

### 次要影响

- 生成中刷新页面的恢复路径：因 `finished` 缺失，终态时前端拿不到 `persistPatch / rev`，视图**不会 adopt** 后端已落盘的 `output / outputHistory`（Loading 能靠对账结束，但需再刷新一次才能看到落盘结果）。

## 三、修复方案（未实施）

### 1. 根因修复（服务端，必做）

调整 `session-manager.ts` `finish()` 收敛顺序：**先通知注册表（触发终态广播），再移出活跃区**：

```ts
// 修复后顺序：
s.lifecycle?.onFinish?.(effective);   // ① taskRegistry.finish → task-ws 广播时会话仍在活跃区（persistPatch/rev 已就绪）
this.sessions.delete(taskId);          // ② 再移出活跃区
this.emit({ type: 'finish', session: s });
```

要点：

- `onFinish` → `taskRegistry.finish` → task-ws `finishedInfoOf` → `broadcastFinished` 是同步调用链（Node 单线程、链内无 await），广播读取会话时不存在并发插队窗口；
- 广播载荷 `persistPatch / persistRev / persistPrevRev` 在 persister 完成后即已写入会话对象，不受顺序调整影响；
- 同步修正 L354 错误注释；
- 回归测试：`task-ws.test.ts` 补「会话 finish 后客户端能收到 finished 广播（含 output/outputHistory/rev/prevRev）」用例。

### 2. 前端加固（防御同类终态事件丢失，建议一并做）

1. **节点 snapshot 终态处理**（`AiTextGenerateNode.vue` `case 'snapshot'` + `llmEvents.ts` `applyLlmEvent` snapshot 分支）：
   快照携带 `session.status`，当 `status !== 'running'` 时应按终态收敛（结束本地 generating、通知父级 endClientRun、退订），而不是更新文本后继续维持运行态（现状甚至可能对已完成会话重发 `stream-state running:true`，固化 Loading）。
2. **在线路径对账兜底**（`AssetCanvas.vue`）：
   `reconcileLlmRestore()` 只清理恢复订阅条目（`llmRestore`）；在线发起路径（`statusByNode` 中带 taskId 的 llm running 条目）没有任何对账。建议在 sessions watch 对账逻辑中，将「llm running 条目的 taskId 已不在服务端活跃列表」也收敛为 `endClientRun`（仅限 type=llm，不影响 ffmpeg/工作流自身的进度与终态机制）。任何未来的终态事件丢失都能在一个广播周期内自愈，杜绝幽灵 Loading。

## 四、涉及文件

| 文件 | 角色 |
| --- | --- |
| `server/src/llm/session-manager.ts` | 根因：`finish()` 收敛顺序（delete 先于注册表通知） |
| `server/src/tasks/llm-executor.ts` | 注入 `llmSessionLookup = sessionManager.get`（仅活跃区） |
| `server/src/tasks/task-ws.ts` | `finishedInfoOf` 反查失败 → 静默跳过 `broadcastFinished` |
| `frontend/src/components/canvas/nodes/AiTextGenerateNode.vue` | 在线路径订阅与 `settle()` 收敛；snapshot 分支隐患 |
| `frontend/src/components/canvas/AssetCanvas.vue` | 恢复路径 + `reconcileLlmRestore`（在线路径无对账） |
| `frontend/src/canvas/taskSocket.ts` | 统一任务 WS 客户端（finished 全局监听 + per-task 分发） |
