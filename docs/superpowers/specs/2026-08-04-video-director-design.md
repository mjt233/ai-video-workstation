# 视频导演台（Video Director）设计文档

> 日期：2026-08-04
> 状态：已确认
> 源规划：`docs/plans/video-director.md`

## 1. 目标

在 ai-video-workstation 中实现「视频导演台」：一个类剪辑软件的组件（固定双轨：图片 + 音频），让用户可视化编排图生视频的关键帧与背景音频；并在分镜「视频生成」页签中集成，生成时若存在导演台配置且所选图生视频实现支持导演台，则自动使用导演台参数。

三个功能：
- **功能0**：工作流引擎接口结构重构 —— 统一执行上下文 `WorkflowRunContext`，图生视频声明导演台能力
- **功能1**：新增视频导演台组件（`VideoDirector`）
- **功能2**：分镜「视频生成」页签集成导演台

## 2. 已确认决策（Brainstorming 结论）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 导演台布局 | A：预览置顶居中，双轨（图片+音频）下方，时间轴横贯底部 |
| 2 | 图片块语义 | B：有位置 + 长度（可拖拽/边缘拉伸）；**仅起始位置**作为关键帧，长度只作轨道占位，不参与生成 |
| 3 | 音频轨道素材 | A：纯手动添加（资产选择器），与分镜台词语音（script.json）完全无关 |
| 4 | 功能0 范围 | B：全面重构统一执行参数结构 |
| 5 | 配置存储 | `prompt/scene/{episode}/{shot}/director.json` |
| 6 | 生成时选择 | 用户手动选择图生视频实现；实现声明支持导演台 + 分镜存在 director.json → 自动注入导演台参数 |
| 7 | 多音频合成 | A：服务端 ffmpeg 按 offset/trim 混音成单个音频文件提交 |
| 8 | 页签呈现 | A：导演台内嵌在「视频生成」Tab 中（非全屏对话框） |
| 9 | 功能0 实现 | 方案1：统一执行上下文 `WorkflowRunContext`（引擎取数，工作流消费） |

## 3. 功能0：统一执行上下文

### 3.1 类型定义（`server/src/workflows/types.ts`）

```typescript
/** 工作流能力声明（注册时声明，经 /api/workflows 透传给前端） */
export interface WorkflowCapabilities {
  /** 是否支持导演台模式 */
  director?: boolean;
  /** 是否支持传入外部音频 */
  audio?: boolean;
}

/** 导演台执行负载（引擎从 director.json 解析并注入） */
export interface DirectorPayload {
  /** 视频时长（秒，来自 director.json） */
  duration: number;
  /** 视频宽度（像素） */
  width: number;
  /** 视频高度（像素） */
  height: number;
  /** 帧率 */
  fps: number;
  /** 关键帧：按 startOffset 升序，frameSeq=0..n，cursor=startOffset/duration */
  frames: Array<{ file: File; frameSeq: number; cursor: number }>;
  /** 混音后的音频文件（可选） */
  audio?: File;
}

/** 统一执行上下文（替代现有 WorkflowParams） */
export interface WorkflowRunContext {
  /** 项目名（design 下子目录） */
  project: string;
  /** 项目级配置（auto-injected） */
  projectConfig: ProjectConfig;
  /** 调用方原始业务变量（字符串形态，兼容 DB 序列化） */
  vars: Record<string, string>;
  /** 引擎按需解析的资产文件（key 为资产用途标识） */
  assets: Record<string, File>;
  /** 导演台负载：仅当 director.json 存在且所选实现声明 capabilities.director 时注入 */
  director?: DirectorPayload;
  /** 用户手动传入的工作流参数（按实现声明的 key） */
  userParams?: Record<string, WorkflowUserParamValue>;
  /** 读取项目内文本文件（UTF-8），路径相对 design/{project}/ */
  readFile(relPath: string): Promise<string>;
  /** 读取项目 assert/ 下二进制文件为 File，路径须以 assert/ 开头 */
  readAssertFile(relPath: string): Promise<File>;
}
```

`WorkflowDefinition` 增加 `capabilities?: WorkflowCapabilities`；`submit(params)` 的 `params` 类型由 `WorkflowParams` 迁移为 `WorkflowRunContext`。现有 `WorkflowParams` 保留（`WorkflowRunContext` 为超集），但工作流实现统一迁移到新类型。

### 3.2 引擎职责（`server/src/workflow-engine.ts`）

- 将现有 `enrichImageToVideoParams` 等逻辑收敛为「构建 `WorkflowRunContext`」的统一流程
- **新增导演台检测**：`prompt/scene/{ep}/{shot}/director.json`
  - 启用条件（三者缺一不可）：
    1. `director.json` 存在
    2. `imageClips.length >= 1`
    3. 所选实现（workflowId + impl）声明 `capabilities.director === true`
  - 组装 `DirectorPayload`：
    1. 读取 `imageClips`，按 `startOffset` 升序排列 → 逐个 `readAssertFile` → `frames`（`frameSeq = index`，`cursor = startOffset / duration`，钳制 0~1）
    2. 若 `audioClips` 非空 → 调用 `audio-mix.ts` 的混音函数 → 生成单个音频 `File` → `audio`
    3. `duration/width/height/fps` 以 `director.json` 为准（覆盖 `overview.json` / `projectConfig`）
  - 不满足启用条件 → 不注入 `director`，走普通路径（I2V/FL2V/FML2V + merged.flac/TTS）
- 导演台模式下提示词仍读 `prompt/scene/{ep}/{shot}/prompt.md`

### 3.3 混音助手（新增 `server/src/assets/audio-mix.ts`）

- 输入：`Array<{ file: File | Blob | Buffer; startOffset: number; trimStart: number; trimEnd: number }>`、输出时长
- 输出：混音后的音频（Buffer/Blob）
- 实现要点（复用 `server/src/assets/audio-merge.ts` 的 ffmpeg 模式）：
  - 每段音频先裁剪（`atrim`），再按 `startOffset` 用 `adelay` 定位
  - 用 `amix=inputs=N:duration=longest` 合并（**必须 `duration=longest`**，参考 repo memory：用 `duration=first` 会截断）
  - 最终输出时长不小于 `max(startOffset + 裁剪后时长)`，必要时用 `apad`
- 抽成纯逻辑函数便于单测（参数/命令生成）

### 3.4 工作流迁移

- `image-to-video/default.ts`（impl=`ltx`）：
  - 声明 `capabilities: { director: true, audio: true }`
  - `submit(ctx)`：若 `ctx.director` 存在 → 用 `ctx.director` 的 duration/宽高/fps + `frames`/`audio` + 提示词（`readFile` prompt.md）调 `submitLtxDirectorImageToVideo`；否则走现有 I2V/FL2V/FML2V 路径
- 其余 3 类工作流（text-to-image / image-edit / tts-voice-design）：签名迁移到 `WorkflowRunContext`，行为不变
- `registry.ts`：注册/查询时透传 `capabilities`（`getAllWorkflows` 的返回结构增加 capabilities 字段）

### 3.5 Bridge 客户端（`bridge-client.ts`）

- `submitLtxDirectorImageToVideo` 增加 `audio?: File` 参数：
  - 有音频 → `body.auto_generate_audio = false` + `files.audio = audio`
  - 无音频 → `body.auto_generate_audio = true`（现状）
- 补充单元测试

## 4. 功能1：视频导演台组件

### 4.1 文件结构（新建 `frontend/src/components/video-director/`）

```
VideoDirector.vue      # 主组件（内嵌，非对话框）：工具栏 + 预览 + 双轨 + 时间轴
DirectorTimeline.vue   # 时间轴：刻度、播放头、两条轨道容器、点击转跳
DirectorImageClip.vue  # 图片素材块（缩略图，拖拽/边缘拉伸）
DirectorAudioClip.vue  # 音频素材块（波形，拖拽/边缘裁剪）
useVideoDirector.ts    # 状态管理 composable（复用 audio-editor 模式）
types.ts               # 数据模型
```
复用 `audio-editor/PlaybackEngine.ts` 与 `audio-editor/waveform.ts`。

### 4.2 数据模型（`types.ts`，与 director.json 对应）

```typescript
/** 图片轨素材块 */
interface DirectorImageClip {
  id: string
  path: string        // 相对项目资产路径（assert/...）
  startOffset: number // 秒；关键帧位置
  duration: number    // 秒；轨道占位长度（可边缘拉伸），不参与生成
}
/** 音频轨素材块 */
interface DirectorAudioClip {
  id: string
  path: string
  startOffset: number // 秒
  duration: number    // 原始时长（秒）
  trimStart: number   // 头部裁剪（秒）
  trimEnd: number     // 尾部裁剪（秒）
}
/** 导演台项目（与 director.json 一一对应） */
interface DirectorProject {
  version: number
  duration: number    // 视频总长（秒，整数），控制轨道长度
  width: number
  height: number
  fps: number
  imageClips: DirectorImageClip[]
  audioClips: DirectorAudioClip[]
}
```

### 4.3 Props / Events

```typescript
props: {
  project: string            // 用于 AssetPicker / 资产 URL
  director: DirectorProject
  readOnly?: boolean         // 只读：禁止一切编辑
  allowAddAsset?: boolean    // 是否允许添加资产；非只读时始终可调整位置
}
emits:
  update:director  DirectorProject   // 数据变化（v-model 风格）
  save             DirectorProject   // 保存（外部写 director.json）
  generate         DirectorProject   // 生成视频（外部触发）
```
组件内部维护响应式状态（prop 变化时同步，如切换分镜），变更后 `emit('update:director')`。

### 4.4 交互明细

- **播放**：工具栏 播放/暂停/停止；`PlaybackEngine` 驱动 `currentTime`；时间轴播放头跟随、点击刻度转跳 —— 与 `AudioEditor` 完全一致
- **预览窗口**（轨道上方，布局 A）：显示「最后一个 `startOffset <= currentTime` 的图片块」；无匹配显示占位
- **图片块**：缩略图预览；拖拽调 `startOffset`；边缘拉伸调 `duration`（默认 2s）；同一图片资产可多实例（横向重复）
- **音频块**：波形图；拖拽调 `startOffset`；边缘裁剪 `trimStart`/`trimEnd`（同 `AudioEditor`）
- **添加资产**：工具栏「添加图片/音频」→ `AssetPickerDialog`（按类型过滤）→ 追加到播放头位置
- **复制粘贴**：点击选中（高亮）→ `Ctrl+C`/`Ctrl+V` 同轨道复制（粘贴到选中块 `startOffset + 1s`）；工具栏提供复制/粘贴按钮
- **删除**：选中块 → `Delete` 键
- **只读**：所有编辑禁用；`allowAddAsset=false` 且非只读 → 仅禁用「添加」按钮，位置调整仍可用
- **保存/生成**：工具栏按钮 → emit

## 5. 功能2：视频生成页签集成

### 5.1 `ScenePanel.vue` 视频生成 Tab

- 内嵌 `<VideoDirector>`（布局 A）
- **加载**：切换分镜/进入页签时读取 `prompt/scene/{ep}/{shot}/director.json`；不存在则生成空 `DirectorProject`（`duration` 取 `overview.json.duration`，`width/height/fps` 取 `projectConfig`）
- **保存**：`save` 事件 → `writeFs` 写 `director.json`
- **生成**：`generate` 事件 → 先自动保存 `director.json` → 打开 `GenerateDialog`（`workflow-id="image-to-video"`，`vars={episode, shot}`）→ 用户手动选择实现 → `runWorkflow`
- GenerateDialog 可选提示：检测到导演台配置时显示「将使用导演台参数生成」（纯展示，逻辑由引擎处理）

### 5.2 服务端生成判定（数据流）

```mermaid
flowchart TD
    A[GenerateDialog runWorkflow vars={episode,shot}] --> B[引擎 workflow-engine]
    B --> C{存在 director.json<br/>且 imageClips.length ≥ 1?}
    C -- 否 --> D[普通路径: I2V/FL2V/FML2V<br/>读 stage.json + audio-edit.json]
    C -- 是 --> E{所选实现 capabilities.director?}
    E -- 否 --> D
    E -- 是 --> F[注入 DirectorPayload]
    F --> G[image-to-video submit 检测 ctx.director]
    G --> H[submitLtxDirectorImageToVideo<br/>frames + 混音 audio]
```

### 5.3 关键规则

- **启用条件**：`director.json` 存在 **且** `imageClips.length >= 1` **且** 所选实现声明 `capabilities.director` —— 三者缺一不可，否则走普通路径
- **时长/分辨率**：导演台模式下 `duration/width/height/fps` 以 `director.json` 为准；普通模式保持不变
- **提示词**：仍读 `prompt/scene/{ep}/{shot}/prompt.md`
- **音频**：导演台模式用 `DirectorPayload.audio`（混音产物）；普通模式沿用 merged.flac / TTS，互不影响

## 6. 测试策略

- **后端（vitest）**
  - `bridge-client.test.ts`：`submitLtxDirectorImageToVideo` 补 `audio` 用例（有音频 → `auto_generate_audio=false` + `files.audio`；无音频 → `true`）
  - `audio-mix.ts`：混音参数/命令生成单测（offset/trim → filter 正确性）
  - `workflow-engine`：director 检测与 `DirectorPayload` 组装（排序、cursor、能力过滤、空 imageClips 不注入）
  - 现有 4 类工作流迁移后回归测试保持通过
- **前端**
  - `useVideoDirector.ts` composable 单测：预览当前帧选择、复制粘贴偏移、cursor 映射等纯逻辑
  - 时间轴拖拽/裁剪交互浏览器手动验证
- **收尾**：`npm run typecheck`、`npm run lint`、`cd server && npm test`、浏览器 E2E（编辑→保存→生成）

## 7. 实施顺序

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 功能0 | 统一执行上下文 + capabilities + bridge-client audio + audio-mix.ts + 引擎 director 注入 + 4 类工作流迁移 | 单测通过、普通图生视频回归正常 |
| P2 功能1 | 导演台组件（types → useVideoDirector → DirectorTimeline → 素材块 → VideoDirector 主组件） | 组件可独立渲染、播放/拖拽/复制粘贴可用 |
| P3 功能2 | ScenePanel 页签集成 + GenerateDialog 提示 | 编辑→保存 director.json→生成走 ltx-2.3-director |
| P4 收尾 | typecheck / lint / test / E2E + 更新 `docs/plans/video-director.md` | 全部通过 |

## 8. 范围边界 / 非目标

- 不做 Provider 适配器抽象（YAGNI，当前仅 Bridge 一个提供商）
- 导演台音频与分镜台词语音（AudioEditor）互不关联
- 图片块长度不参与生成参数（仅轨道占位）
- 不新增工作流实现（复用现有 `image-to-video` impl=`ltx`，内部按 `ctx.director` 分流）
