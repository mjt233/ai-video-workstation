/**
 * 大语言模型路由：一键获取模型列表 + 会话化对话（WebSocket 流式转发）。
 *
 * - POST /api/llm/models/fetch：按协议调用 /models 免费接口取模型列表，
 *   并附加 OpenRouter 元数据（best-effort，失败只打日志不报错）；
 * - POST /api/llm/chat：创建 LLM 活跃会话（内存注册表登记，立即返回
 *   { taskId, status: 'running' }），后台执行 createLlmStream 流式转发
 *   （thinking/text/warning/error/done → WS 广播 + 会话状态累加）；
 *   客户端断开不再中止上游（刷新/切换画布后任务继续，恢复由服务端会话列表驱动）；
 * - POST /api/llm/chat/tasks/:taskId/cancel：HTTP 兜底取消（WS 断连时停止仍可用）。
 */
import { Router, type Request, type Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { getInstance, resolveInstanceConfig, MASKED_SECRET } from '../providers/config-store.js';
import { createLlmClient } from '../llm/client.js';
import { createLlmStream, detectMimeType, type LlmMediaInput } from '../llm/runtime.js';
import { fetchProviderModels } from '../llm/model-catalog.js';
import { isLlmProtocol, type LlmMediaType, type LlmProtocol } from '../llm/protocol.js';
import { resolveProjectPath } from '../assets/paths.js';
import type { CanvasDefTarget } from '../assets/canvas-def.js';
import { sessionManager, LlmSessionError, type LlmSession, type LlmSessionSnapshot } from '../llm/session-manager.js';
import { wsHub } from '../llm/session-ws.js';

export const llmRouter = Router();

/** 单文件媒体输入上限（20MB；防止 base64 撑爆内存/请求体） */
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

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
  mediaInputs: LlmMediaInput[];
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
  // 模型元信息（能力过滤用；未配置元信息则跳过过滤）
  const models = Array.isArray(config.models) ? config.models : [];
  const modelCfg = models.find(
    (m): m is { modelId: string; meta?: { inputModalities?: unknown } } =>
      !!m && typeof m === 'object' && (m as { modelId?: unknown }).modelId === modelId,
  );
  const metaModalities: Set<string> = new Set();
  const rawModalities = modelCfg?.meta?.inputModalities;
  if (Array.isArray(rawModalities)) {
    for (const v of rawModalities) if (typeof v === 'string') metaModalities.add(v);
  }
  // 读取并过滤媒体输入（不支持的协议/模型 → 警告并忽略，不阻断生成）
  const { mediaInputs, warnings } = await resolveMediaInputs(project, body.media, client, metaModalities);

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
  // 后台异步执行：逐事件 pushEvent + WS 广播；流结束/异常/取消 → finish 收敛
  void runLlmTask(session.taskId, {
    client,
    modelId,
    input: typeof body.input === 'string' ? body.input : '',
    mediaInputs,
    reasoningEffort: typeof body.reasoningEffort === 'string' && body.reasoningEffort ? body.reasoningEffort : undefined,
    warnings,
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
 * - 逐事件 pushEvent（会话状态累加）+ wsHub.taskEvent（广播给订阅者）；
 * - 上游正常结束 → finish(completed)；取消标记/AbortError → finish(cancelled)
 *   （AbortError 不得归类为 failed）；其余异常 → finish(failed, error)。
 *
 * @param taskId 会话 id
 * @param params 执行参数（客户端/模型/输入/媒体/警告）
 */
async function runLlmTask(taskId: string, params: RunLlmTaskParams): Promise<void> {
  const session = sessionManager.get(taskId);
  if (!session) return;
  // 媒体过滤警告先行广播（与 SSE 时代行为一致：客户端先看到 warning 再收正文）
  for (const w of params.warnings) {
    const event: LlmStreamEventWire = { type: 'warning', message: w };
    sessionManager.pushEvent(taskId, event);
    wsHub.taskEvent(taskId, event);
  }
  try {
    for await (const event of createLlmStream({
      client: params.client,
      modelId: params.modelId,
      input: params.input,
      media: params.mediaInputs,
      reasoningEffort: params.reasoningEffort,
      abortSignal: session.abortController.signal,
    })) {
      if (event.type === 'error') {
        sessionManager.pushEvent(taskId, event);
        wsHub.taskEvent(taskId, event);
        await sessionManager.finish(taskId, { status: 'failed', error: event.message });
        return;
      }
      if (event.type === 'done') {
        await sessionManager.finish(taskId, { status: 'completed' });
        return;
      }
      sessionManager.pushEvent(taskId, event);
      wsHub.taskEvent(taskId, event);
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

/**
 * 读取并过滤媒体输入（协议/模型能力不支持 → 警告并忽略，不阻断生成）。
 *
 * @param project 项目名
 * @param rawMedia 原始媒体列表
 * @param client LLM 客户端（协议能力判断）
 * @param metaModalities 模型元信息声明支持的输入模态（空 = 不按模型过滤）
 * @returns 过滤后的媒体输入与警告列表
 */
async function resolveMediaInputs(
  project: string,
  rawMedia: unknown,
  client: ReturnType<typeof createLlmClient>,
  metaModalities: Set<string>,
): Promise<{ mediaInputs: LlmMediaInput[]; warnings: string[] }> {
  const mediaInputs: LlmMediaInput[] = [];
  const warnings: string[] = [];
  const raw = Array.isArray(rawMedia) ? rawMedia : [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const type = (item as { type?: unknown }).type;
    const filePath = (item as { path?: unknown }).path;
    if (type !== 'image' && type !== 'audio' && type !== 'video') continue;
    if (typeof filePath !== 'string' || !filePath) continue;
    const mediaType = type as LlmMediaType;
    if (!client.supportsInput(mediaType)) {
      warnings.push(`当前协议不支持${mediaTypeLabel(mediaType)}输入，已忽略：${path.basename(filePath)}`);
      continue;
    }
    if (metaModalities.size > 0 && !metaModalities.has(mediaType)) {
      warnings.push(`当前模型不支持${mediaTypeLabel(mediaType)}输入，已忽略：${path.basename(filePath)}`);
      continue;
    }
    let full: string;
    let stat: { size: number };
    try {
      full = resolveProjectPath(project, filePath);
      stat = await fs.stat(full);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[llm] 读取媒体输入失败（已忽略）: ${filePath} ${msg}`);
      warnings.push(`媒体文件读取失败，已忽略：${path.basename(filePath)}`);
      continue;
    }
    if (stat.size > MAX_MEDIA_BYTES) {
      warnings.push(`媒体文件超过 20MB 上限，已忽略：${path.basename(filePath)}`);
      continue;
    }
    try {
      const buf = await fs.readFile(full);
      mediaInputs.push({
        type: mediaType,
        mimeType: detectMimeType(filePath),
        base64: buf.toString('base64'),
        filename: path.basename(filePath),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[llm] 读取媒体输入失败（已忽略）: ${filePath} ${msg}`);
      warnings.push(`媒体文件读取失败，已忽略：${path.basename(filePath)}`);
    }
  }
  return { mediaInputs, warnings };
}

/** 媒体类型中文标签（警告文案用） */
function mediaTypeLabel(type: LlmMediaType): string {
  switch (type) {
    case 'image':
      return '图片';
    case 'audio':
      return '音频';
    case 'video':
      return '视频';
  }
}
