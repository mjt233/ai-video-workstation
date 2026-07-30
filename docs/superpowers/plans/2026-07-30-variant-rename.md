# 衍生变体重命名 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 允许编辑衍生变体时修改名称（ID），服务端同步重命名文件、更新子变体引用和分镜场景帧引用。

**Architecture:** 服务端新增 rename 端点处理文件重命名和引用替换，前端编辑表单新增 ID 输入框，检测 ID 变化后调用 rename API。

**Tech Stack:** Express + TypeScript (server), Vue 3 + Vuetify 3 + TypeScript (frontend)

---

### Task 1: 服务端 — refs.ts 新增变体引用查找和替换

**Files:**
- Modify: `server/src/assets/refs.ts`

- [ ] **Step 1: 添加角色变体引用查找函数**

```typescript
/** 查找角色变体在分镜场景帧中的引用 */
export async function findCharacterVariantRefs(
  project: string,
  name: string,
  variantId: string,
): Promise<AssetRef[]> {
  const refs: AssetRef[] = [];
  const searchRef = `${name}@${variantId}`;
  for (const { episode, shot, dir } of await walkShots(project)) {
    const stages = await readJsonArray<StageEntry>(path.join(dir, 'stage.json'));
    if (!stages) continue;
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      // 检查登场角色
      if ((s.登场角色 ?? []).some((c) => c.trim() === searchRef)) {
        refs.push({ episode, shot, file: 'stage.json', detail: `登场角色[${i}]` });
      }
    }
  }
  return refs;
}
```

- [ ] **Step 2: 添加场景变体引用查找函数**

```typescript
/** 查找场景变体在分镜场景帧中的引用 */
export async function findStageVariantRefs(
  project: string,
  stage: string,
  label: string,
  variantId: string,
): Promise<AssetRef[]> {
  const refs: AssetRef[] = [];
  const searchRef = `${stage}/${label}@${variantId}`;
  for (const { episode, shot, dir } of await walkShots(project)) {
    const stages = await readJsonArray<StageEntry>(path.join(dir, 'stage.json'));
    if (!stages) continue;
    for (let i = 0; i < stages.length; i++) {
      if (stages[i].基础场景?.trim() === searchRef) {
        refs.push({ episode, shot, file: 'stage.json', detail: `基础场景[${i}]` });
      }
    }
  }
  return refs;
}
```

- [ ] **Step 3: 添加替换变体引用的函数**

```typescript
/** 将分镜中所有旧变体引用替换为新引用 */
async function replaceVariantRefInFrames(
  project: string,
  kind: 'character' | 'stage',
  owner: string,
  baseLabel: string | undefined,
  oldId: string,
  newId: string,
): Promise<void> {
  const oldRef = kind === 'character'
    ? `${owner}@${oldId}`
    : `${owner}/${baseLabel}@${oldId}`;
  const newRef = kind === 'character'
    ? `${owner}@${newId}`
    : `${owner}/${baseLabel}@${newId}`;

  for (const { episode, shot, dir } of await walkShots(project)) {
    const stagePath = path.join(dir, 'stage.json');
    const stages = await readJsonArray<StageEntry>(stagePath);
    if (!stages) continue;

    let changed = false;
    for (const s of stages) {
      if (kind === 'stage' && s.基础场景?.trim() === oldRef) {
        s.基础场景 = newRef;
        changed = true;
      }
      if (kind === 'character') {
        const chars = s.登场角色 ?? [];
        for (let i = 0; i < chars.length; i++) {
          if (chars[i].trim() === oldRef) {
            chars[i] = newRef;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      await fs.writeFile(stagePath, `${JSON.stringify(stages, null, 2)}\n`, 'utf-8');
    }
  }
}
```

- [ ] **Step 4: 运行类型检查**

```bash
cd server && npx tsc --noEmit
```
预期：无类型错误。

- [ ] **Step 5: Git 提交**

```bash
git add server/src/assets/refs.ts
git commit -m "feat(variant): 添加变体引用查找和替换函数"
```

---

### Task 2: 服务端 — variants.ts 新增重命名函数

**Files:**
- Modify: `server/src/assets/variants.ts`

- [ ] **Step 1: 添加 renameCharacterVariant 函数**

```typescript
export async function renameCharacterVariant(
  project: string,
  name: string,
  oldId: string,
  newId: string,
): Promise<VariantInfo> {
  assertSafeName(name, '角色名');
  assertSafeName(oldId, '变体名称');
  assertSafeName(newId, '变体名称');

  if (oldId === newId) {
    // 无变化，直接返回当前数据
    return (await listCharacterVariants(project, name)).find(v => v.id === oldId)
      ?? (() => { throw Object.assign(new Error('衍生变体不存在'), { code: 'NOT_FOUND' }); })();
  }

  const oldMetaPath = characterMetaRel(name, oldId);
  const newMetaPath = characterMetaRel(name, newId);

  // 检查旧变体存在
  if (!(await pathExists(resolveProjectPath(project, oldMetaPath)))) {
    throw Object.assign(new Error('衍生变体不存在'), { code: 'NOT_FOUND' });
  }
  // 检查新 ID 不冲突
  if (await pathExists(resolveProjectPath(project, newMetaPath))) {
    throw Object.assign(new Error('目标名称已存在'), { code: 'EXISTS' });
  }

  // 读取旧 meta
  const meta = await readMeta(project, oldMetaPath);
  if (!meta) throw Object.assign(new Error('meta 读取失败'), { code: 'INTERNAL' });

  // 更新 id 字段，写入新文件
  meta.id = newId;
  meta.updatedAt = new Date().toISOString();
  await writeMeta(project, newMetaPath, meta);
  await fs.unlink(resolveProjectPath(project, oldMetaPath));

  // 重命名图片
  const oldImagePath = characterImageRel(name, oldId);
  const newImagePath = characterImageRel(name, newId);
  const oldImageFull = resolveProjectPath(project, oldImagePath);
  const newImageFull = resolveProjectPath(project, newImagePath);
  if (await pathExists(oldImageFull)) {
    await ensureDir(path.dirname(newImageFull));
    await fs.rename(oldImageFull, newImageFull);
  }

  // 重命名历史目录
  const oldHistDir = resolveProjectPath(project, `assert/character/${name}/variants/history/${oldId}`);
  const newHistDir = resolveProjectPath(project, `assert/character/${name}/variants/history/${newId}`);
  if (await pathExists(oldHistDir)) {
    await ensureDir(path.dirname(newHistDir));
    await fs.rename(oldHistDir, newHistDir);
  }

  // 更新子变体的 parentId
  await replaceParentRef(project, characterMetaRel(name, ''), oldId, newId);

  // 更新分镜引用
  const { replaceVariantRefInFrames } = await import('./refs.js');
  await replaceVariantRefInFrames(project, 'character', name, undefined, oldId, newId);

  // 返回更新后的信息
  const hasImage = await pathExists(newImageFull);
  return {
    ...meta,
    kind: 'character',
    owner: name,
    metaPath: newMetaPath,
    imagePath: newImagePath,
    hasImage,
    ref: `${name}@${newId}`,
  };
}
```

- [ ] **Step 2: 添加 renameStageVariant 函数 (同上，路径不同)**

逻辑同 renameCharacterVariant，关键差异：
- 使用 `stageMetaRel(stage, baseLabel, id)` 构建路径
- 默认 baseImage 使用 `assert/stage/${stage}/${baseLabel}.jpg`
- 调用 `replaceVariantRefInFrames` 时传入 stage/baseLabel

- [ ] **Step 3: 添加 replaceParentRef 辅助函数**

```typescript
/** 扫描同目录下所有变体 meta，替换 parentId 引用 */
async function replaceParentRef(
  project: string,
  metaDirRel: string, // 以 / 结尾的目录路径，如 prompt/character/{name}/variants/
  oldId: string,
  newId: string,
): Promise<void> {
  const dir = resolveProjectPath(project, metaDirRel);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter(f => f.endsWith('.json'));
  } catch { return; }
  for (const f of files) {
    const filePath = path.join(dir, f);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw) as Partial<VariantMeta>;
      if (data.parentId === oldId) {
        data.parentId = newId;
        data.updatedAt = new Date().toISOString();
        await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
      }
    } catch { continue; }
  }
}
```

注意：`characterMetaRel(name, '')` 返回 `prompt/character/{name}/variants/.json`，目录是 `.../variants/`。为确保 `replaceParentRef` 拿到正确的目录，应传入不含文件名的目录路径。需调整调用方式：传递 `path.dirname(resolveProjectPath(project, characterMetaRel(name, oldId)))` 或直接传递目录。

建议修改：`replaceParentRef` 接收 `dirFull: string`（完整目录路径）而不是 `metaDirRel`。

- [ ] **Step 4: 在 variants.ts 中导出新函数**

将 `renameCharacterVariant`、`renameStageVariant` 和 `replaceVariantRefInFrames` 一并导出。

- [ ] **Step 5: 运行类型检查**

```bash
cd server && npx tsc --noEmit
```

- [ ] **Step 6: Git 提交**

```bash
git add server/src/assets/variants.ts
git commit -m "feat(variant): 添加变体重命名函数"
```

---

### Task 3: 服务端 — API 路由新增 rename 端点

**Files:**
- Modify: `server/src/routes/assets.ts`

- [ ] **Step 1: 导入 rename 函数**

在文件顶部的导入中添加：
```typescript
import {
  createCharacterVariant,
  createStageVariant,
  deleteCharacterVariant,
  deleteStageVariant,
  listCharacterVariants,
  listStageVariants,
  renameCharacterVariant,
  renameStageVariant,
  updateCharacterVariant,
  updateStageVariant,
} from '../assets/variants.js';
```

- [ ] **Step 2: 添加角色变体重命名路由**

在现有变体路由区域添加：
```typescript
// PUT /assets/:project/character/:name/variants/:variantId/rename
assetsRouter.put('/assets/:project/character/:name/variants/:variantId/rename', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const name = req.params.name as string;
    const variantId = req.params.variantId as string;
    const { newId } = req.body as { newId?: string };
    if (!newId) throw Object.assign(new Error('newId 必填'), { code: 'INVALID' });
    const variant = await renameCharacterVariant(project, name, variantId, newId);
    res.json({ success: true, variant });
  } catch (err) {
    httpError(res, err);
  }
});
```

- [ ] **Step 3: 添加场景变体重命名路由**

```typescript
// PUT /assets/:project/stage/:stage/:label/variants/:variantId/rename
assetsRouter.put('/assets/:project/stage/:stage/:label/variants/:variantId/rename', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const stage = req.params.stage as string;
    const label = req.params.label as string;
    const variantId = req.params.variantId as string;
    const { newId } = req.body as { newId?: string };
    if (!newId) throw Object.assign(new Error('newId 必填'), { code: 'INVALID' });
    const variant = await renameStageVariant(project, stage, label, variantId, newId);
    res.json({ success: true, variant });
  } catch (err) {
    httpError(res, err);
  }
});
```

- [ ] **Step 4: 运行类型检查**

```bash
cd server && npx tsc --noEmit
```

- [ ] **Step 5: Git 提交**

```bash
git add server/src/routes/assets.ts
git commit -m "feat(variant): 添加变体重命名 API 路由"
```

---

### Task 4: 前端 — API 客户端新增 rename 函数

**Files:**
- Modify: `frontend/src/api/assets.ts`

- [ ] **Step 1: 添加 renameCharacterVariant**

```typescript
export async function renameCharacterVariant(
  project: string,
  name: string,
  variantId: string,
  newId: string,
) {
  try {
    const { data } = await client.put(
      `/assets/${project}/character/${encodeURIComponent(name)}/variants/${encodeURIComponent(variantId)}/rename`,
      { newId },
    )
    return data as { success: boolean; variant: VariantInfo }
  } catch (e) { rethrow(e) }
}
```

- [ ] **Step 2: 添加 renameStageVariant**

```typescript
export async function renameStageVariant(
  project: string,
  stage: string,
  label: string,
  variantId: string,
  newId: string,
) {
  try {
    const { data } = await client.put(
      `/assets/${project}/stage/${encodeURIComponent(stage)}/${encodeURIComponent(label)}/variants/${encodeURIComponent(variantId)}/rename`,
      { newId },
    )
    return data as { success: boolean; variant: VariantInfo }
  } catch (e) { rethrow(e) }
}
```

- [ ] **Step 3: 运行类型检查**

```bash
cd frontend && npx vue-tsc --noEmit
```

- [ ] **Step 4: Git 提交**

```bash
git add frontend/src/api/assets.ts
git commit -m "feat(variant): 前端 API 客户端添加 rename 函数"
```

---

### Task 5: 前端 — VariantPanel 编辑表单支持改名

**Files:**
- Modify: `frontend/src/components/VariantPanel.vue`

- [ ] **Step 1: 导入 rename 函数**

在 imports 中添加：
```typescript
import {
  AssetApiError,
  createCharacterVariant,
  createStageVariant,
  deleteCharacterVariant,
  deleteStageVariant,
  listCharacterVariants,
  listStageVariants,
  renameCharacterVariant,
  renameStageVariant,
  updateCharacterVariant,
  updateStageVariant,
  type VariantInfo,
} from '../api/assets'
```

- [ ] **Step 2: 在 formDialog 中添加 originalId 字段**

```typescript
const formDialog = reactive({
  show: false,
  mode: 'create' as 'create' | 'edit',
  id: '',
  originalId: '',  // 跟踪原始 ID，用于检测是否修改
  desc: '',
  parentId: '' as string | undefined,
  parentIdEditable: false,
  refs: [] as string[],
  error: '',
  saving: false,
})
```

- [ ] **Step 3: 在 openEdit 中设置 originalId**

```typescript
function openEdit(v: VariantInfo) {
  formDialog.mode = 'edit'
  formDialog.id = v.id
  formDialog.originalId = v.id  // ← 新增
  formDialog.desc = v.desc
  formDialog.parentId = v.parentId
  formDialog.parentIdEditable = true
  formDialog.refs = [...(v.refs || [])]
  formDialog.error = ''
  formDialog.show = true
}
```

- [ ] **Step 4: 在编辑模式下显示 ID 输入框**

在表单中找到 ID 输入框，当前只在 `formDialog.mode === 'create'` 时显示。改为在编辑模式也显示：

```html
<v-text-field
  v-if="formDialog.mode === 'create' || formDialog.mode === 'edit'"
  v-model="formDialog.id"
  label="变体名称"
  hint="如：门已打开、雨天、侧身"
  persistent-hint
  variant="outlined"
  class="mb-3"
/>
```

- [ ] **Step 5: 在 submitForm 中处理重命名**

在 submitForm 的 edit 分支中，在调用 update API 之后，检测 ID 是否变化，如果变化则调用 rename API：

```typescript
// 在 edit 分支的 try 块内，update API 调用之后：
if (formDialog.id !== formDialog.originalId) {
  if (props.kind === 'character') {
    await renameCharacterVariant(props.project, props.owner, formDialog.originalId, formDialog.id)
  } else {
    if (!props.baseLabel) throw new Error('缺少 baseLabel')
    await renameStageVariant(props.project, props.owner, props.baseLabel, formDialog.originalId, formDialog.id)
  }
}
```

注意：rename 必须在 update 之后执行，因为 rename 会重命名文件和更新引用，不处理 desc/refs 等字段。先 update 修改好描述和引用，再 rename 处理文件名变更。

- [ ] **Step 6: 运行类型检查**

```bash
cd frontend && npx vue-tsc --noEmit
```

- [ ] **Step 7: Git 提交**

```bash
git add frontend/src/components/VariantPanel.vue
git commit -m "feat(variant): 编辑表单支持修改变体名称"
```

---

### Task 6: 全局验证

**Files:** 无变更

- [ ] **Step 1: 全局类型检查**

```bash
npm run typecheck
```

- [ ] **Step 2: ESLint**

```bash
npm run lint
```

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "feat(variant): 衍生变体重命名功能"
git log --oneline -5
```
