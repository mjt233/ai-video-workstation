# 任务生命周期（lifecycle）

> 返回 [任务管理总览](../task-manager.md)

从**创建**到**终态收敛**的完整链路：创建入口 → 引擎领取 → 执行 → 中断 → 重启恢复 → 前端刷新恢复。字段与表结构见 [data-model.md](./data-model.md)，执行器内部实现见 [execution.md](./execution.md)，WS 协议见 [events.md](./events.md)，接口清单见 [api.md](./api.md)。

## 〇、全链路一览（纯文本流程）

```
【工作流任务 workflow】
  POST /api/workflow/run（或 /api/workflow/batch-run）
    └─▶ INSERT tasks(status = pending[, batch_id, phase])
          └─▶ startEngine(): tick() 每 2s
                ├─ getPendingTasks(): status ∈ {pending, running}，ORDER BY phase, created_at
                ├─ 分组：有 batch_id → 按 phase + 并发上限；无 → 无并发上限
                └─ db.updateTaskStatus(id, 'running') → runTask(id)
                      └─▶ 登记注册表(workflow) → submit 远端 → remoteTaskId 落库
                            └─▶ 2s 轮询（变化才记 + 心跳）→ 取消标记检查
                                  └─▶ 归档旧产物 → 写 assert/ → completed ｜ failed

【ffmpeg 任务 ffmpeg】
  POST /api/canvas/{concat-video, trim-video, trim-audio, extract-frame}
    └─▶ buildXxxCommand() → startFfmpegTask() → 注册表 register（登记即 running）
          └─▶ spawn ffmpeg → -progress → progress 0~99
                └─▶ completed ｜ failed ｜ cancelled（SIGKILL + 删半截产物）

【LLM 会话 llm】
  POST /api/llm/chat（会话 id == 任务 id）
    └─▶ sessionManager.begin() + llmExecutor.create()
          └─▶ 上游流式请求 → thinking → responding（pushEvent 累加 + 按任务订阅推送）
                └─▶ finish()：先落盘 canvas.json（config.output / outputHistory）→ 再移除会话
                      └─▶ completed ｜ failed ｜ cancelled

                        ↓ 三类任务的注册表事件统一汇入
  /llm-ws 广播：task-update（增量）+ tasks（全量活跃列表）
                        ↓
  画布收敛：workflow → 轮询 GET /api/workflow/tasks/:id ｜ ffmpeg → task-update ｜ llm → finished
```

## 一、创建（四条入口）

| 入口 | 类型 | 立即返回 | 落库 | 登记注册表 |
|------|------|----------|------|------------|
| `POST /api/workflow/run` | `workflow` | `{taskId, status:'pending'}` | ✅ `tasks`（`batch_id = null`、`phase = 0`） | 引擎开始执行时 |
| `POST /api/workflow/batch-run` | `workflow` × N | `{batchId, totalTasks, project}` | ✅ 每个任务一行（带 `batch_id` + `phase`） | 同上（逐个） |
| `POST /api/canvas/concat-video` / `trim-video` / `trim-audio` / `extract-frame` | `ffmpeg` | `{taskId, status:'running'}` | ❌ | 路由登记后立即执行 |
| `POST /api/llm/chat` | `llm` | `{taskId, status:'running'}` | ❌ | 会话创建后立即登记 |

### 1.1 单任务：`POST /api/workflow/run`

| 步骤 | 代码 | 失败响应 |
|------|------|----------|
| 必填校验 | `project` / `workflowId` / `params.outputPath` | 400 `Missing required fields: ...` |
| 实现校验 | `validateWorkflowImpl(workflowId, impl)` —— **不兜底**，必须显式指定已注册且已绑定服务商实例的实现 | 400 `workflow_impl_required` / `workflow_impl_not_found` |
| 用户参数规范化 | `normalizeUserParams(implDef.params, params.userParams)`（仅保留实现声明的 key，按声明类型转原生值） | — |
| Bridge 实例提取 | `extractComfyuiProviderId()`（仅 `provider === 'comfyui-bridge'`，独立存 `params.comfyuiProviderId`，不混入 `vars`） | — |
| 入库 | `buildRunTaskParams()` → `db.createTask({id: uuidv4(), status 默认 pending, params})`；`buildRunTaskParams` 末尾 `parseTaskTarget(params)` 把 `nodeId` / `canvas` 一并持久化 | — |
| 日志 | `db.addLog(taskId, 'info', 'Task created: {workflowId}/{impl}')` | — |

任务创建后**只入库、不执行**：执行权在引擎（服务进程独立于请求）。

### 1.2 批量：`POST /api/workflow/batch-run`

| 步骤 | 说明 |
|------|------|
| 发现 | `discoverTasks(project, assetTypes, overwrite ?? false, implByAssetType)`；`overwrite=false` 时跳过已有产物的资产。结果为 0 时返回 `{batchId: null, totalTasks: 0, project}`，**不建空批次** |
| 全量实现校验 | `validateDiscoveredImpls()`：任一任务缺失/非法实现即整体 400 `workflow_impl_required`（不创建半截批次） |
| 阶段映射 | 请求体无 `phase`，由 `ASSET_PHASE` 决定（见下表） |
| 入库 | 每任务 `db.createTask({id: uuidv4(), batch_id: batchId, phase})`；`params` 只含 `vars` / `promptPaths` / `outputPath` / 可选 `sizeConfig` / 可选 `comfyuiProviderId`——**不含 `nodeId` / `canvas`**（批量任务不参与画布恢复） |
| 并发配置 | `effectiveConcurrency = clamp(floor(concurrency ?? 1), 1, 10)`，存 `storeBatchConfig(batchId, n)` 的**内存 Map**（`batchConcurrencyMap`），服务重启后退回默认 1 |
| 查询 | `GET /api/workflow/batch/:batchId` → `db.getBatchSummary(batchId)`（`total/completed/failed/running/pending`） |

| 资产类型 | `phase` | 依赖关系 |
|----------|---------|----------|
| `character-appearance` / `character-voice` / `stage-image` | 0 | 无依赖 |
| `variant-edit` / `scene-stage-image` / `scene-tts` | 1 | 依赖 phase 0 产出 |
| `video-generate` | 2 | 依赖 phase 1 产出 |
| 未知 `assetType` | 0 | `ASSET_PHASE[assetType] ?? 0` |

### 1.3 ffmpeg 任务（四个本地接口）

| 接口 | `label` | 关键请求体 |
|------|---------|-----------|
| `POST /api/canvas/concat-video` | `拼接视频` | `videoPaths[]`、`mode`（`copy`/`reencode`）、`sizeMode`、`width`/`height`、`transition`/`crossfadeDuration` |
| `POST /api/canvas/trim-video` | `裁剪视频` | `videoPath`、`duration`、`startTime` 或 `startFrame` |
| `POST /api/canvas/trim-audio` | `裁剪音频` | `audioPath`、`duration`、`startTime` |
| `POST /api/canvas/extract-frame` | `获取视频帧` | `videoPath`、`frameIndex` 或 `time` |

统一流程：路径白名单校验（仅 `assert/` 下）→ `buildXxxCommand()`（探测 + 校验 + 装配 `FfmpegCommandSpec`）→ `archiveCanvasOutput()` 归档旧产物（失败只告警）→ `startFfmpegTask({project, label, spec, ...parseTaskTarget(req.body)})` → 立即返回 `{taskId, status:'running'}`。

| 失败情形 | 响应 |
|----------|------|
| 参数/校验错误（`INVALID` / `FRAME_INDEX_OUT_OF_RANGE` 等） | 400（`message` + `code`） |
| 路径不在 `assert/` 下 | 403 |
| 登记冲突：`TaskError('NODE_BUSY')` → 409；`TaskError('TASK_LIMIT')` → 429 | `respondTaskError()` 统一映射 |

### 1.4 LLM 会话：`POST /api/llm/chat`

| 步骤 | 说明 |
|------|------|
| 校验 | `project` / `providerInstanceId` / `modelId` / `nodeId` / `canvas`（`normalizeCanvasTarget`，非法 400）必填；实例必须存在且 `type === 'llm'`；协议与 API Key 必须有值 |
| 媒体输入 | `resolveMediaInputs()` 过滤模型不支持的模态 → 警告列表（不阻断） |
| 登记会话 | `sessionManager.begin()` → 同节点单飞 409 `NODE_BUSY` / 上限 8 返回 429 `SESSION_LIMIT` |
| 登记任务 | `llmExecutor.create({taskId: session.taskId, ...})`（`idOverride`）；失败时 `sessionManager.cancel()` + `finish(failed)` 并返回 429 `TASK_LIMIT` |
| 注入生命周期 | `session.lifecycle = llmExecutor.lifecycleOf(session.taskId)`（阶段/终态同步注册表） |
| 后台执行 | `void runLlmTask(session.taskId, {...})`；HTTP 立即返回 `{taskId, status:'running'}` |

## 二、引擎领取（`startEngine` → `tick`）

`server/src/workflow-engine.ts` 的 `startEngine()` 做两件事：**先启动对账**（见第五节），再 `tick()` 立即执行一次 + `setInterval(tick, 2000)`——**每 2 秒一轮**。`tick` 整体包在 `try/catch` 里，单轮异常只打 `Engine tick error:`，不终止循环。

| 步骤 | 代码 | 说明 |
|------|------|------|
| 取候选 | `db.getPendingTasks()` | `status IN ('pending','running')`，`ORDER BY phase ASC, created_at ASC`。**包含 running**：并发计数与阶段判定需要看到在跑的任务 |
| 分组 | `task.batch_id ? batchGroups : nonBatchTasks` | 有 `batch_id` 进批次组（`Map<batchId, TaskRecord[]>`），否则单任务 |
| 非批量领取 | `for (const task of nonBatchTasks) if (task.status === 'pending')` | **无并发上限**（保持历史行为）；`db.updateTaskStatus(task.id, 'running')` 后 `runTask(task.id).catch(err => console.error('Task … crashed:', err))` |
| 批次阶段判定 | `phases = [...new Set(tasks.map(t => t.phase))].sort()` → 取「最小的、仍有 `pending`/`running` 任务的 phase」为 `currentPhase` | 全部已终态的 phase 跳过 |
| 前置阶段闸门 | `lowerPhasesDone` = 所有 `phase < currentPhase` 的任务**全部 `completed`** | 不满足 → `continue`，本轮不启动该批次任何任务（**失败任务会卡住后续阶段**，需人工重试或中断） |
| 并发闸门 | `concurrency = getBatchConcurrency(batchId)`（内存 Map，默认 1）；`slots = concurrency - runningCount(currentPhase)` | `slots <= 0` → 本轮不动 |
| 批量领取 | `pendingTasks.slice(0, slots)` 逐个 `updateTaskStatus('running')` → `runTask()` | 先落库 `running` 再执行：进程崩溃后状态仍为 `running`，由下次启动对账回收 |

**领取 = 落库 `running` + 调用 `runTask`**：注册表登记发生在 `runTask` 内部（而非创建时），因此**排队窗口内的任务不在注册表里**（画布恢复必须补查 SQLite，见第六节）。

## 三、执行与终态收敛

### 3.1 工作流任务（`runTask`）

| 阶段 | 关键行为 |
|------|----------|
| 前置 | `db.getTask` → `getImpl(workflow_id, impl)`；实现缺失直接 `failed`（`Workflow … not found`）。解析 `params`（`vars` / `promptPaths` / `outputPath` / `video` / `sizeConfig` / `comfyuiProviderId` / `nodeId` / `canvas`） |
| 登记注册表 | `workflowExecutor.create({taskId, project, workflowId, impl, label: wf.name, outputPath?, nodeId?, canvas?})`；**失败只告警**（如全局上限 32），不影响工作流本身执行，仅任务管理器看不到该任务 |
| 参数富化 | `tts-voice-design` 的 `scene-tts` / `character-voice`、`image-edit` 的 `scene-stage-image`（含 `tryHandleSceneStageDirectReference` 直接复制分支：命中即 `db.updateTaskStatus(completed)` + **`workflowExecutor.finish`** 后 `return`——提前 return 的分支必须自己收敛注册表，否则任务永久留在活跃区）；注入 `seed`（用户未填 → `Date.now()`） |
| Provider 解析 | `wf.providerInstanceId` → `getInstance()` → `getProvider(instance.type)` → `createClient(resolveInstanceConfig(instance))`；任一步缺失抛错（配置**按请求实时解析**，支持热加载） |
| Step 1 提交 | `db.addLog('Starting workflow: …')` + `db.updateTaskStatus(id,'running')` → `wf.submit(runContext)` → **基于最新 params 合并**写入 `remoteTaskId`（勿用提交前快照，否则会覆盖并发写入的 `cancelRequested`）→ `workflowExecutor.update(taskId, {remoteTaskId})` 重算可中断性（登记时尚未提交远端 → 不可中断） |
| Step 2 轮询 | `POLL_INTERVAL = 2000`，无限轮询直到 `result.done`。**进度同步**：`result.progress` 有值时 `workflowExecutor.update(taskId, {progress})` 写入注册表（REST `progress` 字段与 WS 广播的来源）。**日志降噪**：`status|progress` 变化才写 `info`；长时间不变按 `taskLog.heartbeatSeconds`（默认 60，0 = 关闭）补一条 `debug` 心跳 |
| Step 3 取产物 | `provider.getOutput(remoteTaskId)`；为空抛 `No output files found from provider task`（远端 `failed` 时优先透出 `errorMessage`） |
| 取消标记检查 | 写产物**之前**读最新 params：`isCancelRequested()` 为真 → `throw new Error('用户中断')`（**不归档、不写产物**） |
| 归档 + 落盘 | `copyExistingAssetToHistory()` 把已有产物归档到 history（copy 语义，固定路径产物在生成期间不消失）→ `download` / `fetch` / `body`(base64) 三种取回方式写 `assert/` |
| 成功收敛 | `db.addLog('Output written to: …')` → `db.updateTaskStatus(id,'completed',{result:{path}})` → `workflowExecutor.finish(taskId,'completed')` |
| 失败收敛 | `catch`：写 `error` 日志 + 控制台堆栈 → `updateTaskStatus(id,'failed',{error_msg: msg})` → `workflowExecutor.finish(taskId,'failed')`。**不自动重试** |

| 情形 | SQLite `status` | 注册表 `status` |
|------|-----------------|-----------------|
| 正常产出 | `completed` | `completed`（移出活跃区） |
| 执行中异常 / provider 报错 | `failed` + `error_msg` | `failed` |
| 用户中断（`cancelWorkflowTask`） | `failed` + `error_msg = '用户中断'` | `failed`（`workflowExecutor.finish(id,'failed')`；`deferredCancel` 场景由引擎收敛） |
| 引擎崩溃 / 服务重启 | 遗留 `running` → 启动对账改 `pending` | 重启后注册表为空 |

### 3.2 ffmpeg 任务（`ffmpegExecutor`）

| 阶段 | 关键行为 |
|------|----------|
| 登记 | `ffmpegExecutor.create(meta, params)` → `taskRegistry.register({...meta, type:'ffmpeg', handle})`（`handle` 指向 `this.cancel`；**不预置 `progress`**——未上报即缺省 ⇒ 前端不确定动画）；同节点已有任务 → 409 |
| 执行 | `run(taskId, params)`：`Ffmpeg()` + `params.build(cmd)` → `cmd.save(outputAbs)`；`stderr` 尾部保留 4000 字符（失败信息用） |
| 进度 | `cmd.on('progress')` → `computeProgressPercent(parseTimemarkSeconds(p.timemark), duration)` → `taskRegistry.update(taskId, {progress})`（**钳制 0~99**；无 `duration` 的取帧返回 `null` ⇒ 一次都不写） |
| 成功 | `end` → `running.delete` → `finish(id, {status:'completed'})`（`progress` 缺省时 `finish` 补 100） |
| 失败 | `error` 且 `state.cancelRequested === false` → `extractFfmpegError(e, stderrTail)` → `finish(id, {status:'failed', error})` |
| 中断 | `error` 且 `cancelRequested === true` → `finish(id, {status:'cancelled'})`（不算错误） |

### 3.3 LLM 会话（`runLlmTask` + `sessionManager`）

| 阶段 | 关键行为 |
|------|----------|
| 流式累加 | `createLlmStream({..., abortSignal: session.abortController.signal})` 逐事件：`pushEvent()` 累加 `thinking` / `text`（首个 `text` 触发 `phase: thinking → responding`，并 `lifecycle.onPhase` 同步注册表）/ `warnings` / `error`；同时 `wsHub.taskEvent()` 推给订阅者（流式增量**不进任务模型**） |
| 正常结束 | 收到 `done` 或流耗尽 → `finish(taskId, {status:'completed'})` |
| 上游错误事件 | `error` 事件 → `finish(taskId, {status:'failed', error})` |
| 异常 | `isAbortError(e)` 或 `session.cancelled` → `finish(cancelled)`（AbortError **不得**归类为 failed）；否则 `finish(failed, '对话流异常：…')` |
| 终态顺序（关键） | `finish()` 内：置终态 → **先落盘**（`persistLlmResult`：读 `canvas.json` → 校验 `nodeId` 仍在 `nodes` → 写 `config.output` / `outputHistory`，CAS + 重试 ≤ 3）→ **再** `lifecycle.onFinish()`（同步注册表并触发 WS 终态广播，此时会话仍在活跃区，`task-ws` 才能反查终态载荷）→ 最后 `sessions.delete` + `emit(finish)` |
| 落盘失败 | `completed` 降级为 `failed`（`error = '结果写入画布失败：…'`）；`cancelled`/`failed` 保持原状态并把原因追加到 `error` |

## 四、中断（统一入口）

### 4.1 入口

| 入口 | 路径 | 说明 |
|------|------|------|
| **统一 HTTP** | `POST /api/tasks/:taskId/cancel` | 任务管理器与画布统一走这里；`taskRegistry.cancel(taskId)` |
| WS 命令 | `/llm-ws` 的 `{type:'cancel', taskId}` | 前端 `taskSocket.cancel()` 优先发 WS，HTTP 兜底 |
| 旧工作流路径 | `POST /api/workflow/tasks/:taskId/cancel` | 复用 `canCancelTask()` + `cancelWorkflowTask()`，返回 `{taskId, status: deferred ? 'cancelling' : 'failed'}`；失败 502 `cancel_failed` |
| 旧 LLM 路径 | `POST /api/llm/chat/tasks/:taskId/cancel` | `sessionManager.cancel(taskId)`；不存在/已终态 404 |

统一入口的行为：

```
POST /api/tasks/:taskId/cancel
  → taskRegistry.cancel(taskId)
      ├─ 任务不存在        → {ok:false, reason:'任务不存在或已结束'}   → 404 {code:'NOT_CANCELABLE'}
      ├─ 已终态            → {ok:false, reason:'任务已结束'}          → 404
      ├─ cancelable=false  → {ok:false, reason:cancelBlockReason}     → 404
      ├─ 无 handle         → {ok:false, reason:'该任务暂不支持中断'}   → 404
      └─ 受理 → handle.cancel()（异步不阻塞）→ 200 {success:true, taskId}
                 + wsHub.taskEvent(taskId, {type:'cancelling', taskId}) 通知订阅者
```

受理成功**不等于**已中断：终态由执行器收敛后经 `task-update` / `tasks` 广播（LLM 另有 `finished`）。

### 4.2 三种中断语义

| 类型 | handle 实现 | 语义 | 收敛方式 |
|------|-------------|------|----------|
| `workflow` | `cancelWorkflowTask(taskId)` | ① `pending`（本地排队）→ 直接 `updateTaskStatus(id,'failed',{error_msg:'用户中断'})` + 日志 `Task cancelled by user`；② `running` 且非 `deferredCancel` → 必须有 `remoteTaskId`，调 `notifyProviderCancel()` 让 Bridge 取消远端任务，然后同样置 `failed`；③ `running` 且 `deferredCancel` → **先写标记**（见 4.4）再尽力通知 provider，任务继续跑完由引擎收敛 | ① ② 立即；③ 引擎执行到写产物前抛 `用户中断` |
| `ffmpeg` | `FfmpegExecutor.cancel(taskId)` | 置 `state.cancelRequested = true` → `command.kill('SIGKILL')` → `removeOnCancel` 为真时 `fs.unlink(outputAbs)` 删除半截产物（保留上一次成功结果，失败只告警） | 子进程被杀 → `error` 事件 → `finish(cancelled)` |
| `llm` | `sessionManager.cancel(taskId)` | 置 `s.cancelled = true` + `abortController.abort()`（中止上游流） | 流抛 AbortError → `runLlmTask` → `finish(cancelled)`；`finish` 里 `effective = s.cancelled ? 'cancelled' : …`（**取消优先**），并保留已累计正文写入 `config.output`（不追加历史） |

`ffmpegExecutor.cancel()` 返回 `false`（进程已不在运行映射里）时注册表不报错——任务可能刚好已终态，前端以广播终态为准。

### 4.3 `canCancelTask` 拒绝原因（工作流）

`routes/workflow.ts: canCancelTask(task, wf)`（与 `tasks/workflow-executor.ts: workflowCancelability` 同一语义，后者供注册表 `cancelable` / `cancelBlockReason` 使用）：

| 条件 | 旧接口响应 | 注册表 `cancelBlockReason` |
|------|-----------|---------------------------|
| `wf.capabilities.cancelable` 非真 | 400 `not_cancelable`「该工作流不支持中断」 | 该工作流不支持中断 |
| `status === 'pending'` | ✅ 可中断（本地排队直接取消） | 同（`cancelable: true`） |
| `status` 既非 `pending` 也非 `running` | 400 `invalid_status`「任务状态不是 pending 或 running（当前 {status}）」 | 同一文案 |
| `running` 且无 `remoteTaskId` 且非 `deferredCancel` | 400 `no_remote_task`「任务尚未提交到远端，无法中断」 | 同一文案 |
| `running` 且 `deferredCancel` | ✅ 可中断 | `已请求取消将在执行完成后生效` |

> 提交窗口坑：引擎只有在 `submit` 返回后才落 `remoteTaskId`。**阻塞式 `submit` 的 provider 若不声明 `deferredCancel`，生成期间的中断会被拒绝**。

### 4.4 `deferredCancel` 与取消标记（`server/src/workflows/cancel.ts`）

```ts
markCancelRequested(params)      // { ...params, cancelRequested: true }
isCancelRequested(params)        // params.cancelRequested === true
stripCancelRequested(params)     // 重试复制 params 时剥离旧标记
```

| 环节 | 行为 |
|------|------|
| 取消请求 | `db.updateTaskParams(task.id, markCancelRequested(当前 params))`，日志 `已请求取消，已通知服务商；任务将尽快收敛为「用户中断」` 或 `已请求取消，将在执行完成后生效` |
| 通知 provider | 有 `remoteTaskId` 时 `notifyProviderCancel(wf, remoteTaskId)`（按 `wf.providerInstanceId` 定位实例，避免多实例发错）；失败只 `console.warn`，标记已写不影响收敛 |
| 引擎侧 | `runTask` 写产物前读**最新** params：`isCancelRequested(...)` → `throw new Error('用户中断')` |
| 保证 | **deferredCancel 路径取消后绝不落产物**：检查发生在归档与写文件之前；任务最终持久化为 `failed`（用户中断）而非 `completed`。非 deferredCancel 路径依赖 provider 的 `cancel` 真的中止远端任务（Bridge 侧取消后轮询会得到失败态） |
| 重试 | `/workflow/retry/:taskId` 复制 params 时 `stripCancelRequested()`，避免旧标记污染新任务 |

### 4.5 前端中断收敛

| 类型 | 前端路径 | 收敛依据 |
|------|----------|----------|
| 工作流 / ffmpeg | `useCanvasGeneration.interrupt(nodeId)` → `api/tasks.cancelTask(taskId)` | **不预置状态、不停轮询**：工作流由 `poll()` 拿到 SQLite 终态、ffmpeg 由 `task-update` 广播收敛；请求被拒（404 `NOT_CANCELABLE`）或网络失败时保持 `running` 并经 `onCancelRejected` 提示，任务继续执行到终态 |
| LLM | `interruptLlm(nodeId)` → `taskSocket.cancel(taskId)`（WS 优先 + HTTP 兜底） | 等 `finished(cancelled)`；**3 秒收敛超时兜底**（`LLM_CONVERGE_TIMEOUT_MS = 3000`）——HTTP 已确认但 WS 断连时本地结束 Loading |

## 五、启动对账与手动重试

`startEngine()` 在建立 2s 轮询之前先做一次**遗留任务对账**（服务重启后 `running` 状态是崩溃残留，不是真实运行）：

| 步骤 | 代码 | 结果 |
|------|------|------|
| 找遗留 | `db.getPendingTasks().filter(t => t.status === 'running')` | 上一进程崩溃/被杀时停在 `running` 的任务 |
| 重置 | `db.updateTaskStatus(task.id, 'pending')` | 重新进入排队，下一轮 `tick` 领取 |
| 留痕 | `db.addLog(task.id, 'warn', 'Task reset from running to pending after server restart')` | 任务日志里可看到重启对账痕迹 |
| 汇总 | 命中 > 0 时 `console.log('Reset N stale running tasks to pending')` | 服务端启动日志 |

**副作用（必须知道）**：重置只改状态，引擎随后会**从头重跑 `runTask`**——包括重新 `submit` 到远端生成。也就是说重启恢复的工作流任务会重新消耗远端算力/费用，旧的 `remoteTaskId` 会被新提交覆盖（`updateTaskParams` 基于最新 params 合并）。LLM 会话与 ffmpeg 任务不在 SQLite，不参与对账（其执行进程已随服务一起消失）。

**为什么不做自动重试**：`runTask` 的 `catch` 分支直接置 `failed`，不读取 `retry_count` / `max_retries`（`incrementRetry()` 当前无生产调用方）。原因是长时间生成任务若因轮询超时被自动重复提交，会**重复扣费并遗弃仍消耗算力的旧任务**，因此重试必须由人触发。

| 手动重试 | `POST /api/workflow/retry/:taskId` |
|----------|-----------------------------------|
| 任务不存在 | 404 `Task not found` |
| 原实现已失效（实例被删/工作流下线） | 400 `workflow_impl_not_found`「原任务工作流实现已不存在或未绑定服务商实例」——**避免创建必败任务** |
| 正常 | 新 `uuidv4()` 建行：复制 `project` / `workflow_id` / `impl` / `params`（经 `stripCancelRequested`）/ `batch_id` / `phase`；`addLog(newTaskId, 'info', 'Retry of task {oldId}')`；返回 `{taskId: 新 id, status:'pending'}` |

重试创建的是**全新任务**（旧任务的 `failed` 行与其日志保留，历史页签仍可查）。

## 六、刷新 / 重启后的前端恢复

画布加载、切换分镜/场景、浏览器刷新后，`useCanvasGeneration.restore(knownNodeIds)` 负责把「仍在跑的任务」重新挂回节点 Loading。

### 6.1 三份数据源（缺一不可）

| 数据源 | 取数路径 | 覆盖 | 为什么必须有 |
|--------|----------|------|--------------|
| ① 统一任务注册表 | `taskSocket.tasks`（WS 全量快照 `tasks`）；`snapshotReady === false` 时 HTTP 兜底 `GET /api/tasks?project=`（`activeRegistryTasks()`） | ffmpeg 任务 + **已登记**的工作流任务（含进度） | 唯一能覆盖 ffmpeg 任务与实时进度的来源 |
| ② HTTP 兜底 | `listActiveTasks(project)`（`frontend/src/api/tasks.ts`） | 同 ①，仅在 WS 快照未就绪时使用 | WS 连接建立到首个全量快照之间有窗口（以及断线重连期间 `snapshotReady` 被重置为 `false`），此时 `tasks` 为空/过期，直接按它恢复会漏任务 |
| ③ SQLite 工作流任务 | `GET /api/workflow/tasks?project=&status=running` 与 `status=pending`（`limit: 1000`） | 工作流任务的持久化权威 | 注册表**只在引擎领取任务时登记**：本地排队窗口（引擎 2s tick）与服务重启期间注册表为空，仅凭 ① 会漏恢复；且 `params.nodeId` / `params.canvas` 持久化在 SQLite，重启后仍能定位节点 |

三路结果按 `taskId` 去重（`Map<taskId, RestoreEntry>`）。

### 6.2 过滤条件（`collectRunningTasks`）

| 过滤 | 条件 |
|------|------|
| 类型 | 仅 `ffmpeg` / `workflow`（LLM 由会话列表 + `finished` 广播走另一条路径） |
| 有定位 | `task.nodeId` 必须存在 |
| 状态 | `running` 或 `pending` |
| 项目 | `project` 一致 |
| 画布 scope | `isCurrentScope()`：`kind` + 对应字段与当前 `target` 一致 |
| 节点仍在画布上 | 传入 `knownNodeIds` 时，节点必须仍在集合内（已删除的节点不恢复 Loading） |
| workflow 复用 | SQLite 补查出来的任务若 `taskId` 已在注册表结果里则跳过 |

### 6.3 恢复动作（`restore` → `switchTarget`）

| 任务类型 | 恢复动作 |
|----------|----------|
| `workflow` | 置 `statusByNode[nodeId] = {status:'running', lastLog:'任务进行中…', taskId}`（**不带进度**，首轮轮询落定后才有真实百分比），**续跑本地轮询** `poll(taskId, nodeId, outputPath)`（SQLite 为权威，含阶段日志与终态） |
| `ffmpeg` | 置同一运行态（同样不带进度），并 `taskSocket.subscribe(taskId, …)` 重订阅以处理「订阅时任务已结束」竞态（收到 `not-found` → 结束 Loading，产物以文件为准）；进度由全局 `onTaskUpdate` 消费 |
| 已在本会话跟踪中 | `statusByNode[nodeId]?.status === 'running'` → 跳过，不重复接管 |

`switchTarget(newTarget, knownNodeIds)` = `targetRef` 更新 → `reset()`（清定时器/状态/`taskIdByNode`，**不动服务端任务**）→ `await restore(knownNodeIds)`。`reset()` / `dispose()` 只清理前端内存态与订阅，运行中的任务在服务端继续执行。

### 6.4 收敛环路

| 类型 | 进度 | 终态 | 完成后 |
|------|------|------|--------|
| `workflow` | 本地轮询（`GET /api/workflow/tasks/:id` 的 `progress`：服务商上报了就有真实百分比，否则不确定动画） | `poll()` 读到 `completed` / `failed` | `completed` → `onResult(nodeId, outputPath)` 刷新产物（固定路径 + mtime） |
| `ffmpeg` | `task-update` 广播（真实百分比） | `task-update` 广播 `completed`/`failed`/`cancelled` | 刷新产物；产物不存在时置错误「任务已结束但未生成产物，请重新执行」 |
| `llm` | 阶段文案（`Thinking…` / `正在响应…`） | 全局 `finished` 广播（含 `persistPatch` / `rev` / `prevRev`） | 画布按 `项目 + scope` 过滤，`savedRev === prevRev` 时采纳补丁 |

**任务未到终态前 Loading 一直保持**，不存在「刷新后 Loading 永久卡住」的幽灵态：注册表 + SQLite 两路对账保证活跃任务必被重新挂载，终态任务两路都查不到。

## 相关文档

| 文档 | 关系 |
|------|------|
| [data-model.md](./data-model.md) | 表结构 / 内存 `TaskRecord` / 前端模型 / 时间格式 |
| [execution.md](./execution.md) | 三类执行器实现细节（provider 解析、Command 构建、流式处理） |
| [events.md](./events.md) | `/llm-ws` 协议、`taskSocket` 重连与 HTTP 兜底 |
| [api.md](./api.md) | 创建 / 查询 / 日志 / 中断 / 重试 / 清理接口清单 |
| [log.md](./log.md) | 日志分级、轮询降噪与心跳、保留期与清理 |
| [ui.md](./ui.md) | 任务管理器与画布 Loading / 错误「详情」交互 |
| [development.md](./development.md) | 新增任务类型的接入清单与常见坑 |
| [`../canvas/task-architecture.md`](../canvas/task-architecture.md) | 画布视角的统一异步任务架构 |
| [`../canvas/generation.md`](../canvas/generation.md) | 画布生成流程（提交参数、轮询、中断交互） |
| [`../canvas/llm-session.md`](../canvas/llm-session.md) | AI 文本节点的 Loading 恢复与流式显示 |
