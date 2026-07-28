import fs from 'fs/promises';
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
