# Vue + Vuetify 升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将前端 `vue` 升级到 `3.5.41`、`vuetify` 升级到 `4.1.7`，迁移所有破坏性变更（排版类、网格、CSS reset），确保 `typecheck` / `lint` / 单测 / `build` 全部通过。

**Architecture:** 纯前端升级。先升级依赖并以 `typecheck` 暴露破坏点；随后按「视图层 → 组件目录」分组机械迁移排版类（旧 MD2 类名 → 新 MD3 类名）；再迁移 5 处 `v-row dense` → `density="compact"`；最后做 CSS reset 验证与全量回归。每个任务组独立提交，保证可逐段回滚。

**Tech Stack:** Vue 3.5（`<script setup>` + TS）、Vuetify 4（全量组件注册）、Vite 6、vue-tsc、vitest。

**前置状态（已验证）：**
- 当前分支 `vuetify-upgrade`，工作区干净
- Vuetify 4 peer deps：`vue ^3.5.0`（目标 3.5.41 满足）
- 工具链（vite 6 / plugin-vue 5 / vue-tsc 3.3 / TS 5.7）**保持不动**
- `MarkdownView.vue` 已有完整 scoped 样式（h1-h6/p/列表/表格均显式定义 margin），**不依赖** Vuetify 全局 reset

---

## 权威排版映射表（本计划所有排版迁移任务统一使用）

| 旧类名（v3 MD2） | 新类名（v4 MD3） | 备注 |
|---|---|---|
| `text-h5` | `text-headline-small` | 24px 完全一致 |
| `text-h6` | `text-title-large` | 20→22px 微差 |
| `text-subtitle-1` | `text-body-large` | 16px 完全一致 |
| `text-subtitle-2` | `text-title-small` | 14px 完全一致 |
| `text-body-1` | `text-body-large` | 16px 完全一致 |
| `text-body-2` | `text-body-medium` | 14px 完全一致 |
| `text-caption` | `text-body-small` | 12px 完全一致 |

**替换规则：** 模板中所有 `class` 属性（以及 `<v-card-title>`、`<v-list-item-title>` 等组件的 class）里的旧类名按上表逐词替换，**只替换类名本身，其余类（`text-grey`、`text-medium-emphasis`、`pa-2`、`font-weight-medium` 等）与结构一律不动**。

> ⚠️ 注意：`typecheck` **无法**捕获错误的 CSS 类名（类名只是字符串）。因此每个排版任务都以「grep 旧类名确认零残留」作为验收。

---

## Task 1: 升级依赖

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: 修改依赖版本**

在 `frontend/package.json` 中，将 `dependencies` 的这两行：

```json
    "vue": "^3.5.0",
    "vuetify": "^3.7.0"
```

改为：

```json
    "vue": "^3.5.41",
    "vuetify": "^4.1.7"
```

- [ ] **Step 2: 安装依赖**

在 `frontend/` 目录运行：

```bash
cd frontend
npm install
```

Expected: 安装成功，`package-lock.json` 同步更新；`npm ls vue vuetify` 显示 `vue@3.5.x`、`vuetify@4.1.x`。

- [ ] **Step 3: 运行 typecheck 获取基线错误清单**

在仓库根目录运行：

```bash
npm run typecheck
```

Expected: 前端会出现类型错误（Vuetify 4 类型不匹配的破坏点清单）。**记录全部错误**（文件 + 行号 + 错误信息），作为后续任务的索引。如果 `typecheck` 直接通过，说明无类型破坏点，可跳过对应修复，但仍需完成排版/网格迁移。

> 说明：此时不提交。依赖升级 + 后续迁移在各自任务中分步提交。

---

## Task 2: 核对插件配置

**Files:**
- Verify: `frontend/src/plugins/vuetify.ts`（预期无需改动）

- [ ] **Step 1: 核对 `vuetify.ts` 四项内容**

打开 `frontend/src/plugins/vuetify.ts`，确认：

1. `import { createVuetify } from 'vuetify'` ✅（v4 兼容）
2. `import 'vuetify/styles'` ✅（v4 标准全部导入入口，无需改动）
3. `import '@mdi/font/css/materialdesignicons.css'` ✅（MDI 图标集兼容 v4）
4. `theme.defaultTheme: 'light'` ✅（**必须保留**——v4 默认改为 `system`，不显式设置会跟随系统暗色模式）

- [ ] **Step 2: 运行 typecheck 验证插件文件**

```bash
npm run typecheck:frontend
```

Expected: `plugins/vuetify.ts` 无类型错误。若有 Vuetify 4 类型报错（如 theme 配置类型变化），按报错信息修复该文件后重新运行直到通过。

- [ ] **Step 3: 提交**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/plugins/vuetify.ts
git commit -m "chore: 升级 Vue 3.5.41 与 Vuetify 4.1.7"
```

> 若 Step 3 的 typecheck 暴露出 `vuetify.ts` 之外文件的错误，不在此任务修复——它们由后续排版/网格任务处理，但**必须先在文档中记录**。

---

## Task 3: 排版类迁移——视图层

**Files（2 个）:**
- Modify: `frontend/src/views/ProjectSelectPage.vue`（1 处：`text-h5`）
- Modify: `frontend/src/views/ProjectView.vue`（3 处：`text-body-2` ×1、`text-caption` ×2）

- [ ] **Step 1: 迁移 `ProjectSelectPage.vue`**

将第 11 行：

```html
      <v-card-title class="text-primary text-h5 font-weight-bold">
```

改为：

```html
      <v-card-title class="text-primary text-headline-small font-weight-bold">
```

- [ ] **Step 2: 迁移 `ProjectView.vue`**

三处分别替换（映射表）：

- 第 109 行 `class="text-body-2 font-weight-medium"` → `class="text-body-medium font-weight-medium"`
- 第 111 行 `class="text-caption text-grey"` → `class="text-body-small text-grey"`
- 第 130 行 `class="text-caption text-medium-emphasis"` → `class="text-body-small text-medium-emphasis"`

- [ ] **Step 3: 验证零残留**

```bash
cd frontend
Select-String -Path "src\views\*.vue" -Pattern "text-h[1-6]\b|text-subtitle-[12]\b|text-body-[12]\b|text-caption\b|text-overline\b|text-button\b"
```

Expected: 无任何输出（0 匹配）。

> 注意：pattern 必须精确匹配**旧**类名（`text-body-[12]` 而非 `text-body`），因为新类名 `text-body-medium`/`text-body-small` 包含 `text-body` 子串，会被误报。

- [ ] **Step 4: typecheck + 提交**

```bash
npm run typecheck:frontend
cd ..
git add frontend/src/views
git commit -m "refactor: 视图层排版类迁移到 Vuetify 4 MD3 类名"
```

---

## Task 4: 排版类迁移——asset-picker 组件

**Files（9 个，均在 `frontend/src/components/asset-picker/` 下）:**
- Modify: `AssetThumb.vue`（1 处 `text-caption`）
- Modify: `AudioFileBrowser.vue`（4 处：`text-caption` ×4）
- Modify: `AudioPicker.vue`（1 处 `text-caption`）
- Modify: `CustomAssetsGrid.vue`（2 处：`text-caption` ×2）
- Modify: `EntityAssetTree.vue`（6 处：`text-caption` ×5、`text-body-2` ×1）
- Modify: `ParentVariantGrid.vue`（4 处：`text-body-2` ×2、`text-caption` ×2）
- Modify: `SceneStagePicker.vue`（2 处：`text-caption` ×2）
- Modify: `SelectedAssetsBar.vue`（3 处：`text-caption` ×3）
- Modify: `VoiceLinesList.vue`（2 处：`text-caption` ×2）

- [ ] **Step 1: 按映射表替换全部旧类名**

对上述 9 个文件中的所有 `text-caption` → `text-body-small`、`text-body-2` → `text-body-medium`，只替换类名本身。代表性示例（`AssetThumb.vue` 第 13 行）：

```html
      <div class="d-flex align-center justify-center fill-height text-caption text-grey">
```

改为：

```html
      <div class="d-flex align-center justify-center fill-height text-body-small text-grey">
```

- [ ] **Step 2: 验证零残留**

```bash
cd frontend
Select-String -Path "src\components\asset-picker\*.vue" -Pattern "text-h[1-6]\b|text-subtitle-[12]\b|text-body-[12]\b|text-caption\b|text-overline\b|text-button\b"
```

Expected: 无任何输出（0 匹配）。

- [ ] **Step 3: typecheck + 提交**

```bash
npm run typecheck:frontend
cd ..
git add frontend/src/components/asset-picker
git commit -m "refactor: 资产选择器组件排版类迁移到 Vuetify 4 MD3 类名"
```

---

## Task 5: 排版类迁移——主 components（一）

**Files（9 个，均在 `frontend/src/components/` 下）:**
- Modify: `AssetHistoryDialog.vue`（4 处：`text-body-2` ×2、`text-caption` ×2）
- Modify: `AssetTree.vue`（1 处 `text-body-2`）
- Modify: `BatchGenerateDialog.vue`（5 处：`text-body-2` ×4、`text-caption` ×1）
- Modify: `CharacterPanel.vue`（2 处：`text-subtitle-1` ×1、`text-body-2` ×1）
- Modify: `CharacterPicker.vue`（3 处：`text-body-2` ×1、`text-caption` ×2）
- Modify: `ConfirmDialog.vue`（1 处 `text-body-2`）
- Modify: `CustomAssetPanel.vue`（1 处 `text-caption`）
- Modify: `CustomAssetSection.vue`（2 处：`text-body-2` ×1、`text-caption` ×1）
- Modify: `GenerateDialog.vue`（4 处：`text-caption` ×4）

- [ ] **Step 1: 按映射表替换全部旧类名**

对上述 9 个文件中的所有旧类名按映射表替换。代表性示例（`CharacterPanel.vue` 第 91 行，含 `text-subtitle-1`）：

```html
        <div class="text-subtitle-1 font-weight-medium mb-2 d-flex align-center">
```

改为：

```html
        <div class="text-body-large font-weight-medium mb-2 d-flex align-center">
```

另一示例（`BatchGenerateDialog.vue` 第 50 行）：

```html
          <div class="text-body-2 mb-2 font-weight-medium">
```

改为：

```html
          <div class="text-body-medium mb-2 font-weight-medium">
```

- [ ] **Step 2: 验证零残留**

```bash
cd frontend
Select-String -Path "src\components\AssetHistoryDialog.vue","src\components\AssetTree.vue","src\components\BatchGenerateDialog.vue","src\components\CharacterPanel.vue","src\components\CharacterPicker.vue","src\components\ConfirmDialog.vue","src\components\CustomAssetPanel.vue","src\components\CustomAssetSection.vue","src\components\GenerateDialog.vue" -Pattern "text-h[1-6]\b|text-subtitle-[12]\b|text-body-[12]\b|text-caption\b|text-overline\b|text-button\b"
```

Expected: 无任何输出（0 匹配）。

- [ ] **Step 3: typecheck + 提交**

```bash
npm run typecheck:frontend
cd ..
git add frontend/src/components/AssetHistoryDialog.vue frontend/src/components/AssetTree.vue frontend/src/components/BatchGenerateDialog.vue frontend/src/components/CharacterPanel.vue frontend/src/components/CharacterPicker.vue frontend/src/components/ConfirmDialog.vue frontend/src/components/CustomAssetPanel.vue frontend/src/components/CustomAssetSection.vue frontend/src/components/GenerateDialog.vue
git commit -m "refactor: 对话框与面板组件排版类迁移到 Vuetify 4 MD3 类名"
```

---

## Task 6: 排版类迁移——ScenePanel

**Files:**
- Modify: `frontend/src/components/ScenePanel.vue`（21 处：`text-h6` ×1、`text-subtitle-1` ×2、`text-body-2` ×8、`text-caption` ×10）

- [ ] **Step 1: 按映射表替换全部旧类名**

该文件是单文件最多处，逐处替换。映射如下：

- 第 38 行 `<v-card-title class="text-h6">` → `<v-card-title class="text-title-large">`
- 第 268、534 行 `text-subtitle-1` → `text-body-large`
- 8 处 `text-body-2`（第 54、62、70、78、128、442、455、598 行）→ `text-body-medium`
- 10 处 `text-caption`（第 51、59、67、75、152、323、358、385、424、452 行）→ `text-body-small`

代表性示例（第 38 行，唯一的 `text-h6`）：

```html
          <v-card-title class="text-h6">
```

改为：

```html
          <v-card-title class="text-title-large">
```

- [ ] **Step 2: 验证零残留**

```bash
cd frontend
Select-String -Path "src\components\ScenePanel.vue" -Pattern "text-h[1-6]\b|text-subtitle-[12]\b|text-body-[12]\b|text-caption\b|text-overline\b|text-button\b"
```

Expected: 无任何输出（0 匹配）。

- [ ] **Step 3: typecheck + 提交**

```bash
npm run typecheck:frontend
cd ..
git add frontend/src/components/ScenePanel.vue
git commit -m "refactor: ScenePanel 排版类迁移到 Vuetify 4 MD3 类名"
```

---

## Task 7: 排版类迁移——主 components（二）

**Files（7 个，均在 `frontend/src/components/` 下）:**
- Modify: `ProjectPanel.vue`（2 处：`text-subtitle-1` ×1、`text-body-2` ×1）
- Modify: `StageFrameDialog.vue`（7 处：`text-body-2` ×3、`text-caption` ×4）
- Modify: `StagePanel.vue`（3 处：`text-subtitle-1` ×2、`text-body-2` ×1）
- Modify: `StagePicker.vue`（3 处：`text-body-2` ×1、`text-caption` ×2）
- Modify: `VariantPanel.vue`（7 处：`text-subtitle-2` ×1、`text-body-2` ×4、`text-caption` ×2）
- Modify: `VariantTreeNode.vue`（3 处：`text-body-2` ×1、`text-caption` ×2）
- Modify: `VariantTreeView.vue`（**特殊情况，见 Step 2**：script 中 JS 选择器 `.text-body-2`）

- [ ] **Step 1: 模板类名迁移**

对前 6 个文件按映射表替换全部旧类名。代表性示例（`VariantPanel.vue` 第 4 行，唯一的 `text-subtitle-2`）：

```html
      <div class="text-subtitle-2">
```

改为：

```html
      <div class="text-title-small">
```

另一示例（`ProjectPanel.vue` 第 66 行）：

```html
          <v-card-title class="text-subtitle-1">
```

改为：

```html
          <v-card-title class="text-body-large">
```

- [ ] **Step 2: 迁移 `VariantTreeView.vue` 的 JS 选择器**

`VariantTreeView.vue` 第 86 行的 `<script>` 中有一个 querySelector 类选择器，必须同步更新（否则运行时找不到元素，连线计算失效）：

```ts
    const titleEl = card.querySelector('.text-body-2') as HTMLElement | null
```

改为：

```ts
    const titleEl = card.querySelector('.text-body-medium') as HTMLElement | null
```

- [ ] **Step 3: 验证零残留**

```bash
cd frontend
Select-String -Path "src\components\ProjectPanel.vue","src\components\StageFrameDialog.vue","src\components\StagePanel.vue","src\components\StagePicker.vue","src\components\VariantPanel.vue","src\components\VariantTreeNode.vue","src\components\VariantTreeView.vue" -Pattern "text-h[1-6]\b|text-subtitle-[12]\b|text-body-[12]\b|text-caption\b|text-overline\b|text-button\b"
```

Expected: 无任何输出（0 匹配）。

- [ ] **Step 4: typecheck + 提交**

```bash
npm run typecheck:frontend
cd ..
git add frontend/src/components/ProjectPanel.vue frontend/src/components/StageFrameDialog.vue frontend/src/components/StagePanel.vue frontend/src/components/StagePicker.vue frontend/src/components/VariantPanel.vue frontend/src/components/VariantTreeNode.vue frontend/src/components/VariantTreeView.vue
git commit -m "refactor: 舞台与变体面板排版类迁移到 Vuetify 4 MD3 类名"
```

---

## Task 8: 排版类迁移——canvas 主体

**Files（2 个）:**
- Modify: `frontend/src/components/canvas/AssetCanvas.vue`（9 处：`text-caption` ×8、`text-body-2` ×1）
- Modify: `frontend/src/components/canvas/CanvasAssertHistoryDialog.vue`（3 处：`text-body-2` ×2、`text-caption` ×1）

- [ ] **Step 1: 按映射表替换全部旧类名**

代表性示例（`AssetCanvas.vue` 第 88 行）：

```html
          class="text-caption text-medium-emphasis"
```

改为：

```html
          class="text-body-small text-medium-emphasis"
```

- [ ] **Step 2: 验证零残留**

```bash
cd frontend
Select-String -Path "src\components\canvas\AssetCanvas.vue","src\components\canvas\CanvasAssertHistoryDialog.vue" -Pattern "text-h[1-6]\b|text-subtitle-[12]\b|text-body-[12]\b|text-caption\b|text-overline\b|text-button\b"
```

Expected: 无任何输出（0 匹配）。

- [ ] **Step 3: typecheck + 提交**

```bash
npm run typecheck:frontend
cd ..
git add frontend/src/components/canvas/AssetCanvas.vue frontend/src/components/canvas/CanvasAssertHistoryDialog.vue
git commit -m "refactor: 资产画布主体排版类迁移到 Vuetify 4 MD3 类名"
```

---

## Task 9: 排版类迁移——canvas editors

**Files（7 个，均在 `frontend/src/components/canvas/editors/` 下）:**
- Modify: `AudioLoaderEditor.vue`（3 处：`text-caption` ×3）
- Modify: `ImageGenerateEditor.vue`（2 处：`text-caption` ×2）
- Modify: `ImageLoaderEditor.vue`（3 处：`text-caption` ×3）
- Modify: `VideoGenerateEditor.vue`（1 处 `text-caption`）
- Modify: `VideoLoaderEditor.vue`（3 处：`text-caption` ×3）
- Modify: `VideoRefInputGroup.vue`（2 处：`text-caption` ×2）

- [ ] **Step 1: 按映射表替换全部旧类名**

全部为 `text-caption` → `text-body-small`。代表性示例（`AudioLoaderEditor.vue` 第 4 行）：

```html
    <div class="text-caption text-medium-emphasis mb-1">
```

改为：

```html
    <div class="text-body-small text-medium-emphasis mb-1">
```

- [ ] **Step 2: 验证零残留**

```bash
cd frontend
Select-String -Path "src\components\canvas\editors\*.vue" -Pattern "text-h[1-6]\b|text-subtitle-[12]\b|text-body-[12]\b|text-caption\b|text-overline\b|text-button\b"
```

Expected: 无任何输出（0 匹配）。

- [ ] **Step 3: typecheck + 提交**

```bash
npm run typecheck:frontend
cd ..
git add frontend/src/components/canvas/editors
git commit -m "refactor: 画布编辑器排版类迁移到 Vuetify 4 MD3 类名"
```

---

## Task 10: 排版类迁移——canvas nodes

**Files（5 个，均在 `frontend/src/components/canvas/nodes/` 下）:**
- Modify: `AudioLoaderNode.vue`（1 处 `text-caption`）
- Modify: `ImageGenerateNode.vue`（3 处：`text-caption` ×3）
- Modify: `ImageLoaderNode.vue`（1 处 `text-caption`）
- Modify: `VideoGenerateNode.vue`（1 处 `text-caption`）
- Modify: `VideoLoaderNode.vue`（1 处 `text-caption`）

- [ ] **Step 1: 按映射表替换全部旧类名**

全部为 `text-caption` → `text-body-small`。代表性示例（`ImageGenerateNode.vue` 第 23 行）：

```html
        <div class="text-caption text-medium-emphasis">
```

改为：

```html
        <div class="text-body-small text-medium-emphasis">
```

- [ ] **Step 2: 验证零残留**

```bash
cd frontend
Select-String -Path "src\components\canvas\nodes\*.vue" -Pattern "text-h[1-6]\b|text-subtitle-[12]\b|text-body-[12]\b|text-caption\b|text-overline\b|text-button\b"
```

Expected: 无任何输出（0 匹配）。

- [ ] **Step 3: typecheck + 提交**

```bash
npm run typecheck:frontend
cd ..
git add frontend/src/components/canvas/nodes
git commit -m "refactor: 画布节点排版类迁移到 Vuetify 4 MD3 类名"
```

---

## Task 11: 排版类迁移——custom-asset / audio-editor / video-director

**Files（5 个）:**
- Modify: `frontend/src/components/custom-asset/CustomAssetGridView.vue`（1 处 `text-caption`）
- Modify: `frontend/src/components/custom-asset/CustomAssetListView.vue`（1 处 `text-body-2`）
- Modify: `frontend/src/components/custom-asset/CustomAssetPreviewDialog.vue`（2 处：`text-body-1` ×1、`text-body-2` ×1）
- Modify: `frontend/src/components/audio-editor/AudioEditor.vue`（1 处 `text-caption`）
- Modify: `frontend/src/components/video-director/VideoDirector.vue`（1 处 `text-caption`）

- [ ] **Step 1: 按映射表替换全部旧类名**

注意 `CustomAssetPreviewDialog.vue` 含唯一的 `text-body-1`（第 80 行）：

```html
            <div class="text-body-1 mb-4 text-center">
```

改为：

```html
            <div class="text-body-large mb-4 text-center">
```

- [ ] **Step 2: 验证零残留**

```bash
cd frontend
Select-String -Path "src\components\custom-asset\*.vue","src\components\audio-editor\AudioEditor.vue","src\components\video-director\VideoDirector.vue" -Pattern "text-h[1-6]\b|text-subtitle-[12]\b|text-body-[12]\b|text-caption\b|text-overline\b|text-button\b"
```

Expected: 无任何输出（0 匹配）。

- [ ] **Step 3: typecheck + 提交**

```bash
npm run typecheck:frontend
cd ..
git add frontend/src/components/custom-asset frontend/src/components/audio-editor/AudioEditor.vue frontend/src/components/video-director/VideoDirector.vue
git commit -m "refactor: 自定义资产与导演台排版类迁移到 Vuetify 4 MD3 类名"
```

---

## Task 12: 网格迁移——`v-row dense`

**Files（5 个）:**
- Modify: `frontend/src/components/asset-picker/CustomAssetsGrid.vue`（第 14 行）
- Modify: `frontend/src/components/asset-picker/ParentVariantGrid.vue`（第 19 行）
- Modify: `frontend/src/components/asset-picker/SceneStagePicker.vue`（第 36 行）
- Modify: `frontend/src/components/BatchGenerateDialog.vue`（第 53 行）
- Modify: `frontend/src/components/ProjectPanel.vue`（第 82 行）

> Vuetify 4 移除了 VRow 的 `dense` prop，官方映射为 `density="compact"`。

- [ ] **Step 1: 替换 5 处 `v-row dense`**

`CustomAssetsGrid.vue`（第 12-15 行）：

```html
    <v-row
      v-if="tabItems.length"
      dense
    >
```

改为：

```html
    <v-row
      v-if="tabItems.length"
      density="compact"
    >
```

`ParentVariantGrid.vue`（第 17-20 行）：

```html
  <v-row
    v-else
    dense
  >
```

改为：

```html
  <v-row
    v-else
    density="compact"
  >
```

`SceneStagePicker.vue`（第 34-37 行）：

```html
    <v-row
      v-else-if="sceneStages.length"
      dense
    >
```

改为：

```html
    <v-row
      v-else-if="sceneStages.length"
      density="compact"
    >
```

`BatchGenerateDialog.vue`（第 53 行）：

```html
          <v-row dense>
```

改为：

```html
          <v-row density="compact">
```

`ProjectPanel.vue`（第 82 行）：

```html
            <v-row dense>
```

改为：

```html
            <v-row density="compact">
```

- [ ] **Step 2: 验证零残留**

```bash
cd frontend
Select-String -Path "src\components\asset-picker\CustomAssetsGrid.vue","src\components\asset-picker\ParentVariantGrid.vue","src\components\asset-picker\SceneStagePicker.vue","src\components\BatchGenerateDialog.vue","src\components\ProjectPanel.vue" -Pattern "<v-row\s+dense|dense\s*>"
```

Expected: 无任何输出（0 匹配）。

- [ ] **Step 3: typecheck + 提交**

```bash
npm run typecheck:frontend
cd ..
git add frontend/src/components/asset-picker/CustomAssetsGrid.vue frontend/src/components/asset-picker/ParentVariantGrid.vue frontend/src/components/asset-picker/SceneStagePicker.vue frontend/src/components/BatchGenerateDialog.vue frontend/src/components/ProjectPanel.vue
git commit -m "refactor: 网格 v-row dense 迁移到 density compact（Vuetify 4）"
```

---

## Task 13: CSS reset 与断点验证

**Files:**
- Verify: `frontend/src/components/MarkdownView.vue`
- Verify: 各使用 `<v-col cols>` 的面板布局

- [ ] **Step 1: 核对 MarkdownView 自足性**

Vuetify 4 移除了全局 CSS reset。`MarkdownView.vue` 已对 h1-h6、p、ul/ol、blockquote、table、code/pre 全部显式定义了 margin/padding/font-size，理论上不依赖全局 reset。核对一遍其 `<style scoped>` 是否覆盖：

- 标题 margin（`margin-top`/`margin-bottom`）✅ 已有
- 段落 `p` margin ✅ 已有
- 列表 `ul/ol` padding-left + margin ✅ 已有
- 表格 `table` margin + `th/td` padding ✅ 已有

若以上均已覆盖，**无需改动**。若发现某个元素依赖 reset 才有的间距，补一条 `:deep()` 规则。

- [ ] **Step 2: 全局旧类名终扫**

```bash
cd frontend
Select-String -Path (Get-ChildItem -Path src -Recurse -Filter *.vue) -Pattern "text-h[1-6]\b|text-subtitle-[12]\b|text-body-[12]\b|text-caption\b|text-overline\b|text-button\b|<v-row\s+dense"
```

Expected: 无任何输出（0 匹配）——所有旧类名与 `dense` 均已迁移。

- [ ] **Step 3: 断点核对（人工）**

Vuetify 4 断点变化：`md 960→840`、`lg 1280→1145`、`xl 1920→1545`。本项目未用 Sass 恢复旧断点（全面拥抱新外观）。核对 `<v-col sm="4">`、`sm="3"`、`md`/`lg` 响应式断点所在的面板（`ProjectPanel.vue`、`CustomAssetsGrid.vue`、`ScenePanel.vue` 等）在窄屏下布局仍合理。此步骤为人工确认，如有明显溢出再行调整。

- [ ] **Step 4: 提交（如有改动）**

若 Step 1-2 无任何改动，跳过提交。若有 MarkdownView 补丁：

```bash
git add frontend/src/components/MarkdownView.vue
git commit -m "fix: 补齐 Vuetify 4 CSS reset 移除后的 markdown 间距"
```

---

## Task 14: 全量回归验证

- [ ] **Step 1: 全量 typecheck**

在仓库根目录：

```bash
npm run typecheck
```

Expected: 退出码 0，无类型错误（服务端 + 前端）。

- [ ] **Step 2: ESLint**

```bash
npm run lint
```

Expected: 退出码 0，无 ESLint 错误。若有报错，修复后重新运行。

- [ ] **Step 3: 前端单元测试**

```bash
cd frontend
npm run test
```

Expected: 全部测试通过（vitest，涉及 `src/canvas/`、`src/utils/`、`src/components/video-director/` 的 15 个测试文件）。

- [ ] **Step 4: 前端构建**

```bash
npm run build
```

Expected: 构建成功，产物输出到 `frontend/dist/`。

- [ ] **Step 5: 提交（如有修复）**

若上述步骤产生任何修复改动：

```bash
git add -A
git commit -m "fix: 升级 Vue/Vuetify 后的回归修复"
```

---

## Task 15: 最终核对与提交

- [ ] **Step 1: 确认工作区状态**

```bash
git status
```

Expected: 工作区干净（无未提交改动），所有迁移已提交。

- [ ] **Step 2: 确认迁移完整性**

```bash
git log --oneline -12
```

Expected: 最近 12 条提交覆盖：依赖升级 + 各排版任务 + 网格任务（+ 可能的回归修复），提交信息含「Vuetify 4」或「MD3」。

- [ ] **Step 3: 记录结果到仓库记忆**

将升级结果（版本号、迁移范围、注意事项）写入仓库记忆 `/memories/repo/ai-video-workstation.md`，供后续会话参考。

---

## 验收标准（对应设计文档）

- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过
- [ ] `cd frontend && npm run test` 全部通过
- [ ] `npm run build` 构建成功
- [ ] 46 个文件的 138 处排版类全部迁移到 MD3 新类名，无残留旧类名
- [ ] 5 处 `v-row dense` 全部迁移到 `density="compact"`
- [ ] `VariantTreeView.vue` 的 JS 选择器 `.text-body-2` 已同步更新
- [ ] `MarkdownView.vue` 样式自足，无依赖全局 reset 的缺失
