/**
 * 大语言模型路由：一键获取模型列表 + 会话化对话（WebSocket 流式转发）。
 *
 * - POST /api/llm/models/fetch：按协议调用 /models 免费接口取模型列表，
 *   并附加 OpenRouter 元数据（best-effort，失败只打日志不报错）；
 * - POST /api/llm/chat：创建 LLM 活跃会话（内存注册表登记，立即返回
 *   { taskId, status: 'running' }），后台执行媒体阶段 2（读取内联 base64 /
 *   文件中转上传视频）与 createLlmStream 流式转发
 *   （thinking/text/warning/error/done → WS 广播 + 会话状态累加）；
 *   客户端断开不再中止上游（刷新/切换画布后任务继续，恢复由服务端会话列表驱动）；
 * - POST /api/llm/chat/tasks/:taskId/cancel：HTTP 兜底取消（WS 断连时停止仍可用）。
 *
 * 媒体两阶段：响应前只做能力/格式/大小/中转配置预检（不读取大文件、不上传），
 * 需要公网 URL 但未配置文件中转 → 直接 400（不创建会话）；真正的读取/上传在后台
 * runLlmTask 内进行，失败会把会话收敛为 failed 并把中文错误透传到节点红字。
 */
import { Router, type Request, type Response } from 'express';
import fs from 'fs/promises';
import { getInstance, resolveInstanceConfig, MASKED_SECRET } from '../providers/config-store.js';
import { findEnabledFileRelayConfig, relayProjectFile, FILE_RELAY_NOT_CONFIGURED_MESSAGE } from '../providers/file-relay/service.js';
import { createLlmClient } from '../llm/client.js';
import { createLlmStream, type LlmMediaInput } from '../llm/runtime.js';
import {
  materializeMediaInputs,
  planMediaInputs,
  type PlannedMediaInput,
} from '../llm/media.js';
import { fetchProviderModels } from '../llm/model-catalog.js';
import { isLlmProtocol, type LlmProtocol } from '../llm/protocol.js';
import { resolveProjectPath } from '../assets/paths.js';
import type { CanvasDefTarget } from '../assets/canvas-def.js';
import { sessionManager, LlmSessionError, type LlmSession, type LlmSessionSnapshot } from '../llm/session-manager.js';
import { wsHub } from '../tasks/task-ws.js';
import { llmExecutor } from '../tasks/llm-executor.js';

export const llmRouter = Router();

/** 流式事件载荷（与 createLlmStream 事件一致；经 WS 广播给订阅者） */
type LlmStreamEventWire =
  | { type: 'thinking'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string };

/** POST /api/llm/chat 请求体（会话登记所需字段） */
interface LlmChatRequestBody {
  project?: unknown;
  providerInstanceId?: unknown;
  modelId?: unknown;
  reasoningEffort?: unknown;
  input?: unknown;
  media?: unknown;
  nodeId?: unknown;
  label?: unknown;
  canvas?: unknown;
  snapshot?: unknown;
}

/** 后台执行参数 */
interface RunLlmTaskParams {
  client: ReturnType<typeof createLlmClient>;
  modelId: string;
  input: string;
  project: string;
  /** 阶段 1 发送计划（阶段 2 读取 base64 / 文件中转上传） */
  mediaPlan: PlannedMediaInput[];
  reasoningEffort?: string;
  warnings: string[];
}

// POST /api/llm/models/fetch — 用当前表单参数获取模型列表（不落盘）。
// 编辑模式携带 instanceId：apiKey 为空时回填实例已保存值（与 /providers/test 同语义）。
llmRouter.post('/llm/models/fetch', async (req: Request, res: Response) => {
  const { protocol, baseUrl, apiKey, instanceId } = req.body as {
    protocol?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
    instanceId?: unknown;
  };
  if (!isLlmProtocol(protocol)) {
    res.status(400).json({ error: `未知协议类型: ${String(protocol)}` });
    return;
  }
  let effectiveKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (typeof instanceId === 'string' && instanceId) {
    try {
      const inst = await getInstance(instanceId);
      if (!inst) throw new Error(`实例不存在: ${instanceId}`);
      const saved = inst.config.apiKey;
      if ((!effectiveKey || effectiveKey === MASKED_SECRET) && typeof saved === 'string' && saved) {
        effectiveKey = saved;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: msg });
      return;
    }
  }
  if (!effectiveKey) {
    res.status(400).json({ error: '请先填写 API Key' });
    return;
  }
  try {
    const models = await fetchProviderModels({ protocol, baseUrl, apiKey: effectiveKey });
    res.json({ models });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: `获取模型列表失败: ${msg}` });
  }
});

// POST /api/llm/chat — 创建 LLM 活跃会话并立即返回 taskId（后台流式执行，不等结果）。
llmRouter.post('/llm/chat', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as LlmChatRequestBody;
  const project = typeof body.project === 'string' && body.project ? body.project : '';
  const providerInstanceId = typeof body.providerInstanceId === 'string' && body.providerInstanceId ? body.providerInstanceId : '';
  const modelId = typeof body.modelId === 'string' && body.modelId ? body.modelId : '';
  const nodeId = typeof body.nodeId === 'string' && body.nodeId ? body.nodeId : '';
  if (!project) {
    res.status(400).json({ error: '缺少项目名（project）' });
    return;
  }
  if (!providerInstanceId) {
    res.status(400).json({ error: '请先选择大语言模型服务商' });
    return;
  }
  if (!modelId) {
    res.status(400).json({ error: '请先选择模型' });
    return;
  }
  if (!nodeId) {
    res.status(400).json({ error: '缺少节点 id（nodeId）' });
    return;
  }
  // 画布定位（CanvasDefTarget：分镜 scene{episode,shot} / 场景 stage{stage,label}）
  const canvas = normalizeCanvasTarget(body.canvas);
  if (!canvas) {
    res.status(400).json({ error: '缺少画布定位信息（canvas）' });
    return;
  }
  // 解析实例配置（apiKey 等 secret 从配置文件读取）
  const inst = await getInstance(providerInstanceId);
  if (!inst || inst.type !== 'llm') {
    res.status(400).json({ error: `大语言模型服务商实例不存在: ${providerInstanceId}` });
    return;
  }
  const config = resolveInstanceConfig(inst);
  const protocol = typeof config.protocol === 'string' ? (config.protocol as LlmProtocol) : undefined;
  if (!protocol || !isLlmProtocol(protocol)) {
    res.status(400).json({ error: '服务商未配置有效的协议类型' });
    return;
  }
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey : '';
  if (!apiKey) {
    res.status(400).json({ error: '服务商未配置 API Key' });
    return;
  }
  const client = createLlmClient(protocol, { baseUrl: config.baseUrl, apiKey });
  // 模型元信息（能力主闸门用；未配置元信息则不按模型过滤）
  const metaModalities = collectInputModalities(config.models, modelId);
  // 阶段 1（响应前）：能力/格式/大小/数量预检 → 发送计划 + warnings（不读取大文件、不上传）
  const plan = await planMediaInputs(body.media, protocol, metaModalities, {
    resolvePath: (relPath) => resolveProjectPath(project, relPath),
    statSize: async (absPath) => (await fs.stat(absPath)).size,
    logError: (message) => console.error(`[llm] ${message}`),
  });
  // 需要公网 URL 的媒体（视频）但未配置文件中转实例 → 400，不创建会话
  // （文案复用 providers/file-relay 的未配置常量，避免两处维护）
  if (plan.items.some((item) => item.transport === 'public-url')) {
    const relayConfig = await findEnabledFileRelayConfig();
    if (!relayConfig) {
      res.status(400).json({ error: FILE_RELAY_NOT_CONFIGURED_MESSAGE });
      return;
    }
  }

  // 登记活跃会话（同节点单飞 + 全局上限）
  let session: LlmSession;
  try {
    session = sessionManager.begin({
      nodeId,
      providerInstanceId,
      modelId,
      label: typeof body.label === 'string' && body.label ? body.label : 'AI文本生成',
      project,
      canvas,
      input: typeof body.input === 'string' ? body.input : '',
      snapshot: normalizeSnapshot(body.snapshot),
    });
  } catch (e) {
    if (e instanceof LlmSessionError) {
      res.status(e.code === 'NODE_BUSY' ? 409 : 429).json({ error: e.message, code: e.code });
      return;
    }
    throw e;
  }
  // 会话 id 即任务 id：登记进统一任务注册表（同节点单飞/上限冲突时回收会话）
  try {
    llmExecutor.create({
      taskId: session.taskId,
      nodeId,
      label: session.label,
      project,
      canvas,
      ...(session.snapshot.modelName ? { modelName: session.snapshot.modelName } : {}),
    });
    session.lifecycle = llmExecutor.lifecycleOf(session.taskId);
  } catch (e) {
    sessionManager.cancel(session.taskId);
    await sessionManager.finish(session.taskId, { status: 'failed', error: '任务登记失败' });
    const msg = e instanceof Error ? e.message : String(e);
    res.status(429).json({ error: msg, code: 'TASK_LIMIT' });
    return;
  }
  // 后台异步执行：阶段 2 媒体物化 → 逐事件 pushEvent + WS 广播；流结束/异常/取消 → finish 收敛
  void runLlmTask(session.taskId, {
    client,
    modelId,
    input: typeof body.input === 'string' ? body.input : '',
    project,
    mediaPlan: plan.items,
    reasoningEffort: typeof body.reasoningEffort === 'string' && body.reasoningEffort ? body.reasoningEffort : undefined,
    warnings: plan.warnings,
  });
  res.json({ taskId: session.taskId, status: 'running' });
});

// POST /api/llm/chat/tasks/:taskId/cancel — HTTP 兜底取消（幂等；会话不存在返回 404）。
llmRouter.post('/llm/chat/tasks/:taskId/cancel', (req: Request, res: Response) => {
  const taskId = String(req.params.taskId ?? '');
  const ok = sessionManager.cancel(taskId);
  if (!ok) {
    res.status(404).json({ error: '会话不存在或已结束' });
    return;
  }
  res.json({ success: true });
});

/**
 * 后台执行一次 LLM 会话流：
 * - 阶段 2：媒体物化（内联读取 base64 / 视频经文件中转获得公网 URL；同文件去重）；
 *   中转失败 → finish(failed,「文件中转失败：<原因>」)；取消优先于失败 → finish(cancelled)；
 * - 逐事件 pushEvent（会话状态累加）+ wsHub.taskEvent（广播给订阅者）；
 * - 上游正常结束 → finish(completed)；取消标记/AbortError → finish(cancelled)
 *   （AbortError 不得归类为 failed）；其余异常 → finish(failed, error)。
 *
 * @param taskId 会话 id
 * @param params 执行参数（客户端/模型/输入/项目/媒体计划/警告）
 */
async function runLlmTask(taskId: string, params: RunLlmTaskParams): Promise<void> {
  const session = sessionManager.get(taskId);
  if (!session) return;
  /** 向会话与订阅者广播一条流式事件 */
  const push = (event: LlmStreamEventWire): void => {
    sessionManager.pushEvent(taskId, event);
    wsHub.taskEvent(taskId, event);
  };
  // 媒体过滤警告先行广播（与 SSE 时代行为一致：客户端先看到 warning 再收正文）
  for (const w of params.warnings) push({ type: 'warning', message: w });
  // 阶段 2：媒体物化（内联 base64 / 文件中转上传）；失败/取消都会在此收敛，不进入流式阶段
  let mediaInputs: LlmMediaInput[];
  try {
    mediaInputs = await materializeMediaInputs(
      params.mediaPlan,
      {
        readBase64: async (relPath) => (await fs.readFile(resolveProjectPath(params.project, relPath))).toString('base64'),
        relay: (relPath, opts) => relayProjectFile(params.project, relPath, opts),
        onWarning: (message) => push({ type: 'warning', message }),
        logError: (message) => console.error(`[llm] ${message}`),
      },
      { signal: session.abortController.signal },
    );
  } catch (e) {
    const current = sessionManager.get(taskId);
    if (isAbortError(e) || current?.cancelled || session.abortController.signal.aborted) {
      // 用户主动中断（停止按钮/中断）：按 cancelled 收敛，不报错
      await sessionManager.finish(taskId, { status: 'cancelled' });
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[llm] 媒体准备失败: ${msg}`);
    await sessionManager.finish(taskId, { status: 'failed', error: msg });
    return;
  }
  try {
    for await (const event of createLlmStream({
      client: params.client,
      modelId: params.modelId,
      input: params.input,
      media: mediaInputs,
      reasoningEffort: params.reasoningEffort,
      abortSignal: session.abortController.signal,
    })) {
      if (event.type === 'error') {
        push(event);
        await sessionManager.finish(taskId, { status: 'failed', error: event.message });
        return;
      }
      if (event.type === 'done') {
        await sessionManager.finish(taskId, { status: 'completed' });
        return;
      }
      push(event);
    }
    // 流自然耗尽（若迭代器提前结束但未产出 done，按正常完成收敛）
    await sessionManager.finish(taskId, { status: 'completed' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const current = sessionManager.get(taskId);
    if (isAbortError(e) || current?.cancelled) {
      // 用户主动中断（停止按钮/中断）：按 cancelled 收敛，不报错
      await sessionManager.finish(taskId, { status: 'cancelled' });
      return;
    }
    console.error(`[llm] 对话流异常: ${msg}`);
    await sessionManager.finish(taskId, { status: 'failed', error: `对话流异常：${msg}` });
  }
}

/**
 * 判断是否为中止错误（AbortError / fetch aborted）。
 *
 * @param e 捕获的异常
 * @returns 是否为中止类错误
 */
function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: unknown; message?: unknown };
  if (err.name === 'AbortError') return true;
  return typeof err.message === 'string' && /abort/i.test(err.message);
}

/**
 * 从服务商实例配置的模型列表中提取所选模型声明的输入模态（`meta.inputModalities`）。
 *
 * @param models 实例配置的模型列表（未知结构，逐项校验）
 * @param modelId 当前模型 id
 * @returns 输入模态集合；未配置元信息时为空集合（= 不按模型过滤）
 */
function collectInputModalities(models: unknown, modelId: string): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(models)) return out;
  const modelCfg = models.find(
    (m): m is { modelId: string; meta?: { inputModalities?: unknown } } =>
      !!m && typeof m === 'object' && (m as { modelId?: unknown }).modelId === modelId,
  );
  const rawModalities = modelCfg?.meta?.inputModalities;
  if (Array.isArray(rawModalities)) {
    for (const v of rawModalities) if (typeof v === 'string') out.add(v);
  }
  return out;
}

/**
 * 校验并规范化画布定位参数（CanvasDefTarget）。
 *
 * @param raw 原始值
 * @returns 规范化目标；非法返回 null
 */
function normalizeCanvasTarget(raw: unknown): CanvasDefTarget | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind === 'scene' || o.kind === 'stage' ? o.kind : '';
  if (!kind) return null;
  if (kind === 'scene') {
    const episode = typeof o.episode === 'string' ? o.episode.trim() : '';
    const shot = typeof o.shot === 'string' ? o.shot.trim() : '';
    if (!episode || !shot) return null;
    return { kind, episode, shot };
  }
  const stage = typeof o.stage === 'string' ? o.stage.trim() : '';
  const label = typeof o.label === 'string' ? o.label.trim() : '';
  if (!stage || !label) return null;
  return { kind, stage, label };
}

/**
 * 校验并规范化会话快照元信息（模型名/预设名/媒体标签/用户原始输入）。
 *
 * @param raw 原始值
 * @returns 规范化快照（未知字段忽略）
 */
function normalizeSnapshot(raw: unknown): LlmSessionSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const snapshot: LlmSessionSnapshot = {};
  if (typeof o.modelName === 'string' && o.modelName) snapshot.modelName = o.modelName;
  if (typeof o.presetName === 'string' && o.presetName) snapshot.presetName = o.presetName;
  if (Array.isArray(o.mediaLabels)) {
    const labels = o.mediaLabels.filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (labels.length > 0) snapshot.mediaLabels = labels;
  }
  if (typeof o.userInput === 'string' && o.userInput) snapshot.userInput = o.userInput;
  return snapshot;
}
