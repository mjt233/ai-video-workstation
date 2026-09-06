/**
 * 预设提示词路由：系统配置 → 预设提示词的增删改查。
 *
 * - GET /api/presets：全部预设列表（系统级全局共享，不区分项目）；
 * - POST /api/presets：新增预设（name/content 必填非空）；
 * - PUT /api/presets/:id：部分更新预设；
 * - DELETE /api/presets/:id：删除预设。
 */
import { Router, type Request, type Response } from 'express';
import {
  createPreset, deletePreset, listPresets, updatePreset,
} from '../presets/store.js';

export const presetsRouter = Router();

// GET /api/presets — 预设提示词列表
presetsRouter.get('/presets', async (_req: Request, res: Response) => {
  try {
    const presets = await listPresets();
    res.json({ presets });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: `读取预设提示词失败: ${msg}` });
  }
});

// POST /api/presets — 新增预设提示词
presetsRouter.post('/presets', async (req: Request, res: Response) => {
  const { name, content } = req.body as { name?: unknown; content?: unknown };
  try {
    const preset = await createPreset({ name: String(name ?? ''), content: String(content ?? '') });
    res.json({ preset });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

// PUT /api/presets/:id — 更新预设提示词（name/content 可部分更新）
presetsRouter.put('/presets/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { name, content } = req.body as { name?: unknown; content?: unknown };
  const input: { name?: string; content?: string } = {};
  if (name !== undefined) input.name = String(name);
  if (content !== undefined) input.content = String(content);
  try {
    const preset = await updatePreset(id, input);
    res.json({ preset });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

// DELETE /api/presets/:id — 删除预设提示词
presetsRouter.delete('/presets/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    await deletePreset(id);
    res.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});
