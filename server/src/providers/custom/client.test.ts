import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCustomProviderClient, type CustomProviderClient } from './client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

/** fetch mock 的单条 URL handler（可返回响应或 promise；promise 用于慢响应/中止场景） */
type FetchHandler = (init?: RequestInit) => Response | Promise<Response>;

/** 按 URL 路由的 fetch mock */
function mockFetchByUrl(routes: Record<string, FetchHandler | Response>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = String(url);
    const handler = routes[key];
    if (typeof handler === 'function') return handler(init);
    if (handler instanceof Response) return handler;
    return new Response(JSON.stringify({ error: 'unhandled ' + key }), { status: 500 });
  });
}

/**
 * 构造「慢响应」handler：delayMs 后返回 JSON；请求 signal 被 abort 时立即以 AbortError 拒绝。
 *
 * 用于验证「中断真的中止了在途请求」而不是仅仅本地放弃。
 *
 * @param body 响应体（JSON 序列化）
 * @param delayMs 响应延迟（毫秒）
 * @param onAbort 中止回调（测试断言用）
 */
function slowJsonHandler(body: unknown, delayMs: number, onAbort?: () => void): FetchHandler {
  return (init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    }, delayMs);
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      onAbort?.();
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  });
}

/**
 * 轮询直到任务收敛并返回终态快照（测试辅助）。
 *
 * 后台协程驱动的任务不能用「调一次 poll 就期望终态」的写法；配置里把
 * `pollInterval` 设小（如 0.02 = 20ms）即可让多轮提取快速跑完。
 * 中断场景不适用（poll 会立即抛「用户中断」）。
 *
 * @param client 客户端
 * @param taskId 任务 id
 * @returns 终态 poll 结果
 */
async function waitTerminal(
  client: CustomProviderClient,
  taskId: string,
): Promise<Awaited<ReturnType<CustomProviderClient['poll']>>> {
  for (let i = 0; i < 300; i++) {
    const result = await client.poll(taskId);
    if (result.done) return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('任务未在预期时间内收敛');
}

describe('CustomProviderClient 同步工作流', () => {
  it('execute 立即返回任务 id（不阻塞在途请求），收敛后取产物（结果提取只调用一次）', async () => {
    const resultCalls: string[] = [];
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': slowJsonHandler({ ok: 1 }, 30),
      'https://example.com/result': () => {
        resultCalls.push('x');
        return new Response(JSON.stringify({ outputs: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }));
    const client = createCustomProviderClient(makeConfig() as never);
    const { taskId } = await client.execute({ workflowId: 'wf-sync', params: { prompt: 'hi' } });
    // 在途请求尚未返回：execute 已经返回 → 引擎随即持久化远端任务 id，任务可中断
    expect((await client.poll(taskId)).done).toBe(false);
    expect(await waitTerminal(client, taskId)).toMatchObject({ status: 'completed', done: true });
    const output = await client.getOutput(taskId);
    expect(output).toEqual({ type: 'download', url: 'https://cdn.example.com/a.png', filename: 'a.png' });
    expect(resultCalls).toHaveLength(1);
  });

  it('中断：abort 在途请求 → 不再执行结果提取、不产出，poll/getOutput 抛「用户中断」', async () => {
    let aborted = false;
    let inFlight = false;
    const resultCalls: string[] = [];
    const runHandler = slowJsonHandler({ ok: 1 }, 5000, () => { aborted = true; });
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': (init?: RequestInit) => {
        inFlight = true;
        return runHandler(init);
      },
      'https://example.com/result': () => {
        resultCalls.push('x');
        return new Response(JSON.stringify({ outputs: ['https://cdn.example.com/a.png'] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }));
    const client = createCustomProviderClient(makeConfig() as never);
    const { taskId } = await client.execute({ workflowId: 'wf-sync', params: {} });
    // 等在途请求真正发出（后台协程异步推进），再中断
    await vi.waitFor(() => expect(inFlight).toBe(true));
    expect((await client.poll(taskId)).done).toBe(false);
    await client.cancel(taskId);
    // 在途 HTTP 请求被真正中止（不是仅仅本地放弃）
    expect(aborted).toBe(true);
    await expect(client.poll(taskId)).rejects.toThrow(/用户中断/);
    await expect(client.getOutput(taskId)).rejects.toThrow(/用户中断/);
    // 中断后协程不再推进：接口响应被忽略，结果提取零调用
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(resultCalls).toHaveLength(0);
  });

  it('中断：同步工作流配置「取消调用」代码时额外调用远端取消接口（响应未返回时 callResult 为 undefined）', async () => {
    const cancelBodies: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = makeConfig({
      workflows: [
        {
          name: 'wf-sync-cancel',
          types: ['text-to-image'],
          async: false,
          cancelable: false,
          callCode: 'export default async function() { return { url: "https://example.com/run" } }',
          extractCode: 'export default async function() { return { isFinish: true, outputs: [] } }',
          cancelCode: [
            'export default async function(ctx: any, callResult: any) {',
            '  await ctx.request({ url: ctx.providerConfig.baseUrl + "/cancel", method: "post", data: { hasResult: !!callResult } })',
            '}',
          ].join('\n'),
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': slowJsonHandler({ ok: 1 }, 5000),
      'https://example.com/cancel': (init?: RequestInit) => {
        cancelBodies.push(String(init?.body ?? ''));
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }));
    const client = createCustomProviderClient(config as never);
    const { taskId } = await client.execute({ workflowId: 'wf-sync-cancel', params: {} });
    await client.cancel(taskId);
    // 取消代码自身发起的请求不被任务级中止信号连带阻断
    expect(cancelBodies).toEqual(['{"hasResult":false}']);
    expect(warnSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('callResult');
    await expect(client.poll(taskId)).rejects.toThrow(/用户中断/);
  });

  it('同步工作流结果提取返回 failed：任务收敛为失败并透出真实原因，getOutput 抛错', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    }));
    const config = makeConfig({
      workflows: [
        {
          name: 'wf-sync-failed',
          types: ['text-to-image'],
          async: false,
          cancelable: false,
          callCode: 'export default async function() { return { url: "https://example.com/run" } }',
          extractCode: 'export default async function() { return { failed: true, errorMessage: "余额不足" } }',
          cancelCode: '',
        },
      ],
    });
    const client = createCustomProviderClient(config as never);
    const { taskId } = await client.execute({ workflowId: 'wf-sync-failed', params: {} });
    const done = await waitTerminal(client, taskId);
    expect(done).toMatchObject({ status: 'failed', done: true, errorMessage: '余额不足' });
    await expect(client.getOutput(taskId)).rejects.toThrow(/余额不足/);
  });

  it('「调用发起」未返回合法请求配置：任务收敛为失败并透出原因', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({}));
    const config = makeConfig({
      workflows: [
        {
          name: 'wf-bad-call',
          types: ['text-to-image'],
          async: false,
          cancelable: false,
          callCode: 'export default async function() { return {} }',
          extractCode: 'export default async function() { return { isFinish: true } }',
          cancelCode: '',
        },
      ],
    });
    const client = createCustomProviderClient(config as never);
    const { taskId } = await client.execute({ workflowId: 'wf-bad-call', params: {} });
    const done = await waitTerminal(client, taskId);
    expect(done.status).toBe('failed');
    expect(String(done.errorMessage)).toContain('url');
  });

  it('在途请求失败（网络错误）：任务收敛为失败并透出请求错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('socket hang up');
    }));
    const client = createCustomProviderClient(makeConfig() as never);
    const { taskId } = await client.execute({ workflowId: 'wf-sync', params: {} });
    const done = await waitTerminal(client, taskId);
    expect(done.status).toBe('failed');
    expect(String(done.errorMessage)).toContain('http 请求失败');
  });

  it('未配置的工作流执行报错', async () => {
    const client = createCustomProviderClient(makeConfig() as never);
    await expect(client.execute({ workflowId: 'no-such', params: {} })).rejects.toThrow(/未配置或已删除/);
  });

  it('未配置「调用发起」代码：execute 阶段即报错（配置类错误不等到轮询）', async () => {
    const config = makeConfig({
      workflows: [
        {
          name: 'wf-no-call',
          types: ['text-to-image'],
          async: false,
          cancelable: false,
          callCode: '',
          extractCode: 'export default async function() { return { isFinish: true } }',
          cancelCode: '',
        },
      ],
    });
    const client = createCustomProviderClient(config as never);
    await expect(client.execute({ workflowId: 'wf-no-call', params: {} })).rejects.toThrow(/未配置「调用发起」代码/);
  });

  it('execute 透传 userConfig 与 Base64 读取回调到 ctx（调用发起代码可读取）', async () => {
    // 调用发起代码把 ctx.userConfig / readFileToBase64 / readFileAsBase64Object
    // 的结果放进请求体，通过 fetch mock 断言用户配置字段确实注入 ctx
    const callCode = [
      'export default async function(ctx: any) {',
      '  const b64 = await ctx.readFileToBase64("assert/a.png")',
      '  const b64Data = await ctx.readFileToBase64("assert/a.png", true)',
      '  const b64Obj = await ctx.readFileAsBase64Object("assert/a.png")',
      '  return {',
      '    url: "https://example.com/run",',
      '    data: {',
      '      model: ctx.userConfig.model,',
      '      steps: ctx.userConfig.steps,',
      '      enhance: ctx.userConfig.enhance,',
      '      missing: ctx.userConfig.missing,',
      '      workflowType: ctx.workflowType,',
      '      b64,',
      '      b64Data,',
      '      b64Obj',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const config = makeConfig({
      workflows: [
        {
          name: 'wf-cfg',
          types: ['text-to-image'],
          async: false,
          cancelable: false,
          callCode,
          extractCode: 'export default async function(ctx: any, r: any) { return { isFinish: true, outputs: [r.data.url] } }',
          cancelCode: '',
        },
      ],
    });
    let requestBody: unknown;
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': (init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ url: 'https://cdn.example.com/a.png' }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }));
    const client = createCustomProviderClient(config as never);
    const { taskId } = await client.execute({
      workflowId: 'wf-cfg',
      params: {},
      workflowType: 'text-to-image',
      userConfig: { model: 'gpt-image-2', steps: 20, enhance: true },
      readFileToBase64: async (p: string, withDataPrefix?: boolean) =>
        (withDataPrefix ? 'data:image/png;base64,' : '') + 'b64:' + p,
      readFileAsBase64Object: async (p: string) => ({ mimeType: 'image/png', data: 'obj:' + p }),
    });
    await waitTerminal(client, taskId);
    expect(requestBody).toEqual({
      model: 'gpt-image-2',
      steps: 20,
      enhance: true,
      missing: undefined,
      workflowType: 'text-to-image',
      b64: 'b64:assert/a.png',
      b64Data: 'data:image/png;base64,b64:assert/a.png',
      b64Obj: { mimeType: 'image/png', data: 'obj:assert/a.png' },
    });
  });
});

describe('CustomProviderClient 异步工作流', () => {
  it('反复提取直到 isFinish：poll 返回进度快照，getOutput 使用终态结果', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response(JSON.stringify({ outputs: ['https://cdn.example.com/v.mp4'] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    }));
    const client = createCustomProviderClient(makeConfig({ pollInterval: 0.02 }) as never);
    const { taskId } = await client.execute({ workflowId: 'wf-async', params: {} });
    const done = await waitTerminal(client, taskId);
    expect(done).toMatchObject({ status: 'completed', progress: 100, done: true });
    const output = await client.getOutput(taskId);
    expect(output?.type).toBe('download');
    expect(output && output.type === 'download' ? output.url : undefined).toBe('https://cdn.example.com/v.mp4');
  });

  it('结果提取返回 failed：立即收敛失败并透出原因，getOutput 抛错', async () => {
    const failedExtract = [
      'export default async function(ctx: any, callResult: any) {',
      '  if (callResult.data.error) return { failed: true, errorMessage: callResult.data.error }',
      '  return { isFinish: false }',
      '}',
    ].join('\n');
    const config = makeConfig({
      pollInterval: 0.02,
      workflows: [
        {
          name: 'wf-failed',
          types: ['text-to-image'],
          async: true,
          cancelable: false,
          callCode: 'export default async function() { return { url: "https://example.com/run" } }',
          extractCode: failedExtract,
          cancelCode: '',
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response(JSON.stringify({ error: '内容违规' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    }));
    const client = createCustomProviderClient(config as never);
    const { taskId } = await client.execute({ workflowId: 'wf-failed', params: {} });
    expect(await waitTerminal(client, taskId)).toMatchObject({ status: 'failed', done: true, errorMessage: '内容违规' });
    await expect(client.getOutput(taskId)).rejects.toThrow(/内容违规/);
  });

  it('结果提取返回 failed 未带原因时回退默认失败文案', async () => {
    const config = makeConfig({
      pollInterval: 0.02,
      workflows: [
        {
          name: 'wf-failed-nomsg',
          types: ['text-to-image'],
          async: true,
          cancelable: false,
          callCode: 'export default async function() { return { url: "https://example.com/run" } }',
          extractCode: 'export default async function() { return { failed: true } }',
          cancelCode: '',
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    }));
    const client = createCustomProviderClient(config as never);
    const { taskId } = await client.execute({ workflowId: 'wf-failed-nomsg', params: {} });
    const done = await waitTerminal(client, taskId);
    expect(done.status).toBe('failed');
    expect(String(done.errorMessage)).toContain('未提供失败原因');
  });

  it('取消后 poll 抛「用户中断」并调用「取消调用」代码', async () => {
    const cancelCalls: string[] = [];
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response(JSON.stringify({ outputs: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
      'https://example.com/cancel': () => {
        cancelCalls.push('x');
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }));
    const client = createCustomProviderClient(makeConfig({ pollInterval: 0.02 }) as never);
    const { taskId } = await client.execute({ workflowId: 'wf-async', params: {} });
    await client.cancel(taskId);
    expect(cancelCalls).toHaveLength(1);
    await expect(client.poll(taskId)).rejects.toThrow(/用户中断/);
    await expect(client.getOutput(taskId)).rejects.toThrow(/用户中断/);
  });

  it('异步工作流未配置「取消调用」代码：中断仅本地生效（不调远端取消接口）', async () => {
    let aborted = false;
    let inFlight = false;
    const cancelCalls: string[] = [];
    const extractCode = [
      'export default async function(ctx: any) {',
      '  const res = await ctx.request({ url: ctx.providerConfig.baseUrl + "/poll", method: "get" })',
      '  return { isFinish: res.data.done, outputs: [] }',
      '}',
    ].join('\n');
    const config = makeConfig({
      pollInterval: 0.02,
      workflows: [
        {
          name: 'wf-async-nocancel',
          types: ['text-to-image'],
          async: true,
          cancelable: false,
          callCode: 'export default async function() { return { url: "https://example.com/run" } }',
          extractCode,
          cancelCode: '',
        },
      ],
    });
    const pollHandler = slowJsonHandler({ done: false }, 5000, () => { aborted = true; });
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      'https://example.com/poll': (init?: RequestInit) => {
        inFlight = true;
        return pollHandler(init);
      },
      'https://example.com/cancel': () => {
        cancelCalls.push('x');
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }));
    const client = createCustomProviderClient(config as never);
    const { taskId } = await client.execute({ workflowId: 'wf-async-nocancel', params: {} });
    await vi.waitFor(() => expect(inFlight).toBe(true));
    await client.cancel(taskId);
    // 本地中断：在途提取请求被中止、不写产物；未配置取消代码 → 不调用远端取消接口
    expect(aborted).toBe(true);
    expect(cancelCalls).toHaveLength(0);
    await expect(client.poll(taskId)).rejects.toThrow(/用户中断/);
    await expect(client.getOutput(taskId)).rejects.toThrow(/用户中断/);
  });

  it('异步工作流遗留配置（未勾选「支持取消」但写了取消代码）：中断仍调用远端取消接口', async () => {
    const cancelCalls: string[] = [];
    const config = makeConfig({
      pollInterval: 0.02,
      workflows: [
        {
          name: 'wf-async-legacy',
          types: ['text-to-image'],
          async: true,
          cancelable: false,
          callCode: 'export default async function() { return { url: "https://example.com/run" } }',
          extractCode: 'export default async function() { return { isFinish: false } }',
          cancelCode: 'export default async function(ctx: any) { await ctx.request({ url: ctx.providerConfig.baseUrl + "/cancel", method: "post" }) }',
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      'https://example.com/cancel': () => {
        cancelCalls.push('x');
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }));
    const client = createCustomProviderClient(config as never);
    const { taskId } = await client.execute({ workflowId: 'wf-async-legacy', params: {} });
    await client.cancel(taskId);
    expect(cancelCalls).toHaveLength(1);
    await expect(client.poll(taskId)).rejects.toThrow(/用户中断/);
  });

  it('异步工作流在「结果提取」请求在途时中断：abort 该请求并收敛为「用户中断」', async () => {
    let aborted = false;
    let inFlight = false;
    const extractCode = [
      'export default async function(ctx: any) {',
      '  const res = await ctx.request({ url: ctx.providerConfig.baseUrl + "/poll", method: "get" })',
      '  return { isFinish: res.data.done, outputs: [] }',
      '}',
    ].join('\n');
    const config = makeConfig({
      pollInterval: 0.02,
      workflows: [
        {
          name: 'wf-slow-extract',
          types: ['text-to-image'],
          async: true,
          cancelable: true,
          callCode: 'export default async function() { return { url: "https://example.com/run" } }',
          extractCode,
          cancelCode: 'export default async function() {}',
        },
      ],
    });
    const pollHandler = slowJsonHandler({ done: false }, 5000, () => { aborted = true; });
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      'https://example.com/poll': (init?: RequestInit) => {
        inFlight = true;
        return pollHandler(init);
      },
    }));
    const client = createCustomProviderClient(config as never);
    const { taskId } = await client.execute({ workflowId: 'wf-slow-extract', params: {} });
    // 等协程进入提取请求（后台协程异步推进），再中断
    await vi.waitFor(() => expect(inFlight).toBe(true));
    await client.cancel(taskId);
    expect(aborted).toBe(true);
    await expect(client.poll(taskId)).rejects.toThrow(/用户中断/);
  });

  it('结果提取脚本报错时向控制台输出错误日志（首次立即输出，之后按 60 秒节流）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = makeConfig({
      pollInterval: 0.02,
      timeout: 5,
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
    });
    vi.stubGlobal('fetch', mockFetchByUrl({}));
    const client = createCustomProviderClient(broken as never);
    const { taskId } = await client.execute({ workflowId: 'wf-log', params: {} });
    // 等若干轮提取过去（20ms 间隔 → 至少 5 轮），日志被节流为仅首次
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const text = errorSpy.mock.calls.map((c) => String(c[0]) + ' ' + String(c[1] ?? '')).join('\n');
    expect(text).toContain('wf-log');
    expect(text).toContain('结果提取');
    expect(text).toContain('我的提取脚本报错了');
    expect((await client.poll(taskId)).done).toBe(false);
  });

  it('结果提取持续报错超过超时时间：任务收敛为失败', async () => {
    const broken = makeConfig({
      pollInterval: 0.02,
      timeout: 0.1,
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
    });
    vi.stubGlobal('fetch', mockFetchByUrl({}));
    const client = createCustomProviderClient(broken as never);
    const { taskId } = await client.execute({ workflowId: 'wf-broken', params: {} });
    const done = await waitTerminal(client, taskId);
    expect(done.status).toBe('failed');
    expect(String(done.errorMessage)).toContain('持续报错超过超时时间');
    expect(String(done.errorMessage)).toContain('远端不可达');
  });

  it('总耗时超过超时时间：任务收敛为失败', async () => {
    const long = makeConfig({
      pollInterval: 0.02,
      timeout: 0.1,
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
    });
    vi.stubGlobal('fetch', mockFetchByUrl({}));
    const client = createCustomProviderClient(long as never);
    const { taskId } = await client.execute({ workflowId: 'wf-long', params: {} });
    const done = await waitTerminal(client, taskId);
    expect(done.status).toBe('failed');
    expect(String(done.errorMessage)).toContain('超过超时时间');
  });
});
