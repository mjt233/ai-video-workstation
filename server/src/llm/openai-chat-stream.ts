/**
 * OpenAI 兼容 Chat Completions 原生 SSE 客户端（仅在请求含公网 URL 媒体时启用）。
 *
 * 为什么不用 Vercel AI SDK：AI SDK v7 的 openai provider 对 `video/*` file part 会抛
 * `UnsupportedFunctionalityError`（只支持图片 → image_url、wav/mp3 音频 → input_audio），
 * 而视频必须用原生 `video_url` 内容块，因此含视频的请求改为本模块直接构造
 * `POST {baseUrl}/chat/completions` 并解析 SSE。
 *
 * 内容块顺序固定：video_url(s) → image_url(s) → input_audio(s) → text（与计划 4.4 一致）。
 * 事件映射：`delta.reasoning_content` → thinking、`delta.content` → text、`[DONE]` → done；
 * 空 choices/空块容错；HTTP 非 2xx 解析 `{error:{code,message}}` 抛中文错误；
 * AbortSignal 触发 → 抛 AbortError（路由收敛为 cancelled，不归类 failed）。
 */
import { createAbortError, normalizeBaseUrl, normalizeReasoningEffort } from './protocol.js';
import type { LlmMediaInput, LlmStreamEvent } from './runtime.js';

/** 原生 SSE 客户端参数 */
export interface OpenAiChatStreamParams {
  /** 已归一化的 BaseURL（如 https://open.bigmodel.cn/api/paas/v4） */
  baseUrl: string;
  /** API Key（Authorization: Bearer） */
  apiKey: string;
  /** 模型 id */
  modelId: string;
  /** 用户输入文本（预设提示词替换后的最终发送内容；空串则不产出 text 块） */
  input: string;
  /** 媒体输入（含公网 URL 视频；图片/音频为内联 base64） */
  media: LlmMediaInput[];
  /** 思考强度挡位（透传 `reasoning_effort`；非法值忽略） */
  reasoningEffort?: string;
  /** 中断信号（取消/停止按钮触发；触发后抛 AbortError） */
  abortSignal?: AbortSignal;
  /** 可注入的 fetch 实现（单测用；缺省使用全局 fetch） */
  fetchImpl?: typeof fetch;
}

/** 原生 Chat Completions 的 video_url 内容块 */
interface OpenAiVideoUrlPart {
  type: 'video_url';
  video_url: { url: string };
}

/** 原生 Chat Completions 的 image_url 内容块 */
interface OpenAiImageUrlPart {
  type: 'image_url';
  image_url: { url: string };
}

/** 原生 Chat Completions 的 input_audio 内容块（base64 + 格式） */
interface OpenAiInputAudioPart {
  type: 'input_audio';
  input_audio: { data: string; format: 'wav' | 'mp3' };
}

/** 原生 Chat Completions 的 text 内容块 */
interface OpenAiTextPart {
  type: 'text';
  text: string;
}

/** 原生 Chat Completions user 消息内容块联合类型（顺序即发送顺序） */
export type OpenAiChatContentPart =
  | OpenAiVideoUrlPart
  | OpenAiImageUrlPart
  | OpenAiInputAudioPart
  | OpenAiTextPart;

/** 原生 Chat Completions 请求体（stream 模式） */
export interface OpenAiChatRequestBody {
  /** 模型 id */
  model: string;
  /** 固定流式 */
  stream: true;
  /** 消息列表（当前仅单条 user 多模态消息） */
  messages: { role: 'user'; content: OpenAiChatContentPart[] }[];
  /** 思考强度（仅在合法挡位时携带） */
  reasoning_effort?: string;
}

/**
 * base64 → data URL。
 *
 * @param mimeType IANA MIME
 * @param base64 base64 编码内容
 * @returns data URL（如 `data:image/png;base64,xxx`）
 */
function toDataUrl(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * 按 MIME 推断 input_audio 的格式字段（openai-chat 仅支持 wav/mp3，能力矩阵已先行过滤）。
 *
 * @param mimeType 音频 MIME
 * @returns 'wav' 或 'mp3'
 * @throws Error 非 wav/mp3 媒体（防御性：正常情况下能力矩阵已拦截）
 */
function audioFormatOf(mimeType: string): 'wav' | 'mp3' {
  switch (mimeType.toLowerCase()) {
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    default:
      throw new Error(`不支持的音频格式：${mimeType}（仅支持 wav/mp3）`);
  }
}

/**
 * 构建原生 Chat Completions user 消息内容块（纯函数，便于单测）。
 *
 * 顺序：video_url(s) → image_url(s) → input_audio(s) → text；视频必须已获得公网 URL。
 *
 * @param media 媒体输入（含 source 传输方式）
 * @param input 用户输入文本（空串不产出 text 块）
 * @returns 内容块数组
 * @throws Error 视频未获得公网 URL / 音频格式不支持（防御性错误）
 */
export function buildOpenAiChatContent(media: LlmMediaInput[], input: string): OpenAiChatContentPart[] {
  const parts: OpenAiChatContentPart[] = [];
  for (const m of media) {
    if (m.type !== 'video') continue;
    if (m.source.kind !== 'url') {
      throw new Error(`视频输入需要公网 URL（请先配置文件中转）：${m.filename}`);
    }
    parts.push({ type: 'video_url', video_url: { url: m.source.url } });
  }
  for (const m of media) {
    if (m.type !== 'image') continue;
    const url = m.source.kind === 'url' ? m.source.url : toDataUrl(m.mimeType, m.source.base64);
    parts.push({ type: 'image_url', image_url: { url } });
  }
  for (const m of media) {
    if (m.type !== 'audio') continue;
    if (m.source.kind !== 'inline') {
      throw new Error(`音频输入不支持公网 URL 传输（仅支持内联 base64）：${m.filename}`);
    }
    parts.push({
      type: 'input_audio',
      input_audio: { data: m.source.base64, format: audioFormatOf(m.mimeType) },
    });
  }
  if (input.trim()) parts.push({ type: 'text', text: input });
  return parts;
}

/**
 * 构建原生 Chat Completions 请求体（纯函数，便于单测）。
 *
 * @param params 模型/输入/媒体/思考强度
 * @returns 请求体（stream: true）
 */
export function buildOpenAiChatRequestBody(params: {
  modelId: string;
  input: string;
  media: LlmMediaInput[];
  reasoningEffort?: string;
}): OpenAiChatRequestBody {
  const effort = normalizeReasoningEffort(params.reasoningEffort);
  return {
    model: params.modelId,
    stream: true,
    messages: [{ role: 'user', content: buildOpenAiChatContent(params.media, params.input) }],
    ...(effort ? { reasoning_effort: effort } : {}),
  };
}

/**
 * 提取 SSE 行中的 data 载荷。
 *
 * @param line 单行文本（已去掉行尾 \r）
 * @returns data 载荷字符串；非 data 行（空行/注释/event:/id:）返回 null
 */
function extractSseData(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  const rest = line.slice('data:'.length);
  return rest.startsWith(' ') ? rest.slice(1) : rest;
}

/**
 * 解析单条 SSE data 载荷中的增量事件（容错空块/空 choices/非 JSON）。
 *
 * @param data data 载荷（不含 `[DONE]`）
 * @returns 增量事件数组（thinking/text；可能为空）
 */
export function parseOpenAiChatSseData(data: string): LlmStreamEvent[] {
  const events: LlmStreamEvent[] = [];
  let json: unknown;
  try {
    json = JSON.parse(data) as unknown;
  } catch {
    // 部分网关会发送非 JSON 的 keep-alive 文本：按容错忽略并记录日志（不中断流）
    console.warn(`[llm] 忽略无法解析的 SSE 分片: ${data.slice(0, 200)}`);
    return events;
  }
  if (!json || typeof json !== 'object') return events;
  const choices = (json as { choices?: unknown }).choices;
  // 空 choices（心跳/usage 块）容错
  if (!Array.isArray(choices) || choices.length === 0) return events;
  const first = choices[0];
  if (!first || typeof first !== 'object') return events;
  const delta = (first as { delta?: unknown }).delta;
  if (!delta || typeof delta !== 'object') return events;
  const reasoning = (delta as { reasoning_content?: unknown }).reasoning_content;
  if (typeof reasoning === 'string' && reasoning) events.push({ type: 'thinking', delta: reasoning });
  const content = (delta as { content?: unknown }).content;
  if (typeof content === 'string') {
    if (content) events.push({ type: 'text', delta: content });
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as { type?: unknown; text?: unknown };
      if (p.type === 'text' && typeof p.text === 'string' && p.text) events.push({ type: 'text', delta: p.text });
    }
  }
  return events;
}

/**
 * 解析 HTTP 非 2xx 错误响应为中文错误文案（解析 `{error:{code,message}}`，非 JSON 回退原始文本）。
 *
 * @param res 失败响应
 * @returns 中文错误信息（含 HTTP 状态码与错误码/详情）
 */
export async function readOpenAiChatError(res: Response): Promise<string> {
  let raw = '';
  try {
    raw = await res.text();
  } catch {
    // 响应体读取失败：以空文本兜底，仍抛出 HTTP 状态错误（不静默）
  }
  let detail = '';
  try {
    const json = JSON.parse(raw) as unknown;
    const err = json && typeof json === 'object' ? (json as { error?: unknown }).error : undefined;
    if (err && typeof err === 'object') {
      const code = (err as { code?: unknown }).code;
      const message = (err as { message?: unknown }).message;
      if (typeof message === 'string' && message) detail = message;
      if (typeof code === 'string' || typeof code === 'number') {
        const codeText = String(code);
        if (codeText) detail = detail ? `[${codeText}] ${detail}` : `[${codeText}]`;
      }
    } else if (typeof err === 'string' && err) {
      detail = err;
    }
  } catch {
    // 响应体不是 JSON（网关错误页等）：截断原始文本作为错误详情
    detail = raw.trim().slice(0, 200);
  }
  return `模型接口调用失败（HTTP ${res.status}）${detail ? `：${detail}` : ''}`;
}

/**
 * 流式调用 OpenAI 兼容 Chat Completions（fetch + SSE 解析），产出统一流式事件。
 *
 * - 正常结束（收到 `[DONE]` 或流自然耗尽）产出一条 done；
 * - HTTP 错误 / 网络异常抛出中文错误（路由收敛为 failed）；
 * - AbortSignal 触发抛出 AbortError（路由收敛为 cancelled）。
 *
 * @param params 调用参数（BaseURL/API Key/模型/输入/媒体/思考强度/中止信号/fetch 注入）
 * @returns 异步事件序列（thinking / text / done）
 */
export async function* streamOpenAiChatCompletions(
  params: OpenAiChatStreamParams,
): AsyncGenerator<LlmStreamEvent> {
  const { baseUrl, apiKey, modelId, input, media, reasoningEffort, abortSignal } = params;
  const fetchImpl = params.fetchImpl ?? fetch;
  if (abortSignal?.aborted) throw createAbortError();
  const body = buildOpenAiChatRequestBody({ modelId, input, media, ...(reasoningEffort ? { reasoningEffort } : {}) });
  const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    ...(abortSignal ? { signal: abortSignal } : {}),
  });
  if (!res.ok) throw new Error(await readOpenAiChatError(res));
  if (!res.body) throw new Error('模型接口未返回流式响应体');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  /** 未成行的残留缓冲（SSE 分片可能切断一行） */
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        const data = extractSseData(line);
        if (data === null) continue;
        if (data.trim() === '[DONE]') {
          yield { type: 'done' };
          return;
        }
        for (const event of parseOpenAiChatSseData(data)) yield event;
      }
    }
    buffer += decoder.decode();
    // 收尾：流最后一行可能没有换行符
    const tail = extractSseData(buffer.replace(/\r$/, ''));
    if (tail !== null) {
      if (tail.trim() === '[DONE]') {
        yield { type: 'done' };
        return;
      }
      for (const event of parseOpenAiChatSseData(tail)) yield event;
    }
    yield { type: 'done' };
  } catch (e) {
    // 中止引起的读取异常统一转 AbortError（路由据此收敛为 cancelled）
    if (abortSignal?.aborted) throw createAbortError();
    throw e;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 流已结束/连接已断开时取消失败属预期收尾，忽略即可
    }
  }
}
