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

- 节点产物：`assert/{scope}/canvas/{nodeId}/v{n}.jpg`，版本号 `n = 历史长度 + 1`（客户端预计算，见 `paths.ts` / `types.nextVersion`）。
- 节点 `config` 内回写：
  - `current`: `{ version, path, date }` —— 当前版本产物
  - `history`: `[{ version, path, date }, ...]` —— 全部历史版本（版本历史对话框展示）
- 预览 URL：`/api/fs/{project}/{relPath}?t=...`（`preview.ts: buildPreviewUrl`；带版本号时用 `?t=v{n}` 防缓存）。

---

## 3. 节点类型（`frontend/src/canvas/registry.ts`）

节点原型 `NodePrototype`：`id / name / inputPorts / outputPorts / resizeable / bodyComponent / editorComponent`。

| 原型 | 输入端口 | 输出端口 | 可缩放 | 卡片主体 | 配置组件（editorComponent） |
|------|----------|----------|--------|----------|------------------------------|
| `image-loader`（加载图片） | 无 | `out: image` | 否 | `nodes/ImageLoaderNode.vue` | `editors/ImageLoaderEditor.vue` |
| `image-generate`（生成图片） | `in: image` | `out: image` | 是 | `nodes/ImageGenerateNode.vue` | `editors/ImageGenerateEditor.vue` |
| `text`（文本） | 无 | `out: text` | 是 | `nodes/TextNode.vue` | 无 |

- **加载图片**：`config.assetPath` 绑定一张既有资产（上传到 `assert/custom/canvas/` 或从资产选择器选择）；点击节点出现的配置组件可预览当前图并「上传图片 / 选择资产」。
- **生成图片**：`config` 含 `prompt`（提示词）、`workflowId` / `workflowImpl`（默认有输入图用 `image-edit`，否则 `text-to-image`）、`workflowParams`（用户参数）、`inputOrder`（输入图顺序，见 §7）、`current` / `history`。
- **文本**：`config.text`，可编辑纯文本；当前仅作为 text 类型数据流锚点。

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
| 右键节点 | 菜单：重新生成 / 历史 / 断开连接 / 重命名 / 复制 / 删除（删除需 `confirm` 确认） |
| 右键连线 | 菜单：断开连接 |
| 单击空白 | 取消选中、关闭菜单 |
| 双击空白 | 在光标处打开「添加节点」对话框 |
| 适应视图 / 放大 / 缩小 | 工具栏按钮（`fitView` / `zoomIn` / `zoomOut`） |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销 / 重做（输入框聚焦时跳过） |
| `Ctrl+C` / `Ctrl+V` / `Ctrl+D` | 复制 / 粘贴 / 复制粘贴（重复节点） |
| `Delete` / `Backspace` | 删除选中节点（确认）或选中连线 |
| `Esc` | 关闭右键菜单 / 取消内联重命名 |

> Vue Flow 绑定注意：勿用 `v-model:nodes/edges` 绑 computed（会报 readonly 写入错误），用单向 `:nodes/:edges` + `@node-drag-stop` 回写 + `@edges-change`(remove) 同步删除。

---

## 6. 配置面板（`AssetCanvas.vue` 内联实现）

- 独立悬浮于节点下方的面板（不随节点尺寸撑大），渲染选中节点的 `editorComponent`。
- **固定大小不随缩放**：宽度为固定屏幕像素（普通节点 400px、生成图片节点 500px，见常量 `EDITOR_PANEL_WIDTH[_GENERATE]`），间距 12px（`EDITOR_PANEL_GAP`）；仅**位置**随节点/视图联动（水平中心与节点中心对齐）。
- **边界钳制**：优先放节点下方；放不下且上方有空间则翻转到节点上方；仍放不下则把面板底部钳到画布可视区内（必要时与节点重叠）。钳制用 `flowEl.clientHeight/Width`（ResizeObserver 监听 `flowEl` + `panelEl`）测量，勿用 Vue Flow `dimensions`（不可靠）。
- **淡入淡出**：`<Transition name="editor-panel">` + CSS（opacity 0.18s + `translateY(6px)`）；关闭淡出期间用 `lastPanelStyle` 缓存保持原位不跳位（缓存写在 `watch(editorPanelStyle)`，勿在 computed 内写副作用，会触发 eslint `vue/no-side-effects-in-computed-properties`）。
- 拖拽节点时 `suppressEditor=true` 隐藏面板，仅点击节点才显示。
- 面板根元素需绑定 `ref="panelEl"`（高度测量）。

### 编辑器组件（editorComponent）约定

- props：`project`、`node`、`inputs`（`CanvasInputInfo[]`，仅生成节点用到）、`isRunning`。
- emits：
  - `update:config(patch)` —— 合并写入节点 config（由 `AssetCanvas.onUpdateConfig` 处理）；
  - `generate(nodeId)` / `interrupt(nodeId)` / `open-history(nodeId)` / `set-as-scene(nodeId)`；
  - `open-picker(nodeId)` —— 打开资产选择器（加载图片编辑器使用）。
- 新增编辑器时需在 `registry.ts` 为原型挂 `editorComponent`；若用到资产选择器，`AssetCanvas` 的编辑器插槽需给 `@open-picker="openAssetPicker"`。

---

## 7. 输入图（生成图片节点编辑器）

- 展示：配置面板顶部「输入图」区，每张输入图显示为**缩略图 + 「图像N」标签**（N 为顺序号，随拖拽排序变化；文件名在 title 提示）。
- 悬浮放大：`v-tooltip location="top"` 显示放大图（最大 280px），悬浮在输入图**上方**。
- 拖拽排序：HTML5 DnD，容器 `dragover` 按鼠标水平位置计算插入下标，`--insert-left/--insert-right` 高亮插入位置；drop 后重排并 `emit('update:config', { inputOrder: [sourceNodeId...] })` 持久化。
- 顺序生效点：`generate.ts: collectInputs / collectInputPaths` 遵循 `config.inputOrder`（未记录的节点按连接顺序排末尾）；生成节点发起生成时也会把该顺序的输入图传给 `image-edit` 工作流。

---

## 8. 生成流程（`frontend/src/canvas/useCanvasGeneration.ts`）

1. `generateNode(nodeId)`：收集输入图路径（`collectInputPaths`，含顺序）→ `gen.setInputPaths` → `gen.generate`。
2. `generate`：
   - `image-edit`：`vars = { desc: prompt, imagePaths: JSON.stringify(inputPaths), purpose: 'canvas-image' }`；
   - `text-to-image`：先把 prompt 写入节点目录的 `prompt.md`，`vars = { promptPath, purpose: 'canvas-image' }`。
   - 产物路径 `computeOutputPath`：版本号 = 历史长度 + 1。
3. 轮询 `poll`（2s）：**服务端终态为 `completed` / `failed`**（无 success/error），`completed` 视为成功并回写 `current` + `history`；`failed/error/cancelled` 视为失败显示错误遮罩。
4. 状态机：`statusByNode[nodeId]` = `running | success | error`，节点卡片显示进度遮罩/错误遮罩/「上游已更新」角标（`isUpstreamUpdated`）。
5. 中断 `interrupt`：清轮询、置错误态（v1 无服务端取消端点）。

---

## 9. 自动搭画布（`frontend/src/canvas/autobuild.ts`）

- 工具栏「自动搭画布」：
  - **分镜画布**：根据分镜 `stage.json` 收集引用（场景/角色/变体/custom，`prev` 异步解析为上一分镜最后一帧）→ 生成「加载图片锚点 + 生成图片」结构 → 幂等应用（不重复添加已有引用）。引用解析规则与 `server` 的 `resolveStageAssetPath` / `resolveCharacterAssetPath` 对齐（见 `resolveShotStageRef` / `resolveCharacterRef`）。
  - **场景画布（按子场景）**：读 `prompt/stage/{场景}/variants/{标签}/` 下全部 `{id}.json` 变体元数据 → `buildSubSceneAutoCanvas` 搭建「基础加载图片（所有根变体共用）+ 每个变体一个生成图片（prompt = desc，`config.autoRef` 幂等）+ 变体 refs 加载图片（同资产共享）」→ 幂等应用（已存在节点只补缺连线）。
- 生成节点 prompt：分镜画布取 `overview.json.visual`；场景画布各变体取各自 `desc`。

---

## 10. 设为分镜场景图

- 生成节点编辑器「设为分镜场景图」→ 弹出对话框（`AssetCanvas` 内联 `sceneDialog`）。
- 读取 `prompt/scene/{ep}/{shot}/stage.json` 列出**全部场景帧**（label = `基础场景` || prompt || `分镜场景图 N`，预览 `stage/{i}.jpg`，404 时 `@error` 置 `broken` 显示占位）。
- 点击某帧 → `copyFs(current.path → assert/scene/{ep}/{shot}/stage/{i}.jpg)` 覆盖该帧。
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
  - gen：更新目标 + `reset()`（清轮询与全部状态）。
- `AssetCanvas` 用 `watch(target, ...)` 在切目标时清空选中/菜单/内联重命名状态并调用两个 `switchTarget`。

---

## 12. 前端模块结构

```
frontend/src/
├── canvas/                       # 纯逻辑（可单元测试）
│   ├── types.ts                  # 数据模型 + 版本迁移 + id/版本号工具
│   ├── registry.ts               # 节点原型注册表
│   ├── connection.ts             # 连接校验（类型/成环）
│   ├── paths.ts                  # 定义文件与产物路径
│   ├── preview.ts                # 预览 URL
│   ├── api.ts                    # loadCanvas / saveCanvas
│   ├── generate.ts               # 输入收集（collectInputs/collectInputPaths）、历史、资产读取
│   ├── autobuild.ts              # 自动搭画布
│   │   # 注：autobuild.ts 另含 resolveShotStageRef / resolveCharacterRef / deriveStageRefFromAssetPath / buildSubSceneAutoCanvas
│   ├── useCanvasStore.ts         # 状态：加载/保存(防抖 800ms)/增删改查/撤销重做/剪贴板/switchTarget
│   ├── useCanvasGeneration.ts    # 生成：跑工作流/轮询/中断/历史回写/switchTarget
│   └── *.test.ts                 # 单元测试（共 70+ 用例）
└── components/canvas/
    ├── AssetCanvas.vue           # 主组件：VueFlow 画布 + 工具栏 + 配置面板 + 菜单 + 对话框
    ├── nodes/                    # 节点卡片主体（ImageLoaderNode / ImageGenerateNode / TextNode）
    └── editors/                  # 配置组件（ImageLoaderEditor / ImageGenerateEditor）
```

服务端无画布专属路由：仅使用既有 `GET/POST /api/fs/:project/*`（读写 `canvas.json`）与 `/assets/.../stage`（设为分镜场景图新增帧）。

---

## 13. 开发指南

### 13.1 新增一种节点类型

1. 在 `registry.ts` 注册 `NodePrototype`（端口、resizeable、bodyComponent）。
2. 新建 `components/canvas/nodes/{Xxx}Node.vue`（卡片主体）。
3. （可选）新建 `components/canvas/editors/{Xxx}Editor.vue` 并挂 `editorComponent`；编辑器根元素不要自己定宽度（面板宽度由 AssetCanvas 统一控制）。
4. `config` 字段与既有节点保持兼容（未知字段不影响读取）。

### 13.2 测试与验证

- 单元测试：`frontend/src/canvas/*.test.ts`，命令 `cd frontend && npm test`（服务端 `cd server && npm test`）。
- 修改后必须：`npm run typecheck` + `npm run lint`（AGENTS.md 约束；仅允许 `server/src/assets/refs.ts` 既有 warning）。
- 浏览器验证：`npm run dev` 后访问 `localhost:5233`，用共享浏览器页实测交互（节点点击/拖拽/缩放/连线/生成/设为分镜场景图）。

### 13.3 常见坑

- **Vue Flow 双向绑定**：`v-model:nodes` 绑 computed 报 readonly 写入错误，用单向绑定 + 事件回写。
- **服务端任务终态**：`completed` / `failed`（无 success/error），轮询按 `completed` 判成功。
- **配置双向同步**：editor 内 `config.workflowParams ↔ 本地 ref` 双 watch 必须加 JSON 相等性守卫，否则无限循环。
- **`readFs` 对 `.json` 返回反序列化对象**：加载 `canvas.json` 需同时兼容 string 与 object 两种形态。
- **eslint computed 副作用**：`vue/no-side-effects-in-computed-properties` 禁止在 computed 内写缓存/状态，改用 `watch`。
- **面板钳制**：用 `flowEl.clientHeight/Width` 实测尺寸，勿依赖 Vue Flow `dimensions`。
- **连线右键**：`@edge-context-menu` 需手动 `event.preventDefault()` 阻止浏览器默认菜单叠加。
- **删除类操作**：必须走 `confirm` 工具弹窗确认（AGENTS.md 约束）。
- **提交信息**：中文提交信息在 PowerShell 下用 `-m` 会乱码，用 UTF-8 临时文件 `--amend -F` 方式提交。
