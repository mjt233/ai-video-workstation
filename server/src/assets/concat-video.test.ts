import { describe, expect, it, vi, beforeEach } from 'vitest';

// 模块级 mock：fluent-ffmpeg（默认导出可链式调用）、paths.js 的 pathExists、extract-frame 的视频/音频探测
const { mockFfmpeg, mockPathExists, mockGetVideoInfo, mockGetAudioInfo, mockMkdir, mockWriteFile, mockUnlink } =
  vi.hoisted(() => ({
    mockFfmpeg: vi.fn(),
    mockPathExists: vi.fn(),
    mockGetVideoInfo: vi.fn(),
    mockGetAudioInfo: vi.fn(),
    mockMkdir: vi.fn(async () => undefined),
    mockWriteFile: vi.fn(async () => undefined),
    mockUnlink: vi.fn(async () => undefined),
  }));

vi.mock('fluent-ffmpeg', () => {
  const ffmpegFn = (...args: unknown[]) => mockFfmpeg(...args);
  return { default: ffmpegFn };
});

vi.mock('./paths.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./paths.js')>();
  return { ...mod, pathExists: mockPathExists };
});

// extract-frame 探测：拼接模块只依赖 getVideoInfo/getAudioInfo，直接 mock 隔离
vi.mock('./extract-frame.js', () => ({
  getVideoInfo: mockGetVideoInfo,
  getAudioInfo: mockGetAudioInfo,
}));

// fs/promises：显式提供 default（concat-video.ts 用 `import fs from 'fs/promises'`），
// 避免 importOriginal 展开后 default 指向真实模块导致写盘/建目录
vi.mock('fs/promises', () => ({
  default: { mkdir: mockMkdir, writeFile: mockWriteFile, unlink: mockUnlink },
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  unlink: mockUnlink,
}));

import { assertConcatCompatible, concatVideos, ConcatError } from './concat-video.js';

/** 构造可链式调用、可触发 end/error 的 ffmpeg 假对象，并记录输入/输出选项与保存路径 */
function mockRun() {
  const state: {
    inputs: string[];
    inputOptions: string[];
    outputs: string[];
    saved: string;
    end?: () => void;
    err?: (e: Error) => void;
    failOnSave?: boolean;
  } = { inputs: [], inputOptions: [], outputs: [], saved: '', failOnSave: false };
  const chain = {
    input: (p: string) => {
      state.inputs.push(p);
      return chain;
    },
    inputOptions: (o: string[]) => {
      state.inputOptions = o;
      return chain;
    },
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

/** 默认探测：两段同规格（h264 / 1280x720 / 25fps / 含音轨） */
function mockCompatibleSegments() {
  mockGetVideoInfo.mockResolvedValue({ duration: 4, fps: 25, width: 1280, height: 720, codec: 'h264' });
  mockGetAudioInfo.mockResolvedValue({ duration: 4 });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPathExists.mockResolvedValue(true);
});

describe('assertConcatCompatible', () => {
  const base = { codec: 'h264', width: 1280, height: 720, fps: 25, hasAudio: true };

  it('各段规格一致时不抛错', () => {
    expect(() => assertConcatCompatible([base, { ...base }, { ...base }])).not.toThrow();
  });

  it('分辨率不一致抛 INVALID 并列出不一致项', () => {
    expect(() => assertConcatCompatible([base, { ...base, width: 1920, height: 1080 }])).toThrowError(
      expect.objectContaining({ code: 'INVALID', message: expect.stringContaining('分辨率') }),
    );
  });

  it('帧率不一致抛 INVALID', () => {
    expect(() => assertConcatCompatible([base, { ...base, fps: 30 }])).toThrowError(
      expect.objectContaining({ code: 'INVALID' }),
    );
  });

  it('音轨结构不一致抛 INVALID', () => {
    expect(() => assertConcatCompatible([base, { ...base, hasAudio: false }])).toThrowError(
      expect.objectContaining({ code: 'INVALID', message: expect.stringContaining('音轨结构') }),
    );
  });
});

describe('concatVideos', () => {
  it('成功拼接：写入列表文件、ffmpeg 以 concat demuxer + -c copy 输出、清理临时文件', async () => {
    const { chain, state } = mockRun();
    mockFfmpeg.mockReturnValue(chain);
    mockCompatibleSegments();

    const result = await concatVideos('p', ['assert/v1.mp4', 'assert/v2.mp4'], 'assert/out.mp4');

    expect(result).toBe('assert/out.mp4');
    // 列表文件写入（UTF-8，含两个 file 行，正斜杠）
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [listPath, listBody, opts] = mockWriteFile.mock.calls[0] as unknown as [string, string, { encoding: string }];
    expect(opts.encoding).toBe('utf8');
    expect(listBody).toContain("file '");
    expect(listBody.match(/^file '/gm)?.length).toBe(2);
    // ffmpeg 调用：输入为列表文件，concat 参数 + 无损拷贝
    expect(state.inputs).toHaveLength(1);
    expect(state.inputs[0]).toBe(listPath);
    expect(state.inputOptions).toContain('-f');
    expect(state.inputOptions).toContain('concat');
    expect(state.inputOptions).toContain('-safe');
    expect(state.outputs).toContain('-c');
    expect(state.outputs).toContain('copy');
    expect(state.saved).toMatch(/out\.mp4$/);
    // 临时列表文件已清理
    expect(mockUnlink).toHaveBeenCalledWith(listPath);
  });

  it('少于两段视频抛 INVALID', async () => {
    await expect(concatVideos('p', ['assert/v1.mp4'], 'assert/out.mp4')).rejects.toMatchObject({
      code: 'INVALID',
    });
    expect(mockFfmpeg).not.toHaveBeenCalled();
  });

  it('输入视频缺失抛 NOT_FOUND', async () => {
    mockPathExists.mockResolvedValueOnce(false);
    await expect(concatVideos('p', ['assert/missing.mp4', 'assert/v2.mp4'], 'assert/out.mp4')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mockFfmpeg).not.toHaveBeenCalled();
  });

  it('规格不一致抛 INVALID，且不执行 ffmpeg', async () => {
    const { chain } = mockRun();
    mockFfmpeg.mockReturnValue(chain);
    mockGetVideoInfo
      .mockResolvedValueOnce({ duration: 4, fps: 25, width: 1280, height: 720, codec: 'h264' })
      .mockResolvedValueOnce({ duration: 4, fps: 25, width: 1920, height: 1080, codec: 'h264' });
    mockGetAudioInfo.mockResolvedValue({ duration: 4 });

    const err = await concatVideos('p', ['assert/v1.mp4', 'assert/v2.mp4'], 'assert/out.mp4').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConcatError);
    expect(err).toMatchObject({
      code: 'INVALID',
      message: expect.stringContaining('分辨率'),
    });
    expect(mockFfmpeg).not.toHaveBeenCalled();
  });

  it('ffmpeg 执行失败抛 INVALID 并仍清理列表文件', async () => {
    const { chain, state } = mockRun();
    state.failOnSave = true;
    mockFfmpeg.mockReturnValue(chain);
    mockCompatibleSegments();

    await expect(concatVideos('p', ['assert/v1.mp4', 'assert/v2.mp4'], 'assert/out.mp4')).rejects.toMatchObject({
      code: 'INVALID',
      message: expect.stringContaining('拼接失败'),
    });
    const [listPath] = mockWriteFile.mock.calls[0] as unknown as [string];
    expect(mockUnlink).toHaveBeenCalledWith(listPath);
  });
});
