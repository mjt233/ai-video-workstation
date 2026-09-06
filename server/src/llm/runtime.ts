/**
 * LLM 流式运行时：基于 Vercel AI SDK streamText 的一步调用封装（当前为一次性输入/输出）。
 *
 * 这是后续扩展「完整 Agent」的预留边界：会话管理、tool call、MCP、Skills、子 Agent
 * 都应在本模块内替换/扩展（如改用 ToolLoopAgent + memory + tools），对外保持
 * createLlmStream 的流式事件接口不变（thinking / text / warning / error / done）。
 */
import { streamText } from 'ai';
import type { LlmClient } from './client.js';
import type { LlmMediaType } from './protocol.js';

/** 媒体输入（已由调用方按能力过滤、读取为 base64） */
export interface LlmMediaInput {
  /** 媒体类型 */
  type: LlmMediaType;
  /** IANA MIME（如 image/png、video/mp4、audio/flac） */
  mimeType: string;
  /** base64 编码的原始字节 */
  base64: string;
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
  /** LLM 客户端（协议 + 凭据） */
  client: LlmClient;
  /** 模型 id */
  modelId: string;
  /** 用户输入文本 */
  input: string;
  /** 媒体输入（已过滤） */
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
 * - 流式结束产出 done；模型/网络异常产出 error（用户主动中断则不产出，由调用方处理）。
 *
 * @param params 流式参数
 * @returns 异步事件序列（供 SSE 路由逐条转发）
 */
export async function* createLlmStream(params: LlmStreamParams): AsyncGenerator<LlmStreamEvent> {
  const { client, modelId, input, media, reasoningEffort, abortSignal } = params;
  const model = client.model(modelId);
  const providerOptions = client.reasoningOptions(reasoningEffort);
  const parts: UserPart[] = [];
  if (input.trim()) parts.push({ type: 'text', text: input });
  for (const m of media) {
    parts.push({ type: 'file', data: { type: 'data', data: m.base64 }, mediaType: m.mimeType, filename: m.filename });
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
