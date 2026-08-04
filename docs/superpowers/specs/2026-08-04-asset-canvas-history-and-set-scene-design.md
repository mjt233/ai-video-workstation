# 资产画布 · 历史增强与「设为分镜场景图」按钮收敛 设计

日期：2026-08-04
状态：已批准

## 1. 背景与问题

「资产画布」存在以下两个问题：

1. **「设为分镜场景图」按钮出现在场景画布**：`ImageGenerateEditor.vue` 中该按钮无条件渲染，但它是**分镜画布专属**功能。`AssetCanvas.vue` 的 `openSetAsScene` 虽有 `target.kind !== 'scene'` 守卫（场景画布点了无效果），但按钮仍显示，造成误导。
2. **版本历史对话框功能不足**：当前「版本历史」对话框（`AssetCanvas.vue` 内联实现）只是纯文本列表（`v{n}` + 路径 + 时间），无法**预览图片**，也无法**把某个历史版本激活为当前节点图片**（生成不满意时无法回退到之前的版本）。

## 2. 决策记录（头脑风暴结论）

| 决策点 | 结论 |
|--------|------|
| 需求 1 实现方式 | `ImageGenerateEditor` 新增 `kind` prop，按钮 `v-if="kind === 'scene'"`；`AssetCanvas` 传 `:kind="target.kind"`；`openSetAsScene` 守卫保留（双保险） |
| 需求 2 对话框布局 | **方案 C：左侧大图预览 + 右侧历史列表**（用户选定）；行点击仅更新大图预览，点「设为当前」才激活 |
| 需求 2 组件形态 | 抽独立组件 `AssetHistoryDialog.vue`（`AssetCanvas.vue` 已 1200+ 行，抽组件可复用、可独立测试） |
| 激活语义 | 激活 = 把选中条目写为 `config.current`；`history` 列表**不变**（原当前图本就在历史中，天然满足「激活后原图成为历史版本」） |
| 激活后对话框行为 | **保持打开**并刷新「当前」标记（便于来回切换对比），用户点关闭退出 |
| 当前项展示 | 高亮 + 「当前」徽标，其「设为当前」按钮禁用 |

## 3. 一、分镜画布专属「设为分镜场景图」

### 3.1 `ImageGenerateEditor.vue`

- 新增 prop：`kind: CanvasKind`（从 `../../canvas/types` 导入类型）。
- 「设为分镜场景图」按钮（`emit('set-as-scene', ...)` 那个）加 `v-if="props.kind === 'scene'"`。
- 其余按钮与逻辑不变。

### 3.2 `AssetCanvas.vue`

- 编辑器插槽（`editorPanel` 渲染处）传 `:kind="target.kind"`。
- `openSetAsScene` 的 `if (target.value.kind !== 'scene') return` 守卫**保留**（即使将来有别的入口误触，也不会在场景画布打开对话框）。

> 注：编辑器组件 props 需在 `ImageGenerateEditor` 的 `defineProps` 中声明 `kind: CanvasKind`，并同步在 `AssetCanvas` 模板传值；其他编辑器（`ImageLoaderEditor` 等）不涉及此功能，无需改动。

## 4. 二、版本历史对话框增强

### 4.1 新组件 `frontend/src/components/canvas/AssetHistoryDialog.vue`

**props：**

| prop | 类型 | 说明 |
|------|------|------|
| `modelValue` | `boolean` | 对话框显隐（`v-model` 双向） |
| `project` | `string` | 项目名（构建预览 URL） |
| `node` | `CanvasNodeData \| null` | 生成图片节点数据；null 时渲染空态 |

**emits：**

| emit | 签名 | 说明 |
|------|------|------|
| `update:modelValue` | `(v: boolean)` | 关闭对话框 |
| `activate` | `(entry: HistoryEntry)` | 请求把某历史条目激活为当前图片 |

**布局（方案 C）：**

- 左侧：大图预览区（当前选中条目的大图，`buildPreviewUrl(project, path, version)`；加载失败显示占位图标）。
- 右侧：历史列表（`getHistory(node.config)`），每行：
  - 缩略图（`buildPreviewUrl`，失败显示占位）；
  - `v{n}` 版本号；
  - 生成时间（`toLocaleString('zh-CN')`）；
  - 「设为当前」按钮。
- **当前项**：行高亮 + 「当前」徽标，「设为当前」按钮禁用。
- 交互：
  - 点击某行 → 仅更新左侧大图预览（选中，不激活）；
  - 点击「设为当前」→ `emit('activate', entry)`；组件不自行关闭，由父组件刷新后当前标记自动更新；
  - 组件内 `watch` `node`/显隐：打开或节点变化时重置选中项为当前项。
- 无历史时显示「暂无历史版本」。

### 4.2 `AssetCanvas.vue` 改造

- 将现有内联「版本历史」`v-dialog` 替换为 `<AssetHistoryDialog v-model="historyDialog.show" :project="props.project" :node="historyNode" @activate="onActivateHistory" />`。
- `historyDialog` 状态保持 `{ show: boolean; nodeId: string }`；`historyNode = computed(() => nodeMap[historyDialog.nodeId])`。
- 新增 `onActivateHistory(entry: HistoryEntry)`：

```ts
function onActivateHistory(entry: HistoryEntry) {
  const node = nodeMap.value[historyDialog.nodeId]
  if (!node) return
  store.updateNode(node.id, { config: { ...node.config, current: { version: entry.version, path: entry.path, date: entry.date } } })
}
```

- 激活后**不关闭对话框**；`historyNode` 因 store 更新而响应式刷新，「当前」标记自动移到新当前项。`store.updateNode` 走既有置脏 + 防抖保存（800ms）机制。
- 删除内联 `formatDate`/历史列表模板等不再需要的代码（`formatDate` 移入新组件内部）。

### 4.3 数据语义与副作用

- 激活仅改 `config.current`，`history` 不变 → 「激活后原当前图成为历史版本」天然成立。
- 节点卡片（`ImageGenerateNode.vue`）用 `current.path` + `?t=v{version}` 防缓存，激活后卡片立即显示该版本图。
- 下游节点（作为输入图）读 `current.path`，激活后输入图随之切换；「设为分镜场景图」复制的也是 `current.path`。
- `isUpstreamUpdated` 按 `current.date` 比较：激活旧版本后若输入比它新，会显示「上游已更新」角标（符合预期）。

### 4.4 纯函数（便于单测）

在 `frontend/src/canvas/generate.ts` 增加：

```ts
/** 把历史条目激活为当前（返回新 config；history 不变） */
export function activateHistory(config: NodeConfig, entry: HistoryEntry): NodeConfig {
  return { ...config, current: { version: entry.version, path: entry.path, date: entry.date } }
}
```

`AssetCanvas.onActivateHistory` 调用它，保证核心逻辑可单测。

## 5. 测试与验证

- 单元测试：`frontend/src/canvas/generate.test.ts` 增加 `activateHistory` 用例（返回新 config、原 config 不被修改、history 保留）。
- 修改后必须：`npm run typecheck` + `npm run lint`（AGENTS.md 约束）。
- 浏览器验证（`npm run dev`，共享浏览器页实测）：
  - 场景画布：生成节点编辑器**无**「设为分镜场景图」按钮；分镜画布：按钮仍显示且功能正常；
  - 分镜画布某生成节点「历史」：左侧大图预览、右侧列表含缩略图 + 时间；点行更新大图；点「设为当前」后节点卡片图切换、对话框保持打开且「当前」标记更新；激活后原当前图仍在历史中。

## 6. 涉及文件

| 文件 | 改动 |
|------|------|
| `frontend/src/components/canvas/editors/ImageGenerateEditor.vue` | 新增 `kind` prop；按钮 `v-if` |
| `frontend/src/components/canvas/AssetCanvas.vue` | 传 `:kind`；历史对话框换组件；新增 `onActivateHistory` |
| `frontend/src/components/canvas/AssetHistoryDialog.vue` | **新增**（历史对话框组件） |
| `frontend/src/canvas/generate.ts` | 新增 `activateHistory` 纯函数 |
| `frontend/src/canvas/generate.test.ts` | 新增 `activateHistory` 单测 |
