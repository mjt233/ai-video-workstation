import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db.js';
import type { TaskRecord } from '../db.js';
import { getAllWorkflows } from '../workflow-engine.js';
import { getAllWorkflowTypes, getImpl, unregisterByInstance } from '../workflows/registry.js';
import { normalizeUserParams } from '../workflows/user-params.js';
import { discoverTasks, type DiscoveredTask } from '../workflows/discovery.js';
import { markCancelRequested, stripCancelRequested } from '../workflows/cancel.js';
import {
  MASKED_SECRET,
  createInstance,
  deleteInstance,
  getInstance,
  getInstanceConfigMasked,
  listInstances,
  resolveInstanceConfig,
  resolveProviderConfig,
  updateInstance,
} from '../providers/config-store.js';
import { getAllProviders, getProvider } from '../providers/registry.js';
import type { ProviderConfigValue, ProviderDefinition } from '../providers/types.js';
import { syncInstance } from '../providers/instance-sync.js';
import { CUSTOM_PROVIDER_ID, validateCustomProviderConfig } from '../providers/custom/index.js';
import type { ComfyuiBridgeClient } from '../providers/comfyui-bridge/client.js';
import type { VideoWorkflowSubmitParams, WorkflowCapabilities, WorkflowDefinition } from '../workflows/types.js';

export const workflowRouter = Router();

/**
 * 校验用户显式提交的工作流实现。
 *
 * 后端不再为缺失/非法 impl 做任何兜底：调用方必须明确指定一个已注册的可执行实现
 * （getImpl 仅返回已绑定服务商实例的定义），避免「界面显示某个默认实现、实际执行
 * 另一个实现」的隐性不一致，也避免静默切换到付费云或本地 Bridge。
 *
 * @param workflowId 工作流类型 ID（如 image-edit）
 * @param impl 请求的实现标识（可为 undefined / 空串 / 非法值）
 * @returns 校验通过时返回 ok=true 与规范化实现标识/定义；否则 ok=false 与错误码/提示
 */
export function validateWorkflowImpl(
  workflowId: string,
  impl: string | undefined,
): { ok: true; impl: string; implDef: WorkflowDefinition } | { ok: false; code: string; message: string } {
  const trimmed = typeof impl === 'string' ? impl.trim() : '';
  if (!trimmed) {
    return { ok: false, code: 'workflow_impl_required', message: `工作流类型 ${workflowId} 必须显式指定工作流实现（impl）` };
  }
  const implDef = getImpl(workflowId, trimmed);
  if (!implDef) {
    return { ok: false, code: 'workflow_impl_not_found', message: `工作流实现不存在或未绑定服务商实例: ${workflowId}/${trimmed}` };
  }
  return { ok: true, impl: trimmed, implDef };
}

/** 批量任务解析结果条目：任务描述 + 已校验的实现标识与定义 */
export interface ValidatedDiscoveredTask {
  /** 发现阶段生成的任务描述 */
  task: DiscoveredTask;
  /** 规范化后的实现标识（非空、已绑定实例） */
  impl: string;
  /** 实现定义（参数规范化/提供商判断用） */
  implDef: WorkflowDefinition;
}

/**
 * 批量校验发现任务的实现选择：任一任务缺失/非法实现即整体失败。
 *
 * 与 /workflow/run 同一语义：校验失败时不创建任何任务（避免半截批次），
 * 错误消息汇总全部失败任务，供前端一次性展示。
 *
 * @param tasks 发现阶段生成的任务列表
 * @returns 全部合法时 ok=true 与解析结果；否则 ok=false 与汇总错误消息
 */
export function validateDiscoveredImpls(
  tasks: DiscoveredTask[],
): { ok: true; resolved: ValidatedDiscoveredTask[] } | { ok: false; message: string } {
  const resolved: ValidatedDiscoveredTask[] = [];
  const missing: string[] = [];
  for (const task of tasks) {
    const v = validateWorkflowImpl(task.workflowId, task.impl);
    if (!v.ok) {
      missing.push(`${task.assetType ?? task.workflowId}: ${v.message}`);
      continue;
    }
    resolved.push({ task, impl: v.impl, implDef: v.implDef });
  }
  if (missing.length > 0) {
    return { ok: false, message: `以下任务未显式指定可用的工作流实现：${missing.join('；')}` };
  }
  return { ok: true, resolved };
}

/**
 * 从用户提交的工作流参数中提取 ComfyUI Easy Bridge 执行提供商实例 ID。

 * providerId 是 Bridge 执行接口的保留键（本次执行显式指定的实例），不属于工作流参数；
 * 前端以 userParams.providerId 携带，本函数在入库前提取并独立存储（不混入 vars）。
 *
 * @param raw 用户提交的原始参数对象（可为空）
 * @returns 非空字符串（trim 后）的提供商实例 ID；缺失/非字符串/空串返回 undefined
 */
export function extractComfyuiProviderId(raw: Record<string, unknown> | undefined): string | undefined {
  const v = raw?.providerId;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed !== '' ? trimmed : undefined;
}

// GET /api/providers — 服务商类型列表 + 实例列表（config 脱敏）
workflowRouter.get('/providers', async (_req: Request, res: Response) => {
  try {
    const types = getAllProviders().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      configSchema: p.configSchema,
    }));
    const instances = await listInstances();
    const instanceInfos = await Promise.all(instances.map(async (inst) => ({
      id: inst.id,
      type: inst.type,
      name: inst.name,
      config: getInstanceConfigMasked(inst),
    })));
    res.json({ types, instances: instanceInfos });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: `读取服务商配置失败: ${msg}` });
  }
});

// POST /api/providers/instances — 新增服务商实例（创建后触发实例工作流同步，默认全量可用）
workflowRouter.post('/providers/instances', async (req: Request, res: Response) => {
  const { type, name, config } = req.body as {
    type?: string;
    name?: string;
    config?: Record<string, unknown>;
  };
  if (!type || !name || !config || typeof config !== 'object') {
    res.status(400).json({ error: 'Missing body: type/name/config' });
    return;
  }
  // 自定义服务商：保存前校验工作流配置结构与代码可编译（避免保存后同步静默失败）
  if (type === CUSTOM_PROVIDER_ID) {
    const errors = validateCustomProviderConfig(config);
    if (errors.length > 0) {
      res.status(400).json({ error: '自定义服务商配置校验失败：\n' + errors.join('\n') });
      return;
    }
  }
  try {
    const instance = await createInstance({ type, name, config });
    await syncInstance(instance);
    res.json({ instance: { ...instance, config: getInstanceConfigMasked(instance) } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

// PUT /api/providers/instances/:id — 更新服务商实例（secret 空串保留原值；更新后触发同步）
workflowRouter.put('/providers/instances/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { name, config } = req.body as {
    name?: string;
    config?: Record<string, unknown>;
  };
  // 自定义服务商：保存前校验工作流配置结构与代码可编译
  if (config && typeof config === 'object') {
    const existing = await getInstance(id);
    if (existing && existing.type === CUSTOM_PROVIDER_ID) {
      const errors = validateCustomProviderConfig(config);
      if (errors.length > 0) {
        res.status(400).json({ error: '自定义服务商配置校验失败：\n' + errors.join('\n') });
        return;
      }
    }
  }
  try {
    const instance = await updateInstance(id, { name, config });
    await syncInstance(instance);
    res.json({ instance: { ...instance, config: getInstanceConfigMasked(instance) } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

// DELETE /api/providers/instances/:id — 删除服务商实例（注销其全部工作流）
workflowRouter.delete('/providers/instances/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    await deleteInstance(id);
    unregisterByInstance(id, new Set());
    res.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

// POST /api/providers/test — 连接测试（用当前表单参数，不落盘）。
// 编辑模式携带 instanceId：未填写的 secret 字段回填已保存值（表单不回显 secret）。
workflowRouter.post('/providers/test', async (req: Request, res: Response) => {
  const { type, config, instanceId } = req.body as {
    type?: string;
    config?: Record<string, unknown>;
    instanceId?: string;
  };
  if (!type || !config || typeof config !== 'object') {
    res.status(400).json({ error: 'Missing body: type/config' });
    return;
  }
  try {
    const providerDef = getProvider(type);
    if (!providerDef) throw new Error(`服务商类型未注册: ${type}`);
    const effective = await mergeSavedSecrets(providerDef, config, instanceId);
    const resolved = resolveProviderConfig(providerDef.configSchema, effective);
    const result = await providerDef.testConnection(resolved);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

/**
 * 组装「当前表单配置 + 已保存值」的有效配置（连接测试 / 获取工作流列表共用）。
 *
 * 新增模式（无 instanceId）直接使用表单值；编辑模式下 secret 字段在表单中为空
 * （含脱敏占位）时回填该实例已保存值——表单不回显 secret，未修改则沿用已保存值。
 * 环境变量 / 默认值兜底由 resolveProviderConfig 统一处理。
 *
 * @param providerDef 服务商定义（configSchema 提供 secret 标记）
 * @param config 当前表单配置参数
 * @param instanceId 编辑模式下实例 id；缺省为新增模式直接使用表单值
 * @returns 可传给 resolveProviderConfig 的有效配置
 */
async function mergeSavedSecrets(
  providerDef: ProviderDefinition,
  config: Record<string, unknown>,
  instanceId?: string,
): Promise<Record<string, ProviderConfigValue>> {
  const base = config as Record<string, ProviderConfigValue>;
  if (!instanceId) return base;
  const inst = await getInstance(instanceId);
  if (!inst) throw new Error(`实例不存在: ${instanceId}`);
  const effective = { ...base };
  for (const f of providerDef.configSchema) {
    if (!f.secret) continue;
    const v = effective[f.key];
    if ((v === undefined || v === '' || v === MASKED_SECRET) && inst.config[f.key] !== undefined) {
      effective[f.key] = inst.config[f.key];
    }
  }
  return effective;
}

// POST /api/providers/workflows/fetch — 用当前表单配置获取工作流列表（不落盘）。
// 与 /providers/test 同语义：新增模式直接按表单参数解析；编辑模式携带 instanceId，
// 表单中空白的 secret 字段回填该实例已保存值，保证改完配置后
// 也能用「手头配置 + 已保存密钥」重新拉取。
workflowRouter.post('/providers/workflows/fetch', async (req: Request, res: Response) => {
  const { type, config, instanceId } = req.body as {
    type?: string;
    config?: Record<string, unknown>;
    instanceId?: string;
  };
  if (!type || !config || typeof config !== 'object') {
    res.status(400).json({ error: 'Missing body: type/config' });
    return;
  }
  try {
    const providerDef = getProvider(type);
    if (!providerDef) throw new Error(`服务商类型未注册: ${type}`);
    const effective = await mergeSavedSecrets(providerDef, config, instanceId);
    const resolved = resolveProviderConfig(providerDef.configSchema, effective);
    const workflows = await providerDef.listWorkflows(resolved);
    res.json({ workflows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: `获取工作流列表失败: ${msg}` });
  }
});

// GET /api/providers/instances/:id/workflows — 该实例当前工作流列表（Bridge 实时 / 静态返回）
workflowRouter.get('/providers/instances/:id/workflows', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const instance = await getInstance(id);
    if (!instance) {
      res.status(404).json({ error: `实例不存在: ${id}` });
      return;
    }
    const providerDef = getProvider(instance.type);
    if (!providerDef) throw new Error(`服务商类型未注册: ${instance.type}`);
    const workflows = await providerDef.listWorkflows(resolveInstanceConfig(instance));
    res.json({ workflows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: `获取工作流列表失败: ${msg}` });
  }
});

// GET /api/comfyui-bridge/providers — 列出 ComfyUI Easy Bridge 的提供商实例（实时转发 Bridge 列表，不落盘）
// 供前端「ComfyUI 提供商」下拉选项使用；返回脱敏后的最小摘要（仅 id/name/type/enabled）。
// 支持 ?instanceId= 指定 Bridge 实例；未指定时取第一个 comfyui-bridge 实例（兼容旧前端）。
workflowRouter.get('/comfyui-bridge/providers', async (req: Request, res: Response) => {
  try {
    const providerDef = getProvider('comfyui-bridge');
    if (!providerDef) throw new Error('Provider 未注册: comfyui-bridge');
    const instances = await listInstances();
    const requestedId = typeof req.query.instanceId === 'string' ? req.query.instanceId : undefined;
    const inst = requestedId
      ? instances.find((i) => i.id === requestedId && i.type === 'comfyui-bridge')
      : instances.find((i) => i.type === 'comfyui-bridge');
    if (!inst) throw new Error('未配置 comfyui-bridge 实例');
    const client = providerDef.createClient(resolveInstanceConfig(inst)) as ComfyuiBridgeClient;
    const list = await client.listProviders();
    res.json({
      providers: list.map((p) => ({ id: p.id, name: p.name, type: p.type, enabled: p.enabled })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: `获取 ComfyUI 提供商列表失败: ${msg}` });
  }
});

// GET /api/workflows — list available workflow types and implementations
workflowRouter.get('/workflows', (_req: Request, res: Response) => {
  res.json({ workflows: getAllWorkflows() });
});

// GET /api/workflow-types — 系统支持的工作流类型列表（注册表真实键集合）。
// 供自定义服务商工作流表单的「工作流类型」下拉选项使用；类型键以注册表为准，
// 未来后端新增类型自动出现在列表中。
workflowRouter.get('/workflow-types', (_req: Request, res: Response) => {
  res.json({ types: getAllWorkflowTypes() });
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

  // 工作流实现必须显式指定且合法（不兜底），否则直接拒绝创建任务
  const validated = validateWorkflowImpl(workflowId, impl);
  if (!validated.ok) {
    res.status(400).json({ error: validated.code, message: validated.message });
    return;
  }
  const implDef = validated.implDef;
  // 用户手动传入的参数：仅保留所选实现声明的 key，按类型规范化后合并进 vars
  const userVars = normalizeUserParams(implDef.params, params.userParams);
  // ComfyUI 提供商选择（Bridge 执行保留键 providerId）：仅 comfyui-bridge 工作流生效，
  // 独立存于任务 params，不混入 vars（providerId 不是工作流参数，避免注入 Bridge 请求参数）
  const comfyuiProviderId =
    implDef.provider === 'comfyui-bridge' ? extractComfyuiProviderId(params.userParams) : undefined;

  const taskId = uuidv4();
  db.createTask({
    id: taskId,
    project,
    workflow_id: workflowId,
    impl: validated.impl,
    params: {
      vars: { ...(params.vars ?? {}), ...userVars },
      promptPaths: params.promptPaths ?? [],
      outputPath: params.outputPath,
      ...(params.video ? { video: params.video } : {}),
      ...(comfyuiProviderId ? { comfyuiProviderId } : {}),
    },
  });

  db.addLog(taskId, 'info', `Task created: ${workflowId}/${validated.impl}`);

  res.json({ taskId, status: 'pending' });
});

/**
 * 解析任务 params（JSON 字符串）为结构化对象。
 *
 * @param paramsJson - 任务 params 的 JSON 字符串
 * @returns 结构化 params：vars 业务变量、promptPaths 提示词路径、outputPath 输出路径；
 *          video 为视频自包含提交参数（wire 形态，可选）；
 *          comfyuiProviderId 为本次执行的 Easy Bridge 提供商实例 ID（可选，仅 comfyui-bridge 工作流）；
 *          remoteTaskId 为提交成功后持久化的远端（Bridge）任务 ID（可选，供中断使用）
 */
export function parseTaskParams(paramsJson: string): {
  vars: Record<string, string>
  promptPaths: string[]
  outputPath: string
  video?: VideoWorkflowSubmitParams
  /** 本次执行的 Easy Bridge 提供商实例 ID（用户在工作流表单选择，可选） */
  comfyuiProviderId?: string
  /** 提交成功后持久化的远端（Bridge）任务 ID，供中断使用 */
  remoteTaskId?: string
} {
  try {
    const parsed = JSON.parse(paramsJson) as {
      vars?: Record<string, string>
      promptPaths?: string[]
      outputPath?: string
      video?: VideoWorkflowSubmitParams
      comfyuiProviderId?: string
      remoteTaskId?: string
    };
    return {
      vars: parsed.vars ?? {},
      promptPaths: parsed.promptPaths ?? [],
      outputPath: parsed.outputPath ?? '',
      video: parsed.video,
      comfyuiProviderId: parsed.comfyuiProviderId,
      remoteTaskId: parsed.remoteTaskId,
    };
  } catch {
    // 任务 params 非法 JSON 时回退空结构（任务详情展示容错，不阻断接口）
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

  // 重试前校验原实现仍可执行：旧任务可能在实例删除/工作流下线后失效，
  // 直接复制会创建必败任务
  if (!getImpl(existing.workflow_id, existing.impl)) {
    res.status(400).json({
      error: 'workflow_impl_not_found',
      message: `原任务工作流实现已不存在或未绑定服务商实例: ${existing.workflow_id}/${existing.impl}`,
    });
    return;
  }

  const newTaskId = uuidv4();
  db.createTask({
    id: newTaskId,
    project: existing.project,
    workflow_id: existing.workflow_id,
    impl: existing.impl,
    params: stripCancelRequested(JSON.parse(existing.params)),
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
      // 同步执行 provider（deferredCancel）：无法中止在途请求 → 写取消标记，
      // 由引擎在 execute 完成后检查并持久化为失败（用户中断）；不立即标记 failed（避免引擎完成后覆盖）
      if (wf?.capabilities?.deferredCancel) {
        db.updateTaskParams(task.id, markCancelRequested(JSON.parse(task.params)));
        db.addLog(task.id, 'info', '已请求取消，将在执行完成后生效');
        res.json({ taskId: task.id, status: 'cancelling' });
        return;
      }
      const providerId = wf?.provider ?? 'comfyui-bridge';
      const providerDef = getProvider(providerId);
      if (!providerDef) {
        throw new Error(`provider 未注册: ${providerId}`);
      }
      const instances = await listInstances();
      // 优先按工作流绑定的服务商实例 ID 定位（多实例时避免把取消请求发错实例）；
      // 兼容旧数据：未绑定实例 ID 时回退取该类型第一个实例
      const inst = wf?.providerInstanceId
        ? instances.find((i) => i.id === wf.providerInstanceId && i.type === providerId)
        : instances.find((i) => i.type === providerId);
      if (!inst) throw new Error(`未配置 ${providerId} 实例`);
      await providerDef
        .createClient(resolveInstanceConfig(inst))
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

    // 发现任务必须全部显式绑定合法实现，否则整体拒绝（不创建半截批次）
    const validatedBatch = validateDiscoveredImpls(discovered);
    if (!validatedBatch.ok) {
      res.status(400).json({ error: 'workflow_impl_required', message: validatedBatch.message });
      return;
    }

    for (const { task, impl: resolvedImpl, implDef } of validatedBatch.resolved) {
      const phase = ASSET_PHASE[task.assetType ?? ''] ?? 0;
      // 用户手动传入的参数：按该任务实际实现（workflowId + resolvedImpl）的声明规范化后合并进 vars
      const userVars = normalizeUserParams(
        implDef.params,
        task.assetType ? userParamsByAssetType?.[task.assetType] : undefined,
      );
      // ComfyUI 提供商选择：按资产类型从用户参数提取，仅 comfyui-bridge 实现入库（与 /workflow/run 同语义）
      const comfyuiProviderId =
        implDef.provider === 'comfyui-bridge'
          ? extractComfyuiProviderId(task.assetType ? userParamsByAssetType?.[task.assetType] : undefined)
          : undefined;
      db.createTask({
        id: uuidv4(),
        project,
        workflow_id: task.workflowId,
        impl: resolvedImpl,
        params: {
          vars: { ...task.vars, ...userVars },
          promptPaths: task.promptPaths,
          outputPath: task.outputPath,
          ...(comfyuiProviderId ? { comfyuiProviderId } : {}),
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
