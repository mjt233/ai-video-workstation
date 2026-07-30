# 衍生变体树形结构与通用资产选择器 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为衍生变体功能引入层级关系（父变体）、额外引用资产选择、树形视图（卡片+SVG连线），以及通用资产选择器组件。

**Architecture:** 服务端在 VariantMeta 中新增 `parentId` 和 `refs` 字段，CRUD 增加对应校验；前端新增 `AssetPickerDialog`（通用资产选择弹窗）、`VariantTreeView`/`VariantTreeNode`（树形渲染）、`useVariantTree` composable，并重写 `VariantPanel` 集成树形视图。

**Tech Stack:** Express + TypeScript (server), Vue 3 + Vuetify 3 + TypeScript (frontend)

---

### Task 1: 服务端 — 更新 VariantMeta 接口与 CRUD 逻辑

**Files:**
- Modify: `server/src/assets/variants.ts` (全文)

- [ ] **Step 1: 更新 VariantMeta 和 VariantInfo 接口**

```typescript
// 替换 server/src/assets/variants.ts 中 VariantMeta 接口
export interface VariantMeta {
  id: string;
  desc: string;
  /** 父变体 ID，可选。顶级变体无此字段。 */
  parentId?: string;
  /** 额外引用资产路径数组，保持用户选择的顺序 */
  refs: string[];
  createdAt?: string;
  updatedAt?: string;
}
```

```typescript
// 替换 VariantInfo 接口
export interface VariantInfo extends VariantMeta {
  kind: VariantKind;
  /** 角色名 或 场景名 */
  owner: string;
  /** 场景基础标签（仅 stage） */
  baseLabel?: string;
  /** prompt meta 相对路径 */
  metaPath: string;
  /** assert 图片相对路径 */
  imagePath: string;
  /** 是否已有生成图 */
  hasImage: boolean;
  /** 选择器引用字符串 */
  ref: string;
}
```

- [ ] **Step 2: 更新 readMeta 函数以兼容旧数据（无 parentId/refs 时提供默认值）**

```typescript
// 替换 readMeta 函数
async function readMeta(project: string, metaRel: string): Promise<VariantMeta | null> {
  try {
    const full = resolveProjectPath(project, metaRel);
    const raw = await fs.readFile(full, 'utf-8');
    const data = JSON.parse(raw) as Partial<VariantMeta>;
    if (!data || typeof data !== 'object') return null;
    const id = String(data.id ?? path.basename(metaRel, '.json')).trim();
    const desc = String(data.desc ?? '').trim();
    return {
      id,
      desc,
      parentId: data.parentId ? String(data.parentId) : undefined,
      refs: Array.isArray(data.refs) ? data.refs.map(String) : [],
      baseImage: data.baseImage ? String(data.baseImage) : undefined,
      createdAt: data.createdAt ? String(data.createdAt) : undefined,
      updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: 添加辅助函数 — 检查循环引用和获取子变体列表**

```typescript
// 在 readMeta 之后添加
/** 检查 parentId 是否会导致循环引用 */
async function checkCircularParent(
  project: string,
  metaRel: string,
  parentId: string,
): Promise<boolean> {
  let current = parentId;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current)) return true; // 循环
    visited.add(current);
    // 读 meta 提取 parentId（基于 metaRel 所在的目录结构推算同级其他 meta 路径）
    // 由于我们不知道当前 variant 的 kind/owner，我们用通用方式——从 metaRel 推导同级目录
    const dir = path.dirname(resolveProjectPath(project, metaRel));
    const file = path.join(dir, `${current}.json`);
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const data = JSON.parse(raw) as Partial<VariantMeta>;
      current = data.parentId ? String(data.parentId) : '';
    } catch {
      break;
    }
  }
  return false;
}

/** 收集某个变体的所有子变体 ID（递归），用于级联删除 */
async function collectChildIds(
  project: string,
  metaRel: string,
  variantId: string,
): Promise<string[]> {
  const dir = path.dirname(resolveProjectPath(project, metaRel));
  const result: string[] = [];
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter(f => f.endsWith('.json'));
  } catch {
    return result;
  }
  for (const f of files) {
    const id = f.slice(0, -'.json'.length);
    try {
      const raw = await fs.readFile(path.join(dir, f), 'utf-8');
      const data = JSON.parse(raw) as Partial<VariantMeta>;
      if (data.parentId === variantId) {
        result.push(id);
        const childIds = await collectChildIds(project, metaRel, id);
        result.push(...childIds);
      }
    } catch {
      continue;
    }
  }
  return result;
}
```

- [ ] **Step 4: 更新 createCharacterVariant 支持 parentId 和 refs**

```typescript
// 替换 createCharacterVariant 函数
export async function createCharacterVariant(
  project: string,
  name: string,
  body: { id: string; desc: string; parentId?: string; refs?: string[] },
): Promise<VariantInfo> {
  assertSafeName(name, '角色名');
  const id = (body.id ?? '').trim();
  assertSafeName(id, '变体名称');
  const desc = (body.desc ?? '').trim();
  if (!desc) {
    throw Object.assign(new Error('衍生描述必填'), { code: 'INVALID' });
  }
  const charDir = resolveProjectPath(project, `prompt/character/${name}`);
  if (!(await pathExists(charDir))) {
    throw Object.assign(new Error('角色不存在'), { code: 'NOT_FOUND' });
  }
  const metaPath = characterMetaRel(name, id);
  if (await pathExists(resolveProjectPath(project, metaPath))) {
    throw Object.assign(new Error('衍生变体已存在'), { code: 'EXISTS' });
  }

  // 校验 parentId
  const refs: string[] = Array.isArray(body.refs) ? body.refs : [];
  if (body.parentId) {
    const parentMetaPath = characterMetaRel(name, body.parentId);
    if (!(await pathExists(resolveProjectPath(project, parentMetaPath)))) {
      throw Object.assign(new Error('父变体不存在'), { code: 'NOT_FOUND' });
    }
    if (body.parentId === id) {
      throw Object.assign(new Error('不能将自身设为父变体'), { code: 'INVALID' });
    }
    const circular = await checkCircularParent(project, metaPath, body.parentId);
    if (circular) {
      throw Object.assign(new Error('不允许循环引用'), { code: 'INVALID' });
    }
  }

  // 校验 refs 路径合法性
  for (const r of refs) {
    if (!r.startsWith('assert/')) {
      throw Object.assign(new Error(`引用资产路径必须以 assert/ 开头: ${r}`), { code: 'INVALID' });
    }
  }

  const now = new Date().toISOString();
  const baseImage = body.parentId
    ? characterImageRel(name, body.parentId)
    : `assert/character/${name}/appearance.jpg`;
  const meta: VariantMeta = {
    id,
    desc,
    parentId: body.parentId || undefined,
    refs,
    baseImage,
    createdAt: now,
    updatedAt: now,
  };
  await writeMeta(project, metaPath, meta);
  const imagePath = characterImageRel(name, id);
  return {
    ...meta,
    kind: 'character',
    owner: name,
    metaPath,
    imagePath,
    hasImage: false,
    ref: `${name}@${id}`,
  };
}
```

- [ ] **Step 5: 更新 createStageVariant 支持 parentId 和 refs（类似 Step 4，路径不同）**

`server/src/assets/variants.ts` 中 `createStageVariant` 函数，同样添加 `parentId` 和 `refs` 支持，校验逻辑同角色变体。关键差异：
- 父变体 meta 路径使用 `stageMetaRel(stage, baseLabel, parentId)`
- 默认 baseImage 为 `assert/stage/${stage}/${baseLabel}.jpg`
- 校验时检查 `prompt/stage/${stage}/${baseLabel}.md` 是否存在

- [ ] **Step 6: 更新 updateCharacterVariant 支持 parentId 和 refs**

```typescript
// 替换 updateCharacterVariant 函数
export async function updateCharacterVariant(
  project: string,
  name: string,
  variantId: string,
  body: { desc?: string; parentId?: string; refs?: string[] },
): Promise<VariantInfo> {
  assertSafeName(name, '角色名');
  assertSafeName(variantId, '变体名称');
  const metaPath = characterMetaRel(name, variantId);
  const existing = await readMeta(project, metaPath);
  if (!existing) {
    throw Object.assign(new Error('衍生变体不存在'), { code: 'NOT_FOUND' });
  }

  if (body.desc !== undefined) {
    const desc = body.desc.trim();
    if (!desc) throw Object.assign(new Error('衍生描述不能为空'), { code: 'INVALID' });
    existing.desc = desc;
  }

  // 更新 parentId
  if (body.parentId !== undefined) {
    if (body.parentId) {
      const parentMetaPath = characterMetaRel(name, body.parentId);
      if (!(await pathExists(resolveProjectPath(project, parentMetaPath)))) {
        throw Object.assign(new Error('父变体不存在'), { code: 'NOT_FOUND' });
      }
      if (body.parentId === variantId) {
        throw Object.assign(new Error('不能将自身设为父变体'), { code: 'INVALID' });
      }
      const circular = await checkCircularParent(project, metaPath, body.parentId);
      if (circular) {
        throw Object.assign(new Error('不允许循环引用'), { code: 'INVALID' });
      }
    }
    existing.parentId = body.parentId || undefined;
    // 重新推导 baseImage
    existing.baseImage = body.parentId
      ? characterImageRel(name, body.parentId)
      : `assert/character/${name}/appearance.jpg`;
  }

  // 更新 refs
  if (body.refs !== undefined) {
    for (const r of body.refs) {
      if (!r.startsWith('assert/')) {
        throw Object.assign(new Error(`引用资产路径必须以 assert/ 开头: ${r}`), { code: 'INVALID' });
      }
    }
    existing.refs = body.refs;
  }

  existing.updatedAt = new Date().toISOString();
  await writeMeta(project, metaPath, existing);
  const imagePath = characterImageRel(name, variantId);
  const hasImage = await pathExists(resolveProjectPath(project, imagePath));
  return {
    ...existing,
    kind: 'character',
    owner: name,
    metaPath,
    imagePath,
    hasImage,
    ref: `${name}@${variantId}`,
  };
}
```

- [ ] **Step 7: 更新 updateStageVariant 支持 parentId 和 refs（类似 Step 6）**

`server/src/assets/variants.ts` 中 `updateStageVariant` 函数，同样添加 `parentId` 和 `refs` 支持。

- [ ] **Step 8: 更新 deleteCharacterVariant 和 deleteStageVariant 支持级联/提升选择**

```typescript
// 替换 deleteCharacterVariant
export async function deleteCharacterVariant(
  project: string,
  name: string,
  variantId: string,
  options?: { cascade?: boolean },
): Promise<void> {
  assertSafeName(name, '角色名');
  assertSafeName(variantId, '变体名称');
  const metaPath = characterMetaRel(name, variantId);
  const metaFull = resolveProjectPath(project, metaPath);
  if (!(await pathExists(metaFull))) {
    throw Object.assign(new Error('衍生变体不存在'), { code: 'NOT_FOUND' });
  }

  // 收集子变体
  const childIds = await collectChildIds(project, metaPath, variantId);

  if (options?.cascade) {
    // 级联删除所有子变体
    for (const cid of childIds) {
      const cMetaPath = characterMetaRel(name, cid);
      const cMetaFull = resolveProjectPath(project, cMetaPath);
      if (await pathExists(cMetaFull)) await fs.unlink(cMetaFull);
      const cImagePath = characterImageRel(name, cid);
      const cImageFull = resolveProjectPath(project, cImagePath);
      if (await pathExists(cImageFull)) await fs.unlink(cImageFull);
      const cHistDir = resolveProjectPath(project, `assert/character/${name}/variants/history/${cid}`);
      if (await pathExists(cHistDir)) await fs.rm(cHistDir, { recursive: true, force: true });
    }
  } else {
    // 提升子变体：parentId 置空
    for (const cid of childIds) {
      const cMetaPath = characterMetaRel(name, cid);
      const cMeta = await readMeta(project, cMetaPath);
      if (cMeta) {
        cMeta.parentId = undefined;
        cMeta.baseImage = `assert/character/${name}/appearance.jpg`;
        cMeta.updatedAt = new Date().toISOString();
        await writeMeta(project, cMetaPath, cMeta);
      }
    }
  }

  await fs.unlink(metaFull);
  const imagePath = characterImageRel(name, variantId);
  const imageFull = resolveProjectPath(project, imagePath);
  if (await pathExists(imageFull)) await fs.unlink(imageFull);
  const histDir = resolveProjectPath(project, `assert/character/${name}/variants/history/${variantId}`);
  if (await pathExists(histDir)) await fs.rm(histDir, { recursive: true, force: true });
}
```

`deleteStageVariant` 同样更新，参数新增 `options?: { cascade?: boolean }`。

- [ ] **Step 9: 运行类型检查确认服务端编译通过**

```bash
cd server && npx tsc --noEmit
```
预期：无类型错误。

- [ ] **Step 10: Git 提交**

```bash
git add server/src/assets/variants.ts
git commit -m "feat(variant): 支持 parentId、refs 字段及级联删除"
```

---

### Task 2: 服务端 — 更新 API 路由

**Files:**
- Modify: `server/src/routes/assets.ts`

- [ ] **Step 1: 更新 POST 角色变体路由 — 接收 parentId 和 refs**

`server/src/routes/assets.ts` 中 `/assets/:project/character/:name/variants` POST 路由，修改 body 解析：

```typescript
// 替换路由内的解析逻辑
const body = req.body as { id?: string; desc?: string; parentId?: string; refs?: string[] };
if (!body.id || !body.desc) {
  throw Object.assign(new Error('id 与 desc 必填'), { code: 'INVALID' });
}
const variant = await createCharacterVariant(project, name, {
  id: body.id,
  desc: body.desc,
  parentId: body.parentId,
  refs: body.refs,
});
```

- [ ] **Step 2: 更新 PUT 角色变体路由 — 接收 parentId 和 refs**

```typescript
// 替换路由内的解析逻辑
const body = req.body as { desc?: string; parentId?: string; refs?: string[] };
const variant = await updateCharacterVariant(project, name, variantId, {
  desc: body.desc,
  parentId: body.parentId,
  refs: body.refs,
});
```

- [ ] **Step 3: 更新 POST 场景变体路由 — 接收 parentId 和 refs**

`/assets/:project/stage/:stage/:label/variants` POST 路由，类似 Step 1。

- [ ] **Step 4: 更新 PUT 场景变体路由 — 接收 parentId 和 refs**

`/assets/:project/stage/:stage/:label/variants/:variantId` PUT 路由，类似 Step 2。

- [ ] **Step 5: 更新 DELETE 变体路由 — 支持 cascade 参数**

```typescript
// 替换 DELETE 角色变体路由
assetsRouter.delete('/assets/:project/character/:name/variants/:variantId', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const name = req.params.name as string;
    const variantId = req.params.variantId as string;
    const cascade = req.query.cascade === 'true';
    await deleteCharacterVariant(project, name, variantId, { cascade });
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});
```

同样的方式更新 DELETE 场景变体路由。

- [ ] **Step 6: 运行类型检查**

```bash
cd server && npx tsc --noEmit
```
预期：无类型错误。

- [ ] **Step 7: Git 提交**

```bash
git add server/src/routes/assets.ts
git commit -m "feat(variant): API 路由支持 parentId、refs 和 cascade 参数"
```

---

### Task 3: 前端 — 更新 API 客户端类型和函数

**Files:**
- Modify: `frontend/src/api/assets.ts`

- [ ] **Step 1: 更新 VariantInfo 接口添加新字段**

```typescript
// 替换 VariantInfo 接口
export interface VariantInfo {
  id: string
  desc: string
  parentId?: string
  refs: string[]
  baseImage?: string
  createdAt?: string
  updatedAt?: string
  kind: 'character' | 'stage'
  owner: string
  baseLabel?: string
  metaPath: string
  imagePath: string
  hasImage: boolean
  ref: string
}
```

- [ ] **Step 2: 更新 createCharacterVariant 函数签名**

```typescript
// 替换 createCharacterVariant
export async function createCharacterVariant(
  project: string,
  name: string,
  body: { id: string; desc: string; parentId?: string; refs?: string[] },
) {
  try {
    const { data } = await client.post(
      `/assets/${project}/character/${encodeURIComponent(name)}/variants`,
      body,
    )
    return data as { success: boolean; variant: VariantInfo }
  } catch (e) { rethrow(e) }
}
```

- [ ] **Step 3: 更新 updateCharacterVariant 函数签名**

```typescript
// 替换 updateCharacterVariant
export async function updateCharacterVariant(
  project: string,
  name: string,
  variantId: string,
  body: { desc?: string; parentId?: string; refs?: string[] },
) {
  try {
    const { data } = await client.put(
      `/assets/${project}/character/${encodeURIComponent(name)}/variants/${encodeURIComponent(variantId)}`,
      body,
    )
    return data as { success: boolean; variant: VariantInfo }
  } catch (e) { rethrow(e) }
}
```

- [ ] **Step 4: 更新 createStageVariant 函数签名**

同 Step 2 模式。

- [ ] **Step 5: 更新 updateStageVariant 函数签名**

同 Step 3 模式。

- [ ] **Step 6: 新增 deleteCharacterVariantWithCascade / deleteStageVariantWithCascade（或在现有函数加 cascade 参数）**

```typescript
// 替换 deleteCharacterVariant
export async function deleteCharacterVariant(
  project: string,
  name: string,
  variantId: string,
  cascade?: boolean,
) {
  try {
    const params = cascade ? '?cascade=true' : ''
    const { data } = await client.delete(
      `/assets/${project}/character/${encodeURIComponent(name)}/variants/${encodeURIComponent(variantId)}${params}`,
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

// 替换 deleteStageVariant
export async function deleteStageVariant(
  project: string,
  stage: string,
  label: string,
  variantId: string,
  cascade?: boolean,
) {
  try {
    const params = cascade ? '?cascade=true' : ''
    const { data } = await client.delete(
      `/assets/${project}/stage/${encodeURIComponent(stage)}/${encodeURIComponent(label)}/variants/${encodeURIComponent(variantId)}${params}`,
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}
```

- [ ] **Step 7: 运行类型检查**

```bash
cd frontend && npx vue-tsc --noEmit
```
预期：无类型错误。

- [ ] **Step 8: Git 提交**

```bash
git add frontend/src/api/assets.ts
git commit -m "feat(variant): 前端 API 客户端支持 parentId、refs"
```

---

### Task 4: 前端 — 创建 useVariantTree composable

**Files:**
- Create: `frontend/src/composables/useVariantTree.ts`

- [ ] **Step 1: 创建 composable**

```typescript
/**
 * useVariantTree — 从平铺的 VariantInfo 列表构建树结构，维护扁平映射表。
 */
import { computed, type Ref } from 'vue'
import type { VariantInfo } from '../api/assets'

export interface VariantTreeNode extends VariantInfo {
  children: VariantTreeNode[]
  depth: number
}

export function useVariantTree(variants: Ref<VariantInfo[]>) {
  /** ID → VariantInfo 扁平映射 */
  const variantMap = computed(() => {
    const map = new Map<string, VariantInfo>()
    for (const v of variants.value) {
      map.set(v.id, v)
    }
    return map
  })

  /** 构建树结构 */
  const tree = computed<VariantTreeNode[]>(() => {
    const map = new Map<string, VariantTreeNode>()
    const roots: VariantTreeNode[] = []

    // 先构造所有节点
    for (const v of variants.value) {
      map.set(v.id, { ...v, children: [], depth: 0 })
    }

    // 建立父子关系
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        const parent = map.get(node.parentId)!
        node.depth = parent.depth + 1
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    }

    return roots
  })

  /** 获取某个变体的所有祖先（从根到自身） */
  function getAncestors(id: string): VariantTreeNode[] {
    const result: VariantTreeNode[] = []
    let current = tree.value.find(n => findInTree(n, id))
    // 先找到节点
    const findNode = (nodes: VariantTreeNode[]): VariantTreeNode | undefined => {
      for (const n of nodes) {
        if (n.id === id) return n
        const found = findNode(n.children)
        if (found) return found
      }
      return undefined
    }
    // 从根到自身
    function collectPath(node: VariantTreeNode, target: string, path: VariantTreeNode[]): boolean {
      path.push(node)
      if (node.id === target) return true
      for (const child of node.children) {
        if (collectPath(child, target, path)) return true
      }
      path.pop()
      return false
    }
    for (const root of tree.value) {
      const path: VariantTreeNode[] = []
      if (collectPath(root, id, path)) {
        return path
      }
    }
    return []
  }

  return { variantMap, tree, getAncestors }
}

function findInTree(node: VariantTreeNode, id: string): boolean {
  if (node.id === id) return true
  return node.children.some(c => findInTree(c, id))
}
```

- [ ] **Step 2: 运行类型检查**

```bash
cd frontend && npx vue-tsc --noEmit
```
预期：无类型错误。

- [ ] **Step 3: Git 提交**

```bash
git add frontend/src/composables/useVariantTree.ts
git commit -m "feat(variant): 添加 useVariantTree composable"
```

---

### Task 5: 前端 — 创建 AssetPickerDialog 通用资产选择器

**Files:**
- Create: `frontend/src/components/AssetPickerDialog.vue`

- [ ] **Step 1: 创建组件**

```vue
<template>
  <v-dialog v-model="show" max-width="720" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        选择引用资产
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" @click="show = false" />
      </v-card-title>

      <v-card-text>
        <v-tabs v-model="activeTab">
          <v-tab value="character">角色外观</v-tab>
          <v-tab value="characterVariant">角色变体</v-tab>
          <v-tab value="stage">场景设定</v-tab>
          <v-tab value="stageVariant">场景变体</v-tab>
          <v-tab value="custom">自定义资产</v-tab>
        </v-tabs>

        <div class="mt-3">
          <!-- 加载中 -->
          <div v-if="loading" class="d-flex justify-center py-4">
            <v-progress-circular indeterminate size="24" />
          </div>

          <!-- 缩略图网格 -->
          <v-row v-else dense>
            <v-col v-for="asset in filteredAssets" :key="asset.path" cols="4" sm="3" md="2">
              <v-card
                variant="outlined"
                :color="isSelected(asset.path) ? 'primary' : undefined"
                class="asset-card"
                @click="toggleAsset(asset.path)"
              >
                <v-img
                  :src="asset.thumbnail"
                  aspect-ratio="1"
                  cover
                  class="asset-thumb"
                />
                <div class="pa-1 text-caption text-truncate" :title="asset.label">
                  {{ asset.label }}
                </div>
                <v-icon
                  v-if="isSelected(asset.path)"
                  class="asset-check"
                  color="primary"
                  icon="mdi-check-circle"
                  size="small"
                />
              </v-card>
            </v-col>
            <v-col v-if="!loading && filteredAssets.length === 0" cols="12">
              <div class="text-grey text-center py-4">该分类无可用资产</div>
            </v-col>
          </v-row>
        </div>
      </v-card-text>

      <!-- 已选排序区 -->
      <v-divider />
      <div class="pa-3">
        <div class="text-caption text-medium-emphasis mb-1">
          已选资产（拖拽或箭头调整顺序，✕ 移除）：
        </div>
        <div v-if="orderedSelection.length === 0" class="text-grey text-caption">
          尚未选择资产
        </div>
        <div v-else class="d-flex flex-wrap ga-2">
          <div
            v-for="(path, idx) in orderedSelection"
            :key="path"
            class="selected-asset-chip"
            draggable="true"
            @dragstart="onDragStart($event, idx)"
            @dragover.prevent="onDragOver($event, idx)"
            @drop="onDrop($event, idx)"
          >
            <v-icon icon="mdi-drag" size="x-small" class="drag-handle" />
            <span class="text-caption text-truncate" style="max-width: 100px">{{ getLabel(path) }}</span>
            <div class="d-flex ga-0">
              <v-btn
                icon="mdi-chevron-up" size="x-small" variant="text"
                :disabled="idx === 0" @click="moveUp(idx)"
              />
              <v-btn
                icon="mdi-chevron-down" size="x-small" variant="text"
                :disabled="idx === orderedSelection.length - 1" @click="moveDown(idx)"
              />
              <v-btn
                icon="mdi-close" size="x-small" variant="text" color="error"
                @click="removeAsset(idx)"
              />
            </div>
          </div>
        </div>
      </div>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="show = false">取消</v-btn>
        <v-btn color="primary" @click="confirm">确认 ({{ orderedSelection.length }})</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import client from '../api/client'

interface AssetItem {
  path: string
  label: string
  thumbnail: string
  group: string
}

const props = defineProps<{
  modelValue: boolean
  project: string
  selected: string[]
  exclude?: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'update:selected', v: string[]): void
}>()

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const activeTab = ref('character')
const loading = ref(false)
const allAssets = ref<AssetItem[]>([])
const orderedSelection = ref<string[]>([...props.selected])
const dragIdx = ref<number | null>(null)

const filteredAssets = computed(() => {
  return allAssets.value.filter(a => a.group === activeTab.value)
})

// 当弹窗打开时加载数据
watch(show, async (val) => {
  if (val) {
    orderedSelection.value = [...props.selected]
    await loadAssets()
  }
})

function isSelected(path: string): boolean {
  return orderedSelection.value.includes(path)
}

function toggleAsset(path: string) {
  const idx = orderedSelection.value.indexOf(path)
  if (idx >= 0) {
    orderedSelection.value.splice(idx, 1)
  } else {
    orderedSelection.value.push(path)
  }
}

function removeAsset(idx: number) {
  orderedSelection.value.splice(idx, 1)
}

function moveUp(idx: number) {
  if (idx <= 0) return
  const item = orderedSelection.value.splice(idx, 1)[0]
  orderedSelection.value.splice(idx - 1, 0, item)
}

function moveDown(idx: number) {
  if (idx >= orderedSelection.value.length - 1) return
  const item = orderedSelection.value.splice(idx, 1)[0]
  orderedSelection.value.splice(idx + 1, 0, item)
}

function getLabel(path: string): string {
  const asset = allAssets.value.find(a => a.path === path)
  return asset?.label ?? path.split('/').pop() ?? path
}

// 拖拽排序
function onDragStart(_e: DragEvent, idx: number) {
  dragIdx.value = idx
}
function onDragOver(_e: DragEvent, idx: number) {
  // 视觉反馈由 CSS 处理
}
function onDrop(_e: DragEvent, targetIdx: number) {
  if (dragIdx.value === null || dragIdx.value === targetIdx) return
  const item = orderedSelection.value.splice(dragIdx.value, 1)[0]
  orderedSelection.value.splice(targetIdx, 0, item)
  dragIdx.value = null
}

async function loadAssets() {
  loading.value = true
  const ts = Date.now()
  const result: AssetItem[] = []
  const project = props.project
  const exclude = new Set(props.exclude ?? [])

  try {
    // 1. 角色外观
    const charResp = await client.get(`/fs/${project}/prompt/character/`)
    const charDirs: string[] = (charResp.data as { name: string }[] ?? []).map((d: any) => d.name.replace('/', ''))
    for (const name of charDirs) {
      const path = `assert/character/${name}/appearance.jpg`
      if (exclude.has(path)) continue
      result.push({
        path,
        label: `角色 · ${name}`,
        thumbnail: `/api/fs/${project}/${path}?t=${ts}`,
        group: 'character',
      })
    }

    // 2. 角色变体
    for (const name of charDirs) {
      try {
        const vResp = await client.get(`/assets/${project}/character/${encodeURIComponent(name)}/variants`)
        const vdata = vResp.data as { variants: any[] }
        for (const v of (vdata.variants ?? [])) {
          if (!v.hasImage || exclude.has(v.imagePath)) continue
          result.push({
            path: v.imagePath,
            label: `角色变体 · ${name}@${v.id}`,
            thumbnail: `/api/fs/${project}/${v.imagePath}?t=${ts}`,
            group: 'characterVariant',
          })
        }
      } catch { /* 跳过无变体的角色 */ }
    }

    // 3. 场景设定
    const stageResp = await client.get(`/fs/${project}/prompt/stage/`)
    const stageDirs: string[] = (stageResp.data as { name: string }[] ?? []).map((d: any) => d.name.replace('/', ''))
    for (const stage of stageDirs) {
      try {
        const filesResp = await client.get(`/fs/${project}/prompt/stage/${stage}/`)
        const files: string[] = (filesResp.data as string[] ?? [])
          .filter((f: string) => f.endsWith('.md') && f !== 'overview.md')
        for (const file of files) {
          const label = file.replace('.md', '')
          const path = `assert/stage/${stage}/${label}.jpg`
          if (exclude.has(path)) continue
          result.push({
            path,
            label: `场景 · ${stage}/${label}`,
            thumbnail: `/api/fs/${project}/${path}?t=${ts}`,
            group: 'stage',
          })
        }
      } catch { /* 跳过 */ }
    }

    // 4. 场景变体
    for (const stage of stageDirs) {
      try {
        const filesResp = await client.get(`/fs/${project}/prompt/stage/${stage}/`)
        const files: string[] = (filesResp.data as string[] ?? [])
          .filter((f: string) => f.endsWith('.md') && f !== 'overview.md')
        for (const file of files) {
          const label = file.replace('.md', '')
          try {
            const vResp = await client.get(`/assets/${project}/stage/${encodeURIComponent(stage)}/${encodeURIComponent(label)}/variants`)
            const vdata = vResp.data as { variants: any[] }
            for (const v of (vdata.variants ?? [])) {
              if (!v.hasImage || exclude.has(v.imagePath)) continue
              result.push({
                path: v.imagePath,
                label: `场景变体 · ${stage}/${label}@${v.id}`,
                thumbnail: `/api/fs/${project}/${v.imagePath}?t=${ts}`,
                group: 'stageVariant',
              })
            }
          } catch { /* 跳过 */ }
        }
      } catch { /* 跳过 */ }
    }

    // 5. 自定义资产
    try {
      const customResp = await client.get(`/fs/${project}/assert/custom/`, {
        params: { recursive: true }
      })
      const customFiles: string[] = (customResp.data as string[] ?? [])
        .filter((f: string) => /\.(jpg|jpeg|png|webp)$/i.test(f))
      for (const file of customFiles) {
        const path = `assert/custom/${file}`
        if (exclude.has(path)) continue
        result.push({
          path,
          label: `自定义 · ${file}`,
          thumbnail: `/api/fs/${project}/${path}?t=${ts}`,
          group: 'custom',
        })
      }
    } catch { /* 无自定义资产目录 */ }
  } catch { /* 整体出错 */ }

  allAssets.value = result
  loading.value = false
}

function confirm() {
  emit('update:selected', [...orderedSelection.value])
  show.value = false
}
</script>

<style scoped>
.asset-card {
  cursor: pointer;
  position: relative;
}
.asset-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
}
.asset-thumb {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.asset-check {
  position: absolute;
  top: 4px;
  right: 4px;
  background: white;
  border-radius: 50%;
}
.selected-asset-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 6px;
  background: rgba(var(--v-theme-primary), 0.04);
  cursor: default;
}
.drag-handle {
  cursor: grab;
}
</style>
```

- [ ] **Step 2: 注册组件到 CharacterPanel.vue 和 StagePanel.vue**

在 `CharacterPanel.vue` 和 `StagePanel.vue` 中确保 `AssetPickerDialog` 已导入（由 `VariantPanel` 内部使用，无需父组件导入）。

- [ ] **Step 3: 运行类型检查**

```bash
cd frontend && npx vue-tsc --noEmit
```
预期：无类型错误。

- [ ] **Step 4: Git 提交**

```bash
git add frontend/src/components/AssetPickerDialog.vue
git commit -m "feat(variant): 添加通用资产选择器 AssetPickerDialog"
```

---

### Task 6: 前端 — 创建 VariantTreeView 和 VariantTreeNode 组件

**Files:**
- Create: `frontend/src/components/VariantTreeView.vue`
- Create: `frontend/src/components/VariantTreeNode.vue`

- [ ] **Step 1: 创建 VariantTreeNode.vue（递归卡片节点）**

```vue
<template>
  <div class="variant-tree-node-wrapper">
    <div
      class="variant-node-card"
      :class="{ 'variant-node-card--root': depth === 0 }"
      :style="{ marginLeft: depth * 12 + 'px' }"
    >
      <!-- 连线的 SVG 占位，连线由父组件 VariantTreeView 统一绘制 -->
      <v-card variant="outlined" class="variant-card">
        <div class="variant-media">
          <v-img
            v-if="imageUrl"
            :src="imageUrl"
            aspect-ratio="1"
            contain
            class="variant-image variant-image--clickable"
            title="点击放大查看"
            @click="$emit('preview', node)"
          />
          <div v-else class="variant-placeholder text-grey text-caption">
            暂无图片
          </div>
          <div class="variant-actions">
            <v-btn size="x-small" variant="flat" icon="mdi-magnify"
              title="放大查看" :disabled="!imageUrl"
              @click.stop="$emit('preview', node)" />
            <v-btn size="x-small" color="primary" variant="flat" icon="mdi-auto-fix"
              title="生成图片" @click.stop="$emit('generate', node)" />
            <slot name="upload-btn" :node="node" />
            <v-btn size="x-small" variant="flat" icon="mdi-history"
              title="历史版本" :disabled="!node.hasImage"
              @click.stop="$emit('history', node)" />
            <v-btn size="x-small" variant="flat" icon="mdi-pencil"
              title="编辑描述" @click.stop="$emit('edit', node)" />
            <v-btn size="x-small" variant="flat" color="error" icon="mdi-delete"
              title="删除" @click.stop="$emit('delete', node)" />
          </div>
        </div>
        <div class="pa-2">
          <div class="d-flex align-center ga-1 mb-1">
            <div class="text-body-2 font-weight-medium text-truncate" :title="node.id">
              {{ node.id }}
            </div>
            <v-chip size="x-small" :color="node.hasImage ? 'success' : 'grey'"
              variant="tonal" class="flex-shrink-0">
              {{ node.hasImage ? '已有图' : '未生成' }}
            </v-chip>
          </div>
          <div class="text-caption text-medium-emphasis variant-desc" :title="node.desc">
            {{ node.desc }}
          </div>
        </div>
      </v-card>
    </div>

    <!-- 递归渲染子节点 -->
    <div v-if="node.children && node.children.length" class="variant-tree-children">
      <VariantTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :image-urls="imageUrls"
        @preview="$emit('preview', $event)"
        @generate="$emit('generate', $event)"
        @history="$emit('history', $event)"
        @edit="$emit('edit', $event)"
        @delete="$emit('delete', $event)"
      >
        <template #upload-btn="{ node: n }">
          <slot name="upload-btn" :node="n" />
        </template>
      </VariantTreeNode>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { VariantTreeNode as TreeNode } from '../composables/useVariantTree'

defineProps<{
  node: TreeNode
  depth: number
  imageUrls: Record<string, string>
}>()

defineEmits<{
  preview: [node: TreeNode]
  generate: [node: TreeNode]
  history: [node: TreeNode]
  edit: [node: TreeNode]
  delete: [node: TreeNode]
}>()
</script>

<style scoped>
.variant-tree-node-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.variant-node-card {
  max-width: 220px;
  width: 100%;
}
.variant-card {
  overflow: hidden;
}
.variant-media {
  position: relative;
  background: rgba(var(--v-theme-on-surface), 0.04);
  min-height: 100px;
}
.variant-image {
  width: 100%;
}
.variant-image--clickable {
  cursor: zoom-in;
}
.variant-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  min-height: 100px;
}
.variant-actions {
  position: absolute;
  inset: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}
.variant-card:hover .variant-actions,
.variant-card:focus-within .variant-actions {
  opacity: 1;
  pointer-events: auto;
}
.variant-desc {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  white-space: normal;
  word-break: break-word;
  min-height: 2.4em;
}
.variant-tree-children {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  margin-top: 16px;
  position: relative;
}
</style>
```

- [ ] **Step 2: 创建 VariantTreeView.vue（树容器 + SVG 连线）**

```vue
<template>
  <div ref="containerRef" class="variant-tree-container">
    <svg
      v-if="showLines"
      ref="svgRef"
      class="variant-tree-svg"
      :width="svgSize.width"
      :height="svgSize.height"
    >
      <path
        v-for="(line, i) in lines"
        :key="i"
        :d="line"
        stroke="rgba(var(--v-theme-on-surface), 0.2)"
        stroke-width="1.5"
        fill="none"
        stroke-linecap="round"
      />
    </svg>

    <div class="variant-tree-roots">
      <div
        v-for="root in roots"
        :key="root.id"
        class="variant-tree-root-wrapper"
      >
        <VariantTreeNode
          :node="root"
          :depth="0"
          :image-urls="imageUrls"
          @preview="$emit('preview', $event)"
          @generate="$emit('generate', $event)"
          @history="$emit('history', $event)"
          @edit="$emit('edit', $event)"
          @delete="$emit('delete', $event)"
        >
          <template #upload-btn="{ node }">
            <slot name="upload-btn" :node="node" />
          </template>
        </VariantTreeNode>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted } from 'vue'
import type { VariantTreeNode as TreeNode } from '../composables/useVariantTree'
import VariantTreeNode from './VariantTreeNode.vue'

const props = defineProps<{
  roots: TreeNode[]
  imageUrls: Record<string, string>
}>()

defineEmits<{
  preview: [node: TreeNode]
  generate: [node: TreeNode]
  history: [node: TreeNode]
  edit: [node: TreeNode]
  delete: [node: TreeNode]
}>()

const containerRef = ref<HTMLElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)
const svgSize = ref({ width: 0, height: 0 })
const lines = ref<string[]>([])
const showLines = ref(false)

/** 计算 SVG 连线路径 */
async function computeLines() {
  showLines.value = false
  await nextTick()
  if (!containerRef.value) return

  const container = containerRef.value
  const newLines: string[] = []

  // 查找所有父子卡片容器
  const parentCards = container.querySelectorAll('.variant-node-card')
  const cardMap = new Map<string, Element>()

  // 为每个卡片添加 data-variant-id 以匹配
  for (const card of parentCards) {
    // 从卡片内部的文本获取 id
    const titleEl = card.querySelector('.text-body-2')
    if (titleEl) {
      const id = titleEl.getAttribute('title') || titleEl.textContent?.trim()
      if (id) cardMap.set(id, card)
    }
  }

  // 收集所有连接：遍历每个节点找其子节点
  function collectEdges(nodes: TreeNode[], parentEl: Element | null) {
    for (const node of nodes) {
      if (parentEl && node.children?.length) {
        const parentRect = parentEl.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        const px = parentRect.left - containerRect.left + parentRect.width / 2
        const py = parentRect.bottom - containerRect.top

        for (const child of node.children) {
          const childCard = cardMap.get(child.id)
          if (childCard) {
            const childRect = childCard.getBoundingClientRect()
            const cx = childRect.left - containerRect.left + childRect.width / 2
            const cy = childRect.top - containerRect.top
            const midY = (py + cy) / 2
            // 贝塞尔曲线
            newLines.push(`M ${px},${py} C ${px},${midY} ${cx},${midY} ${cx},${cy}`)
          }
        }
      }
      if (node.children) {
        const parentCard = cardMap.get(node.id)
        collectEdges(node.children, parentCard ?? null)
      }
    }
  }

  collectEdges(props.roots, null)

  // 更新 SVG 尺寸
  if (svgRef.value) {
    const rect = container.getBoundingClientRect()
    svgSize.value = { width: rect.width, height: rect.height }
  }

  lines.value = newLines
  showLines.value = true
}

watch(() => props.roots, async () => {
  await nextTick()
  await computeLines()
}, { deep: true })

onMounted(async () => {
  await nextTick()
  await computeLines()
})
</script>

<style scoped>
.variant-tree-container {
  position: relative;
  width: 100%;
  overflow-x: auto;
}
.variant-tree-svg {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 0;
}
.variant-tree-roots {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 24px;
  position: relative;
  z-index: 1;
}
.variant-tree-root-wrapper {
  width: 100%;
}
</style>
```

- [ ] **Step 3: 运行类型检查**

```bash
cd frontend && npx vue-tsc --noEmit
```
预期：无类型错误。

- [ ] **Step 4: Git 提交**

```bash
git add frontend/src/components/VariantTreeView.vue frontend/src/components/VariantTreeNode.vue
git commit -m "feat(variant): 添加树形视图组件 VariantTreeView 和 VariantTreeNode"
```

---

### Task 7: 前端 — 重写 VariantPanel 集成树形视图

**Files:**
- Modify: `frontend/src/components/VariantPanel.vue`（全文重写）

- [ ] **Step 1: 重写 VariantPanel.vue**

核心变更：
1. 用 `VariantTreeView` + `VariantTreeNode` 替代平铺 `v-row` 网格
2. 创建/编辑表单新增 `parentId` 选择（下拉选择框，展示所有同级变体）
3. 创建/编辑表单新增 `AssetPickerDialog` 按钮来选择 `refs`
4. 删除时弹窗让用户选择「级联删除」或「提升子变体」
5. 生成时根据 `parentId` 和 `refs` 构建 `imagePaths`

```vue
<template>
  <div class="mt-4">
    <div class="d-flex align-center ga-2 mb-2">
      <div class="text-subtitle-2">衍生变体</div>
      <v-btn
        size="small"
        color="primary"
        variant="tonal"
        icon="mdi-plus"
        title="创建衍生变体"
        @click="openCreate"
      />
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="text-center py-4">
      <v-progress-circular indeterminate size="24" />
    </div>

    <!-- 空状态 -->
    <div v-else-if="!variants.length" class="text-grey text-body-2 mb-2">
      暂无衍生变体。可为当前{{ kindLabel }}创建变体（如图片编辑描述「门已打开」），生成时使用图片编辑工作流。
    </div>

    <!-- 树形视图 -->
    <VariantTreeView
      v-else
      :roots="tree"
      :image-urls="imageUrls"
      @preview="openPreview"
      @generate="openGenerate"
      @history="openHistory"
      @edit="openEdit"
      @delete="onDelete"
    >
      <template #upload-btn="{ node }">
        <AssetImageUploadButton
          :project="project"
          :asset-path="node.imagePath"
          icon-only
          size="x-small"
          variant="flat"
          icon="mdi-upload"
          label="上传图片"
          @uploaded="reload"
        />
      </template>
    </VariantTreeView>

    <!-- 创建/编辑弹窗 -->
    <v-dialog v-model="formDialog.show" max-width="600">
      <v-card>
        <v-card-title>
          {{ formDialog.mode === 'create' ? '创建衍生变体' : '编辑衍生描述' }}
        </v-card-title>
        <v-card-text>
          <v-alert v-if="formDialog.error" type="error" density="compact" class="mb-3">
            {{ formDialog.error }}
          </v-alert>

          <v-text-field
            v-if="formDialog.mode === 'create'"
            v-model="formDialog.id"
            label="变体名称"
            hint="如：门已打开、雨天、侧身"
            persistent-hint
            variant="outlined"
            class="mb-3"
          />

          <v-select
            v-if="formDialog.mode === 'create' || formDialog.parentIdEditable"
            v-model="formDialog.parentId"
            :items="parentOptions"
            label="父变体（可选）"
            hint="选择上级变体，将基于其图像继续衍生"
            persistent-hint
            variant="outlined"
            class="mb-3"
            clearable
          />

          <v-textarea
            v-model="formDialog.desc"
            label="衍生描述（图片编辑提示词）"
            rows="5"
            auto-grow
            variant="outlined"
            hint="描述相对父图的变化"
            persistent-hint
          />

          <div class="d-flex align-center ga-2 mb-2">
            <span class="text-body-2">引用资产（可选）</span>
            <v-btn
              size="small"
              variant="tonal"
              prepend-icon="mdi-image-multiple"
              @click="openAssetPicker"
            >
              选择引用资产
            </v-btn>
          </div>

          <div v-if="formDialog.refs.length" class="d-flex flex-wrap ga-1 mb-2">
            <v-chip
              v-for="(ref, idx) in formDialog.refs"
              :key="ref"
              closable
              @click:close="formDialog.refs.splice(idx, 1)"
            >
              {{ getRefLabel(ref) }}
            </v-chip>
          </div>
          <div v-else class="text-caption text-grey">
            未选择引用资产
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="formDialog.saving" @click="formDialog.show = false">
            取消
          </v-btn>
          <v-btn color="primary" :loading="formDialog.saving" @click="submitForm">
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 资产选择器 -->
    <AssetPickerDialog
      v-model="assetPicker.show"
      :project="project"
      :selected="assetPicker.selected"
      @update:selected="onAssetPickerConfirm"
    />

    <!-- 生成对话框 -->
    <GenerateDialog
      v-model="genDialog.show"
      :project="project"
      workflow-id="image-edit"
      workflow-name="衍生变体生成（图片编辑）"
      :vars="genDialog.vars"
      :output-path="genDialog.outputPath"
      :prompt-paths="genDialog.promptPaths"
      :existing-asset="genDialog.existingAsset"
      @refresh="reload"
    />

    <!-- 历史版本 -->
    <AssetHistoryDialog
      v-model="historyDialog.show"
      :project="project"
      :asset-path="historyDialog.path"
      @activated="reload"
    />

    <!-- 放大预览 -->
    <v-dialog v-model="previewDialog.show" max-width="960">
      <v-card>
        <v-card-title class="d-flex align-center">
          <span class="text-truncate">{{ previewDialog.title }}</span>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="previewDialog.show = false" />
        </v-card-title>
        <v-card-text class="pt-0">
          <div class="variant-preview-wrap d-flex justify-center align-center">
            <v-img v-if="previewDialog.url" :src="previewDialog.url" max-height="80vh" contain />
          </div>
          <div v-if="previewDialog.desc" class="text-body-2 text-medium-emphasis mt-3" style="white-space: pre-wrap;">
            {{ previewDialog.desc }}
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  AssetApiError,
  createCharacterVariant,
  createStageVariant,
  deleteCharacterVariant,
  deleteStageVariant,
  listCharacterVariants,
  listStageVariants,
  updateCharacterVariant,
  updateStageVariant,
  type VariantInfo,
} from '../api/assets'
import { confirm } from '../utils/confirm'
import { useVariantTree, type VariantTreeNode } from '../composables/useVariantTree'
import VariantTreeView from './VariantTreeView.vue'
import AssetPickerDialog from './AssetPickerDialog.vue'
import GenerateDialog from './GenerateDialog.vue'
import AssetHistoryDialog from './AssetHistoryDialog.vue'
import AssetImageUploadButton from './AssetImageUploadButton.vue'

const props = defineProps<{
  project: string
  kind: 'character' | 'stage'
  owner: string
  baseLabel?: string
}>()

const emit = defineEmits<{ refresh: [] }>()

const loading = ref(false)
const variants = ref<VariantInfo[]>([])
const imageUrls = ref<Record<string, string>>({})
const { tree, variantMap } = useVariantTree(variants)

const kindLabel = computed(() => (props.kind === 'character' ? '角色' : '场景'))

/** 可选择作为父变体的选项 */
const parentOptions = computed(() => {
  return variants.value
    .filter(v => v.id !== formDialog.id) // 不能选自己
    .map(v => ({
      title: v.id,
      value: v.id,
    }))
})

const formDialog = reactive({
  show: false,
  mode: 'create' as 'create' | 'edit',
  id: '',
  desc: '',
  parentId: '' as string | undefined,
  parentIdEditable: false,
  refs: [] as string[],
  error: '',
  saving: false,
})

const assetPicker = reactive({
  show: false,
  selected: [] as string[],
})

const genDialog = reactive({
  show: false,
  vars: {} as Record<string, string>,
  outputPath: '',
  promptPaths: [] as string[],
  existingAsset: undefined as string | undefined,
})

const historyDialog = reactive({
  show: false,
  path: '',
})

const previewDialog = reactive({
  show: false,
  title: '',
  url: '',
  desc: '',
})

async function reload() {
  loading.value = true
  try {
    if (props.kind === 'character') {
      const res = await listCharacterVariants(props.project, props.owner)
      variants.value = res.variants
    } else {
      if (!props.baseLabel) {
        variants.value = []
        return
      }
      const res = await listStageVariants(props.project, props.owner, props.baseLabel)
      variants.value = res.variants
    }
    const ts = Date.now()
    const urls: Record<string, string> = {}
    for (const v of variants.value) {
      if (v.hasImage) {
        urls[v.id] = `/api/fs/${props.project}/${v.imagePath}?t=${ts}`
      }
    }
    imageUrls.value = urls
  } catch {
    variants.value = []
    imageUrls.value = {}
  } finally {
    loading.value = false
  }
}

function openCreate() {
  formDialog.mode = 'create'
  formDialog.id = ''
  formDialog.desc = ''
  formDialog.parentId = undefined
  formDialog.parentIdEditable = true
  formDialog.refs = []
  formDialog.error = ''
  formDialog.show = true
}

function openEdit(v: VariantInfo) {
  formDialog.mode = 'edit'
  formDialog.id = v.id
  formDialog.desc = v.desc
  formDialog.parentId = v.parentId
  formDialog.parentIdEditable = true
  formDialog.refs = [...(v.refs || [])]
  formDialog.error = ''
  formDialog.show = true
}

function openAssetPicker() {
  assetPicker.selected = [...formDialog.refs]
  assetPicker.show = true
}

function onAssetPickerConfirm(paths: string[]) {
  formDialog.refs = paths
}

function getRefLabel(path: string): string {
  // 简单提取文件名作为标签
  return path.split('/').pop() ?? path
}

async function submitForm() {
  formDialog.error = ''
  formDialog.saving = true
  try {
    if (formDialog.mode === 'create') {
      const id = formDialog.id.trim()
      const desc = formDialog.desc.trim()
      if (!id) { formDialog.error = '请填写变体名称'; return }
      if (!desc) { formDialog.error = '请填写衍生描述'; return }
      if (props.kind === 'character') {
        await createCharacterVariant(props.project, props.owner, {
          id, desc,
          parentId: formDialog.parentId || undefined,
          refs: formDialog.refs,
        })
      } else {
        if (!props.baseLabel) throw new Error('缺少 baseLabel')
        await createStageVariant(props.project, props.owner, props.baseLabel, {
          id, desc,
          parentId: formDialog.parentId || undefined,
          refs: formDialog.refs,
        })
      }
    } else {
      const desc = formDialog.desc.trim()
      if (!desc) { formDialog.error = '衍生描述不能为空'; return }
      if (props.kind === 'character') {
        await updateCharacterVariant(props.project, props.owner, formDialog.id, {
          desc,
          parentId: formDialog.parentId || undefined,
          refs: formDialog.refs,
        })
      } else {
        if (!props.baseLabel) throw new Error('缺少 baseLabel')
        await updateStageVariant(props.project, props.owner, props.baseLabel, formDialog.id, {
          desc,
          parentId: formDialog.parentId || undefined,
          refs: formDialog.refs,
        })
      }
    }
    formDialog.show = false
    await reload()
    emit('refresh')
  } catch (e) {
    formDialog.error = e instanceof AssetApiError ? e.message : (e instanceof Error ? e.message : String(e))
  } finally {
    formDialog.saving = false
  }
}

async function onDelete(v: VariantInfo) {
  // 检查是否有子变体
  const vNode = findTreeNode(tree.value, v.id)
  const hasChildren = vNode ? vNode.children.length > 0 : variants.value.some(x => x.parentId === v.id)

  if (hasChildren) {
    // 先问是否级联删除
    const cascade = await confirm({
      title: '删除衍生变体',
      content: `衍生变体「${v.id}」存在子变体。是否级联删除所有子变体？`,
      confirmText: '级联删除',
      cancelText: '取消',
      confirmColor: 'error',
    })
    if (cascade) {
      try {
        if (props.kind === 'character') {
          await deleteCharacterVariant(props.project, props.owner, v.id, true)
        } else {
          if (!props.baseLabel) return
          await deleteStageVariant(props.project, props.owner, props.baseLabel, v.id, true)
        }
        await reload()
        emit('refresh')
      } catch (e) {
        window.alert(e instanceof AssetApiError ? e.message : String(e))
      }
      return
    }
    // 不级联则问是否提升子变体
    const promote = await confirm({
      title: '删除衍生变体',
      content: `是否将子变体提升为顶级变体？选择「取消」则不删除。`,
      confirmText: '提升子变体',
      cancelText: '取消',
      confirmColor: 'primary',
    })
    if (!promote) return
    try {
      if (props.kind === 'character') {
        await deleteCharacterVariant(props.project, props.owner, v.id, false)
      } else {
        if (!props.baseLabel) return
        await deleteStageVariant(props.project, props.owner, props.baseLabel, v.id, false)
      }
      await reload()
      emit('refresh')
    } catch (e) {
      window.alert(e instanceof AssetApiError ? e.message : String(e))
    }
  } else {
    // 无子变体，直接确认删除
    const ok = await confirm({
      title: '删除衍生变体',
      content: `确定删除衍生变体「${v.id}」？将同时删除其图片资产。`,
      confirmText: '删除',
      confirmColor: 'error',
    })
    if (!ok) return
    try {
      if (props.kind === 'character') {
        await deleteCharacterVariant(props.project, props.owner, v.id)
      } else {
        if (!props.baseLabel) return
        await deleteStageVariant(props.project, props.owner, props.baseLabel, v.id)
      }
      await reload()
      emit('refresh')
    } catch (e) {
      window.alert(e instanceof AssetApiError ? e.message : String(e))
    }
  }
}

function findTreeNode(nodes: VariantTreeNode[], id: string): VariantTreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    const found = findTreeNode(n.children, id)
    if (found) return found
  }
  return undefined
}

/** 构建生成时的 imagePaths 数组 */
function buildImagePaths(v: VariantInfo): string[] {
  const paths: string[] = []

  // 1. 父变体图像
  if (v.parentId) {
    const parent = variantMap.value.get(v.parentId)
    if (parent?.hasImage) {
      paths.push(parent.imagePath)
    } else {
      paths.push(getDefaultBaseImage(v))
    }
  } else {
    paths.push(getDefaultBaseImage(v))
  }

  // 2. 额外引用资产
  paths.push(...(v.refs || []))

  return paths
}

function getDefaultBaseImage(v: VariantInfo): string {
  if (v.kind === 'character') {
    return `assert/character/${v.owner}/appearance.jpg`
  }
  return `assert/stage/${v.owner}/${v.baseLabel}.jpg`
}

function openGenerate(v: VariantInfo) {
  genDialog.vars = {
    desc: v.desc,
    imagePaths: JSON.stringify(buildImagePaths(v)),
    purpose: 'variant-edit',
    variantKind: props.kind,
    variantOwner: props.owner,
    variantId: v.id,
    parentId: v.parentId ?? '',
    ...(props.kind === 'stage' && props.baseLabel ? { baseLabel: props.baseLabel } : {}),
  }
  genDialog.outputPath = v.imagePath
  genDialog.promptPaths = [v.metaPath]
  genDialog.existingAsset = v.hasImage ? '已有图片' : undefined
  genDialog.show = true
}

function openHistory(v: VariantInfo) {
  historyDialog.path = v.imagePath
  historyDialog.show = true
}

function openPreview(v: VariantInfo) {
  const url = imageUrls.value[v.id]
  if (!url) return
  previewDialog.title = v.id
  previewDialog.url = url
  previewDialog.desc = v.desc
  previewDialog.show = true
}

watch(
  () => [props.project, props.kind, props.owner, props.baseLabel] as const,
  () => { void reload() },
  { immediate: true },
)

defineExpose({ reload })
</script>

<style scoped>
.variant-preview-wrap {
  min-height: 240px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 8px;
  overflow: auto;
}
</style>
```

- [ ] **Step 2: 运行类型检查**

```bash
cd frontend && npx vue-tsc --noEmit
```
预期：无类型错误。

- [ ] **Step 3: Git 提交**

```bash
git add frontend/src/components/VariantPanel.vue
git commit -m "feat(variant): 重写 VariantPanel 集成树形视图、父变体和 refs"
```

---

### Task 8: 验证 — 全局类型检查和 ESLint

**Files:** 无变更

- [ ] **Step 1: 运行全局类型检查**

```bash
npm run typecheck
```
预期：无类型错误。

- [ ] **Step 2: 运行 ESLint**

```bash
npm run lint
```
预期：无 ESLint 错误。

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "feat(variant): 衍生变体树形结构和通用资产选择器"
git log --oneline -5
```
