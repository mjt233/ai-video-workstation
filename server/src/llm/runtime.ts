/**
 * LLM 流式运行时：基于 Vercel AI SDK streamText 的一步调用封装（当前为一次性输入/输出）。
 *
 * 这是后续扩展「完整 Agent」的预留边界：会话管理、tool call、MCP、Skills、子 Agent
 * 都应在本模块内替换/扩展（如改用 ToolLoopAgent + memory + tools），对外保持
 * createLlmStream 的流式事件接口不变（thinking / text / warning / error / done）。
 *
 * 传输路径：
 * - 不含公网 URL 媒体（图片/音频/视频内联）→ Vercel AI SDK（现状，回归面最小）；
 * - 含公网 URL 媒体（当前仅 openai-chat 视频）→ 原生 SSE 客户端
 *   （`openai-chat-stream.ts`，AI SDK 不支持 video file part）。
 */
import { streamText } from 'ai';
import type { LlmClient } from './client.js';
import type { LlmMediaType } from './protocol.js';
import { streamOpenAiChatCompletions } from './openai-chat-stream.js';

/** 内联媒体来源：base64 编码的原始字节（图片/音频/内联视频） */
export interface LlmInlineMediaSource {
  /** 传输方式判别字段 */
  kind: 'inline';
  /** base64 编码的原始字节 */
  base64: string;
}

/** 公网 URL 媒体来源：由「文件中转」服务商上传后获得（当前仅 openai-chat 视频） */
export interface LlmUrlMediaSource {
  /** 传输方式判别字段 */
  kind: 'url';
  /** http(s) 公网 URL */
  url: string;
}

/** 媒体传输来源（阶段 2 物化结果：内联 base64 或公网 URL） */
export type LlmMediaSource = LlmInlineMediaSource | LlmUrlMediaSource;

/** 媒体输入（已由调用方按能力过滤并完成阶段 2 物化） */
export interface LlmMediaInput {
  /** 媒体类型 */
  type: LlmMediaType;
  /** IANA MIME（如 image/png、video/mp4、audio/wav） */
  mimeType: string;
  /** 传输来源（内联 base64 / 公网 URL） */
  source: LlmMediaSource;
  /** 文件名（展示用） */
  filename: string;
}

/** 流式事件（SSE 的 data 载荷） */
export type LlmStreamEvent =
  | { type: 'thinking'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** createLlmStream 参数 */
export interface LlmStreamParams {
  /** LLM 客户端（协议 + 凭据；原生 SSE 客户端直接使用其 baseUrl/apiKey） */
  client: LlmClient;
  /** 模型 id */
  modelId: string;
  /** 用户输入文本 */
  input: string;
  /** 媒体输入（已过滤 + 已物化） */
  media: LlmMediaInput[];
  /** 思考强度挡位（模型不支持时省略） */
  reasoningEffort?: string;
  /** 中断信号（客户端断开/停止按钮触发） */
  abortSignal?: AbortSignal;
}

/** 文本/文件内容部分（AI SDK v7 UserContent 结构，结构化字面量以通过类型检查） */
type UserPart =
  | { type: 'text'; text: string }
  | { type: 'file'; data: { type: 'data'; data: string }; mediaType: string; filename?: string };

/**
 * 启动一次 LLM 流式生成，按序产出流式事件。
 *
 * - 推理模型的思考增量 → thinking 事件；正文增量 → text 事件；
 * - 流式结束产出 done；模型/网络异常产出 error（用户主动中断则不产出，由调用方处理）；
 * - 媒体含公网 URL（openai-chat 视频）时改走原生 SSE 客户端，其余场景保持 AI SDK。
 *
 * @param params 流式参数
 * @returns 异步事件序列（供 SSE 路由逐条转发）
 */
export async function* createLlmStream(params: LlmStreamParams): AsyncGenerator<LlmStreamEvent> {
  const { client, modelId, input, media, reasoningEffort, abortSignal } = params;
  // 含公网 URL 媒体（openai-chat 视频）：AI SDK 不支持 video file part，改走原生 SSE 客户端
  if (media.some((m) => m.source.kind === 'url')) {
    if (client.protocol !== 'openai-chat') {
      throw new Error(`协议 ${client.protocol} 不支持公网 URL 媒体传输`);
    }
    yield* streamOpenAiChatCompletions({
      baseUrl: client.baseUrl,
      apiKey: client.apiKey,
      modelId,
      input,
      media,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    });
    return;
  }
  const model = client.model(modelId);
  const providerOptions = client.reasoningOptions(reasoningEffort);
  const parts: UserPart[] = [];
  if (input.trim()) parts.push({ type: 'text', text: input });
  for (const m of media) {
    // 防御：公网 URL 媒体已在上方分派，此处只应出现内联媒体
    if (m.source.kind !== 'inline') continue;
    parts.push({ type: 'file', data: { type: 'data', data: m.source.base64 }, mediaType: m.mimeType, filename: m.filename });
  }
  const result = streamText({
    model,
    messages: [{ role: 'user', content: parts.length > 0 ? parts : '你好' }],
    ...(providerOptions ? { providerOptions } : {}),
    ...(abortSignal ? { abortSignal } : {}),
  });
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      yield { type: 'text', delta: part.text };
    } else if (part.type === 'reasoning-delta') {
      yield { type: 'thinking', delta: part.text };
    } else if (part.type === 'error') {
      const err = part.error as { message?: unknown } | undefined;
      yield { type: 'error', message: typeof err?.message === 'string' ? err.message : '模型调用失败' };
      return;
    }
  }
  yield { type: 'done' };
}

/**
 * 推断媒体文件的 MIME 类型（按扩展名，忽略大小写）。
 *
 * 注意：**不得删除/改名**——`providers/file-relay/service.ts` 只读引用本函数推断中转文件 MIME。
 *
 * @param filename 文件名
 * @returns MIME；无法识别时返回 application/octet-stream
 */
export function detectMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
  };
  return map[ext] ?? 'application/octet-stream';
}
