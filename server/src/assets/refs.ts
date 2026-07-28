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
