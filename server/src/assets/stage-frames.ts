import fs from 'fs/promises';
import path from 'path';
import { pathExists, resolveProjectPath } from './paths.js';

export interface StageFrameInput {
  基础场景: string;
  登场角色?: string[];
  prompt?: string;
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

export function normalizeStageFrame(input: StageFrameInput): StageFrameInput {
  const base = (input.基础场景 ?? '').trim();
  if (!base) {
    throw Object.assign(new Error('基础场景必填'), { code: 'INVALID' });
  }
  if (!base.includes('/') || base.startsWith('/') || base.endsWith('/')) {
    throw Object.assign(new Error('基础场景格式须为 场景名/标签'), { code: 'INVALID' });
  }

  const characters = Array.isArray(input.登场角色)
    ? input.登场角色.map((c) => String(c).trim()).filter(Boolean)
    : [];
  const prompt = (input.prompt ?? '').trim();

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
