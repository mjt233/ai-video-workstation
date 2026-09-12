# 前端模块结构与服务端路由

> 返回 [总览与定位](./README.md)

## 前端模块结构

```
frontend/src/
├── canvas/                       # 纯逻辑（可单元测试）
│   ├── types.ts                  # 数据模型 + 版本迁移 + id 工具
│   ├── registry.ts               # 节点原型注册表（含 canGenerate/hasHistory 能力标志）
│   ├── connection.ts             # 连接校验（类型/成环）
│   ├── groupSelection.ts         # 多选群组纯函数（包围盒/命中测试/原型兼容性过滤/config id 重映射/合成节点 id）
│   ├── groups.ts                 # 持久分组纯逻辑（色板/最小尺寸/重叠与包含判定/跟随集 R2/初始矩形/默认命名/结构校验）
│   ├── paths.ts                  # 定义文件与产物路径
│   ├── preview.ts                # 预览 URL
│   ├── edgeFlow.ts               # 连线流向箭头动画参数（贝塞尔弧长解析 / 恒定线速度 + 等距多箭头 / 拖动期时序缓存）
│   ├── panelPlacement.ts         # 配置面板定位（纯几何：下→上→右→左 智能贴靠 / 左右自适应收窄宽度 / 滞回 / 标题条避让降级）
│   ├── api.ts                    # loadCanvas / saveCanvas
│   ├── generate.ts               # 输入收集（collectInputs/collectInputPaths）、节点当前资产推导（固定产物路径）
│   ├── aiTextHistory.ts          # AI 文本生成节点文本历史版本（类型/上限/追加/删除/读取过滤）
│   ├── autobuild.ts              # 自动搭画布
│   │   # 注：autobuild.ts 另含 resolveShotStageRef / resolveCharacterRef / deriveStageRefFromAssetPath / buildSubSceneAutoCanvas
│   ├── blueprint.ts              # 画布蓝图纯逻辑（捕获选中集 / 实例化（id 重映射+独立分组）/ 迁移 / 命名 / 统计）
│   ├── canvasMode.ts             # 画布运行模式 provide/inject（'canvas' | 'blueprint'；供节点主体/编辑器门控执行类动作与资产入口）
│   ├── clipboard.ts              # 剪贴板媒体识别（classifyPastedFile/collectPastedMedia/粘贴上传目标路径）
│   ├── nodeClipboard.ts          # 节点复制标记（单/多节点：NODE_GROUP_CLIPBOARD_PREFIX + { nodes, connections, groups }；兼容旧单节点标记与无 groups 字段的旧标记）
│   ├── sceneFrame.ts             # 设为分镜场景图纯函数（buildSceneFrameOptions/deriveStageFrameBody）
│   ├── imageCrop.ts              # 图片修剪与扩展节点：选区数据模型、百分比↔像素换算、八向拖拽几何、背景色/格式净化、画布上限校验、留白比例与显示缩放（nextCropZoom/anchoredZoomScroll）（预览与合成共用的唯一几何口径）
│   ├── imageCompose.ts           # 图片修剪与扩展节点核心：Canvas 2D 合成（fillRect 铺底 + drawImage 负坐标）+ toBlob 编码（纯前端，无外部图像库）+ 结果包装为 File
│   ├── useCanvasStore.ts         # 状态：加载/保存(防抖 800ms)/增删改查/撤销重做/剪贴板/批量操作（applyNodes/updateNodes/moveEntities/removeNodes/connectGroupToNode/createNodeAndConnect）/持久分组 CRUD（addGroup/updateGroup/updateGroups/removeGroups）/switchTarget
│   ├── useCanvasGeneration.ts    # 生成：跑工作流/轮询（纯体验层，不回写元数据）/统一中断/结果通知/ffmpeg 异步任务（WS 驱动）+ restore/switchTarget
│   ├── taskSocket.ts             # 统一任务 WS 客户端（全局单例：tasks 列表/增量/订阅/中断/断线重连）
│   ├── llmSocket.ts              # 兼容再导出（= taskSocket；新代码请直接用 taskSocket）
│   └── *.test.ts                 # 单元测试（800+ 用例）
└── components/canvas/
    ├── AssetCanvas.vue           # 编排层：组装 store/gen/composables，渲染 VueFlow + 子组件
    ├── CanvasToolbar.vue         # 工具栏（视图缩放/撤销重做/自动搭画布/添加节点/保存状态）
    ├── CanvasNodeCard.vue        # 节点卡片（名称头/内联重命名/端口/主体组件/缩放控制点 + 通用 loading/错误遮罩与中断入口 + 成组连接悬停高亮）
    ├── CanvasEditorPanel.vue     # 配置悬浮面板（固定大小、智能贴靠定位（panelPlacement.ts）、淡入淡出；仅单选节点显示）
    ├── CanvasContextMenu.vue     # 节点/连线/群组/分组实体右键菜单（纯展示）
    ├── CanvasAddNodeMenu.vue     # 添加节点菜单（锚点 + VMenu；三列分类：加载/生成/工具，按 registry category 分组）
    ├── CanvasGroupFrame.vue      # 群组虚线框（合成节点 __group-frame 的展示内容；拖动整组由 Vue Flow 原生拖动承接）
    ├── CanvasGroupDot.vue        # 群组输出连接圆点（合成节点 __group-dot 的展示内容；mousedown 启动成组连接拖拽）
    ├── CanvasGroupConnectMenu.vue# 群组连接目标选择菜单（输出点拖拽超阈值释放后弹出）
    ├── CanvasGroupNode.vue       # 持久分组框（标题条/半透明主体/四边拖动条/色点/八向缩放控制点；指针事件分层见 interactions.md）
    ├── ImageCropStage.vue        # 图片修剪与扩展节点的选区合成视图（纯展示：舞台底色=扩展背景色、选区框；编辑器与只读场景共用）
    ├── CanvasSelectionToolbar.vue# 多选悬浮工具栏（多选框顶部居中，含「创建分组」「创建蓝图」；选中集含分组/无节点时分别置灰）
    ├── SetAsSceneDialog.vue      # 设为分镜场景图对话框（帧加载/选中/覆盖/新增）
    ├── CanvasAssertHistoryDialog.vue / AiTextHistoryDialog.vue / SaveAssetDialog.vue / SaveAsDialog.vue  # 历史（产物/文本）/保存为自定义资产/保存为（目标选择）对话框
    ├── composables/              # 画布交互组合式（与组件同域，store/gen/VueFlow 工具以参数注入）
    │   ├── types.ts              # 共享类型（CanvasStoreApi/CanvasGenerationApi/NodeMap 等）
    │   ├── useCanvasFlow.ts      # Vue Flow 数据映射（含群组合成节点与持久分组节点）、拖拽/缩放回写（多节点批量）、连线交互
    │   ├── useCanvasSelection.ts # 选中状态（单/多选 selectedNodeIds + 持久分组 selectedGroupIds）、配置面板信息、整组/分组删除
    │   ├── useCanvasGroup.ts     # 多选包围盒（选中节点 ∪ 选中分组）/输出点拖拽连接/目标原型菜单/成组连接执行与忽略反馈
    │   ├── useCanvasGroups.ts    # 持久分组交互（创建/自定义拖动 R2/缩放回写/改名/改色/解散/框选完全包含判定/多选拖动跟随/Ctrl 穿透状态）
    │   ├── useCanvasMenus.ts     # 右键菜单（节点/群组/分组实体）与添加节点菜单状态/动作
    │   ├── useCanvasRename.ts    # 内联重命名状态
    │   ├── useCanvasPaste.ts     # 剪贴板粘贴（文件/文本/画布内复制节点）+ Ctrl+V 兜底 + Ctrl+D 复制粘贴整组
    │   ├── useCanvasKeyboard.ts  # 全局快捷键（撤销/重做/复制/粘贴/删除/Esc；多选整组语义）
    │   ├── useCanvasNodeOps.ts   # 生成调度（按原型分发）+ 输入收集查询
    │   ├── useCanvasUpload.ts    # 加载节点上传：节点级进度状态（上传中/失败遮罩数据源）+ 上传/重试/中止（reset）
    │   ├── useCanvasDialogs.ts   # 历史/保存资产/场景图/分镜视频/资产选择器状态
    │   └── useCanvasAutobuild.ts # 自动搭画布（引用收集 + 幂等应用）
    ├── nodes/                    # 节点卡片主体（ImageLoaderNode / ImageGenerateNode / TextNode 等）
    └── editors/                  # 配置组件（ImageLoaderEditor / ImageGenerateEditor / ImageCropEditor 等
                                   #  + CanvasInputPreview 统一输入预览；
                                   #  components/ 根级另有 DurationPicker（时长菜单）
                                   # 与 WorkflowParamsTrigger（工作流参数菜单））
```

> 组合式注入约定：只有 `AssetCanvas.vue` 调用 `useVueFlow()`（工具栏/面板/菜单是 VueFlow 的兄弟节点，不能依赖其 inject），`viewport`/`screenToFlowCoordinate`/`findNode`/`addSelectedNodes` 等工具以函数参数注入各组合式；`useVueFlow` 状态始终经 props 传给 `CanvasEditorPanel`。

## 服务端画布专属路由

服务端画布专属路由（`server/src/routes/canvas.ts`，前缀 `/api/canvas`）：
- `POST /canvas/extract-frame`——「获取视频帧」节点：body 可带 `frameIndex`（0=首帧、-1=尾帧…，解码序 select 选帧）或 `time`（秒，按呈现时间精确选帧 `-ss`，与预览画面一致）；
- `GET /canvas/video-info`——返回视频时长/帧率/分辨率（ffprobe），供编辑器「提取当前帧」回显近似帧索引。
- `GET /canvas/node-info`——返回节点产物 `{ exists, mtime, size }`（fs.stat；文件不存在时 exists=false 正常返回），前端画布加载/生成完成时批量刷新。
- `POST /canvas/concat-video`——「拼接视频」节点：body `{ project, videoPaths, outputPath }`，concat demuxer + `-c copy`。
- `POST /canvas/trim-video`——「裁剪视频」节点：body `{ project, videoPath, outputPath, duration, startTime? | startFrame? }`；重编码裁剪（不用 `-c copy`），产物覆盖 `output.mp4`。
- `POST /canvas/trim-audio`——「裁剪音频」节点：body `{ project, audioPath, outputPath, startTime, duration, format?, mp3Bitrate? }`；输入须在 `assert/` 下、输出须为画布节点固定产物（`output.flac|wav|mp3|ogg|m4a|aac`，见 `assets/trim-audio.ts` 的 `assertAudioTrimOutputPath`）；重编码输出（不用 `-c copy`，小数秒切口准确），`format` 可选（`'---'` 原格式：产物扩展名须与输入一致、按输入扩展名编码；`wav`/`flac`/`mp3`：产物扩展名须与格式一致），`mp3Bitrate` 可选（128/192/320，仅 mp3 编码生效）；返回 `{ success, path, duration }`（duration 为实际时长，超出片尾被截短）。
- `POST /canvas/upload`——**生成图片/视频节点手动上传产物**：multipart `{ project, path, file }`；path 须匹配画布节点固定产物路径（`assert/(scene/…|stage/…)/canvas/…/output.jpg|mp4`，见 `assets/canvas-upload.ts` 的 `assertCanvasNodeOutputPath`）；图片接受 jpg/png/webp（统一落盘 `output.jpg`）、视频仅接受 mp4（扩展名或 MIME 任一匹配）；写入前先 `copyExistingAssetToHistory` 归档旧产物（**归档失败中断上传**，历史必须保留），返回 `{ success, path, archived }`。multer diskStorage 临时落盘、上限 8GB（大视频不占内存）。
- 四个写产物分支（extract/concat/trim-video/trim-audio）在写入前调用 `copyExistingAssetToHistory` 归档旧产物（固定路径重复生成时历史自动保留）。
- **图片修剪与扩展节点（image-crop）不新增服务端端点**：产物由前端 Canvas 合成后走既有 `POST /canvas/upload` 落盘（服务端只把产物路径白名单放宽到 `output.(jpg|png|mp4)`、PNG 要求 `image/png` MIME 或 `.png` 扩展名）。纯前端生成的取舍说明见 [node-types.md](./node-types.md) 该节点条目。
- 其余画布读写仍走既有 `GET/POST /api/fs/:project/*`（读写 `canvas.json`）与 `/assets/.../stage`（设为分镜场景图新增帧）。

## 服务端蓝图路由（`server/src/routes/blueprints.ts`，前缀 `/api/blueprints`）

- `GET /blueprints?scope=global|project&project=`——蓝图摘要列表（按更新时间倒序）；
- `GET /blueprints/:id?scope=&project=`——蓝图详情（含 `rev`）；
- `POST /blueprints`——创建（同名 409 EXISTS 携带 existingId；`overwrite: true` 覆盖既有条目）；
- `PUT /blueprints/:id?scope=&project=`——局部更新（name/description/assetProject/nodes/connections/groups）+ CAS `expectedRev`（409 VERSION_CONFLICT；`force: true` 跳过比对）；
- `DELETE /blueprints/:id?scope=&project=`——删除；
- `POST /blueprints/import`——导入蓝图文件内容（服务端换新 id）。

存储：全局 `server/config/blueprints/{id}.json`、项目级 `design/{project}/prompt/blueprint/{id}.json`（一蓝图一文件、原子写、`rev` 由服务端维护）。详见 [blueprint.md](./blueprint.md)。

## 历史与迁移

- 节点历史由服务端 `assets/history.ts` 统一管理（history 目录 + `/api/assets/:project/history*` 通用端点）；引擎（`workflow-engine.ts`）任务完成时同样先 copy 归档再写固定路径产物。
- 旧版 `v{n}` 产物一次性迁移：`cd server && npm run migrate:canvas-outputs [project]`（最高版本 → `output.{ext}`，其余 → `history/output/{时间戳}.{ext}`；幂等，只改 assert/ 不动 canvas.json）。

## 「图片修剪与扩展」编辑器（`editors/ImageCropEditor.vue`）

- **图像局部框选器**：`ImageCropStage`（纯展示合成视图：舞台底色 = 扩展区域背景色、半透明时叠棋盘格）之上叠加八个缩放手柄（四角 + 四边）与框内整体位移层；指针事件用 `pointerdown/move/up` + `window` 监听，**拖动期间只更新本地临时选区（每帧实时刷新像素尺寸读数），`pointerup` 才一次性写回 `config.crop`**（单次撤销，不污染撤销栈）；双击舞台恢复整幅。
- **扩展空间与显示缩放**：舞台是源图的**两轴等比放大**（每边留出与源图显示尺寸等大的空白，`IMAGE_CROP_STAGE_MARGIN_RATIO = 1` ⇒ 舞台 = 源图 × 3，**舞台宽高比 = 源图宽高比本身**），默认缩放下源图偏小，用**框选区内滚轮缩放**补偿——舞台宽度取「编辑区视口宽 × 缩放倍率」（`width: zoom*100%` + `aspect-ratio`，整块等比放大）。**编辑区是固定高度视口**：滚动容器宽度撑满、高度由 `aspect-ratio`（= 源图宽高比）给出 ⇒ 恰好容纳 1 倍下的整块舞台，`min-height` / `max-height: 60vh` 兜底；因此滚轮缩放只改变视口内舞台的尺寸（超出部分由滚动条承担），**编辑区与整个配置面板的尺寸都不会随之变化**。`nextCropZoom` 分档（1~8 倍）、`zoomByWheelDelta` 按滚轮位移取指数映射（并把 `deltaMode` 归一到像素）、`anchoredZoomScroll` 以指针为锚点修正 `scrollLeft/scrollTop`（须 `nextTick` 后再写，否则按旧尺寸被钳制）；右上角浮条另给 `−/%/+/复位` 按钮。**缩放只是显示，不写入 `config`**，拖拽换算仍以 `stageRect` 实测矩形为基准，故任意缩放下都精确。
- **实时像素尺寸**：`resolveCropGeometry(crop, srcW, srcH)` 是唯一几何口径，驱动两处读数（选区右下角 `W × H` 浮标 / 状态行「源图 → 输出 + 扩展边距」）；面板**没有宽高输入框**——输出尺寸只由选区决定。
- **背景色**：面板上只有一个色块，点击打开 `v-color-picker`（`mode="rgba"`：饱和度面板 + 色相滑杆 + alpha 滑杆，透明度也在调色盘内调），`hide-inputs` 去掉内置文本输入；调色盘下方 4 个预设色块只换基色、保留当前透明度（`colorWithAlpha` + `colorAlpha`）。
- **执行**：`loadImageElement` 取源图（同源预览 URL）→ `composeCropToBlob`（主线程 Canvas 合成 + `toBlob`）→ `composeResultToFile` → `upload-file` 事件交由 AssetCanvas 的 `useCanvasUpload` 上传到节点固定产物路径；成功后 `refreshNodeOutput` 刷新 mtime（预览 URL 以 mtime 作缓存键），并由 `syncImageCropOutputMirror` 静默写回 `config.outputExt`。
- **节点主体**（`nodes/ImageCropNode.vue`）与「加载图片」节点同一约定：只显示当前产物图（`v-img contain`，按 path + mtime 作缓存键），**不带任何可交互 UI**，根元素**不带 `nodrag`** ⇒ 只剩「点击打开面板」与「拖动节点」两种交互；图片设 `pointer-events: none` 避免原生图片拖动干扰节点拖动。
- **错误处理**：尺寸超限 / 无 2d 上下文 / 编码失败 / 源图加载失败一律在面板红字展示 + `console.error`（不静默，符合「异常必须上抛或打日志」约束）；上传失败走通用上传遮罩（含重试）。

## 「获取视频帧」编辑器（`editors/ExtractFrameEditor.vue`）

- 预览输入视频时提供「提取当前帧」按钮：把预览当前 `currentTime` 写入 `config.frameTime` 并立即提取（服务端 `-ss` 按呈现时间精确选帧，拖拽进度条后也与画面一致）；有帧率时同时回显近似 `frameIndex`；
- 手动修改「帧索引」会清除 `frameTime`（改回按帧索引提取）；「提取/重新提取」按钮内置于帧索引输入框右侧；
- 该节点**无历史对话框入口**（编辑器无历史按钮、右键菜单不显示「历史」项）；重复提取时旧产物由服务端自动归档进 `history/output/`（仅文件层面保留，无 UI 查看）；
- 预览 URL 按输入路径缓存，修改帧索引等触发重渲染不会导致视频重载。
