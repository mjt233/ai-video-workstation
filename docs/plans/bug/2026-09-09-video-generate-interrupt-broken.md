# Bug 排查：生成视频节点无法中断（任务管理器按钮禁用、节点中断无效）

> 日期：2026-09-09
> 状态：已定位根因，**未修复**（本文档仅记录排查结论与修复方案）
> 现象报告：生成视频节点开始执行生成后——
> 1. 任务管理器中的中断按钮是禁用的，提示「任务尚未提交到远端，无法中断」（实际任务已提交到远端）；
> 2. 节点的中断按钮是可用的，但点击后任务不能正常中断。

## 一、根因总览

**统一任务注册表中工作流任务的 `cancelable` 在登记时被判定为 false，此后从不重算。**

- 引擎领取任务时先把 SQLite 置 `running`，再进入 `runTask` 登记 → 登记瞬间远端必然尚未提交 → 判定「不可中断」；
- 远端提交成功后，引擎只把 `remoteTaskId` 写进 SQLite，**从未调用 `workflowExecutor.update()`** 同步注册表 → 注册表永远停留在「尚未提交到远端，不可中断」；
- `workflowExecutor.update()` 自身还有一个隐藏缺陷：仅在 `patch.status` 存在时才重算可中断性，且重算时 `remoteTaskId` 只用入参、不回退 SQLite —— 即使未来补调用也容易踩坑。

由此产生两个用户可见症状 + 一个次生假状态：

| 症状 | 链路 |
| --- | --- |
| 任务管理器中断按钮禁用 + 「任务尚未提交到远端」提示 | 注册表 `TaskInfo.cancelable=false` + `cancelBlockReason`（实际远端早已提交，状态陈旧） |
| 节点中断按钮可点但任务不中断 | 节点遮罩按钮不感知 cancelable → 点击发出 HTTP cancel → 服务端 `taskRegistry.cancel` 以 `cancelable=false` 拒绝（404 NOT_CANCELABLE）→ 前端 catch 静默吞掉 |
| 次生：节点显示「已中断」但任务仍在跑 | `gen.interrupt` 在发请求**之前**就停轮询并乐观置「已中断」，cancel 被拒后不回滚 |

## 二、证据链（服务端）

### 1. 登记时必然判定为不可中断

引擎主循环领取任务（`server/src/workflow-engine.ts` L1051-1053 / L1096-1098）：

```ts
if (task.status === 'pending') {
  db.updateTaskStatus(task.id, 'running');   // ① 先置 running
  runTask(task.id).catch(...);                // ② 再执行
```

`runTask` 内登记统一注册表（`workflow-engine.ts` L614）→ `workflow-executor.ts` `create()`：

```ts
const record = db.getTask(input.taskId);                        // status 已是 'running'
const remoteTaskId = record ? parseTaskParams(record.params).remoteTaskId : undefined;  // 尚未提交 → undefined
const cancelability = workflowCancelability(..., 'running', undefined);
```

`workflowCancelability`（`workflow-executor.ts` L47-68）：视频生成工作流（如 `image-to-video/minimax-h3-*`）声明 `cancelable: true` 但**非** `deferredCancel`（Bridge 类远端任务），于是命中：

```ts
if (!remoteTaskId && !wf?.capabilities?.deferredCancel) {
  return { cancelable: false, reason: '任务尚未提交到远端，无法中断' };   // ← 禁用提示来源
}
```

### 2. 远端提交成功后注册表永不重算

`workflow-engine.ts` 提交远端（L923-933）：

```ts
const { taskId: remoteTaskId } = await wf.submit(runContext);   // 提交远端成功
db.updateTaskParams(taskId, { ...latestParams, remoteTaskId });  // 只写 SQLite
db.addLog(taskId, 'info', `Submitted, remote task ID: ${remoteTaskId}`);
```

**全文件检索证实 `workflowExecutor.update` 无任何调用方**（只有 `create` L614 与 `finish` L1009/L1021）。注册表中的 `cancelable=false` + `cancelBlockReason` 一直保持到 `finish`。

### 3. 中断请求被服务端拒绝

节点中断链路：节点卡片默认 running 遮罩「中断」按钮（`CanvasNodeCard.vue` L101-108，`video-generate` 原型无自定义 `statusOverlay`）或 `VideoGenerateEditor.vue` 的「中断」按钮 → `AssetCanvas onInterrupt` → `useCanvasNodeOps.onInterrupt` → `gen.interrupt(nodeId)`：

```ts
// useCanvasGeneration.ts interrupt()
...
statusByNode.value[nodeId] = { status: 'error', errorMsg: '已中断', ... };  // ① 乐观置已中断
delete taskIdByNode.value[nodeId];
if (!taskId) return;
try {
  await cancelTask(taskId);            // ② POST /api/tasks/:id/cancel
} catch {
  // cancel 失败不阻断状态展示（后端任务可能已结束）   ← ③ 404 被静默吞掉
}
```

服务端 `tasks/routes.ts`：`taskRegistry.cancel(taskId)` → `t.cancelable === false` → `{ ok:false, reason: cancelBlockReason }` → **404 NOT_CANCELABLE**。

即：节点中断按钮**实际发出了请求，但被服务端以「任务尚未提交到远端」拒绝**，前端静默吞掉、无任何反馈；加上 ① 已提前停轮询并置「已中断」，节点永远停在错误态而任务继续执行——用户看到的「并未发起中断 / 不能中断」即此。

> 时序变体：若在 `runWorkflow` HTTP 尚未 resolve 时点击中断，`taskIdByNode` 为空 → `interrupt` 直接本地置「已中断」并 return，此时确实未发任何请求。两种子路径都源于同一根因。

### 4. `update()` 的隐藏缺陷（修复时必须一并处理）

`workflow-executor.ts` `update()`（L164-183）：

```ts
if (typeof wf === 'string' && typeof impl === 'string' && patch.status) {   // ← 仅 patch.status 存在才重算
  const c = workflowCancelability(wf, impl, patch.status, patch.remoteTaskId);
  ...
}
```

- 若引擎补调 `update({ remoteTaskId })`（不带 status）→ **不重算**，修复无效；
- 若补调 `update({ status: 'running' })`（不带 remoteTaskId）→ 用 `remoteTaskId=undefined` 重算 → **把已提交远端的任务又算回不可中断**。

## 三、影响面

- 所有**非 deferredCancel** 的远端类工作流任务（Bridge 类图生视频、文生图等）在统一注册表中全程不可中断；
- deferredCancel 类（seedream、openai-compatible-sync 等同步执行实现）不受影响（登记时即判定可中断）；
- 用户中断只能等任务自行结束；中断失败无任何 UI 反馈（违反「捕获异常不得静默」的体验要求，现有 catch 仅有注释无用户告知）；
- ffmpeg 任务不受影响（`trackFfmpegTask` 登记时 `cancelable` 默认 true）。

## 四、修复方案（未实施）

### 1. 根因修复（服务端，必做）

1. **引擎同步 remoteTaskId 到注册表**：`workflow-engine.ts` 提交远端成功、`db.updateTaskParams` 写入 SQLite 后，调用 `workflowExecutor.update(taskId, { remoteTaskId })`。
2. **修正 `workflowExecutor.update()` 重算逻辑**：
   - 触发条件放宽为「`patch.status` 存在 **或** `patch.remoteTaskId !== undefined`」；
   - 重算入参回退：`status = patch.status ?? record.status`；`remoteTaskId = patch.remoteTaskId ?? (从 SQLite task.params 回读)`——保证任何单一字段的更新都不会把可中断性算错；
3. 回归测试：`workflow-executor.test.ts` 补「create(running、无 remoteTaskId) → cancelable=false → update(remoteTaskId) → cancelable=true 且 reason 清空」用例。

### 2. 前端加固（建议）

1. **`gen.interrupt` 乐观 UI 修正**（`useCanvasGeneration.ts`）：
   - 不在请求发出前停轮询 / 置「已中断」；改为 cancel 受理成功后再收敛状态；
   - cancel 失败（404 NOT_CANCELABLE 等）时保持 running 态并以 snackbar 告知用户原因（同时满足「捕获异常必须告知」的工作区规范），任务继续正常轮询到终态。
2. **（可选）节点中断入口感知可中断性**：`GenerateStatus` 增加来自 task-update 广播的 `cancelable / cancelBlockReason` 镜像，节点遮罩「中断」按钮与任务管理器一致禁用 + tooltip 说明，消除两处入口状态不一致。

## 五、涉及文件

| 文件 | 角色 |
| --- | --- |
| `server/src/workflow-engine.ts` | L1052/L1097 领取即置 running；L614 登记时机；L923-933 提交远端后未同步注册表 |
| `server/src/tasks/workflow-executor.ts` | `workflowCancelability` 判定；`create` 登记；`update` 重算缺陷（无调用方 + 条件缺陷） |
| `server/src/tasks/registry.ts` | `cancel()` 按 `cancelable` 拒绝 |
| `server/src/tasks/routes.ts` | HTTP cancel 路由（拒绝时 404 NOT_CANCELABLE） |
| `frontend/src/canvas/useCanvasGeneration.ts` | `interrupt()` 乐观置「已中断」+ 静默吞 404；视频分支 `taskIdByNode` 写入时机 |
| `frontend/src/components/canvas/CanvasNodeCard.vue` | 默认 running 遮罩「中断」按钮（不感知 cancelable） |
| `frontend/src/components/canvas/editors/VideoGenerateEditor.vue` | 编辑面板「中断」按钮（同一链路） |
