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
│   ├── useCanvasStore.ts         # 状态：加载/保存(防抖 800ms)/增删改查/撤销重做/剪贴板/批量操作（applyNodes/updateNodes/moveEntities/removeNodes/connectGroupToNode/createNodeAndConnect）/持久分组 CRUD（addGroup/updateGroup/updateGroups/removeGroups）/switchTarget
│   ├── useCanvasGeneration.ts    # 生成：跑工作流/轮询（纯体验层，不回写元数据）/统一中断/结果通知/ffmpeg 异步任务（WS 驱动）+ restore/switchTarget
│   ├── taskSocket.ts             # 统一任务 WS 客户端（全局单例：tasks 列表/增量/订阅/中断/断线重连）
│   ├── llmSocket.ts              # 兼容再导出（= taskSocket；新代码请直接用 taskSocket）
│   └── *.test.ts                 # 单元测试（390+ 用例）
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
    └── editors/                  # 配置组件（ImageLoaderEditor / ImageGenerateEditor 等
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
其余画布读写仍走既有 `GET/POST /api/fs/:project/*`（读写 `canvas.json`）与 `/assets/.../stage`（设为分镜场景图新增帧）。

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

## 「获取视频帧」编辑器（`editors/ExtractFrameEditor.vue`）

- 预览输入视频时提供「提取当前帧」按钮：把预览当前 `currentTime` 写入 `config.frameTime` 并立即提取（服务端 `-ss` 按呈现时间精确选帧，拖拽进度条后也与画面一致）；有帧率时同时回显近似 `frameIndex`；
- 手动修改「帧索引」会清除 `frameTime`（改回按帧索引提取）；「提取/重新提取」按钮内置于帧索引输入框右侧；
- 该节点**无历史对话框入口**（编辑器无历史按钮、右键菜单不显示「历史」项）；重复提取时旧产物由服务端自动归档进 `history/output/`（仅文件层面保留，无 UI 查看）；
- 预览 URL 按输入路径缓存，修改帧索引等触发重渲染不会导致视频重载。
