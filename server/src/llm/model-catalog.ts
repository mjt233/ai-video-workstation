/**
 * 大语言模型模型目录：获取各协议模型列表 + OpenRouter 元数据匹配。
 *
 * - 模型列表来自协议各自的 /models 接口（免费、无 token 计费）；
 * - OpenRouter 元数据（上下文窗口/输入模态/思考挡位/tool call）来自
 *   https://openrouter.ai/api/v1/models，按模型 id 匹配，**内存缓存 24 小时**；
 * - OpenRouter 读取失败只 console.error 记录，**绝不影响模型列表返回**。
 */
import { isLlmProtocol, resolveBaseUrl, type LlmProtocol } from './protocol.js';

/** OpenRouter 模型元数据（可测试的纯结构） */
export interface OpenRouterCatalogMeta {
  /** 显示名 */
  name: string;
  /** 上下文窗口（token）；缺失为 undefined */
  context?: number;
  /** 输入模态集合（小写） */
  modalities: Set<string>;
  /** supported_parameters 集合（小写） */
  supports: Set<string>;
}

/** OpenRouter 索引（byId：id/canonical_slug → meta；bySuffix：去服务商前缀后缀 → meta） */
export interface OpenRouterIndex {
  byId: Map<string, OpenRouterCatalogMeta>;
  bySuffix: Map<string, OpenRouterCatalogMeta>;
}

/** 模型元信息（前端模型列表展示与一键获取回填共用） */
export interface LlmModelMeta {
  /** 上下文窗口（token 数字的字符串形式；未知为空串） */
  contextWindow?: string;
  /** 支持的输入模态（text/image/audio/video） */
  inputModalities?: string[];
  /** 思考强度挡位（逗号分割；空 = 不支持思考） */
  reasoningLevels?: string;
  /** 是否支持 tool call */
  toolCall?: boolean;
}

/** 目录条目：模型 id + 显示名 + 元信息（匹配不到时 meta 为 undefined） */
export interface LlmCatalogModel {
  modelId: string;
  name: string;
  meta?: LlmModelMeta;
}

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
/** OpenRouter 元数据内存缓存时长（毫秒，24 小时） */
const OPENROUTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 缓存索引（模块级单例；读取成功后才写入） */
let openRouterIndex: { fetchedAt: number; index: OpenRouterIndex } | null = null;

const EMPTY_INDEX: OpenRouterIndex = { byId: new Map(), bySuffix: new Map() };

/**
 * 获取 OpenRouter 模型元数据索引（内存缓存 24h）。
 *
 * 注意：响应体极大（数 MB），只整体 JSON.parse 后构建索引，**不打印/不转发原始响应**。
 * 读取失败仅控制台记录错误并返回空索引（调用方继续无元数据模式）。
 *
 * @returns OpenRouter 索引（失败为空索引）
 */
async function getOpenRouterIndex(): Promise<OpenRouterIndex> {
  if (openRouterIndex && Date.now() - openRouterIndex.fetchedAt < OPENROUTER_CACHE_TTL_MS) {
    return openRouterIndex.index;
  }
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: unknown[] };
    const index = buildOpenRouterIndex(Array.isArray(json.data) ? json.data : []);
    openRouterIndex = { fetchedAt: Date.now(), index };
    console.log(`[llm] OpenRouter 模型元数据已缓存（${index.byId.size} 个模型，缓存 24 小时）`);
    return index;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 元数据读取失败：只记录日志，不影响模型列表获取（调用方以无元数据模式继续）
    console.error(`[llm] 获取 OpenRouter 模型元数据失败（将以无元数据模式继续）: ${msg}`);
    return EMPTY_INDEX;
  }
}

/**
 * 由 OpenRouter 原始模型条目构建元数据索引（纯函数，可测试）。
 * @param records /api/v1/models 的 data 数组原始条目
 * @returns 索引（byId + bySuffix）
 */
export function buildOpenRouterIndex(records: unknown[]): OpenRouterIndex {
  const byId = new Map<string, OpenRouterCatalogMeta>();
  const bySuffix = new Map<string, OpenRouterCatalogMeta>();
  for (const raw of records) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as {
      id?: unknown;
      canonical_slug?: unknown;
      name?: unknown;
      context_length?: unknown;
      top_provider?: { context_length?: unknown };
      architecture?: { input_modalities?: unknown };
      supported_parameters?: unknown;
    };
    if (typeof rec.id !== 'string' || !rec.id) continue;
    const context =
      (typeof rec.top_provider?.context_length === 'number' ? rec.top_provider.context_length : undefined) ??
      (typeof rec.context_length === 'number' ? rec.context_length : undefined);
    const modalities = new Set<string>();
    for (const m of Array.isArray(rec.architecture?.input_modalities) ? rec.architecture.input_modalities : []) {
      if (typeof m === 'string') modalities.add(m.toLowerCase());
    }
    const supports = new Set<string>();
    for (const s of Array.isArray(rec.supported_parameters) ? rec.supported_parameters : []) {
      if (typeof s === 'string') supports.add(s.toLowerCase());
    }
    const meta: OpenRouterCatalogMeta = {
      name: typeof rec.name === 'string' ? rec.name : rec.id,
      ...(context !== undefined ? { context } : {}),
      modalities,
      supports,
    };
    byId.set(rec.id, meta);
    if (typeof rec.canonical_slug === 'string' && rec.canonical_slug) byId.set(rec.canonical_slug, meta);
    const slash = rec.id.indexOf('/');
    if (slash > 0) {
      const suffix = rec.id.slice(slash + 1);
      if (suffix) bySuffix.set(suffix, meta);
    }
  }
  return { byId, bySuffix };
}

/**
 * 按模型 id 在 OpenRouter 索引中查找元数据。
 *
 * 匹配顺序：精确 id/canonical_slug → 去服务商前缀后缀（openai/gpt-4o ↔ gpt-4o）。
 *
 * @param index OpenRouter 索引
 * @param modelId 模型 id
 * @returns 元数据或 undefined
 */
export function matchOpenRouterMeta(index: OpenRouterIndex, modelId: string): OpenRouterCatalogMeta | undefined {
  return index.byId.get(modelId) ?? index.bySuffix.get(modelId);
}

/** 已知输入模态集合（过滤 OpenRouter 的 file/pdf 等扩展值） */
const KNOWN_MODALITIES = new Set(['text', 'image', 'audio', 'video']);

/**
 * 由 OpenRouter 元数据推导前端模型元信息。
 * @param meta OpenRouter 元数据
 * @returns 模型元信息（inputModalities 缺失时默认 text）
 */
export function deriveLlmModelMeta(meta: OpenRouterCatalogMeta): LlmModelMeta {
  const modalities = [...meta.modalities].filter((m) => KNOWN_MODALITIES.has(m));
  const supportsReasoning =
    meta.supports.has('reasoning') || meta.supports.has('reasoning_effort') || meta.supports.has('include_reasoning');
  return {
    ...(meta.context !== undefined ? { contextWindow: String(meta.context) } : {}),
    inputModalities: modalities.length > 0 ? modalities : ['text'],
    reasoningLevels: supportsReasoning ? 'low,medium,high' : '',
    toolCall: meta.supports.has('tools') || meta.supports.has('tool_choice'),
  };
}

/** 模型列表请求输入 */
export interface FetchModelsInput {
  protocol: LlmProtocol;
  baseUrl?: unknown;
  apiKey: string;
}

/**
 * 按协议获取模型列表（各协议 /models 接口，免费接口不产生 token 费用）。
 *
 * @param input 协议 + 凭据
 * @returns 归一化的模型条目（含 OpenRouter 元数据，best-effort）
 * @throws Error 网络/协议错误（路由转 502；此时元数据失败已被内部吞掉）
 */
export async function fetchProviderModels(input: FetchModelsInput): Promise<LlmCatalogModel[]> {
  if (!isLlmProtocol(input.protocol)) throw new Error(`未知协议: ${String(input.protocol)}`);
  const base = resolveBaseUrl(input.protocol, input.baseUrl);
  let list: { modelId: string; name: string }[];
  switch (input.protocol) {
    case 'openai-chat':
    case 'openai-responses':
    case 'grok': {
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${input.apiKey}` },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`获取模型列表失败（HTTP ${res.status}）`);
      const json = (await res.json()) as { data?: unknown[] };
      list = (Array.isArray(json.data) ? json.data : [])
        .filter((d): d is { id: unknown } => !!d && typeof d === 'object' && typeof (d as { id?: unknown }).id === 'string')
        .map((d) => ({ modelId: d.id as string, name: d.id as string }));
      break;
    }
    case 'anthropic': {
      // Anthropic 模型列表分页：has_more/last_id
      let lastId: string | undefined;
      const out: { modelId: string; name: string }[] = [];
      for (let page = 0; page < 20; page += 1) {
        const url = new URL(`${base}/v1/models`);
        if (lastId) url.searchParams.set('after_id', lastId);
        const res = await fetch(url.toString(), {
          headers: { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`获取模型列表失败（HTTP ${res.status}）`);
        const json = (await res.json()) as {
          data?: { id?: unknown; display_name?: unknown }[];
          has_more?: unknown;
          last_id?: unknown;
        };
        for (const d of json.data ?? []) {
          if (typeof d.id === 'string' && d.id) {
            out.push({ modelId: d.id, name: typeof d.display_name === 'string' && d.display_name ? d.display_name : d.id });
          }
        }
        if (!json.has_more || typeof json.last_id !== 'string') break;
        lastId = json.last_id;
      }
      list = out;
      break;
    }
    case 'gemini': {
      // Gemini 模型列表分页：nextPageToken
      const out: { modelId: string; name: string }[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const url = new URL(`${base}/models`);
        url.searchParams.set('key', input.apiKey);
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`获取模型列表失败（HTTP ${res.status}）`);
        const json = (await res.json()) as {
          models?: { name?: unknown; displayName?: unknown }[];
          nextPageToken?: unknown;
        };
        for (const m of json.models ?? []) {
          if (typeof m.name === 'string' && m.name.startsWith('models/')) {
            const modelId = m.name.slice('models/'.length);
            out.push({ modelId, name: typeof m.displayName === 'string' && m.displayName ? m.displayName : modelId });
          }
        }
        if (typeof json.nextPageToken !== 'string' || !json.nextPageToken) break;
        pageToken = json.nextPageToken;
      }
      list = out;
      break;
    }
  }
  // 附加 OpenRouter 元数据（best-effort：失败已内部吞掉，不影响列表）
  const index = await getOpenRouterIndex();
  return list.map((item) => {
    const meta = matchOpenRouterMeta(index, item.modelId);
    return meta ? { ...item, meta: deriveLlmModelMeta(meta) } : item;
  });
}

/** 连接测试结果 */
export interface LlmTestResult {
  ok: boolean;
  message: string;
}

/**
 * 优先使用免费元数据接口验证连接；接口不可用时回退最小对话请求（可能产生少量费用）。
 *
 * @param input 协议 + 凭据
 * @param fallbackModelId 回退对话请求使用的模型 id（空则用协议默认占位模型）
 * @returns 测试结果（message 注明用哪种方式验证）
 */
export async function testLlmConnection(input: FetchModelsInput, fallbackModelId?: string): Promise<LlmTestResult> {
  if (!isLlmProtocol(input.protocol)) return { ok: false, message: `未知协议: ${String(input.protocol)}` };
  const base = resolveBaseUrl(input.protocol, input.baseUrl);
  try {
    await metadataEndpoint(input.protocol, base, input.apiKey);
    return { ok: true, message: '连接成功（使用免费的模型列表接口验证，未产生费用）' };
  } catch (e) {
    const firstErr = e instanceof Error ? e.message : String(e);
    console.error(`[llm] 模型列表接口不可用，回退最小对话请求验证连接: ${firstErr}`);
  }
  // 回退：最小对话请求（max_tokens=1，费用可忽略但非零）
  try {
    const model = fallbackModelId?.trim() || defaultFallbackModel(input.protocol);
    await minimalChatRequest(input.protocol, base, input.apiKey, model);
    return { ok: true, message: '连接成功（模型列表接口不可用，已回退为最小对话请求验证，可能产生少量费用）' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `连接失败: ${msg}` };
  }
}

/** 免费元数据接口探测（非 2xx / 网络错误抛错） */
async function metadataEndpoint(protocol: LlmProtocol, base: string, apiKey: string): Promise<void> {
  switch (protocol) {
    case 'openai-chat':
    case 'openai-responses':
    case 'grok': {
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return;
    }
    case 'anthropic': {
      const res = await fetch(`${base}/v1/models`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return;
    }
    case 'gemini': {
      const url = new URL(`${base}/models`);
      url.searchParams.set('key', apiKey);
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return;
    }
  }
}

/** 回退对话请求的默认占位模型 */
function defaultFallbackModel(protocol: LlmProtocol): string {
  switch (protocol) {
    case 'openai-chat':
    case 'openai-responses':
      return 'gpt-4o-mini';
    case 'anthropic':
      return 'claude-3-5-haiku-latest';
    case 'grok':
      return 'grok-3-mini';
    case 'gemini':
      return 'gemini-2.0-flash';
  }
}

/** 最小对话请求（max_tokens=1，仅用于连通性验证） */
async function minimalChatRequest(protocol: LlmProtocol, base: string, apiKey: string, model: string): Promise<void> {
  switch (protocol) {
    case 'openai-chat':
    case 'grok': {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    }
    case 'openai-responses': {
      const res = await fetch(`${base}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: 'ping', max_output_tokens: 1, stream: false }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    }
    case 'anthropic': {
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    }
    case 'gemini': {
      const url = new URL(`${base}/models/${model}:generateContent`);
      url.searchParams.set('key', apiKey);
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    }
  }
}
