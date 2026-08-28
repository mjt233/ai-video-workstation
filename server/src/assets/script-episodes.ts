import fs from 'fs/promises';
import path from 'path';
import {
  assertPositiveIntId,
  ensureDir,
  pathExists,
  resolveProjectPath,
} from './paths.js';
import type { RenamePair } from './shot-renumber.js';
import { scriptEpisodeMd } from './templates.js';

/** 剧本分集文件名（{编号}.md）的合法格式 */
const EPISODE_FILE = /^([1-9]\d*)\.md$/;

/**
 * 解析剧本分集根目录 prompt/script/episodes/ 的绝对路径。
 * @param project 项目名
 * @returns 分集根目录绝对路径（路径越界时抛错）
 */
function episodesRoot(project: string): string {
  return resolveProjectPath(project, 'prompt/script/episodes');
}

/**
 * 列出分集根目录下的数字编号分集文件（{n}.md），按编号升序返回文件名主干。
 * @param dir 分集根目录绝对路径
 * @returns 编号字符串数组（如 ['1', '2', '10']）；目录不存在时返回空数组
 */
async function listEpisodeIds(dir: string): Promise<string[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // 目录不存在（尚未创建任何分集）即视为空列表
    return [];
  }
  return entries
    .filter(e => e.isFile() && EPISODE_FILE.test(e.name))
    .map(e => EPISODE_FILE.exec(e.name)![1])
    .sort((a, b) => Number(a) - Number(b));
}

/**
 * 创建剧本分集：写入 prompt/script/episodes/{n}.md。
 *
 * 编号为空时自动取「当前最大编号 + 1」（追加末尾）；指定编号时须为正整数、
 * 不与现有分集重复，且不超过最大编号 + 1（保证编号连续 1..N 无跳号）。
 *
 * @param project 项目名
 * @param episode 指定分集编号（可空 = 自动追加末尾）
 * @returns episode 为实际创建的编号，path 为落盘的相对路径
 * @throws code=INVALID 编号非法 / 跳号；code=EXISTS 分集已存在
 */
export async function createScriptEpisode(
  project: string,
  episode?: string,
): Promise<{ episode: string; path: string }> {
  const root = episodesRoot(project);
  await ensureDir(root);
  let id: string;
  if (episode === undefined || episode === null || episode === '') {
    const ids = await listEpisodeIds(root);
    id = ids.length ? String(Math.max(...ids.map(Number)) + 1) : '1';
  } else {
    id = String(episode);
    assertPositiveIntId(id, '集数编号');
    if (await pathExists(path.join(root, `${id}.md`))) {
      throw Object.assign(new Error('分集已存在'), { code: 'EXISTS' });
    }
    const ids = await listEpisodeIds(root);
    const max = ids.length ? Math.max(...ids.map(Number)) : 0;
    if (Number(id) > max + 1) {
      throw Object.assign(new Error('末尾新增只能使用下一个连续编号'), { code: 'INVALID' });
    }
  }
  const file = path.join(root, `${id}.md`);
  await fs.writeFile(file, scriptEpisodeMd(id), 'utf-8');
  return { episode: id, path: `prompt/script/episodes/${id}.md` };
}

/**
 * 分集文件前移后，若正文首行为「# 第{oldNumber}集」一级标题则同步改写为新编号。
 * 仅精确匹配首行标题格式（模板生成的默认标题），用户自定义的其余内容不受影响。
 *
 * @param project 项目名
 * @param episode 改写后的分集编号（文件现所在位置）
 * @param oldNumber 重编号前的旧编号（标题中待替换的数字）
 */
async function rewriteEpisodeHeading(project: string, episode: string, oldNumber: number): Promise<void> {
  const file = path.join(episodesRoot(project), `${episode}.md`);
  const original = await fs.readFile(file, 'utf-8');
  // 仅替换标题文字本身，保留原有换行与后续内容；(?=) 保证不吞掉换行符
  const headingRe = new RegExp(`^#\\s*第${oldNumber}集(?=\\s*(?:\\r?\\n|$))`);
  if (!headingRe.test(original)) return;
  const updated = original.replace(headingRe, `# 第${episode}集`);
  if (updated !== original) {
    await fs.writeFile(file, updated, 'utf-8');
  }
}

/**
 * 删除剧本分集 prompt/script/episodes/{n}.md，并将后续编号整体前移 1（从小到大
 * 逐个 rename），保持编号连续 1..N；被前移分集的首行默认标题同步改写为新编号。
 *
 * @param project 项目名
 * @param episode 待删除的分集编号（正整数字符串）
 * @returns 重命名映射数组（from → to，from 升序），供前端修正当前打开的集数
 * @throws code=INVALID 编号非法；code=NOT_FOUND 分集不存在
 */
export async function deleteScriptEpisode(project: string, episode: string): Promise<RenamePair[]> {
  assertPositiveIntId(episode, '集数编号');
  const root = episodesRoot(project);
  const file = path.join(root, `${episode}.md`);
  if (!(await pathExists(file))) {
    throw Object.assign(new Error('分集不存在'), { code: 'NOT_FOUND' });
  }
  await fs.unlink(file);
  const deleted = Number(episode);
  const renames: RenamePair[] = (await listEpisodeIds(root))
    .map(Number)
    .filter(n => n > deleted)
    .sort((a, b) => a - b)
    .map(n => ({ from: String(n), to: String(n - 1) }));
  for (const { from, to } of renames) {
    // 从小到大前移：{from}.md 一定存在且 {to}.md 一定空出，rename 不会冲突
    await fs.rename(path.join(root, `${from}.md`), path.join(root, `${to}.md`));
    await rewriteEpisodeHeading(project, to, Number(from));
  }
  return renames;
}
