import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db.js';
import type { TaskRecord } from '../db.js';
import { getAllWorkflows } from '../workflow-engine.js';
import { getImpl, getImplementations } from '../workflows/registry.js';
import { normalizeUserParams } from '../workflows/user-params.js';
import { discoverTasks } from '../workflows/discovery.js';
import { getProviderConfig, getProviderConfigMasked, setProviderConfig } from '../providers/config-store.js';
import { getAllProviders, getProvider } from '../providers/registry.js';
import type { VideoWorkflowSubmitParams, WorkflowCapabilities } from '../workflows/types.js';

export const workflowRouter = Router();

/**
 * 解析工作流实现：指定实现存在则用之，否则回退到该工作流类型的第一个实现。
 *
 * 画布【生成视频】节点新建时 workflowImpl 可能未初始化（提交 'default'），
 * 而部分工作流类型（如 image-to-video）没有名为 default 的实现；
 * 此处兜底保证任务总能落到一个真实实现上。
 *
 * @param workflowId 工作流类型 ID
 * @param impl 请求的实现标识（可能缺失或非法）
 * @returns 可用的实现标识
 */
export function resolveImpl(workflowId: string, impl?: string): string {
  const requested = impl ?? 'default';
  const impls = getImplementations(workflowId);
  if (impls.some((w) => w.impl === requested)) {
    return requested;
  }
  return impls[0]?.impl ?? 'default';
}

// GET /api/providers — 列出所有 Provider 插件及其配置（secret 字段脱敏为 '__set__'）
workflowRouter.get('/providers', async (_req: Request, res: Response) => {
  try {
    const providers = await Promise.all(
      getAllProviders().map(async (p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        configSchema: p.configSchema,
        config: await getProviderConfigMasked(p.id),
      })),
    );
    res.json({ providers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: `读取 Provider 配置失败: ${msg}` });
  }
});

// PUT /api/providers/:id — 保存 Provider 配置（按 schema 校验；secret 空串保留原值）
workflowRouter.put('/providers/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { config } = req.body as { config?: Record<string, unknown> };
  if (!config || typeof config !== 'object') {
    res.status(400).json({ error: 'Missing body: config' });
    return;
  }
  try {
    await setProviderConfig(id, config);
    res.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

// GET /api/workflows — list available workflow types and implementations
workflowRouter.get('/workflows', (_req: Request, res: Response) => {
  res.json({ workflows: getAllWorkflows() });
});

// POST /api/workflow/run — submit a generation task
workflowRouter.post('/workflow/run', (req: Request, res: Response) => {
  const { project, workflowId, impl, params } = req.body as {
    project: string;
    workflowId: string;
    impl?: string;
    params: {
      vars?: Record<string, string>;
      promptPaths?: string[];
      outputPath: string;
      /** 用户手动传入的工作流参数（key → 值，仅保留所选实现声明的 key） */
      userParams?: Record<string, unknown>;
      /** 视频自包含提交参数（wire 形态，画布【生成视频】节点提交） */
      video?: VideoWorkflowSubmitParams;
    };
  };

  if (!project || !workflowId || !params?.outputPath) {
    res.status(400).json({ error: 'Missing required fields: project, workflowId, params.outputPath' });
    return;
  }

  // 用户手动传入的参数：仅保留所选实现声明的 key，按类型规范化后合并进 vars
  // 实现缺失/非法时回退到第一个实现（如 image-to-video 无 default 实现）
  const resolvedImpl = resolveImpl(workflowId, impl);
  const implDef = getImpl(workflowId, resolvedImpl);
  const userVars = normalizeUserParams(implDef?.params, params.userParams);

  const taskId = uuidv4();
  db.createTask({
    id: taskId,
    project,
    workflow_id: workflowId,
    impl: resolvedImpl,
    params: {
      vars: { ...(params.vars ?? {}), ...userVars },
      promptPaths: params.promptPaths ?? [],
      outputPath: params.outputPath,
      ...(params.video ? { video: params.video } : {}),
    },
  });

  db.addLog(taskId, 'info', `Task created: ${workflowId}/${resolvedImpl}`);

  res.json({ taskId, status: 'pending' });
});

/**
 * 解析任务 params（JSON 字符串）为结构化对象。
 *
 * @param paramsJson - 任务 params 的 JSON 字符串
 * @returns 结构化 params：vars 业务变量、promptPaths 提示词路径、outputPath 输出路径；
 *          video 为视频自包含提交参数（wire 形态，可选）；
 *          remoteTaskId 为提交成功后持久化的远端（Bridge）任务 ID（可选，供中断使用）
 */
export function parseTaskParams(paramsJson: string): {
  vars: Record<string, string>
  promptPaths: string[]
  outputPath: string
  video?: VideoWorkflowSubmitParams
  /** 提交成功后持久化的远端（Bridge）任务 ID，供中断使用 */
  remoteTaskId?: string
} {
  try {
    const parsed = JSON.parse(paramsJson) as {
      vars?: Record<string, string>
      promptPaths?: string[]
      outputPath?: string
      video?: VideoWorkflowSubmitParams
      remoteTaskId?: string
    };
    return {
      vars: parsed.vars ?? {},
      promptPaths: parsed.promptPaths ?? [],
      outputPath: parsed.outputPath ?? '',
      video: parsed.video,
      remoteTaskId: parsed.remoteTaskId,
    };
  } catch {
    return { vars: {}, promptPaths: [], outputPath: '' };
  }
}

function toTaskResponse(task: db.TaskRecord) {
  return {
    taskId: task.id,
    workflowId: task.workflow_id,
    impl: task.impl,
    status: task.status,
    result: task.result ? JSON.parse(task.result) : null,
    errorMsg: task.error_msg,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    params: parseTaskParams(task.params),
  };
}

/** 从任务 params 解析远端（Bridge）任务 ID */
export function getRemoteTaskId(task: TaskRecord): string | undefined {
  return parseTaskParams(task.params).remoteTaskId;
}

/**
 * 判断任务是否可中断，并返回拒绝原因。
 *
 * @param task 任务记录
 * @param wf 工作流实现（可为空）
 * @returns ok=true 可中断；否则携带 HTTP 状态码、错误码与消息
 */
export function canCancelTask(
  task: TaskRecord,
  wf: { capabilities?: WorkflowCapabilities } | undefined,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  if (!wf?.capabilities?.cancelable) {
    return { ok: false, status: 400, code: 'not_cancelable', message: '该工作流不支持中断' };
  }
  if (task.status === 'pending') {
    // 本地排队未提交远端 → 直接本地取消
    return { ok: true };
  }
  if (task.status !== 'running') {
    return { ok: false, status: 400, code: 'invalid_status', message: `任务状态不是 pending 或 running（当前 ${task.status}）` };
  }
  if (!getRemoteTaskId(task) && !wf?.capabilities?.deferredCancel) {
    return { ok: false, status: 400, code: 'no_remote_task', message: '任务尚未提交到远端，无法中断' };
  }
  return { ok: true };
}

// GET /api/workflow/tasks/:taskId — get task status
workflowRouter.get('/workflow/tasks/:taskId', (req: Request, res: Response) => {
  const task = db.getTask(req.params.taskId as string);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(toTaskResponse(task));
});

// GET /api/workflow/tasks — list tasks with optional filters
workflowRouter.get('/workflow/tasks', (req: Request, res: Response) => {
  const project = req.query.project as string | undefined;
  const status = req.query.status as string | undefined;
  const batchId = req.query.batchId as string | undefined;
  const tasks = db.listTasks(project, status, batchId);
  res.json({
    tasks: tasks.map(t => toTaskResponse(t)),
  });
});

// GET /api/workflow/tasks/:taskId/log — get task logs
workflowRouter.get('/workflow/tasks/:taskId/log', (req: Request, res: Response) => {
  const logs = db.getTaskLogs(req.params.taskId as string);
  res.json({ logs });
});

// POST /api/workflow/retry/:taskId — retry a failed task
workflowRouter.post('/workflow/retry/:taskId', (req: Request, res: Response) => {
  const existing = db.getTask(req.params.taskId as string);
  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const newTaskId = uuidv4();
  db.createTask({
    id: newTaskId,
    project: existing.project,
    workflow_id: existing.workflow_id,
    impl: existing.impl,
    params: JSON.parse(existing.params),
    batch_id: existing.batch_id ?? undefined,
    phase: existing.phase,
  });

  db.addLog(newTaskId, 'info', `Retry of task ${existing.id}`);

  res.json({ taskId: newTaskId, status: 'pending' });
});

// POST /api/workflow/tasks/:taskId/cancel — 中断任务（本地排队直接失败 / 运行中调 Bridge cancel）
workflowRouter.post('/workflow/tasks/:taskId/cancel', async (req: Request, res: Response) => {
  const task = db.getTask(req.params.taskId as string);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const wf = getImpl(task.workflow_id, task.impl);
  const decision = canCancelTask(task, wf);
  if (!decision.ok) {
    res.status(decision.status).json({ error: decision.code, message: decision.message });
    return;
  }

  try {
    if (task.status === 'running') {
      const providerId = wf?.provider ?? 'comfyui-bridge';
      const providerDef = getProvider(providerId);
      if (!providerDef) {
        throw new Error(`provider 未注册: ${providerId}`);
      }
      await providerDef
        .createClient(await getProviderConfig(providerId))
        .cancel(getRemoteTaskId(task)!);
    }
    db.updateTaskStatus(task.id, 'failed', { error_msg: '用户中断' });
    db.addLog(task.id, 'info', 'Task cancelled by user');
    res.json({ taskId: task.id, status: 'failed' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: 'cancel_failed', message: msg });
  }
});

// POST /api/workflow/batch-run — submit batch generation tasks
workflowRouter.post('/workflow/batch-run', async (req: Request, res: Response) => {
  const { project, assetTypes, concurrency, overwrite, implByAssetType, userParamsByAssetType } = req.body as {
    project: string;
    assetTypes: string[];
    concurrency?: number;
    overwrite?: boolean;
    /** 资产类型 → 工作流实现（如 character-appearance → default/flux） */
    implByAssetType?: Record<string, string>;
    /** 资产类型 → 用户手动传入的工作流参数（key → 值，仅保留该资产类型所选实现声明的 key） */
    userParamsByAssetType?: Record<string, Record<string, unknown>>;
  };

  if (!project || !Array.isArray(assetTypes) || assetTypes.length === 0) {
    res.status(400).json({ error: 'Missing required fields: project, assetTypes' });
    return;
  }

  try {
    const discovered = await discoverTasks(project, assetTypes, overwrite ?? false, implByAssetType);

    // No eligible assets — do not create an empty batch
    if (discovered.length === 0) {
      res.json({ batchId: null, totalTasks: 0, project });
      return;
    }

    // 资产类型 → 执行阶段映射
    // Phase 0：无依赖（角色外观/声音、场景图片）
    // Phase 1：依赖 Phase 0 产出（分镜场景图、衍生变体、分镜语音）
    // Phase 2：依赖 Phase 1 产出（视频）
    const ASSET_PHASE: Record<string, number> = {
      'character-appearance': 0,
      'character-voice': 0,
      'stage-image': 0,
      'variant-edit': 1,
      'scene-stage-image': 1,
      'scene-tts': 1,
      'video-generate': 2,
    };

    const batchId = uuidv4();

    for (const task of discovered) {
      const phase = ASSET_PHASE[task.assetType ?? ''] ?? 0;
      // 用户手动传入的参数：按该任务实际实现（workflowId + impl）的声明规范化后合并进 vars
      const implDef = getImpl(task.workflowId, task.impl);
      const userVars = normalizeUserParams(
        implDef?.params,
        task.assetType ? userParamsByAssetType?.[task.assetType] : undefined,
      );
      db.createTask({
        id: uuidv4(),
        project,
        workflow_id: task.workflowId,
        impl: task.impl,
        params: {
          vars: { ...task.vars, ...userVars },
          promptPaths: task.promptPaths,
          outputPath: task.outputPath,
        },
        batch_id: batchId,
        phase,
      });
    }

    const effectiveConcurrency = Math.max(1, Math.min(10, Math.floor(concurrency ?? 1)));
    storeBatchConfig(batchId, effectiveConcurrency);

    res.json({ batchId, totalTasks: discovered.length, project });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Batch creation failed: ${msg}` });
  }
});

// GET /api/workflow/batch/:batchId — query batch status
workflowRouter.get('/workflow/batch/:batchId', (req: Request, res: Response) => {
  const summary = db.getBatchSummary(req.params.batchId as string);
  if (!summary) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }
  res.json(summary);
});

// In-memory batch concurrency config (keyed by batchId)
const batchConcurrencyMap = new Map<string, number>();

function storeBatchConfig(batchId: string, concurrency: number): void {
  batchConcurrencyMap.set(batchId, concurrency);
}

export function getBatchConcurrency(batchId: string): number {
  return batchConcurrencyMap.get(batchId) ?? 1;
}
