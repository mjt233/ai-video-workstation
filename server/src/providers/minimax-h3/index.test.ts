import { describe, expect, it, vi } from 'vitest';
import { getCandidatesByProvider } from '../../workflows/registry.js';
import { createMinimaxH3Client } from './client.js';
import { getProvider } from '../registry.js';
import './index.js';

vi.mock('../../workflows/registry.js', () => ({
  getCandidatesByProvider: vi.fn(() => [
    { type: 'image-to-video', impl: 'minimax-h3-i2v', name: 'MiniMax H3 图生视频（I2VA）' },
    { type: 'image-to-video', impl: 'minimax-h3-r2v', name: 'MiniMax H3 参考生视频（R2VA）' },
  ]),
}));

describe('minimax-h3 连接测试', () => {
  it('地址可达返回 ok:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const client = createMinimaxH3Client({ baseUrl: 'http://minimax' });
    const res = await client.testConnection();
    expect(res.ok).toBe(true);
    vi.unstubAllGlobals();
  });

  it('地址不可达返回 ok:false', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    const client = createMinimaxH3Client({ baseUrl: 'http://minimax' });
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('minimax-h3 插件定义', () => {
  it('listWorkflows 从注册表返回静态工作流条目', async () => {
    const def = getProvider('minimax-h3');
    expect(def).toBeDefined();
    const entries = await def!.listWorkflows({});
    expect(getCandidatesByProvider).toHaveBeenCalledWith('minimax-h3');
    expect(entries).toEqual([
      {
        key: 'image-to-video:minimax-h3-i2v',
        name: 'MiniMax H3 图生视频（I2VA）',
        type: 'image-to-video',
        description: undefined,
      },
      {
        key: 'image-to-video:minimax-h3-r2v',
        name: 'MiniMax H3 参考生视频（R2VA）',
        type: 'image-to-video',
        description: undefined,
      },
    ]);
  });

  it('testConnection 委托给客户端并返回结果', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const def = getProvider('minimax-h3');
    const res = await def!.testConnection({ baseUrl: 'http://minimax' });
    expect(res.ok).toBe(true);
    expect(res.message).toContain('地址可达');
    vi.unstubAllGlobals();
  });
});