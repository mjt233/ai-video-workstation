import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWorkflowCallContext,
  compileCustomCodeModule,
  normalizeProgress,
  normalizeWorkflowResult,
  performCustomRequest,
  transpileCustomCode,
} from './runtime.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transpileCustomCode', () => {
  it('转译合法的 TS 模块', () => {
    const js = transpileCustomCode('export default async function(ctx: any) { return 1; }', 't');
    expect(js).toContain('exports.default');
  });

  it('语法错误抛出带行列号的错误', () => {
    expect(() => transpileCustomCode('export default async function( {', 't')).toThrow(/代码编译失败/);
  });
});

describe('compileCustomCodeModule', () => {
  const COMMON = 'export function getBaseCallConfig(ctx: any, model: string) { return { url: model }; }';

  it('通用代码的命名导出可在工作流代码中直接全局调用', async () => {
    const m = compileCustomCodeModule({
      commonCode: COMMON,
      code: 'export default async function(ctx: any) { return getBaseCallConfig(ctx, "gpt-image-2"); }',
      label: 'wf',
    });
    const conf = (await m.defaultFn({})) as { url: string };
    expect(conf.url).toBe('gpt-image-2');
  });

  it('缺少 export default 时报错', () => {
    expect(() => compileCustomCodeModule({ code: 'export function foo() { return 1; }', label: 'wf' }))
      .toThrow(/必须 export default 一个函数/);
  });

  it('通用代码语法错误时报错', () => {
    expect(() => compileCustomCodeModule({ commonCode: 'export function broken( {', code: 'export default async function() {}', label: 'wf' }))
      .toThrow(/代码编译失败/);
  });

  it('用户代码中调用 require 被拒绝', async () => {
    const m = compileCustomCodeModule({
      code: 'export default async function() { return require("fs"); }',
      label: 'wf',
    });
    await expect(m.defaultFn()).rejects.toThrow(/不支持 import\/require/);
  });
});

describe('performCustomRequest', () => {
  it('JSON 请求与响应（自动解析 JSON）', async () => {
    const mock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ model: 'gpt-image-2' });
      return new Response(JSON.stringify({ task_id: 't-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', mock);
    const res = await performCustomRequest({ url: 'https://example.com/run', data: { model: 'gpt-image-2' } });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ task_id: 't-1' });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('params 拼接到查询串，默认方法为 post', async () => {
    const mock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', mock);
    const res = await performCustomRequest({ url: 'https://example.com/task', params: { id: 'x', page: 2 } });
    expect(res.data).toBe('ok');
    const url = mock.mock.calls[0][0] as string;
    expect(url).toContain('https://example.com/task?');
    expect(url).toContain('id=x');
    expect(url).toContain('page=2');
    expect((mock.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });

  it('非 JSON 响应保持原文', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<xml/>', { status: 200, headers: { 'content-type': 'application/xml' } })));
    const res = await performCustomRequest({ url: 'https://example.com/x' });
    expect(res.data).toBe('<xml/>');
  });
});

describe('buildWorkflowCallContext', () => {
  it('ctx 字段齐全且 session 可跨调用共享', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const readFileToBase64 = async (p: string, withDataPrefix?: boolean) =>
      (withDataPrefix ? 'data:image/png;base64,' : '') + 'base64:' + p;
    const ctx = buildWorkflowCallContext({
      providerConfig: { baseUrl: 'https://example.com', apiKey: 'sk-x' },
      params: { prompt: 'hello' },
      projectConfig: { width: 1080, height: 1920, fps: 24 },
      readFile: async (p) => 'content:' + p,
      readAssertFile: async (p) => new File([new Uint8Array([1])], p),
      readFileToBase64,
      workflowType: 'text-to-image',
      userConfig: { model: 'gpt-image-2', steps: 20, enhance: true },
    });
    expect(ctx.providerConfig.baseUrl).toBe('https://example.com');
    expect(ctx.session).toEqual({});
    ctx.session.count = 1;
    expect(ctx.session.count).toBe(1);
    expect(ctx.readFileToBase64).toBe(readFileToBase64);
    expect(await ctx.readFileToBase64?.('assert/a.png')).toBe('base64:assert/a.png');
    expect(await ctx.readFileToBase64?.('assert/a.png', true)).toBe('data:image/png;base64,base64:assert/a.png');
    expect(ctx.workflowType).toBe('text-to-image');
    expect(ctx.userConfig).toEqual({ model: 'gpt-image-2', steps: 20, enhance: true });
    const res = await ctx.request({ url: 'https://example.com/t' });
    expect(res.data).toEqual({ ok: 1 });
  });
});

describe('buildWorkflowCallContext 缺省值', () => {
  it('未传 userConfig / readFileToBase64 时分别回退空对象与 undefined', () => {
    const ctx = buildWorkflowCallContext({ providerConfig: {}, params: {} });
    expect(ctx.userConfig).toEqual({});
    expect(ctx.readFileToBase64).toBeUndefined();
  });
});

describe('normalizeWorkflowResult / normalizeProgress', () => {
  it('校验 isFinish 与 outputs', () => {
    expect(normalizeWorkflowResult({ isFinish: true, outputs: ['a'] }, '提取')).toEqual({ isFinish: true, failed: false, progress: null, outputs: ['a'] });
    expect(() => normalizeWorkflowResult({ outputs: [] }, '提取')).toThrow(/isFinish/);
    expect(() => normalizeWorkflowResult({ isFinish: true, outputs: [1] }, '提取')).toThrow(/outputs/);
  });

  it('failed: true 隐含完成（无需 isFinish）并透出 errorMessage', () => {
    expect(normalizeWorkflowResult({ failed: true, errorMessage: '内容违规' }, '提取'))
      .toEqual({ isFinish: true, failed: true, errorMessage: '内容违规', progress: null, outputs: undefined });
    expect(normalizeWorkflowResult({ failed: true }, '提取'))
      .toEqual({ isFinish: true, failed: true, progress: null, outputs: undefined });
  });

  it('failed: true 时 isFinish 保持完成态，failed: false 仍需 isFinish', () => {
    expect(normalizeWorkflowResult({ isFinish: false, failed: true }, '提取')).toEqual({ isFinish: true, failed: true, progress: null });
    expect(() => normalizeWorkflowResult({ failed: false }, '提取')).toThrow(/isFinish/);
    expect(normalizeWorkflowResult({ isFinish: false, failed: false }, '提取'))
      .toEqual({ isFinish: false, failed: false, progress: null });
  });

  it('failed / errorMessage 类型非法时报错', () => {
    expect(() => normalizeWorkflowResult({ failed: 'yes' }, '提取')).toThrow(/failed/);
    expect(() => normalizeWorkflowResult({ failed: true, errorMessage: 1 }, '提取')).toThrow(/errorMessage/);
  });

  it('progress 钳制与未知值', () => {
    expect(normalizeProgress(50)).toBe(50);
    expect(normalizeProgress(150)).toBe(100);
    expect(normalizeProgress(-3)).toBeUndefined();
    expect(normalizeProgress(null)).toBeUndefined();
  });
});
