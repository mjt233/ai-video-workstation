import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCustomProviderClient } from './client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 构造测试配置：两个工作流（同步 wf-sync / 异步 wf-async） */
function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const commonCode = [
    'export function getBaseCallConfig(ctx: any, model: string) {',
    '  return { url: ctx.providerConfig.baseUrl + "/run", header: { Authorization: "Bearer " + ctx.providerConfig.apiKey }, data: { model: model } }',
    '}',
  ].join('\n');
  const callCode = [
    'export default async function(ctx: any) {',
    '  const conf = getBaseCallConfig(ctx, "wf-any")',
    '  return conf',
    '}',
  ].join('\n');
  const syncExtract = [
    'export default async function(ctx: any, callResult: any) {',
    '  const res = await ctx.request({ url: ctx.providerConfig.baseUrl + "/result", method: "get" })',
    '  return { isFinish: true, outputs: res.data.outputs }',
    '}',
  ].join('\n');
  const asyncExtract = [
    'export default async function(ctx: any, callResult: any) {',
    '  ctx.session.n = (ctx.session.n ?? 0) + 1',
    '  if (ctx.session.n < 2) return { isFinish: false, progress: 30 }',
    '  return { isFinish: true, progress: 100, outputs: callResult.data.outputs }',
    '}',
  ].join('\n');
  const cancelCode = [
    'export default async function(ctx: any, callResult: any) {',
    '  await ctx.request({ url: ctx.providerConfig.baseUrl + "/cancel", method: "post" })',
    '}',
  ].join('\n');
  return {
    baseUrl: 'https://example.com',
    apiKey: 'sk-x',
    timeout: 2,
    commonCode,
    workflows: [
      {
        name: 'wf-sync',
        types: ['text-to-image'],
        async: false,
        cancelable: false,
        callCode,
        extractCode: syncExtract,
        cancelCode: '',
      },
      {
        name: 'wf-async',
        types: ['image-to-video'],
        async: true,
        cancelable: true,
        callCode,
        extractCode: asyncExtract,
        cancelCode,
      },
    ],
    ...overrides,
  };
}

/** 按 URL 路由的 fetch mock */
function mockFetchByUrl(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = String(url);
    const handler = routes[key];
    if (typeof handler === 'function') return (handler as (init?: RequestInit) => Response)(init);
    if (handler instanceof Response) return handler;
    return new Response(JSON.stringify({ error: 'unhandled ' + key }), { status: 500 });
  });
}

describe('CustomProviderClient 同步工作流', () => {
  it('execute→poll→getOutput 全链路（结果提取只调用一次）', async () => {
    const resultCalls: string[] = [];
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
      'https://example.com/result': () => {
        resultCalls.push('x');
        return new Response(JSON.stringify({ outputs: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }));
    const client = createCustomProviderClient(makeConfig() as never);
    const { taskId } = await client.execute({ workflowId: 'wf-sync', params: { prompt: 'hi' } });
    const polled = await client.poll(taskId);
    expect(polled.done).toBe(true);
    const output = await client.getOutput(taskId);
    expect(output).toEqual({ type: 'download', url: 'https://cdn.example.com/a.png', filename: 'a.png' });
    expect(resultCalls).toHaveLength(1);
  });

  it('未配置的工作流执行报错', async () => {
    const client = createCustomProviderClient(makeConfig() as never);
    await expect(client.execute({ workflowId: 'no-such', params: {} })).rejects.toThrow(/未配置或已删除/);
  });
});

describe('CustomProviderClient 异步工作流', () => {
  it('反复轮询直到 isFinish，getOutput 使用缓存结果', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response(JSON.stringify({ outputs: ['https://cdn.example.com/v.mp4'] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    }));
    const client = createCustomProviderClient(makeConfig() as never);
    const { taskId } = await client.execute({ workflowId: 'wf-async', params: {} });
    const first = await client.poll(taskId);
    expect(first.done).toBe(false);
    expect(first.progress).toBe(30);
    const second = await client.poll(taskId);
    expect(second.done).toBe(true);
    expect(second.progress).toBe(100);
    const output = await client.getOutput(taskId);
    expect(output?.type).toBe('download');
    expect(output && output.type === 'download' ? output.url : undefined).toBe('https://cdn.example.com/v.mp4');
  });

  it('取消后 poll 抛「用户中断」', async () => {
    const cancelCalls: string[] = [];
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response(JSON.stringify({ outputs: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
      'https://example.com/cancel': () => {
        cancelCalls.push('x');
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }));
    const client = createCustomProviderClient(makeConfig() as never);
    const { taskId } = await client.execute({ workflowId: 'wf-async', params: {} });
    await client.cancel(taskId);
    expect(cancelCalls).toHaveLength(1);
    await expect(client.poll(taskId)).rejects.toThrow(/用户中断/);
    await expect(client.getOutput(taskId)).rejects.toThrow(/用户中断/);
  });

  it('结果提取脚本报错时向控制台输出错误日志', async () => {
    vi.useFakeTimers({ now: 0 });
    vi.stubGlobal('fetch', mockFetchByUrl({}));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = makeConfig({
      workflows: [
        {
          name: 'wf-log',
          types: ['text-to-image'],
          async: true,
          cancelable: false,
          callCode: 'export default async function() { return { url: "https://example.com/run" } }',
          extractCode: 'export default async function() { throw new Error("我的提取脚本报错了") }',
          cancelCode: '',
        },
      ],
      timeout: 5,
    });
    try {
      const client = createCustomProviderClient(broken as never);
      const { taskId } = await client.execute({ workflowId: 'wf-log', params: {} });
      const first = await client.poll(taskId);
      expect(first.done).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
      const call = errorSpy.mock.calls[0];
      const text = String(call[0]) + ' ' + String(call[1] ?? '');
      expect(text).toContain('wf-log');
      expect(text).toContain('结果提取');
      expect(text).toContain('我的提取脚本报错了');
      // 连续报错节流：第二次轮询不刷屏
      errorSpy.mockClear();
      await client.poll(taskId);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('结果提取持续报错超过超时时间抛错', async () => {
    vi.useFakeTimers({ now: 0 });
    vi.stubGlobal('fetch', mockFetchByUrl({}));
    const broken = makeConfig({
      workflows: [
        {
          name: 'wf-broken',
          types: ['text-to-image'],
          async: true,
          cancelable: false,
          callCode: 'export default async function() { return { url: "https://example.com/run" } }',
          extractCode: 'export default async function() { throw new Error("远端不可达") }',
          cancelCode: '',
        },
      ],
      timeout: 5,
    });
    const client = createCustomProviderClient(broken as never);
    const { taskId } = await client.execute({ workflowId: 'wf-broken', params: {} });
    const first = await client.poll(taskId);
    expect(first.done).toBe(false);
    vi.setSystemTime(new Date(6000));
    await expect(client.poll(taskId)).rejects.toThrow(/持续报错超过超时时间/);
  });

  it('总耗时超过超时时间抛错', async () => {
    vi.useFakeTimers({ now: 0 });
    vi.stubGlobal('fetch', mockFetchByUrl({}));
    const long = makeConfig({
      workflows: [
        {
          name: 'wf-long',
          types: ['text-to-image'],
          async: true,
          cancelable: false,
          callCode: 'export default async function() { return { url: "https://example.com/run" } }',
          extractCode: 'export default async function() { return { isFinish: false } }',
          cancelCode: '',
        },
      ],
      timeout: 5,
    });
    const client = createCustomProviderClient(long as never);
    const { taskId } = await client.execute({ workflowId: 'wf-long', params: {} });
    expect((await client.poll(taskId)).done).toBe(false);
    vi.setSystemTime(new Date(6000));
    await expect(client.poll(taskId)).rejects.toThrow(/超过超时时间/);
  });
});
