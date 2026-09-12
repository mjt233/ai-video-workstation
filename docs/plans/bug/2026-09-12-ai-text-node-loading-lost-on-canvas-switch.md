# Bug 排查：AI 文本节点 Loading 在切换分镜画布后丢失

> 日期：2026-09-12
> 状态：**已修复**（两个根因）；验证见「四、验证」
> 现象报告：资产画布 AI 文本生成节点点击「生成」后节点进入 Loading（Thinking…）；切到其他分镜画布再切回来，Loading 丢失（可再次点生成、停止按钮置灰）；刷新页面 Loading 才恢复；切走再切回又丢失。

## 一、结论（两个根因叠加）

| # | 根因 | 现象贡献 |
|---|------|----------|
| 1 | `AssetCanvas.applySwitch()` 与 `scheduleFitCanvas()` **共用世代号 `fitViewSeq`**，而切换流程中途调用了 `scheduleFitCanvas()`（自增该号），导致收尾处 `if (!disposed && seq === fitViewSeq) restoreLlmSessions()` **恒不成立** | 切回画布时 LLM 会话的 Loading 恢复**从未执行** |
| 2 | `llmRestore`（恢复订阅表）**跨画布切换未清空**：本组件跨分镜切换不卸载，而 `gen.switchTarget()` 只重置 `statusByNode`；留在表里的旧条目让恢复前的守卫 `if (llmRestore.has(s.taskId)) continue` 成立 | 即使恢复被调用，也会被「已订阅 → 跳过」挡掉，Loading 仍不出现 |

刷新页面能恢复，是因为 `onMounted` 里另有一处不带世代号守卫、且 `llmRestore` 为空的 `restoreLlmSessions()` 调用。

## 二、证据链（浏览器实测，临时项目）

复现步骤（临时项目，分镜 1 / 分镜 2 各一个 AI 文本节点）：分镜 1 点「生成」→ Thinking → 切分镜 2 → 切回分镜 1 → Loading 丢失；服务端 `GET /api/tasks` 全程 `status: running`（任务未结束、project/canvas/nodeId 均匹配）。

### 根因 1

```
[DBG-applySwitch] start                   {"prevSeq":4}
[DBG-applySwitch] after gen.switchTarget  {"seq":4,"fitViewSeq":4}      ← 守卫还能过
[DBG-applySwitch] after store.switchTarget{"seq":4,"fitViewSeq":4}
[DBG-applySwitch] before refreshNodeOutputs{"seq":4,"fitViewSeq":5}     ← 被自己的 scheduleFitCanvas 顶掉
（没有任何 [DBG-restoreLlmSessions] —— restoreLlmSessions 根本没被调用）
```

对照：同一条任务下**刷新页面**时 `[DBG-restoreLlmSessions] target={episode:1,shot:1}` 正常打印并恢复 Thinking。

| 行（修复前） | 代码 | 说明 |
|----|------|------|
| `applySwitch` 开头 | `const seq = ++fitViewSeq` | 切换流程借用视口世代号 |
| 两处守卫 | `if (disposed \|\| seq !== fitViewSeq) return` | 此时尚能通过 |
| 其后 | `void gen.restore(...)` | ffmpeg / 工作流任务恢复在守卫之前，**不受影响** ⇒ 只有 LLM 节点丢 Loading |
| 收尾前 | `scheduleFitCanvas()` → `++fitViewSeq` | **自己把共用的号 +1** |
| 收尾 | `if (!disposed && seq === fitViewSeq) restoreLlmSessions()` | 4 !== 5 ⇒ 永不执行 |

### 根因 2

根因 1 修好后 `restoreLlmSessions()` 已被调用、会话与画布 scope 全部匹配，但节点依旧无 Loading：

```
[DBG2-restore] entered {...target={episode:1,shot:1}, nodeIds=[790e19cf…], statusByNode={}}
[DBG2-loop]  {"status":"running","projectOk":true,"sameTarget":true,"nodeFound":true,"proto":"text-ai","statusTaskId":null,"hasRestore":true}
[DBG3] skip by llmRestore {"entry":{"nodeId":"790e19cf…"}}
```

`statusByNode` 为空（切画布已被 `gen.switchTarget → reset()` 清掉）而 `llmRestore` 仍持有该会话条目 ⇒ 被 `continue` 跳过，**既不重建 Loading 也不重新订阅**。

## 三、修复

1. **拆分世代号**：新增 `frontend/src/canvas/switchGuard.ts`（`createSwitchGuard()`：`beginSwitch/isCurrentSwitch` 与 `beginFit/isCurrentFit` 各自独立计数），`AssetCanvas` 改用它——`applySwitch` 用切换世代号，`scheduleFitCanvas`/`fitCanvasToNodes`/ResizeObserver 用视口世代号。
2. **切换时清空恢复订阅表**：`applySwitch` 开头调用 `resetLlmRestore()`（与 `onUnmounted` 已有的清理同一入口），保证恢复订阅与 `statusByNode` 的「按画布隔离」一致；切换后仍由服务端会话列表按 scope 重建订阅。
3. **收尾恢复只受切换世代号约束**：`if (!disposed && guard.isCurrentSwitch(seq)) restoreLlmSessions()`，视口适应世代号不得参与该判断。
4. **回归测试**：`frontend/src/canvas/switchGuard.test.ts` 锁死不变式——视口世代号推进不得使切换守卫失效、两类世代号不串号、连续切换只保留最新一次。

## 四、验证（临时项目 + 真实 LLM 调用）

| 检查项 | 结果 |
|--------|------|
| 生成中切到分镜 2 | 分镜 2 无 Thinking（正确，任务属于分镜 1） |
| 切回分镜 1（1.5s 后） | **Thinking… 保持** |
| 停留 +2s / +4s | Thinking… 保持（服务端仍 `running/thinking`） |
| 连续两次往返（1→2→1→2→1） | Thinking… 保持 |
| 点「停止」收敛 | 任务消失、Loading 结束、响应区显示后端落盘的部分输出（3154 字） |
| adopt 后 `savedRev` 对齐 | 停止后编辑响应区 → 自动保存成功（版本 6 → 7），**无版本冲突横幅** |
| 回归 | `npm run typecheck`、`npm run lint` 无错误；`vitest` 45 文件 / 828 用例全绿（含新增 8 例） |

## 五、涉及文件

| 文件 | 角色 |
|------|------|
| `frontend/src/components/canvas/AssetCanvas.vue` | 两个根因所在：`applySwitch` 世代号 + `llmRestore` 未清空 |
| `frontend/src/canvas/switchGuard.ts`（新增） | 切换 / 视口两个独立世代号（可单测） |
| `frontend/src/canvas/switchGuard.test.ts`（新增） | 回归测试（8 例） |
| `docs/canvas/target-switching.md`、`docs/canvas/task-architecture.md` | 不变式与常见坑补充 |
