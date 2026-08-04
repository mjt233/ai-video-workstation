# 资产画布 · 衍生变体自动搭画布 设计

日期：2026-08-04
状态：已批准

## 1. 背景与问题

「资产画布」的【自动搭画布】功能存在两个问题：

1. **分镜画布路径错误**：当分镜 `stage.json` 的 `基础场景` 引用的是场景衍生变体（`场景名/标签@变体id`）时，`buildShotRefsFromStage` 拼出的路径是 `assert/stage/{场景名}/{标签}@变体id.jpg`，而正确路径是 `assert/stage/{场景名}/variants/{标签}/{变体id}.jpg`，导致「加载图片」节点加载失败。此外 `custom/{路径}`、角色变体、`prev` 引用也未对齐服务端解析规则。

2. **场景画布不搭变体**：场景画布目前只有一个 `canvas.json` 装全部子场景，自动搭画布只收集基础子场景 `.md`，完全不处理 `variants/{label}/{变体id}` 下的衍生变体结构。

## 2. 决策记录（头脑风暴结论）

| 决策点 | 结论 |
|--------|------|
| 子场景画布组织 | **一个子场景 = 一个画布**；画布内含基础图锚点 + 全部变体链 |
| 变体节点结构 | 每个变体必为【生成图片】节点；根变体（无 `parentId`）接子场景【加载图片】节点；嵌套变体接父变体【生成图片】节点；变体 `refs` 用【加载图片】节点 |
| 画布文件存储 | `prompt/stage/{场景}/canvas/{label}.json` 平铺；**不迁移**旧根级 `canvas.json`（直接忽略） |
| 画布入口选择 | 画布 Tab **跟随 URL `subscene`**（左侧资产浏览器选中），未选子场景显示空状态；切换自动跟随加载 |
| 问题 1 修复范围 | **C+B 全量对齐服务端**：场景变体 + `custom/` + 角色变体 + `prev` |
| 资产选择器 | 「分镜场景图」页签支持**指定集数 + 分镜**下拉选择，不再仅限当前上下文 |

## 3. 一、分镜画布路径修复

### 3.1 引用解析规则（对齐 `server/src/workflow-engine.ts`）

抽纯函数（放 `frontend/src/canvas/autobuild.ts`，便于单测）：

**`resolveShotStageRef(baseStage: string): { assetPath: string; label: string } | null`**

| 引用格式 | 解析为 |
|----------|--------|
| `场景名/标签` | `assert/stage/{场景名}/{标签}.jpg` |
| `场景名/标签@变体id` | `assert/stage/{场景名}/variants/{标签}/{变体id}.jpg` |
| `custom/{路径}` | `assert/custom/{路径}`（含扩展名，原样透传） |
| `prev` | 返回 `null`（由调用方异步解析，见 3.2） |

- 注意用**第一个 `@`** 分割（服务端 `indexOf('@')` 语义），`/` 用 `main.indexOf('/')` 定位，与 `resolveStageAssetPath` 一致。
- label 用原始引用字符串（如 `场景/标签@变体`）。

**`resolveCharacterRef(character: string): { assetPath: string; label: string } | null`**

| 引用格式 | 解析为 |
|----------|--------|
| `角色名` | `assert/character/{角色名}/appearance.jpg` |
| `角色名@变体id` | `assert/character/{角色名}/variants/{变体id}.jpg` |
| `custom/{路径}` | `assert/custom/{路径}`（含扩展名） |

### 3.2 `prev` 异步解析

`prev` 需要读上一分镜的 `stage.json`，因此解析放在 `collectRefs`（`AssetCanvas.vue`，本就是 async）：

- 分镜号 `shot > 1` 才可解析；读 `prompt/scene/{ep}/{shot-1}/stage.json`，取 `数组长度 - 1` 作为帧下标 → `assert/scene/{ep}/{shot-1}/stage/{last}.jpg`
- 读不到或为空 → 跳过该引用（不抛错打断自动搭画布）
- 锚点 label = `上一分镜场景图`

### 3.3 `buildShotRefsFromStage` 改造

- `prev` 由 `collectRefs` 内联解析（见 3.2）后并入 refs；`buildShotRefsFromStage` 保持纯函数，对非 `prev` 引用用 `resolveShotStageRef` / `resolveCharacterRef`。
- 角色变体引用不再降级为基础外观（行为变更，需更新既有测试）。

## 4. 二、场景画布按子场景 + 变体

### 4.1 路径与数据模型

`frontend/src/canvas/paths.ts` 增加 label 维度：

- `stageCanvasRelPath(stage: string, label: string): string` → `prompt/stage/{stage}/canvas/{label}.json`
- `sceneCanvasRelPath` 不变。
- `canvasAssetDir(scope)`：stage 时**必传 label** → `assert/stage/{stage}/canvas/{label}`（旧根级画布已废弃忽略，不存在无 label 的 stage 调用）。

`target` 结构增加 `label`（仅 stage）：

```ts
{ kind: 'stage', stage: string, label?: string }
{ kind: 'scene', episode, shot }
```

- `useCanvasStore` / `useCanvasGeneration` / `switchTarget` 支持 label 维度：切换 label 时先落盘旧目标、重置状态、重新加载。
- 旧根级 `canvas.json`：**忽略不迁移**（保留文件但不读写）。

### 4.2 UI 入口

- `StagePanel.vue`：`AssetCanvas` 增加 `:label="props.subscene"`。
- `AssetCanvas.vue`：新增 prop `label?: string`（仅 stage 使用）。
  - stage 且无 label → 画布区显示空状态「请从左侧选择子场景」，不加载。
  - `watch([project, kind, stage, episode, shot, label])` 驱动 `switchTarget` 跟随切换（复用现有机制）。

### 4.3 自动搭画布（子场景级）

**新纯函数 `buildSubSceneAutoCanvas`**（`frontend/src/canvas/autobuild.ts`）：

入参：

```ts
interface StageVariantRef {
  id: string            // 变体 id
  desc: string          // 衍生描述 → 生成节点 prompt
  parentId?: string     // 父变体 id（同 label 内）
  refs: string[]        // 额外引用资产路径（assert/ 开头）
}

buildSubSceneAutoCanvas(
  data: CanvasData,
  label: string,                 // 子场景标签
  baseAssetPath: string,         // assert/stage/{stage}/{label}.jpg
  variants: StageVariantRef[],
  x = 80, y = 80,
): AutoBuildResult
```

节点与连线：

1. **基础【加载图片】节点**：`assetPath = baseAssetPath`，只建一个（所有根变体共用）。
2. **每个变体一个【生成图片】节点**：`config.prompt = desc`，`config.autoRef = 'stage:{label}@{id}'`。
3. 连线：
   - 根变体（无 `parentId`）← 基础加载节点
   - 嵌套变体（有 `parentId`）← 父变体生成节点
   - 变体 `refs` → 各自【加载图片】节点（`assetPath = ref`），连接到该变体生成节点
4. **幂等**：
   - 加载节点按 `config.assetPath` 判重（与 `buildAutoCanvas` 一致，同图共享）
   - 生成节点按 `config.autoRef` 判重
   - 已存在对应节点则不重复创建，只补充缺失连线（若目标生成节点存在但缺连线则补连）

布局：基础加载节点在左列，变体生成节点按「根变体 → 嵌套」层级向右排布（沿用现有锚点 `x` 递增 `320`、`y` 递增 `160` 的粗略网格即可，用户可手动调整）。

### 4.4 `collectRefs`（stage 分支）改造

当前逻辑：读 `prompt/stage/{stage}` 下 `*.md` → 全量基础图 refs。
改为（子场景级）：

1. 读 `prompt/stage/{stage}/variants/{label}/` 目录下全部 `{id}.json` 变体元数据（`desc` / `parentId` / `refs`），过滤出非空 id。
2. 基础图路径 = `assert/stage/{stage}/{label}.jpg`。
3. 若目录不存在或无变体 → 只搭基础加载节点（退化行为：仍给用户一个基础图锚点）。

### 4.5 `collectPrompt`（stage 分支）改造

- 基础加载节点不需要 prompt。
- 变体生成节点 prompt 各自取 `desc`，不再用「第一个子场景 md 内容」作为单一 prompt。
- 保留 `mergePrompt` 兼容：若画布已有生成节点且带 prompt，自动搭画布不覆盖（幂等语义）。

### 4.6 设为分镜场景图（顺带闭环）

`deriveStageFrameBody`（`AssetCanvas.vue`）补充对变体输入路径的解析：

- `assert/stage/{场景}/variants/{标签}/{变体}.jpg` → `基础场景 = {场景}/{标签}@{变体}`
- 与 3.1 的引用格式闭环（服务端 `resolveStageAssetPath` 能解析回同一路径）。

## 5. 三、资产选择器支持指定集数分镜的场景图

`frontend/src/components/AssetPickerDialog.vue`：

- 「分镜场景图」页签：
  - 顶部加**集数 + 分镜**两个下拉框：集数枚举 `prompt/scene/` 下的目录；分镜枚举 `prompt/scene/{ep}/` 下的目录。
  - 默认值 = `contextEpisode` / `contextShot`（未提供则为空，用户手动选）。
  - 页签可见性不再依赖 `hasSceneContext`（有 `scene-stage` tab 即可见）；未选 ep/shot 时显示提示 + 下拉。
  - `loadSceneStages` 改为读取选中的 `assert/scene/{ep}/{shot}/stage/`。
- `AssetCanvas.vue` 的 `AssetPickerDialog`：
  - `:tabs` 增加 `'scene-stage'`（加载图片节点可绑定分镜场景图，含 prev 场景图的场景）。
  - 分镜画布传 `:context-episode` / `:context-shot`；场景画布不传（靠下拉选择）。
- `VideoDirector.vue` 已传 `scene-stage` + 上下文，行为不变（新增下拉可自由切换）。

## 6. 测试与验证

### 单元测试

- `frontend/src/canvas/autobuild.test.ts`：
  - `resolveShotStageRef`：基础 / 变体 / custom / prev(null) / 无效格式
  - `resolveCharacterRef`：基础 / 变体 / custom
  - `buildShotRefsFromStage`：变体场景引用、角色变体引用、custom 引用；更新既有用例（角色变体不再降级基础外观）
  - `buildSubSceneAutoCanvas`：空画布全搭、根变体接基础图、嵌套变体接父变体、refs 加载节点共享、幂等（重复调用不新增节点）
- `frontend/src/canvas/paths.test.ts`：label 维度路径（定义文件 / 产物目录 / 节点产物）。

### 浏览器验证（`npm run dev` → localhost:5233）

1. 分镜-资产画布：`基础场景` 含 `场景/标签@变体` 的分镜，自动搭画布后「加载图片」能正常显示变体图。
2. 场景-资产画布：选中带变体的子场景，自动搭画布后出现「基础图 + 各变体生成节点 + refs 加载节点」，连线正确；再次点击不重复创建。
3. 切换子场景，画布自动跟随加载；未选子场景时显示空状态。
4. 资产选择器「分镜场景图」：选任意集数/分镜能看到对应帧图并选中。
5. 设为分镜场景图：从变体生成节点新增帧时，`stage.json` 写入 `场景/标签@变体`。

## 7. 约束

- 修改后必须 `npm run typecheck` + `npm run lint`（AGENTS.md）。
- 删除类操作必须 `confirm` 弹窗（本设计无删除操作）。
- 提交信息用中文，PowerShell 下用 UTF-8 临时文件 `-F` 方式提交。
