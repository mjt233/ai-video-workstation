import { describe, expect, it, vi } from 'vitest';
import type { LlmMediaInput, LlmStreamEvent } from './runtime.js';
import {
  buildOpenAiChatContent,
  buildOpenAiChatRequestBody,
  streamOpenAiChatCompletions,
  type OpenAiChatStreamParams,
} from './openai-chat-stream.js';

/** 构造媒体输入 */
function media(overrides: Partial<LlmMediaInput> & Pick<LlmMediaInput, 'type'>): LlmMediaInput {
  return {
    mimeType: 'image/png',
    filename: 'f.png',
    source: { kind: 'inline', base64: 'aGVsbG8=' },
    ...overrides,
  } as LlmMediaInput;
}

/** 用字符串分片构造 SSE Response（可控分片边界） */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

/** 收集异步事件序列 */
async function collect(gen: AsyncGenerator<LlmStreamEvent>): Promise<LlmStreamEvent[]> {
  const events: LlmStreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

/** 构造调用参数（fetch 默认返回空 SSE） */
function params(overrides: Partial<OpenAiChatStreamParams> = {}): OpenAiChatStreamParams {
  return {
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    modelId: 'glm-5.3-flash',
    input: '你好',
    media: [],
    ...overrides,
  };
}

describe('buildOpenAiChatContent', () => {
  it('内容块顺序固定：video_url → image_url → input_audio → text', () => {
    const parts = buildOpenAiChatContent(
      [
        media({ type: 'audio', mimeType: 'audio/wav', filename: 'a.wav', source: { kind: 'inline', base64: 'YXVkaW8=' } }),
        media({ type: 'image', mimeType: 'image/png', source: { kind: 'inline', base64: 'aW1n' } }),
        media({ type: 'video', mimeType: 'video/mp4', filename: 'v.mp4', source: { kind: 'url', url: 'https://cdn.example.com/v.mp4' } }),
      ],
      '描述一下',
    );
    expect(parts).toEqual([
      { type: 'video_url', video_url: { url: 'https://cdn.example.com/v.mp4' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1n' } },
      { type: 'input_audio', input_audio: { data: 'YXVkaW8=', format: 'wav' } },
      { type: 'text', text: '描述一下' },
    ]);
  });

  it('mp3 音频映射为 mp3 格式；空文本不产出 text 块', () => {
    const parts = buildOpenAiChatContent(
      [media({ type: 'audio', mimeType: 'audio/mpeg', filename: 'a.mp3', source: { kind: 'inline', base64: 'bXAz' } })],
      '   ',
    );
    expect(parts).toEqual([{ type: 'input_audio', input_audio: { data: 'bXAz', format: 'mp3' } }]);
  });

  it('视频缺少公网 URL / 音频使用 URL 传输时抛错（防御性校验）', () => {
    expect(() =>
      buildOpenAiChatContent(
        [media({ type: 'video', mimeType: 'video/mp4', source: { kind: 'inline', base64: 'dmlk' } })],
        'hi',
      ),
    ).toThrow('视频输入需要公网 URL（请先配置文件中转）：f.png');
    expect(() =>
      buildOpenAiChatContent(
        [media({ type: 'audio', mimeType: 'audio/wav', source: { kind: 'url', url: 'https://cdn.example.com/a.wav' } })],
        'hi',
      ),
    ).toThrow('音频输入不支持公网 URL 传输（仅支持内联 base64）：f.png');
  });

  it('不支持的音频格式抛错', () => {
    expect(() =>
      buildOpenAiChatContent(
        [media({ type: 'audio', mimeType: 'audio/flac', source: { kind: 'inline', base64: 'ZmxhYw==' } })],
        'hi',
      ),
    ).toThrow('不支持的音频格式：audio/flac（仅支持 wav/mp3）');
  });
});

describe('buildOpenAiChatRequestBody', () => {
  it('stream 固定为 true；合法思考强度透传 reasoning_effort', () => {
    const body = buildOpenAiChatRequestBody({
      modelId: 'glm-5.3-flash',
      input: 'hi',
      media: [],
      reasoningEffort: ' High ',
    });
    expect(body.model).toBe('glm-5.3-flash');
    expect(body.stream).toBe(true);
    expect(body.reasoning_effort).toBe('high');
    expect(body.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'hi' }] });
  });

  it('非法思考强度不携带 reasoning_effort', () => {
    const body = buildOpenAiChatRequestBody({ modelId: 'm', input: 'hi', media: [], reasoningEffort: 'bogus' });
    expect(body.reasoning_effort).toBeUndefined();
  });
});

describe('streamOpenAiChatCompletions', () => {
  it('正常流：reasoning_content → thinking、content → text、[DONE] → done；请求头与请求体正确', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":[{"type":"text","text":"，世界"}]}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    ) as unknown as typeof fetch;
    const video = media({
      type: 'video',
      mimeType: 'video/mp4',
      filename: 'v.mp4',
      source: { kind: 'url', url: 'https://cdn.example.com/v.mp4' },
    });
    const events = await collect(
      streamOpenAiChatCompletions(
        params({ input: '视频里有什么？', media: [video], reasoningEffort: 'medium', fetchImpl }),
      ),
    );
    expect(events).toEqual([
      { type: 'thinking', delta: '思考' },
      { type: 'text', delta: '你好' },
      { type: 'text', delta: '，世界' },
      { type: 'done' },
    ]);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: 'Bearer sk-test',
    });
    const body = JSON.parse(String(init.body)) as {
      model: string;
      stream: boolean;
      reasoning_effort?: string;
      messages: { role: string; content: unknown[] }[];
    };
    expect(body.model).toBe('glm-5.3-flash');
    expect(body.stream).toBe(true);
    expect(body.reasoning_effort).toBe('medium');
    expect(body.messages[0].content).toEqual([
      { type: 'video_url', video_url: { url: 'https://cdn.example.com/v.mp4' } },
      { type: 'text', text: '视频里有什么？' },
    ]);
  });

  it('SSE 跨分片解析（一行被切断也能拼回）', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"思',
        '考"}}]}\n\ndata: {"choices":[{"delta":{"content":"你',
        '好"}}]}\n\n',
        'data: [DO',
        'NE]\n\n',
      ]),
    ) as unknown as typeof fetch;
    const events = await collect(streamOpenAiChatCompletions(params({ fetchImpl })));
    expect(events).toEqual([
      { type: 'thinking', delta: '思考' },
      { type: 'text', delta: '你好' },
      { type: 'done' },
    ]);
  });

  it('空块 / 空 choices / 注释行容错（不产出事件）', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        ': keep-alive\n\n',
        'data: {}\n\n',
        'data: {"choices":[]}\n\n',
        'data: {"choices":[{"delta":{}}]}\n\n',
        'data: {"choices":[{"delta":{"content":""}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"正常"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    ) as unknown as typeof fetch;
    const events = await collect(streamOpenAiChatCompletions(params({ fetchImpl })));
    expect(events).toEqual([{ type: 'text', delta: '正常' }, { type: 'done' }]);
  });

  it('流自然耗尽（无 [DONE]）也产出 done', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse(['data: {"choices":[{"delta":{"content":"结尾"}}]}']),
    ) as unknown as typeof fetch;
    const events = await collect(streamOpenAiChatCompletions(params({ fetchImpl })));
    expect(events).toEqual([{ type: 'text', delta: '结尾' }, { type: 'done' }]);
  });

  it('HTTP 非 2xx 解析 {error:{code,message}} 并抛中文错误', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: '1214', message: '模型不存在' } }), { status: 400 }),
    ) as unknown as typeof fetch;
    await expect(collect(streamOpenAiChatCompletions(params({ fetchImpl })))).rejects.toThrow(
      '模型接口调用失败（HTTP 400）：[1214] 模型不存在',
    );
  });

  it('HTTP 非 2xx 且响应体非 JSON 时回退原始文本', async () => {
    const fetchImpl = vi.fn(async () => new Response('Bad Gateway', { status: 502 })) as unknown as typeof fetch;
    await expect(collect(streamOpenAiChatCompletions(params({ fetchImpl })))).rejects.toThrow(
      '模型接口调用失败（HTTP 502）：Bad Gateway',
    );
  });

  it('响应无流式 body 时抛错', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    await expect(collect(streamOpenAiChatCompletions(params({ fetchImpl })))).rejects.toThrow(
      '模型接口未返回流式响应体',
    );
  });

  it('调用前已中止 → 抛 AbortError 且不发起请求', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      collect(
        streamOpenAiChatCompletions(params({ fetchImpl, abortSignal: AbortSignal.abort() })),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('流式读取过程中被中止 → 抛 AbortError', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'));
          signal.addEventListener('abort', () => {
            c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;
    const events: LlmStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const e of streamOpenAiChatCompletions(params({ fetchImpl, abortSignal: controller.signal }))) {
          events.push(e);
          if (e.type === 'text') controller.abort();
        }
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(events).toEqual([{ type: 'text', delta: 'a' }]);
  });
});
