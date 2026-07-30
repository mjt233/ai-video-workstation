# 衍生变体树形结构与通用资产选择器设计

**日期：** 2026-07-30
**状态：** 设计稿

## 概述

为衍生变体（Variant）功能引入层级关系和额外引用资产支持，将平铺展示改为树形结构（卡片+连线风格），并提供通用资产选择器组件以支持从多类资产中选取引用图片。

## 数据模型

### VariantMeta 扩展

```typescript
interface VariantMeta {
  id: string
  desc: string
  /** 父变体 ID，可选。顶级变体无此字段。创建后可修改。 */
  parentId?: string
  /** 额外引用资产路径数组，保持用户选择的顺序 */
  refs: string[]
  createdAt?: string
  updatedAt?: string
}
```

- `baseImage` 不再手动存储，由服务端在读取时自动推导：`parentId` 存在时取父变体的 `imagePath`，否则取默认外观图（角色 `assert/character/{name}/appearance.jpg`，场景 `assert/stage/{name}/{label}.jpg`）。
- `refs` 中的路径为相对于 `design/{project}/` 的路径。

### VariantInfo 接口

```typescript
interface VariantInfo extends VariantMeta {
  kind: 'character' | 'stage'
  owner: string
  baseLabel?: string
  metaPath: string
  imagePath: string
  hasImage: boolean
  ref: string
  /** 客户端构建树后填充 */
  children?: VariantInfo[]
}
```

### API 变更

**POST /assets/:project/character/:name/variants**
请求体新增可选字段：
```typescript
{
  id: string
  desc: string
  parentId?: string   // 父变体 ID
  refs?: string[]     // 引用资产路径
}
```

**PUT /assets/:project/character/:name/variants/:variantId**
请求体新增可选字段：
```typescript
{
  desc?: string
  parentId?: string   // 允许修改父变体
  refs?: string[]     // 引用资产路径
}
```

场景衍生的 API 变更同上（路径为 `/assets/:project/stage/:stage/:label/variants/...`）。

**GET 列表** — 返回的每个 `VariantInfo` 携带 `parentId` 和 `refs` 字段。

### 删除逻辑

删除变体时，弹窗让用户选择：
- **级联删除**：递归删除该变体及其所有子变体的 meta 和图片资产
- **提升子变体**：将该变体的所有子变体 `parentId` 置空，变为顶级变体

### 服务端校验

1. 创建/设置 `parentId` 时，校验父变体存在且属于同一 kind/owner
2. 禁止将 `parentId` 设置为自身或形成循环引用（如 A→B→A）
3. `refs` 中的路径必须指向 `assert/` 目录下且文件存在

---

## 通用资产选择器（AssetPickerDialog）

### 组件定位

独立、可复用的弹窗组件，用于选择引用图片资产。

### Props / Emits

```typescript
interface AssetPickerDialogProps {
  modelValue: boolean
  project: string
  kind: 'character' | 'stage'
  owner: string
  baseLabel?: string
  selected: string[]          // 当前已选的资产路径数组
  exclude?: string[]          // 需排除的路径
}

// Emits:
// update:modelValue
// update:selected  — 返回排序后的资产路径数组
```

### 资产分类

弹窗内以 Tab 分组展示可选资产，每类数据由前端通过现有 API 逐类获取：

| Tab | 数据来源 | 获取方式 |
|-----|---------|---------|
| 角色外观 | 所有角色的外观图 | 通过 `GET /api/fs/:project/prompt/character/` 列出角色目录，每个角色构造 `assert/character/{name}/appearance.jpg` |
| 角色变体 | 所有角色的衍生变体图 | 列出角色后，逐个调用 `GET /assets/:project/character/{name}/variants` |
| 场景设定 | 所有场景的子场景图 | 通过 `GET /api/fs/:project/prompt/stage/` 列出场景目录，读取每个场景的子场景 `.md` 文件确定标签 |
| 场景变体 | 所有场景的衍生变体图 | 列出场景及子场景后，逐个调用 `GET /assets/:project/stage/{stage}/{label}/variants` |
| 自定义资产 | `assert/custom/` 下图片 | `GET /api/fs/:project/assert/custom/` 递归列出所有图片 |

### UI 布局

```
┌──────────────────────────────────────────────────┐
│ 选择引用资产                              ✕      │
├──────────────────────────────────────────────────┤
│ [角色外观] [角色变体] [场景设定] [场景变体] [自定义] │
│                                                  │
│ ┌───┐ ┌───┐ ┌───┐ ┌───┐                        │
│ │img│ │img│ │img│ │img│  缩略图网格              │
│ │ 名│ │ 名│ │ 名│ │ 名│  已选带 ✓ 标记           │
│ └───┘ └───┘ └───┘ └───┘                        │
│                                                  │
├──────────────────────────────────────────────────┤
│ 已选资产（按序）：                                 │
│ ┌──┐ ┌──┐ ┌──┐                                  │
│ │ 1│→│ 2│→│ 3│  拖拽排序 / 上下箭头 / ✕ 移除    │
│ └──┘ └──┘ └──┘                                  │
├──────────────────────────────────────────────────┤
│                        [取消]      [确认]         │
└──────────────────────────────────────────────────┘
```

### 排序交互

- 拖拽排序：使用 HTML5 Drag API 或轻量级排序库
- 上下箭头按钮：选中后点击箭头移动
- 移除按钮：从已选列表移除

---

## 树形渲染（卡片节点 + 连线）

### 数据流

1. 服务端返回平铺的 `VariantInfo[]`，每条携带 `parentId`
2. 前端 `useVariantTree` composable 将平铺列表构建为嵌套树结构
3. 树结构用于递归渲染

### 组件树

```
VariantPanel.vue
  └─ VariantTreeView.vue          ← 树的容器，负责 SVG 连线层
       └─ VariantTreeNode.vue     ← 递归组件
            ├─ 卡片内容
            │   ├─ 图片（或占位符）
            │   ├─ 名称 + 状态 chip
            │   └─ 描述
            ├─ 操作按钮悬浮层
            │   ├─ 放大查看
            │   ├─ 生成图片
            │   ├─ 上传图片
            │   ├─ 历史版本
            │   ├─ 编辑描述
            │   └─ 删除
            └─ 子变体列表（递归 VariantTreeNode）
                 └─ SVG 连线到子卡片
```

### 布局算法

- **从上到下垂直布局**，按层级排列
- 每层内的节点水平居中
- 使用绝对定位的 SVG 覆盖层绘制父子连线
- 连线为贝塞尔曲线：父卡片底部中点 → 子卡片顶部中点

```html
<div style="position: relative">
  <svg style="position: absolute; inset: 0; pointer-events: none">
    <path v-for="edge in edges" :d="edge.path"
          stroke="#888" fill="none" stroke-width="1.5" />
  </svg>
  <VariantTreeNode v-for="node in roots" :node="node" />
</div>
```

### 交互

- 默认展开所有层级
- 卡片点击放大预览（已有逻辑）
- 操作按钮悬浮显示（已有逻辑）

---

## 工作流集成

### 图片数组构建

生成时 `imagePaths` 的构建规则：

```
[父变体图像(如果有) ?? 默认基础图, ...refs(按用户排序)]
```

```typescript
/** 获取变体的默认基础图路径（无父变体时的回退） */
function getDefaultBaseImage(v: VariantInfo): string {
  if (v.kind === 'character') {
    return `assert/character/${v.owner}/appearance.jpg`
  }
  // stage
  return `assert/stage/${v.owner}/${v.baseLabel}.jpg`
}

/**
 * @param v 当前变体
 * @param variantMap 由 useVariantTree composable 维护的扁平 ID→VariantInfo 映射表
 */
function buildImagePaths(v: VariantInfo, variantMap: Map<string, VariantInfo>): string[] {
  const paths: string[] = []

  // 1. 父变体图像
  if (v.parentId) {
    const parent = variantMap.get(v.parentId)
    if (parent?.hasImage) {
      paths.push(parent.imagePath)
    } else {
      paths.push(getDefaultBaseImage(v))
    }
  } else {
    paths.push(getDefaultBaseImage(v))
  }

  // 2. 额外引用资产（按用户选择顺序）
  paths.push(...v.refs)

  return paths
}
```

### 生成对话框传参

`openGenerate` 方法传递以下变量给工作流：

```typescript
genDialog.vars = {
  desc: v.desc,
  imagePaths: JSON.stringify(buildImagePaths(v, allVariants)),
  purpose: 'variant-edit',
  variantKind: props.kind,
  variantOwner: props.owner,
  variantId: v.id,
  parentId: v.parentId ?? '',
  ...(props.kind === 'stage' && props.baseLabel ? { baseLabel: props.baseLabel } : {}),
}
```

---

## 文件变更清单

### 新增文件
- `frontend/src/components/AssetPickerDialog.vue` — 通用资产选择器弹窗
- `frontend/src/components/VariantTreeView.vue` — 树形视图容器
- `frontend/src/components/VariantTreeNode.vue` — 递归树节点卡片
- `frontend/src/composables/useVariantTree.ts` — 树构建 composable

### 修改文件
- `frontend/src/components/VariantPanel.vue` — 改用树形渲染、新增父变体和 refs 支持
- `frontend/src/api/assets.ts` — API 函数新增 `parentId`/`refs` 参数
- `server/src/assets/variants.ts` — 数据模型、CRUD 逻辑变更
- `server/src/routes/assets.ts` — 路由参数变更

---

## 不涉及的范围

- 工作流引擎本身不需要修改，仅前端传参方式变化
- 无需新增数据库表（文件系统即数据库）
- 无需修改其他资产面板（CharacterPanel、StagePanel 仅调整 VariantPanel 的 props 传递方式）
