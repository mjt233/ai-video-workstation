import fs from 'fs/promises';
import { listNumericDirNames, pathExists, resolveProjectPath } from './paths.js';

export interface RenamePair {
  from: string;
  to: string;
}

/**
 * 按分镜重命名映射，重写文本中的 scene 资产路径（`scene/{ep}/{旧号}` → `scene/{ep}/{新号}`）。
 *
 * 纯函数：分镜重编号时，分镜目录被整体重命名，但 `canvas.json` / `director.json`
 * 保存的绝对资产路径（如 `config.current.path`、`config.assetPath`、`imageClips[].path`）
 * 仍引用旧分镜号，需同步改写，否则产物（视频/图片）路径失效无法加载。
 *
 * 仅匹配以下三种合法前缀（其余文本中的同名片段一律不动）：
 * - `assert/scene/{ep}/{shot}/...` 分镜正式资产
 * - `prompt/scene/{ep}/{shot}/...` 分镜定义文件
 * - `assert/custom/scene/{ep}/{shot}/...` 分镜自定义资产（目录随分镜号一起 rename）
 *
 * 处理顺序：整体下移（`to < from`，如删除分镜）按 from 升序，整体上移（`to > from`，如插入分镜）
 * 按 from 降序，避免中间结果被后续 rename 再次匹配（如 2→3、3→4 连做会把 1/2 误改成 1/4）。
 *
 * @param text 原始 JSON 文本
 * @param episode 集数
 * @param renames 本轮全部重命名映射（from → to）
 * @returns 改写后的文本
 */
export function rewriteSceneShotPathsInText(text: string, episode: string, renames: RenamePair[]): string {
  if (!renames.length) return text;
  const delta = Number(renames[0].to) - Number(renames[0].from);
  // 上移按 from 降序处理，下移按 from 升序处理（同一轮操作的 delta 符号一致）
  const ordered = [...renames].sort((a, b) => (delta > 0 ? Number(b.from) - Number(a.from) : Number(a.from) - Number(b.from)));
  let out = text;
  for (const { from, to } of ordered) {
    // 只匹配「合法前缀 + 完整分镜号」：后面必须是 / 或 "（或行尾），避免 scene/1/1 误伤 scene/1/12
    const re = new RegExp(
      `(assert/scene|prompt/scene|assert/custom/scene)/${episode}/${from}(?=[/"])`,
      'g',
    );
    out = out.replace(re, `$1/${episode}/${to}`);
  }
  return out;
}

/** 分镜重编号后需同步改写资产路径的 JSON 文件（均位于 prompt/scene/{ep}/{shot}/ 下） */
const SHOT_PATH_JSON_FILES = ['canvas.json', 'director.json'];

/**
 * 重写分镜目录内 JSON 文件的 scene 资产路径。
 * 仅当内容实际变化时落盘；文件不存在则跳过。
 *
 * @param project 项目名
 * @param episode 集数
 * @param shot 分镜号（目录当前所在位置）
 * @param renames 本轮全部重命名映射
 */
async function rewriteShotDirAssetPaths(
  project: string,
  episode: string,
  shot: string,
  renames: RenamePair[],
): Promise<void> {
  for (const fileName of SHOT_PATH_JSON_FILES) {
    const fullPath = resolveProjectPath(project, `prompt/scene/${episode}/${shot}/${fileName}`);
    if (!(await pathExists(fullPath))) continue;
    const original = await fs.readFile(fullPath, 'utf8');
    const rewritten = rewriteSceneShotPathsInText(original, episode, renames);
    if (rewritten !== original) {
      await fs.writeFile(fullPath, rewritten, 'utf8');
    }
  }
}

/**
 * 目录重命名完成后，统一改写该集全部分镜 JSON 的 scene 资产路径。
 *
 * 除被重命名分镜自身的产物路径外，未被重命名的分镜也可能引用其它分镜的
 * 正式资产 / 自定义资产（如画布节点、导演台素材跨分镜引用），因此必须扫描
 * 全集所有分镜目录，而非仅扫描被 rename 的分镜。
 */
async function rewriteAllShotDirAssetPaths(
  project: string,
  episode: string,
  renames: RenamePair[],
): Promise<void> {
  if (!renames.length) return;
  const epDir = resolveProjectPath(project, `prompt/scene/${episode}`);
  const ids = await listNumericDirNames(epDir);
  for (const id of ids) {
    await rewriteShotDirAssetPaths(project, episode, id, renames);
  }
}

async function renameDirIfExists(from: string, to: string): Promise<void> {
  if (!(await pathExists(from))) return;
  if (await pathExists(to)) {
    throw Object.assign(new Error(`目标已存在: ${to}`), { code: 'CONFLICT' });
  }
  await fs.rename(from, to);
}

/**
 * 成组 rename 分镜相关的三个目录：
 * - prompt/scene/{ep}/{id}（分镜定义）
 * - assert/scene/{ep}/{id}（正式资产）
 * - assert/custom/scene/{ep}/{id}（分镜自定义资产，随分镜号保持一致）
 *
 * 目录不存在则跳过对应一侧。JSON 内资产路径的统一改写由调用方在
 * 全部目录 rename 完成后执行（见 rewriteAllShotDirAssetPaths）。
 */
async function renameShotPair(
  project: string,
  episode: string,
  from: string,
  to: string,
): Promise<void> {
  const promptFrom = resolveProjectPath(project, `prompt/scene/${episode}/${from}`);
  const promptTo = resolveProjectPath(project, `prompt/scene/${episode}/${to}`);
  const assertFrom = resolveProjectPath(project, `assert/scene/${episode}/${from}`);
  const assertTo = resolveProjectPath(project, `assert/scene/${episode}/${to}`);
  const customFrom = resolveProjectPath(project, `assert/custom/scene/${episode}/${from}`);
  const customTo = resolveProjectPath(project, `assert/custom/scene/${episode}/${to}`);
  await renameDirIfExists(promptFrom, promptTo);
  await renameDirIfExists(assertFrom, assertTo);
  await renameDirIfExists(customFrom, customTo);
}

/**
 * 删除 shot 后：将 > deleted 的编号整体 -1（从小到大）。
 * 调用方须已删除目标目录。目录 rename 后统一改写全部分镜 JSON 的旧分镜号路径。
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
      renames.push({ from: id, to: String(n - 1) });
    }
  }
  for (const { from, to } of renames) {
    await renameShotPair(project, episode, from, to);
  }
  await rewriteAllShotDirAssetPaths(project, episode, renames);
  return renames;
}

/**
 * 在 position 插入空位：将 >= position 的编号 +1（从大到小）。
 * 返回 renames；调用方再在 position 创建新分镜。目录 rename 后统一改写全部分镜 JSON 的旧分镜号路径。
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
      renames.push({ from: String(n), to: String(n + 1) });
    }
  }
  for (const { from, to } of renames) {
    await renameShotPair(project, episode, from, to);
  }
  await rewriteAllShotDirAssetPaths(project, episode, renames);
  // 对外按 from 升序返回，便于前端映射
  renames.reverse();
  return renames;
}

export async function removeDirIfExists(fullPath: string): Promise<void> {
  if (await pathExists(fullPath)) {
    await fs.rm(fullPath, { recursive: true, force: true });
  }
}
