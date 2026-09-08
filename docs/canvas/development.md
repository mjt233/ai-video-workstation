# 开发指南

> 返回 [总览与定位](./README.md)

## 新增一种节点类型

1. 在 `registry.ts` 注册 `NodePrototype`（端口、resizeable、bodyComponent）。
2. **生成类节点**在原型上声明 `outputExt`（产物固定文件名扩展名，如 `jpg`/`mp4`/`png`/`flac`）——产物展示/按钮文案由 AssetCanvas 按固定路径 + node-info 推导后经 `output` prop 下发，组件内优先读 `props.output`、`config.current` 仅作旧数据回落；加载类节点（`config.assetPath`）无需声明。
3. 新建 `components/canvas/nodes/{Xxx}Node.vue`（卡片主体）。
4. （可选）新建 `components/canvas/editors/{Xxx}Editor.vue` 并挂 `editorComponent`；编辑器根元素不要自己定宽度（面板宽度由 AssetCanvas 统一控制）。
5. `config` 字段与既有节点保持兼容（未知字段不影响读取）。
6. **节点主体不要自行渲染 running/error 遮罩**：loading/错误状态是节点的通用能力，由 `CanvasNodeCard` 按 `status` prop 统一叠加（含「中断」按钮）；生成类节点只要经 `gen.generate` / ffmpeg 同步函数进入 running，即自动获得 loading 展示与中断能力。**例外（唯一）**：AI 文本节点声明 `statusOverlay` 为**空组件**（`() => null`）——节点主体完全自绘运行/错误状态 UI（节点内 Thinking 条 + 「停止」按钮 + 响应区错误红字），画布不渲染任何遮罩；声明空组件仅为让 `CanvasNodeCard` 跳过默认整体阻塞遮罩（默认遮罩会拦截流式输出与节点内控件）。需要同样形态的节点类型按此扩展点自行声明（见 [llm-session.md](./llm-session.md)）。
7. **LLM 会话节点（text-ai）状态机接入约定**：节点内生成经 `stream-state` emit（running/log/taskId → 父级 `gen.beginClientRun`；终态 result{status/patch/rev} → `adoptExternalChange` + `endClientRun`），`isRunning`/`activeTaskId`/`runningLog`/`canvasTarget` 由父级按 `statusByNode` 下发 prop（恢复态同样禁用控件、「停止」可用）；流式输出走 `update:output-view` → `store.viewOnlyUpdate`（**纯内存，不写盘、不入撤销栈**）。

## 测试与验证

- 单元测试：`frontend/src/canvas/*.test.ts`，命令 `cd frontend && npm test`（服务端 `cd server && npm test`）。
- 修改后必须：`npm run typecheck` + `npm run lint`（AGENTS.md 约束；仅允许 `server/src/assets/refs.ts` 既有 warning）。
- 浏览器验证：`npm run dev` 后访问 `localhost:5233`，用共享浏览器页实测交互（节点点击/拖拽/缩放/连线/生成/设为分镜场景图）。

## 常见坑

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
- **轮询状态会级联重置连线/节点动画**：生成轮询每 tick 都整体重写 `statusByNode[nodeId]`（`lastLog` 变化），画布模板读到它必然重渲染并产生**新的插槽函数引用**。若把「运行中节点集合」等派生集实现为 computed，每次重算返回新 Set 实例 → `flowEdgeList` 重算出新数组 → Vue Flow 触发 `setEdges` 整体重建边对象 → EdgeWrapper 重渲染时以**已变化的插槽函数**作为组件类型（源码 `h(slots['edge-default'], …)`），Vue 判定为不同组件而 remount 插槽子树——连线箭头动画（`offset-path` 移动）被反复归零，节点脉冲动画同理。**派生集必须用 `watch` + 内容相等性守卫维护实例稳定**（内容不变则不替换 Set，见 AssetCanvas 的 `runningNodeIds`），轮询期间下游 computed 全部命中缓存零重算。
- **删除类操作**：必须走 `confirm` 工具弹窗确认（AGENTS.md 约束）。
- **提交信息**：中文提交信息在 PowerShell 下用 `-m` 会乱码，用 UTF-8 临时文件 `--amend -F` 方式提交。
