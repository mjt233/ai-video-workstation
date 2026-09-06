import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildOpenRouterIndex,
  deriveLlmModelMeta,
  fetchProviderModels,
  matchOpenRouterMeta,
} from './model-catalog.js';
import { detectMimeType } from './runtime.js';

describe('buildOpenRouterIndex + matchOpenRouterMeta', () => {
  const records = [
    {
      id: 'openai/gpt-4o',
      name: 'OpenAI: GPT-4o',
      context_length: 128000,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      supported_parameters: ['tools', 'tool_choice', 'reasoning_effort', 'temperature', 'max_tokens'],
    },
    {
      id: 'zhipu/glm-5.3-flash',
      canonical_slug: 'zhipu/glm-5.3-flash-20260827',
      name: 'Zhipu: GLM 5.3 Flash',
      context_length: 1000000,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      supported_parameters: ['tools', 'reasoning', 'temperature'],
    },
    {
      id: 'google/gemini-2.0-flash',
      name: 'Google: Gemini 2.0 Flash',
      top_provider: { context_length: 262144 },
      architecture: { input_modalities: ['text', 'image', 'audio', 'video'], output_modalities: ['text'] },
      supported_parameters: ['temperature'],
    },
  ];

  it('精确匹配 id / canonical_slug', () => {
    const index = buildOpenRouterIndex(records);
    expect(matchOpenRouterMeta(index, 'openai/gpt-4o')?.context).toBe(128000);
    expect(matchOpenRouterMeta(index, 'zhipu/glm-5.3-flash-20260827')).toBeDefined();
  });

  it('去服务商前缀后缀匹配（glm-5.3-flash ↔ zhipu/glm-5.3-flash）', () => {
    const index = buildOpenRouterIndex(records);
    const meta = matchOpenRouterMeta(index, 'glm-5.3-flash');
    expect(meta?.name).toBe('Zhipu: GLM 5.3 Flash');
  });

  it('top_provider.context_length 优先', () => {
    const index = buildOpenRouterIndex(records);
    expect(matchOpenRouterMeta(index, 'gemini-2.0-flash')?.context).toBe(262144);
  });

  it('匹配不到返回 undefined', () => {
    const index = buildOpenRouterIndex(records);
    expect(matchOpenRouterMeta(index, 'no-such-model')).toBeUndefined();
  });
});

describe('deriveLlmModelMeta', () => {
  it('推导上下文/模态/思考挡位/tool call', () => {
    const index = buildOpenRouterIndex([
      {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        context_length: 128000,
        architecture: { input_modalities: ['text', 'image'] },
        supported_parameters: ['tools', 'reasoning_effort'],
      },
    ]);
    const meta = deriveLlmModelMeta(matchOpenRouterMeta(index, 'gpt-4o')!);
    expect(meta.contextWindow).toBe('128000');
    expect(meta.inputModalities).toEqual(['text', 'image']);
    expect(meta.reasoningLevels).toBe('low,medium,high');
    expect(meta.toolCall).toBe(true);
  });

  it('无模态信息默认 text；无 reasoning 时思考挡位为空', () => {
    const index = buildOpenRouterIndex([
      { id: 'vendor/plain', name: 'Plain', supported_parameters: ['max_tokens'] },
    ]);
    const meta = deriveLlmModelMeta(matchOpenRouterMeta(index, 'plain')!);
    expect(meta.inputModalities).toEqual(['text']);
    expect(meta.reasoningLevels).toBe('');
    expect(meta.toolCall).toBe(false);
  });
});

describe('fetchProviderModels（mock fetch：协议形状归一化 + 元数据失败不影响列表）', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it('OpenAI 兼容形状：{ data: [{ id }] }', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'glm-5.3-flash' }, { id: 'glm-4.5' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const models = await fetchProviderModels({ protocol: 'openai-chat', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/', apiKey: 'k' });
    expect(models.map((m) => m.modelId)).toEqual(['glm-5.3-flash', 'glm-4.5']);
    // 非200抛错（路由转502）
    const badFetch = vi.fn(async () => new Response('no', { status: 401 }));
    vi.stubGlobal('fetch', badFetch);
    await expect(fetchProviderModels({ protocol: 'openai-chat', baseUrl: 'https://x', apiKey: 'k' })).rejects.toThrow(/HTTP 401/);
  });

  it('Gemini 形状：strip models/ 前缀 + 分页 nextPageToken', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = url instanceof URL ? url : new URL(String(url));
        if (u.searchParams.has('pageToken')) {
          return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-pro' }] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ models: [{ name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' }], nextPageToken: 't1' }),
          { status: 200 },
        );
      }),
    );
    const models = await fetchProviderModels({ protocol: 'gemini', baseUrl: '', apiKey: 'k' });
    expect(models.map((m) => m.modelId)).toEqual(['gemini-2.0-flash', 'gemini-2.5-pro']);
    expect(models[0].name).toBe('Gemini 2.0 Flash');
  });

  it('Anthropic 形状：分页 has_more/last_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = url instanceof URL ? url : new URL(String(url));
        if (u.searchParams.has('after_id')) {
          return new Response(JSON.stringify({ data: [{ id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus' }] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ data: [{ id: 'claude-3-5-sonnet-20241022' }], has_more: true, last_id: 'claude-3-5-sonnet-20241022' }),
          { status: 200 },
        );
      }),
    );
    const models = await fetchProviderModels({ protocol: 'anthropic', baseUrl: '', apiKey: 'k' });
    expect(models.map((m) => m.modelId)).toEqual(['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229']);
  });

  it('OpenRouter 元数据读取失败只记录日志，模型列表照常返回', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 })));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const models = await fetchProviderModels({ protocol: 'grok', baseUrl: '', apiKey: 'k' });
      expect(models.map((m) => m.modelId)).toEqual(['m1']);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('detectMimeType', () => {
  it('按扩展名识别 MIME', () => {
    expect(detectMimeType('a.jpg')).toBe('image/jpeg');
    expect(detectMimeType('b.PNG')).toBe('image/png');
    expect(detectMimeType('c.mp4')).toBe('video/mp4');
    expect(detectMimeType('d.flac')).toBe('audio/flac');
    expect(detectMimeType('e.xyz')).toBe('application/octet-stream');
  });
});
