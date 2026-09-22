/**
 * 自定义服务商「文本生成」（text-generation）链路单测。
 *
 * 覆盖三件事（对应需求：脚本可直接返回文本内容，或返回文本 URL）：
 * 1. 【结果提取】返回 `text` → getOutput 产出文本产物（不判 URL、不下载）；
 * 2. 返回 `outputs: [文本 URL]` → 下载并按 Content-Type 校验后产出文本；
 * 3. 非文本内容 / 超限 / 空内容 / 非文本类型误用 text → 明确的中文错误。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCustomProviderClient, type CustomProviderClient } from './client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * 构造只含一个文本生成工作流的配置。
 *
 * @param extractCode 【结果提取】代码
 * @param types 该条目声明的工作流类型（默认仅 text-generation）
 * @returns 客户端配置对象
 */
function textConfig(extractCode: string, types: string[] = ['text-generation']): Record<string, unknown> {
  return {
    baseUrl: 'https://example.com',
    apiKey: 'sk-x',
    timeout: 2,
    workflows: [
      {
        name: 'wf-text',
        types,
        async: false,
        cancelable: false,
        callCode: 'export default async function() { return { url: "https://example.com/run" } }',
        extractCode,
        cancelCode: '',
      },
    ],
  };
}

/** 按 URL 路由的 fetch mock（未命中返回 500） */
function mockFetchByUrl(routes: Record<string, () => Response | Promise<Response>>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const handler = routes[String(url)];
    if (handler) return handler();
    return new Response(JSON.stringify({ error: 'unhandled ' + String(url) }), { status: 500 });
  });
}

/**
 * 执行任务并等待终态（同步工作流：提交后协程自行推进）。
 *
 * @param client 客户端
 * @param workflowId 工作流名
 * @returns 任务 id
 */
async function runToTerminal(client: CustomProviderClient, workflowId: string): Promise<string> {
  const { taskId } = await client.execute({ workflowId, params: { prompt: '写一段话' } });
  for (let i = 0; i < 200; i++) {
    const result = await client.poll(taskId);
    if (result.done) return taskId;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('任务未在预期时间内收敛');
}

describe('自定义服务商文本生成产物', () => {
  it('【结果提取】直接返回 text：不请求任何产物 URL，产出文本产物', async () => {
    const fetchMock = mockFetchByUrl({
      'https://example.com/run': () => new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createCustomProviderClient(textConfig(
      'export default async function() { return { isFinish: true, text: "直接返回的文本\\n第二行" } }',
    ) as never);

    const taskId = await runToTerminal(client, 'wf-text');
    const output = await client.getOutput(taskId);

    expect(output).toEqual({ type: 'text', text: '直接返回的文本\n第二行' });
    // 只有提交那一次请求：产物来自脚本返回值，不再下载
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('同时返回 text 与 outputs 时以 text 为准并告警（不下载 URL）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = mockFetchByUrl({
      'https://example.com/run': () => new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      'https://example.com/out.txt': () => new Response('URL 内容', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createCustomProviderClient(textConfig(
      'export default async function() { return { isFinish: true, text: "脚本文本", outputs: ["https://example.com/out.txt"] } }',
    ) as never);

    const output = await client.getOutput(await runToTerminal(client, 'wf-text'));

    expect(output).toEqual({ type: 'text', text: '脚本文本' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/优先使用 text/);
  });

  it('返回 outputs（文本 URL）：下载解码为文本，剥离 BOM', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      'https://example.com/out.txt': () => new Response('\uFEFF文本产物内容', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    }));
    const client = createCustomProviderClient(textConfig(
      'export default async function() { return { isFinish: true, outputs: ["https://example.com/out.txt"] } }',
    ) as never);

    const output = await client.getOutput(await runToTerminal(client, 'wf-text'));

    expect(output).toEqual({ type: 'text', text: '文本产物内容' });
  });

  it('产物 Content-Type 非文本时给出可操作的中文错误', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      'https://example.com/a.png': () => new Response('binary', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    }));
    const client = createCustomProviderClient(textConfig(
      'export default async function() { return { isFinish: true, outputs: ["https://example.com/a.png"] } }',
    ) as never);

    const taskId = await runToTerminal(client, 'wf-text');
    await expect(client.getOutput(taskId)).rejects.toThrow(/不是文本内容（Content-Type: image\/png）/);
  });

  it('产物为空内容时报错（不把空文本当成功产物）', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      'https://example.com/empty.txt': () => new Response('   ', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    }));
    const client = createCustomProviderClient(textConfig(
      'export default async function() { return { isFinish: true, outputs: ["https://example.com/empty.txt"] } }',
    ) as never);

    const taskId = await runToTerminal(client, 'wf-text');
    await expect(client.getOutput(taskId)).rejects.toThrow(/内容为空/);
  });

  it('既无 text 也无 outputs 时返回 null（引擎据此报「无输出」）', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    }));
    const client = createCustomProviderClient(textConfig(
      'export default async function() { return { isFinish: true } }',
    ) as never);

    expect(await client.getOutput(await runToTerminal(client, 'wf-text'))).toBeNull();
  });

  it('非文本生成类型返回 text：明确提示需勾选「文本生成」类型', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      'https://example.com/run': () => new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    }));
    const client = createCustomProviderClient(textConfig(
      'export default async function() { return { isFinish: true, text: "文本" } }',
      ['text-to-image'],
    ) as never);

    const taskId = await runToTerminal(client, 'wf-text');
    await expect(client.getOutput(taskId)).rejects.toThrow(/其类型未勾选「文本生成」/);
  });
});
