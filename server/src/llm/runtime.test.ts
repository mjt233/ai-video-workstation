import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));
vi.mock('./openai-chat-stream.js', () => ({
  streamOpenAiChatCompletions: vi.fn(),
}));

import { streamText } from 'ai';
import { streamOpenAiChatCompletions } from './openai-chat-stream.js';
import { createLlmStream, type LlmMediaInput } from './runtime.js';
import type { LlmClient } from './client.js';

const mockStreamText = vi.mocked(streamText);
const mockNativeStream = vi.mocked(streamOpenAiChatCompletions);

/** 构造可用的客户端桩 */
function makeClient(): LlmClient {
  return {
    protocol: 'openai-chat',
    baseUrl: 'https://example.com/v1',
    apiKey: 'sk-test',
    model: vi.fn().mockReturnValue({}),
    reasoningOptions: vi.fn().mockReturnValue({ openai: { reasoningEffort: 'low' } }),
    mediaRule: vi.fn().mockReturnValue(undefined),
  } as unknown as LlmClient;
}

beforeEach(() => {
  mockStreamText.mockReset();
  mockNativeStream.mockReset();
  mockNativeStream.mockImplementation(async function* () {
    yield { type: 'text', delta: '原生流响应' };
    yield { type: 'done' };
  });
});

describe('createLlmStream', () => {
  it('产出 text/thinking/done 事件序列（流式增量）', async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'reasoning-delta', text: '思考中', id: 'r1' };
        yield { type: 'text-delta', text: '你好', id: 't1' };
        yield { type: 'text-delta', text: '，我是 AI', id: 't2' };
      })(),
    } as never);
    const events = [];
    for await (const e of createLlmStream({
      client: makeClient(),
      modelId: 'glm-5.3-flash',
      input: '你好，你是什么模型？',
      media: [],
      reasoningEffort: 'low',
    })) {
      events.push(e);
    }
    expect(events).toEqual([
      { type: 'thinking', delta: '思考中' },
      { type: 'text', delta: '你好' },
      { type: 'text', delta: '，我是 AI' },
      { type: 'done' },
    ]);
  });

  it('内联媒体输入转换为 file 内容部分并传入 streamText', async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'ok', id: 't1' };
      })(),
    } as never);
    const media: LlmMediaInput[] = [
      { type: 'image', mimeType: 'image/png', filename: 'a.png', source: { kind: 'inline', base64: 'aGVsbG8=' } },
    ];
    const events = [];
    for await (const e of createLlmStream({
      client: makeClient(),
      modelId: 'glm-5.3-flash',
      input: '图片是什么颜色？',
      media,
    })) {
      events.push(e);
    }
    expect(mockStreamText).toHaveBeenCalledTimes(1);
    const call = mockStreamText.mock.calls[0][0] as {
      messages: { content: unknown }[];
      providerOptions?: unknown;
    };
    expect(call.messages[0].content).toEqual([
      { type: 'text', text: '图片是什么颜色？' },
      { type: 'file', data: { type: 'data', data: 'aGVsbG8=' }, mediaType: 'image/png', filename: 'a.png' },
    ]);
    expect(call.providerOptions).toEqual({ openai: { reasoningEffort: 'low' } });
  });

  it('模型调用异常时输出 error 事件（用户中断不产出 error）', async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'error', error: new Error('模型超时') };
      })(),
    } as never);
    const events = [];
    for await (const e of createLlmStream({
      client: makeClient(),
      modelId: 'm',
      input: 'hi',
      media: [],
    })) {
      events.push(e);
    }
    expect(events).toEqual([{ type: 'error', message: '模型超时' }]);
  });

  it('含公网 URL 媒体（openai-chat 视频）时改走原生 SSE 客户端，不调用 AI SDK', async () => {
    const client = makeClient();
    const media: LlmMediaInput[] = [
      { type: 'video', mimeType: 'video/mp4', filename: 'v.mp4', source: { kind: 'url', url: 'https://cdn.example.com/v.mp4' } },
    ];
    const events = [];
    for await (const e of createLlmStream({
      client,
      modelId: 'glm-5.3-flash',
      input: '视频里有什么？',
      media,
      reasoningEffort: 'high',
    })) {
      events.push(e);
    }
    expect(events).toEqual([
      { type: 'text', delta: '原生流响应' },
      { type: 'done' },
    ]);
    expect(mockStreamText).not.toHaveBeenCalled();
    expect(mockNativeStream).toHaveBeenCalledTimes(1);
    const nativeArgs = mockNativeStream.mock.calls[0][0] as {
      baseUrl: string;
      apiKey: string;
      modelId: string;
      input: string;
      media: LlmMediaInput[];
      reasoningEffort?: string;
    };
    expect(nativeArgs.baseUrl).toBe('https://example.com/v1');
    expect(nativeArgs.apiKey).toBe('sk-test');
    expect(nativeArgs.modelId).toBe('glm-5.3-flash');
    expect(nativeArgs.input).toBe('视频里有什么？');
    expect(nativeArgs.media).toEqual(media);
    expect(nativeArgs.reasoningEffort).toBe('high');
  });

  it('非 openai-chat 协议出现公网 URL 媒体时抛错（防御性校验）', async () => {
    const client = { ...makeClient(), protocol: 'gemini' as const };
    const media: LlmMediaInput[] = [
      { type: 'video', mimeType: 'video/mp4', filename: 'v.mp4', source: { kind: 'url', url: 'https://cdn.example.com/v.mp4' } },
    ];
    await expect(
      (async () => {
        for await (const e of createLlmStream({ client, modelId: 'm', input: 'hi', media })) {
          // 防御性校验应先抛错，不应产出任何事件
          throw new Error(`不应产出事件：${JSON.stringify(e)}`);
        }
      })(),
    ).rejects.toThrow('协议 gemini 不支持公网 URL 媒体传输');
  });
});
