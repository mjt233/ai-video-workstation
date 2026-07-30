import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
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
  shotOverviewJson,
  shotPromptMd,
  subsceneMd,
} from '../assets/templates.js';
import { findCharacterRefs, findStageRefs, findSubsceneRefs } from '../assets/refs.js';
import { removeDirIfExists, shiftShotsDownAfterDelete, shiftShotsUpForInsert } from '../assets/shot-renumber.js';
import { reorderStageFrames } from '../assets/stage-reorder.js';
import { reorderScriptEntries, deleteScriptEntry, updateScriptEntry } from '../assets/script-reorder.js';
import { mergeSceneAudio } from '../assets/audio-merge.js';
import { addStageFrame, deleteStageFrame, updateStageFrame, type StageFrameInput } from '../assets/stage-frames.js';
import {
  activateHistoryVersion,
  deleteHistoryVersion,
  listAssetHistory,
  saveUploadedAsset,
} from '../assets/history.js';
import {
  createCharacterVariant,
  createStageVariant,
  deleteCharacterVariant,
  deleteStageVariant,
  listCharacterVariants,
  listStageVariants,
  renameCharacterVariant,
  renameStageVariant,
  updateCharacterVariant,
  updateStageVariant,
} from '../assets/variants.js';

export const assetsRouter = Router();

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      cb(Object.assign(new Error('仅支持 JPG / PNG / WebP 图片'), { code: 'INVALID' }));
      return;
    }
    cb(null, true);
  },
});

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
    await fs.writeFile(
      path.join(shotDir, 'overview.json'),
      `${JSON.stringify(shotOverviewJson(), null, 2)}\n`,
      'utf-8',
    );
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

// POST 重新排序分镜台词（同步语音文件）
assetsRouter.post('/assets/:project/scene/:episode/:shot/script/reorder', async (req: Request, res: Response) => {
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
    await reorderScriptEntries(project, episode, shot, from, to);
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE 删除分镜台词（同步语音文件）
assetsRouter.delete('/assets/:project/scene/:episode/:shot/script/:index', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const episode = req.params.episode as string;
    const shot = req.params.shot as string;
    const index = Number(req.params.index);
    assertPositiveIntId(episode, '集数');
    assertPositiveIntId(shot, '分镜');
    if (!Number.isInteger(index) || index < 0) {
      throw Object.assign(new Error('index 必须是非负整数'), { code: 'INVALID' });
    }
    await deleteScriptEntry(project, episode, shot, index);
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// PUT 更新分镜台词（角色变更时同步删除旧语音文件）
assetsRouter.put('/assets/:project/scene/:episode/:shot/script/:index', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const episode = req.params.episode as string;
    const shot = req.params.shot as string;
    const index = Number(req.params.index);
    assertPositiveIntId(episode, '集数');
    assertPositiveIntId(shot, '分镜');
    if (!Number.isInteger(index) || index < 0) {
      throw Object.assign(new Error('index 必须是非负整数'), { code: 'INVALID' });
    }
    const { 角色名, 台词, 情绪 } = req.body as { 角色名?: string; 台词?: string; 情绪?: string };
    if (!角色名) {
      throw Object.assign(new Error('角色名不能为空'), { code: 'INVALID' });
    }
    await updateScriptEntry(project, episode, shot, index, {
      角色名,
      台词: 台词 ?? '',
      情绪: 情绪 ?? '',
    });
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// POST 合并分镜音频（根据 audio-edit.json 生成 merged.flac）
assetsRouter.post('/assets/:project/scene/:episode/:shot/audio/merge', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const episode = req.params.episode as string;
    const shot = req.params.shot as string;
    assertPositiveIntId(episode, '集数');
    assertPositiveIntId(shot, '分镜');
    const outputPath = await mergeSceneAudio(project, episode, shot);
    res.json({ success: true, path: outputPath });
  } catch (err) {
    httpError(res, err);
  }
});

// POST 新增分镜场景帧
assetsRouter.post('/assets/:project/scene/:episode/:shot/stage', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const episode = req.params.episode as string;
    const shot = req.params.shot as string;
    assertPositiveIntId(episode, '集数');
    assertPositiveIntId(shot, '分镜');
    const body = req.body as StageFrameInput & { index?: number };
    const result = await addStageFrame(project, episode, shot, body, body.index);
    res.json({ success: true, index: result.index });
  } catch (err) {
    httpError(res, err);
  }
});

// PUT 更新分镜场景帧
assetsRouter.put('/assets/:project/scene/:episode/:shot/stage/:index', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const episode = req.params.episode as string;
    const shot = req.params.shot as string;
    const index = Number(req.params.index);
    assertPositiveIntId(episode, '集数');
    assertPositiveIntId(shot, '分镜');
    if (!Number.isInteger(index) || index < 0) {
      throw Object.assign(new Error('index 必须是非负整数'), { code: 'INVALID' });
    }
    await updateStageFrame(project, episode, shot, index, req.body as StageFrameInput);
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE 删除分镜场景帧（至少保留 1 个）
assetsRouter.delete('/assets/:project/scene/:episode/:shot/stage/:index', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const episode = req.params.episode as string;
    const shot = req.params.shot as string;
    const index = Number(req.params.index);
    assertPositiveIntId(episode, '集数');
    assertPositiveIntId(shot, '分镜');
    if (!Number.isInteger(index) || index < 0) {
      throw Object.assign(new Error('index 必须是非负整数'), { code: 'INVALID' });
    }
    await deleteStageFrame(project, episode, shot, index);
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// GET 资产历史版本列表  ?path=assert/...
assetsRouter.get('/assets/:project/history', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const assetPath = String(req.query.path ?? '');
    if (!assetPath) throw Object.assign(new Error('path 必填'), { code: 'INVALID' });
    const versions = await listAssetHistory(project, assetPath);
    res.json({ versions });
  } catch (err) {
    httpError(res, err);
  }
});

// POST 激活历史版本
// body: { path: "assert/...", versionPath: "assert/.../history/.../xxx.jpg" }
assetsRouter.post('/assets/:project/history/activate', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const { path: assetPath, versionPath } = req.body as { path?: string; versionPath?: string };
    if (!assetPath || !versionPath) {
      throw Object.assign(new Error('path 与 versionPath 必填'), { code: 'INVALID' });
    }
    const result = await activateHistoryVersion(project, assetPath, versionPath);
    res.json({ success: true, ...result });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE 删除历史版本
// body: { path: "assert/...", versionPath: "assert/.../history/.../xxx.jpg" }
assetsRouter.delete('/assets/:project/history', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const { path: assetPath, versionPath } = req.body as { path?: string; versionPath?: string };
    if (!assetPath || !versionPath) {
      throw Object.assign(new Error('path 与 versionPath 必填'), { code: 'INVALID' });
    }
    const result = await deleteHistoryVersion(project, assetPath, versionPath);
    res.json({ success: true, ...result });
  } catch (err) {
    httpError(res, err);
  }
});

/**
 * POST 上传图片资产（角色外观 / 场景设定图 / 分镜场景图）
 * multipart: file + path（assert 相对路径，扩展名固定 .jpg）
 * 若已有当前资产，先归档历史再写入。
 */
assetsRouter.post(
  '/assets/:project/upload',
  (req: Request, res: Response, next) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        httpError(res, err);
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      const project = req.params.project as string;
      const assetPath = String((req.body as { path?: string }).path ?? '');
      if (!assetPath) throw Object.assign(new Error('path 必填'), { code: 'INVALID' });
      const file = req.file;
      if (!file?.buffer?.length) {
        throw Object.assign(new Error('请选择要上传的图片文件'), { code: 'INVALID' });
      }
      const result = await saveUploadedAsset(project, assetPath, file.buffer);
      res.json({ success: true, ...result });
    } catch (err) {
      httpError(res, err);
    }
  },
);


// ── 衍生变体 API ────────────────────────────────────────────────────

// GET 角色衍生变体列表
assetsRouter.get('/assets/:project/character/:name/variants', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const name = req.params.name as string;
    const variants = await listCharacterVariants(project, name);
    res.json({ variants });
  } catch (err) {
    httpError(res, err);
  }
});

// POST 创建角色衍生变体
assetsRouter.post('/assets/:project/character/:name/variants', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const name = req.params.name as string;
    const body = req.body as { id?: string; desc?: string; parentId?: string; refs?: string[] };
    if (!body.id || !body.desc) {
      throw Object.assign(new Error('id 与 desc 必填'), { code: 'INVALID' });
    }
    const variant = await createCharacterVariant(project, name, {
      id: body.id,
      desc: body.desc,
      parentId: body.parentId,
      refs: body.refs,
    });
    res.json({ success: true, variant });
  } catch (err) {
    httpError(res, err);
  }
});

// PUT 更新角色衍生变体描述
assetsRouter.put('/assets/:project/character/:name/variants/:variantId', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const name = req.params.name as string;
    const variantId = req.params.variantId as string;
    const body = req.body as { desc?: string; parentId?: string; refs?: string[] };
    const variant = await updateCharacterVariant(project, name, variantId, {
      desc: body.desc,
      parentId: body.parentId,
      refs: body.refs,
    });
    res.json({ success: true, variant });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE 删除角色衍生变体
assetsRouter.delete('/assets/:project/character/:name/variants/:variantId', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const name = req.params.name as string;
    const variantId = req.params.variantId as string;
    const cascade = req.query.cascade === 'true';
    await deleteCharacterVariant(project, name, variantId, cascade ? { cascade: true } : undefined);
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// PUT /assets/:project/character/:name/variants/:variantId/rename
assetsRouter.put('/assets/:project/character/:name/variants/:variantId/rename', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const name = req.params.name as string;
    const variantId = req.params.variantId as string;
    const { newId } = req.body as { newId?: string };
    if (!newId) throw Object.assign(new Error('newId 必填'), { code: 'INVALID' });
    const variant = await renameCharacterVariant(project, name, variantId, newId);
    res.json({ success: true, variant });
  } catch (err) {
    httpError(res, err);
  }
});

// GET 场景子场景衍生变体列表
assetsRouter.get('/assets/:project/stage/:stage/:label/variants', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const stage = req.params.stage as string;
    const label = req.params.label as string;
    const variants = await listStageVariants(project, stage, label);
    res.json({ variants });
  } catch (err) {
    httpError(res, err);
  }
});

// POST 创建场景衍生变体
assetsRouter.post('/assets/:project/stage/:stage/:label/variants', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const stage = req.params.stage as string;
    const label = req.params.label as string;
    const body = req.body as { id?: string; desc?: string; parentId?: string; refs?: string[] };
    if (!body.id || !body.desc) {
      throw Object.assign(new Error('id 与 desc 必填'), { code: 'INVALID' });
    }
    const variant = await createStageVariant(project, stage, label, {
      id: body.id,
      desc: body.desc,
      parentId: body.parentId,
      refs: body.refs,
    });
    res.json({ success: true, variant });
  } catch (err) {
    httpError(res, err);
  }
});

// PUT 更新场景衍生变体
assetsRouter.put('/assets/:project/stage/:stage/:label/variants/:variantId', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const stage = req.params.stage as string;
    const label = req.params.label as string;
    const variantId = req.params.variantId as string;
    const body = req.body as { desc?: string; parentId?: string; refs?: string[] };
    const variant = await updateStageVariant(project, stage, label, variantId, {
      desc: body.desc,
      parentId: body.parentId,
      refs: body.refs,
    });
    res.json({ success: true, variant });
  } catch (err) {
    httpError(res, err);
  }
});

// DELETE 删除场景衍生变体
assetsRouter.delete('/assets/:project/stage/:stage/:label/variants/:variantId', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const stage = req.params.stage as string;
    const label = req.params.label as string;
    const variantId = req.params.variantId as string;
    const cascade = req.query.cascade === 'true';
    await deleteStageVariant(project, stage, label, variantId, cascade ? { cascade: true } : undefined);
    res.json({ success: true });
  } catch (err) {
    httpError(res, err);
  }
});

// PUT /assets/:project/stage/:stage/:label/variants/:variantId/rename
assetsRouter.put('/assets/:project/stage/:stage/:label/variants/:variantId/rename', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const stage = req.params.stage as string;
    const label = req.params.label as string;
    const variantId = req.params.variantId as string;
    const { newId } = req.body as { newId?: string };
    if (!newId) throw Object.assign(new Error('newId 必填'), { code: 'INVALID' });
    const variant = await renameStageVariant(project, stage, label, variantId, newId);
    res.json({ success: true, variant });
  } catch (err) {
    httpError(res, err);
  }
});
