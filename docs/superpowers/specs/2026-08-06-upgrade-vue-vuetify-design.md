# 设计文档：升级 Vue 与 Vuetify 到最新版本

> 日期：2026-08-06
> 状态：已批准（用户确认「对的」）

## 1. 背景与目标

当前前端依赖版本较旧，需要升级到最新稳定版：

| 依赖 | 当前版本 | 目标版本 | 说明 |
|---|---|---|---|
| `vue` | 3.5.40 | ^3.5.41 | 小版本，几乎无风险 |
| `vuetify` | 3.12.11 | ^4.1.7 | 大版本，存在破坏性变更 |

**范围约束（用户已确认）：**

- 仅升级 `vue` 与 `vuetify`，**不动工具链**：`vite@6`、`@vitejs/plugin-vue@5`、`vue-tsc@3.3`、`typescript@5.7` 全部保持现状
- 服务端零改动
- **全面拥抱 Vuetify 4（MD3）新外观**，不做 v3 兼容还原（不恢复旧断点、旧网格、旧排版）
- 验证方式：仅自动化验证（`typecheck` / `lint` / 单测 / `build`），UI 视觉变化由用户自行确认

## 2. 影响面扫描结果（升级前基线）

- **排版类**：46 个文件 / 138 处 `text-h5`、`text-h6`、`text-subtitle-1/2`、`text-body-1/2`、`text-caption` —— v4 已移除旧类名，必须迁移（否则文字失去字号样式）
- **网格**：10 个文件 / 29 处 `<v-row>`/`<v-col>`；其中 5 处 `v-row dense`（v4 移除 `dense` prop）
- **CSS reset**：v4 移除全局 reset，需补齐，重点关注 `MarkdownView.vue`
- **组件级破坏点**（已确认不涉及）：无 `#item` slot、无 `multi-line`、无 `v-form` slot refs 用法
- **已兼容**：全项目统一使用 `density="compact"`（v4 兼容）、无 Sass 定制、无 `vite-plugin-vuetify` 依赖

## 3. 迁移步骤

### 步骤 1：依赖升级

`frontend/package.json` 中修改：

```json
"vue": "^3.5.41",
"vuetify": "^4.1.7"
```

执行 `npm install`，然后立即运行 `npm run typecheck`，以类型错误作为破坏点索引清单。

### 步骤 2：插件配置核对

`frontend/src/plugins/vuetify.ts`：

- 样式入口 `import 'vuetify/styles'` 在 v4 仍是标准全部导入入口，**无需改动**
- `defaultTheme: 'light'` 需**显式保留**（v4 默认改为 `system`，不显式设置会跟随系统暗色模式）
- 主题色、MDI 图标集（`@mdi/font`）保持不变

### 步骤 3：排版类迁移（必需）

按保守映射表替换所有旧类名（多数字号完全一致，视觉变化极小）：

| 旧类名 | 新类名 | 字号差异 |
|---|---|---|
| `text-h5` | `text-headline-small` | 24px 完全一致 |
| `text-h6` | `text-title-large` | 20→22px 微差 |
| `text-subtitle-1` | `text-body-large` | 16px 完全一致 |
| `text-subtitle-2` | `text-title-small` | 14px 完全一致 |
| `text-body-1` | `text-body-large` | 16px 完全一致 |
| `text-body-2` | `text-body-medium` | 14px 完全一致 |
| `text-caption` | `text-body-small` | 12px 完全一致 |

> 说明：`text-h5` 项目里用于页面标题（`ProjectSelectPage.vue` 的 `text-h5`），映射到 `text-headline-small` 完全一致；`text-h6` 映射后 20→22px，属可接受的 MD3 新外观。

### 步骤 4：网格迁移

5 处 `v-row dense` 替换为 `density="compact"`：

- `components/asset-picker/CustomAssetsGrid.vue`
- `components/asset-picker/ParentVariantGrid.vue`
- `components/asset-picker/SceneStagePicker.vue`
- `components/BatchGenerateDialog.vue`
- `components/ProjectPanel.vue`

替换后核对新 CSS gap 机制下的 `cols` 布局表现（v4 网格改为 `display: grid` + gap，不再使用负 margin 与 padding）。

### 步骤 5：CSS reset 补齐

v4 移除了全局 `* { padding: 0; margin: 0; }`。需要：

- **重点检查 `MarkdownView.vue`**：markdown 渲染的 h1-h6、p、ul、ol、table 等依赖 reset 的样式，按需补齐（`@layer vuetify-core.reset` 兼容片段）
- 其他组件如有因 reset 移除而出现的间距/边框异常，按官方兼容片段逐处补齐

### 步骤 6：组件与断点核对

- 已扫描确认无 `#item` / `multi-line` / `v-form` slot refs 用法，无需迁移
- 断点变化（md 960→840、lg 1280→1145）在步骤 4 后核对各面板布局是否有溢出

### 步骤 7：回归验证

依次执行并全部通过：

1. `npm run typecheck`（根目录，服务端 + 前端）
2. `npm run lint`
3. `cd frontend && npm run test`（vitest）
4. `npm run build`

### 步骤 8：提交

独立中文 commit（如 `chore: 升级 Vue 3.5.41 与 Vuetify 4.1.7`），保证可一键 `git revert` 回滚。

## 4. 风险与回滚

| 风险 | 缓解措施 |
|---|---|
| 排版/断点/网格外观变化 | 已约定由用户目视确认（不在本次自动验证范围内） |
| CSS reset 移除的隐性影响 | 步骤 5 主动补齐，重点覆盖 `MarkdownView.vue` |
| Vuetify 4 未知 bug | 独立 commit，`git revert` 可完整还原 |

## 5. 验收标准

- [ ] `npm run typecheck` 通过（无类型错误）
- [ ] `npm run lint` 通过（无 ESLint 错误）
- [ ] `cd frontend && npm run test` 全部通过
- [ ] `npm run build` 构建成功
- [ ] 排版类全部迁移到 MD3 新类名，无残留旧类名
- [ ] 5 处 `v-row dense` 全部迁移
