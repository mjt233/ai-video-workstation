import { beforeEach, describe, expect, it, vi } from 'vitest';

// 模块级 mock：隔离 fluent-ffmpeg、路径存在性、音频探测与目录创建。
const { mockFfmpeg, mockPathExists, mockGetAudioInfo, mockMkdir } = vi.hoisted(() => ({
  mockFfmpeg: vi.fn(),
  mockPathExists: vi.fn(),
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
  getAudioInfo: mockGetAudioInfo,
}));

vi.mock('fs/promises', () => ({
  default: { mkdir: mockMkdir },
  mkdir: mockMkdir,
}));

import { resolveAudioTrimWindow, trimAudio } from './trim-audio.js';
import type { AudioInfo } from './extract-frame.js';

/** 构造可链式调用、可触发 end/error 的 ffmpeg 假对象，并记录参数与保存路径。 */
function mockRun() {
  const state: {
    outputs: string[];
    saved: string;
    end?: () => void;
    err?: (e: Error) => void;
    failOnSave: boolean;
  } = { outputs: [], saved: '', failOnSave: false };
  const chain = {
    outputOptions: (options: string[]) => {
      state.outputs = options;
      return chain;
    },
    on: (event: string, callback: (e?: Error) => void) => {
      if (event === 'end') state.end = callback as () => void;
      else if (event === 'error') state.err = callback as (e: Error) => void;
      return chain;
    },
    save: (output: string) => {
      state.saved = output;
      if (state.failOnSave) state.err?.(new Error('ffmpeg 执行失败'));
      else state.end?.();
      return chain;
    },
  };
  return { chain, state };
}

/** 默认探测：4 秒音频。 */
const INFO: AudioInfo = { duration: 4 };

/** 画布节点固定产物输出路径（服务端只允许裁剪到该结构）。 */
const OUTPUT = 'assert/scene/1/1/canvas/trim-node/output.flac';

beforeEach(() => {
  vi.clearAllMocks();
  mockPathExists.mockResolvedValue(true);
  mockGetAudioInfo.mockResolvedValue(INFO);
});

describe('resolveAudioTrimWindow', () => {
  it('按秒解析小数起点与时长', () => {
    expect(resolveAudioTrimWindow({ startTime: 1.25, duration: 0.8 }, INFO)).toEqual({ start: 1.25, duration: 0.8 });
  });

  it('超过片尾时只保留剩余时长', () => {
    expect(resolveAudioTrimWindow({ startTime: 3.5, duration: 2 }, INFO)).toEqual({ start: 3.5, duration: 0.5 });
  });

  it('拒绝负起点、零/负时长与起点越界', () => {
    expect(() => resolveAudioTrimWindow({ startTime: -0.1, duration: 1 }, INFO)).toThrowError(
      expect.objectContaining({ code: 'INVALID' }),
    );
    expect(() => resolveAudioTrimWindow({ startTime: 0, duration: 0 }, INFO)).toThrowError(
      expect.objectContaining({ code: 'INVALID' }),
    );
    expect(() => resolveAudioTrimWindow({ startTime: 4, duration: 1 }, INFO)).toThrowError(
      expect.objectContaining({ code: 'INVALID', message: expect.stringContaining('越界') }),
    );
  });
});

describe('trimAudio', () => {
  it('以 -ss/-t 精确裁剪并输出 FLAC 音频', async () => {
    const { chain, state } = mockRun();
    mockFfmpeg.mockReturnValue(chain);

    const result = await trimAudio('p', 'assert/source.wav', { startTime: 1.25, duration: 0.8 }, OUTPUT);

    expect(result).toEqual({ path: OUTPUT, duration: 0.8 });
    expect(mockFfmpeg).toHaveBeenCalledWith(expect.stringContaining('source.wav'));
    expect(state.outputs[state.outputs.indexOf('-ss') + 1]).toBe('1.25');
    expect(state.outputs[state.outputs.indexOf('-t') + 1]).toBe('0.8');
    expect(state.outputs).toContain('-map');
    expect(state.outputs).toContain('0:a:0');
    expect(state.outputs).toContain('-vn');
    expect(state.outputs).toContain('flac');
    expect(state.outputs).not.toContain('copy');
    expect(state.saved).toMatch(/output\.flac$/);
  });

  it('输入音频不存在时抛 NOT_FOUND，且不执行 ffmpeg', async () => {
    mockPathExists.mockResolvedValueOnce(false);
    await expect(
      trimAudio('p', 'assert/missing.wav', { startTime: 0, duration: 1 }, OUTPUT),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockFfmpeg).not.toHaveBeenCalled();
  });

  it('输入输出相同时拒绝覆盖源文件', async () => {
    await expect(
      trimAudio('p', 'assert/scene/1/1/canvas/trim-node/output.flac', { startTime: 0, duration: 1 }, OUTPUT),
    ).rejects.toMatchObject({ code: 'INVALID' });
    expect(mockFfmpeg).not.toHaveBeenCalled();
  });

  it('输出不是画布节点固定 output.flac 时拒绝执行', async () => {
    await expect(
      trimAudio('p', 'assert/source.wav', { startTime: 0, duration: 1 }, 'assert/custom/out.flac'),
    ).rejects.toMatchObject({ code: 'INVALID' });
    expect(mockFfmpeg).not.toHaveBeenCalled();
  });

  it('超出片尾的裁剪窗口被截短并返回实际时长', async () => {
    const { chain, state } = mockRun();
    mockFfmpeg.mockReturnValue(chain);
    mockGetAudioInfo.mockResolvedValue({ duration: 4 });

    const result = await trimAudio('p', 'assert/source.wav', { startTime: 3.5, duration: 5 }, OUTPUT);

    expect(result).toEqual({ path: OUTPUT, duration: 0.5 });
    expect(state.outputs[state.outputs.indexOf('-t') + 1]).toBe('0.5');
  });

  it('ffmpeg 执行失败抛 INVALID', async () => {
    const { chain, state } = mockRun();
    state.failOnSave = true;
    mockFfmpeg.mockReturnValue(chain);

    await expect(
      trimAudio('p', 'assert/source.wav', { startTime: 0, duration: 1 }, OUTPUT),
    ).rejects.toMatchObject({ code: 'INVALID', message: expect.stringContaining('音频裁剪失败') });
  });
});