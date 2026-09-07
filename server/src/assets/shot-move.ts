/**
 * 分镜移动（跨集数移动 / 同集数内重排）。
 *
 * 物理操作（对 `prompt/scene/`、`assert/scene/`、`assert/custom/scene/` 三侧成组）：
 * 1. 被移动分镜的三个目录先临时改名（临时名非数字，如 `__move__{时间戳}-{随机}`，
 *    置于目标集目录内，listNumericDirNames 会忽略非数字目录）；
 * 2. 目标集（或本集）按位置让位：复用 shot-renumber 的 shiftShotsUpForInsert /
 *    shiftShotsDownAfterDelete 逻辑（position > fromShot 时先删除侧下移、否则插入侧上移）；
 * 3. 临时目录改名到目标集最终位置；
 * 4. 跨集时源集执行 shiftShotsDownAfterDelete 前移。
 *
 * 引用改写（全项目）：所有 `prompt/scene/{集}/{分镜}/` 下的 canvas.json / director.json，
 * 文本内的 `(assert/scene|prompt/scene|assert/custom/scene)/{旧集}/{旧号}` 按顺序重写：
 * **先应用各集移位映射，最后应用"被移动分镜"映射**——若顺序颠倒，移位映射会把
 * 刚刚写出的新路径再次改写（如 4→3 与 3→5 互相污染）。
 * 分镜别名（metadata.json）随分镜目录一起移动，无需额外同步。
 * canvas.json 被改写后 rev 同步 +1（见 canvas-def.ts），使停留页面的旧自动保存触发冲突。
 */

import fs from 'fs/promises';
import path from 'path';
import {
  assertPositiveIntId,
  listNumericDirNames,
  pathExists,
  resolveProjectPath,
} from './paths.js';
import { shiftShotsDownAfterDelete, shiftShotsUpForInsert } from './shot-renumber.js';
import { bumpCanvasRevInJsonText } from './canvas-def.js';

/** 一条跨集/同集分镜路径重写映射（旧位置 → 新位置） */
export interface ShotMoveRename {
  /** 源集数 */
  fromEpisode: string;
  /** 源分镜号 */
  fromShot: string;
  /** 目标集数 */
  toEpisode: string;
  /** 目标分镜号 */
  toShot: string;
}

/** 对外返回的集内重编号映射（前端用于修正 URL 与树） */
export interface EpisodeRenamePair {
  episode: string;
  from: string;
  to: string;
}

/** 需要同步改写引用路径的 JSON 文件（与 shot-renumber 保持一致） */
const SHOT_PATH_JSON_FILES = ['canvas.json', 'director.json'];

/**
 * 纯函数：按移动映射改写文本中的 scene 资产路径（**单次遍历，基于原始标识符**）。
 *
 * 把全部映射合并为 `原(集,分镜) → 终(集,分镜)` 查找表后，对原始文本做一遍替换：
 * 文本中每个 `(assert/scene|prompt/scene|assert/custom/scene)/{集}/{分镜}` 片段
 * 都按其在**移动前**的编号唯一对应一个目标位置，因此不存在顺序问题——
 * 不会出现"4→3 改写后又把刚写出的 3 当作原有 3 再次改写"（4→3 与 3→5 互相污染）。
 *
 * 注意：调用方必须先以 `rewriteJson: false` 调用移位辅助函数（shiftShotsUpForInsert /
 * shiftShotsDownAfterDelete），避免它们在目录 rename 后先行改写 JSON，与本函数
 * 基于原始文本的单次改写叠加造成二次污染。
 *
 * @param text 原始 JSON 文本
 * @param renames 移动映射（含各集移位；顺序无关，全部合并进查找表）
 * @returns 改写后的文本
 */
export function rewriteSceneShotMovePathsInText(text: string, renames: ShotMoveRename[]): string {
  if (!renames.length) return text;
  const map = new Map<string, string>();
  for (const r of renames) {
    map.set(`${r.fromEpisode}/${r.fromShot}`, `${r.toEpisode}/${r.toShot}`);
  }
  return text.replace(
    /(assert\/scene|prompt\/scene|assert\/custom\/scene)\/(\d+)\/(\d+)(?=[/"])/g,
    (match, prefix: string, ep: string, shot: string) => {
      const to = map.get(`${ep}/${shot}`);
      return to ? `${prefix}/${to}` : match;
    },
  );
}

/**
 * 全项目改写所有分镜目录的 canvas.json / director.json：
 * 引用路径被改写后，canvas.json 的保存版本号（rev）同步 +1。
 *
 * @param project 项目名
 * @param renames 移动映射（按应用顺序：先移位、后移动）
 */
async function rewriteAllShotJsonPaths(project: string, renames: ShotMoveRename[]): Promise<void> {
  if (!renames.length) return;
  const sceneRoot = resolveProjectPath(project, 'prompt/scene');
  const episodes = await listNumericDirNames(sceneRoot);
  for (const ep of episodes) {
    const epDir = path.join(sceneRoot, ep);
    const shots = await listNumericDirNames(epDir);
    for (const shot of shots) {
      for (const fileName of SHOT_PATH_JSON_FILES) {
        const full = path.join(epDir, shot, fileName);
        if (!(await pathExists(full))) continue;
        const original = await fs.readFile(full, 'utf8');
        const rewritten = rewriteSceneShotMovePathsInText(original, renames);
        if (rewritten === original) continue;
        const out = fileName === 'canvas.json' ? bumpCanvasRevInJsonText(rewritten) : rewritten;
        await fs.writeFile(full, out, 'utf8');
      }
    }
  }
}

/**
 * 成组 rename 分镜的三侧目录（跨集或同集；存在才移动）。
 *
 * @param project 项目名
 * @param fromEpisode 源集数
 * @param fromShot 源分镜号
 * @param toEpisode 目标集数
 * @param toShot 目标分镜号
 * @throws code=CONFLICT 目标目录已存在
 */
async function renameShotDirs(
  project: string,
  fromEpisode: string,
  fromShot: string,
  toEpisode: string,
  toShot: string,
): Promise<void> {
  const pairs = [
    [`prompt/scene/${fromEpisode}/${fromShot}`, `prompt/scene/${toEpisode}/${toShot}`],
    [`assert/scene/${fromEpisode}/${fromShot}`, `assert/scene/${toEpisode}/${toShot}`],
    [`assert/custom/scene/${fromEpisode}/${fromShot}`, `assert/custom/scene/${toEpisode}/${toShot}`],
  ];
  for (const [fromRel, toRel] of pairs) {
    const from = resolveProjectPath(project, fromRel);
    const to = resolveProjectPath(project, toRel);
    if (!(await pathExists(from))) continue;
    if (await pathExists(to)) {
      throw Object.assign(new Error(`目标已存在: ${toRel}`), { code: 'CONFLICT' });
    }
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
  }
}

/** 生成不与既有目录冲突的临时目录名（非数字，listNumericDirNames 会忽略） */
function tempDirName(): string {
  return `__move__${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 移动分镜：跨集数移动或同集数内重排（位置语义 = 移动后成为目标集第 position 个分镜）。
 *
 * @param project 项目名
 * @param fromEpisode 源集数
 * @param fromShot 源分镜号
 * @param toEpisode 目标集数（与源相同 = 同集重排）
 * @param position 目标位置（1..目标集分镜数+1；同集重排时 1..当前分镜数，且等于源号时为无操作）
 * @returns 移动后的实际位置与集内重编号映射（前端修正 URL/树用）
 * @throws code=NOT_FOUND 源/目标集数或分镜不存在；code=INVALID 参数非法
 */
export async function moveShot(
  project: string,
  fromEpisode: string,
  fromShot: string,
  toEpisode: string,
  position: number,
): Promise<{ episode: string; shot: string; renames: EpisodeRenamePair[] }> {
  const fromEp = String(fromEpisode).trim();
  const toEp = String(toEpisode).trim();
  const fromS = String(fromShot).trim();
  assertPositiveIntId(fromEp, '源集数');
  assertPositiveIntId(toEp, '目标集数');
  assertPositiveIntId(fromS, '源分镜');
  if (!Number.isInteger(position) || position < 1) {
    throw Object.assign(new Error('position 必须是正整数'), { code: 'INVALID' });
  }

  const srcEpDir = resolveProjectPath(project, `prompt/scene/${fromEp}`);
  if (!(await pathExists(srcEpDir))) {
    throw Object.assign(new Error('源集数不存在'), { code: 'NOT_FOUND' });
  }
  const srcShotDir = resolveProjectPath(project, `prompt/scene/${fromEp}/${fromS}`);
  if (!(await pathExists(srcShotDir))) {
    throw Object.assign(new Error('分镜不存在'), { code: 'NOT_FOUND' });
  }

  const sameEpisode = fromEp === toEp;
  if (sameEpisode) {
    const count = (await listNumericDirNames(srcEpDir)).length;
    if (position > count) {
      throw Object.assign(new Error(`同集重排位置须在 1..${count}`), { code: 'INVALID' });
    }
    if (position === Number(fromS)) {
      // 移动前后位置不变：无操作
      return { episode: fromEp, shot: fromS, renames: [] };
    }
    return moveWithinEpisode(project, fromEp, fromS, position);
  }

  const dstEpDir = resolveProjectPath(project, `prompt/scene/${toEp}`);
  if (!(await pathExists(dstEpDir))) {
    throw Object.assign(new Error('目标集数不存在'), { code: 'NOT_FOUND' });
  }
  const dstCount = (await listNumericDirNames(dstEpDir)).length;
  if (position > dstCount + 1) {
    throw Object.assign(new Error(`插入位置须在 1..${dstCount + 1}`), { code: 'INVALID' });
  }
  return moveAcrossEpisodes(project, fromEp, fromS, toEp, position);
}

/**
 * 跨集数移动：
 * 1. 被移动分镜三目录临时改名（置于目标集内，避开数字编号）；
 * 2. 目标集按插入位置让位（shiftShotsUpForInsert）；
 * 3. 临时目录改名到目标集最终位置；
 * 4. 源集前移（shiftShotsDownAfterDelete）；
 * 5. 全项目改写引用路径（先移位映射、最后移动映射），canvas.json rev +1。
 *
 * @param project 项目名
 * @param fromEp 源集数
 * @param fromS 源分镜号
 * @param toEp 目标集数
 * @param position 目标位置（1..目标集分镜数+1）
 */
async function moveAcrossEpisodes(
  project: string,
  fromEp: string,
  fromS: string,
  toEp: string,
  position: number,
): Promise<{ episode: string; shot: string; renames: EpisodeRenamePair[] }> {
  const temp = tempDirName();
  const destShot = String(position);
  await renameShotDirs(project, fromEp, fromS, toEp, temp);
  try {
    const targetShifts = (await shiftShotsUpForInsert(project, toEp, position, { rewriteJson: false }))
      .map((p) => ({ fromEpisode: toEp, fromShot: p.from, toEpisode: toEp, toShot: p.to }));
    await renameShotDirs(project, toEp, temp, toEp, destShot);
    const sourceShifts = (await shiftShotsDownAfterDelete(project, fromEp, fromS, { rewriteJson: false }))
      .map((p) => ({ fromEpisode: fromEp, fromShot: p.from, toEpisode: fromEp, toShot: p.to }));
    const moveMapping: ShotMoveRename = {
      fromEpisode: fromEp,
      fromShot: fromS,
      toEpisode: toEp,
      toShot: destShot,
    };
    // 单次遍历改写（基于移动前编号），映射顺序无关
    await rewriteAllShotJsonPaths(project, [...targetShifts, ...sourceShifts, moveMapping]);
    const renames: EpisodeRenamePair[] = [
      ...targetShifts.map((s) => ({ episode: s.fromEpisode, from: s.fromShot, to: s.toShot })),
      ...sourceShifts.map((s) => ({ episode: s.fromEpisode, from: s.fromShot, to: s.toShot })),
    ];
    return { episode: toEp, shot: destShot, renames };
  } catch (err) {
    // 尽力回滚：临时目录改回源位置（移位已部分执行时无法完整回滚，记录日志交由上层提示）
    try {
      await renameShotDirs(project, toEp, temp, fromEp, fromS);
    } catch (rollbackErr) {
      console.warn(
        `[shot-move] 回滚失败（临时目录 ${temp} 恢复至 ${fromEp}/${fromS}）: `
        + `${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
      );
    }
    throw err;
  }
}

/**
 * 同集数内重排：
 * 1. 被移动分镜三目录临时改名；
 * 2. position > 源号：源侧下移（shiftShotsDownAfterDelete）；否则插入侧重排
 *    （shiftShotsUpForInsert，从临时目录腾出的位置让位）；
 * 3. 临时目录改名到目标位置；
 * 4. 全项目改写引用路径（先移位映射、最后移动映射），canvas.json rev +1。
 *
 * @param project 项目名
 * @param episode 集数
 * @param fromS 源分镜号
 * @param position 目标位置（1..本集分镜数，且 ≠ 源号）
 */
async function moveWithinEpisode(
  project: string,
  episode: string,
  fromS: string,
  position: number,
): Promise<{ episode: string; shot: string; renames: EpisodeRenamePair[] }> {
  const temp = tempDirName();
  const destShot = String(position);
  await renameShotDirs(project, episode, fromS, episode, temp);
  try {
    const shifts = position > Number(fromS)
      ? (await shiftShotsDownAfterDelete(project, episode, fromS, { rewriteJson: false }))
        .map((p) => ({ fromEpisode: episode, fromShot: p.from, toEpisode: episode, toShot: p.to }))
      : (await shiftShotsUpForInsert(project, episode, position, { rewriteJson: false }))
        .map((p) => ({ fromEpisode: episode, fromShot: p.from, toEpisode: episode, toShot: p.to }));
    await renameShotDirs(project, episode, temp, episode, destShot);
    const moveMapping: ShotMoveRename = {
      fromEpisode: episode,
      fromShot: fromS,
      toEpisode: episode,
      toShot: destShot,
    };
    // 单次遍历改写（基于移动前编号），映射顺序无关
    await rewriteAllShotJsonPaths(project, [...shifts, moveMapping]);
    return {
      episode,
      shot: destShot,
      renames: shifts.map((s) => ({ episode: s.fromEpisode, from: s.fromShot, to: s.toShot })),
    };
  } catch (err) {
    // 尽力回滚：临时目录改回原位置（移位已部分执行时无法完整回滚，记录日志交由上层提示）
    try {
      await renameShotDirs(project, episode, temp, episode, fromS);
    } catch (rollbackErr) {
      console.warn(
        `[shot-move] 回滚失败（临时目录 ${temp} 恢复至 ${episode}/${fromS}）: `
        + `${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
      );
    }
    throw err;
  }
}
