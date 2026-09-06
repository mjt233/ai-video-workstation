import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

import { streamText } from 'ai';
import { createLlmStream, type LlmMediaInput } from './runtime.js';
import type { LlmClient } from './client.js';

const mockStreamText = vi.mocked(streamText);

/** 构造可用的客户端桩 */
function makeClient(): LlmClient {
  return {
    protocol: 'openai-chat',
    model: vi.fn().mockReturnValue({}),
    reasoningOptions: vi.fn().mockReturnValue({ openai: { reasoningEffort: 'low' } }),
    supportsInput: () => true,
  } as unknown as LlmClient;
}

beforeEach(() => {
  mockStreamText.mockReset();
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

  it('媒体输入转换为 file 内容部分并传入 streamText', async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'ok', id: 't1' };
      })(),
    } as never);
    const media: LlmMediaInput[] = [
      { type: 'image', mimeType: 'image/png', base64: 'aGVsbG8=', filename: 'a.png' },
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
});
