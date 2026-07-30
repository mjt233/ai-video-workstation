/**
 * 衍生变体（variant）资产读写。
 *
 * 目录约定（不出现在资产浏览器树中）：
 * - 角色：prompt/character/{name}/variants/{variantId}.json
 *         assert/character/{name}/variants/{variantId}.jpg
 * - 场景：prompt/stage/{stage}/{baseLabel 的 variants 子目录}/...
 *         prompt/stage/{stage}/variants/{baseLabel}/{variantId}.json
 *         assert/stage/{stage}/variants/{baseLabel}/{variantId}.jpg
 *
 * meta JSON：
 * {
 *   "id": "门已打开",
 *   "desc": "图像1基础上，将正门改为打开状态……",
 *   "parentId": "上一版",              // 可选，父变体 ID
 *   "refs": ["assert/xxx/yyy.jpg"],    // 可选，额外引用资产路径
 *   "baseImage": "assert/stage/现代商场/xxx.jpg",  // 可选，默认基础图
 *   "createdAt": "ISO"
 * }
 */

import fs from 'fs/promises';
import path from 'path';
import {
  assertSafeName,
  ensureDir,
  pathExists,
  resolveProjectPath,
} from './paths.js';

export type VariantKind = 'character' | 'stage';

export interface VariantMeta {
  id: string;
  desc: string;
  /** 父变体 ID，可选。顶级变体无此字段。 */
  parentId?: string;
  /** 额外引用资产路径数组，保持用户选择的顺序 */
  refs: string[];
  baseImage?: string;
  createdAt?: string;
  updatedAt?: string;
}

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

function characterMetaRel(name: string, variantId: string): string {
  return `prompt/character/${name}/variants/${variantId}.json`;
}

function characterImageRel(name: string, variantId: string): string {
  return `assert/character/${name}/variants/${variantId}.jpg`;
}

function stageMetaRel(stage: string, baseLabel: string, variantId: string): string {
  return `prompt/stage/${stage}/variants/${baseLabel}/${variantId}.json`;
}

function stageImageRel(stage: string, baseLabel: string, variantId: string): string {
  return `assert/stage/${stage}/variants/${baseLabel}/${variantId}.jpg`;
}

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

/** 检查 parentId 是否构成循环引用（追踪到根无环则返回 false） */
async function checkCircularParent(
  project: string,
  metaRel: string,
  parentId: string,
): Promise<boolean> {
  let current = parentId;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current)) return true;
    visited.add(current);
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

/** 递归收集指定变体的所有后代变体 ID */
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

async function writeMeta(project: string, metaRel: string, meta: VariantMeta): Promise<void> {
  const full = resolveProjectPath(project, metaRel);
  await ensureDir(path.dirname(full));
  await fs.writeFile(full, `${JSON.stringify(meta, null, 2)}\n`, 'utf-8');
}

export async function listCharacterVariants(project: string, name: string): Promise<VariantInfo[]> {
  assertSafeName(name, '角色名');
  const dirRel = `prompt/character/${name}/variants`;
  const dir = resolveProjectPath(project, dirRel);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const result: VariantInfo[] = [];
  for (const f of files) {
    const variantId = f.slice(0, -'.json'.length);
    const metaPath = characterMetaRel(name, variantId);
    const meta = await readMeta(project, metaPath);
    if (!meta) continue;
    const imagePath = characterImageRel(name, variantId);
    const hasImage = await pathExists(resolveProjectPath(project, imagePath));
    result.push({
      ...meta,
      id: meta.id || variantId,
      kind: 'character',
      owner: name,
      metaPath,
      imagePath,
      hasImage,
      ref: `${name}@${variantId}`,
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id, 'zh'));
}

export async function listStageVariants(
  project: string,
  stage: string,
  baseLabel: string,
): Promise<VariantInfo[]> {
  assertSafeName(stage, '场景名');
  assertSafeName(baseLabel, '子场景标签');
  const dirRel = `prompt/stage/${stage}/variants/${baseLabel}`;
  const dir = resolveProjectPath(project, dirRel);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const result: VariantInfo[] = [];
  for (const f of files) {
    const variantId = f.slice(0, -'.json'.length);
    const metaPath = stageMetaRel(stage, baseLabel, variantId);
    const meta = await readMeta(project, metaPath);
    if (!meta) continue;
    const imagePath = stageImageRel(stage, baseLabel, variantId);
    const hasImage = await pathExists(resolveProjectPath(project, imagePath));
    result.push({
      ...meta,
      id: meta.id || variantId,
      kind: 'stage',
      owner: stage,
      baseLabel,
      metaPath,
      imagePath,
      hasImage,
      ref: `${stage}/${baseLabel}@${variantId}`,
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id, 'zh'));
}

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
  const parentId = body.parentId ? body.parentId.trim() : undefined;
  const refs = (Array.isArray(body.refs) ? body.refs.map(String) : []).filter(r => r.trim().length > 0);
  const charDir = resolveProjectPath(project, `prompt/character/${name}`);
  if (!(await pathExists(charDir))) {
    throw Object.assign(new Error('角色不存在'), { code: 'NOT_FOUND' });
  }
  // 先检查自身是否已存在
  const metaPath = characterMetaRel(name, id);
  if (await pathExists(resolveProjectPath(project, metaPath))) {
    throw Object.assign(new Error('衍生变体已存在'), { code: 'EXISTS' });
  }
  // 验证 parentId 存在
  if (parentId) {
    if (parentId === id) {
      throw Object.assign(new Error('不能将自身设为父变体'), { code: 'INVALID' });
    }
    const parentMetaPath = characterMetaRel(name, parentId);
    if (!(await pathExists(resolveProjectPath(project, parentMetaPath)))) {
      throw Object.assign(new Error('父变体不存在'), { code: 'NOT_FOUND' });
    }
    if (await checkCircularParent(project, parentMetaPath, parentId)) {
      throw Object.assign(new Error('父变体形成循环引用'), { code: 'INVALID' });
    }
  }
  // 验证 refs 路径合法性
  for (const r of refs) {
    if (!r.startsWith('assert/')) {
      throw Object.assign(new Error(`引用路径必须以 assert/ 开头: ${r}`), { code: 'INVALID' });
    }
  }
  const now = new Date().toISOString();
  const meta: VariantMeta = {
    id,
    desc,
    parentId,
    refs,
    baseImage: parentId
      ? undefined
      : `assert/character/${name}/appearance.jpg`,
    createdAt: now,
    updatedAt: now,
  };
  // 若有 parentId，从父变体继承 baseImage
  if (parentId) {
    const parentMeta = await readMeta(project, characterMetaRel(name, parentId));
    if (parentMeta?.baseImage) {
      meta.baseImage = parentMeta.baseImage;
    }
  }
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

export async function createStageVariant(
  project: string,
  stage: string,
  baseLabel: string,
  body: { id: string; desc: string; parentId?: string; refs?: string[] },
): Promise<VariantInfo> {
  assertSafeName(stage, '场景名');
  assertSafeName(baseLabel, '子场景标签');
  const id = (body.id ?? '').trim();
  assertSafeName(id, '变体名称');
  const desc = (body.desc ?? '').trim();
  if (!desc) {
    throw Object.assign(new Error('衍生描述必填'), { code: 'INVALID' });
  }
  const parentId = body.parentId ? body.parentId.trim() : undefined;
  const refs = (Array.isArray(body.refs) ? body.refs.map(String) : []).filter(r => r.trim().length > 0);
  const baseMd = resolveProjectPath(project, `prompt/stage/${stage}/${baseLabel}.md`);
  if (!(await pathExists(baseMd))) {
    throw Object.assign(new Error('子场景不存在'), { code: 'NOT_FOUND' });
  }
  // 先检查自身是否已存在
  const metaPath = stageMetaRel(stage, baseLabel, id);
  if (await pathExists(resolveProjectPath(project, metaPath))) {
    throw Object.assign(new Error('衍生变体已存在'), { code: 'EXISTS' });
  }
  // 验证 parentId 存在
  if (parentId) {
    if (parentId === id) {
      throw Object.assign(new Error('不能将自身设为父变体'), { code: 'INVALID' });
    }
    const parentMetaPath = stageMetaRel(stage, baseLabel, parentId);
    if (!(await pathExists(resolveProjectPath(project, parentMetaPath)))) {
      throw Object.assign(new Error('父变体不存在'), { code: 'NOT_FOUND' });
    }
    if (await checkCircularParent(project, parentMetaPath, parentId)) {
      throw Object.assign(new Error('父变体形成循环引用'), { code: 'INVALID' });
    }
  }
  // 验证 refs 路径合法性
  for (const r of refs) {
    if (!r.startsWith('assert/')) {
      throw Object.assign(new Error(`引用路径必须以 assert/ 开头: ${r}`), { code: 'INVALID' });
    }
  }
  const now = new Date().toISOString();
  const meta: VariantMeta = {
    id,
    desc,
    parentId,
    refs,
    baseImage: parentId
      ? undefined
      : `assert/stage/${stage}/${baseLabel}.jpg`,
    createdAt: now,
    updatedAt: now,
  };
  // 若有 parentId，从父变体继承 baseImage
  if (parentId) {
    const parentMeta = await readMeta(project, stageMetaRel(stage, baseLabel, parentId));
    if (parentMeta?.baseImage) {
      meta.baseImage = parentMeta.baseImage;
    }
  }
  await writeMeta(project, metaPath, meta);
  const imagePath = stageImageRel(stage, baseLabel, id);
  return {
    ...meta,
    kind: 'stage',
    owner: stage,
    baseLabel,
    metaPath,
    imagePath,
    hasImage: false,
    ref: `${stage}/${baseLabel}@${id}`,
  };
}

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
  if (body.parentId !== undefined) {
    const parentId = body.parentId ? body.parentId.trim() : undefined;
    if (parentId) {
      // 不能将自己设为父变体
      if (parentId === variantId) {
        throw Object.assign(new Error('不能将自己设为父变体'), { code: 'INVALID' });
      }
      const parentMetaPath = characterMetaRel(name, parentId);
      if (!(await pathExists(resolveProjectPath(project, parentMetaPath)))) {
        throw Object.assign(new Error('父变体不存在'), { code: 'NOT_FOUND' });
      }
      if (await checkCircularParent(project, parentMetaPath, parentId)) {
        throw Object.assign(new Error('父变体形成循环引用'), { code: 'INVALID' });
      }
      // 重新派生 baseImage
      const parentMeta = await readMeta(project, characterMetaRel(name, parentId));
      if (parentMeta?.baseImage) {
        existing.baseImage = parentMeta.baseImage;
      }
    } else {
      // 移除 parentId，恢复默认 baseImage
      existing.baseImage = `assert/character/${name}/appearance.jpg`;
    }
    existing.parentId = parentId || undefined;
  }
  if (body.refs !== undefined) {
    const refs = (Array.isArray(body.refs) ? body.refs.map(String) : []).filter(r => r.trim().length > 0);
    for (const r of refs) {
      if (!r.startsWith('assert/')) {
        throw Object.assign(new Error(`引用路径必须以 assert/ 开头: ${r}`), { code: 'INVALID' });
      }
    }
    existing.refs = refs;
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

export async function updateStageVariant(
  project: string,
  stage: string,
  baseLabel: string,
  variantId: string,
  body: { desc?: string; parentId?: string; refs?: string[] },
): Promise<VariantInfo> {
  assertSafeName(stage, '场景名');
  assertSafeName(baseLabel, '子场景标签');
  assertSafeName(variantId, '变体名称');
  const metaPath = stageMetaRel(stage, baseLabel, variantId);
  const existing = await readMeta(project, metaPath);
  if (!existing) {
    throw Object.assign(new Error('衍生变体不存在'), { code: 'NOT_FOUND' });
  }
  if (body.desc !== undefined) {
    const desc = body.desc.trim();
    if (!desc) throw Object.assign(new Error('衍生描述不能为空'), { code: 'INVALID' });
    existing.desc = desc;
  }
  if (body.parentId !== undefined) {
    const parentId = body.parentId ? body.parentId.trim() : undefined;
    if (parentId) {
      if (parentId === variantId) {
        throw Object.assign(new Error('不能将自己设为父变体'), { code: 'INVALID' });
      }
      const parentMetaPath = stageMetaRel(stage, baseLabel, parentId);
      if (!(await pathExists(resolveProjectPath(project, parentMetaPath)))) {
        throw Object.assign(new Error('父变体不存在'), { code: 'NOT_FOUND' });
      }
      if (await checkCircularParent(project, parentMetaPath, parentId)) {
        throw Object.assign(new Error('父变体形成循环引用'), { code: 'INVALID' });
      }
      const parentMeta = await readMeta(project, stageMetaRel(stage, baseLabel, parentId));
      if (parentMeta?.baseImage) {
        existing.baseImage = parentMeta.baseImage;
      }
    } else {
      existing.baseImage = `assert/stage/${stage}/${baseLabel}.jpg`;
    }
    existing.parentId = parentId || undefined;
  }
  if (body.refs !== undefined) {
    const refs = (Array.isArray(body.refs) ? body.refs.map(String) : []).filter(r => r.trim().length > 0);
    for (const r of refs) {
      if (!r.startsWith('assert/')) {
        throw Object.assign(new Error(`引用路径必须以 assert/ 开头: ${r}`), { code: 'INVALID' });
      }
    }
    existing.refs = refs;
  }
  existing.updatedAt = new Date().toISOString();
  await writeMeta(project, metaPath, existing);
  const imagePath = stageImageRel(stage, baseLabel, variantId);
  const hasImage = await pathExists(resolveProjectPath(project, imagePath));
  return {
    ...existing,
    kind: 'stage',
    owner: stage,
    baseLabel,
    metaPath,
    imagePath,
    hasImage,
    ref: `${stage}/${baseLabel}@${variantId}`,
  };
}

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
  const childIds = await collectChildIds(project, metaPath, variantId);
  if (options?.cascade) {
    // 级联删除所有后代
    for (const cid of childIds) {
      const cMetaPath = characterMetaRel(name, cid);
      const cMetaFull = resolveProjectPath(project, cMetaPath);
      if (await pathExists(cMetaFull)) {
        await fs.unlink(cMetaFull);
      }
      const cImagePath = characterImageRel(name, cid);
      const cImageFull = resolveProjectPath(project, cImagePath);
      if (await pathExists(cImageFull)) {
        await fs.unlink(cImageFull);
      }
      const cHistDir = resolveProjectPath(project, `assert/character/${name}/variants/history/${cid}`);
      if (await pathExists(cHistDir)) {
        await fs.rm(cHistDir, { recursive: true, force: true });
      }
    }
  } else if (childIds.length > 0) {
    // 提升所有子变体为顶级，重置 baseImage
    for (const cid of childIds) {
      const cMetaPath = characterMetaRel(name, cid);
      const childMeta = await readMeta(project, cMetaPath);
      if (childMeta) {
        childMeta.parentId = undefined;
        childMeta.baseImage = `assert/character/${name}/appearance.jpg`;
        childMeta.updatedAt = new Date().toISOString();
        await writeMeta(project, cMetaPath, childMeta);
      }
    }
  }
  await fs.unlink(metaFull);
  const imagePath = characterImageRel(name, variantId);
  const imageFull = resolveProjectPath(project, imagePath);
  if (await pathExists(imageFull)) {
    await fs.unlink(imageFull);
  }
  // 清理空 history 目录（若有）
  const histDir = resolveProjectPath(project, `assert/character/${name}/variants/history/${variantId}`);
  if (await pathExists(histDir)) {
    await fs.rm(histDir, { recursive: true, force: true });
  }
}

export async function deleteStageVariant(
  project: string,
  stage: string,
  baseLabel: string,
  variantId: string,
  options?: { cascade?: boolean },
): Promise<void> {
  assertSafeName(stage, '场景名');
  assertSafeName(baseLabel, '子场景标签');
  assertSafeName(variantId, '变体名称');
  const metaPath = stageMetaRel(stage, baseLabel, variantId);
  const metaFull = resolveProjectPath(project, metaPath);
  if (!(await pathExists(metaFull))) {
    throw Object.assign(new Error('衍生变体不存在'), { code: 'NOT_FOUND' });
  }
  const childIds = await collectChildIds(project, metaPath, variantId);
  if (options?.cascade) {
    for (const cid of childIds) {
      const cMetaPath = stageMetaRel(stage, baseLabel, cid);
      const cMetaFull = resolveProjectPath(project, cMetaPath);
      if (await pathExists(cMetaFull)) {
        await fs.unlink(cMetaFull);
      }
      const cImagePath = stageImageRel(stage, baseLabel, cid);
      const cImageFull = resolveProjectPath(project, cImagePath);
      if (await pathExists(cImageFull)) {
        await fs.unlink(cImageFull);
      }
      const cHistDir = resolveProjectPath(
        project,
        `assert/stage/${stage}/variants/${baseLabel}/history/${cid}`,
      );
      if (await pathExists(cHistDir)) {
        await fs.rm(cHistDir, { recursive: true, force: true });
      }
    }
  } else if (childIds.length > 0) {
    for (const cid of childIds) {
      const cMetaPath = stageMetaRel(stage, baseLabel, cid);
      const childMeta = await readMeta(project, cMetaPath);
      if (childMeta) {
        childMeta.parentId = undefined;
        childMeta.baseImage = `assert/stage/${stage}/${baseLabel}.jpg`;
        childMeta.updatedAt = new Date().toISOString();
        await writeMeta(project, cMetaPath, childMeta);
      }
    }
  }
  await fs.unlink(metaFull);
  const imagePath = stageImageRel(stage, baseLabel, variantId);
  const imageFull = resolveProjectPath(project, imagePath);
  if (await pathExists(imageFull)) {
    await fs.unlink(imageFull);
  }
  const histDir = resolveProjectPath(
    project,
    `assert/stage/${stage}/variants/${baseLabel}/history/${variantId}`,
  );
  if (await pathExists(histDir)) {
    await fs.rm(histDir, { recursive: true, force: true });
  }
}
