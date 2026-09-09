# 配置面板与输入预览

> 返回 [总览与定位](./README.md)

## 配置面板（`CanvasEditorPanel.vue` 实现，由 AssetCanvas 编排）

- 独立悬浮于节点下方的面板（不随节点尺寸撑大），渲染选中节点的 `editorComponent`；组件常驻挂载，显隐由 `visible` prop 驱动，`<Transition>` 与定位逻辑在组件内部。
- **右上角 X 关闭按钮**：关闭面板**仅隐藏面板、保留节点选中与关联高亮**（`selection.dismissPanel`，`panelDismissed` 标志并入 `editorPanelVisible` 判断）；`Esc` 键同样关闭（`useCanvasKeyboard`，输入框聚焦时跳过）。再次点击当前节点或选中其他节点时面板自动重新打开（`onNodeClick` 复位标志）。
- **固定大小不随缩放**：宽度为固定屏幕像素（普通节点 440px、生成图片节点 560px、生成视频节点 720px，见组件内常量 `EDITOR_PANEL_WIDTH[_GENERATE/_VIDEO]`），上限高度 65vh（超出滚动），间距 12px（`PANEL_GAP`）；仅**位置**随节点/视图联动（水平中心与节点中心对齐），视口与画布可视区尺寸由 AssetCanvas 以 props 传入（`viewport`/`flowWidth`/`flowHeight`）。
- **智能贴靠定位（保证面板不遮挡整个节点）**：定位算法抽为纯几何模块 **`canvas/panelPlacement.ts`**（`computePanelPlacement`，无 Vue/DOM 依赖，含单测 `panelPlacement.test.ts`），组件只负责测量后传参。规则：
  1. 候选方向优先级 **下方 → 上方 → 右侧 → 左侧**；「可行」＝ 面板**按原始高度**完整落在可视区内 **且不与节点矩形（含标题条）重叠**；
  2. 左右贴靠时宽度取「节点侧边到可视区边缘的空白」，钳制在 `[PANEL_SIDE_MIN_WIDTH=280, 设计宽度]`（空间不足 280px 放弃该侧）；垂直方向**不与节点垂直居中**（居中会白白压缩高度）——默认顶边对齐节点顶边、高度延伸到可视区底部，下方空间不足时改为底边对齐节点底边（两种锚定取可用高度更大者），仅在可用高度不足时才收窄 `maxHeight`（可用高度 < `PANEL_SIDE_MIN_HEIGHT=240` 时不算可行）；
  3. **可行候选择优**（`compareCandidates`）：不遮标题条 → 不裁切 → **不收窄高度** → 压住其他节点（`obstacles`，由 AssetCanvas 传入除选中节点外的全部节点）面积最小 → 方向优先级。即「下方只需收窄、左右侧能保持完整高度」时选左右侧（贴靠只换行不压缩内容）；上下与左右同为完整高度时仍按 下→上→右→左 保持既有视觉语言；
  4. **滞回**：上一次的贴靠方向仍可行、且与最优候选完全同分时保持不变（`previousSide`），避免平移/缩放/拖动时面板在方向间来回跳变；一旦出现更优位置（如避开其他节点）立即改向；面板关闭或切换节点时复位；
  5. **降级**（无任何可行候选）：按同一排序取最优（都需收窄时取可见高度更大者），并把上下方向的高度收窄到可用空间（`PANEL_MIN_HEIGHT=120` 下限，内容区内部滚动）；
  6. 最终把面板位置钳制进可视区（`PANEL_VIEWPORT_MARGIN=8`），保证永不跑出画布。
- **测量口径**：画布可视区用 `flowEl.clientHeight/Width`（AssetCanvas 的 ResizeObserver 监听 `flowEl`），勿用 Vue Flow `dimensions`（不可靠）；面板高度由面板组件 ResizeObserver 监听 `panelEl` 实测——**必须测「自然高度」**：测量时临时移除面板与内容区的内联 `max-height` 再读 `offsetHeight`（否则读到被钳制后的高度，会形成「面板被压缩 → 测量变小 → 认为空间足够 → 继续压缩」的反馈锁死）；节点切换时复位为 0（此时 `computePanelPlacement` 返回 `unmeasured`，面板不定位 → 测完再定位，避免用乐观估计闪现错误位置）；**节点标题条高度**由组件按 `[data-id="<nodeId>"] .canvas-node__header` 实测（除以 zoom 换算回流坐标，ResizeObserver 跟随标题条；测不到时兜底 24px），用于保证标题条永不被面板覆盖。
- **尺寸下发**：面板内容区 `.canvas-node-editor-panel__body` 的 `width` 与 `max-height` 由定位结果内联下发（左右贴靠时收窄、垂直空间不足时收窄高度并内部滚动）——**高度上限必须同时下发到内容区**，否则面板内容变化长高后会越出定位位置压住节点；编辑器内部本就 `flex-wrap`，收窄后参数行自动换行。
- **淡入淡出**：`<Transition name="editor-panel">` + CSS（opacity 0.18s + `translateY(6px)`）；关闭淡出期间用 `lastPanelStyle` 缓存保持原位不跳位（缓存写在 `watch(editorPanelStyle)`，勿在 computed 内写副作用，会触发 eslint `vue/no-side-effects-in-computed-properties`）。
- 拖拽节点时 `suppressEditor=true` 隐藏面板，仅点击节点才显示；**被拖动的真实节点恰好 1 个**时同时把应用级选中切为单选该节点（`useCanvasSelection.focusNodeForDrag`：`setSelectedNodes([id])` + `suppressPanelOnSelect=true`），使单选联动高亮随拖动实时出现；拖动结束保持选中但不弹面板，再次单击节点才打开。多选整组拖动不改变选中集。
- 程序化选中（粘贴自动聚焦等）置 `suppressPanelOnSelect=true` 抑制面板自动弹出；`onNodeClick`/`onPaneClick`/切换目标时复位。粘贴聚焦通过 `addSelectedNodes`（`useVueFlow`）写入 Vue Flow 内部选中态，需先 `await nextTick()` 等内部 nodeLookup 应用新节点。
- 面板根元素需绑定 `ref="panelEl"`（高度测量）。

### 编辑器组件（editorComponent）约定

- props：`project`、`node`、`inputs`（`CanvasInputInfo[]`，仅生成节点用到）、`isRunning`、`output`（`{ path, token? } | null` —— 当前产物固定路径 + 防缓存 token（产物 mtime），由 AssetCanvas 按 node-info 推导下发，优先于 `config.current` 旧数据）；生成节点另有 `outputPath`（固定产物路径，由 AssetCanvas 按 scope+nodeId+扩展名恒等推导，**文件不存在也有值**，作「上传产物」目标路径）；生成图片编辑器另有 `kind`（画布类型，`ImageGenerateEditor` 用它让「设为分镜场景图」按钮仅分镜画布显示）；视频生成/拼接编辑器另有 `imagesInputs` / `videosInputs` / `audiosInputs`（三组输入，按 `config.inputOrder` 排序，编辑器统一传入）。
- emits：
  - `update:config(patch)` —— 合并写入节点 config（由 `useCanvasNodeOps.onUpdateConfig` 处理，AssetCanvas 接线）；
  - `generate(nodeId)` / `interrupt(nodeId)` / `open-history(nodeId)` / `set-as-scene(nodeId)`；
  - `open-picker(nodeId)` —— 打开资产选择器（加载图片编辑器使用）；
  - `upload-file(nodeId, file, dest)` —— 上传文件：加载节点（加载图片/音频/视频编辑器与节点 body 使用）dest 为 `assert/custom/canvas/` 目标，成功后回写 `config.assetPath`；生成图片/视频节点（「上传产物」按钮）dest 为节点**固定产物路径**（`output.jpg` / `output.mp4`），服务端归档旧产物后覆盖，成功**不回写 config**（固定路径即文件系统事实），仅刷新 node-info。上传进度由 `useCanvasUpload` 管理并渲染在**节点卡片遮罩**上（编辑器不自行显示进度）；编辑器「上传产物」按钮的 loading/禁用由父级经 `uploading` prop 下发（`CanvasEditorPanel` 按 `upload-state` 推导）；成功/失败 snackbar 由组合式统一提示；
  - `disconnect-input(sourceNodeId)` —— 输入缩略图红色 x 快捷断开（生成图片/生成视频/拼接视频/TTS 编辑器使用，断开规则见 [interactions.md](./interactions.md)，输入预览见下文）。
- 新增编辑器时需在 `registry.ts` 为原型挂 `editorComponent`；若用到资产选择器，`AssetCanvas` 的编辑器面板接线（`CanvasEditorPanel`）需给 `@open-picker="openAssetPicker"`。

### 生成节点统一布局

生成图片 / 生成视频（非导演台模式）/ TTS 三个生成节点的配置组件采用统一骨架：**输入预览 → 提示词/文本字段 → 参数行**，让用户聚焦 prompt 编写与输入资源，其余细节参数收纳进可开关的菜单中调整。

- **输入预览**（`editors/CanvasInputPreview.vue`）：按图片/视频/音频三组展示连接到的输入资源（内部复用 `editors/VideoRefInputGroup.vue`），**仅该类型存在输入时渲染对应组**（无输入不显示条目），全部为空时显示占位文案；组内拖拽排序（`reorder` 事件上报本组新顺序，编辑器经 `mergeInputOrder` 合并回全局 `config.inputOrder`）+ 悬浮放大 tooltip（图片/视频/音频可播放）+ 缩略图右上角红色 x 快捷断开（`disconnect-input`）。
- **参数行**（各编辑器内 `.generation-params-row` 紧凑横排，空间不足自动换行）：
  - 工作流：生成图片 = 工作流类型 + 工作流实现两个紧凑下拉；生成视频 = 单个工作流下拉（模式放其前）；TTS = 单个工作流实现下拉；
  - `DurationPicker`（`components/DurationPicker.vue`，时长）：**仅生成视频节点显示**；点击触发行弹出菜单——1~15 秒按钮组（点击即选即关）+ 手动输入（支持小数秒，回车/「应用」确认，非法忽略）；写回按生成模式走 `config.director.duration` / `config.duration`；
  - `WorkflowSizePicker`（输出尺寸）：**仅生成图片/视频节点显示**，点击弹出菜单（比例/分辨率/自定义宽高），图片节点直接绑 `config.sizeConfig`；
  - `WorkflowParamsTrigger`（`components/WorkflowParamsTrigger.vue`，工作流参数）：点击触发行弹出菜单，菜单内嵌 `WorkflowParamsForm`；触发行显示「工作流参数」+ 已配置非默认参数数量徽标。
- **拼接视频节点编辑器**（`editors/ConcatVideoEditor.vue`）在输入预览下方增加：**输入规格探测**（`GET /api/canvas/video-info`，逐段展示 分辨率/帧率/编码/有无音轨）、**编码方式**下拉（重编码 / copy）、**输出尺寸**下拉（取最大的一段 / 取最小的一段 / 自定义；`copy` 时禁用并提示「仅重编码可用」）、`自定义` 时的宽高输入框、目标尺寸提示（`max`/`min` 按像素面积推算）与 copy 规格不一致红字提示（不一致时禁用「拼接」按钮）。
- **导演台模式例外**：生成视频的 `director` 模式保持内嵌导演台布局（首行工作流/模式/全屏、输出规格、内嵌参数表单、`VideoDirector`），仅把「时长(秒)」输入框换成 `DurationPicker`。

## 输入预览（`CanvasInputPreview.vue`，生成节点统一输入区）

- 生成图片/生成视频（首尾帧、参考）/TTS 三个生成节点的配置组件顶部统一由 `CanvasInputPreview` 渲染输入预览：按**图片/视频/音频**三种类型分组（每组复用 `editors/VideoRefInputGroup.vue`，标题形如「图片（2/4）」，前缀 图/视/音，或按模式定制如 帧、图像），**仅存在对应输入的组才渲染**（如生成图片节点只有图片组、TTS 只有音频组、首尾帧只渲染帧图片+可选音频）；全部为空时显示编排编辑器传入的占位文案（如生成图片的「无输入图，默认使用文生图工作流」、TTS 克隆模式的「需先连接加载音频节点」）。
- 悬浮放大：`v-tooltip location="top"` 显示放大内容（图片最大 320px、视频/音频可播放），悬浮在输入**上方**；tooltip 必须带 `interactive`（非交互态内容 `pointer-events: none`，鼠标悬停其上会穿透关闭、无法交互）并配 `close-delay`（宽限指针从缩略图移入内容的时间；进入后由 Vuetify open-on-hover 保持打开，视频/音频可点击播放、拖进度条）。
- 悬浮快捷断开：输入缩略图右上角悬浮显示红色 x，点击断开该输入连接（断开规则见 [interactions.md](./interactions.md)；`remove` 事件 → `disconnect-input`）。
- 拖拽排序：组内 HTML5 DnD，容器 `dragover` 按鼠标水平位置计算插入下标并高亮插入位置；drop 后 `reorder` 事件上报本组新 nodeId 顺序，编辑器经 `mergeInputOrder` 合并回全局 `config.inputOrder` 持久化（只影响本组相对顺序，其他组保持不动）。
- 顺序生效点：`generate.ts: collectInputs / collectInputPaths` 遵循 `config.inputOrder`（未记录的节点按连接顺序排末尾）；生成节点发起生成时也会把该顺序的输入图传给 `image-edit` 工作流。
