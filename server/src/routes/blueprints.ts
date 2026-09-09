/**
 * 画布蓝图路由（`/api/blueprints`）。
 *
 * - `GET /api/blueprints?scope=&project=`——蓝图摘要列表（作用域内，按更新时间倒序）；
 * - `GET /api/blueprints/:id?scope=&project=`——单个蓝图详情（含 rev）；
 * - `POST /api/blueprints`——创建蓝图（body: scope/project/name/description/assetProject/payload/overwrite）；
 * - `PUT /api/blueprints/:id?scope=&project=`——局部更新（CAS：expectedRev，或 force=true）；
 * - `DELETE /api/blueprints/:id?scope=&project=`——删除；
 * - `POST /api/blueprints/import`——导入蓝图（body: scope/project/data/overwrite，data 为蓝图文件内容）。
 *
 * 作用域：scope=global（`server/config/blueprints/`）或 scope=project + project（`design/{project}/prompt/blueprint/`）。
 * 冲突语义：同名 409 EXISTS（携带 existingId）、版本不一致 409 VERSION_CONFLICT（携带 currentRev/expectedRev）。
 */
import { Router, type Request, type Response } from 'express';
import {
  createBlueprint,
  deleteBlueprint,
  getBlueprint,
  listBlueprints,
  updateBlueprint,
  type BlueprintScope,
} from '../blueprints/store.js';

export const blueprintsRouter = Router();

/**
 * 从请求中解析作用域参数（query 或 body 均可）。
 *
 * @param req 请求对象
 * @returns 作用域参数（scope 缺省 global；project 取自 query/body）
 */
function scopeFrom(req: Request): { scope: BlueprintScope; project?: string } {
  const rawScope = String((req.query.scope ?? (req.body as { scope?: unknown })?.scope ?? 'global'));
  const scope: BlueprintScope = rawScope === 'project' ? 'project' : 'global';
  const projectRaw = req.query.project ?? (req.body as { project?: unknown })?.project;
  const project = projectRaw === undefined || projectRaw === null ? undefined : String(projectRaw);
  return { scope, project };
}

/**
 * 统一错误响应（INVALID 400 / NOT_FOUND 404 / EXISTS 409 / VERSION_CONFLICT 409 / 其余 500）。
 *
 * @param res 响应对象
 * @param err 抛出的异常
 * @param fallback 未知异常时的兜底文案
 */
function blueprintError(res: Response, err: unknown, fallback: string): void {
  const e = err as { code?: string; message?: string; currentRev?: number; expectedRev?: number; existingId?: string };
  if (e?.code === 'INVALID') {
    res.status(400).json({ error: e.message, code: 'INVALID' });
    return;
  }
  if (e?.code === 'NOT_FOUND') {
    res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
    return;
  }
  if (e?.code === 'EXISTS') {
    res.status(409).json({ error: e.message, code: 'EXISTS', existingId: e.existingId });
    return;
  }
  if (e?.code === 'VERSION_CONFLICT') {
    res.status(409).json({
      error: e.message,
      code: 'VERSION_CONFLICT',
      currentRev: e.currentRev,
      expectedRev: e.expectedRev,
    });
    return;
  }
  console.error('[blueprints]', err);
  res.status(500).json({ error: fallback });
}

// GET /api/blueprints — 蓝图摘要列表
blueprintsRouter.get('/blueprints', async (req: Request, res: Response) => {
  try {
    const blueprints = await listBlueprints(scopeFrom(req));
    res.json({ blueprints });
  } catch (err) {
    blueprintError(res, err, '读取蓝图列表失败');
  }
});

// POST /api/blueprints/import — 导入蓝图（body.data 为蓝图文件内容）
blueprintsRouter.post('/blueprints/import', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      scope?: unknown;
      project?: unknown;
      data?: unknown;
      overwrite?: unknown;
      name?: unknown;
    };
    const scope: BlueprintScope = body.scope === 'project' ? 'project' : 'global';
    const data = body.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      res.status(400).json({ error: 'data 必须是蓝图对象', code: 'INVALID' });
      return;
    }
    const obj = data as { name?: unknown; description?: unknown; assetProject?: unknown };
    const blueprint = await createBlueprint({
      scope,
      project: body.project === undefined || body.project === null ? undefined : String(body.project),
      name: body.name === undefined ? obj.name : body.name,
      description: obj.description,
      assetProject: obj.assetProject,
      payload: data,
      overwrite: body.overwrite === true,
    });
    res.json({ blueprint });
  } catch (err) {
    blueprintError(res, err, '导入蓝图失败');
  }
});

// GET /api/blueprints/:id — 蓝图详情
blueprintsRouter.get('/blueprints/:id', async (req: Request, res: Response) => {
  try {
    const blueprint = await getBlueprint(scopeFrom(req), req.params.id as string);
    res.json({ blueprint });
  } catch (err) {
    blueprintError(res, err, '读取蓝图失败');
  }
});

// POST /api/blueprints — 创建蓝图
blueprintsRouter.post('/blueprints', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      scope?: unknown;
      project?: unknown;
      name?: unknown;
      description?: unknown;
      assetProject?: unknown;
      payload?: unknown;
      overwrite?: unknown;
    };
    const scope: BlueprintScope = body.scope === 'project' ? 'project' : 'global';
    const blueprint = await createBlueprint({
      scope,
      project: body.project === undefined || body.project === null ? undefined : String(body.project),
      name: body.name,
      description: body.description,
      assetProject: body.assetProject,
      payload: body.payload,
      overwrite: body.overwrite === true,
    });
    res.json({ blueprint });
  } catch (err) {
    blueprintError(res, err, '创建蓝图失败');
  }
});

// PUT /api/blueprints/:id — 局部更新蓝图（CAS）
blueprintsRouter.put('/blueprints/:id', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      scope?: unknown;
      project?: unknown;
      name?: unknown;
      description?: unknown;
      assetProject?: unknown;
      nodes?: unknown;
      connections?: unknown;
      groups?: unknown;
      expectedRev?: unknown;
      force?: unknown;
    };
    const scope: BlueprintScope = body.scope === 'project' ? 'project' : 'global';
    const patch: Parameters<typeof updateBlueprint>[0]['patch'] = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.assetProject !== undefined) patch.assetProject = body.assetProject;
    if (body.nodes !== undefined) patch.nodes = body.nodes;
    if (body.connections !== undefined) patch.connections = body.connections;
    if (body.groups !== undefined) patch.groups = body.groups;
    const blueprint = await updateBlueprint({
      scope,
      project: body.project === undefined || body.project === null ? undefined : String(body.project),
      id: req.params.id as string,
      patch,
      expectedRev: body.expectedRev === undefined || body.expectedRev === null ? undefined : Number(body.expectedRev),
      force: body.force === true,
    });
    res.json({ blueprint });
  } catch (err) {
    blueprintError(res, err, '保存蓝图失败');
  }
});

// DELETE /api/blueprints/:id — 删除蓝图
blueprintsRouter.delete('/blueprints/:id', async (req: Request, res: Response) => {
  try {
    await deleteBlueprint(scopeFrom(req), req.params.id as string);
    res.json({ success: true });
  } catch (err) {
    blueprintError(res, err, '删除蓝图失败');
  }
});
