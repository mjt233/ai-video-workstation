# 衍生变体重命名设计

**日期：** 2026-07-30
**状态：** 设计稿

## 概述

允许用户在编辑衍生变体时修改变体名称（ID），服务端同步重命名文件、更新子变体的 `parentId` 引用，以及分镜场景帧中的引用。

## 引用格式

| 引用位置 | 格式 | 示例 |
|---------|------|------|
| 子变体的 `parentId` | `variantId` | `夜晚` |
| 分镜 `stage.json` 的 `基础场景`（场景变体） | `场景名/子场景标签@variantId` | `商场/白天@夜晚` |
| 分镜 `stage.json` 的 `登场角色`（角色变体） | `角色名@variantId` | `小明@侧身` |

## 服务端

### `server/src/assets/variants.ts` — 新增重命名函数

```typescript
export async function renameCharacterVariant(
  project: string,
  name: string,
  oldId: string,
  newId: string,
): Promise<VariantInfo>

export async function renameStageVariant(
  project: string,
  stage: string,
  baseLabel: string,
  oldId: string,
  newId: string,
): Promise<VariantInfo>
```

执行步骤：
1. 校验新 ID 格式（`assertSafeName`）
2. 检查 `{newId}.json` 是否已存在（避免覆盖）
3. 读取当前 meta，更新 `id` 字段，写入 `{newId}.json`，删除 `{oldId}.json`
4. 如果旧图片存在，重命名 `{oldId}.jpg` → `{newId}.jpg`
5. 如果旧历史目录存在，重命名目录
6. 调用 `replaceVariantRefInChildren` 更新所有子变体的 `parentId`
7. 调用 `replaceVariantRefInFrames` 更新分镜场景帧中的引用
8. 返回新的 `VariantInfo`

### `server/src/assets/refs.ts` — 新增引用查找和替换

```typescript
/** 查找角色变体的分镜引用 */
export async function findCharacterVariantRefs(
  project: string,
  name: string,
  variantId: string,
): Promise<{ episode: string; shot: string; entryIndex: number }[]>

/** 查找场景变体的分镜引用 */
export async function findStageVariantRefs(
  project: string,
  stage: string,
  label: string,
  variantId: string,
): Promise<{ episode: string; shot: string; entryIndex: number }[]>

/** 替换角色变体引用 */
export async function replaceCharacterVariantRefs(
  project: string,
  name: string,
  oldId: string,
  newId: string,
): Promise<void>

/** 替换场景变体引用 */
export async function replaceStageVariantRefs(
  project: string,
  stage: string,
  label: string,
  oldId: string,
  newId: string,
): Promise<void>
```

引用匹配逻辑：
- `基础场景` 中匹配 `场景名/标签@oldId` → 替换为 `场景名/标签@newId`
- `登场角色` 中匹配 `角色名@oldId` → 替换为 `角色名@newId`

### `server/src/assets/variants.ts` — 更新子变体引用

```typescript
import { readMeta, writeMeta, characterMetaRel, stageMetaRel } from './variants.js'

async function replaceVariantRefInChildren(
  project: string,
  kind: 'character' | 'stage',
  owner: string,
  baseLabel: string | undefined,
  oldId: string,
  newId: string,
): Promise<void> {
  // 1. 确定变体目录
  // 2. 列出所有 .json 文件
  // 3. 读取每个 meta，如果 parentId === oldId，更新为 newId 并写回
}
```

### API 路由 — `server/src/routes/assets.ts`

```typescript
// PUT /assets/:project/character/:name/variants/:variantId/rename
assetsRouter.put('/assets/:project/character/:name/variants/:variantId/rename', async (req, res) => {
  const { newId } = req.body as { newId?: string }
  if (!newId) throw Object.assign(new Error('newId 必填'), { code: 'INVALID' })
  const variant = await renameCharacterVariant(project, name, variantId, newId)
  res.json({ success: true, variant })
})

// PUT /assets/:project/stage/:stage/:label/variants/:variantId/rename
// 同上
```

## 前端

### `frontend/src/api/assets.ts` — 新增 API 函数

```typescript
export async function renameCharacterVariant(
  project: string,
  name: string,
  variantId: string,
  newId: string,
): Promise<{ success: boolean; variant: VariantInfo }>

export async function renameStageVariant(
  project: string,
  stage: string,
  label: string,
  variantId: string,
  newId: string,
): Promise<{ success: boolean; variant: VariantInfo }>
```

### `frontend/src/components/VariantPanel.vue` — 编辑表单

在编辑模式下显示 ID 输入框（当前仅创建模式显示）。需要跟踪原始 ID：

```typescript
const formDialog = reactive({
  // ... 现有字段 ...
  originalId: '',  // 编辑模式时记录原始 ID，用于检测是否修改
})
```

`openEdit(v)` 时设置 `formDialog.originalId = v.id`。

`submitForm` 中检测 ID 变化：
```typescript
if (formDialog.mode === 'edit' && formDialog.id !== formDialog.originalId) {
  // ID 已修改，调用 rename API
  // 先更新 desc/parentId/refs（原有 PUT），然后 rename
} else {
  // 原有 update API
}
```

注意：如果同时修改了 ID 和其他字段，应先调用 update（修改 desc/refs/parentId），再调用 rename（改文件名和引用）。或者将 rename 合并到 update 逻辑中——rename 端点只处理文件名变更和引用替换，不关心 desc/refs 等字段。

## 不变的范围

- 无需修改工作流引擎
- 无需修改 GenerateDialog
- 无需修改 AssetPickerDialog
- 无需修改变体树显示逻辑
