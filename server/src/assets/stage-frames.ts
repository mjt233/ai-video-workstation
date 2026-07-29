import fs from 'fs/promises';
import path from 'path';
import { pathExists, resolveProjectPath } from './paths.js';

/**
 * 分镜关键帧输入。
 * @property 基础场景 场景引用：`场景名/标签`、`场景名/标签@变体id`，或关键字 `prev`（同集上一分镜最后一帧）
 * @property 登场角色 可选角色引用列表；`prev` 时必须为空
 * @property prompt 合成提示词；`prev` 时必须为空
 */
export interface StageFrameInput {
  基础场景: string;
  登场角色?: string[];
  prompt?: string;
}

/** 引用同集上一分镜最后一个场景图的固定关键字。 */
export const PREV_STAGE_REF = 'prev';

/**
 * 判断是否为上一分镜最后场景引用。
 * @param ref 基础场景字段
 * @returns 是否为精确关键字 `prev`
 */
export function isPrevStageRef(ref: string): boolean {
  return (ref ?? '').trim() === PREV_STAGE_REF;
}

/**
 * 解析同集上一分镜编号。
 * @param shot 当前分镜编号（正整数字符串）
 * @returns 上一分镜编号字符串；若当前为第 1 镜或非法则返回 null
 */
export function getPreviousShotId(shot: string): string | null {
  const n = Number(String(shot).trim());
  if (!Number.isInteger(n) || n <= 1) return null;
  return String(n - 1);
}

async function readStageJson(project: string, episode: string, shot: string): Promise<unknown[]> {
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
  return data;
}

async function writeStageJson(
  project: string,
  episode: string,
  shot: string,
  data: unknown[],
): Promise<void> {
  const jsonPath = resolveProjectPath(project, `prompt/scene/${episode}/${shot}/stage.json`);
  await fs.writeFile(jsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

/**
 * 规范化分镜关键帧字段。
 * - 普通引用：`场景名/标签` 或 `场景名/标签@变体`
 * - `prev`：仅允许直接引用（角色与 prompt 必须为空）
 * @param input 原始输入
 * @returns 规范化后的帧定义
 */
export function normalizeStageFrame(input: StageFrameInput): StageFrameInput {
  const base = (input.基础场景 ?? '').trim();
  if (!base) {
    throw Object.assign(new Error('基础场景必填'), { code: 'INVALID' });
  }

  const characters = Array.isArray(input.登场角色)
    ? input.登场角色.map((c) => String(c).trim()).filter(Boolean)
    : [];
  const prompt = (input.prompt ?? '').trim();

  if (isPrevStageRef(base)) {
    if (characters.length > 0 || prompt) {
      throw Object.assign(
        new Error('基础场景为 prev 时仅支持直接引用（登场角色与 prompt 必须为空）'),
        { code: 'INVALID' },
      );
    }
    return {
      基础场景: PREV_STAGE_REF,
      登场角色: [],
      prompt: '',
    };
  }

  if (!base.includes('/') || base.startsWith('/') || base.endsWith('/')) {
    throw Object.assign(
      new Error('基础场景格式须为 场景名/标签、场景名/标签@变体，或关键字 prev'),
      { code: 'INVALID' },
    );
  }

  // 仅有角色、prompt 为空 → 禁止
  if (characters.length > 0 && !prompt) {
    throw Object.assign(new Error('有登场角色时必须填写合成 Prompt'), { code: 'INVALID' });
  }

  return {
    基础场景: base,
    登场角色: characters,
    prompt,
  };
}

/**
 * 校验 `prev` 引用的上下文：同集上一分镜须存在且 stage.json 为非空数组。
 * @param project 项目名
 * @param episode 集数
 * @param shot 当前分镜编号
 */
export async function assertPrevStageContext(
  project: string,
  episode: string,
  shot: string,
): Promise<void> {
  const prevShot = getPreviousShotId(shot);
  if (!prevShot) {
    throw Object.assign(
      new Error('第 1 个分镜不能使用基础场景 prev（无上一分镜）'),
      { code: 'INVALID' },
    );
  }

  let prevStages: unknown[];
  try {
    prevStages = await readStageJson(project, episode, prevShot);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err?.code === 'NOT_FOUND' || err?.code === 'INVALID') {
      throw Object.assign(
        new Error(`上一分镜 ${episode}/${prevShot} 的 stage.json 不存在或无效，无法引用 prev`),
        { code: 'INVALID' },
      );
    }
    throw e;
  }
  if (!Array.isArray(prevStages) || prevStages.length === 0) {
    throw Object.assign(
      new Error(`上一分镜 ${episode}/${prevShot} 的 stage.json 为空，无法引用 prev`),
      { code: 'INVALID' },
    );
  }
}

/**
 * 解析 `prev` 对应的 assert 相对路径：上一分镜 stage 数组最后一项的场景图。
 * @param project 项目名
 * @param episode 集数
 * @param shot 当前分镜编号
 * @returns assert 相对路径，如 `assert/scene/1/2/stage/1.jpg`
 */
export async function resolvePrevStageAssertPath(
  project: string,
  episode: string,
  shot: string,
): Promise<string> {
  await assertPrevStageContext(project, episode, shot);
  const prevShot = getPreviousShotId(shot)!;
  const prevStages = await readStageJson(project, episode, prevShot);
  const lastIndex = prevStages.length - 1;
  return `assert/scene/${episode}/${prevShot}/stage/${lastIndex}.jpg`;
}

async function renameStageImagesAfterDelete(
  project: string,
  episode: string,
  shot: string,
  deletedIndex: number,
  lengthBefore: number,
): Promise<void> {
  const stageDir = resolveProjectPath(project, `assert/scene/${episode}/${shot}/stage`);
  if (!(await pathExists(stageDir))) return;

  const deletedFile = path.join(stageDir, `${deletedIndex}.jpg`);
  if (await pathExists(deletedFile)) {
    await fs.unlink(deletedFile);
  }

  // 将 deletedIndex+1..n-1 前移
  for (let i = deletedIndex + 1; i < lengthBefore; i++) {
    const src = path.join(stageDir, `${i}.jpg`);
    const dest = path.join(stageDir, `${i - 1}.jpg`);
    if (await pathExists(src)) {
      await fs.rename(src, dest);
    }
  }

  // 同步 history/i 目录前移
  const historyRoot = path.join(stageDir, 'history');
  if (!(await pathExists(historyRoot))) return;

  const deletedHist = path.join(historyRoot, String(deletedIndex));
  if (await pathExists(deletedHist)) {
    await fs.rm(deletedHist, { recursive: true, force: true });
  }
  for (let i = deletedIndex + 1; i < lengthBefore; i++) {
    const src = path.join(historyRoot, String(i));
    const dest = path.join(historyRoot, String(i - 1));
    if (await pathExists(src)) {
      if (await pathExists(dest)) {
        await fs.rm(dest, { recursive: true, force: true });
      }
      await fs.rename(src, dest);
    }
  }
}

export async function addStageFrame(
  project: string,
  episode: string,
  shot: string,
  input: StageFrameInput,
  index?: number,
): Promise<{ index: number }> {
  const frame = normalizeStageFrame(input);
  if (isPrevStageRef(frame.基础场景)) {
    await assertPrevStageContext(project, episode, shot);
  }
  const data = await readStageJson(project, episode, shot);
  const n = data.length;
  let target = n;
  if (index !== undefined && index !== null) {
    if (!Number.isInteger(index) || index < 0 || index > n) {
      throw Object.assign(new Error(`插入位置须在 0..${n}`), { code: 'INVALID' });
    }
    target = index;
  }

  data.splice(target, 0, frame);
  await writeStageJson(project, episode, shot, data);

  // 若插入中间，assert 图片与 history 需后移
  if (target < n) {
    const stageDir = resolveProjectPath(project, `assert/scene/${episode}/${shot}/stage`);
    if (await pathExists(stageDir)) {
      for (let i = n - 1; i >= target; i--) {
        const src = path.join(stageDir, `${i}.jpg`);
        const dest = path.join(stageDir, `${i + 1}.jpg`);
        if (await pathExists(src)) {
          await fs.rename(src, dest);
        }
      }
      const historyRoot = path.join(stageDir, 'history');
      if (await pathExists(historyRoot)) {
        for (let i = n - 1; i >= target; i--) {
          const src = path.join(historyRoot, String(i));
          const dest = path.join(historyRoot, String(i + 1));
          if (await pathExists(src)) {
            if (await pathExists(dest)) {
              await fs.rm(dest, { recursive: true, force: true });
            }
            await fs.rename(src, dest);
          }
        }
      }
    }
  }

  return { index: target };
}

export async function updateStageFrame(
  project: string,
  episode: string,
  shot: string,
  index: number,
  input: StageFrameInput,
): Promise<void> {
  const frame = normalizeStageFrame(input);
  if (isPrevStageRef(frame.基础场景)) {
    await assertPrevStageContext(project, episode, shot);
  }
  const data = await readStageJson(project, episode, shot);
  if (!Number.isInteger(index) || index < 0 || index >= data.length) {
    throw Object.assign(new Error('索引越界'), { code: 'CONFLICT' });
  }
  data[index] = frame;
  await writeStageJson(project, episode, shot, data);
}

export async function deleteStageFrame(
  project: string,
  episode: string,
  shot: string,
  index: number,
): Promise<void> {
  const data = await readStageJson(project, episode, shot);
  if (data.length <= 1) {
    throw Object.assign(new Error('至少保留一个场景，无法删除'), { code: 'LAST_ONE' });
  }
  if (!Number.isInteger(index) || index < 0 || index >= data.length) {
    throw Object.assign(new Error('索引越界'), { code: 'CONFLICT' });
  }
  const lengthBefore = data.length;
  data.splice(index, 1);
  await writeStageJson(project, episode, shot, data);
  await renameStageImagesAfterDelete(project, episode, shot, index, lengthBefore);
}
