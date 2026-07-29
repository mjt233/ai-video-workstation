import fs from 'fs/promises';
import path from 'path';
import { pathExists, resolveProjectPath } from './paths.js';

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * 删除分镜台词，并同步删除/重命名对应的语音文件。
 *
 * 删除第 index 条后，后续条目前移：
 *   `{i+1}-{char}.flac` → `{i}-{char}.flac`
 */
export async function deleteScriptEntry(
  project: string,
  episode: string,
  shot: string,
  index: number,
): Promise<void> {
  const jsonPath = resolveProjectPath(project, `prompt/scene/${episode}/${shot}/script.json`);
  let data: unknown;
  try {
    data = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
  } catch {
    throw Object.assign(new Error('script.json 不存在或无效'), { code: 'NOT_FOUND' });
  }
  if (!Array.isArray(data)) {
    throw Object.assign(new Error('script.json 必须是数组'), { code: 'INVALID' });
  }
  const n = data.length;
  if (!Number.isInteger(index) || index < 0 || index >= n) {
    throw Object.assign(new Error('索引越界'), { code: 'CONFLICT' });
  }

  // 保存被删除条目的角色名（用于删除语音文件）
  const removedEntry = data[index] as { 角色名?: string } | undefined;
  const removedChar = removedEntry?.角色名 ?? '';

  data.splice(index, 1);
  await fs.writeFile(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');

  // ── 同步语音文件 ──
  const vDir = resolveProjectPath(project, `assert/scene/${episode}/${shot}/voice`);
  if (!(await pathExists(vDir))) return;

  // 删除被移除条目的语音文件及历史版本
  if (removedChar) {
    const removedPath = path.join(vDir, `${index}-${removedChar}.flac`);
    if (await pathExists(removedPath)) {
      await fs.unlink(removedPath);
    }
    const histDir = path.join(vDir, 'history', `${index}-${removedChar}`);
    if (await pathExists(histDir)) {
      await fs.rm(histDir, { recursive: true, force: true });
    }
  }

  // 将 index+1..n-1 的语音文件前移
  for (let i = index + 1; i < n; i++) {
    const char = (data[i - 1] as { 角色名?: string })?.角色名 ?? '';
    if (!char) continue;
    const src = path.join(vDir, `${i}-${char}.flac`);
    const dest = path.join(vDir, `${i - 1}-${char}.flac`);
    if (await pathExists(src)) {
      await fs.rename(src, dest);
    }
  }
}

/**
 * 更新分镜台词条目。若角色名变更，删除原角色对应的语音文件。
 */
export async function updateScriptEntry(
  project: string,
  episode: string,
  shot: string,
  index: number,
  entry: { 角色名: string; 台词: string; 情绪: string },
): Promise<void> {
  const jsonPath = resolveProjectPath(project, `prompt/scene/${episode}/${shot}/script.json`);
  let data: unknown;
  try {
    data = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
  } catch {
    throw Object.assign(new Error('script.json 不存在或无效'), { code: 'NOT_FOUND' });
  }
  if (!Array.isArray(data)) {
    throw Object.assign(new Error('script.json 必须是数组'), { code: 'INVALID' });
  }
  if (!Number.isInteger(index) || index < 0 || index >= data.length) {
    throw Object.assign(new Error('索引越界'), { code: 'CONFLICT' });
  }

  const oldEntry = data[index] as { 角色名?: string } | undefined;
  const oldChar = oldEntry?.角色名 ?? '';
  const newChar = entry.角色名 ?? '';

  // 角色名变更 → 删除原语音文件及历史版本
  if (oldChar && oldChar !== newChar) {
    const vDir = resolveProjectPath(project, `assert/scene/${episode}/${shot}/voice`);
    if (await pathExists(vDir)) {
      const oldPath = path.join(vDir, `${index}-${oldChar}.flac`);
      if (await pathExists(oldPath)) {
        await fs.unlink(oldPath);
      }
      // 删除历史目录
      const histDir = path.join(vDir, 'history', `${index}-${oldChar}`);
      if (await pathExists(histDir)) {
        await fs.rm(histDir, { recursive: true, force: true });
      }
    }
  }

  data[index] = entry;
  await fs.writeFile(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * 重新排序分镜台词，并同步重命名对应的语音文件。
 */
export async function reorderScriptEntries(
  project: string,
  episode: string,
  shot: string,
  from: number,
  to: number,
): Promise<void> {
  const jsonPath = resolveProjectPath(project, `prompt/scene/${episode}/${shot}/script.json`);
  let data: unknown;
  try {
    data = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
  } catch {
    throw Object.assign(new Error('script.json 不存在或无效'), { code: 'NOT_FOUND' });
  }
  if (!Array.isArray(data)) {
    throw Object.assign(new Error('script.json 必须是数组'), { code: 'INVALID' });
  }
  const n = data.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n) {
    throw Object.assign(new Error('索引越界'), { code: 'CONFLICT' });
  }
  if (from === to) return;

  /** 原始角色名：origChars[oldIndex] */
  const origChars: string[] = data.map((e: { 角色名?: string }) => e.角色名 ?? '');

  const reordered = moveItem(data, from, to);
  await fs.writeFile(jsonPath, JSON.stringify(reordered, null, 2) + '\n', 'utf-8');

  // ── 同步语音文件 ──
  const voiceDir = resolveProjectPath(project, `assert/scene/${episode}/${shot}/voice`);
  if (!(await pathExists(voiceDir))) return;

  // mapping[newIndex] = oldIndex
  const mapping = moveItem([...Array(n).keys()], from, to);

  const tmpSuffix = `.reorder-tmp-${Date.now()}`;

  // 1) 全部语音文件改临时名（保留旧索引信息）
  for (let i = 0; i < n; i++) {
    const char = origChars[i];
    if (!char) continue;
    const src = path.join(voiceDir, `${i}-${char}.flac`);
    if (await pathExists(src)) {
      await fs.rename(src, path.join(voiceDir, `${i}${tmpSuffix}.flac`));
    }
  }

  // 2) 同步历史目录：voice/history/{i}-{char}/
  const historyRoot = path.join(voiceDir, 'history');
  if (await pathExists(historyRoot)) {
    for (let i = 0; i < n; i++) {
      const char = origChars[i];
      if (!char) continue;
      const src = path.join(historyRoot, `${i}-${char}`);
      if (await pathExists(src)) {
        await fs.rename(src, path.join(historyRoot, `${i}${tmpSuffix}`));
      }
    }
  }

  // 3) 临时名 → 最终名（新索引 + 新角色名）
  for (let newIndex = 0; newIndex < n; newIndex++) {
    const oldIndex = mapping[newIndex];
    const tmp = path.join(voiceDir, `${oldIndex}${tmpSuffix}.flac`);
    if (await pathExists(tmp)) {
      const newChar = (reordered[newIndex] as { 角色名?: string }).角色名 ?? '';
      await fs.rename(tmp, path.join(voiceDir, `${newIndex}-${newChar}.flac`));
    }
  }

  // 4) 历史临时目录 → 最终名
  if (await pathExists(historyRoot)) {
    for (let newIndex = 0; newIndex < n; newIndex++) {
      const oldIndex = mapping[newIndex];
      const tmp = path.join(historyRoot, `${oldIndex}${tmpSuffix}`);
      if (await pathExists(tmp)) {
        const newChar = (reordered[newIndex] as { 角色名?: string }).角色名 ?? '';
        await fs.rename(tmp, path.join(historyRoot, `${newIndex}-${newChar}`));
      }
    }
  }
}
