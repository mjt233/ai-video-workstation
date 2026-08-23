import { describe, expect, it, vi } from 'vitest';
import { getCandidatesByProvider } from '../../workflows/registry.js';
import { createVolcengineArkClient } from './client.js';
import { getProvider } from '../registry.js';
import './index.js';

vi.mock('../../workflows/registry.js', () => ({
  getCandidatesByProvider: vi.fn(() => [
    { type: 'text-to-image', impl: 'seedream', name: 'Seedream 文生图' },
    { type: 'image-edit', impl: 'seedream', name: 'Seedream 图片编辑' },
  ]),
}));

describe('volcengine-ark 连接测试', () => {
  it('地址可达返回 ok:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const client = createVolcengineArkClient({ baseUrl: 'http://ark' });
    const res = await client.testConnection();
    expect(res.ok).toBe(true);
    vi.unstubAllGlobals();
  });

  it('地址不可达返回 ok:false', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    const client = createVolcengineArkClient({ baseUrl: 'http://ark' });
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('volcengine-ark 插件定义', () => {
  it('listWorkflows 从注册表返回静态工作流条目', async () => {
    const def = getProvider('volcengine-ark');
    expect(def).toBeDefined();
    const entries = await def!.listWorkflows({});
    expect(getCandidatesByProvider).toHaveBeenCalledWith('volcengine-ark');
    expect(entries).toEqual([
      { key: 'text-to-image:seedream', name: 'Seedream 文生图', type: 'text-to-image', description: undefined },
      { key: 'image-edit:seedream', name: 'Seedream 图片编辑', type: 'image-edit', description: undefined },
    ]);
  });

  it('testConnection 委托给客户端并返回结果', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const def = getProvider('volcengine-ark');
    const res = await def!.testConnection({ baseUrl: 'http://ark' });
    expect(res.ok).toBe(true);
    expect(res.message).toContain('连接成功');
    vi.unstubAllGlobals();
  });
});