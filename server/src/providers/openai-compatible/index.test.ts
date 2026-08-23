import { describe, expect, it, vi } from 'vitest';
import { getProvider } from '../registry.js';
import './index.js';

describe('openai-compatible 插件定义', () => {
  it('声明 component 字段 models，并按配置展开工作流', async () => {
    const def = getProvider('openai-compatible');
    expect(def).toBeDefined();
    expect(def!.name).toBe('OpenAI兼容');
    const modelsField = def!.configSchema.find((f) => f.key === 'models');
    expect(modelsField).toMatchObject({
      type: 'component',
      component: 'OpenAICompatibleModelsEditor',
    });
    const entries = await def!.listWorkflows({
      models: [{ id: 'gpt-image-1', capabilities: ['text-to-image'] }],
    });
    expect(entries).toEqual([
      {
        key: 'text-to-image:gpt-image-1',
        name: 'gpt-image-1 文生图',
        type: 'text-to-image',
        description: 'OpenAI 兼容文生图（模型 gpt-image-1）',
      },
    ]);
  });

  it('空模型列表返回空工作流', async () => {
    const def = getProvider('openai-compatible');
    expect(await def!.listWorkflows({})).toEqual([]);
  });

  it('testConnection 委托客户端', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const def = getProvider('openai-compatible');
    const res = await def!.testConnection({ baseUrl: 'http://oai', apiKey: 'k' });
    expect(res.ok).toBe(true);
    vi.unstubAllGlobals();
  });
});
