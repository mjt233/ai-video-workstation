# 创作工作流优化设计

> 日期：2026-08-05
> 关联计划：[docs/plans/feat-workflow-enhance.md](../../plans/feat-workflow-enhance.md)

## 1. 背景与目标

现有工作流系统存在以下局限：

1. **能力声明不足**：视频工作流只能声明 `director` / `audio` 两个布尔能力，无法声明首尾帧模式、参考模式（参考类型与数量上限）、视频最大输出时长等能力。
2. **执行耦合场景概念**：工作流实现（`image-to-video/default.ts`）内部直接读取 `prompt.md`、`script.json`、`voice.md` 等分镜文件，`buildDirectorPayload` 也绑定 episode/shot，无法脱离"集数/分镜"独立提交。
3. **不支持中断**：前端"中断"按钮只停止轮询，后端没有取消端点，任务在 ComfyUI 侧继续执行。
4. **画布无视频生成节点**：资产画布只有图片/文本节点，无法脱离"集数/分镜"独立调用视频工作流。

本设计的目标：

- 视频工作流能力声明增强（首尾帧模式、参考模式、输入音频、最大时长）。
- 工作流执行接口与"场景/分镜/集数"概念解耦，统一自包含提交数据。
- 工作流支持中断（基于 ComfyUI Easy Bridge 的 cancel 接口）。
- 资产画布新增【生成视频】节点，支持图片/音频/视频输入，可嵌入导演台。

## 2. 决策摘要

| # | 决策 | 结论 |
|---|------|------|
| 1 | 文档组织 | 一个设计文档 + 一个实施计划，按阶段推进（后端 → 前端） |
| 2 | 生成模式 | **可组合**：一个视频工作流可同时声明多种模式（导演台/首尾帧/参考），画布节点配置里由用户选择 |
| 3 | 参考模式限制 | 逐工作流声明（详见 3.1） |
| 4 | 执行解耦 | **全量迁移**：分镜/批量路径也走新自包含提交接口；工作流实现内部不再读取 episode/shot 文件 |
| 5 | 画布节点 | 新增 `audio-loader`/`video-loader` 节点原型；`DataType` 扩展为 `image \| video \| audio \| text` |
| 6 | 提交接口 | **方案 A**：扩展 `/workflow/run` + `WorkflowRunContext` 增加类型化 `video` 字段 |
| 7 | 画布端口 | **路径 2**：`video-generate` 声明 3 个严格输入端口（images/videos/audios），输入按目标端口过滤、按组排序 |
| 8 | 连线联动 | 画布节点级**内部事件机制**：连接/断开时统一驱动节点数据更新（如导演台轨道增删素材块） |

## 3. 后端设计

### 3.1 工作流能力声明扩展（`server/src/workflows/types.ts`）

```ts
/** 视频生成模式（可组合声明） */
export type VideoGenerateMode = 'director' | 'first-last-frame' | 'reference'

/** 参考模式能力声明 */
export interface VideoReferenceCapability {
  /** 各参考类型的最大数量（未声明=不支持该类型） */
  types: {
    image?: { max: number }
    video?: { max: number; minDuration?: number; maxDuration?: number }
    audio?: { max: number; minDuration?: number; maxDuration?: number }
  }
  /** 参考素材总数量上限 */
  maxTotal: number
  /** 音频是否不能作为唯一输入（默认 false） */
  audioRequiresVisual?: boolean
}

/** 视频工作流能力 */
export interface VideoCapabilities {
  /** 支持的生成模式（可组合，如 ['director', 'reference']） */
  modes: VideoGenerateMode[]
  /** 是否支持输入音频（供导演台/首尾帧模式使用） */
  audio?: boolean
  /** 参考模式声明（modes 含 reference 时必须提供） */
  reference?: VideoReferenceCapability
  /** 视频最大输出时长（秒，默认 15） */
  maxDuration?: number
}

export interface WorkflowCapabilities {
  /** 旧字段迁移：director 语义并入 video.modes（含 'director'） */
  // director?: boolean  —— 删除
  /** 视频工作流能力（视频类工作流声明） */
  video?: VideoCapabilities
  /** 是否支持传入外部音频（保留，供非视频工作流） */
  audio?: boolean
  /** 是否支持中断（所有 Bridge 工作流声明 true） */
  cancelable?: boolean
}
```

**各实现声明**：

- 现有 `ltx`（image-to-video）：`video: { modes: ['director'], audio: true, maxDuration: 15 }`，`cancelable: true`
- 新增 `minimax-h3-r2v`（image-to-video / impl）：参考模式限制：

  | 项 | 值 |
  |---|---|
  | 图片最大数量 | 9 |
  | 视频最大数量 | 3，每段 2–15s，总时长 ≤ 15s |
  | 音频最大数量 | 3，须与图像或视频一同输入（不能作为唯一输入），每段 2–15s，总时长 ≤ 15s |
  | 参考总数量上限 | 12 |
  | 视频最大输出时长 | 15s |

  ```ts
  video: {
    modes: ['reference'],
    audio: false,
    maxDuration: 15,
    reference: {
      types: {
        image: { max: 9 },
        video: { max: 3, minDuration: 2, maxDuration: 15 },
        audio: { max: 3, minDuration: 2, maxDuration: 15 },
      },
      maxTotal: 12,
      audioRequiresVisual: true,
    },
  }
  ```

`/api/workflows`（`getAllWorkflows`）自动透传 `capabilities.video` 与 `cancelable` 给前端。

### 3.2 统一视频提交数据（自包含，脱离场景概念）

计划中的 `VideoWorkflowSubmitParam<T>` 落实为：

```ts
/** 资产分辨率 */
export interface Resolution {
  width: number
  height: number
}

/** 参考素材 */
export interface VideoReference {
  type: 'image' | 'video' | 'audio'
  /** 项目内相对路径（assert/ 下），服务端 readAssertFile 解析 */
  path: string
}

/** 导演台/首尾帧数据 */
export interface VideoDirectorData {
  /** 关键帧（frameSeq 按数组顺序 0,1,2…，cursor 0~1） */
  frames: Array<{ path: string; cursor: number }>
  /** 音频（可选） */
  audio?: { path: string }
}

/**
 * 统一视频工作流提交数据（自包含，脱离"场景/分镜/集数"概念）。
 * 画布节点直接组装；分镜/批量路径由场景适配层组装。
 */
export interface VideoWorkflowSubmitData<T = Record<string, unknown>> {
  /** 生成模式 */
  mode: VideoGenerateMode
  /** 输出分辨率 */
  resolution: Resolution
  /** 视频帧率（可选，缺省走项目配置） */
  fps?: number
  /** 视频时长（秒） */
  duration: number
  /** 视频生成提示词 */
  prompt: string
  /** 随机种子（可选） */
  seed?: number
  /** 导演台/首尾帧数据（mode 为 director / first-last-frame 时使用） */
  director?: VideoDirectorData
  /** 参考素材（mode=reference 时使用） */
  references?: VideoReference[]
  /** 传递给具体工作流实现的额外参数 */
  extraParams: T
}
```

**执行解耦落地**：

- `WorkflowRunContext` 增加 `video?: VideoWorkflowSubmitData`。
- `POST /workflow/run` 的 `params` 增加 `video`（画布节点直接传路径；服务端 `readAssertFile` 解析为 `File` 后注入 `ctx.video`）。
- 任务 `params` 序列化需包含 `video`：`parseTaskParams` / `toTaskResponse` 同步扩展（`server/src/routes/workflow.ts`）。
- 引擎 `runTask` 构建 context：画布节点任务透传 `params.video`；分镜/批量任务（`vars.episode`/`vars.shot` 存在）由场景适配层生成 `video`。

### 3.3 场景适配层（新 `server/src/workflows/scene-adapter.ts`）

将"根据分镜/集数读取数据"的逻辑从工作流实现中抽离，统一组装 `VideoWorkflowSubmitData`：

```
buildSceneVideoSubmitData(project, episode, shot, deps): Promise<VideoWorkflowSubmitData>
```

处理流程（模式优先级）：

1. **导演台模式**：`prompt/scene/{ep}/{shot}/director.json` 存在且所选实现 `video.modes` 含 `director` → 复用现有 `parseDirectorJson`/`computeFrameDefines` 逻辑生成 `director.frames`（含用户滑块 cursor）与混音 `audio`；duration/width/height/fps 以 director.json 为准。
2. **首尾帧模式**：无 director.json 时 → 读 `stage.json`（跳过 `disabled` 帧）生成 frames，cursor 自动计算（首帧 0、尾帧 1、中间帧均匀分布）；音频策略沿用现有：有 `audioPath`（分镜音频编辑合并产物）直接用，否则拼接 `script.json` 台词 → 调用 TTS 生成音频（voice.md 取声线描述），无台词则不提交音频。
3. prompt 读取 `prompt/scene/{ep}/{shot}/prompt.md`；resolution 缺省走 `projectConfig`。

`buildDirectorPayload`（`director-inject.ts`）被场景适配层吸收或复用其解析/混音助手（`parseDirectorJson`、`computeFrameDefines`、`mixAudioTracks`）。

### 3.4 工作流实现重构（`image-to-video`）

**`default.ts`（ltx）重构**：删除 impl 内部所有文件读取（`readFile(prompt.md)`、`script.json`、`voice.md`、director），只消费 `ctx.video`：

- `ctx.video.mode === 'director'` → `submitLtxDirectorImageToVideo`（frames + cursor + audio）
- `ctx.video.mode === 'first-last-frame'` → `submitImageToVideo`（1~3 帧，首尾帧/中间帧自动映射 I2V/FL2V/FML2V）

**新 `submitReferenceVideo`（`bridge-client.ts`）**：

```ts
interface ReferenceVideoSubmitParams {
  prompt: string
  width: number
  height: number
  duration: number
  seed?: number
  /** 有序参考素材：图片 / 视频 / 音频，各类型序号从 0 独立递增 */
  imageRefs?: File[]
  videoRefs?: File[]
  audioRefs?: File[]
}
```

- 动态文件键：`image_{n}` / `video_{n}` / `audio_{n}`（n 从 0 开始、步长 1、各类型独立计数）
- `params`：`{ prompt, width, height, duration, seed? }`（与计划文档 curl 案例一致，不含 fps）
- 走 `submitComfyuiBridge`（multipart/form-data，方式 B），workflowId 由注册声明提供

**新增实现 `minimax-h3-r2v`**（`image-to-video/minimax-h3-r2v.ts`）：`submit` 只消费 `ctx.video`（reference 模式），校验参考数量/时长约束（读取 `File` 元信息或信任前端校验，时长约束以 Bridge 返回错误为准并在前端先行提示），映射动态文件键后提交。

### 3.5 中断支持

**bridge-client 新增**：

```ts
export async function cancelBridgeTask(taskId: string): Promise<{ status: string }>
// POST /api/tasks/:taskId/cancel
// queued → 直接标记失败（无需通知 ComfyUI）；pending → 向 ComfyUI 发 /interrupt 再标记失败
```

**新端点 `POST /api/workflow/tasks/:taskId/cancel`**（`server/src/routes/workflow.ts`）：

- 任务不存在 → 404
- 任务状态不是 pending/running → 400（已完成/已失败不可取消）
- 任务实现未声明 `cancelable` → 400 拒绝
- 否则调用 `cancelBridgeTask` → 本地任务标记 `failed`（`error_msg` 记录"用户中断"）→ 返回 `{ taskId, status: 'failed' }`

**前端**：`api/workflow.ts` 新增 `cancelWorkflow(taskId)`；`useCanvasGeneration.interrupt` 改为"调用 cancel 接口 + 停轮询 + 状态置已中断"。

## 4. 前端设计

### 4.1 画布基础扩展

**数据类型**：`DataType = 'image' | 'video' | 'audio' | 'text'`（`canvas/types.ts`）。

**新增节点原型**（`canvas/registry.ts`）：

| 原型 | 名称 | 输入 | 输出 | 说明 |
|---|---|---|---|---|
| `audio-loader` | 加载音频 | — | `out: audio` | 仿 `image-loader`，`config.assetPath`，编辑器支持上传（`assert/custom/canvas/`）与选择资产 |
| `video-loader` | 加载视频 | — | `out: video` | 同理 |

- `canvas/generate.ts` 的 `getNodeCurrentAssetPath` 需识别 `audio-loader`/`video-loader`（读 `config.assetPath`）。
- 新增 `AudioLoaderEditor.vue` / `VideoLoaderEditor.vue`（仿 `ImageLoaderEditor`），body 组件 `AudioLoaderNode` / `VideoLoaderNode` 提供对应媒体预览。

**多端口支持重构**（`video-generate` 需要 3 类输入端口）：

- `AssetCanvas.vue`：Handle 由"只渲染 `inputPorts[0]`/`outputPorts[0]`"改为 `v-for` 遍历端口（多端口按顺序垂直分布，单端口行为不变）。
- `canvas/connection.ts`：`canConnectNodes(connections, fromNodeId, toNodeId, nodes, toPortId?)` 增加目标端口参数，按具体端口类型校验（`canConnect` 仍要求类型一致）；`getNodeInputPortId` 改为按端口 id 解析。
- `canvas/useCanvasStore.ts`：`connect(fromNodeId, toNodeId, fromPortId?, toPortId?)` 显式记录端口（Vue Flow `Connection` 自带 `sourceHandle`/`targetHandle`）。
- `canvas/generate.ts`：`collectInputs/collectInputPaths` 增加可选 `portId` 参数按 `c.toPortId` 过滤。

### 4.2 【生成视频】节点

**节点原型 `video-generate`**（`canvas/registry.ts`）：

```ts
{
  id: 'video-generate',
  name: '生成视频',
  icon: 'mdi-video-plus',
  inputPorts: [
    { id: 'images', type: 'image', label: '图片' },
    { id: 'videos', type: 'video', label: '视频' },
    { id: 'audios', type: 'audio', label: '音频' },
  ],
  outputPorts: [{ id: 'out', type: 'video', label: '视频' }],
  resizeable: true,
  bodyComponent: VideoGenerateNode,   // 视频预览 + 生成状态
  editorComponent: VideoGenerateEditor,
}
```

**节点配置 schema**（持久化到 canvas.json）：

```ts
{
  workflowId: string
  workflowImpl: string
  workflowParams: Record<string, unknown>
  mode: 'director' | 'first-last-frame' | 'reference'
  prompt: string
  // 导演台/首尾帧模式：轨道数据，素材以 sourceNodeId 引用连线输入
  director?: {
    duration: number
    width: number
    height: number
    fps: number
    imageClips: Array<{ id: string; sourceNodeId: string; startOffset: number; duration: number }>
    audioClips: Array<{ id: string; sourceNodeId: string; startOffset: number; trimStart: number; trimEnd: number; duration: number }>
  }
  // 输入顺序（参考模式按组过滤使用；沿用现有全局 inputOrder 约定）
  inputOrder?: string[]
}
```

### 4.3 配置组件 `VideoGenerateEditor`

- **工作流下拉**：只列 `image-to-video` 类型的工作流。
- **模式切换**：所选实现声明多种模式（`video.modes.length > 1`）时显示模式选择（导演台 / 首尾帧 / 参考）。
- **导演台 / 首尾帧模式**：嵌入 `VideoDirector`：
  - `VideoDirector` 新增 `standalone?: boolean` prop：隐藏"保存/生成视频"按钮（画布内数据实时写回 config，无需独立保存/生成动作）。
  - `allowAddAsset={false}`：资产来自画布连线，隐藏"添加图片/音频"按钮。
  - 数据流：`config.director` ↔ `DirectorProject` 双向同步（连线驱动增删 + 用户滑块写回，见 4.4）。
  - 分辨率/时长/帧率：`config.director` 初值取项目配置（`project.json`），用户可在导演台内调整。
- **参考模式**：布局仿 `ImageGenerateEditor`：
  - 顶部按 图片 / 视频 / 音频 三组预览缩略图（组内可拖拽排序，写回 `inputOrder`）。
  - 各类型数量上限 / 总上限按所选实现 `capabilities.video.reference` 校验，超限时禁止新增连接（提示）。
  - 底部提示词文本域。

### 4.4 画布节点内部事件机制（连线 ↔ 节点数据联动）

将"连线变化 → 轨道数据同步"提升为**画布节点级事件机制**，由画布统一驱动，编辑器只负责渲染与滑块写回。

**`useCanvasStore` 新增轻量事件订阅**：

```ts
onConnectionsChanged(listener: (e: { type: 'connect' | 'disconnect'; connection: CanvasConnection }) => void): () => void
```

在以下时机统一 emit：
- `connect` 建立连线后
- `disconnect` 删除连线后（含右键断开、选中边删除）
- 删除节点时连带断开其全部连线

**新模块 `canvas/connectionSync.ts` 纯函数**：

```ts
applyConnectionSync(data: CanvasData, event: { type: 'connect' | 'disconnect'; connection: CanvasConnection }): CanvasData
```

- 目标是 `video-generate` 节点时，按 `toPortId` 更新 `config.director`：
  - **connect → `images`**：该 `sourceNodeId` 尚无 imageClip 时追加（默认 `startOffset` 置于当前图片块末尾、`duration = 2s`），不重复。
  - **connect → `audios`**：追加 audioClip（`trimStart/trimEnd = 0`，`startOffset` 置音频块末尾）。
  - **disconnect**：删除 `sourceNodeId` 匹配的 clip（图片/音频均可）。
  - **只增删、不重排**——用户已拖好的滑块位置不受影响。
- 参考模式无需同步：`collectInputs` 本就从连接推导输入，新连接未记录于 `inputOrder` 时自然排末尾。
- 未来其他节点类型需要响应连接变化时，在同一分发处扩展（事件机制通用）。

**store 应用顺序**：`pushHistory()`（结构变更前快照）→ `applyConnectionSync` → 更新节点 config → `markDirty()`（保证撤销可回退联动变更）。

### 4.5 生成与中断接线

**`canvas/videoSubmit.ts` 纯函数** `buildVideoSubmitData(node, inputs, projectConfig): VideoWorkflowSubmitData`：

- **导演台**：`config.director.imageClips` → 按 `sourceNodeId` 解析资产路径，cursor = `startOffset / duration`；`audioClips[0]` → audio；resolution/duration 取 `config.director`，缺省回退项目配置。
- **首尾帧**：图片块按顺序 → 首帧 cursor=0、尾帧=1、中间帧均匀分布；音频同上。
- **参考**：`inputOrder` 按组过滤出有序 `references`；按实现声明校验数量上限（前端提示 + 服务端兜底）。

**`useCanvasGeneration.generate` 增加 `video-generate` 分支**：

- 组装 `VideoWorkflowSubmitData` → `runWorkflow({ project, workflowId, impl, params: { vars, outputPath, userParams, video } })`。
- 产物路径沿用 `canvasNodeAssetPath`（`assert/{scope}/canvas/{nodeId}/v{n}.mp4`），版本历史逻辑复用（`getHistory`/`nextVersion`）。

**中断**：`api/workflow.ts` 新增 `cancelWorkflow(taskId)` → `POST /api/workflow/tasks/:taskId/cancel`；`interrupt` 改为"调用 cancel + 停轮询 + 状态置已中断"。

## 5. 测试策略

### 5.1 后端单测

- 能力声明序列化：`/api/workflows` 透传 `capabilities.video` / `cancelable`。
- 场景适配层：导演台模式（用户 cursor 保留）、首尾帧+TTS 音频、无音频兜底、`disabled` 帧跳过。
- `submitReferenceVideo` 动态文件键映射（`image_0/1/2`、`video_0`、`audio_0/1/2`，各类型独立从 0 计数）。
- cancel 端点：pending → 调 Bridge cancel → 本地 failed；queued → 直接 failed；非 cancelable → 400；已完成 → 400。
- `buildVideoSubmitData` 对应后端校验（数量/时长约束）。

### 5.2 前端单测

- `connection.ts` 端口感知校验（`canConnectNodes` 带 `toPortId`）。
- `collectInputs` 按端口过滤 + 分组排序。
- `canvas/videoSubmit.ts` 三模式组装。
- `canvas/connectionSync.ts`：新增 clip / 断开移除 / 不覆盖用户滑块位置 / 幂等。
- `canvas/registry.ts`：新原型注册（icon/端口）。

### 5.3 浏览器验证（playwright）

**禁止真实操作提交工作流**（mock Bridge 或仅验证 UI/校验层）：

- 新节点原型出现在"添加节点"菜单；连线校验按端口类型生效（image→images、audio→audios，跨类型拒绝）。
- 导演台嵌入：连线自动进轨道、断开自动移除、滑块写回 config、保存后重载恢复。
- 参考模式：三组预览排序、上限校验提示。
- 中断按钮调用 cancel 端点。
- 修改后执行 `npm run typecheck` + `npm run lint`（AGENTS.md 约束）。

## 6. 实施阶段划分

按计划文档要求分两个阶段推进（同一实施计划内的先后任务）：

1. **阶段一（后端）**：能力声明 → 统一提交数据与执行解耦 → 场景适配层 → ltx 重构 + minimax-h3-r2v 参考模式 → 中断支持。
2. **阶段二（前端）**：数据类型与加载节点 → 多端口重构 → `video-generate` 节点与编辑器 → 事件机制 → 生成/中断接线 → 测试。

## 7. 注意事项

1. 开发完成后进行单元测试。
2. 需要进行浏览器模拟操作测试。
3. 禁止真实操作提交工作流（测试中 mock Bridge）。
