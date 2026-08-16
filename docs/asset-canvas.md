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

> **异步结果可靠性**：任务由服务端 SQLite 队列独立执行，产物落盘与页面无关；离开画布 / 切换项目 / 关闭浏览器后任务完成，重新进入画布时按固定路径直接可见（无任何元数据回写依赖）。前端轮询（`useCanvasGeneration.poll`）仅负责实时状态展示，纯体验层。

---

## 3. 节点类型（`frontend/src/canvas/registry.ts`）

节点原型 `NodePrototype`：`id / name / inputPorts / outputPorts / resizeable / canGenerate / hasHistory / outputExt / defaultConfig / bodyComponent / editorComponent / getOutputAssetPath`。
其中 `canGenerate`（是否支持「重新生成」）与 `hasHistory`（是否有**历史对话框入口**）驱动右键菜单入口显隐：`image-generate`/`video-generate`/`tts-generate` 两者皆真；`video-frame-extract`/`video-concat`/`video-trim` 仅 `canGenerate`（无历史对话框入口；但重复执行时旧产物仍会被服务端归档进 history 目录，只是没有 UI 入口查看）。`outputExt`（生成类节点产物扩展名，如 jpg/mp4/png/flac）决定固定产物文件名 `output.{ext}`。

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

- **加载图片**：`config.assetPath` 绑定一张既有资产（上传到 `assert/custom/canvas/` 或从资产选择器选择）；点击节点出现的配置组件可预览当前图并「上传图片 / 选择资产」。
- **加载音频**：`config.assetPath` 绑定一段音频（上传到 `assert/custom/canvas/` 或从资产选择器选择）。该节点打开的资产选择器额外提供「音频」页签（台词音频/分镜自定义/全局自定义），且「角色」页签在选择角色后会展示**音色**分区（`assert/character/{角色}/voice.flac` 由 character-voice 任务生成；`assert/character/{角色}/voice-variants/{变体id}.flac` 为角色**声音变体**，见 `docs/asset-layout.md`，均已生成才列出），与外观图一起可选；图片类节点（image-loader）的选择器不显示音色与音频页签（`AssetCanvas.openAssetPicker` 按 `prototypeId === 'audio-loader'` 决定 `showVoice` 与页签列表）。
- **加载视频**：`config.assetPath` 绑定一段视频（上传到 `assert/custom/canvas/` 或从资产选择器选择）。该节点打开的资产选择器额外提供「分镜视频」页签（`VideoPicker`）：列出 `assert/scene/{集}/{分镜}/video/` 目录下的全部视频（`{index}.mp4`），目录为空时兼容回退旧版 `video.mp4`；分镜画布（`kind === 'scene'`）下编辑器提供「设为分镜视频」，把当前视频复制为 `assert/scene/{集}/{分镜}/video/0.mp4`（服务端批量生成 `discovery.ts` 也输出到该路径）。
- **生成图片**：`config` 含 `prompt`（提示词）、`workflowId` / `workflowImpl`（默认有输入图用 `image-edit`，否则 `text-to-image`）、`workflowParams`（用户参数）、`inputOrder`（输入图顺序，见 §7）。产物固定 `output.jpg`。
- **生成视频**：`config` 含 `workflowId`（默认 `image-to-video`）、`workflowImpl`、`mode`（`director` / `first-last-frame` / `reference`）、`prompt`、`director`（导演台工程，见 `videoTypes.ts`）、`workflowParams`、`inputOrder`。单一 `media` 输入口，素材类型由来源节点自动归类；编辑器内嵌导演台（仅 director 模式）或参考素材分组；分镜画布下提供「设为分镜视频」（把当前产物复制到 `assert/scene/{集}/{分镜}/video/0.mp4`）。产物固定 `output.mp4`。
- **拼接视频**：`config` 含 `inputOrder`（拼接顺序，编辑器内 `VideoRefInputGroup` 拖拽排序）。单一 `video` 输入口，同一端口可连多段视频（无输入上限校验）；编辑器「拼接」按钮经父级 `@generate` 路由到服务端 `POST /api/canvas/concat-video`（本地 ffmpeg，concat demuxer + `-c copy` 无损拼接，各段编码/分辨率/帧率/音轨结构须一致，不一致返回清晰中文错误）；产物固定 `output.mp4`，重复拼接旧产物自动归档进历史目录。
- **裁剪视频**：`config` 含 `startMode`（`time` / `frame`）、`startValue`（秒可小数，或帧索引整数 ≥ 0）、`duration`（秒，> 0 可小数）。单一 `video` 输入口（多路只取第一路）；编辑器「裁剪」按钮经父级 `@generate` 路由到服务端 `POST /api/canvas/trim-video`（本地 ffmpeg **重编码**，不用 `-c copy`，保证帧索引 / 小数秒切口准确：`libx264 veryfast crf=18`，有音轨则 `aac`）。起点 + 时长超出片尾时截到剩余时长。产物固定覆盖 `output.mp4`，重复裁剪旧产物自动归档（**裁剪也有历史**，与其余节点一致）。节点卡片与配置面板均可预览裁剪结果。
- **文本**：`config.text`，可编辑纯文本；当前仅作为 text 类型数据流锚点。文本域带 Vue Flow 约定类 `nodrag` / `nowheel`：在文本域内拖拽是选择文本（不移动节点），滚轮滚动是滚动文本内容（不缩放画布）。

---

## 4. 连线规则（`frontend/src/canvas/connection.ts`）

- 按**端口数据类型**判断兼容（ComfyUI 思路），v1 仅支持同类型：`image→image`、`text→text`。
- `canConnectNodes` = 类型兼容 + 不成环（`wouldCreateCycle` 反向可达性检测）+ 目标输入未满。
- 建立连线：从源节点输出手柄拖到目标节点输入手柄（`@connect` → `store.connect`）；连接失败静默忽略。
- 断开连线：
  - 右键连线 → 「断开连接」（`@edge-context-menu`，需 `event.preventDefault()` 阻止浏览器默认菜单）；
  - 右键节点 → 「断开连接」（断开该节点全部连线）；
  - 选中连线后按 `Delete`。

---

## 5. 画布交互

| 交互 | 行为 |
|------|------|
| 点击节点 | 选中 + 显示配置面板（有 editorComponent 时） |
| 双击节点名称 | 内联重命名（回车/失焦提交、Esc 取消、空名放弃） |
| 拖拽节点 | 移动位置，结束回写 store（防误触：拖拽中隐藏配置面板） |
| 悬浮/选中节点后拖拽边缘或四角 | 调整节点大小（**全部节点类型**可缩放，最小 120×80px，`@vue-flow/node-resizer` 渲染控制点；缩放中控制点保持可见，结束才回写 store） |
| 右键节点 | 菜单：重新生成 / 历史 / 断开连接 / 重命名 / 复制 / 删除（删除需 `confirm` 确认） |
| 右键连线 | 菜单：断开连接 |
| 单击空白 | 取消选中、关闭菜单 |
| 双击空白 | 在鼠标双击处弹出「添加节点」VMenu（选择节点原型后在该处添加节点） |
| 适应视图 / 放大 / 缩小 | 工具栏按钮（`fitView` / `zoomIn` / `zoomOut`） |
| 滚轮 | 空白/节点上滚动 = 缩放画布；文本节点文本域上滚动 = 滚动文本（`nowheel` 类豁免缩放） |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销 / 重做（输入框聚焦时跳过） |
| `Ctrl+C` / `Ctrl+D` | 复制选中节点到画布内部剪贴板，并同步把「节点复制标记 + JSON」写入系统剪贴板（覆盖剪贴板旧内容，与主流节点编辑器复制语义一致；无剪贴板 API 时静默降级为仅内部剪贴板） / 复制粘贴（重复节点） |
| `Ctrl+V` | 粘贴剪贴板内容，按类型分派：**画布内复制的节点标记 → 粘贴节点（最高优先级，不会被剪贴板中残留的旧文本/文件抢占；也支持跨画布/刷新后粘贴，节点 JSON 从系统剪贴板解析）**；图片/视频/音频文件 → 上传到 `assert/custom/canvas/` 并创建对应加载节点（可视区中心错位摆放）；文本 → 创建文本节点并写入文本；剪贴板为空不派发 paste 事件时由 keydown 兜底粘贴内部复制的节点。粘贴的新节点**自动聚焦**（全部选中，显示可调整大小的边框与缩放控制点，应用级选中使 Delete/复制快捷键可用），且**不自动打开配置面板**（仅用户点击节点才打开） |
| `Delete` / `Backspace` | 删除选中节点（确认）或选中连线 |
| `Esc` | 关闭右键菜单 / 取消内联重命名 |

> Vue Flow 绑定注意：勿用 `v-model:nodes/edges` 绑 computed（会报 readonly 写入错误），用单向 `:nodes/:edges` + `@node-drag-stop` 回写 + `@edges-change`(remove) 同步删除。

---

## 6. 配置面板（`CanvasEditorPanel.vue` 实现，由 AssetCanvas 编排）

- 独立悬浮于节点下方的面板（不随节点尺寸撑大），渲染选中节点的 `editorComponent`；组件常驻挂载，显隐由 `visible` prop 驱动，`<Transition>` 与定位逻辑在组件内部。
- **固定大小不随缩放**：宽度为固定屏幕像素（普通节点 400px、生成图片节点 500px、生成视频节点 640px，见组件内常量 `EDITOR_PANEL_WIDTH[_GENERATE/_VIDEO]`），间距 12px（`EDITOR_PANEL_GAP`）；仅**位置**随节点/视图联动（水平中心与节点中心对齐），视口与画布可视区尺寸由 AssetCanvas 以 props 传入（`viewport`/`flowWidth`/`flowHeight`）。
- **边界钳制**：优先放节点下方；放不下且上方有空间则翻转到节点上方；仍放不下则把面板底部钳到画布可视区内（必要时与节点重叠）。钳制用 `flowEl.clientHeight/Width`（AssetCanvas 的 ResizeObserver 监听 `flowEl`）+ 面板自身高度（面板组件 ResizeObserver 监听 `panelEl`）测量，勿用 Vue Flow `dimensions`（不可靠）。
- **淡入淡出**：`<Transition name="editor-panel">` + CSS（opacity 0.18s + `translateY(6px)`）；关闭淡出期间用 `lastPanelStyle` 缓存保持原位不跳位（缓存写在 `watch(editorPanelStyle)`，勿在 computed 内写副作用，会触发 eslint `vue/no-side-effects-in-computed-properties`）。
- 拖拽节点时 `suppressEditor=true` 隐藏面板，仅点击节点才显示。
- 程序化选中（粘贴自动聚焦等）置 `suppressPanelOnSelect=true` 抑制面板自动弹出；`onNodeClick`/`onPaneClick`/切换目标时复位。粘贴聚焦通过 `addSelectedNodes`（`useVueFlow`）写入 Vue Flow 内部选中态，需先 `await nextTick()` 等内部 nodeLookup 应用新节点。
- 面板根元素需绑定 `ref="panelEl"`（高度测量）。

### 编辑器组件（editorComponent）约定

- props：`project`、`node`、`inputs`（`CanvasInputInfo[]`，仅生成节点用到）、`isRunning`、`output`（`{ path, token? } | null` —— 当前产物固定路径 + 防缓存 token（产物 mtime），由 AssetCanvas 按 node-info 推导下发，优先于 `config.current` 旧数据）；生成图片编辑器另有 `kind`（画布类型，`ImageGenerateEditor` 用它让「设为分镜场景图」按钮仅分镜画布显示）；视频生成/拼接编辑器另有 `imagesInputs` / `videosInputs` / `audiosInputs`（三组输入，按 `config.inputOrder` 排序，编辑器统一传入）。
- emits：
  - `update:config(patch)` —— 合并写入节点 config（由 `useCanvasNodeOps.onUpdateConfig` 处理，AssetCanvas 接线）；
  - `generate(nodeId)` / `interrupt(nodeId)` / `open-history(nodeId)` / `set-as-scene(nodeId)`；
  - `open-picker(nodeId)` —— 打开资产选择器（加载图片编辑器使用）。
- 新增编辑器时需在 `registry.ts` 为原型挂 `editorComponent`；若用到资产选择器，`AssetCanvas` 的编辑器面板接线（`CanvasEditorPanel`）需给 `@open-picker="openAssetPicker"`。

---

## 7. 输入图（生成图片节点编辑器）

- 展示：配置面板顶部「输入图」区，每张输入图显示为**缩略图 + 「图像N」标签**（N 为顺序号，随拖拽排序变化；文件名在 title 提示）。
- 悬浮放大：`v-tooltip location="top"` 显示放大图（最大 280px），悬浮在输入图**上方**。
- 拖拽排序：HTML5 DnD，容器 `dragover` 按鼠标水平位置计算插入下标，`--insert-left/--insert-right` 高亮插入位置；drop 后重排并 `emit('update:config', { inputOrder: [sourceNodeId...] })` 持久化。
- 顺序生效点：`generate.ts: collectInputs / collectInputPaths` 遵循 `config.inputOrder`（未记录的节点按连接顺序排末尾）；生成节点发起生成时也会把该顺序的输入图传给 `image-edit` 工作流。

---

## 8. 生成流程（`frontend/src/canvas/useCanvasGeneration.ts`）

1. `generateNode(nodeId)`（`composables/useCanvasNodeOps.ts`，按原型分发）：收集输入图路径（`collectInputPaths`，含顺序）→ `gen.setInputPaths` → `gen.generate`。
2. `generate`：
   - `image-edit`：`vars = { prompt, imagePaths: JSON.stringify(inputPaths), purpose: 'canvas-image' }`；
   - `text-to-image`：先把 prompt 写入节点目录的 `prompt.md`，`vars = { promptPath, purpose: 'canvas-image' }`。
   - 产物路径 `computeOutputPath`：**固定文件名** `output.{ext}`（扩展名取原型 `outputExt`，无版本号计算）。
3. 提交后轮询 `poll`（2s，首轮立即查一次）：**服务端终态为 `completed` / `failed`**（无 success/error）。轮询**只更新 `statusByNode` 展示**，成功时经 `onResult(nodeId, outputPath)` 回调通知 UI 刷新（AssetCanvas 更新节点产物信息 node-info）；**不回写 `config.current`/`config.history`**——结果落盘由服务端完成，页面离开/关闭后结果依然存在。
4. 状态机：`statusByNode[nodeId]` = `running | success | error`，节点卡片显示进度遮罩/错误遮罩/「上游已更新」角标（`isUpstreamUpdated` 按节点产物 mtime 比较）。
5. 中断 `interrupt`：清轮询、置错误态（调用服务端 cancel 端点，仅 cancelable 工作流可用）。
6. 获取视频帧 / 拼接 / 裁剪（同步 ffmpeg 路由）：成功后同样只更新状态并回调 `onResult`；重复执行时服务端自动把旧产物归档进历史目录。

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

---

## 11. 切换分镜跟随加载

- 左侧资产浏览器切换分镜只改 URL query，`ScenePanel` 保持挂载仅更新 props。
- `useCanvasStore` / `useCanvasGeneration` 内部持 `targetRef`，暴露 `switchTarget(newTarget)`：
  - store：先清防抖 timer + 落盘未保存修改（仍用旧目标）→ 重置 data / 撤销重做 / 剪贴板 → 重新 `load()`；
  - gen：更新目标 + `reset()`（清轮询与全部展示态；结果由服务端落盘，切回时按固定路径直接可见）。
- `AssetCanvas` 用 `watch(target, ...)` 在切目标时清空选中/菜单/内联重命名状态并调用两个 `switchTarget`，随后刷新全部节点产物信息（`refreshNodeOutputs`，node-info 批量查询）——异步任务已完成的结果立即显示。

---

## 12. 前端模块结构

```
frontend/src/
├── canvas/                       # 纯逻辑（可单元测试）
│   ├── types.ts                  # 数据模型 + 版本迁移 + id 工具
│   ├── registry.ts               # 节点原型注册表（含 canGenerate/hasHistory 能力标志）
│   ├── connection.ts             # 连接校验（类型/成环）
│   ├── paths.ts                  # 定义文件与产物路径
│   ├── preview.ts                # 预览 URL
│   ├── api.ts                    # loadCanvas / saveCanvas
│   ├── generate.ts               # 输入收集（collectInputs/collectInputPaths）、节点当前资产推导（固定产物路径）
│   ├── autobuild.ts              # 自动搭画布
│   │   # 注：autobuild.ts 另含 resolveShotStageRef / resolveCharacterRef / deriveStageRefFromAssetPath / buildSubSceneAutoCanvas
│   ├── clipboard.ts              # 剪贴板媒体识别（classifyPastedFile/collectPastedMedia/粘贴上传目标路径）
│   ├── nodeClipboard.ts          # 节点复制标记（NODE_CLIPBOARD_PREFIX/serializeNodeClipboard/parseNodeClipboardText）
│   ├── sceneFrame.ts             # 设为分镜场景图纯函数（buildSceneFrameOptions/deriveStageFrameBody）
│   ├── useCanvasStore.ts         # 状态：加载/保存(防抖 800ms)/增删改查/撤销重做/剪贴板/switchTarget
│   ├── useCanvasGeneration.ts    # 生成：跑工作流/轮询（纯体验层，不回写元数据）/中断/结果通知/switchTarget
│   └── *.test.ts                 # 单元测试（220+ 用例）
└── components/canvas/
    ├── AssetCanvas.vue           # 编排层：组装 store/gen/composables，渲染 VueFlow + 子组件
    ├── CanvasToolbar.vue         # 工具栏（视图缩放/撤销重做/自动搭画布/添加节点/保存状态）
    ├── CanvasNodeCard.vue        # 节点卡片（名称头/内联重命名/端口/主体组件/缩放控制点）
    ├── CanvasEditorPanel.vue     # 配置悬浮面板（固定大小、位置联动、边界钳制、淡入淡出）
    ├── CanvasContextMenu.vue     # 节点/连线右键菜单（纯展示）
    ├── CanvasAddNodeMenu.vue     # 添加节点菜单（锚点 + VMenu 列表）
    ├── SetAsSceneDialog.vue      # 设为分镜场景图对话框（帧加载/选中/覆盖/新增）
    ├── CanvasAssertHistoryDialog.vue / SaveAssetDialog.vue  # 历史/保存资产对话框
    ├── composables/              # 画布交互组合式（与组件同域，store/gen/VueFlow 工具以参数注入）
    │   ├── types.ts              # 共享类型（CanvasStoreApi/CanvasGenerationApi/NodeMap 等）
    │   ├── useCanvasFlow.ts      # Vue Flow 数据映射、拖拽/缩放回写、连线交互
    │   ├── useCanvasSelection.ts # 选中状态/配置面板信息/删除
    │   ├── useCanvasMenus.ts     # 右键菜单与添加节点菜单状态/动作
    │   ├── useCanvasRename.ts    # 内联重命名状态
    │   ├── useCanvasPaste.ts     # 剪贴板粘贴（文件/文本/画布内复制节点）+ Ctrl+V 兜底
    │   ├── useCanvasKeyboard.ts  # 全局快捷键（撤销/重做/复制/粘贴/删除/Esc）
    │   ├── useCanvasNodeOps.ts   # 生成调度（按原型分发）+ 输入收集查询
    │   ├── useCanvasDialogs.ts   # 历史/保存资产/场景图/分镜视频/资产选择器状态
    │   └── useCanvasAutobuild.ts # 自动搭画布（引用收集 + 幂等应用）
    ├── nodes/                    # 节点卡片主体（ImageLoaderNode / ImageGenerateNode / TextNode 等）
    └── editors/                  # 配置组件（ImageLoaderEditor / ImageGenerateEditor 等）
```

> 组合式注入约定：只有 `AssetCanvas.vue` 调用 `useVueFlow()`（工具栏/面板/菜单是 VueFlow 的兄弟节点，不能依赖其 inject），`viewport`/`screenToFlowCoordinate`/`findNode`/`addSelectedNodes` 等工具以函数参数注入各组合式；`useVueFlow` 状态始终经 props 传给 `CanvasEditorPanel`。

服务端画布专属路由（`server/src/routes/canvas.ts`，前缀 `/api/canvas`）：
- `POST /canvas/extract-frame`——「获取视频帧」节点：body 可带 `frameIndex`（0=首帧、-1=尾帧…，解码序 select 选帧）或 `time`（秒，按呈现时间精确选帧 `-ss`，与预览画面一致）；
- `GET /canvas/video-info`——返回视频时长/帧率/分辨率（ffprobe），供编辑器「提取当前帧」回显近似帧索引。
- `GET /canvas/node-info`——返回节点产物 `{ exists, mtime, size }`（fs.stat；文件不存在时 exists=false 正常返回），前端画布加载/生成完成时批量刷新。
- `POST /canvas/concat-video`——「拼接视频」节点：body `{ project, videoPaths, outputPath }`，concat demuxer + `-c copy`。
- `POST /canvas/trim-video`——「裁剪视频」节点：body `{ project, videoPath, outputPath, duration, startTime? | startFrame? }`；重编码裁剪（不用 `-c copy`），产物覆盖 `output.mp4`。
- 三个写产物分支（extract/concat/trim）在写入前调用 `copyExistingAssetToHistory` 归档旧产物（固定路径重复生成时历史自动保留）。
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

### 13.2 测试与验证

- 单元测试：`frontend/src/canvas/*.test.ts`，命令 `cd frontend && npm test`（服务端 `cd server && npm test`）。
- 修改后必须：`npm run typecheck` + `npm run lint`（AGENTS.md 约束；仅允许 `server/src/assets/refs.ts` 既有 warning）。
- 浏览器验证：`npm run dev` 后访问 `localhost:5233`，用共享浏览器页实测交互（节点点击/拖拽/缩放/连线/生成/设为分镜场景图）。

### 13.3 常见坑

- **Vue Flow 双向绑定**：`v-model:nodes` 绑 computed 报 readonly 写入错误，用单向绑定 + 事件回写。
- **服务端任务终态**：`completed` / `failed`（无 success/error），轮询按 `completed` 判成功。
- **产物固定文件名**：节点产物统一 `output.{ext}`（原型 `outputExt`），**勿再引入版本号文件名**；历史由服务端 history 目录管理，前端不要读写 `config.current`/`config.history`（旧字段仅兼容读取）。
- **节点展示用 `output` prop**：AssetCanvas 按固定路径 + node-info mtime 推导并下发给节点主体/编辑器（`outputOf`）；组件内优先 `props.output`，`config.current` 仅作旧数据回落。
- **预览 watch 需同时监听 path 与 token**：固定路径产物每次重新生成路径不变，预览 URL 只由 token（产物 mtime）区分；节点主体若只 `watch(currentPath)`，新产物覆盖后不会刷新 URL、浏览器命中旧缓存——必须 `watch([currentPath, currentToken])`（实测踩坑，4 个节点主体均已按此实现）。
- **配置双向同步**：editor 内 `config.workflowParams ↔ 本地 ref` 双 watch 必须加 JSON 相等性守卫，否则无限循环。
- **`readFs` 对 `.json` 返回反序列化对象**：加载 `canvas.json` 需同时兼容 string 与 object 两种形态。
- **eslint computed 副作用**：`vue/no-side-effects-in-computed-properties` 禁止在 computed 内写缓存/状态，改用 `watch`。
- **面板钳制**：用 `flowEl.clientHeight/Width` 实测尺寸，勿依赖 Vue Flow `dimensions`。
- **连线右键**：`@edge-context-menu` 需手动 `event.preventDefault()` 阻止浏览器默认菜单叠加。
- **节点缩放**：核心包不含缩放组件，控制点由独立包 `@vue-flow/node-resizer` 提供；缩放中的实时尺寸只写在 Vue Flow 内部节点样式上，业务 `width/height`（及左侧/上侧缩放时的 `x/y`）在 `resizeEnd` 事件统一回写 store——勿在 `resize` 事件里回写，会高频压入撤销栈并反复触发保存。
- **缩放控制点显隐**：`NodeResizer` 的 `isVisible` 需包含「缩放中」状态（悬浮/选中/缩放中任一为真），否则拖出节点边界触发 mouseleave 卸载控制点会中断缩放。
- **滚轮缩放豁免**：Vue Flow 按 `noWheelClassName`（默认 `nowheel`）判定是否拦截滚轮缩放；文本节点 textarea 必须带 `nowheel` 类才能在节点内滚动文本。同理节点拖拽豁免用 `nodrag`（textarea 上拖拽选择文本不移动节点）。
- **剪贴板粘贴**：文件/文本粘贴统一在全局 `paste` 事件中处理（读 `clipboardData.items` 与 `text/plain`，优先级：**节点复制标记 > 文件 > 文本 > 画布内部复制的节点**）。复制节点（`copyNode`）会把「标记 + 节点 JSON」写入系统剪贴板（覆盖旧内容），因此粘贴节点不会被剪贴板中残留的旧文本/文件抢占；标记在 `onPaste` 中**最先**识别（在输入框焦点判断之前，防止标记 JSON 被原生粘贴插入输入框，输入框内粘贴标记仅吞掉不粘贴节点）。`Ctrl+V` 的 keydown 分支**不能 `preventDefault`**（会阻止浏览器派发 paste 事件），仅在剪贴板为空时用宏任务兜底粘贴内部复制的节点。焦点在 INPUT/TEXTAREA 内放行原生粘贴（粘贴进文本节点/编辑器输入框）。
- **删除类操作**：必须走 `confirm` 工具弹窗确认（AGENTS.md 约束）。
- **提交信息**：中文提交信息在 PowerShell 下用 `-m` 会乱码，用 UTF-8 临时文件 `--amend -F` 方式提交。
