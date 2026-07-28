# 资产增删与分镜排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在项目管理详情界面支持角色/场景/子场景/集数/分镜的手动增删、分镜数字升序展示、分镜场景图上下移，以及删除/插入分镜后的大范围编号 rename。

**Architecture:** 服务端新增 `/api/assets` 路由，集中处理模板创建、引用检查、目录删除与 rename；前端在 `AssetTree` 提供增删入口与数字排序，在 `ScenePanel` 提供场景帧 ↑↓，通过 `api/assets.ts` 调用。

**Tech Stack:** Express + TypeScript、Vue 3 + Vuetify 3、axios、Node `fs/promises`

**Spec:** `docs/superpowers/specs/2026-07-28-asset-crud-and-shot-ordering-design.md`

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `server/src/assets/paths.ts` | design 根路径、安全 resolve、命名校验 |
| `server/src/assets/templates.ts` | 创建时写入的 md/json 模板 |
| `server/src/assets/refs.ts` | 扫描 stage.json/script.json 引用 |
| `server/src/assets/shot-renumber.ts` | 分镜目录成对 rename（prompt+assert） |
| `server/src/assets/stage-reorder.ts` | stage.json + jpg 序号重排 |
| `server/src/routes/assets.ts` | HTTP 路由 |
| `server/src/index.ts` | 挂载 `assetsRouter` |
| `frontend/src/api/assets.ts` | 前端 API 封装 |
| `frontend/src/components/AssetCreateDialog.vue` | 创建弹窗 |
| `frontend/src/components/AssetTree.vue` | 排序 + 增删入口 |
| `frontend/src/components/ScenePanel.vue` | 场景帧上下移 |
| `frontend/src/views/ProjectView.vue` | 刷新树 / 路由联动 |

本仓库暂无服务端单测框架；每任务用 `npm run typecheck` / `npm run lint` 与 curl 手工验收。

---

### Task 1: 服务端路径与校验工具

**Files:**
- Create: `server/src/assets/paths.ts`

- [ ] **Step 1: 创建 `server/src/assets/paths.ts`**

```typescript
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DESIGN_DIR = path.resolve(__dirname, '../../../design');

const FORBIDDEN_NAME = /[\\/:*?"<>|]/;
export const POSITIVE_INT = /^[1-9]\d*$/;

export function projectRoot(project: string): string {
  return path.resolve(DESIGN_DIR, project);
}

/** 将 project 相对路径解析为绝对路径；越界抛错 */
export function resolveProjectPath(project: string, relPath: string): string {
  const root = projectRoot(project);
  const full = path.resolve(root, relPath);
  const rootWithSep = root + path.sep;
  if (full !== root && !full.startsWith(rootWithSep)) {
    throw Object.assign(new Error('Path traversal denied'), { code: 'INVALID' });
  }
  return full;
}

export function assertSafeName(name: string, label = '名称'): void {
  const trimmed = name.trim();
  if (!trimmed) {
    throw Object.assign(new Error(`${label}不能为空`), { code: 'INVALID' });
  }
  if (trimmed !== name) {
    throw Object.assign(new Error(`${label}不能有首尾空白`), { code: 'INVALID' });
  }
  if (FORBIDDEN_NAME.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw Object.assign(new Error(`${label}包含非法字符`), { code: 'INVALID' });
  }
}

export function assertPositiveIntId(id: string, label: string): void {
  if (!POSITIVE_INT.test(id)) {
    throw Object.assign(new Error(`${label}必须是正整数`), { code: 'INVALID' });
  }
}

export async function pathExists(fullPath: string): Promise<boolean> {
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(fullPath: string): Promise<void> {
  await fs.mkdir(fullPath, { recursive: true });
}

export async function listNumericDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && POSITIVE_INT.test(e.name))
      .map(e => e.name)
      .sort((a, b) => Number(a) - Number(b));
  } catch {
    return [];
  }
}

export async function nextNumericId(dir: string): Promise<string> {
  const ids = await listNumericDirNames(dir);
  if (!ids.length) return '1';
  return String(Math.max(...ids.map(Number)) + 1);
}

export function httpError(res: import('express').Response, err: unknown, fallback = 'Internal server error'): void {
  const e = err as { code?: string; message?: string; refs?: unknown };
  if (e?.code === 'INVALID') {
    res.status(400).json({ error: e.message, code: 'INVALID' });
    return;
  }
  if (e?.code === 'EXISTS') {
    res.status(409).json({ error: e.message, code: 'EXISTS' });
    return;
  }
  if (e?.code === 'IN_USE') {
    res.status(409).json({ error: e.message, code: 'IN_USE', refs: e.refs ?? [] });
    return;
  }
  if (e?.code === 'NOT_FOUND') {
    res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
    return;
  }
  if (e?.code === 'CONFLICT') {
    res.status(409).json({ error: e.message, code: 'CONFLICT' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: fallback });
}
```

- [ ] **Step 2: typecheck 服务端**

Run: `npm run typecheck:server`  
Expected: 无错误（若 `assets` 目录仅此文件应通过）

- [ ] **Step 3: Commit**

```bash
git add server/src/assets/paths.ts
git commit -m "feat(server): 资产路径与命名校验工具"
```

---

### Task 2: 创建模板

**Files:**
- Create: `server/src/assets/templates.ts`

- [ ] **Step 1: 创建模板模块**

```typescript
export function characterOverviewMd(name: string, gender: string, age: string, personality: string): string {
  return `# ${name} - 角色总览

## 基本信息
- 姓名：${name}
- 性别：${gender || '待定'}
- 年龄：${age || '待定'}
- 性格：${personality || '待补充'}

## 背景
待补充角色背景故事。

## 角色关系
待补充与其他角色的关系说明。
`;
}

export function characterAppearanceMd(gender: string, age: string): string {
  return `生成人物角色正面、侧面、背面三个视角的全身图

要求：纯色背景、自然站立，双臂自然下垂
以下为角色描述

## 基本信息
- 年龄：${age || '待定'}
- 性别：${gender || '待定'}
- 身高：待定
- 体型：待定
- 其他细节

## 风格
待补充

## 面部特征
- 脸型：待定
- 发型发色：待定
- 五官特征：待定
- 其他细节特征

## 衣着风格
- 服装款式：待定
- 颜色搭配：待定
- 材质：待定
- 其他配饰细节

## 气质关键词
待补充
`;
}

export function characterVoiceMd(): string {
  return `待补充声线描述：用 1-3 句自然语言概括音调、语速、咬字与整体听觉印象。
`;
}

export function subsceneMd(opts: {
  label: string;
  time?: string;
  angle?: string;
  weather?: string;
  description?: string;
}): string {
  return `# ${opts.label}

## 时间
${opts.time || '待定'}

## 角度
${opts.angle || '待定'}

## 天气/光线
${opts.weather || '待定'}

## 画面描述
${opts.description || '待补充场景画面描述。'}

## 主色调
待补充
`;
}

export function shotOverviewMd(episode: string, shot: string): string {
  return `# 第${episode}集 分镜 ${shot} - 待定标题

## 叙事节拍
待补充该分镜在剧情中的作用。

## 画面描述
待补充角色位置、朝向、动作与镜头角度。

## 镜头运动
待补充（固定/推近/拉远/平移等）。

## 时长参考
待补充

## 情绪基调
待补充
`;
}

export function shotPromptMd(): string {
  return `待补充图生视频提示词（LTX-2.3）。运镜与动作描述写在此处；不要重复描述已由参考图提供的背景与人物外貌。
`;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/assets/templates.ts
git commit -m "feat(server): 资产创建模板"
```

---

### Task 3: 引用扫描

**Files:**
- Create: `server/src/assets/refs.ts`

- [ ] **Step 1: 实现引用扫描**

```typescript
import fs from 'fs/promises';
import path from 'path';
import { resolveProjectPath } from './paths.js';

export interface AssetRef {
  episode: string;
  shot: string;
  file: 'stage.json' | 'script.json';
  detail?: string;
}

interface StageEntry {
  基础场景?: string;
  登场角色?: string[];
  prompt?: string;
}

interface ScriptEntry {
  角色名?: string;
}

async function walkShots(project: string): Promise<Array<{ episode: string; shot: string; dir: string }>> {
  const sceneRoot = resolveProjectPath(project, 'prompt/scene');
  const result: Array<{ episode: string; shot: string; dir: string }> = [];
  let episodes: string[] = [];
  try {
    episodes = (await fs.readdir(sceneRoot, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return result;
  }
  for (const episode of episodes) {
    const epDir = path.join(sceneRoot, episode);
    let shots: string[] = [];
    try {
      shots = (await fs.readdir(epDir, { withFileTypes: true }))
        .filter(e => e.isDirectory())
        .map(e => e.name);
    } catch {
      continue;
    }
    for (const shot of shots) {
      result.push({ episode, shot, dir: path.join(epDir, shot) });
    }
  }
  return result;
}

async function readJsonArray<T>(filePath: string): Promise<T[] | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? (data as T[]) : null;
  } catch {
    return null;
  }
}

export async function findCharacterRefs(project: string, name: string): Promise<AssetRef[]> {
  const refs: AssetRef[] = [];
  for (const { episode, shot, dir } of await walkShots(project)) {
    const stages = await readJsonArray<StageEntry>(path.join(dir, 'stage.json'));
    if (stages) {
      for (const s of stages) {
        if ((s.登场角色 ?? []).includes(name)) {
          refs.push({ episode, shot, file: 'stage.json', detail: '登场角色' });
          break;
        }
      }
    }
    const scripts = await readJsonArray<ScriptEntry>(path.join(dir, 'script.json'));
    if (scripts?.some(s => s.角色名 === name)) {
      refs.push({ episode, shot, file: 'script.json', detail: '角色名' });
    }
  }
  return refs;
}

export async function findStageRefs(project: string, stageName: string): Promise<AssetRef[]> {
  const prefix = `${stageName}/`;
  const refs: AssetRef[] = [];
  for (const { episode, shot, dir } of await walkShots(project)) {
    const stages = await readJsonArray<StageEntry>(path.join(dir, 'stage.json'));
    if (!stages) continue;
    if (stages.some(s => (s.基础场景 ?? '').startsWith(prefix) || s.基础场景 === stageName)) {
      refs.push({ episode, shot, file: 'stage.json', detail: '基础场景' });
    }
  }
  return refs;
}

export async function findSubsceneRefs(project: string, stageName: string, label: string): Promise<AssetRef[]> {
  const full = `${stageName}/${label}`;
  const refs: AssetRef[] = [];
  for (const { episode, shot, dir } of await walkShots(project)) {
    const stages = await readJsonArray<StageEntry>(path.join(dir, 'stage.json'));
    if (!stages) continue;
    if (stages.some(s => s.基础场景 === full)) {
      refs.push({ episode, shot, file: 'stage.json', detail: '基础场景' });
    }
  }
  return refs;
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck:server`  
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add server/src/assets/refs.ts
git commit -m "feat(server): 资产引用扫描"
```

---

### Task 4: 分镜 renumber 与 stage reorder 工具

**Files:**
- Create: `server/src/assets/shot-renumber.ts`
- Create: `server/src/assets/stage-reorder.ts`

- [ ] **Step 1: `shot-renumber.ts`**

```typescript
import fs from 'fs/promises';
import path from 'path';
import { listNumericDirNames, pathExists, resolveProjectPath } from './paths.js';

export interface RenamePair {
  from: string;
  to: string;
}

async function renameDirIfExists(from: string, to: string): Promise<void> {
  if (!(await pathExists(from))) return;
  if (await pathExists(to)) {
    throw Object.assign(new Error(`目标已存在: ${to}`), { code: 'CONFLICT' });
  }
  await fs.rename(from, to);
}

/** 成对 rename prompt/scene/{ep}/{id} 与 assert/scene/{ep}/{id} */
async function renameShotPair(project: string, episode: string, from: string, to: string): Promise<void> {
  const promptFrom = resolveProjectPath(project, `prompt/scene/${episode}/${from}`);
  const promptTo = resolveProjectPath(project, `prompt/scene/${episode}/${to}`);
  const assertFrom = resolveProjectPath(project, `assert/scene/${episode}/${from}`);
  const assertTo = resolveProjectPath(project, `assert/scene/${episode}/${to}`);
  await renameDirIfExists(promptFrom, promptTo);
  await renameDirIfExists(assertFrom, assertTo);
}

/**
 * 删除 shot 后：将 > deleted 的编号整体 -1（从小到大）。
 * 调用方须已删除目标目录。
 */
export async function shiftShotsDownAfterDelete(
  project: string,
  episode: string,
  deletedShot: string,
): Promise<RenamePair[]> {
  const epDir = resolveProjectPath(project, `prompt/scene/${episode}`);
  const ids = await listNumericDirNames(epDir);
  const deleted = Number(deletedShot);
  const renames: RenamePair[] = [];
  for (const id of ids) {
    const n = Number(id);
    if (n > deleted) {
      const to = String(n - 1);
      await renameShotPair(project, episode, id, to);
      renames.push({ from: id, to });
    }
  }
  return renames;
}

/**
 * 在 position 插入空位：将 >= position 的编号 +1（从大到小）。
 * 返回 renames；调用方再在 position 创建新分镜。
 */
export async function shiftShotsUpForInsert(
  project: string,
  episode: string,
  position: number,
): Promise<RenamePair[]> {
  const epDir = resolveProjectPath(project, `prompt/scene/${episode}`);
  const ids = (await listNumericDirNames(epDir)).map(Number).sort((a, b) => b - a);
  const renames: RenamePair[] = [];
  for (const n of ids) {
    if (n >= position) {
      const from = String(n);
      const to = String(n + 1);
      await renameShotPair(project, episode, from, to);
      renames.push({ from, to });
    }
  }
  // 对外按 from 升序返回，便于前端映射
  renames.reverse();
  return renames;
}

export async function removeDirIfExists(fullPath: string): Promise<void> {
  if (await pathExists(fullPath)) {
    await fs.rm(fullPath, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: `stage-reorder.ts`**

```typescript
import fs from 'fs/promises';
import path from 'path';
import { pathExists, resolveProjectPath } from './paths.js';

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export async function reorderStageFrames(
  project: string,
  episode: string,
  shot: string,
  from: number,
  to: number,
): Promise<void> {
  const jsonPath = resolveProjectPath(project, `prompt/scene/${episode}/${shot}/stage.json`);
  let data: unknown;
  try {
    data = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
  } catch {
    throw Object.assign(new Error('stage.json 不存在或无效'), { code: 'NOT_FOUND' });
  }
  if (!Array.isArray(data)) {
    throw Object.assign(new Error('stage.json 必须是数组'), { code: 'INVALID' });
  }
  const n = data.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n) {
    throw Object.assign(new Error('索引越界'), { code: 'CONFLICT' });
  }
  if (from === to) return;

  const reordered = moveItem(data, from, to);
  await fs.writeFile(jsonPath, JSON.stringify(reordered, null, 2) + '\n', 'utf-8');

  const stageDir = resolveProjectPath(project, `assert/scene/${episode}/${shot}/stage`);
  if (!(await pathExists(stageDir))) return;

  // 全部先改到临时名，再落到最终名
  const tmpSuffix = `.reorder-tmp-${Date.now()}`;
  for (let i = 0; i < n; i++) {
    const src = path.join(stageDir, `${i}.jpg`);
    if (await pathExists(src)) {
      await fs.rename(src, path.join(stageDir, `${i}${tmpSuffix}.jpg`));
    }
  }
  const mapping = moveItem([...Array(n).keys()], from, to);
  // mapping[newIndex] = oldIndex
  for (let newIndex = 0; newIndex < n; newIndex++) {
    const oldIndex = mapping[newIndex];
    const tmp = path.join(stageDir, `${oldIndex}${tmpSuffix}.jpg`);
    if (await pathExists(tmp)) {
      await fs.rename(tmp, path.join(stageDir, `${newIndex}.jpg`));
    }
  }
}
```

注意：`moveItem([...Array(n).keys()], from, to)` 得到的是「新位置上的旧下标」。例如 `[0,1,2]` from0→to1 得 `[1,0,2]`，即 new0 来自 old1。临时文件按 oldIndex 命名，最终写到 newIndex，逻辑正确。

- [ ] **Step 3: typecheck**

Run: `npm run typecheck:server`  
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add server/src/assets/shot-renumber.ts server/src/assets/stage-reorder.ts
git commit -m "feat(server): 分镜 renumber 与场景帧 reorder"
```

---

### Task 5: assets 路由 — 创建

**Files:**
- Create: `server/src/routes/assets.ts`（本任务写创建端点；删除/reorder 在 Task 6）
- Modify: `server/src/index.ts`

- [ ] **Step 1: 创建 `server/src/routes/assets.ts` 骨架 + 创建 API**

```typescript
import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import {
  assertPositiveIntId,
  assertSafeName,
  ensureDir,
  httpError,
  listNumericDirNames,
  nextNumericId,
  pathExists,
  resolveProjectPath,
} from '../assets/paths.js';
import {
  characterAppearanceMd,
  characterOverviewMd,
  characterVoiceMd,
  shotOverviewMd,
  shotPromptMd,
  subsceneMd,
} from '../assets/templates.js';
import { findCharacterRefs, findStageRefs, findSubsceneRefs } from '../assets/refs.js';
import { removeDirIfExists, shiftShotsDownAfterDelete, shiftShotsUpForInsert } from '../assets/shot-renumber.js';
import { reorderStageFrames } from '../assets/stage-reorder.js';

export const assetsRouter = Router();

// POST /api/assets/:project/character
assetsRouter.post('/assets/:project/character', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const { name, gender = '', age = '', personality = '' } = req.body as {
      name?: string; gender?: string; age?: string; personality?: string;
    };
    if (!name) throw Object.assign(new Error('name 必填'), { code: 'INVALID' });
    assertSafeName(name, '角色名');
    const dir = resolveProjectPath(project, `prompt/character/${name}`);
    if (await pathExists(dir)) throw Object.assign(new Error('角色已存在'), { code: 'EXISTS' });
    await ensureDir(dir);
    await fs.writeFile(path.join(dir, 'overview.md'), characterOverviewMd(name, gender, age, personality), 'utf-8');
    await fs.writeFile(path.join(dir, 'appearance.md'), characterAppearanceMd(gender, age), 'utf-8');
    await fs.writeFile(path.join(dir, 'voice.md'), characterVoiceMd(), 'utf-8');
    res.json({ success: true, path: `prompt/character/${name}` });
  } catch (err) {
    httpError(res, err);
  }
});

// POST /api/assets/:project/stage
assetsRouter.post('/assets/:project/stage', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const { name } = req.body as { name?: string };
    if (!name) throw Object.assign(new Error('name 必填'), { code: 'INVALID' });
    assertSafeName(name, '场景名');
    const dir = resolveProjectPath(project, `prompt/stage/${name}`);
    if (await pathExists(dir)) throw Object.assign(new Error('场景已存在'), { code: 'EXISTS' });
    await ensureDir(dir);
    res.json({ success: true, path: `prompt/stage/${name}` });
  } catch (err) {
    httpError(res, err);
  }
});

// POST /api/assets/:project/subscene
assetsRouter.post('/assets/:project/subscene', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const body = req.body as {
      stage?: string; label?: string; time?: string; angle?: string; weather?: string; description?: string;
    };
    if (!body.stage || !body.label) throw Object.assign(new Error('stage 与 label 必填'), { code: 'INVALID' });
    assertSafeName(body.stage, '场景名');
    assertSafeName(body.label, '子场景标签');
    const stageDir = resolveProjectPath(project, `prompt/stage/${body.stage}`);
    if (!(await pathExists(stageDir))) throw Object.assign(new Error('场景不存在'), { code: 'NOT_FOUND' });
    const file = path.join(stageDir, `${body.label}.md`);
    if (await pathExists(file)) throw Object.assign(new Error('子场景已存在'), { code: 'EXISTS' });
    await fs.writeFile(file, subsceneMd(body), 'utf-8');
    res.json({ success: true, path: `prompt/stage/${body.stage}/${body.label}.md` });
  } catch (err) {
    httpError(res, err);
  }
});

// POST /api/assets/:project/episode
assetsRouter.post('/assets/:project/episode', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const sceneRoot = resolveProjectPath(project, 'prompt/scene');
    await ensureDir(sceneRoot);
    let episode = (req.body as { episode?: string }).episode;
    if (episode === undefined || episode === null || episode === '') {
      episode = await nextNumericId(sceneRoot);
    } else {
      episode = String(episode);
      assertPositiveIntId(episode, '集数');
      if (await pathExists(path.join(sceneRoot, episode))) {
        throw Object.assign(new Error('集数已存在'), { code: 'EXISTS' });
      }
    }
    await ensureDir(path.join(sceneRoot, episode));
    res.json({ success: true, path: `prompt/scene/${episode}`, episode });
  } catch (err) {
    httpError(res, err);
  }
});

// POST /api/assets/:project/shot
assetsRouter.post('/assets/:project/shot', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const { episode, shot, position } = req.body as {
      episode?: string; shot?: string; position?: 'insert' | 'end';
    };
    if (!episode) throw Object.assign(new Error('episode 必填'), { code: 'INVALID' });
    assertPositiveIntId(String(episode), '集数');
    const epDir = resolveProjectPath(project, `prompt/scene/${episode}`);
    if (!(await pathExists(epDir))) throw Object.assign(new Error('集数不存在'), { code: 'NOT_FOUND' });

    const existing = await listNumericDirNames(epDir);
    const n = existing.length;
    let target: number;
    let renames: { from: string; to: string }[] = [];

    const mode = position === 'insert' || (shot && existing.includes(String(shot))) ? 'insert' : 'end';

    if (mode === 'end' && (!shot || shot === 'end')) {
      target = n === 0 ? 1 : Math.max(...existing.map(Number)) + 1;
    } else if (mode === 'end' && shot) {
      assertPositiveIntId(String(shot), '分镜');
      target = Number(shot);
      if (existing.includes(String(target))) {
        throw Object.assign(new Error('分镜已存在'), { code: 'EXISTS' });
      }
      // 允许指定大于 N+1 会破坏连续；强制只能是 N+1 或空位但不跳号：仅允许 max+1
      if (target !== (n === 0 ? 1 : Math.max(...existing.map(Number)) + 1)) {
        throw Object.assign(new Error('末尾新增只能使用下一个连续编号，中间插入请 position=insert'), { code: 'INVALID' });
      }
    } else {
      // insert
      if (!shot) throw Object.assign(new Error('插入时 shot 必填'), { code: 'INVALID' });
      assertPositiveIntId(String(shot), '分镜');
      target = Number(shot);
      if (target < 1 || target > n + 1) {
        throw Object.assign(new Error(`插入位置须在 1..${n + 1}`), { code: 'INVALID' });
      }
      renames = await shiftShotsUpForInsert(project, String(episode), target);
    }

    const shotId = String(target);
    const shotDir = path.join(epDir, shotId);
    await ensureDir(shotDir);
    await fs.writeFile(path.join(shotDir, 'overview.md'), shotOverviewMd(String(episode), shotId), 'utf-8');
    await fs.writeFile(path.join(shotDir, 'stage.json'), '[]\n', 'utf-8');
    await fs.writeFile(path.join(shotDir, 'script.json'), '[]\n', 'utf-8');
    await fs.writeFile(path.join(shotDir, 'prompt.md'), shotPromptMd(), 'utf-8');

    res.json({
      success: true,
      path: `prompt/scene/${episode}/${shotId}`,
      episode: String(episode),
      shot: shotId,
      renames,
    });
  } catch (err) {
    httpError(res, err);
  }
});

// 删除与 reorder 占位 — Task 6 填充
```

插入语义说明（实现时严格遵守）：

- `position` 省略 + `shot` 省略 → 末尾 `max+1`
- `position: "insert"` + `shot: "3"` → 先把 ≥3 的 +1，再创建 3
- 若未标 insert 但 `shot` 已存在 → 视为 insert（与 spec 一致）

- [ ] **Step 2: 在 `server/src/index.ts` 挂载**

```typescript
import { assetsRouter } from './routes/assets.js';
// ...
app.use('/api', fsRouter);
app.use('/api', assetsRouter);
app.use('/api', workflowRouter);
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck:server`  
Expected: 通过（若 Task 6 未写删除路由，确保本文件不引用未用 import 触发 lint；可先保留 import 并在 Task 6 立即补全删除端点，或本任务末尾直接写完删除——推荐 **本任务只做创建，Task 6 补删除时再加 import 使用**。若 eslint 报 unused，将 delete 相关 import 挪到 Task 6。）

为避免 unused import，Task 5 的 `assets.ts` **先不要** import `findCharacterRefs` / `removeDirIfExists` / `reorderStageFrames`；Task 6 再加。

- [ ] **Step 4: 手工冒烟（可选，需 dev server）**

```bash
curl -s -X POST http://localhost:3001/api/assets/古人在现代/character -H "Content-Type: application/json" -d "{\"name\":\"测试角色甲\",\"gender\":\"女\",\"age\":\"20岁\",\"personality\":\"冷静\"}"
```

Expected: `{"success":true,"path":"prompt/character/测试角色甲"}`  
测完删除该测试目录，或留到 Task 6 用 DELETE 清掉。

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/assets.ts server/src/index.ts
git commit -m "feat(server): 资产创建 API"
```

---

### Task 6: assets 路由 — 删除与 reorder

**Files:**
- Modify: `server/src/routes/assets.ts`

- [ ] **Step 1: 追加删除与 reorder 端点**

在文件顶部补全 import（`findCharacterRefs`, `findStageRefs`, `findSubsceneRefs`, `removeDirIfExists`, `shiftShotsDownAfterDelete`, `reorderStageFrames`）。

```typescript
// DELETE character
assetsRouter.delete('/assets/:project/character/:name', async (req, res) => {
  try {
    const project = req.params.project as string;
    const name = req.params.name as string;
    assertSafeName(name, '角色名');
    const dir = resolveProjectPath(project, `prompt/character/${name}`);
    if (!(await pathExists(dir))) throw Object.assign(new Error('角色不存在'), { code: 'NOT_FOUND' });
    const refs = await findCharacterRefs(project, name);
    if (refs.length) throw Object.assign(new Error('资源正在被引用，无法删除'), { code: 'IN_USE', refs });
    await removeDirIfExists(dir);
    await removeDirIfExists(resolveProjectPath(project, `assert/character/${name}`));
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE stage
assetsRouter.delete('/assets/:project/stage/:name', async (req, res) => {
  try {
    const project = req.params.project as string;
    const name = req.params.name as string;
    assertSafeName(name, '场景名');
    const dir = resolveProjectPath(project, `prompt/stage/${name}`);
    if (!(await pathExists(dir))) throw Object.assign(new Error('场景不存在'), { code: 'NOT_FOUND' });
    const refs = await findStageRefs(project, name);
    if (refs.length) throw Object.assign(new Error('资源正在被引用，无法删除'), { code: 'IN_USE', refs });
    await removeDirIfExists(dir);
    await removeDirIfExists(resolveProjectPath(project, `assert/stage/${name}`));
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE subscene — label 可能含中文与连字符，用 * 或 query；Express :label 单段即可（标签无 /）
assetsRouter.delete('/assets/:project/subscene/:stage/:label', async (req, res) => {
  try {
    const project = req.params.project as string;
    const stage = req.params.stage as string;
    const label = req.params.label as string;
    assertSafeName(stage, '场景名');
    assertSafeName(label, '子场景标签');
    const file = resolveProjectPath(project, `prompt/stage/${stage}/${label}.md`);
    if (!(await pathExists(file))) throw Object.assign(new Error('子场景不存在'), { code: 'NOT_FOUND' });
    const refs = await findSubsceneRefs(project, stage, label);
    if (refs.length) throw Object.assign(new Error('资源正在被引用，无法删除'), { code: 'IN_USE', refs });
    await fs.unlink(file);
    const jpg = resolveProjectPath(project, `assert/stage/${stage}/${label}.jpg`);
    if (await pathExists(jpg)) await fs.unlink(jpg);
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE episode
assetsRouter.delete('/assets/:project/episode/:episode', async (req, res) => {
  try {
    const project = req.params.project as string;
    const episode = req.params.episode as string;
    assertPositiveIntId(episode, '集数');
    const dir = resolveProjectPath(project, `prompt/scene/${episode}`);
    if (!(await pathExists(dir))) throw Object.assign(new Error('集数不存在'), { code: 'NOT_FOUND' });
    await removeDirIfExists(dir);
    await removeDirIfExists(resolveProjectPath(project, `assert/scene/${episode}`));
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE shot + renumber
assetsRouter.delete('/assets/:project/shot/:episode/:shot', async (req, res) => {
  try {
    const project = req.params.project as string;
    const episode = req.params.episode as string;
    const shot = req.params.shot as string;
    assertPositiveIntId(episode, '集数');
    assertPositiveIntId(shot, '分镜');
    const dir = resolveProjectPath(project, `prompt/scene/${episode}/${shot}`);
    if (!(await pathExists(dir))) throw Object.assign(new Error('分镜不存在'), { code: 'NOT_FOUND' });
    await removeDirIfExists(dir);
    await removeDirIfExists(resolveProjectPath(project, `assert/scene/${episode}/${shot}`));
    const renames = await shiftShotsDownAfterDelete(project, episode, shot);
    res.json({ success: true, renames });
  } catch (err) {
    httpError(res, err);
  }
});

// POST reorder
assetsRouter.post('/assets/:project/scene/:episode/:shot/stage/reorder', async (req, res) => {
  try {
    const project = req.params.project as string;
    const episode = req.params.episode as string;
    const shot = req.params.shot as string;
    const { from, to } = req.body as { from?: number; to?: number };
    assertPositiveIntId(episode, '集数');
    assertPositiveIntId(shot, '分镜');
    if (typeof from !== 'number' || typeof to !== 'number') {
      throw Object.assign(new Error('from/to 必须是数字'), { code: 'INVALID' });
    }
    await reorderStageFrames(project, episode, shot, from, to);
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});
```

- [ ] **Step 2: typecheck + lint**

Run: `npm run typecheck:server`  
Run: `npx eslint server/src/assets server/src/routes/assets.ts server/src/index.ts`  
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/assets.ts
git commit -m "feat(server): 资产删除与场景帧 reorder API"
```

---

### Task 7: 前端 API 客户端

**Files:**
- Create: `frontend/src/api/assets.ts`

- [ ] **Step 1: 创建客户端**

```typescript
import client from './client'
import type { AxiosError } from 'axios'

export interface AssetRef {
  episode: string
  shot: string
  file: string
  detail?: string
}

export interface RenamePair {
  from: string
  to: string
}

export class AssetApiError extends Error {
  code?: string
  refs?: AssetRef[]
  constructor(message: string, code?: string, refs?: AssetRef[]) {
    super(message)
    this.code = code
    this.refs = refs
  }
}

function rethrow(err: unknown): never {
  const ax = err as AxiosError<{ error?: string; code?: string; refs?: AssetRef[] }>
  const data = ax.response?.data
  if (data?.error) {
    throw new AssetApiError(data.error, data.code, data.refs)
  }
  throw err
}

export async function createCharacter(
  project: string,
  body: { name: string; gender?: string; age?: string; personality?: string },
) {
  try {
    const { data } = await client.post(`/assets/${project}/character`, body)
    return data as { success: boolean; path: string }
  } catch (e) { rethrow(e) }
}

export async function createStage(project: string, body: { name: string }) {
  try {
    const { data } = await client.post(`/assets/${project}/stage`, body)
    return data as { success: boolean; path: string }
  } catch (e) { rethrow(e) }
}

export async function createSubscene(
  project: string,
  body: { stage: string; label: string; time?: string; angle?: string; weather?: string; description?: string },
) {
  try {
    const { data } = await client.post(`/assets/${project}/subscene`, body)
    return data as { success: boolean; path: string }
  } catch (e) { rethrow(e) }
}

export async function createEpisode(project: string, body: { episode?: string } = {}) {
  try {
    const { data } = await client.post(`/assets/${project}/episode`, body)
    return data as { success: boolean; path: string; episode: string }
  } catch (e) { rethrow(e) }
}

export async function createShot(
  project: string,
  body: { episode: string; shot?: string; position?: 'insert' | 'end' },
) {
  try {
    const { data } = await client.post(`/assets/${project}/shot`, body)
    return data as { success: boolean; path: string; episode: string; shot: string; renames: RenamePair[] }
  } catch (e) { rethrow(e) }
}

export async function deleteCharacter(project: string, name: string) {
  try {
    const { data } = await client.delete(`/assets/${project}/character/${encodeURIComponent(name)}`)
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function deleteStage(project: string, name: string) {
  try {
    const { data } = await client.delete(`/assets/${project}/stage/${encodeURIComponent(name)}`)
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function deleteSubscene(project: string, stage: string, label: string) {
  try {
    const { data } = await client.delete(
      `/assets/${project}/subscene/${encodeURIComponent(stage)}/${encodeURIComponent(label)}`,
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function deleteEpisode(project: string, episode: string) {
  try {
    const { data } = await client.delete(`/assets/${project}/episode/${encodeURIComponent(episode)}`)
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function deleteShot(project: string, episode: string, shot: string) {
  try {
    const { data } = await client.delete(
      `/assets/${project}/shot/${encodeURIComponent(episode)}/${encodeURIComponent(shot)}`,
    )
    return data as { success: boolean; renames: RenamePair[] }
  } catch (e) { rethrow(e) }
}

export async function reorderSceneStage(
  project: string,
  episode: string,
  shot: string,
  from: number,
  to: number,
) {
  try {
    const { data } = await client.post(
      `/assets/${project}/scene/${encodeURIComponent(episode)}/${encodeURIComponent(shot)}/stage/reorder`,
      { from, to },
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}
```

- [ ] **Step 2: typecheck frontend**

Run: `npm run typecheck:frontend`  
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/assets.ts
git commit -m "feat(frontend): 资产 CRUD API 客户端"
```

---

### Task 8: AssetCreateDialog

**Files:**
- Create: `frontend/src/components/AssetCreateDialog.vue`

- [ ] **Step 1: 实现创建弹窗**

```vue
<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>新增{{ typeLabel }}</v-card-title>
      <v-card-text>
        <v-alert
          v-if="error"
          type="error"
          density="compact"
          class="mb-3"
        >
          {{ error }}
        </v-alert>

        <template v-if="type === 'character'">
          <v-text-field v-model="form.name" label="角色名" required />
          <v-text-field v-model="form.gender" label="性别" />
          <v-text-field v-model="form.age" label="年龄" />
          <v-text-field v-model="form.personality" label="性格" />
        </template>

        <template v-else-if="type === 'stage'">
          <v-text-field v-model="form.name" label="场景名" required />
        </template>

        <template v-else-if="type === 'subscene'">
          <v-text-field v-model="form.stage" label="所属场景" required />
          <v-text-field v-model="form.label" label="完整标签" required hint="如 现代商场-白天-平视-晴-正门入口" persistent-hint />
          <v-text-field v-model="form.time" label="时间" />
          <v-text-field v-model="form.angle" label="角度" />
          <v-text-field v-model="form.weather" label="天气" />
          <v-textarea v-model="form.description" label="画面简述" rows="3" />
        </template>

        <template v-else-if="type === 'episode'">
          <v-text-field v-model="form.episode" label="集数编号（可空=自动）" />
        </template>

        <template v-else-if="type === 'shot'">
          <v-text-field v-model="form.episode" label="所属集数" required />
          <v-select
            v-model="form.insertMode"
            :items="[
              { title: '末尾新增', value: 'end' },
              { title: '插入到指定序号', value: 'insert' },
            ]"
            label="插入位置"
          />
          <v-text-field
            v-if="form.insertMode === 'insert'"
            v-model="form.shot"
            label="插入序号"
            required
          />
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="$emit('update:modelValue', false)">取消</v-btn>
        <v-btn color="primary" :loading="saving" @click="submit">创建</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  createCharacter,
  createEpisode,
  createShot,
  createStage,
  createSubscene,
  AssetApiError,
  type RenamePair,
} from '../api/assets'

export type CreateAssetType = 'character' | 'stage' | 'subscene' | 'episode' | 'shot'

const props = defineProps<{
  modelValue: boolean
  project: string
  type: CreateAssetType
  defaults?: Partial<{
    name: string
    stage: string
    episode: string
  }>
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  created: [payload: {
    type: CreateAssetType
    name?: string
    stage?: string
    label?: string
    episode?: string
    shot?: string
    renames?: RenamePair[]
  }]
}>()

const saving = ref(false)
const error = ref('')
const form = reactive({
  name: '',
  gender: '',
  age: '',
  personality: '',
  stage: '',
  label: '',
  time: '',
  angle: '',
  weather: '',
  description: '',
  episode: '',
  shot: '',
  insertMode: 'end' as 'end' | 'insert',
})

const typeLabel = computed(() => ({
  character: '角色',
  stage: '场景',
  subscene: '子场景',
  episode: '集数',
  shot: '分镜',
}[props.type]))

watch(() => props.modelValue, (open) => {
  if (!open) return
  error.value = ''
  form.name = props.defaults?.name ?? ''
  form.gender = ''
  form.age = ''
  form.personality = ''
  form.stage = props.defaults?.stage ?? ''
  form.label = ''
  form.time = ''
  form.angle = ''
  form.weather = ''
  form.description = ''
  form.episode = props.defaults?.episode ?? ''
  form.shot = ''
  form.insertMode = 'end'
})

async function submit() {
  saving.value = true
  error.value = ''
  try {
    if (props.type === 'character') {
      await createCharacter(props.project, {
        name: form.name.trim(),
        gender: form.gender,
        age: form.age,
        personality: form.personality,
      })
      emit('created', { type: 'character', name: form.name.trim() })
    } else if (props.type === 'stage') {
      await createStage(props.project, { name: form.name.trim() })
      emit('created', { type: 'stage', name: form.name.trim() })
    } else if (props.type === 'subscene') {
      await createSubscene(props.project, {
        stage: form.stage.trim(),
        label: form.label.trim(),
        time: form.time,
        angle: form.angle,
        weather: form.weather,
        description: form.description,
      })
      emit('created', { type: 'subscene', stage: form.stage.trim(), label: form.label.trim() })
    } else if (props.type === 'episode') {
      const r = await createEpisode(props.project, {
        episode: form.episode.trim() || undefined,
      })
      emit('created', { type: 'episode', episode: r.episode })
    } else {
      const r = await createShot(props.project, {
        episode: form.episode.trim(),
        shot: form.insertMode === 'insert' ? form.shot.trim() : undefined,
        position: form.insertMode,
      })
      emit('created', {
        type: 'shot',
        episode: r.episode,
        shot: r.shot,
        renames: r.renames,
      })
    }
    emit('update:modelValue', false)
  } catch (e) {
    error.value = e instanceof AssetApiError ? e.message : '创建失败'
  } finally {
    saving.value = false
  }
}
</script>
```

- [ ] **Step 2: typecheck frontend**

Run: `npm run typecheck:frontend`  
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AssetCreateDialog.vue
git commit -m "feat(frontend): 资产创建弹窗"
```

---

### Task 9: AssetTree — 排序 + 增删

**Files:**
- Modify: `frontend/src/components/AssetTree.vue`
- Modify: `frontend/src/views/ProjectView.vue`（接收 refresh / 路由）

- [ ] **Step 1: 重写 `AssetTree.vue` 核心逻辑**

要点（完整文件实现时按此清单）：

1. `TreeItem` 扩展：`kind: 'root-character' | 'character' | 'root-stage' | 'stage' | 'subscene' | 'root-scene' | 'episode' | 'shot'`，以及 `stageName?`, `label?`
2. 构建树时：
   - 角色/场景：`sort((a,b) => a.name.localeCompare(b.name, 'zh'))`
   - 集数/分镜：`sort((a,b) => Number(a) - Number(b))`
   - 每个场景节点：`readFs(prompt/stage/{name}/)` 收集 `.md` 为子场景 children
3. `#append` 插槽：根据 `item.kind` 显示 `+` / 删除图标按钮；`@click.stop`
4. 创建：打开 `AssetCreateDialog`，`defaults` 预填 stage/episode
5. 删除：`v-dialog` 确认 → 调 delete API → `IN_USE` 展示 refs 文本
6. `emit('refresh')` 与 `emit('navigate', queryPatch)` / 直接 `router.push`
7. 删除/插入分镜后：若有 `renames`，把当前 `route.query.shot` 按映射更新

`onSelect`：仅 `character` / `stage` / `scene(shot)` 更新 query（子场景可选：`type=stage&name=场景&subscene=label`，StagePanel 暂可不读 subscene，允许后续增强）。

删除确认与错误展示可用组件内 `confirmDialog` / `errorDialog` ref。

关键排序代码片段：

```typescript
function sortByNameZh<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

function sortNumericNames(names: string[]): string[] {
  return [...names].sort((a, b) => Number(a) - Number(b))
}
```

分镜 children：

```typescript
const shotNames = sortNumericNames(shots.entries.filter(e => e.type === 'dir').map(e => e.name))
children: shotNames.map(sh => ({
  name: `分镜${sh}`,
  path: `scene-${ep.name}-${sh}`,
  icon: 'mdi-image-multiple',
  type: 'scene',
  kind: 'shot',
  episode: ep.name,
  shot: sh,
}))
```

- [ ] **Step 2: `ProjectView.vue` 让 AssetTree 可刷新**

```vue
<AssetTree
  :key="treeKey"
  :project="project"
  @refresh="refreshTree"
/>
```

若导航逻辑全在 Tree 内用 router，可不改其它。

- [ ] **Step 3: typecheck + lint**

Run: `npm run typecheck:frontend`  
Run: `npx eslint frontend/src/components/AssetTree.vue frontend/src/views/ProjectView.vue`  
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AssetTree.vue frontend/src/views/ProjectView.vue
git commit -m "feat(frontend): 资产树增删与数字排序"
```

---

### Task 10: ScenePanel 场景帧上下移

**Files:**
- Modify: `frontend/src/components/ScenePanel.vue`

- [ ] **Step 1: 在场景卡片标题栏加入上下移**

在 `v-card-title` 区域改为 flex：

```vue
<v-card-title class="text-subtitle-1 d-flex align-center">
  <span>场景{{ i }}</span>
  <v-spacer />
  <v-btn
    icon="mdi-arrow-up"
    size="x-small"
    variant="text"
    :disabled="i === 0 || reordering"
    @click="moveStage(i, i - 1)"
  />
  <v-btn
    icon="mdi-arrow-down"
    size="x-small"
    variant="text"
    :disabled="i === stageDefs.length - 1 || reordering"
    @click="moveStage(i, i + 1)"
  />
</v-card-title>
```

- [ ] **Step 2: script 增加 reorder**

```typescript
import { reorderSceneStage, AssetApiError } from '../api/assets'

const reordering = ref(false)

async function moveStage(from: number, to: number) {
  if (reordering.value) return
  reordering.value = true
  try {
    await reorderSceneStage(props.project, props.episode, props.shot, from, to)
    await load()
  } catch (e) {
    alert(e instanceof AssetApiError ? e.message : '调整顺序失败')
  } finally {
    reordering.value = false
  }
}
```

- [ ] **Step 3: typecheck + lint**

Run: `npm run typecheck`  
Run: `npm run lint`  
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ScenePanel.vue
git commit -m "feat(frontend): 分镜场景图上下移"
```

---

### Task 11: 端到端验收

- [ ] **Step 1: 启动 dev**

Run: `npm run dev`  
打开项目详情页。

- [ ] **Step 2: 验收清单**

1. 分镜树顺序为 1,2,3…10,11,12（非 1,10,11,2）
2. 新增角色 → 树出现 → 可打开面板
3. 删除未被引用角色成功；删除被引用角色显示 refs
4. 新增场景 + 子场景；删除被引用子场景失败
5. 新增集数、末尾分镜、中间插入分镜 → 后续编号 +1，assert 若存在则同步
6. 删除中间分镜 → 后续 -1
7. 场景图片 ↑↓ → JSON 与 jpg 序号一致
8. `npm run typecheck` && `npm run lint` 通过

- [ ] **Step 3: 清理测试资产**（若在真实 design 项目中创建了「测试角色甲」等，删除之）

- [ ] **Step 4: 最终 commit（若有验收中的小修）**

```bash
git add -A
git status
# 仅提交相关修复
git commit -m "fix: 资产增删验收问题修复"
```

---

## Spec 覆盖自检

| Spec 要求 | 任务 |
|-----------|------|
| 创建 character/stage/subscene/episode/shot | Task 5, 8, 9 |
| 删除 + IN_USE 引用检查 | Task 3, 6, 9 |
| 分镜删除/插入大范围 rename | Task 4, 5, 6 |
| stage reorder + jpg | Task 4, 6, 10 |
| 分镜数字升序 | Task 9 |
| 模板对齐 create-video-script | Task 2, 5 |
| 错误码 EXISTS/IN_USE/… | Task 1, 5, 6, 7 |
| typecheck/lint | Task 10–11 |

## 类型一致性

- `RenamePair`: `{ from: string; to: string }` — 服务端与 `frontend/src/api/assets.ts` 一致
- `AssetRef`: episode/shot/file/detail — refs.ts 与客户端一致
- 创建 shot 响应：`{ success, path, episode, shot, renames }`
- reorder body：`{ from: number; to: number }`（0-based）
