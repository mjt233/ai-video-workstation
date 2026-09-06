/**
 * 大语言模型协议定义与公共工具。
 *
 * 本模块只包含纯函数与常量（无网络/IO），供 provider 插件、模型目录、
 * 路由与测试共用：协议枚举、BaseURL 归一化、上下文窗口解析/格式化。
 */

/** 大语言模型协议类型 */
export type LlmProtocol = 'openai-chat' | 'openai-responses' | 'anthropic' | 'grok' | 'gemini';

/** 协议元信息（配置表单下拉选项与后端校验共用） */
export interface LlmProtocolInfo {
  /** 协议 id（存储值） */
  id: LlmProtocol;
  /** 中文显示名 */
  label: string;
  /** 官方默认 BaseURL（用户留空时回退） */
  defaultBaseUrl: string;
}

/** 支持的全部协议清单（顺序即下拉顺序） */
export const LLM_PROTOCOLS: LlmProtocolInfo[] = [
  { id: 'openai-chat', label: 'OpenAI Chat Completions', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'openai-responses', label: 'OpenAI Responses API', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com' },
  { id: 'grok', label: 'Grok', defaultBaseUrl: 'https://api.x.ai/v1' },
  { id: 'gemini', label: 'Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
];

/** 媒体输入类型（与模型元信息 inputModalities 取值一致） */
export type LlmMediaType = 'image' | 'audio' | 'video';

/**
 * 判断值是否为受支持的协议 id。
 * @param v 待判断值
 * @returns 是协议 id 返回 true
 */
export function isLlmProtocol(v: unknown): v is LlmProtocol {
  return typeof v === 'string' && LLM_PROTOCOLS.some((p) => p.id === v);
}

/**
 * 归一化 BaseURL：去首尾空白与尾部斜杠（保证拼接 /models、/chat/completions 等路径稳定）。
 * @param raw 原始输入
 * @returns 归一化后的 BaseURL（空串保留空串）
 */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * 解析最终 BaseURL：用户配置优先，空则回退该协议官方默认地址。
 * @param protocol 协议 id
 * @param baseUrl 用户配置的 BaseURL（可空）
 * @returns 最终 BaseURL（已归一化）
 */
export function resolveBaseUrl(protocol: LlmProtocol, baseUrl?: unknown): string {
  const raw = typeof baseUrl === 'string' ? normalizeBaseUrl(baseUrl) : '';
  if (raw) return raw;
  return LLM_PROTOCOLS.find((p) => p.id === protocol)?.defaultBaseUrl ?? '';
}

/**
 * 解析上下文窗口输入为 token 数。
 *
 * 支持三种形式（大小写不敏感，允许小数，如 1.5M）：
 * - 纯数字：128000
 * - K：128K / 128k
 * - M：1M / 1.5m
 *
 * @param raw 用户输入字符串
 * @returns token 数；非法输入返回 null
 */
export function parseContextWindow(raw: string): number | null {
  const m = /^\s*(\d+)(?:\.(\d+))?\s*([kKmM])?\s*$/.exec(raw);
  if (!m) return null;
  const base = Number(m[1] + (m[2] ? `.${m[2]}` : ''));
  if (!Number.isFinite(base)) return null;
  const unit = (m[3] ?? '') as '' | 'k' | 'K' | 'm' | 'M';
  const n = unit === '' ? base : unit === 'k' || unit === 'K' ? base * 1e3 : base * 1e6;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * 上下文窗口展示格式化：优先使用 K / M（≥1M 用 M、≥1000 用 K，整数倍不带小数，
 * 其余保留 1 位小数；小于 1000 原样数字）。
 *
 * @param value 原始值（数字或 '128000' / '128K' / '1M' 等字符串；空返回空串）
 * @returns 展示字符串，如 '1M'、'128K'、'32.8K'、'500'；非法输入原样返回
 */
export function formatContextWindow(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : parseContextWindow(String(value));
  if (n === null) return String(value);
  if (n >= 1e6) {
    if (n % 1e6 === 0) return `${n / 1e6}M`;
    return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 1e3) {
    if (n % 1e3 === 0) return `${n / 1e3}K`;
    return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(n);
}

/** 上下文窗口输入是否合法（配置表单校验用） */
export function isValidContextWindow(raw: string): boolean {
  return parseContextWindow(raw) !== null;
}
