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

  // 同步 history/{index} 目录顺序
  const historyRoot = path.join(stageDir, 'history');
  if (await pathExists(historyRoot)) {
    const histTmp = `.reorder-tmp-${Date.now()}`;
    for (let i = 0; i < n; i++) {
      const src = path.join(historyRoot, String(i));
      if (await pathExists(src)) {
        await fs.rename(src, path.join(historyRoot, `${i}${histTmp}`));
      }
    }
    for (let newIndex = 0; newIndex < n; newIndex++) {
      const oldIndex = mapping[newIndex];
      const tmp = path.join(historyRoot, `${oldIndex}${histTmp}`);
      if (await pathExists(tmp)) {
        await fs.rename(tmp, path.join(historyRoot, String(newIndex)));
      }
    }
  }
}
