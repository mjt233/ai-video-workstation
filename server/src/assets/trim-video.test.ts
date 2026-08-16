import { describe, expect, it, vi, beforeEach } from 'vitest';

// 模块级 mock：fluent-ffmpeg、paths.js 的 pathExists、extract-frame 的视频/音频探测
const { mockFfmpeg, mockPathExists, mockGetVideoInfo, mockGetAudioInfo, mockMkdir } = vi.hoisted(() => ({
  mockFfmpeg: vi.fn(),
  mockPathExists: vi.fn(),
  mockGetVideoInfo: vi.fn(),
  mockGetAudioInfo: vi.fn(),
  mockMkdir: vi.fn(async () => undefined),
}));

vi.mock('fluent-ffmpeg', () => {
  const ffmpegFn = (...args: unknown[]) => mockFfmpeg(...args);
  return { default: ffmpegFn };
});

vi.mock('./paths.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./paths.js')>();
  return { ...mod, pathExists: mockPathExists };
});

vi.mock('./extract-frame.js', () => ({
  getVideoInfo: mockGetVideoInfo,
  getAudioInfo: mockGetAudioInfo,
}));

vi.mock('fs/promises', () => ({
  default: { mkdir: mockMkdir },
  mkdir: mockMkdir,
}));

import { resolveTrimWindow, trimVideo } from './trim-video.js';
import type { VideoInfo } from './extract-frame.js';

/** 构造可链式调用、可触发 end/error 的 ffmpeg 假对象，并记录输出选项与保存路径 */
function mockRun() {
  const state: {
    outputs: string[];
    saved: string;
    end?: () => void;
    err?: (e: Error) => void;
    failOnSave?: boolean;
  } = { outputs: [], saved: '', failOnSave: false };
  const chain = {
    outputOptions: (o: string[]) => {
      state.outputs = o;
      return chain;
    },
    on: (event: string, cb: (e?: Error) => void) => {
      if (event === 'end') state.end = cb as () => void;
      else if (event === 'error') state.err = cb as (e: Error) => void;
      return chain;
    },
    save: (out: string) => {
      state.saved = out;
      if (state.failOnSave) state.err?.(new Error('ffmpeg 执行失败'));
      else state.end?.();
      return chain;
    },
  };
  return { chain, state };
}

/** 默认探测：4s / 25fps / 1280x720 */
const INFO: VideoInfo = { duration: 4, fps: 25, width: 1280, height: 720, codec: 'h264' };

beforeEach(() => {
  vi.clearAllMocks();
  mockPathExists.mockResolvedValue(true);
  mockGetVideoInfo.mockResolvedValue(INFO);
  mockGetAudioInfo.mockResolvedValue({ duration: 4 });
});

describe('resolveTrimWindow', () => {
  it('按起始时间解析窗口', () => {
    expect(resolveTrimWindow({ startTime: 1.5, duration: 1 }, INFO)).toEqual({ start: 1.5, duration: 1 });
  });

  it('按起始帧索引 / fps 换算为秒', () => {
    expect(resolveTrimWindow({ startFrame: 50, duration: 0.5 }, INFO)).toEqual({ start: 2, duration: 0.5 });
  });

  it('起点 + 时长超出片尾时截到剩余时长', () => {
    expect(resolveTrimWindow({ startTime: 3.5, duration: 2 }, INFO)).toEqual({ start: 3.5, duration: 0.5 });
  });

  it('优先 startTime（同时给 startFrame 时忽略帧）', () => {
    expect(resolveTrimWindow({ startTime: 1, startFrame: 50, duration: 1 }, INFO)).toEqual({
      start: 1,
      duration: 1,
    });
  });

  it('持续时长必须大于 0', () => {
    expect(() => resolveTrimWindow({ startTime: 0, duration: 0 }, INFO)).toThrowError(
      expect.objectContaining({ code: 'INVALID', message: expect.stringContaining('持续时长') }),
    );
    expect(() => resolveTrimWindow({ startTime: 0, duration: -1 }, INFO)).toThrowError(
      expect.objectContaining({ code: 'INVALID' }),
    );
  });

  it('起始时间越界（≥ 时长 / 负数）抛 INVALID', () => {
    expect(() => resolveTrimWindow({ startTime: 4, duration: 1 }, INFO)).toThrowError(
      expect.objectContaining({ code: 'INVALID', message: expect.stringContaining('越界') }),
    );
    expect(() => resolveTrimWindow({ startTime: -0.1, duration: 1 }, INFO)).toThrowError(
      expect.objectContaining({ code: 'INVALID' }),
    );
  });

  it('起始帧索引非整数 / 负数 / 越界抛 INVALID', () => {
    expect(() => resolveTrimWindow({ startFrame: 1.5, duration: 1 }, INFO)).toThrowError(
      expect.objectContaining({ code: 'INVALID', message: expect.stringContaining('整数') }),
    );
    expect(() => resolveTrimWindow({ startFrame: -1, duration: 1 }, INFO)).toThrowError(
      expect.objectContaining({ code: 'INVALID' }),
    );
    expect(() => resolveTrimWindow({ startFrame: 100, duration: 1 }, INFO)).toThrowError(
      expect.objectContaining({ code: 'INVALID', message: expect.stringContaining('越界') }),
    );
  });

  it('帧模式但 fps 不可用抛 INVALID', () => {
    expect(() =>
      resolveTrimWindow({ startFrame: 0, duration: 1 }, { ...INFO, fps: 0 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID', message: expect.stringContaining('帧率') }));
  });

  it('未指定起点抛 INVALID', () => {
    expect(() => resolveTrimWindow({ duration: 1 }, INFO)).toThrowError(
      expect.objectContaining({ code: 'INVALID', message: expect.stringContaining('起始') }),
    );
  });

  it('视频时长不可用抛 INVALID', () => {
    expect(() => resolveTrimWindow({ startTime: 0, duration: 1 }, { ...INFO, duration: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID', message: expect.stringContaining('时长') }),
    );
  });
});

describe('trimVideo', () => {
  it('按时间裁剪：ffmpeg -ss / -t 重编码，有音轨走 aac，不含 -c copy', async () => {
    const { chain, state } = mockRun();
    mockFfmpeg.mockReturnValue(chain);

    const result = await trimVideo(
      'p',
      'assert/v.mp4',
      { startTime: 1.25, duration: 0.8 },
      'assert/out.mp4',
    );

    expect(result).toBe('assert/out.mp4');
    expect(mockFfmpeg).toHaveBeenCalledWith(expect.stringContaining('v.mp4'));
    expect(state.outputs).toContain('-ss');
    expect(state.outputs[state.outputs.indexOf('-ss') + 1]).toBe('1.25');
    expect(state.outputs).toContain('-t');
    expect(state.outputs[state.outputs.indexOf('-t') + 1]).toBe('0.8');
    expect(state.outputs).toContain('libx264');
    expect(state.outputs).toContain('aac');
    expect(state.outputs).not.toContain('copy');
    expect(state.saved).toMatch(/out\.mp4$/);
  });

  it('按帧索引裁剪：startFrame / fps 换算后写入 -ss', async () => {
    const { chain, state } = mockRun();
    mockFfmpeg.mockReturnValue(chain);

    await trimVideo('p', 'assert/v.mp4', { startFrame: 25, duration: 1 }, 'assert/out.mp4');

    expect(state.outputs[state.outputs.indexOf('-ss') + 1]).toBe('1');
    expect(state.outputs[state.outputs.indexOf('-t') + 1]).toBe('1');
  });

  it('无音轨时输出 -an，不写 aac', async () => {
    const { chain, state } = mockRun();
    mockFfmpeg.mockReturnValue(chain);
    mockGetAudioInfo.mockRejectedValueOnce(new Error('未找到音频流'));

    await trimVideo('p', 'assert/v.mp4', { startTime: 0, duration: 1 }, 'assert/out.mp4');

    expect(state.outputs).toContain('-an');
    expect(state.outputs).not.toContain('aac');
  });

  it('输入视频缺失抛 NOT_FOUND，不执行 ffmpeg', async () => {
    mockPathExists.mockResolvedValueOnce(false);
    await expect(
      trimVideo('p', 'assert/missing.mp4', { startTime: 0, duration: 1 }, 'assert/out.mp4'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockFfmpeg).not.toHaveBeenCalled();
  });

  it('起点越界抛 INVALID，不执行 ffmpeg', async () => {
    await expect(
      trimVideo('p', 'assert/v.mp4', { startTime: 9, duration: 1 }, 'assert/out.mp4'),
    ).rejects.toMatchObject({ code: 'INVALID' });
    expect(mockFfmpeg).not.toHaveBeenCalled();
  });

  it('ffmpeg 执行失败抛 INVALID', async () => {
    const { chain, state } = mockRun();
    state.failOnSave = true;
    mockFfmpeg.mockReturnValue(chain);

    await expect(
      trimVideo('p', 'assert/v.mp4', { startTime: 0, duration: 1 }, 'assert/out.mp4'),
    ).rejects.toMatchObject({
      code: 'INVALID',
      message: expect.stringContaining('裁剪失败'),
    });
  });
});
