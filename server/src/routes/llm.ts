/**
 * 大语言模型路由：一键获取模型列表 + SSE 流式对话。
 *
 * - POST /api/llm/models/fetch：按协议调用 /models 免费接口取模型列表，
 *   并附加 OpenRouter 元数据（best-effort，失败只打日志不报错）；
 * - POST /api/llm/chat：SSE 流式转发 AI SDK 输出（text/thinking/warning/error/done），
 *   客户端断开（停止按钮）时中止上游请求。
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

export const llmRouter = Router();

/** 单文件媒体输入上限（20MB；防止 base64 撑爆内存/请求体） */
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

/** SSE 事件载荷 */
interface LlmSseEvent {
  type: 'thinking' | 'text' | 'warning' | 'error' | 'done';
  delta?: string;
  message?: string;
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

// POST /api/llm/chat — SSE 流式对话（一次性输入/输出；媒体输入按协议/模型能力过滤）。
llmRouter.post('/llm/chat', async (req: Request, res: Response) => {
  const { project, providerInstanceId, modelId, reasoningEffort, input, media } = req.body as {
    project?: unknown;
    providerInstanceId?: unknown;
    modelId?: unknown;
    reasoningEffort?: unknown;
    input?: unknown;
    media?: unknown;
  };
  if (typeof project !== 'string' || !project) {
    res.status(400).json({ error: '缺少项目名（project）' });
    return;
  }
  if (typeof providerInstanceId !== 'string' || !providerInstanceId) {
    res.status(400).json({ error: '请先选择大语言模型服务商' });
    return;
  }
  if (typeof modelId !== 'string' || !modelId) {
    res.status(400).json({ error: '请先选择模型' });
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
  const mediaInputs: LlmMediaInput[] = [];
  const warnings: string[] = [];
  const rawMedia = Array.isArray(media) ? media : [];
  for (const item of rawMedia) {
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
  // SSE 输出
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const controller = new AbortController();
  let closed = false;
  req.on('close', () => {
    // 客户端断开（含停止按钮）：中止上游请求并停止输出
    closed = true;
    controller.abort();
  });
  const send = (event: LlmSseEvent): void => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  try {
    for (const w of warnings) send({ type: 'warning', message: w });
    for await (const event of createLlmStream({
      client,
      modelId,
      input: typeof input === 'string' ? input : '',
      media: mediaInputs,
      reasoningEffort: typeof reasoningEffort === 'string' ? reasoningEffort : undefined,
      abortSignal: controller.signal,
    })) {
      if (closed) break;
      send(event);
      if (event.type === 'error') break;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[llm] 对话流异常: ${msg}`);
    // 用户主动中断（停止按钮）不报错；其余异常向客户端发送错误事件
    if (!closed && !controller.signal.aborted) send({ type: 'error', message: msg });
  } finally {
    if (!closed) res.end();
  }
});

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
