import { describe, expect, it, vi } from 'vitest';
import {
  MAX_INLINE_MEDIA_BYTES,
  formatMediaBytes,
  getProtocolMediaRule,
  isMimeTypeAllowed,
  LlmMediaError,
  materializeMediaInputs,
  mediaTypeLabel,
  planMediaInputs,
  resolveMediaCapability,
  type MediaProbeDeps,
  type PlannedMediaInput,
} from './media.js';

const MB = 1024 * 1024;

/** 构造 path→size 的探测依赖（便于规划用例） */
function makeProbeDeps(sizes: Record<string, number>, failPaths: string[] = []): MediaProbeDeps {
  return {
    resolvePath: (rel: string) => `C:/proj/${rel}`,
    statSize: async (abs: string) => {
      const rel = abs.slice('C:/proj/'.length);
      if (failPaths.includes(rel)) throw new Error('ENOENT: no such file');
      const size = sizes[rel];
      if (size === undefined) throw new Error('ENOENT: no such file');
      return size;
    },
    logError: () => {},
  };
}

describe('getProtocolMediaRule', () => {
  it('openai-chat：图片内联 ≤5MB、音频内联 ≤20MB、视频公网 URL ≤200MB 最多 1 个', () => {
    const image = getProtocolMediaRule('openai-chat', 'image');
    expect(image).toEqual({
      supported: true,
      transport: 'inline',
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxBytes: 5 * MB,
    });
    const audio = getProtocolMediaRule('openai-chat', 'audio');
    expect(audio).toEqual({
      supported: true,
      transport: 'inline',
      mimeTypes: ['audio/wav', 'audio/mpeg', 'audio/mp3'],
      maxBytes: 20 * MB,
    });
    const video = getProtocolMediaRule('openai-chat', 'video');
    expect(video).toEqual({
      supported: true,
      transport: 'public-url',
      mimeTypes: ['video/mp4', 'video/x-matroska', 'video/quicktime'],
      maxBytes: 200 * MB,
      maxCount: 1,
    });
  });

  it('gemini：图片/音频/视频均内联，上限 20MB', () => {
    for (const type of ['image', 'audio', 'video'] as const) {
      const rule = getProtocolMediaRule('gemini', type);
      expect(rule?.transport).toBe('inline');
      expect(rule?.maxBytes).toBe(20 * MB);
      expect(rule?.mimeTypes).toEqual([`${type}/*`]);
    }
  });

  it('openai-responses / anthropic / grok：仅图片内联', () => {
    for (const protocol of ['openai-responses', 'anthropic', 'grok'] as const) {
      expect(getProtocolMediaRule(protocol, 'image')?.transport).toBe('inline');
      expect(getProtocolMediaRule(protocol, 'audio')).toBeUndefined();
      expect(getProtocolMediaRule(protocol, 'video')).toBeUndefined();
    }
  });
});

describe('isMimeTypeAllowed', () => {
  it('精确匹配大小写不敏感', () => {
    expect(isMimeTypeAllowed(['image/png'], 'IMAGE/PNG')).toBe(true);
    expect(isMimeTypeAllowed(['image/png'], 'image/jpeg')).toBe(false);
  });

  it('支持 type/* 通配', () => {
    expect(isMimeTypeAllowed(['image/*'], 'image/gif')).toBe(true);
    expect(isMimeTypeAllowed(['image/*'], 'audio/wav')).toBe(false);
    expect(isMimeTypeAllowed(['video/*'], 'video/x-matroska')).toBe(true);
  });
});

describe('resolveMediaCapability', () => {
  it('协议不支持 → reason=protocol', () => {
    const cap = resolveMediaCapability('anthropic', 'audio');
    expect(cap.supported).toBe(false);
    expect(cap.reason).toBe('protocol');
    expect(cap.rule).toBeUndefined();
  });

  it('模型元信息未声明该模态 → reason=model', () => {
    const modalities = new Set(['text', 'image']);
    const cap = resolveMediaCapability('openai-chat', 'audio', modalities);
    expect(cap.supported).toBe(false);
    expect(cap.reason).toBe('model');
    expect(cap.rule?.transport).toBe('inline');
  });

  it('模型元信息为空时不按模型过滤（向后兼容）', () => {
    expect(resolveMediaCapability('openai-chat', 'video', new Set()).supported).toBe(true);
    expect(resolveMediaCapability('openai-chat', 'audio', new Set(['text'])).supported).toBe(false);
  });
});

describe('mediaTypeLabel / formatMediaBytes', () => {
  it('中文标签', () => {
    expect(mediaTypeLabel('image')).toBe('图片');
    expect(mediaTypeLabel('audio')).toBe('音频');
    expect(mediaTypeLabel('video')).toBe('视频');
  });

  it('字节格式化', () => {
    expect(formatMediaBytes(5 * MB)).toBe('5MB');
    expect(formatMediaBytes(20 * MB)).toBe('20MB');
    expect(formatMediaBytes(200 * MB)).toBe('200MB');
    expect(formatMediaBytes(1.5 * MB)).toBe('1.5MB');
  });
});

describe('planMediaInputs', () => {
  it('合法图片/音频/视频生成发送计划（含传输方式与推断 MIME）', async () => {
    const plan = await planMediaInputs(
      [
        { type: 'image', path: 'assert/a.png' },
        { type: 'audio', path: 'assert/a.wav' },
        { type: 'video', path: 'assert/v.mp4' },
      ],
      'openai-chat',
      new Set(['text', 'image', 'audio', 'video']),
      makeProbeDeps({ 'assert/a.png': 1024, 'assert/a.wav': 2048, 'assert/v.mp4': 3 * MB }),
    );
    expect(plan.warnings).toEqual([]);
    expect(plan.items).toEqual([
      { type: 'image', relPath: 'assert/a.png', filename: 'a.png', mimeType: 'image/png', size: 1024, transport: 'inline' },
      { type: 'audio', relPath: 'assert/a.wav', filename: 'a.wav', mimeType: 'audio/wav', size: 2048, transport: 'inline' },
      {
        type: 'video',
        relPath: 'assert/v.mp4',
        filename: 'v.mp4',
        mimeType: 'video/mp4',
        size: 3 * MB,
        transport: 'public-url',
      },
    ]);
  });

  it('协议不支持 → 告警忽略；非法条目静默跳过', async () => {
    const plan = await planMediaInputs(
      [
        null,
        { type: 'unknown', path: 'x.png' },
        { type: 'image', path: '' },
        { type: 'audio', path: 'assert/a.wav' },
        { type: 'video', path: 'assert/v.mp4' },
        { type: 'image', path: 'assert/a.png' },
      ],
      'anthropic',
      new Set(),
      makeProbeDeps({ 'assert/a.wav': 1024, 'assert/v.mp4': 1024, 'assert/a.png': 1024 }),
    );
    expect(plan.items.map((i) => i.type)).toEqual(['image']);
    expect(plan.warnings).toEqual([
      '当前协议不支持音频输入，已忽略：a.wav',
      '当前协议不支持视频输入，已忽略：v.mp4',
    ]);
  });

  it('模型元信息未声明模态 → 告警忽略', async () => {
    const plan = await planMediaInputs(
      [{ type: 'audio', path: 'assert/a.wav' }],
      'openai-chat',
      new Set(['text', 'image']),
      makeProbeDeps({ 'assert/a.wav': 1024 }),
    );
    expect(plan.items).toEqual([]);
    expect(plan.warnings).toEqual(['当前模型不支持音频输入，已忽略：a.wav']);
  });

  it('MIME 不允许 → 告警忽略（如 openai-chat 的 gif 图片）', async () => {
    const plan = await planMediaInputs(
      [{ type: 'image', path: 'assert/a.gif' }],
      'openai-chat',
      new Set(),
      makeProbeDeps({ 'assert/a.gif': 1024 }),
    );
    expect(plan.items).toEqual([]);
    expect(plan.warnings).toEqual([
      '媒体格式不支持（image/gif，允许：image/jpeg、image/png、image/webp），已忽略：a.gif',
    ]);
  });

  it('大小超过协议上限 → 告警忽略（图片 5MB / 音频 20MB / 视频 200MB）', async () => {
    const plan = await planMediaInputs(
      [
        { type: 'image', path: 'assert/big.png' },
        { type: 'audio', path: 'assert/big.wav' },
        { type: 'video', path: 'assert/big.mp4' },
      ],
      'openai-chat',
      new Set(),
      makeProbeDeps({
        'assert/big.png': 5 * MB + 1,
        'assert/big.wav': 20 * MB + 1,
        'assert/big.mp4': 200 * MB + 1,
      }),
    );
    expect(plan.items).toEqual([]);
    expect(plan.warnings).toEqual([
      '媒体文件超过 5MB 上限，已忽略：big.png',
      '媒体文件超过 20MB 上限，已忽略：big.wav',
      '媒体文件超过 200MB 上限，已忽略：big.mp4',
    ]);
  });

  it('内联安全阀 20MB 生效（超过安全阀的协议规则也不会放开）', async () => {
    // gemini 规则本身为 20MB，与内联安全阀一致：超过即告警忽略
    const plan = await planMediaInputs(
      [{ type: 'image', path: 'assert/big.png' }],
      'gemini',
      new Set(),
      makeProbeDeps({ 'assert/big.png': MAX_INLINE_MEDIA_BYTES + 1 }),
    );
    expect(plan.items).toEqual([]);
    expect(plan.warnings).toEqual(['媒体文件超过 20MB 上限，已忽略：big.png']);
  });

  it('视频最多 1 个：多余告警忽略', async () => {
    const plan = await planMediaInputs(
      [
        { type: 'video', path: 'assert/v1.mp4' },
        { type: 'video', path: 'assert/v2.mp4' },
      ],
      'openai-chat',
      new Set(),
      makeProbeDeps({ 'assert/v1.mp4': 1024, 'assert/v2.mp4': 1024 }),
    );
    expect(plan.items.map((i) => i.filename)).toEqual(['v1.mp4']);
    expect(plan.warnings).toEqual(['视频输入最多 1 个，已忽略：v2.mp4']);
  });

  it('路径解析/stat 失败 → 告警忽略并输出日志', async () => {
    const logError = vi.fn();
    const plan = await planMediaInputs(
      [{ type: 'image', path: 'assert/missing.png' }],
      'openai-chat',
      new Set(),
      { ...makeProbeDeps({}), logError },
    );
    expect(plan.items).toEqual([]);
    expect(plan.warnings).toEqual(['媒体文件读取失败，已忽略：missing.png']);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(String(logError.mock.calls[0][0])).toContain('assert/missing.png');
  });
});

describe('materializeMediaInputs', () => {
  /** 构造阶段 2 依赖桩 */
  function makeDeps(overrides: {
    readBase64?: (rel: string) => Promise<string>;
    relay?: (rel: string, opts: { signal?: AbortSignal }) => Promise<{ url: string }>;
    onWarning?: (message: string) => void;
    logError?: (message: string) => void;
  } = {}) {
    return {
      readBase64: overrides.readBase64 ?? (async (rel: string) => `base64:${rel}`),
      relay: overrides.relay ?? (async () => ({ url: 'https://cdn.example.com/file.mp4' })),
      ...(overrides.onWarning ? { onWarning: overrides.onWarning } : {}),
      logError: overrides.logError ?? (() => {}),
    };
  }

  /** 计划项工厂 */
  function item(overrides: Partial<PlannedMediaInput> = {}): PlannedMediaInput {
    return {
      type: 'image',
      relPath: 'assert/a.png',
      filename: 'a.png',
      mimeType: 'image/png',
      size: 1024,
      transport: 'inline',
      ...overrides,
    };
  }

  it('内联项读取 base64（同一路径只读一次）', async () => {
    const readBase64 = vi.fn(async (rel: string) => `base64:${rel}`);
    const inputs = await materializeMediaInputs(
      [item(), item({ filename: 'a-copy.png' })],
      makeDeps({ readBase64 }),
    );
    expect(readBase64).toHaveBeenCalledTimes(1);
    expect(inputs).toEqual([
      { type: 'image', mimeType: 'image/png', filename: 'a.png', source: { kind: 'inline', base64: 'base64:assert/a.png' } },
      {
        type: 'image',
        mimeType: 'image/png',
        filename: 'a-copy.png',
        source: { kind: 'inline', base64: 'base64:assert/a.png' },
      },
    ]);
  });

  it('公网 URL 项调用中转（同一文件只上传一次）', async () => {
    const relay = vi.fn(async (_rel: string) => ({ url: 'https://cdn.example.com/v.mp4' }));
    const inputs = await materializeMediaInputs(
      [item({ type: 'video', relPath: 'assert/v.mp4', filename: 'v.mp4', mimeType: 'video/mp4', transport: 'public-url' })],
      makeDeps({ relay }),
    );
    expect(relay).toHaveBeenCalledTimes(1);
    expect(relay.mock.calls[0][0]).toBe('assert/v.mp4');
    expect(inputs).toEqual([
      { type: 'video', mimeType: 'video/mp4', filename: 'v.mp4', source: { kind: 'url', url: 'https://cdn.example.com/v.mp4' } },
    ]);
  });

  it('中转 URL 使用非标准端口 → 发 warning（不阻断，仍发送）', async () => {
    const onWarning = vi.fn();
    const inputs = await materializeMediaInputs(
      [item({ type: 'video', relPath: 'assert/v.mp4', filename: 'v.mp4', mimeType: 'video/mp4', transport: 'public-url' })],
      makeDeps({
        relay: async () => ({ url: 'https://disk.example.com:344/api/get?id=1' }),
        onWarning,
      }),
    );
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning.mock.calls[0][0]).toContain('非标准端口（344）');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].source).toEqual({ kind: 'url', url: 'https://disk.example.com:344/api/get?id=1' });
  });

  it('中转 URL 为标准端口 → 不发端口 warning', async () => {
    const onWarning = vi.fn();
    await materializeMediaInputs(
      [item({ type: 'video', relPath: 'assert/v.mp4', filename: 'v.mp4', mimeType: 'video/mp4', transport: 'public-url' })],
      makeDeps({
        relay: async () => ({ url: 'https://cdn.example.com/v.mp4' }),
        onWarning,
      }),
    );
    expect(onWarning).not.toHaveBeenCalled();
  });

  it('中转失败 → 抛 LlmMediaError（「文件中转失败：<原因>」）', async () => {
    await expect(
      materializeMediaInputs(
        [item({ type: 'video', relPath: 'assert/v.mp4', mimeType: 'video/mp4', transport: 'public-url' })],
        makeDeps({ relay: async () => Promise.reject(new Error('上传超时')) }),
      ),
    ).rejects.toMatchObject({ name: 'LlmMediaError', code: 'RELAY_FAILED', message: '文件中转失败：上传超时' });
  });

  it('中转返回非法 URL → 同样按中转失败处理', async () => {
    await expect(
      materializeMediaInputs(
        [item({ type: 'video', relPath: 'assert/v.mp4', mimeType: 'video/mp4', transport: 'public-url' })],
        makeDeps({ relay: async () => ({ url: 'ftp://example.com/v.mp4' }) }),
      ),
    ).rejects.toBeInstanceOf(LlmMediaError);
  });

  it('内联读取失败 → 告警并跳过，不阻断其他媒体', async () => {
    const onWarning = vi.fn();
    const inputs = await materializeMediaInputs(
      [item({ relPath: 'assert/missing.png', filename: 'missing.png' }), item({ relPath: 'assert/b.png', filename: 'b.png' })],
      makeDeps({
        readBase64: async (rel: string) => {
          if (rel === 'assert/missing.png') throw new Error('ENOENT');
          return `base64:${rel}`;
        },
        onWarning,
      }),
    );
    expect(onWarning).toHaveBeenCalledWith('媒体文件读取失败，已忽略：missing.png');
    expect(inputs.map((i) => i.filename)).toEqual(['b.png']);
  });

  it('中止信号已触发 → 抛 AbortError', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      materializeMediaInputs([item()], makeDeps(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('中转过程中被中止 → 抛 AbortError（取消优先于失败）', async () => {
    const controller = new AbortController();
    await expect(
      materializeMediaInputs(
        [item({ type: 'video', relPath: 'assert/v.mp4', mimeType: 'video/mp4', transport: 'public-url' })],
        makeDeps({
          relay: async () => {
            controller.abort();
            throw new Error('aborted by signal');
          },
        }),
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
