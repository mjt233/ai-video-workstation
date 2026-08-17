import { describe, expect, it, vi } from 'vitest';
import { createComfyuiBridgeClient } from './client.js';
import { getProvider } from '../registry.js';
import './index.js';

describe('comfyui-bridge 连接测试', () => {
  it('鉴权成功返回 ok:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 't' }) });
    vi.stubGlobal('fetch', fetchMock);
    const client = createComfyuiBridgeClient({ baseUrl: 'http://bridge', password: 'pwd' });
    const res = await client.testConnection();
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://bridge/api/auth/login', expect.anything());
    vi.unstubAllGlobals();
  });

  it('鉴权失败返回 ok:false 与错误信息', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad' });
    vi.stubGlobal('fetch', fetchMock);
    const client = createComfyuiBridgeClient({ baseUrl: 'http://bridge', password: 'pwd' });
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    expect(res.message).toContain('401');
    vi.unstubAllGlobals();
  });
});

describe('comfyui-bridge 插件定义', () => {
  it('listWorkflows 从 Bridge 拉取并映射为 ceb- 前缀条目', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 't' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { id: 'text_to_image', name: '文生图', description: '文生图工作流', declaredParams: '[]', tags: [] },
          { id: 'tts-1', name: '', description: undefined, declaredParams: '[]', tags: [] },
        ]),
      });
    vi.stubGlobal('fetch', fetchMock);

    const def = getProvider('comfyui-bridge');
    expect(def).toBeDefined();
    const entries = await def!.listWorkflows({ baseUrl: 'http://bridge', password: 'pwd' });

    expect(entries).toEqual([
      { key: 'ceb-text_to_image', name: '文生图', description: '文生图工作流' },
      { key: 'ceb-tts-1', name: 'tts-1', description: undefined },
    ]);
    vi.unstubAllGlobals();
  });

  it('testConnection 委托给客户端并返回结果', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 't' }) });
    vi.stubGlobal('fetch', fetchMock);

    const def = getProvider('comfyui-bridge');
    const res = await def!.testConnection({ baseUrl: 'http://bridge', password: 'pwd' });

    expect(res.ok).toBe(true);
    expect(res.message).toContain('连接成功');
    vi.unstubAllGlobals();
  });
});