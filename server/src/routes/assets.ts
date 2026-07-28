import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import {
  assertPositiveIntId,
  assertSafeName,
  ensureDir,
  httpError,
  listNumericDirNames,
  nextNumericId,
  pathExists,
  resolveProjectPath,
} from '../assets/paths.js';
import {
  characterAppearanceMd,
  characterOverviewMd,
  characterVoiceMd,
  shotOverviewMd,
  shotPromptMd,
  subsceneMd,
} from '../assets/templates.js';
import { findCharacterRefs, findStageRefs, findSubsceneRefs } from '../assets/refs.js';
import { removeDirIfExists, shiftShotsDownAfterDelete, shiftShotsUpForInsert } from '../assets/shot-renumber.js';
import { reorderStageFrames } from '../assets/stage-reorder.js';

export const assetsRouter = Router();

// POST /api/assets/:project/character
assetsRouter.post('/assets/:project/character', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const { name, gender = '', age = '', personality = '' } = req.body as {
      name?: string; gender?: string; age?: string; personality?: string;
    };
    if (!name) throw Object.assign(new Error('name 必填'), { code: 'INVALID' });
    assertSafeName(name, '角色名');
    const dir = resolveProjectPath(project, `prompt/character/${name}`);
    if (await pathExists(dir)) throw Object.assign(new Error('角色已存在'), { code: 'EXISTS' });
    await ensureDir(dir);
    await fs.writeFile(path.join(dir, 'overview.md'), characterOverviewMd(name, gender, age, personality), 'utf-8');
    await fs.writeFile(path.join(dir, 'appearance.md'), characterAppearanceMd(gender, age), 'utf-8');
    await fs.writeFile(path.join(dir, 'voice.md'), characterVoiceMd(), 'utf-8');
    res.json({ success: true, path: `prompt/character/${name}` });
  } catch (err) {
    httpError(res, err);
  }
});

// POST /api/assets/:project/stage
assetsRouter.post('/assets/:project/stage', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const { name } = req.body as { name?: string };
    if (!name) throw Object.assign(new Error('name 必填'), { code: 'INVALID' });
    assertSafeName(name, '场景名');
    const dir = resolveProjectPath(project, `prompt/stage/${name}`);
    if (await pathExists(dir)) throw Object.assign(new Error('场景已存在'), { code: 'EXISTS' });
    await ensureDir(dir);
    res.json({ success: true, path: `prompt/stage/${name}` });
  } catch (err) {
    httpError(res, err);
  }
});

// POST /api/assets/:project/subscene
assetsRouter.post('/assets/:project/subscene', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const body = req.body as {
      stage?: string; label?: string; time?: string; angle?: string; weather?: string; description?: string;
    };
    if (!body.stage || !body.label) throw Object.assign(new Error('stage 与 label 必填'), { code: 'INVALID' });
    const stage = body.stage;
    const label = body.label;
    assertSafeName(stage, '场景名');
    assertSafeName(label, '子场景标签');
    const stageDir = resolveProjectPath(project, `prompt/stage/${stage}`);
    if (!(await pathExists(stageDir))) throw Object.assign(new Error('场景不存在'), { code: 'NOT_FOUND' });
    const file = path.join(stageDir, `${label}.md`);
    if (await pathExists(file)) throw Object.assign(new Error('子场景已存在'), { code: 'EXISTS' });
    await fs.writeFile(file, subsceneMd({
      label,
      time: body.time,
      angle: body.angle,
      weather: body.weather,
      description: body.description,
    }), 'utf-8');
    res.json({ success: true, path: `prompt/stage/${stage}/${label}.md` });
  } catch (err) {
    httpError(res, err);
  }
});

// POST /api/assets/:project/episode
assetsRouter.post('/assets/:project/episode', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const sceneRoot = resolveProjectPath(project, 'prompt/scene');
    await ensureDir(sceneRoot);
    let episode = (req.body as { episode?: string }).episode;
    if (episode === undefined || episode === null || episode === '') {
      episode = await nextNumericId(sceneRoot);
    } else {
      episode = String(episode);
      assertPositiveIntId(episode, '集数');
      if (await pathExists(path.join(sceneRoot, episode))) {
        throw Object.assign(new Error('集数已存在'), { code: 'EXISTS' });
      }
    }
    await ensureDir(path.join(sceneRoot, episode));
    res.json({ success: true, path: `prompt/scene/${episode}`, episode });
  } catch (err) {
    httpError(res, err);
  }
});

// POST /api/assets/:project/shot
assetsRouter.post('/assets/:project/shot', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const { episode, shot, position } = req.body as {
      episode?: string; shot?: string; position?: 'insert' | 'end';
    };
    if (!episode) throw Object.assign(new Error('episode 必填'), { code: 'INVALID' });
    assertPositiveIntId(String(episode), '集数');
    const epDir = resolveProjectPath(project, `prompt/scene/${episode}`);
    if (!(await pathExists(epDir))) throw Object.assign(new Error('集数不存在'), { code: 'NOT_FOUND' });

    const existing = await listNumericDirNames(epDir);
    const n = existing.length;
    let target: number;
    let renames: { from: string; to: string }[] = [];

    const mode = position === 'insert' || (shot && existing.includes(String(shot))) ? 'insert' : 'end';

    if (mode === 'end' && (!shot || shot === 'end')) {
      target = n === 0 ? 1 : Math.max(...existing.map(Number)) + 1;
    } else if (mode === 'end' && shot) {
      assertPositiveIntId(String(shot), '分镜');
      target = Number(shot);
      if (existing.includes(String(target))) {
        throw Object.assign(new Error('分镜已存在'), { code: 'EXISTS' });
      }
      // 允许指定大于 N+1 会破坏连续；强制只能是 N+1 或空位但不跳号：仅允许 max+1
      if (target !== (n === 0 ? 1 : Math.max(...existing.map(Number)) + 1)) {
        throw Object.assign(new Error('末尾新增只能使用下一个连续编号，中间插入请 position=insert'), { code: 'INVALID' });
      }
    } else {
      // insert
      if (!shot) throw Object.assign(new Error('插入时 shot 必填'), { code: 'INVALID' });
      assertPositiveIntId(String(shot), '分镜');
      target = Number(shot);
      if (target < 1 || target > n + 1) {
        throw Object.assign(new Error(`插入位置须在 1..${n + 1}`), { code: 'INVALID' });
      }
      renames = await shiftShotsUpForInsert(project, String(episode), target);
    }

    const shotId = String(target);
    const shotDir = path.join(epDir, shotId);
    await ensureDir(shotDir);
    await fs.writeFile(path.join(shotDir, 'overview.md'), shotOverviewMd(String(episode), shotId), 'utf-8');
    await fs.writeFile(path.join(shotDir, 'stage.json'), '[]\n', 'utf-8');
    await fs.writeFile(path.join(shotDir, 'script.json'), '[]\n', 'utf-8');
    await fs.writeFile(path.join(shotDir, 'prompt.md'), shotPromptMd(), 'utf-8');

    res.json({
      success: true,
      path: `prompt/scene/${episode}/${shotId}`,
      episode: String(episode),
      shot: shotId,
      renames,
    });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE character
assetsRouter.delete('/assets/:project/character/:name', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const name = req.params.name as string;
    assertSafeName(name, '角色名');
    const dir = resolveProjectPath(project, `prompt/character/${name}`);
    if (!(await pathExists(dir))) throw Object.assign(new Error('角色不存在'), { code: 'NOT_FOUND' });
    const refs = await findCharacterRefs(project, name);
    if (refs.length) throw Object.assign(new Error('资源正在被引用，无法删除'), { code: 'IN_USE', refs });
    await removeDirIfExists(dir);
    await removeDirIfExists(resolveProjectPath(project, `assert/character/${name}`));
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE stage
assetsRouter.delete('/assets/:project/stage/:name', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const name = req.params.name as string;
    assertSafeName(name, '场景名');
    const dir = resolveProjectPath(project, `prompt/stage/${name}`);
    if (!(await pathExists(dir))) throw Object.assign(new Error('场景不存在'), { code: 'NOT_FOUND' });
    const refs = await findStageRefs(project, name);
    if (refs.length) throw Object.assign(new Error('资源正在被引用，无法删除'), { code: 'IN_USE', refs });
    await removeDirIfExists(dir);
    await removeDirIfExists(resolveProjectPath(project, `assert/stage/${name}`));
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE subscene — label 可能含中文与连字符，用 * 或 query；Express :label 单段即可（标签无 /）
assetsRouter.delete('/assets/:project/subscene/:stage/:label', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const stage = req.params.stage as string;
    const label = req.params.label as string;
    assertSafeName(stage, '场景名');
    assertSafeName(label, '子场景标签');
    const file = resolveProjectPath(project, `prompt/stage/${stage}/${label}.md`);
    if (!(await pathExists(file))) throw Object.assign(new Error('子场景不存在'), { code: 'NOT_FOUND' });
    const refs = await findSubsceneRefs(project, stage, label);
    if (refs.length) throw Object.assign(new Error('资源正在被引用，无法删除'), { code: 'IN_USE', refs });
    await fs.unlink(file);
    const jpg = resolveProjectPath(project, `assert/stage/${stage}/${label}.jpg`);
    if (await pathExists(jpg)) await fs.unlink(jpg);
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE episode
assetsRouter.delete('/assets/:project/episode/:episode', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const episode = req.params.episode as string;
    assertPositiveIntId(episode, '集数');
    const dir = resolveProjectPath(project, `prompt/scene/${episode}`);
    if (!(await pathExists(dir))) throw Object.assign(new Error('集数不存在'), { code: 'NOT_FOUND' });
    await removeDirIfExists(dir);
    await removeDirIfExists(resolveProjectPath(project, `assert/scene/${episode}`));
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE shot + renumber
assetsRouter.delete('/assets/:project/shot/:episode/:shot', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const episode = req.params.episode as string;
    const shot = req.params.shot as string;
    assertPositiveIntId(episode, '集数');
    assertPositiveIntId(shot, '分镜');
    const dir = resolveProjectPath(project, `prompt/scene/${episode}/${shot}`);
    if (!(await pathExists(dir))) throw Object.assign(new Error('分镜不存在'), { code: 'NOT_FOUND' });
    await removeDirIfExists(dir);
    await removeDirIfExists(resolveProjectPath(project, `assert/scene/${episode}/${shot}`));
    const renames = await shiftShotsDownAfterDelete(project, episode, shot);
    res.json({ success: true, renames });
  } catch (err) {
    httpError(res, err);
  }
});

// POST reorder
assetsRouter.post('/assets/:project/scene/:episode/:shot/stage/reorder', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const episode = req.params.episode as string;
    const shot = req.params.shot as string;
    const { from, to } = req.body as { from?: number; to?: number };
    assertPositiveIntId(episode, '集数');
    assertPositiveIntId(shot, '分镜');
    if (typeof from !== 'number' || typeof to !== 'number') {
      throw Object.assign(new Error('from/to 必须是数字'), { code: 'INVALID' });
    }
    await reorderStageFrames(project, episode, shot, from, to);
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});
