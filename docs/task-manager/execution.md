# 执行侧实现：工作流引擎 / ffmpeg 执行器 / LLM 适配

> 返回 [任务管理总览](../task-manager.md)

本文只回答「任务被**谁**执行、状态**怎么**推进、产物**怎么**落盘、失败**怎么**收敛」。任务模型与字段含义见 [data-model.md](./data-model.md)，创建与中断全链路见 [lifecycle.md](./lifecycle.md)，事件传输见 [events.md](./events.md)，日志写入与降噪见 [log.md](./log.md)。

## 一、分层：谁认识谁

```
前端（任务管理器 / 画布节点 Loading）
   ▲                tasks 全量 + task-update 增量（/llm-ws）
   │
tasks/task-ws.ts     广播枢纽：把注册表事件翻译成消息，不参与执行
   ▲
tasks/registry.ts    统一任务模型 + 事件（运行态唯一事实源，仅内存）
   ▲  handle.cancel()
tasks/executor.ts    执行器门面：TaskExecutor / TaskHandle 接口（仅类型 + createTaskHandle）
   ▲
   ├─ tasks/ffmpeg-executor.ts    完整实现：spawn fluent-ffmpeg + 进度 + SIGKILL
   ├─ tasks/llm-executor.ts       薄适配：会话 id 即任务 id，中断委托 sessionManager
   └─ tasks/workflow-executor.ts  镜像适配：登记 + 中断委托，执行权仍在 workflow-engine
```

| 层 | 文件 | 负责 | 明确**不**负责 |
|----|------|------|----------------|
| 注册表 | `tasks/registry.ts` | 任务模型、`register/update/finish/cancel/listActive/on`、同节点单飞、全局上限 32 | 不认识任何具体执行器：中断只调 `record.handle.cancel()`；不依赖 WS 传输 |
| 门面 | `tasks/executor.ts` | `TaskExecutor<TParams>` / `TaskHandle` 接口、`createTaskHandle()`、`finishTask()` | 不含实现；只放接口以避免 `registry.ts` 与执行器互相 import 成环 |
| 执行器 | `tasks/*-executor.ts` | 真正的执行、进度上报、终态收敛 | ffmpeg 执行器不构建 ffmpeg 命令（在 `assets/*`）；工作流执行器不轮询远端（在引擎） |
| 引擎 | `workflow-engine.ts` | 工作流任务的 provider 解析、提交、轮询、产物落盘 | 不写注册表模型，只调 `workflowExecutor` 的三个方法 |
| 传输 | `tasks/task-ws.ts` | 注册表事件 → 广播；订阅关系；`cancel` 命令转发 | 不改任务状态、不做业务判定 |

> **设计要点**：注册表**永远不感知** ffmpeg 子进程或 `AbortController`。三类任务的执行机制天然不同（DB 行 + 引擎轮询 / 上游流 + AbortController / 子进程），"统一"只发生在**模型与事件**这一层。`TaskHandle.cancel()` 同步/异步均可，异步时不阻塞调用方（结果由执行器经 `finish` 收敛）。

## 二、工作流任务执行（`server/src/workflow-engine.ts`）

工作流任务（`type='workflow'`）的**持久化权威是 SQLite `tasks` 表**，执行权在引擎；`tasks/workflow-executor.ts` 只做「登记 + 中断委托」的镜像适配。因此引擎是**状态推进的唯一来源**，注册表只是它的一个运行态视图。

### 2.1 引擎调度：谁把任务交给 `runTask`

`startEngine()` 启动后立即执行一次 `tick()`，之后每 **2 秒**一次：

| 情形 | 行为 |
|------|------|
| 服务重启时残留 `running` 任务 | 先统一置回 `pending` 并写 `warn` 日志（`Task reset from running to pending after server restart`），再进入正常调度 |
| 非批量任务（`batch_id` 为空） | 逐个 `updateTaskStatus(running)` + `runTask(id)`，**无并发上限** |
| 批量任务 | 按 `batch_id` 分组，取最低未完成 `phase`；低 phase 未全部 `completed` 则本轮跳过；同 phase 内按 `getBatchConcurrency(batchId)` 限制并发，用空槽数决定本轮启动几个 |
| `runTask` 抛错 | `runTask(...).catch(err => console.error('Task ${id} crashed:', err))` —— 引擎兜底打日志，不重试 |

### 2.2 `runTask(taskId)` 主流程

| # | 步骤 | 关键标识符 | 说明 |
|---|------|-----------|------|
| 0 | 取任务 | `db.getTask` | 不存在只 `console.error` 并返回（**不登记注册表**） |
| 0 | 解析实现 | `getImpl(task.workflow_id, task.impl)` | 找不到 → `updateTaskStatus(failed)` + `error` 日志 + 返回 |
| 1 | 登记注册表 | `workflowExecutor.create({...})` | **登记点是「引擎开始执行」**，不是任务创建处（避免排队中的任务被误显示为运行中）。`nodeId`/`canvas` 从 `task.params` 透传，供画布恢复 Loading。登记失败（如 `TASK_LIMIT`）只 `console.warn`，**不影响执行** |
| 2 | 读项目配置 | `loadProjectConfig(task.project)` | `project.json` 的 `width/height/aspectRatio/fps`；缺失/解析失败回退 `fps=24`、尺寸 0 |
| 3 | 分支预处理 | `enrichSceneTtsParams` / `character-voice` / `tryHandleSceneStageDirectReference` | 见 §2.9；命中直接引用则提前返回 |
| 4 | 组装 vars | `seed` 注入 | 用户已在 `vars.seed` 填写则沿用，否则 `String(Date.now())` |
| 5 | 构造读取器 | `readFile` / `readAssertFile` / `readFileToBase64` / `readFileAsBase64Object` | 均做路径穿越校验（必须落在 `design/{project}/` 内，二进制读取还要求 `assert/` 前缀） |
| 6 | 置运行态 | `db.addLog(...'Starting workflow...')` + `db.updateTaskStatus(taskId,'running')` | 之后所有失败都会走 catch 分支 |
| 7 | Provider 解析 | `getInstance` → `getProvider` → `createClient` | 见 §2.3 |
| 8 | 视频提交数据 | `resolveVideoSubmitData` / `buildSceneVideoSubmitData` | 见 §2.4 |
| 9 | 用户参数 | `toNativeUserParams(wf.params, userParamsVars)` | 只取实现声明的 `wf.params` key，从 `vars` 提取并按声明类型转原生值 |
| 10 | 组装上下文 | `WorkflowRunContext` | `project/projectConfig/vars/provider/comfyuiProviderId/video/userParams/sizeConfig` + 四个读取器 |
| 11 | **Step 1 提交** | `wf.submit(runContext)` | 见 §2.5 |
| 12 | **Step 2 轮询** | `provider.poll(remoteTaskId)` | 见 §2.6 |
| 13 | **Step 3 取输出** | `provider.getOutput(remoteTaskId)` | 返回 `null` → 抛 `No output files found from provider task` |
| 14 | **Step 4 落盘** | `copyExistingAssetToHistory` + `fs.writeFile` | 见 §2.7 |
| 15 | 终态 | `db.updateTaskStatus(completed)` + `workflowExecutor.finish(taskId,'completed')` | 两处都要写：前者是持久化权威，后者移出注册表活跃区并触发广播 |

### 2.3 Provider 与实例解析

```ts
const instanceId = wf.providerInstanceId;
if (!instanceId) throw new Error(`工作流 ${task.workflow_id}/${task.impl} 未绑定服务商实例`);
const instance = await getInstance(instanceId);                                    // providers/config-store.ts
const providerDef = getProvider(instance.type);                                    // providers/registry.ts
const provider = providerDef.createClient(resolveInstanceConfig(instance));        // 文件值 > envVar > defaultValue
```

| 环节 | 失败后果 |
|------|----------|
| `wf.providerInstanceId` 缺失 | 抛 `未绑定服务商实例` → 任务 failed |
| `getInstance` 查不到（实例被删） | 抛 `绑定的服务商实例不存在: {id}` |
| `getProvider(instance.type)` 未注册 | 抛 `服务商类型未注册: {type}` |
| `resolveInstanceConfig` | secret 字段按 schema 解析；配置**每次执行实时解析**（支持热加载，改配置后新任务即生效） |

`instance.type` 决定传输实现：`comfyui-bridge`（本地 Easy Bridge，视频/图片/TTS 主通道）、`volcengine-ark`、`minimax-h3`、`openai-compatible`、`custom`（用户自定义服务商）。工作流的 `submit` 只依赖 `ctx.provider` 的四个方法，不关心具体是哪家。

### 2.4 视频提交数据解析（`image-to-video`）

两条来源，互斥：

| 来源 | 判定 | 处理 |
|------|------|------|
| 画布节点自包含提交 | `paramsObj.video` 存在（wire 形态，值为**路径**） | `resolveVideoSubmitData(project, wire, readAssertFile)`：把 `director.frames[].path`、`director.audio.path`、`references[].path` 全部读成 `File` |
| 分镜/批量任务 | `paramsObj.video` 缺失 | 要求 `vars.episode` + `vars.shot`，经 `buildSceneVideoSubmitData(project, episode, shot, capabilities?.video, projectConfig, sceneDeps)` 组装（场景适配层 `workflows/scene-adapter.ts` 负责读分镜文件；**工作流实现不再读分镜文件**） |

`sceneDeps` 注入的能力（`SceneAdapterDeps`）：`readFile` / `readAssertFile` / `fileExists` / `mixAudioTracks`（`assets/audio-mix.ts`）/ `readTempAudio` / `removeTempAudio` / `generateVoice`。

`generateVoice` 是**内联 TTS**：在视频任务内部同步调 `provider.execute({workflowId:'tts_voice_design', ...})` → 1s 间隔 `provider.poll` 直到 `completed`/`failed` → `getOutput` 后 `type==='fetch'` 时 `fetch` 成 `File`。失败/异常一律**返回 `null` 降级**（不注入音频，不阻断视频生成），`catch` 内有意返回 `null`。

最后：`video.seed == null` 时回退引擎注入的 `vars.seed`。

### 2.5 Step 1：提交与 `remoteTaskId` 持久化

```ts
const { taskId: remoteTaskId } = await wf.submit(runContext);
// 基于「最新 params」合并，勿用提交前快照
const latestTask = db.getTask(taskId);
const latestParams = latestTask ? JSON.parse(latestTask.params) : taskParams;
db.updateTaskParams(taskId, { ...latestParams, remoteTaskId });
workflowExecutor.update(taskId, { remoteTaskId });
```

| 细节 | 原因 |
|------|------|
| 重新读一次 `db.getTask(taskId).params` 再合并 | 同步执行的 provider（`deferredCancel`）在 `submit` 期间可能已被写入 `cancelRequested` 标记；用提交前的快照覆盖会**丢掉取消标记**，导致任务完成后无法识别「用户中断」 |
| `db.updateTaskParams(..., remoteTaskId)` | 中断端点与 `cancelWorkflowTask` 都从 `params.remoteTaskId` 取远端任务 id |
| `workflowExecutor.update(taskId, { remoteTaskId })` | 登记时远端尚未提交 → `cancelable=false`（`任务尚未提交到远端，无法中断`）；拿到 id 后重算为可中断，否则中断按钮永远置灰、节点中断被 404 拒绝 |

`workflowExecutor.update` 的重算回退规则（源码注释明确）：`status` 回退注册表当前状态、`remoteTaskId` 回退 SQLite 已落盘值——只传其中一个字段时，另一个字段的判定依据不会被 `undefined` 算丢。

### 2.6 Step 2：轮询循环

| 项 | 取值 | 说明 |
|----|------|------|
| 间隔 | `POLL_INTERVAL = 2000`（2 秒） | 先 `setTimeout` 再 `poll`，首轮也等 2 秒 |
| 上限 | **无** | 视频生成可能远超 5 分钟，轮询直到 `result.done`；远端悬挂由用户中断兜底，provider 不可达时 `poll` 抛错 → 任务直接 failed |
| 变化判定 | `signature = \`${result.status}|${result.progress ?? '-'}\`` | 与上一条不同 → 写 `info` 日志 `进度更新：status=... progress=...` 并记录 `lastLoggedAt` |
| 进度同步 | `if (typeof result.progress === 'number') workflowExecutor.update(taskId, { progress: result.progress })` | **本轮新增**：把远端进度写进统一注册表——它是 `GET /api/workflow/tasks*` 的 `progress` 字段与 WS 广播的唯一来源（SQLite 不落进度）。只传 `progress` 不触发可中断性重算（条件要求 `status`/`remoteTaskId` 存在） |
| 心跳 | `heartbeatMs = await resolvePollHeartbeatMs()` | 状态未变且距 `lastLoggedAt ≥ heartbeatMs` → 补一条 `debug` 日志 `轮询中（状态未变）`。`heartbeatSeconds` 取自系统设置 `taskLog.heartbeatSeconds`，`0` = 不写心跳；**读取配置失败不阻断任务**，回退 60 秒并打日志 |
| 终态 | `result.done === true` | 写 `Task completed with status: ...`；`status==='failed'` 时 **`throw new Error(result.errorMessage ?? '远端任务失败（未知原因）')`**——优先透出 provider 的真实原因（敏感内容/余额不足等），避免落到兜底文案 `No output files found from provider task` 而丢掉病因；否则 `break` 进入 Step 3 |

> 降噪的量化背景与日志分级见 [log.md](./log.md)：改造前每 2 秒无条件写一条 `debug`，实测占日志总量 89%、其中 92.6% 与上一条完全重复。

### 2.7 Step 3 / Step 4：取输出与落盘

```ts
const output = await provider.getOutput(remoteTaskId);
if (!output) throw new Error('No output files found from provider task');
const outputPath = paramsObj.outputPath;                       // 缺失 → throw 'outputPath is required in task params'
const assertFullPath = resolveProjectAssertPath(task.project, outputPath);   // 必须落在 design/{project}/assert/ 内
```

落盘前两道**顺序敏感**的操作：

1. **延迟取消检查**：`isCancelRequested(JSON.parse(db.getTask(taskId).params))` → 抛 `用户中断`。位置在归档与写入**之前**，保证「已请求取消的任务绝不落产物」。
2. **历史归档**：`copyExistingAssetToHistory(project, outputPath)` → 已有资产 `copy` 到 `history/{stem}/{timestamp}{ext}`。用 **copy 而非 rename**：固定路径产物在生成期间不消失、预览不断链，新产物随后覆盖原路径。返回归档相对路径时写一条 `info` 日志。

随后 `fs.mkdir(assertDir, { recursive: true })` 并按 `output.type` 三选一写入：

| `output.type` | 载荷 | 引擎动作 |
|---------------|------|----------|
| `download` | `{ url, filename }` | `fetch(output.url)` → `res.ok` 校验 → `arrayBuffer` → `writeFile` |
| `fetch` | `{ request: { url, method, headers }, filename }` | 带 `method`/`headers` 发请求（Bridge 的 `Authorization: Bearer <token>` 走这里）→ 同样校验 → 写入 |
| `body` | `{ contentType, data, filename }` | `Buffer.from(output.data, 'base64')` 直接写入（如方舟/OpenAI 兼容的 `b64_json`） |

成功后：`db.addLog('Output written to: ...')` → `db.updateTaskStatus(taskId,'completed',{ result:{ path: outputPath } })` → `workflowExecutor.finish(taskId,'completed')`。

### 2.8 失败路径（无自动重试）

```ts
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? '') : '';
  db.addLog(taskId, 'error', `Task failed: ${msg}`);
  console.error(`[engine] Task ${taskId} failed: ${msg}`, stack);   // 控制台输出完整堆栈
  db.updateTaskStatus(taskId, 'failed', { error_msg: msg });
  workflowExecutor.finish(taskId, 'failed');
}
```

| 决策 | 理由（源码注释原文语义） |
|------|--------------------------|
| **一次 `error` 日志 + 一条带堆栈的 `console.error`** | 日志给用户看、控制台给开发看；不重复刷错误 |
| **不做自动重试 / 不重新提交** | 避免长时间任务因轮询超时被重复提交远端生成（旧任务被遗弃仍消耗算力/费用）。需要重试时由用户经节点「重试」或 `POST /workflow/retry/:taskId` 手动触发 |
| 失败也必须 `finish` | `TaskExecutor.run` 的契约是「终态必须由执行器收敛，否则任务永远留在活跃区」 |

### 2.9 特殊分支：直接引用（不跑 provider）

`tryHandleSceneStageDirectReference(taskId, project, paramsObj)`，入口条件：`task.workflow_id === 'image-edit'` 且 `paramsObj.vars.purpose === 'scene-stage-image'`。

| 步骤 | 判定 | 行为 |
|------|------|------|
| 参数 | `vars.episode` + `vars.shot` + `index` 为 ≥0 整数 | 缺一即 `return false`（交回工作流处理） |
| 读定义 | `prompt/scene/{episode}/{shot}/stage.json` | 不存在/不可解析 → `return false`；`index >= defs.length` → `return false` |
| 命中条件 | 该帧 `登场角色` 为空**且** `prompt` 为空 | 否则 `return false`（有角色/提示词就得真跑模型） |
| 基础场景 | `stage.基础场景` 去空 | 为空 → 抛 `基础场景不能为空` |
| 源路径 | `基础场景 === 'prev'` → `resolvePrevStageAssetPath(project, episode, shot)`；否则 `resolveStageAssetPath(baseStage)` | 源文件不存在 → 抛 `上一分镜最后场景图不存在: ...` / `基础场景图不存在: ...` |
| 写产物 | `copyExistingAssetToHistory` → `mkdir` → `fs.copyFile(sourceFull, destFull)` | 与普通产物一致地做历史归档 |
| 终态 | `db.updateTaskStatus(taskId,'completed',{ result:{ path, directReference:true, prevReference:isPrev } })` + **`workflowExecutor.finish(taskId,'completed')`** | 然后 `return true`，`runTask` 提前返回（**不解析 provider、不提交远端、无轮询**） |

> **提前 return 的分支必须自己收敛统一注册表**：`runTask` 的注册表登记发生在参数富化之前，而 `finish` 只在主流程的 completed / failed 两处调用。直接引用分支提前返回，因此必须显式 `workflowExecutor.finish(taskId,'completed')`——漏掉会让该任务永久留在活跃区（任务管理器一直显示「运行中」、画布节点 Loading 不消失、同节点后续任务被 `NODE_BUSY` 拒绝），直到服务重启。回归用例：`server/src/workflow-engine.test.ts` 的「『直接引用基础场景』分支（提前 return）同样收敛注册表」。

即：这一支是「复制基础场景图 / 上一分镜最后场景图 → 分镜场景图」，产物结构与真实生成完全一致，只是省掉了模型调用。

## 三、ffmpeg 任务执行（`server/src/tasks/ffmpeg-executor.ts`）

ffmpeg 是三类任务中唯一**完整实现门面**的执行器：拼接视频 / 裁剪视频 / 取帧 / 裁剪音频共享完全相同的生命周期（登记 → spawn → `-progress` 解析 → 终态收敛），因此统一由它承载。任务**不落 SQLite**，产物直接写文件系统。

### 3.1 铁律：命令构建与执行分离

| 侧 | 位置 | 职责 |
|----|------|------|
| 构建 | `assets/*.ts` 的 `buildXxxCommand()` | 探测（ffprobe）、参数校验、路径解析、装配 fluent-ffmpeg 选项；**绝不调用 `save()`** |
| 执行 | `tasks/ffmpeg-executor.ts` | `cmd.save(outputAbs)` + 接管 `progress` / `stderr` / `end` / `error` 事件 + kill |

统一产物是 `assets/ffmpeg-command.ts` 的 `FfmpegCommandSpec`：

```ts
interface FfmpegCommandSpec {
  outputAbs: string;                                        // 产物绝对路径（中断时删除半截产物用）
  build: (cmd: Ffmpeg.FfmpegCommand) => Ffmpeg.FfmpegCommand;  // 只挂输入/滤镜/输出选项，不 save
  duration?: number;                                        // 预期总时长（秒）→ 进度百分比
  info?: Record<string, unknown>;                           // 任务 payload 展示（模式/输出尺寸等）
}
```

| 构建器 | 文件 | 产物 | 备注 |
|--------|------|------|------|
| `buildConcatCommand(project, videoPaths, outputPath, params)` | `assets/concat-video.ts` | `.mp4` | `copy` 模式须各段规格一致（`assertConcatCompatible`）；`reencode` 走单次 `filter_complex` 归一化，`duration` 会扣除自然过渡时长；`info` 含 `mode/segments/sizeMode/width/height/fps/withAudio` |
| `buildTrimVideoCommand(project, videoPath, params, outputPath)` | `assets/trim-video.ts` | `.mp4` | `resolveTrimWindow` 算窗口；探测音轨决定是否带音频 |
| `buildTrimAudioCommand(project, audioPath, params, outputPath)` | `assets/trim-audio.ts` | 音频 | `resolveAudioTrimWindow` |
| `buildExtractFrameCommand(project, videoPath, {frameIndex\|timeSec}, outputPath)` | `assets/extract-frame.ts` | `.png` | `frameIndex` 优先；帧模式 `select=eq(n,N)`，时间模式输出端 `-ss`；**无 `duration`** → 进度为不确定 |

同一模块还保留同步版本（`concatVideos` / `trimVideo` / `trimAudio` / `extractVideoFrame`），它们内部就是 `build()` + `save()`，仅供脚本与单测使用；**路由层一律用 `buildXxxCommand()` + `startFfmpegTask()`**（见 `server/src/routes/canvas.ts`）。

入口 `tasks/ffmpeg-task.ts` 的 `startFfmpegTask({ project, nodeId?, canvas?, label, spec, payload? })`：

1. **动态 `import('./ffmpeg-executor.js')`** —— 避免 `tasks/ffmpeg-executor → assets/* → tasks/ffmpeg-executor` 的模块环；
2. `ffmpegExecutor.create(meta, params)` 登记（`payload` = `spec.info` + 附加字段）；
3. `void ffmpegExecutor.run(task.id, params)` 后台执行，**路由立即返回 `taskId`**。

### 3.2 `create` / `run`

```ts
create(meta, _params) {
  let taskId = '';
  const task = taskRegistry.register({
    ...meta, type: this.type,                       // 刻意不写 progress: 0
    handle: createTaskHandle(() => { this.cancel(taskId); }),   // 闭包延后取 id
  });
  taskId = task.id;
  return task;
}
```

`taskId` 用 `let` + 闭包延后绑定：句柄构造时 `register()` 还没返回 id。

**不预置 `progress: 0`**：`progress` 的语义是「真实上报过」（注册表里有值 = 前端渲染确定百分比）。取帧等操作没有 `duration`，`computeProgressPercent` 恒返回 `null` ⇒ 永远不会上报；若登记时写 0，节点遮罩会永久显示「0%」，比不确定动画更误导。

`run(taskId, params)`：

| 步骤 | 代码 | 说明 |
|------|------|------|
| 前置校验 | `if (!taskRegistry.get(taskId)) return;` | 已被外部移除则不再启动子进程 |
| 建命令 | `const cmd = Ffmpeg(); params.build(cmd);` | 构建器只挂选项 |
| 登记运行态 | `this.running.set(taskId, { command, cancelRequested:false, outputAbs, removeOnCancel: params.removeOnCancel !== false })` | `removeOnCancel` 缺省 `true` |
| stderr 尾部 | `cmd.on('stderr', line => stderrTail = \`${stderrTail}\n${line}\`.slice(-4000))` | 只留尾部 4000 字符（失败时提取有效错误行） |
| 进度 | `cmd.on('progress', p => { const pct = computeProgressPercent(parseTimemarkSeconds(p.timemark), params.duration); if (pct !== null) taskRegistry.update(taskId, { progress: pct }); })` | 每个进度事件都写注册表 → 触发 `update` → 广播 |
| 保存并等待 | `cmd.on('end', resolve).on('error', reject).save(params.outputAbs)` | `save()` **只在执行器里调用一次** |
| 终态 | 见下表 | 无论成败都先 `this.running.delete(taskId)` |

### 3.3 进度解析

| 函数 | 输入 | 输出 |
|------|------|------|
| `parseTimemarkSeconds(timemark)` | `HH:MM:SS.xx`（正则 `^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$`） | 秒数；格式不符/空 → `null` |
| `computeProgressPercent(currentSeconds, totalSeconds)` | 当前秒数 + 预期总时长 | `Math.floor(cur/total*100)` 后**钳制到 0~99**；`currentSeconds===null` 或 `totalSeconds` 非正/非有限 → `null`（UI 显示不确定进度） |

钳到 99 是刻意的：100 留给「任务真正收敛为 completed」那一刻，避免进度条先跑满、任务却还差最后几秒的观感错误。

### 3.4 终态收敛

| 分支 | 条件 | 收敛 |
|------|------|------|
| 成功 | `end` 事件 | `finish(taskId, { status: 'completed' })` |
| 中断 | `catch` 且 `state.cancelRequested === true` | `finish(taskId, { status: 'cancelled' })`，**不打错误日志**（中断不是故障） |
| 失败 | `catch` 且未请求中断 | `detail = extractFfmpegError(e, stderrTail)` → `console.error('[ffmpeg-task] 任务失败（...）')` → `finish(taskId, { status:'failed', error: detail })` |

`extractFfmpegError(err, stderrTail)`：取 stderr 尾部最后一条**非空行**；若错误消息里还没有它就拼成 `"{err.message}（{lastLine}）"`，否则原样返回。

### 3.5 中断：真中断

```ts
cancel(taskId) {
  const state = this.running.get(taskId);
  if (!state) return false;            // 注册表据此返回 ok:false（任务不存在/已结束）
  state.cancelRequested = true;        // 先标记，用于区分「中断导致的 error」与真实编码错误
  try { state.command.kill('SIGKILL'); } catch (e) { console.error(...); }
  if (state.removeOnCancel) {
    void fs.unlink(state.outputAbs).catch(e => console.warn('清理半截产物失败...'));
  }
  return true;
}
```

| 设计 | 理由 |
|------|------|
| `SIGKILL` 而非 `SIGTERM` | 编码进程不保证响应优雅退出，SIGKILL 保证「点了就停」 |
| 先标记再 kill | 子进程被杀后 `error` 事件才会到来，靠 `cancelRequested` 把结果导向 `cancelled` 而非 `failed` |
| `removeOnCancel` 默认 `true` → 删除产物 | 否则产物目录残留无法播放的半截 mp4，用户会误以为成功；上一次成功的结果已在 `history/` 中，安全 |
| 删除失败只 `console.warn` | 不阻断中断收敛（该 `catch` 内注释说明是「仅告警」的有意忽略） |
| 中断完成由 `error` 路径收敛，而非 `cancel()` 里直接 `finish` | 保证与子进程真实状态一致（进程可能已经自然结束） |

### 3.6 为什么必须分离（本题的核心）

| 若模块内部直接 `save()` | 后果 |
|------------------------|------|
| 事件监听被模块自己消费或干脆不挂 | 拿不到 `progress` → 注册表 `progress` 恒为空 → **无进度** |
| `FfmpegCommand` 实例不对外暴露 | 无法 `kill` → **无法中断**，任务只能等它跑完 |
| 异常直接同步抛出 | 路由同步阻塞、无 `taskId`，前端无从订阅，也没有"半截产物"可清理 |

结论：**新增任何本地 ffmpeg 操作，都必须导出 `buildXxxCommand()` 返回 `FfmpegCommandSpec`，交给 `tasks/ffmpeg-executor.ts` 执行**（也是仓库 `AGENTS.md` 的硬约束）。

## 四、LLM 任务执行（薄适配）

LLM 的执行权在 `server/src/llm/session-manager.ts`（上游流 + `AbortController` + 终态落盘），`tasks/llm-executor.ts` 只做两件事：把会话登记进统一注册表、把中断委托给会话管理器。

| 事项 | 实现 |
|------|------|
| **会话 id 即任务 id** | `llmExecutor.create` 传 `idOverride: input.taskId`，`taskRegistry.register` 用它作主键。前端只需**一个凭据**：订阅流式事件与中断都走 `taskId` |
| 中断 | `createTaskHandle(() => { sessionManager.cancel(input.taskId); })` → `s.cancelled = true` + `s.abortController.abort()`；收敛由后台执行器完成（`finish(cancelled)`） |
| 进度 | `progress: undefined` → 不确定进度；UI 展示**阶段**：`phase='thinking'` → 「Thinking…」，`phase='responding'` → 「正在响应…」 |
| 阶段同步 | `sessionManager.pushEvent` 收到首个 `text` 增量时把 `phase` 切到 `responding`，然后调 `s.lifecycle?.onPhase?.(phase)` |
| 终态同步 | `sessionManager.finish()` 内调 `s.lifecycle?.onFinish?.(effective)` |
| 回调来源 | `llmExecutor.lifecycleOf(taskId)` 返回 `{ onPhase, onFinish }`，由 **`routes/llm.ts` 注入**到 `sessionManager.begin` 的 `lifecycle` 参数 |

**为什么用注入回调而不是直接依赖**：`session-manager → llm-executor → session-manager` 会成模块环。会话管理器只负责在关键节点调回调，不感知注册表实现；同理 `tasks/llm-bridge.ts` 提供 `setLlmSessionLookup` / `llmSessionLookup`，让 `task-ws.ts` 能读会话快照而不 import `session-manager`（`llm-executor.ts` 在模块加载时注入实现）。

**顺序约束（源码注释强调）**：`sessionManager.finish` 必须**先**调 `lifecycle.onFinish`，**再** `this.sessions.delete(taskId)`。因为 `task-ws` 广播 LLM 终态时经 `llmSessionLookup` **反查活跃会话**提取 `persistPatch/persistRev/persistPrevRev`；若先删会话，广播会因查不到会话而静默丢失，前端在线路径永远等不到 `finished`，节点 Loading 无法收敛。该调用链同步执行（无 `await`），广播期间会话仍在活跃区，无并发窗口。

落盘失败的处理：`completed` 降级为 `failed`（`error = 结果写入画布失败：{msg}`），`cancelled`/`failed` 保持原状态并把错误附加到 `error`。

## 五、远端传输：`ProviderClient` 与三种输出形态

### 5.1 四个方法（`server/src/providers/types.ts`）

| 方法 | 入参 | 出参 | 引擎用法 |
|------|------|------|----------|
| `execute(p)` | `{ workflowId, params?, files?, providerId? }` | `{ taskId }` | Step 1：`wf.submit` 内部调用；`providerId` 是 Bridge 执行接口的保留键（显式指定执行端实例） |
| `poll(taskId)` | 远端任务 id | `{ status, progress?, done, errorMessage? }` | Step 2：`done` 由 provider 判定（如 `status==='completed'\|\|'failed'`） |
| `getOutput(taskId)` | 远端任务 id | `WorkflowOutput \| null` | Step 3：`null` 会被引擎翻译成错误 |
| `cancel(taskId)` | 远端任务 id | `void` | 中断：`workflow-executor.ts` 的 `notifyProviderCancel` 调用 |

### 5.2 `WorkflowOutput` 三形态

| type | 字段 | 引擎写入分支 |
|------|------|--------------|
| `download` | `{ url, filename }` | 裸 `fetch(url)` |
| `fetch` | `{ request: { url, method, headers }, filename }` | 带方法/头部的 `fetch`（鉴权走这里） |
| `body` | `{ contentType, data, filename }` | `Buffer.from(data,'base64')` 直写 |

### 5.3 comfyui-bridge 的具体行为（`providers/comfyui-bridge/client.ts`）

| 环节 | 实现 |
|------|------|
| `execute` | `POST {baseUrl}/api/workflows/{workflowId}/execute`。有 `files` → `FormData`（`params` 为 JSON 字符串字段、`providerId` 为独立表单字段、文件按别名 append，**不手设 Content-Type**，由 fetch 带 multipart boundary）；无文件 → JSON body，`providerId` **后置展开**保证保留键优先于同名工作流参数。返回 `{ taskId: data.task_id }`。**提交无需认证** |
| `poll` | `GET {baseUrl}/api/tasks/{taskId}`，`Authorization: Bearer <token>`；`done = status==='completed'\|\|status==='failed'`；`progress` **仅在 Bridge 上报了数字时才带**（排队期间 Bridge 不报进度，此前 `progress ?? 0` 的写法会让 UI 长时间停在「0%」，已改为缺省），`errorMessage ?? null` |
| `getOutput` | `GET {baseUrl}/api/tasks/{taskId}/output-files` → 取 `files[0]`，相对 URL 拼 `baseUrl` → 返回 **`type:'fetch'`**（`GET` + `Authorization` 头，因为产物下载同样要鉴权）。**无文件返回 `null`** |
| `cancel` | `POST {baseUrl}/api/tasks/{taskId}/cancel`（无认证头） |
| token | `ensureToken()`：`POST /api/auth/login {password}`；**按客户端实例缓存 30 分钟**（有效期未知，保守取值）。引擎每次执行重新 `createClient` ⇒ 配置变更后自动用新配置与新 token |

其余 provider 的输出形态（`grep "type: 'download'|'fetch'|'body'"` 可复核）：`volcengine-ark` 与 `openai-compatible` 为 `download`（有 url）或 `body`（`b64_json`）；`minimax-h3` 为 `download`；`custom` 由用户自定义代码返回 `download`。

工作流层与传输层的分工：`workflows/bridge-client.ts` 是**纯 payload 构建器**（`buildTextToImagePayload` / `buildImageEditPayload` / `buildFirstLastFramePayload` / `buildDirectorPayload` / `buildReferencePayload` / `buildTtsPayload` / `buildTtsClonePayload` / `resolveImageEditSizeParams`），只把 `workflowId + params + files` 组装出来，不再硬编码任何 Bridge workflow id（动态注册见 `workflows/bridge-sync.ts`，`impl = ceb-{instanceId}-{bridgeId}`）。

## 六、常见坑

| 坑 | 现象 | 根因与对策 |
|----|------|-----------|
| **注册表在「引擎开始执行」才登记** | 任务已创建、节点已 Loading，任务管理器里却看不到；服务重启期间同样看不到 | 登记点选在 `runTask` 开头（避免排队任务被误显示为运行中）导致**本地排队窗口（引擎 2s tick）与服务重启窗口对注册表不可见**。凡是要"恢复运行态"的地方都不能只读注册表，必须补查 SQLite `pending\|running`（见 [events.md](./events.md) 的 `collectRunningTasks`） |
| **提前 return 的分支漏收敛注册表** | 任务 SQLite 已终态但注册表仍显示「运行中」→ 任务管理器出现不消失的活跃任务、画布节点 Loading 不消失、同节点后续提交被 `NODE_BUSY` 拒绝（直到服务重启） | `workflowExecutor.finish` 只在 `runTask` 主流程的 completed / failed 两处调用；`tryHandleSceneStageDirectReference` 命中后直接 `return`。**该分支已补 `finish`**（见 §2.9），今后新增任何「在 provider 主流程之前 return」的分支都必须同样补上 |
| **`update` 用 `undefined` 重算可中断性** | 已提交远端的任务又变回「不可中断」 | `workflowExecutor.update` 对缺省字段做回退（`status` ← 注册表、`remoteTaskId` ← SQLite）；调用方只传变化字段即可，不要传 `undefined` 期望"清空" |
| **用旧 params 快照写 `remoteTaskId`** | 同步 provider 任务中断后仍被写成 `completed` | `db.updateTaskParams` 前必须重新 `db.getTask(taskId)` 取最新 params，否则覆盖掉 `cancelRequested` 标记 |
| **`outputPath` 缺失** | 任务在最后一步才失败 | 落盘前才校验 `paramsObj.outputPath`；创建任务时就该保证它有值 |
| **`finish` 必须幂等** | 重复收敛拿到 `null` 被误判 | `registry.finish` 把终态快照留在内部 `finished` Map，重复调用返回同一对象；`update` 对已终态任务直接忽略 |
| **同节点单飞** | 同一节点并发两个任务，产物互相覆盖 | `register` 按 `nodeId` 拒绝（`TaskError('NODE_BUSY')`）+ 全局上限 32（`TASK_LIMIT`）；前端提交前也按节点状态二次拦截 |
| **ffmpeg 模块内直接 `save()`** | 无进度、无法中断 | 必须导出 `buildXxxCommand()` 交给 `ffmpeg-executor`；`save()` 只出现在执行器与显式同步版本里 |
| **中断不删半截产物** | 残留无法播放的 mp4，用户以为成功 | `cancel()` 内 `fs.unlink(outputAbs)`（`removeOnCancel` 默认 true），删除失败仅告警 |
| **`reencode` 拼接的 `duration` 未扣过渡时长** | 进度条到不了 100 或提前跑满 | `buildConcatCommand` 已按 `crossfadeDuration × (段数-1)` 扣除；新增过渡类效果时要同步维护 |
| **取帧任务没有 `duration`** | 进度条一直是"处理中" | `buildExtractFrameCommand` 不返回 `duration` ⇒ `computeProgressPercent` 返回 `null` ⇒ 不确定进度；这是预期行为，不要伪造百分比 |
| **LLM 终态广播丢失** | 前端节点 Loading 不收敛 | `sessionManager.finish` 中 `onFinish` 必须在 `sessions.delete` **之前**调用（task-ws 需要反查活跃会话） |
| **轮询日志不设心跳配置** | 长任务日志看起来"卡住了" | `heartbeatMs` 由系统设置 `taskLog.heartbeatSeconds` 控制（0 = 关闭）；读取失败回退 60 秒且**不阻断任务** |

## 相关文档

- [data-model.md](./data-model.md) —— `tasks` / `task_logs` 表结构、`TaskRecord`、`GenerateStatus`
- [lifecycle.md](./lifecycle.md) —— 任务创建、领取、中断三种语义、重启恢复
- [events.md](./events.md) —— `/llm-ws` 消息协议、`taskSocket`、HTTP 兜底与画布恢复
- [log.md](./log.md) —— 日志分级、轮询降噪、保留期与清理
- [`../canvas/task-architecture.md`](../canvas/task-architecture.md) —— 画布视角的统一任务架构
- [`../workflow-adaptation-guide.md`](../workflow-adaptation-guide.md) —— 新增工作流实现的适配指南
