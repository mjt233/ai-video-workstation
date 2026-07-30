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

function characterRefMatches(ref: string, name: string): boolean {
  const trimmed = (ref ?? '').trim();
  if (!trimmed) return false;
  if (trimmed === name) return true;
  // 角色名@变体id
  return trimmed.startsWith(`${name}@`);
}

export async function findCharacterRefs(project: string, name: string): Promise<AssetRef[]> {
  const refs: AssetRef[] = [];
  for (const { episode, shot, dir } of await walkShots(project)) {
    const stages = await readJsonArray<StageEntry>(path.join(dir, 'stage.json'));
    if (stages) {
      for (const s of stages) {
        if ((s.登场角色 ?? []).some((c) => characterRefMatches(c, name))) {
          refs.push({ episode, shot, file: 'stage.json', detail: '登场角色' });
          break;
        }
      }
    }
    const scripts = await readJsonArray<ScriptEntry>(path.join(dir, 'script.json'));
    if (scripts?.some(s => s.角色名 === name || characterRefMatches(String(s.角色名 ?? ''), name))) {
      refs.push({ episode, shot, file: 'script.json', detail: '角色名' });
    }
  }
  return refs;
}

function stageRefMatchesStage(ref: string, stageName: string): boolean {
  const trimmed = (ref ?? '').trim();
  if (!trimmed) return false;
  if (trimmed === stageName) return true;
  // 场景名/标签 或 场景名/标签@变体
  return trimmed.startsWith(`${stageName}/`);
}

function stageRefMatchesSubscene(ref: string, stageName: string, label: string): boolean {
  const trimmed = (ref ?? '').trim();
  if (!trimmed) return false;
  const full = `${stageName}/${label}`;
  if (trimmed === full) return true;
  // 场景名/标签@变体id
  return trimmed.startsWith(`${full}@`);
}

export async function findStageRefs(project: string, stageName: string): Promise<AssetRef[]> {
  const refs: AssetRef[] = [];
  for (const { episode, shot, dir } of await walkShots(project)) {
    const stages = await readJsonArray<StageEntry>(path.join(dir, 'stage.json'));
    if (!stages) continue;
    if (stages.some(s => stageRefMatchesStage(s.基础场景 ?? '', stageName))) {
      refs.push({ episode, shot, file: 'stage.json', detail: '基础场景' });
    }
  }
  return refs;
}

export async function findSubsceneRefs(project: string, stageName: string, label: string): Promise<AssetRef[]> {
  const refs: AssetRef[] = [];
  for (const { episode, shot, dir } of await walkShots(project)) {
    const stages = await readJsonArray<StageEntry>(path.join(dir, 'stage.json'));
    if (!stages) continue;
    if (stages.some(s => stageRefMatchesSubscene(s.基础场景 ?? '', stageName, label))) {
      refs.push({ episode, shot, file: 'stage.json', detail: '基础场景' });
    }
  }
  return refs;
}

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
      if ((s.登场角色 ?? []).some((c) => c.trim() === searchRef)) {
        refs.push({ episode, shot, file: 'stage.json', detail: `登场角色[${i}]` });
      }
    }
  }
  return refs;
}

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

/** 将分镜中所有旧变体引用替换为新引用 */
export async function replaceVariantRefInFrames(
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
