# 资产画布（Asset Canvas）业务逻辑与开发指南

本文说明「资产画布」功能的定位、数据模型、交互行为与开发约定，供后续维护与扩展参考。

系统以**文件系统即数据库**：画布定义（节点、连线、坐标、配置）持久化为 `prompt/` 下的 `canvas.json`；生成产物为 `assert/` 下的图片文件。

---

## 1. 概述与定位

- 入口：分镜（ScenePanel）与场景（StagePanel）详情页的「资产画布」Tab。
- 目的：把「图生图 / 文生图」制作流程可视化 —— 用节点连线表达输入图片与生成节点的数据流，生成产物自动落入分镜/场景资产目录，可一键设为分镜场景图。
- 状态完全由 URL 查询参数驱动（`project` / `type` / `name` / `episode` / `shot`）；切换分镜时画布自动跟随加载（见 §11）。
- 画布定义 `canvas.json` 为纯前端数据，服务端只把它当作普通 `prompt/` 下文件读写，不参与工作流；生成时才通过既有工作流 API 提交任务。

---

## 2. 数据模型与文件布局

### 2.1 画布定义文件

| 画布类型 | 定义文件 | 生成产物根目录 |
|----------|----------|----------------|
| 分镜画布 | `prompt/scene/{集数}/{分镜}/canvas.json` | `assert/scene/{集数}/{分镜}/canvas/` |
| 场景画布 | `prompt/stage/{场景名}/canvas/{子场景标签}.json` | `assert/stage/{场景名}/canvas/{子场景标签}/` |

### 2.2 `canvas.json` 结构（`frontend/src/canvas/types.ts`）

```jsonc
{
  "version": 1,                    // CANVAS_SCHEMA_VERSION，读取时用 migrateCanvasData 迁移/校验
  "kind": "scene",                 // 'stage' | 'scene'
  "nodes": [
    {
      "id": "uuid",                // newId() 生成
      "prototypeId": "image-generate", // 节点原型，见 §3
      "name": "生成图片",            // 节点名称（双击可内联重命名）
      "x": 0, "y": 0,               // 画布坐标
      "width": 240, "height": 160,  // 节点尺寸
      "config": { /* 各原型自定义，见 §3 */ }
    }
  ],
  "connections": [
    { "id": "uuid", "fromNodeId": "a", "fromPortId": "out", "toNodeId": "b", "toPortId": "in" }
  ],
  "createdAt": "ISO", "updatedAt": "ISO"
}
```

### 2.3 生成产物与历史

- 节点产物：`assert/{scope}/canvas/{nodeId}/output.{ext}` —— **固定文件名**（扩展名按原型：图片 jpg / 视频 mp4 / 帧 png / TTS flac，见 `registry.ts` 的 `outputExt`）。"当前结果"即文件系统事实：前端按 `scope + nodeId + outputExt` 恒等推导（`paths.ts: canvasNodeOutputPath` / `generate.ts: getNodeCurrentAssetPath`），**不再读写 `config.current`/`config.history`**（旧数据字段保留兼容读取、不再写入）。
- 历史版本：`assert/{scope}/canvas/{nodeId}/history/output/{时间戳}.{ext}`，由服务端 `assets/history.ts` 统一管理（与分镜场景图/自定义资产同一套机制）：
  - 重复生成时旧产物先**复制**归档进 history 目录（`copyExistingAssetToHistory`，copy 而非 rename → 生成运行期间旧图持续可见），再覆盖固定路径（引擎与 `routes/canvas.ts` 三个同步分支均已接入）；
  - 历史列表/激活/删除走通用 API `GET/POST/DELETE /api/assets/:project/history*`（`listAssetHistory` / `activateHistoryVersion` / `deleteHistoryVersion`，path 参数为固定产物路径）。
- 产物信息（存在性 / mtime / 大小）：`GET /api/canvas/node-info?project=&path=`（fs.stat），前端画布加载与生成完成时刷新，用于预览防缓存 token、按钮文案与「上游已更新」角标。
- 预览 URL：`/api/fs/{project}/{relPath}?t=...`（`preview.ts: buildPreviewUrl`；token 为产物 mtime）。
- **手动上传产物（生成图片/视频节点）**：生成图片/生成视频编辑器提供「上传产物」按钮，把本地图片/视频直接写入节点固定产物路径（`output.jpg` / `output.mp4`）。上传经 `POST /api/canvas/upload`（见 §12）——目标已有产物时**先归档进 history 目录再覆盖**（与重复生成同一套历史机制，可在「历史」对话框查看/激活/删除）；图片接受 jpg/png/webp（统一落盘 `output.jpg`，与 `/assets/upload` 一致），视频**仅接受 mp4**（不转码，其余格式提示先转码）。**反馈**：上传中「上传产物」按钮显示 loading 并禁用（防重复点击，`CanvasEditorPanel` 经 `upload-state` prop 下发），节点卡片叠加进度遮罩（文件名 + 进度条）；成功时 snackbar 提示「上传成功」，覆盖了旧产物时提示「上传成功，原产物已保存为历史版本」（据服务端 `archived` 返回值区分）；失败时节点卡片错误遮罩（含「重试」）+ snackbar。上传进度/失败遮罩复用加载节点同款通用能力（`useCanvasUpload` 按目标路径自动选择端点：`isCanvasNodeOutputPath` 为真走 `/api/canvas/upload`，否则走通用 `/fs/upload`）。生成运行中（loading）上传按钮禁用。

> **异步结果可靠性**：任务由服务端 SQLite 队列独立执行，产物落盘与页面无关；离开画布 / 切换项目 / 关闭浏览器后任务完成，重新进入画布时按固定路径直接可见（无任何元数据回写依赖）。前端轮询（`useCanvasGeneration.poll`）仅负责实时状态展示，纯体验层。
>
> **loading 展示跨页面存活**：节点进入 loading 后，运行中任务会持久化到 localStorage（键 `dsh.asset-canvas.tasks.{project}:{画布定义文件路径}`，记录 nodeId → `{ kind, outputPath, startedAt, taskId? }`）；离开资产画布 / 刷新页面 / 切换画布再回来时 `useCanvasGeneration.restore()` 恢复 loading 展示并继续跟踪：workflow 任务按 taskId 恢复轮询（终态直接收敛），本地 ffmpeg 同步任务按产物 mtime 相对提交前基线的变化探测完成（超时 10 分钟判定中断）。任务到达终态（成功/失败/中断）时删除记录。

---

## 3. 节点类型（`frontend/src/canvas/registry.ts`）

节点原型 `NodePrototype`：`id / name / inputPorts / outputPorts / resizeable / canGenerate / hasHistory / outputExt / defaultConfig / bodyComponent / editorComponent / getOutputAssetPath`。
其中 `canGenerate`（是否支持「重新生成」）与 `hasHistory`（是否有**历史对话框入口**）驱动右键菜单入口显隐：`image-generate`/`video-generate`/`tts-generate` 两者皆真；`video-frame-extract`/`video-concat`/`video-trim`/`audio-trim` 仅 `canGenerate`（无历史对话框入口；但重复执行时旧产物仍会被服务端归档进 history 目录，只是没有 UI 入口查看）。`outputExt`（生成类节点产物扩展名，如 jpg/mp4/png/flac）决定固定产物文件名 `output.{ext}`。

| 原型 | 输入端口 | 输出端口 | 可缩放 | 卡片主体 | 配置组件（editorComponent） |
|------|----------|----------|--------|----------|------------------------------|
| `image-loader`（加载图片） | 无 | `out: image` | 是 | `nodes/ImageLoaderNode.vue` | `editors/ImageLoaderEditor.vue` |
| `audio-loader`（加载音频） | 无 | `out: audio` | 是 | `nodes/AudioLoaderNode.vue` | `editors/AudioLoaderEditor.vue` |
| `video-loader`（加载视频） | 无 | `out: video` | 是 | `nodes/VideoLoaderNode.vue` | `editors/VideoLoaderEditor.vue` |
| `image-generate`（生成图片） | `in: image` | `out: image` | 是 | `nodes/ImageGenerateNode.vue` | `editors/ImageGenerateEditor.vue` |
| `text`（文本） | 无 | `out: text` | 是 | `nodes/TextNode.vue` | 无 |
| `video-generate`（生成视频） | `in: media` | `out: video` | 是 | `nodes/VideoGenerateNode.vue` | `editors/VideoGenerateEditor.vue` |
| `tts-generate`（TTS声音生成） | `in: audio` | `out: audio` | 是 | `nodes/TtsGenerateNode.vue` | `editors/TtsGenerateEditor.vue` |
| `video-frame-extract`（获取视频帧） | `in: video` | `out: image` | 是 | `nodes/ExtractFrameNode.vue` | `editors/ExtractFrameEditor.vue` |
| `video-concat`（拼接视频） | `in: video` | `out: video` | 是 | `nodes/ConcatVideoNode.vue` | `editors/ConcatVideoEditor.vue` |
| `video-trim`（裁剪视频） | `in: video` | `out: video` | 是 | `nodes/TrimVideoNode.vue` | `editors/TrimVideoEditor.vue` |
| `audio-trim`（裁剪音频） | `in: audio` | `out: audio` | 是 | `nodes/AudioTrimNode.vue` | `editors/AudioTrimEditor.vue` |

- **加载图片**：`config.assetPath` 绑定一张既有资产（上传到 `assert/custom/canvas/` 或从资产选择器选择）；点击节点出现的配置组件可预览当前图并「上传图片 / 选择资产」。
- **加载音频**：`config.assetPath` 绑定一段音频（上传到 `assert/custom/canvas/` 或从资产选择器选择）。该节点打开的资产选择器额外提供「音频」页签（台词音频/分镜自定义/全局自定义），且「角色」页签在选择角色后会展示**音色**分区（`assert/character/{角色}/voice.flac` 由 character-voice 任务生成；`assert/character/{角色}/voice-variants/{变体id}.flac` 为角色**声音变体**，见 `docs/asset-layout.md`，均已生成才列出），与外观图一起可选；图片类节点（image-loader）的选择器不显示音色与音频页签（`AssetCanvas.openAssetPicker` 按 `prototypeId === 'audio-loader'` 决定 `showVoice` 与页签列表）。
- **加载视频**：`config.assetPath` 绑定一段视频（上传到 `assert/custom/canvas/` 或从资产选择器选择）。该节点打开的资产选择器额外提供「分镜视频」页签（`VideoPicker`）：列出 `assert/scene/{集}/{分镜}/video/` 目录下的全部视频（`{index}.mp4`），目录为空时兼容回退旧版 `video.mp4`；分镜画布（`kind === 'scene'`）下编辑器提供「设为分镜视频」，把当前视频复制为 `assert/scene/{集}/{分镜}/video/0.mp4`（服务端批量生成 `discovery.ts` 也输出到该路径）。
- **三种加载节点均可选道具**：资产选择器新增「道具」页签（`PropPicker.vue`：分类 → 道具 → 资产三级选择），按节点类型过滤媒体——加载图片只列道具图片产物（`assert/prop/{分类}/{道具}/` 下图片）、加载视频只列视频产物、加载音频只列音频产物（见 `docs/asset-layout.md` 2.3 道具）。道具页签媒体过滤由 `useCanvasDialogs.openAssetPicker` 记录的 `picker.mediaKind` 驱动，经 `AssetPickerDialog` 的 `media-kind` prop 透传。
- **三种加载节点打开的资产选择器「自定义资产」页签为目录浏览器**（`asset-picker/CustomAssetsGrid`）：以 `assert/custom/` 为根，可逐层进入子目录，经顶部**面包屑**（各分段可点击）与返回上级按钮跳回任意层级。目录内文件按节点媒体类型过滤——以**可接受扩展名列表（忽略大小写）**判定（`AssetPickerDialog` 把自身 `mediaKind` 映射为扩展名：加载图片=图片扩展名并以缩略图网格展示，加载音频/视频=对应扩展名并以图标行展示）；打开对话框时若节点当前绑定资产（`config.assetPath`）位于 `assert/custom/` 内，自动定位到其所在目录并高亮该文件。
- **生成图片**：配置组件采用统一生成节点布局——`CanvasInputPreview` 输入预览（图片类型；无输入时显示「无输入图，默认使用文生图工作流」）+ 提示词字段 + 参数行（工作流类型/工作流实现两个紧凑下拉、输出尺寸 `WorkflowSizePicker`、工作流参数 `WorkflowParamsTrigger`，后两者均为点击弹出菜单式配置，见 §6.1）。`config` 含 `prompt`（提示词）、`workflowId` / `workflowImpl`（有输入图用 `image-edit`，否则 `text-to-image`；`workflowImpl` **须显式选择**，未选择时生成被前端校验拦截，后端也不再兜底）、`workflowParams`（用户参数）、`sizeConfig`（输出尺寸）、`inputOrder`（输入图顺序，见 §7）。产物固定 `output.jpg`。配置面板提供「上传产物」按钮（jpg/png/webp → 统一落盘 `output.jpg`，旧产物自动归档历史，见 §2.3）。
- **生成视频**：`config` 含 `workflowId`（默认 `image-to-video`）、`workflowImpl`（**须显式选择**，未选择时生成被前端校验拦截）、`mode`（`director` / `first-last-frame` / `reference`）、`prompt`、`director`（导演台工程，见 `videoTypes.ts`）、`duration`（首尾帧/参考模式时长，秒）、`resolution` / `sizeConfig`（输出尺寸）、`workflowParams`、`inputOrder`。单一 `media` 输入口，素材类型由来源节点自动归类。**非导演台模式（首尾帧/参考）采用统一布局**（见 §6.1）：`CanvasInputPreview` 输入预览（图片/视频/音频分组，无对应输入不显示）+ 提示词 + 参数行（生成模式**位于工作流之前**、工作流、时长 `DurationPicker`、输出尺寸、工作流参数、全屏按钮）。`director` 模式保持内嵌导演台布局（首行工作流/模式/全屏 + 输出规格 + 参数表单 + `VideoDirector`），仅把时长输入框换成 `DurationPicker`；分镜画布下提供「设为分镜视频」（把当前产物复制到 `assert/scene/{集}/{分镜}/video/0.mp4`）。产物固定 `output.mp4`。配置面板提供「上传产物」按钮（**仅接受 mp4**，旧产物自动归档历史，见 §2.3）。
- **TTS声音生成**：`config` 含 `mode`（`clone` 音色克隆 / `design` 音色设计）、`text`（朗读文本）、`refText`（克隆参考文字）/ `prompt`（设计声线描述）、`workflowImpl`（**须显式选择**）、`workflowParams`。配置组件同样采用统一布局——`CanvasInputPreview` 输入预览（音频类型，克隆模式需连接「加载音频」节点）+ 文本字段 + 参数行（工作流实现 + 工作流参数；**TTS 不显示时长与输出尺寸**）。
- **拼接视频**：`config` 含 `inputOrder`（拼接顺序，编辑器内 `VideoRefInputGroup` 拖拽排序）。单一 `video` 输入口，同一端口可连多段视频（无输入上限校验）；编辑器「拼接」按钮经父级 `@generate` 路由到服务端 `POST /api/canvas/concat-video`（本地 ffmpeg，concat demuxer + `-c copy` 无损拼接，各段编码/分辨率/帧率/音轨结构须一致，不一致返回清晰中文错误）；产物固定 `output.mp4`，重复拼接旧产物自动归档进历史目录。
- **裁剪视频**：`config` 含 `startMode`（`time` / `frame`）、`startValue`（秒可小数，或帧索引整数 ≥ 0）、`duration`（秒，> 0 可小数）。单一 `video` 输入口（多路只取第一路）；编辑器「裁剪」按钮经父级 `@generate` 路由到服务端 `POST /api/canvas/trim-video`（本地 ffmpeg **重编码**，不用 `-c copy`，保证帧索引 / 小数秒切口准确：`libx264 veryfast crf=18`，有音轨则 `aac`）。起点 + 时长超出片尾时截到剩余时长。产物固定覆盖 `output.mp4`，重复裁剪旧产物自动归档（**裁剪也有历史**，与其余节点一致）。节点卡片与配置面板均可预览裁剪结果。
- **裁剪音频**：`config` 含 `startValue`（起始位置，秒可小数 ≥ 0）、`duration`（裁剪时长，秒 > 0 可小数）。单一 `audio` 输入口（多路只取第一路）；编辑器「裁剪」按钮经父级 `@generate` 路由到服务端 `POST /api/canvas/trim-audio`（本地 ffmpeg 重编码为 **FLAC 无损输出**，不用 `-c copy`，保证小数秒切口准确）。起点 + 时长超出片尾时截到剩余时长（编辑器在源时长已知时提前给出越界提示；源时长由输入音频 ffprobe 探测）。产物固定覆盖 `output.flac`，重复裁剪旧产物自动归档（与其余 ffmpeg 节点一致，无历史对话框入口）。输出 `audio` 可直接接到 TTS/生成视频等音频消费节点；编辑器提供「使用当前播放位置」把预览播放时间写入起始位置。
- **文本**：`config.text`，可编辑纯文本；当前仅作为 text 类型数据流锚点。文本域带 Vue Flow 约定类 `nodrag` / `nowheel`：在文本域内拖拽是选择文本（不移动节点），滚轮滚动是滚动文本内容（不缩放画布）。

---

## 4. 连线规则（`frontend/src/canvas/connection.ts`）

- 按**端口数据类型**判断兼容（ComfyUI 思路），v1 仅支持同类型：`image→image`、`text→text`。
- `canConnectNodes` = 类型兼容 + 不成环（`wouldCreateCycle` 反向可达性检测）+ 目标输入未满。
- 建立连线：从源节点输出手柄拖到目标节点输入手柄（`@connect` → `store.connect`）；连接失败静默忽略。
- 断开连线：
  - 右键连线 → 「断开连接」（`@edge-context-menu`，需 `event.preventDefault()` 阻止浏览器默认菜单）；
  - 右键节点 → 「断开连接」（断开该节点全部连线）；
  - 选中连线后按 `Delete`；
  - **编辑器输入缩略图右上角红色 x → 快捷断开该输入**（生成图片/生成视频/拼接视频节点）：悬浮缩略图时显示，点击即断开该来源节点→本节点的连线并同步清理 `config.inputOrder` 中该来源 id（`nodeOps.disconnectInput` → `store.disconnect` + `removeInputOrderEntry`，两者合并为单次撤销，Ctrl+Z 可整体恢复；生成视频节点经 connectionSync 自动移除导演台对应素材块）。

---

## 5. 画布交互

| 交互 | 行为 |
|------|------|
| 点击节点 | 选中 + 显示配置面板（有 editorComponent 时）；**多选下普通单击切换为仅选中该节点** |
| `Ctrl`+点击节点 | 增/减选该节点（多选） |
| `Ctrl`+空白处左键拖动 | **框选多个节点**（Vue Flow 内置框选：selectionKeyCode/multiSelectionKeyCode 经 `setState` 写入 `Control`，避免运行时 prop 类型告警；`selection-mode` 为 Partial——**与节点存在交集（无需完全覆盖）即选中**）；框选结束（`@selection-end`）后应用级多选与 Vue Flow 内部选中态双向同步 |
| 多选（≥2 个节点） | 显示**群组虚线框**（合成节点 `__group-frame`，位于节点下层，与边缘节点保留 12px 流坐标留白 `GROUP_FRAME_PADDING`）+ 右侧垂直居中的**输出连接圆点**（合成节点 `__group-dot`，位于全部节点上层）。原生多选包围框被样式隐藏（避免覆盖节点点击），由合成节点替代 |
| 拖动群组虚线框 | **整体移动全部选中节点**（框架节点 `draggable`，Vue Flow 原生拖动携带全部选中节点；结束经 `store.updateNodes` 单次撤销快照批量回写） |
| 右键群组虚线框 | 组菜单：复制 / 删除（删除整组一次确认） |
| 群组输出圆点拖拽 | 从圆点拖出预览虚线（SVG）→ 悬停目标节点高亮（绿色描边）；释放：① 命中其他节点（流坐标包围盒命中）→ **成组连接**（类型兼容/成环/目标在组内/重复连线逐源校验，失败源忽略 + snackbar 气泡提示原因）；② 未命中任何已有节点（拖拽位移 > 6px 最小判定，区分点击圆点）→ 弹出「选择目标节点」菜单（全部有输入端口的原型：生成图片/生成视频/TTS/获取视频帧/拼接视频/裁剪视频，按群组输出类型兼容性过滤，不兼容项置灰并注明原因），选中后在释放点创建该节点并把全部兼容源连接到新节点输入口（不兼容源忽略 + 气泡提示），随后单选新节点（不自动弹配置面板）；③ 位移 ≤ 6px（视作点击圆点）→ 取消 |
| 双击节点名称 | 内联重命名（回车/失焦提交、Esc 取消、空名放弃） |
| 拖拽节点 | 移动位置，结束回写 store（防误触：拖拽中隐藏配置面板）；**拖动选中节点时 Vue Flow 原生把全部选中节点一起移动**（结束批量单次撤销） |
| 悬浮/选中节点后拖拽边缘或四角 | 调整节点大小（**全部节点类型**可缩放，最小 120×80px，`@vue-flow/node-resizer` 渲染控制点；缩放中控制点保持可见，结束才回写 store） |
| 右键节点 | 菜单：重新生成 / 历史 / 保存为（hover 子菜单：角色设计 / 角色设计-衍生变体 / 场景图 / 场景图-衍生变体 / 自定义资产，仅输出类型为图片且有产物的节点显示）/ 断开连接 / 重命名 / 复制 / 删除（删除需 `confirm` 确认）。**右键节点时切换为单选该节点** |
| 右键连线 | 菜单：断开连接 |
| 单击空白 | 取消选中、关闭菜单 |
| 双击空白 | 在鼠标双击处弹出「添加节点」VMenu（选择节点原型后在该处添加节点） |
| 适应视图 / 放大 / 缩小 | 工具栏按钮（`fitView` / `zoomIn` / `zoomOut`）；适应视图按全部节点包围盒居中并缩放落入可视区（padding 0.2、maxZoom 1，不放大超过 100%） |
| 滚轮 | 空白/节点上滚动 = 缩放画布；文本节点文本域上滚动 = 滚动文本（`nowheel` 类豁免缩放） |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销 / 重做（输入框聚焦时跳过） |
| `Ctrl+C` / `Ctrl+D` | 复制选中节点（1 个或多个，**含组内连线**）到画布内部剪贴板，并同步把「节点复制标记 + JSON」写入系统剪贴板（覆盖剪贴板旧内容，与主流节点编辑器复制语义一致；无剪贴板 API 时静默降级为仅内部剪贴板） / 复制粘贴（重复节点/整组） |
| `Ctrl+V` | 粘贴剪贴板内容，按类型分派：**画布内复制的节点标记 → 粘贴节点（单/多节点，最高优先级，不会被剪贴板中残留的旧文本/文件抢占；也支持跨画布/刷新后粘贴，节点 JSON 从系统剪贴板解析；多节点粘贴**重建组内连线，并重映射 `config.inputOrder` 与导演台素材块 `sourceNodeId`**）**；图片/视频/音频文件 → 上传到 `assert/custom/canvas/` 并创建对应加载节点（可视区中心错位摆放）；文本 → 创建文本节点并写入文本；剪贴板为空不派发 paste 事件时由 keydown 兜底粘贴内部复制的节点。粘贴的新节点**自动聚焦**（全部选中，显示可调整大小的边框与缩放控制点，应用级选中使 Delete/复制快捷键可用），且**不自动打开配置面板**（仅用户点击节点才打开） |
| `Delete` / `Backspace` | 删除选中节点（1 个显示节点名、多个显示数量，均 `confirm` 一次确认；整组删除单次撤销）或选中连线 |
| `Esc` | 关闭右键菜单 / 取消内联重命名 |
| 节点处于 loading（`status = running`） | **通用能力**：`CanvasNodeCard` 在节点内容上叠加半透明遮罩 + 加载动画 + 最近日志 + 「中断」按钮（统一中断入口）；error 时叠加错误遮罩 + 「重试」。loading 任务持久化于 localStorage，离开画布/刷新后未完成任务继续显示 loading（见 §2.3 / §8） |
| 加载节点上传文件（「上传图片/音频/视频」按钮或粘贴媒体） | **节点内上传进度条（通用能力，`useCanvasUpload` 状态驱动）**：上传中节点卡片叠加进度遮罩（文件名 + `v-progress-linear` + 百分比/已传大小，总大小未知时显示不确定进度条）；失败时叠加错误遮罩（错误文案 + 「重试」按钮，沿用原文件与目标路径重传）+ snackbar 提示，遮罩 8s 后自动消失；成功遮罩消失、节点立即展示新资产。粘贴媒体先创建空加载节点再逐个上传（进度显示在各节点上，全部完成后 snackbar 汇总），上传失败保留空节点可直接重试/选资产 |

> Vue Flow 绑定注意：勿用 `v-model:nodes/edges` 绑 computed（会报 readonly 写入错误），用单向 `:nodes/:edges` + `@node-drag-stop` 回写 + `@edges-change`(remove) 同步删除。

---

## 6. 配置面板（`CanvasEditorPanel.vue` 实现，由 AssetCanvas 编排）

- 独立悬浮于节点下方的面板（不随节点尺寸撑大），渲染选中节点的 `editorComponent`；组件常驻挂载，显隐由 `visible` prop 驱动，`<Transition>` 与定位逻辑在组件内部。
- **固定大小不随缩放**：宽度为固定屏幕像素（普通节点 440px、生成图片节点 560px、生成视频节点 720px，见组件内常量 `EDITOR_PANEL_WIDTH[_GENERATE/_VIDEO]`），上限高度 65vh（超出滚动），间距 12px（`EDITOR_PANEL_GAP`）；仅**位置**随节点/视图联动（水平中心与节点中心对齐），视口与画布可视区尺寸由 AssetCanvas 以 props 传入（`viewport`/`flowWidth`/`flowHeight`）。
- **边界钳制**：优先放节点下方；放不下且上方有空间则翻转到节点上方；仍放不下则把面板底部钳到画布可视区内（必要时与节点重叠）。钳制用 `flowEl.clientHeight/Width`（AssetCanvas 的 ResizeObserver 监听 `flowEl`）+ 面板自身高度（面板组件 ResizeObserver 监听 `panelEl`）测量，勿用 Vue Flow `dimensions`（不可靠）。
- **淡入淡出**：`<Transition name="editor-panel">` + CSS（opacity 0.18s + `translateY(6px)`）；关闭淡出期间用 `lastPanelStyle` 缓存保持原位不跳位（缓存写在 `watch(editorPanelStyle)`，勿在 computed 内写副作用，会触发 eslint `vue/no-side-effects-in-computed-properties`）。
- 拖拽节点时 `suppressEditor=true` 隐藏面板，仅点击节点才显示。
- 程序化选中（粘贴自动聚焦等）置 `suppressPanelOnSelect=true` 抑制面板自动弹出；`onNodeClick`/`onPaneClick`/切换目标时复位。粘贴聚焦通过 `addSelectedNodes`（`useVueFlow`）写入 Vue Flow 内部选中态，需先 `await nextTick()` 等内部 nodeLookup 应用新节点。
- 面板根元素需绑定 `ref="panelEl"`（高度测量）。

### 编辑器组件（editorComponent）约定

- props：`project`、`node`、`inputs`（`CanvasInputInfo[]`，仅生成节点用到）、`isRunning`、`output`（`{ path, token? } | null` —— 当前产物固定路径 + 防缓存 token（产物 mtime），由 AssetCanvas 按 node-info 推导下发，优先于 `config.current` 旧数据）；生成节点另有 `outputPath`（固定产物路径，由 AssetCanvas 按 scope+nodeId+扩展名恒等推导，**文件不存在也有值**，作「上传产物」目标路径）；生成图片编辑器另有 `kind`（画布类型，`ImageGenerateEditor` 用它让「设为分镜场景图」按钮仅分镜画布显示）；视频生成/拼接编辑器另有 `imagesInputs` / `videosInputs` / `audiosInputs`（三组输入，按 `config.inputOrder` 排序，编辑器统一传入）。
- emits：
  - `update:config(patch)` —— 合并写入节点 config（由 `useCanvasNodeOps.onUpdateConfig` 处理，AssetCanvas 接线）；
  - `generate(nodeId)` / `interrupt(nodeId)` / `open-history(nodeId)` / `set-as-scene(nodeId)`；
  - `open-picker(nodeId)` —— 打开资产选择器（加载图片编辑器使用）；
  - `upload-file(nodeId, file, dest)` —— 上传文件：加载节点（加载图片/音频/视频编辑器与节点 body 使用）dest 为 `assert/custom/canvas/` 目标，成功后回写 `config.assetPath`；生成图片/视频节点（「上传产物」按钮）dest 为节点**固定产物路径**（`output.jpg` / `output.mp4`），服务端归档旧产物后覆盖，成功**不回写 config**（固定路径即文件系统事实），仅刷新 node-info。上传进度由 `useCanvasUpload` 管理并渲染在**节点卡片遮罩**上（编辑器不自行显示进度）；编辑器「上传产物」按钮的 loading/禁用由父级经 `uploading` prop 下发（`CanvasEditorPanel` 按 `upload-state` 推导）；成功/失败 snackbar 由组合式统一提示；
  - `disconnect-input(sourceNodeId)` —— 输入缩略图红色 x 快捷断开（生成图片/生成视频/拼接视频/TTS 编辑器使用，见 §4/§7）。
- 新增编辑器时需在 `registry.ts` 为原型挂 `editorComponent`；若用到资产选择器，`AssetCanvas` 的编辑器面板接线（`CanvasEditorPanel`）需给 `@open-picker="openAssetPicker"`。

### 6.1 生成节点统一布局

生成图片 / 生成视频（非导演台模式）/ TTS 三个生成节点的配置组件采用统一骨架：**输入预览 → 提示词/文本字段 → 参数行**，让用户聚焦 prompt 编写与输入资源，其余细节参数收纳进可开关的菜单中调整。

- **输入预览**（`editors/CanvasInputPreview.vue`）：按图片/视频/音频三组展示连接到的输入资源（内部复用 `editors/VideoRefInputGroup.vue`），**仅该类型存在输入时渲染对应组**（无输入不显示条目），全部为空时显示占位文案；组内拖拽排序（`reorder` 事件上报本组新顺序，编辑器经 `mergeInputOrder` 合并回全局 `config.inputOrder`）+ 悬浮放大 tooltip（图片/视频/音频可播放）+ 缩略图右上角红色 x 快捷断开（`disconnect-input`）。
- **参数行**（各编辑器内 `.generation-params-row` 紧凑横排，空间不足自动换行）：
  - 工作流：生成图片 = 工作流类型 + 工作流实现两个紧凑下拉；生成视频 = 单个工作流下拉（模式放其前）；TTS = 单个工作流实现下拉；
  - `DurationPicker`（`components/DurationPicker.vue`，时长）：**仅生成视频节点显示**；点击触发行弹出菜单——1~15 秒按钮组（点击即选即关）+ 手动输入（支持小数秒，回车/「应用」确认，非法忽略）；写回按生成模式走 `config.director.duration` / `config.duration`；
  - `WorkflowSizePicker`（输出尺寸）：**仅生成图片/视频节点显示**，点击弹出菜单（比例/分辨率/自定义宽高），图片节点直接绑 `config.sizeConfig`；
  - `WorkflowParamsTrigger`（`components/WorkflowParamsTrigger.vue`，工作流参数）：点击触发行弹出菜单，菜单内嵌 `WorkflowParamsForm`；触发行显示「工作流参数」+ 已配置非默认参数数量徽标。
- **导演台模式例外**：生成视频的 `director` 模式保持内嵌导演台布局（首行工作流/模式/全屏、输出规格、内嵌参数表单、`VideoDirector`），仅把「时长(秒)」输入框换成 `DurationPicker`。

---

## 7. 输入预览（`CanvasInputPreview.vue`，生成节点统一输入区）

- 生成图片/生成视频（首尾帧、参考）/TTS 三个生成节点的配置组件顶部统一由 `CanvasInputPreview` 渲染输入预览：按**图片/视频/音频**三种类型分组（每组复用 `editors/VideoRefInputGroup.vue`，标题形如「图片（2/4）」，前缀 图/视/音，或按模式定制如 帧、图像），**仅存在对应输入的组才渲染**（如生成图片节点只有图片组、TTS 只有音频组、首尾帧只渲染帧图片+可选音频）；全部为空时显示编排编辑器传入的占位文案（如生成图片的「无输入图，默认使用文生图工作流」、TTS 克隆模式的「需先连接加载音频节点」）。
- 悬浮放大：`v-tooltip location="top"` 显示放大内容（图片最大 320px、视频/音频可播放），悬浮在输入**上方**；tooltip 必须带 `interactive`（非交互态内容 `pointer-events: none`，鼠标悬停其上会穿透关闭、无法交互）并配 `close-delay`（宽限指针从缩略图移入内容的时间；进入后由 Vuetify open-on-hover 保持打开，视频/音频可点击播放、拖进度条）。
- 悬浮快捷断开：输入缩略图右上角悬浮显示红色 x，点击断开该输入连接（见 §4；`remove` 事件 → `disconnect-input`）。
- 拖拽排序：组内 HTML5 DnD，容器 `dragover` 按鼠标水平位置计算插入下标并高亮插入位置；drop 后 `reorder` 事件上报本组新 nodeId 顺序，编辑器经 `mergeInputOrder` 合并回全局 `config.inputOrder` 持久化（只影响本组相对顺序，其他组保持不动）。
- 顺序生效点：`generate.ts: collectInputs / collectInputPaths` 遵循 `config.inputOrder`（未记录的节点按连接顺序排末尾）；生成节点发起生成时也会把该顺序的输入图传给 `image-edit` 工作流。
- 顺序生效点：`generate.ts: collectInputs / collectInputPaths` 遵循 `config.inputOrder`（未记录的节点按连接顺序排末尾）；生成节点发起生成时也会把该顺序的输入图传给 `image-edit` 工作流。

---

## 8. 生成流程（`frontend/src/canvas/useCanvasGeneration.ts`）

1. `generateNode(nodeId)`（`composables/useCanvasNodeOps.ts`，按原型分发）：收集输入图路径（`collectInputPaths`，含顺序）→ `gen.setInputPaths` → `gen.generate`。
2. `generate`：
   - `image-edit`：`vars = { prompt, imagePaths: JSON.stringify(inputPaths), purpose: 'canvas-image' }`；
   - `text-to-image`：先把 prompt 写入节点目录的 `prompt.md`，`vars = { promptPath, purpose: 'canvas-image' }`。
   - 产物路径 `computeOutputPath`：**固定文件名** `output.{ext}`（扩展名取原型 `outputExt`，无版本号计算）。
3. 提交后轮询 `poll`（2s，首轮立即查一次）：**服务端终态为 `completed` / `failed`**（无 success/error）。轮询**只更新 `statusByNode` 展示**，成功时经 `onResult(nodeId, outputPath)` 回调通知 UI 刷新（AssetCanvas 更新节点产物信息 node-info）；**不回写 `config.current`/`config.history`**——结果落盘由服务端完成，页面离开/关闭后结果依然存在。
4. 状态机：`statusByNode[nodeId]` = `running | success | error`。
   **loading 是节点的通用能力**（不再是某类节点私有）：`CanvasNodeCard` 统一按 `status` prop 在节点内容上叠加遮罩——`running` 显示加载动画 + 「中断」按钮，`error` 显示错误信息 + 「重试」按钮；各节点 body 组件不再自行渲染遮罩，生成视频等原先无遮罩的节点也自动获得 loading 展示。配置面板编辑器的 `isRunning` 展示与中断按钮不变。
5. 运行中任务持久化（见 §2.3）：`generate` 提交成功后、ffmpeg 同步任务请求发出前，把 `{ kind: 'workflow', taskId, outputPath, startedAt } | { kind: 'ffmpeg', outputPath, startedAt, baselineExists, baselineMtime }` 写入 localStorage；`restore()`（画布加载与 `switchTarget` 时调用）恢复未终态任务的 loading 展示与跟踪，终态收敛时经 `onResult` 刷新产物并删除记录。
6. 中断 `interrupt`（**统一入口**，节点卡片「中断」/编辑器「中断」均走这里）：workflow 任务清轮询、置已中断并调用服务端 cancel 端点（仅 cancelable 工作流可真正取消）；ffmpeg 同步任务无服务端取消接口，停止本端探测并置已中断（若同会话请求随后成功返回，以真实成功态收敛）。中断同时删除持久化记录。
7. 获取视频帧 / 拼接 / 裁剪（同步 ffmpeg 路由）：成功后同样只更新状态并回调 `onResult`；重复执行时服务端自动把旧产物归档进历史目录。

---

## 9. 自动搭画布（`frontend/src/canvas/autobuild.ts`）

- 工具栏「自动搭画布」：
  - **分镜画布**：根据分镜 `stage.json` 收集引用（场景/角色/变体/custom，`prev` 异步解析为上一分镜最后一帧）→ 生成「加载图片锚点 + 生成图片」结构 → 幂等应用（不重复添加已有引用）。引用解析规则与 `server` 的 `resolveStageAssetPath` / `resolveCharacterAssetPath` 对齐（见 `resolveShotStageRef` / `resolveCharacterRef`）。
  - **场景画布（按子场景）**：读 `prompt/stage/{场景}/variants/{标签}/` 下全部 `{id}.json` 变体元数据 → `buildSubSceneAutoCanvas` 搭建「基础加载图片（所有根变体共用）+ 每个变体一个生成图片（prompt = desc，`config.autoRef` 幂等）+ 变体 refs 加载图片（同资产共享）」→ 幂等应用（已存在节点只补缺连线）。
- 生成节点 prompt：分镜画布取 `overview.json.visual`；场景画布各变体取各自 `desc`。

---

## 10. 设为分镜场景图

> **历史对话框**：生成节点「历史」打开的是独立组件 `CanvasAssertHistoryDialog.vue`（`components/canvas/` 下）：左侧大图预览 + 右侧历史列表（当前产物虚拟项 + 服务端历史目录条目，按时间戳文件名/生成时间展示）；点「设为当前」→ 服务端 `POST /api/assets/:project/history/activate`（history 文件换回当前产物固定路径），成功后通知父级刷新产物展示；点「删除」→ `confirm` 弹窗确认 → `DELETE /api/assets/:project/history` 删除历史文件，对话框保持打开并刷新列表。**历史数据完全由服务端管理，前端不再维护 `config.history`**。

- 生成节点编辑器「设为分镜场景图」→ 弹出对话框（独立组件 `SetAsSceneDialog.vue`，帧加载/新增/覆盖逻辑在组件内部；入口状态由 `useCanvasDialogs` 持有）。
- 读取 `prompt/scene/{ep}/{shot}/stage.json` 列出**全部场景帧**（label = `基础场景` || prompt || `分镜场景图 N`，预览 `stage/{i}.jpg`，404 时 `@error` 置 `broken` 显示占位）。
- 点击某帧只进入**选中状态**（高亮 + 右上角勾选图标，再点一次取消选中），底部「确认」按钮启用后点击才执行 `copyFs(当前产物路径 → assert/scene/{ep}/{shot}/stage/{i}.jpg)` 覆盖该帧（当前产物路径来自 AssetCanvas 下发的 `output` prop）。
- 「新增场景图」→ `createSceneStageFrame`（`api/assets.ts`）追加帧并复制图片到新索引；新帧定义由 `deriveStageFrameBody` 从生成节点输入推导：
  - `assert/stage/{场景}/{标签}` 输入 → `基础场景 = 场景/标签`
  - `assert/stage/{场景}/variants/{标签}/{变体}.jpg` 输入 → `基础场景 = 场景/标签@变体`
  - `assert/character/{角色}` 输入 → `登场角色 = [角色]`
  - 节点 `config.prompt` → `prompt`
  - 无基础场景时复用现有帧第一个的 `基础场景`，仍无则禁用「新增」并提示。
- 服务端 `addStageFrame` 约束：`基础场景` 必填（`场景名/标签` 或 `prev`）；有登场角色时必须填 prompt。

### 10.1 保存为（节点右键菜单）

有当前产物的节点（图片/视频/音频输出）右键菜单显示「保存为」hover 子菜单，按**节点输出类型**提供目标：

| 节点输出类型 | 保存目标 | 目标路径 |
|------|----------|----------|
| 图片 | 角色设计 | `assert/character/{角色}/appearance.jpg` |
| 图片 | 角色设计-衍生变体 | `assert/character/{角色}/variants/{变体id}.jpg` |
| 图片 | 场景图 | `assert/stage/{场景}/{子场景}.jpg` |
| 图片 | 场景图-衍生变体 | `assert/stage/{场景}/variants/{子场景}/{变体id}.jpg` |
| 图片 | **道具图片** | `assert/prop/{分类}/{道具}/image.jpg` |
| 图片 | 自定义资产 | `assert/custom/...`（SaveAssetDialog） |
| 视频 | **道具视频** | `assert/prop/{分类}/{道具}/video.mp4` |
| 音频 | **道具音频** | `assert/prop/{分类}/{道具}/audio.flac` |

- 自定义资产走 `SaveAssetDialog`，其余目标走 `SaveAsDialog` 目标选择对话框。
- SaveAsDialog 目标列表来自 `prompt/character`、`prompt/stage`、`prompt/prop` 目录（道具类为「分类 + 道具」两个 v-combobox）与子场景 `.md` 文件名；默认定位当前画布实体（场景画布 → 当前场景 + 子场景；分镜画布 → `stage.json` 首帧 `基础场景` 推导，`prev` / `custom/` 引用不预选）。变体 id 手动输入并校验非法字符。「角色设计」「场景图」与道具类用 v-combobox（下拉箭头展开已有实体列表）：可选择已有实体覆盖其外观图/场景图/道具产物，也可手动输入新名称——保存时自动创建实体（角色：`POST /assets/:project/character` 生成 `prompt/character/{name}/` 三模板文件；子场景：`POST /assets/:project/subscene` 生成 `prompt/stage/{场景}/{标签}.md`；道具分类/道具：`POST /assets/:project/prop/category` + `/assets/:project/prop` 生成目录与 image.md/video.md/refs.json 模板；重名则按已存在处理走覆盖流程）。衍生变体的角色/子场景仍为下拉选择（变体须挂在已存在实体下）。
- 仅复制文件（`POST /fs/:project/copy`）；**衍生变体（角色/场景）在元数据 `prompt/.../variants/{id}.json` 不存在时自动创建**（调 `POST /assets/:project/.../variants` 创建接口，desc 用对话框「衍生描述」输入，默认预填节点提示词，为空回退「由画布保存的衍生变体」，baseImage 由服务端默认推导；元数据已存在时仅覆盖图片）——角色/场景详情页的衍生变体列表按元数据扫描，缺元数据会看不到已保存的图。
- 目标文件已存在时 `confirm` 确认后覆盖，覆盖前先把原文件归档为历史版本（`POST /assets/:project/history/archive`，服务端 `copyExistingAssetToHistory` 复制归档，目录按 `historyDirForAsset` 推导，如 `assert/character/{角色}/history/appearance/`、`assert/character/{角色}/variants/history/{变体id}/`、`assert/prop/{分类}/{道具}/history/image/`；与生成/上传覆盖的历史机制一致，可在资产历史对话框中查看/激活）。
- SaveAssetDialog 文件名可手动编辑（默认节点名 + 源扩展名，空名回退「未命名」，非法字符校验），重名自动追加 `(1)`、`(2)`… 后缀。

---

## 11. 切换分镜跟随加载

- 左侧资产浏览器切换分镜只改 URL query，`ScenePanel` 保持挂载仅更新 props。
- `useCanvasStore` / `useCanvasGeneration` 内部持 `targetRef`，暴露 `switchTarget(newTarget)`：
  - store：先清防抖 timer + 落盘未保存修改（仍用旧目标）→ 重置 data / 撤销重做 / 剪贴板 → 重新 `load()`；
  - gen：更新目标 + `reset()`（清轮询与全部展示态；**localStorage 记录不清**——结果由服务端落盘，切回时按固定路径直接可见，运行中任务由 `restore()` 恢复 loading 展示与跟踪）。
- `AssetCanvas` 用 `watch(target, ...)` 在切目标时清空选中/菜单/内联重命名状态并调用两个 `switchTarget`，随后刷新全部节点产物信息（`refreshNodeOutputs`，node-info 批量查询）——异步任务已完成的结果立即显示。
- **加载后视口对准节点**：首次 `load()` 与 `switchTarget` 完成后调用 `scheduleFitCanvas`，把视口居中到全部资产节点并缩放使包围盒落入可视区（与工具栏「适应视图」同一套参数）。Vue Flow 的 `fitViewOnInit` 只在组件首次初始化时生效、切换分镜不会自动 fit，因此必须显式调用。`fitView` 要求节点已测出宽高且容器尺寸 > 0：测量未完成或画布 Tab 隐藏时保持 pending，由 `onNodesInitialized` / 容器 `ResizeObserver` 再试；快速切换分镜以世代号丢弃过期请求。空画布则重置为默认视口 `{ x: 0, y: 0, zoom: 1 }`。

---

## 12. 前端模块结构

```
frontend/src/
├── canvas/                       # 纯逻辑（可单元测试）
│   ├── types.ts                  # 数据模型 + 版本迁移 + id 工具
│   ├── registry.ts               # 节点原型注册表（含 canGenerate/hasHistory 能力标志）
│   ├── connection.ts             # 连接校验（类型/成环）
│   ├── groupSelection.ts         # 多选群组纯函数（包围盒/命中测试/原型兼容性过滤/config id 重映射/合成节点 id）
│   ├── paths.ts                  # 定义文件与产物路径
│   ├── preview.ts                # 预览 URL
│   ├── api.ts                    # loadCanvas / saveCanvas
│   ├── generate.ts               # 输入收集（collectInputs/collectInputPaths）、节点当前资产推导（固定产物路径）
│   ├── autobuild.ts              # 自动搭画布
│   │   # 注：autobuild.ts 另含 resolveShotStageRef / resolveCharacterRef / deriveStageRefFromAssetPath / buildSubSceneAutoCanvas
│   ├── clipboard.ts              # 剪贴板媒体识别（classifyPastedFile/collectPastedMedia/粘贴上传目标路径）
│   ├── nodeClipboard.ts          # 节点复制标记（单/多节点：NODE_GROUP_CLIPBOARD_PREFIX + { nodes, connections }；兼容旧单节点标记）
│   ├── sceneFrame.ts             # 设为分镜场景图纯函数（buildSceneFrameOptions/deriveStageFrameBody）
│   ├── useCanvasStore.ts         # 状态：加载/保存(防抖 800ms)/增删改查/撤销重做/剪贴板/批量操作（applyNodes/updateNodes/removeNodes/connectGroupToNode/createNodeAndConnect）/switchTarget
│   ├── useCanvasGeneration.ts    # 生成：跑工作流/轮询（纯体验层，不回写元数据）/统一中断/结果通知/运行中任务 localStorage 持久化与 restore/switchTarget
│   └── *.test.ts                 # 单元测试（390+ 用例）
└── components/canvas/
    ├── AssetCanvas.vue           # 编排层：组装 store/gen/composables，渲染 VueFlow + 子组件
    ├── CanvasToolbar.vue         # 工具栏（视图缩放/撤销重做/自动搭画布/添加节点/保存状态）
    ├── CanvasNodeCard.vue        # 节点卡片（名称头/内联重命名/端口/主体组件/缩放控制点 + 通用 loading/错误遮罩与中断入口 + 成组连接悬停高亮）
    ├── CanvasEditorPanel.vue     # 配置悬浮面板（固定大小、位置联动、边界钳制、淡入淡出；仅单选节点显示）
    ├── CanvasContextMenu.vue     # 节点/连线/群组右键菜单（纯展示）
    ├── CanvasAddNodeMenu.vue     # 添加节点菜单（锚点 + VMenu 列表）
    ├── CanvasGroupFrame.vue      # 群组虚线框（合成节点 __group-frame 的展示内容；拖动整组由 Vue Flow 原生拖动承接）
    ├── CanvasGroupDot.vue        # 群组输出连接圆点（合成节点 __group-dot 的展示内容；mousedown 启动成组连接拖拽）
    ├── CanvasGroupConnectMenu.vue# 群组连接目标选择菜单（输出点拖拽超阈值释放后弹出）
    ├── SetAsSceneDialog.vue      # 设为分镜场景图对话框（帧加载/选中/覆盖/新增）
    ├── CanvasAssertHistoryDialog.vue / SaveAssetDialog.vue / SaveAsDialog.vue  # 历史/保存为自定义资产/保存为（目标选择）对话框
    ├── composables/              # 画布交互组合式（与组件同域，store/gen/VueFlow 工具以参数注入）
    │   ├── types.ts              # 共享类型（CanvasStoreApi/CanvasGenerationApi/NodeMap 等）
    │   ├── useCanvasFlow.ts      # Vue Flow 数据映射（含群组合成节点）、拖拽/缩放回写（多节点批量）、连线交互
    │   ├── useCanvasSelection.ts # 选中状态（单/多选 selectedNodeIds）、配置面板信息、整组删除
    │   ├── useCanvasGroup.ts     # 群组包围盒/输出点拖拽连接/目标原型菜单/成组连接执行与忽略反馈
    │   ├── useCanvasMenus.ts     # 右键菜单（节点/群组）与添加节点菜单状态/动作
    │   ├── useCanvasRename.ts    # 内联重命名状态
    │   ├── useCanvasPaste.ts     # 剪贴板粘贴（文件/文本/画布内复制节点）+ Ctrl+V 兜底 + Ctrl+D 复制粘贴整组
    │   ├── useCanvasKeyboard.ts  # 全局快捷键（撤销/重做/复制/粘贴/删除/Esc；多选整组语义）
    │   ├── useCanvasNodeOps.ts   # 生成调度（按原型分发）+ 输入收集查询
    │   ├── useCanvasUpload.ts    # 加载节点上传：节点级进度状态（上传中/失败遮罩数据源）+ 上传/重试/中止（reset）
    │   ├── useCanvasDialogs.ts   # 历史/保存资产/场景图/分镜视频/资产选择器状态
    │   └── useCanvasAutobuild.ts # 自动搭画布（引用收集 + 幂等应用）
    ├── nodes/                    # 节点卡片主体（ImageLoaderNode / ImageGenerateNode / TextNode 等）
    └── editors/                  # 配置组件（ImageLoaderEditor / ImageGenerateEditor 等
                                   #  + CanvasInputPreview 统一输入预览；
                                   #  components/ 根级另有 DurationPicker（时长菜单）
                                   # 与 WorkflowParamsTrigger（工作流参数菜单））
```

> 组合式注入约定：只有 `AssetCanvas.vue` 调用 `useVueFlow()`（工具栏/面板/菜单是 VueFlow 的兄弟节点，不能依赖其 inject），`viewport`/`screenToFlowCoordinate`/`findNode`/`addSelectedNodes` 等工具以函数参数注入各组合式；`useVueFlow` 状态始终经 props 传给 `CanvasEditorPanel`。

服务端画布专属路由（`server/src/routes/canvas.ts`，前缀 `/api/canvas`）：
- `POST /canvas/extract-frame`——「获取视频帧」节点：body 可带 `frameIndex`（0=首帧、-1=尾帧…，解码序 select 选帧）或 `time`（秒，按呈现时间精确选帧 `-ss`，与预览画面一致）；
- `GET /canvas/video-info`——返回视频时长/帧率/分辨率（ffprobe），供编辑器「提取当前帧」回显近似帧索引。
- `GET /canvas/node-info`——返回节点产物 `{ exists, mtime, size }`（fs.stat；文件不存在时 exists=false 正常返回），前端画布加载/生成完成时批量刷新。
- `POST /canvas/concat-video`——「拼接视频」节点：body `{ project, videoPaths, outputPath }`，concat demuxer + `-c copy`。
- `POST /canvas/trim-video`——「裁剪视频」节点：body `{ project, videoPath, outputPath, duration, startTime? | startFrame? }`；重编码裁剪（不用 `-c copy`），产物覆盖 `output.mp4`。
- `POST /canvas/trim-audio`——「裁剪音频」节点：body `{ project, audioPath, outputPath, startTime, duration }`；输入须在 `assert/` 下、输出须为画布节点固定 `output.flac`（`assets/trim-audio.ts` 的 `assertAudioTrimOutputPath`）；重编码为 FLAC（不用 `-c copy`，小数秒切口准确），返回 `{ success, path, duration }`（duration 为实际时长，超出片尾被截短）。
- `POST /canvas/upload`——**生成图片/视频节点手动上传产物**：multipart `{ project, path, file }`；path 须匹配画布节点固定产物路径（`assert/(scene/…|stage/…)/canvas/…/output.jpg|mp4`，见 `assets/canvas-upload.ts` 的 `assertCanvasNodeOutputPath`）；图片接受 jpg/png/webp（统一落盘 `output.jpg`）、视频仅接受 mp4（扩展名或 MIME 任一匹配）；写入前先 `copyExistingAssetToHistory` 归档旧产物（**归档失败中断上传**，历史必须保留），返回 `{ success, path, archived }`。multer diskStorage 临时落盘、上限 8GB（大视频不占内存）。
- 四个写产物分支（extract/concat/trim-video/trim-audio）在写入前调用 `copyExistingAssetToHistory` 归档旧产物（固定路径重复生成时历史自动保留）。
其余画布读写仍走既有 `GET/POST /api/fs/:project/*`（读写 `canvas.json`）与 `/assets/.../stage`（设为分镜场景图新增帧）。

历史与迁移：
- 节点历史由服务端 `assets/history.ts` 统一管理（history 目录 + `/api/assets/:project/history*` 通用端点）；引擎（`workflow-engine.ts`）任务完成时同样先 copy 归档再写固定路径产物。
- 旧版 `v{n}` 产物一次性迁移：`cd server && npm run migrate:canvas-outputs [project]`（最高版本 → `output.{ext}`，其余 → `history/output/{时间戳}.{ext}`；幂等，只改 assert/ 不动 canvas.json）。

「获取视频帧」编辑器（`editors/ExtractFrameEditor.vue`）：
- 预览输入视频时提供「提取当前帧」按钮：把预览当前 `currentTime` 写入 `config.frameTime` 并立即提取（服务端 `-ss` 按呈现时间精确选帧，拖拽进度条后也与画面一致）；有帧率时同时回显近似 `frameIndex`；
- 手动修改「帧索引」会清除 `frameTime`（改回按帧索引提取）；「提取/重新提取」按钮内置于帧索引输入框右侧；
- 该节点**无历史对话框入口**（编辑器无历史按钮、右键菜单不显示「历史」项）；重复提取时旧产物由服务端自动归档进 `history/output/`（仅文件层面保留，无 UI 查看）；
- 预览 URL 按输入路径缓存，修改帧索引等触发重渲染不会导致视频重载。

---

## 13. 开发指南

### 13.1 新增一种节点类型

1. 在 `registry.ts` 注册 `NodePrototype`（端口、resizeable、bodyComponent）。
2. **生成类节点**在原型上声明 `outputExt`（产物固定文件名扩展名，如 `jpg`/`mp4`/`png`/`flac`）——产物展示/按钮文案由 AssetCanvas 按固定路径 + node-info 推导后经 `output` prop 下发，组件内优先读 `props.output`、`config.current` 仅作旧数据回落；加载类节点（`config.assetPath`）无需声明。
3. 新建 `components/canvas/nodes/{Xxx}Node.vue`（卡片主体）。
4. （可选）新建 `components/canvas/editors/{Xxx}Editor.vue` 并挂 `editorComponent`；编辑器根元素不要自己定宽度（面板宽度由 AssetCanvas 统一控制）。
5. `config` 字段与既有节点保持兼容（未知字段不影响读取）。
6. **节点主体不要自行渲染 running/error 遮罩**：loading/错误状态是节点的通用能力，由 `CanvasNodeCard` 按 `status` prop 统一叠加（含「中断」按钮）；生成类节点只要经 `gen.generate` / ffmpeg 同步函数进入 running，即自动获得 loading 展示与中断能力。

### 13.2 测试与验证

- 单元测试：`frontend/src/canvas/*.test.ts`，命令 `cd frontend && npm test`（服务端 `cd server && npm test`）。
- 修改后必须：`npm run typecheck` + `npm run lint`（AGENTS.md 约束；仅允许 `server/src/assets/refs.ts` 既有 warning）。
- 浏览器验证：`npm run dev` 后访问 `localhost:5233`，用共享浏览器页实测交互（节点点击/拖拽/缩放/连线/生成/设为分镜场景图）。

### 13.3 常见坑

- **Vue Flow 双向绑定**：`v-model:nodes` 绑 computed 报 readonly 写入错误，用单向绑定 + 事件回写。
- **服务端任务终态**：`completed` / `failed`（无 success/error），轮询按 `completed` 判成功。
- **产物固定文件名**：节点产物统一 `output.{ext}`（原型 `outputExt`），**勿再引入版本号文件名**；历史由服务端 history 目录管理，前端不要读写 `config.current`/`config.history`（旧字段仅兼容读取）。
- **生成节点上传走 `/api/canvas/upload`**：`useCanvasUpload` 按 `isCanvasNodeOutputPath(dest)` 自动选择端点（画布节点固定产物路径 → canvas 上传端点，其余 → `/fs/upload`）；上传目标必须是固定产物路径，服务端先归档旧产物再覆盖；图片统一落盘 `output.jpg`（png/webp 原样写入），视频仅接受 mp4；前端与服务端两处路径正则（`paths.ts: isCanvasNodeOutputPath` 与 `canvas-upload.ts: assertCanvasNodeOutputPath`）须同步修改。
- **节点展示用 `output` prop**：AssetCanvas 按固定路径 + node-info mtime 推导并下发给节点主体/编辑器（`outputOf`）；组件内优先 `props.output`，`config.current` 仅作旧数据回落。
- **预览 watch 需同时监听 path 与 token**：固定路径产物每次重新生成路径不变，预览 URL 只由 token（产物 mtime）区分；节点主体若只 `watch(currentPath)`，新产物覆盖后不会刷新 URL、浏览器命中旧缓存——必须 `watch([currentPath, currentToken])`（实测踩坑，4 个节点主体均已按此实现）。
- **输入预览 URL 必须以源资产 mtime 作缓存键**：编辑器内对连接输入（图片/视频/音频）构建预览 URL 时，必须 `buildPreviewUrl(project, path, version)`——`version` 为来源节点的产物 mtime（`useCanvasNodeOps` 的 `withVersions` 已把 mtime 附到 `CanvasInputInfo.version`）。**不要漏传 version**：漏传时 `buildPreviewUrl` 回退 `?t=Date.now()`，每次配置修改（如编辑提示词）引发的重渲染都会重建缓存键，浏览器会把全部输入媒体当作新资源重新下载（浪费带宽），且 `<img>/<video>/<audio>` 因 src 变化被重建导致配置组件闪烁。
- **配置双向同步**：editor 内 `config.workflowParams ↔ 本地 ref` 双 watch 必须加 JSON 相等性守卫，否则无限循环。
- **尺寸组件回显禁止用未加载完成的能力清单钳制**：`WorkflowSizePicker` 的 `sizeCapabilities` 来自 `currentImpl?.capabilities?.size`，而工作流列表是 `getWorkflows()` **异步**拉取的；拉取完成前该 prop 为 `undefined`，`normalizeSizeCapabilities` 会回退成**默认全量清单**（`16:9/4:3/1:1/3:4/9:16/auto` + `360P/720P/1080P/2K/4K/auto`），此时若把已保存的 `config.sizeConfig` 钳制到该清单，合法档位会被改错（如 Seedream 的 `3:2` → `16:9`、`1K` → `360P`，而宽高不参与钳制所以数值仍正确——正是「刷新后比例/尺寸档与保存值不符、分辨率数值却对」的成因）。组件内以 `echoState` 保存**未钳制的回显原值**，能力声明变化时**始终从原值重新推导**（勿在已钳制结果上二次钳制，否则错值被固化）；能力未知（`sizeCapabilities == null`）时一律不钳制、原样回显，当前值不在选项内时补进按钮组末尾。
- **钳制结果不自动写回配置**：能力声明变化只更新展示，**不得 `emit` 持久化**——静默改写用户已保存的 `sizeConfig` 会把上一步的错值固化进 `canvas.json`；只有用户主动点选档位/改宽高时才写入（画布两个生成编辑器切换工作流类型或实现时本就会 `sizeConfig: undefined` 重置，不会提交越界档位）。
- **`readFs` 对 `.json` 返回反序列化对象**：加载 `canvas.json` 需同时兼容 string 与 object 两种形态。
- **eslint computed 副作用**：`vue/no-side-effects-in-computed-properties` 禁止在 computed 内写缓存/状态，改用 `watch`。
- **面板钳制**：用 `flowEl.clientHeight/Width` 实测尺寸，勿依赖 Vue Flow `dimensions`。
- **切换画布必须显式 fitView**：`fitViewOnInit` 只在 Vue Flow 首次初始化时跑一次，切换分镜/场景节点换了但视口仍停在旧坐标。`fitView` 在节点尚未测出宽高或容器尺寸为 0（画布 Tab 隐藏）时返回 `false`，必须 pending 后由 `onNodesInitialized` / ResizeObserver 再试，且用世代号丢弃过期请求；不要在每次 resize 时无条件 fit，会抢用户手动平移/缩放。
- **loading 持久化分键**：运行中任务记录按 `项目 + 画布定义文件路径` 分键（`dsh.asset-canvas.tasks.*`），切换画布/项目互不串扰；`reset()` 只清内存不清记录，任务终态（成功/失败/中断）必须 `clearPersistedTask`，否则刷新后会出现幽灵 loading。
- **连线右键**：`@edge-context-menu` 需手动 `event.preventDefault()` 阻止浏览器默认菜单叠加。
- **节点缩放**：核心包不含缩放组件，控制点由独立包 `@vue-flow/node-resizer` 提供；缩放中的实时尺寸只写在 Vue Flow 内部节点样式上，业务 `width/height`（及左侧/上侧缩放时的 `x/y`）在 `resizeEnd` 事件统一回写 store——勿在 `resize` 事件里回写，会高频压入撤销栈并反复触发保存。
- **缩放控制点显隐**：`NodeResizer` 的 `isVisible` 需包含「缩放中」状态（悬浮/选中/缩放中任一为真），否则拖出节点边界触发 mouseleave 卸载控制点会中断缩放。
- **滚轮缩放豁免**：Vue Flow 按 `noWheelClassName`（默认 `nowheel`）判定是否拦截滚轮缩放；文本节点 textarea 必须带 `nowheel` 类才能在节点内滚动文本。同理节点拖拽豁免用 `nodrag`（textarea 上拖拽选择文本不移动节点）。
- **剪贴板粘贴**：文件/文本粘贴统一在全局 `paste` 事件中处理（读 `clipboardData.items` 与 `text/plain`，优先级：**节点复制标记 > 文件 > 文本 > 画布内部复制的节点**）。复制节点（`copyNode`）会把「标记 + 节点 JSON」写入系统剪贴板（覆盖旧内容），因此粘贴节点不会被剪贴板中残留的旧文本/文件抢占；标记在 `onPaste` 中**最先**识别（在输入框焦点判断之前，防止标记 JSON 被原生粘贴插入输入框，输入框内粘贴标记仅吞掉不粘贴节点）。`Ctrl+V` 的 keydown 分支**不能 `preventDefault`**（会阻止浏览器派发 paste 事件），仅在剪贴板为空时用宏任务兜底粘贴内部复制的节点。焦点在 INPUT/TEXTAREA 内放行原生粘贴（粘贴进文本节点/编辑器输入框）。
- **加载节点上传**：统一走 `useCanvasUpload`（节点 body/编辑器 `upload-file` 事件与粘贴均经它）。进度来自 `client.uploadFs` 的 `onUploadProgress`（浏览器 XHR upload 事件，纯前端能力，服务端无需改动）；粘贴媒体会**先创建空加载节点再上传**（进度显示在节点上），因此粘贴上传完成的撤销是两步（①撤 assetPath ②撤节点）。本地回环上传很快，小文件进度条可能一闪而过属正常现象。
- **上传进度实时性**：进度经 Vue `reactive` 代理写回（`states[nodeId]` 返回代理），**勿直接修改捕获的原始 state 对象**（不触发响应式更新，进度条不刷新）。
- **上传并发与日志**：同一节点上传进行中再次点「上传」会被忽略（**不中止进行中的请求**）——大文件请求中途被 abort 后，keep-alive 连接复用时残留字节可能污染下一个请求的 multipart 流，服务端解析出畸形字段（如 `Unexpected field`）；该场景服务端会打印 `[fs-upload] 上传失败` 日志并返回友好文案。接口异常统一打日志：前端 axios 响应拦截器（非 2xx 打印 `[api]` 日志，HEAD 404 存在性探测除外）+ 上传组合式 `console.error`；服务端 multer 错误分支 `console.error`。
- **删除类操作**：必须走 `confirm` 工具弹窗确认（AGENTS.md 约束）。
- **提交信息**：中文提交信息在 PowerShell 下用 `-m` 会乱码，用 UTF-8 临时文件 `--amend -F` 方式提交。