## 功能0：工作流引擎接口结构重构

目标：
1. 为当前所有类型的工作流构建统一的接口层
2. 图生视频类型的工作流需要声明是否支持导演台模式，提供一套通用的导演台接口参数。目前已有基于ComfyUI Bridge的LTX-2.3导演台工作流提交函数，可以参考。

目的：
1. 方便后续能直接用同一套接口参数结构来适配不同的工作流提供商
2. 方便在系统的任意位置统一调用不同类型的工作流，动态设置工作流的参数而不是固定从某个配置文件中取值

额外目标：
LTX-2.3导演台工作流需要支持传入音频，存在音频时，由LTX生成音频的参数需要设置为false。


## 功能1：新增一个视频导演台组件

功能类似视频剪辑软件，固定2条轨道，音频轨道 与 图片轨道。
音频轨道的素材块样式为音频的波形图，参考 `AudioEditor.vue`，功能需要与`AudioEditor.vue`完全一致，支持边缘拖拽裁剪音频、调整音频位置功能。

图片轨道的素材块样式为图片预览，横向重复显示，功能与音频轨道一致，可以调整图片在轨道上的位置。图片的起始位置即作该图片作为图生视频的关键帧位置。

视频导演台组件可以播放、暂停，音频的实时播放、时间轴跟随与转跳功能与`AudioEditor.vue`完全一致，但是在轨道上方添加一个预览窗口，显示时间轴当前位置的图片。

用户通过资产选择器任意添加图片和音频资源，并支持在轨道内复制粘贴。

通过props传递以下数据：
- 都传入了哪些图片 和 音频，图片和音频在轨道上的位置、长度
- 视频总长度，单位秒，整数，控制整个轨道长度
- 视频的长宽、fps
- 控制是否为只读模式
- 控制是否允许添加资产（只要不是只读模式，无论是否允许添加资产，都可以调整图片或音频的位置）

导演台配置支持保存和生成视频功能，通过vue事件emit出去，由外部实现保存和生成视频的逻辑

## 功能2：分镜的【视频生成】页签添加视频导演台组件

生成视频时，如果该分镜存在导演台配置数据，且图生视频工作流支持导演台模式，则用上导演台组件的参数来生成视频。

---
## 实现状态（2026-08-04 完成）

✅ **三项功能已全部实现并合并至 master（`--no-ff`）。**

### 设计文档
- `docs/superpowers/specs/2026-08-04-video-director-design.md`
- `docs/superpowers/plans/2026-08-04-video-director.md`

### 关键实现决策
1. **功能0**：统一执行上下文 `WorkflowRunContext`（引擎取数、工作流消费）；`WorkflowDefinition` 新增 `capabilities`（`director`/`audio`）并透传前端 `/api/workflows`；新增 `audio-mix.ts`（ffmpeg 混音，`duration=longest`）、`director.ts`（配置解析+关键帧定义）、`director-inject.ts`（引擎注入 `DirectorPayload`）
2. **功能1**：`frontend/src/components/video-director/`（`VideoDirector`/`DirectorTimeline`/`DirectorImageClip`/`DirectorAudioClip`/`useVideoDirector`/`types`），布局 A（预览置顶+双轨），复用 `PlaybackEngine`/`waveform`
3. **功能2**：`ScenePanel` 视频生成页签内嵌导演台；`api/director.ts`（读/写 `prompt/scene/{ep}/{shot}/director.json`，序列化剥离前端 id）；`GenerateDialog` 支持 `hint` 提示

### 生成判定规则
- 用户手动选择图生视频实现；当 `director.json` 存在 **且** `imageClips.length >= 1` **且** 所选实现 `capabilities.director` 为真 → 引擎注入 `DirectorPayload`（`ltx-2.3-director` 工作流，frames + ffmpeg 混音 audio）
- 否则走普通路径（I2V/FL2V/FML2V + merged.flac/TTS）

### 验证
- 服务端 vitest 41 用例、前端 vitest 101 用例全部通过
- `npm run typecheck`、`npm run lint`（0 error）通过
- 浏览器 E2E：添加图片/保存 `director.json`（id 已剥离）/生成对话框提示「检测到导演台配置，将使用导演台参数生成」均正常

