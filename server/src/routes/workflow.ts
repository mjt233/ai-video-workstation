import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db.js';
import { getAllWorkflows } from '../workflow-engine.js';
import { getImpl } from '../workflows/registry.js';
import { normalizeUserParams } from '../workflows/user-params.js';
import { discoverTasks } from '../workflows/discovery.js';
import type { VideoWorkflowSubmitParams } from '../workflows/types.js';

export const workflowRouter = Router();

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
  const implDef = getImpl(workflowId, impl ?? 'default');
  const userVars = normalizeUserParams(implDef?.params, params.userParams);

  const taskId = uuidv4();
  db.createTask({
    id: taskId,
    project,
    workflow_id: workflowId,
    impl: impl ?? 'default',
    params: {
      vars: { ...(params.vars ?? {}), ...userVars },
      promptPaths: params.promptPaths ?? [],
      outputPath: params.outputPath,
      ...(params.video ? { video: params.video } : {}),
    },
  });

  db.addLog(taskId, 'info', `Task created: ${workflowId}/${impl ?? 'default'}`);

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
