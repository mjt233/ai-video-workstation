import { describe, expect, it, vi, beforeEach } from 'vitest';

// 模块级 mock：fluent-ffmpeg（默认导出可链式调用 + ffprobe 属性）
const { mockFfmpeg, mockFfprobe, mockPathExists } = vi.hoisted(() => ({
  mockFfmpeg: vi.fn(),
  mockFfprobe: vi.fn(),
  mockPathExists: vi.fn(),
}));

vi.mock('fluent-ffmpeg', () => {
  const ffmpegFn = (...args: unknown[]) => mockFfmpeg(...args);
  ffmpegFn.ffprobe = mockFfprobe;
  return { default: ffmpegFn };
});

// paths.js：保留真实 resolveProjectPath，pathExists 交给 mock（默认 true，可按用例覆盖）
vi.mock('./paths.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./paths.js')>();
  return { ...mod, pathExists: mockPathExists };
});

// fs/promises：mkdir 置空避免测试写盘
vi.mock('fs/promises', async (importOriginal) => {
  const mod = await importOriginal<typeof import('fs/promises')>();
  return { ...mod, mkdir: vi.fn(async () => undefined) };
});

import {
  FrameIndexError,
  extractVideoFrame,
  extractVideoFrameAtTime,
  getTotalFrames,
  getVideoInfo,
  parseFps,
  readVideoInfo,
  resolveFrameNumber,
} from './extract-frame.js';

/** 构造可链式调用、可触发 end/error 的 ffmpeg 假对象，并记录输出选项与保存路径 */
function mockRun() {
  const state: {
    vf: string;
    saved: string;
    outputs: string[];
    end?: () => void;
    err?: (e: Error) => void;
    failOnSave?: boolean;
  } = { vf: '', saved: '', outputs: [] };
  const chain = {
    outputOptions: (opts: string[]) => {
      state.outputs = opts;
      state.vf = opts[opts.indexOf('-vf') + 1] ?? '';
      return chain;
    },
    on: (event: string, cb: () => void) => {
      if (event === 'end') state.end = cb;
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

beforeEach(() => {
  vi.clearAllMocks();
  mockPathExists.mockResolvedValue(true);
  mockFfprobe.mockImplementation((_p: string, cb: (err: Error | null, data: unknown) => void) => {
    cb(null, { streams: [{ codec_type: 'video', nb_frames: '120' }], format: { duration: 4 } });
  });
});

describe('resolveFrameNumber', () => {
  it('非负索引直接作为帧序号（0=首帧、1=第二帧）', () => {
    expect(resolveFrameNumber(0, 100)).toBe(0);
    expect(resolveFrameNumber(1, 100)).toBe(1);
    expect(resolveFrameNumber(99, 100)).toBe(99);
  });

  it('负索引按 总帧数+索引 换算（-1=尾帧、-2=倒数第二帧）', () => {
    expect(resolveFrameNumber(-1, 100)).toBe(99);
    expect(resolveFrameNumber(-2, 100)).toBe(98);
    expect(resolveFrameNumber(-100, 100)).toBe(0);
  });

  it('越界抛 FrameIndexError', () => {
    expect(() => resolveFrameNumber(100, 100)).toThrow(FrameIndexError);
    expect(() => resolveFrameNumber(-101, 100)).toThrow(FrameIndexError);
  });

  it('总帧数不可用（0/NaN）抛 FrameIndexError', () => {
    expect(() => resolveFrameNumber(0, 0)).toThrow(FrameIndexError);
    expect(() => resolveFrameNumber(0, Number.NaN)).toThrow(FrameIndexError);
  });
});

describe('parseFps', () => {
  it('解析分数形式（如 24000/1001、25/1）', () => {
    expect(parseFps('24000/1001')).toBeCloseTo(23.976);
    expect(parseFps('25/1')).toBe(25);
  });

  it('数字直接返回；无法解析返回 0', () => {
    expect(parseFps(30)).toBe(30);
    expect(parseFps('abc')).toBe(0);
    expect(parseFps(undefined)).toBe(0);
  });
});

describe('getTotalFrames', () => {
  it('优先读视频流 nb_frames', async () => {
    mockFfprobe.mockImplementation((_p: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(null, { streams: [{ codec_type: 'video', nb_frames: '250' }] });
    });
    await expect(getTotalFrames('/x.mp4')).resolves.toBe(250);
  });

  it('无 nb_frames 时按 时长 × 帧率 估算', async () => {
    mockFfprobe.mockImplementation((_p: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(null, { streams: [{ codec_type: 'video', avg_frame_rate: '24000/1001' }], format: { duration: 4.17 } });
    });
    await expect(getTotalFrames('/x.mp4')).resolves.toBe(100);
  });

  it('ffprobe 失败或无法推导帧数时 reject', async () => {
    mockFfprobe.mockImplementation((_p: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(new Error('probe 失败'), undefined);
    });
    await expect(getTotalFrames('/x.mp4')).rejects.toThrow();
  });
});

describe('getVideoInfo', () => {
  it('解析时长、帧率与分辨率（avg_frame_rate 分数形式）', async () => {
    mockFfprobe.mockImplementation((_p: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(null, {
        streams: [{ codec_type: 'video', avg_frame_rate: '24000/1001', width: 1280, height: 720 }],
        format: { duration: 4.17 },
      });
    });
    const info = await getVideoInfo('/x.mp4');
    expect(info.duration).toBeCloseTo(4.17);
    expect(info.fps).toBeCloseTo(23.976);
    expect(info.width).toBe(1280);
    expect(info.height).toBe(720);
  });

  it('未找到视频流时 reject', async () => {
    mockFfprobe.mockImplementation((_p: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(null, { streams: [] });
    });
    await expect(getVideoInfo('/x.mp4')).rejects.toThrow('未找到视频流');
  });

  it('ffprobe 失败时 reject', async () => {
    mockFfprobe.mockImplementation((_p: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(new Error('probe 失败'), undefined);
    });
    await expect(getVideoInfo('/x.mp4')).rejects.toThrow('probe 失败');
  });
});

describe('readVideoInfo', () => {
  it('视频不存在时抛 NOT_FOUND', async () => {
    mockPathExists.mockResolvedValueOnce(false);
    await expect(readVideoInfo('p', 'assert/video/missing.mp4')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('存在时返回视频信息', async () => {
    mockFfprobe.mockImplementation((_p: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(null, {
        streams: [{ codec_type: 'video', avg_frame_rate: '25/1', width: 1920, height: 1080 }],
        format: { duration: 8 },
      });
    });
    const info = await readVideoInfo('p', 'assert/video/a.mp4');
    expect(info.fps).toBe(25);
    expect(info.duration).toBe(8);
  });
});

describe('extractVideoFrameAtTime', () => {
  it('按时间点提取：输出端 -ss {time} 并保存', async () => {
    const { chain, state } = mockRun();
    mockFfmpeg.mockReturnValue(chain);
    mockFfprobe.mockImplementation((_p: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(null, { streams: [{ codec_type: 'video', avg_frame_rate: '25/1' }], format: { duration: 4 } });
    });
    const result = await extractVideoFrameAtTime('p', 'assert/video/a.mp4', 1.5, 'assert/frames/f.png');
    expect(result).toBe('assert/frames/f.png');
    expect(mockFfmpeg).toHaveBeenCalledWith(expect.stringContaining('a.mp4'));
    expect(state.outputs).toContain('-ss');
    expect(state.outputs[state.outputs.indexOf('-ss') + 1]).toBe('1.5');
    expect(state.saved).toMatch(/f\.png$/);
  });

  it('时间越界（超出时长 / 负数）抛 FrameIndexError（不执行 ffmpeg）', async () => {
    mockFfprobe.mockImplementation((_p: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(null, { streams: [{ codec_type: 'video' }], format: { duration: 4 } });
    });
    await expect(
      extractVideoFrameAtTime('p', 'assert/video/a.mp4', 4.5, 'assert/frames/f.png'),
    ).rejects.toBeInstanceOf(FrameIndexError);
    await expect(
      extractVideoFrameAtTime('p', 'assert/video/a.mp4', -0.1, 'assert/frames/f.png'),
    ).rejects.toBeInstanceOf(FrameIndexError);
    expect(mockFfmpeg).not.toHaveBeenCalled();
  });

  it('视频不存在时抛 NOT_FOUND', async () => {
    mockPathExists.mockResolvedValueOnce(false);
    await expect(
      extractVideoFrameAtTime('p', 'assert/video/missing.mp4', 0, 'assert/frames/f.png'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('时长探测失败时抛 FrameIndexError', async () => {
    mockFfprobe.mockImplementation((_p: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(new Error('probe 失败'), undefined);
    });
    await expect(
      extractVideoFrameAtTime('p', 'assert/video/a.mp4', 1, 'assert/frames/f.png'),
    ).rejects.toBeInstanceOf(FrameIndexError);
  });
});

describe('extractVideoFrame', () => {
  it('按 nb_frames 换算负索引并用 select 过滤器执行 ffmpeg，保存到输出路径', async () => {
    const { chain, state } = mockRun();
    mockFfmpeg.mockReturnValue(chain);
    const result = await extractVideoFrame('p', 'assert/video/a.mp4', -1, 'assert/frames/f.png');
    expect(result).toBe('assert/frames/f.png');
    expect(mockFfmpeg).toHaveBeenCalledWith(expect.stringContaining('a.mp4'));
    // -1 → 120 帧的最后一帧（119）
    expect(state.vf).toBe('select=eq(n\\,119)');
    expect(state.saved).toMatch(/f\.png$/);
  });

  it('正索引直接选帧（0=首帧）', async () => {
    const { chain, state } = mockRun();
    mockFfmpeg.mockReturnValue(chain);
    await extractVideoFrame('p', 'assert/video/a.mp4', 0, 'assert/frames/f.png');
    expect(state.vf).toBe('select=eq(n\\,0)');
  });

  it('视频不存在时抛 NOT_FOUND', async () => {
    mockPathExists.mockResolvedValueOnce(false);
    await expect(
      extractVideoFrame('p', 'assert/video/missing.mp4', 0, 'assert/frames/f.png'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('帧索引越界时抛 FrameIndexError（不执行 ffmpeg）', async () => {
    const { chain } = mockRun();
    mockFfmpeg.mockReturnValue(chain);
    await expect(
      extractVideoFrame('p', 'assert/video/a.mp4', 120, 'assert/frames/f.png'),
    ).rejects.toBeInstanceOf(FrameIndexError);
    expect(mockFfmpeg).not.toHaveBeenCalled();
  });

  it('ffmpeg 执行失败时 reject', async () => {
    const { chain, state } = mockRun();
    state.failOnSave = true;
    mockFfmpeg.mockReturnValue(chain);
    await expect(
      extractVideoFrame('p', 'assert/video/a.mp4', 0, 'assert/frames/f.png'),
    ).rejects.toThrow('ffmpeg 执行失败');
  });
});
