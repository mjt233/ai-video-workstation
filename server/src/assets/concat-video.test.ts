import { describe, expect, it, vi, beforeEach } from 'vitest';

// 模块级 mock：fluent-ffmpeg（默认导出可链式调用）、paths.js 的 pathExists、extract-frame 的视频/音频探测
const {
  mockFfmpeg,
  mockPathExists,
  mockGetVideoInfo,
  mockGetAudioInfo,
  mockMkdir,
  mockWriteFileSync,
  mockUnlink,
} = vi.hoisted(() => ({
  mockFfmpeg: vi.fn(),
  mockPathExists: vi.fn(),
  mockGetVideoInfo: vi.fn(),
  mockGetAudioInfo: vi.fn(),
  mockMkdir: vi.fn(async () => undefined),
  mockWriteFileSync: vi.fn(),
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
  default: { mkdir: mockMkdir, unlink: mockUnlink },
  mkdir: mockMkdir,
  unlink: mockUnlink,
}));

// fs（同步）：copy 模式的临时 concat 列表文件用 writeFileSync 同步写入（命令构建阶段）
vi.mock('fs', () => ({
  default: { writeFileSync: mockWriteFileSync },
  writeFileSync: mockWriteFileSync,
}));

import {
  assertConcatCompatible,
  buildConcatCommand,
  buildReencodeArgs,
  concatVideos,
  ConcatError,
  normalizeConcatParams,
  resolveOutputFps,
  resolveOutputSize,
  toEven,
} from './concat-video.js';

/** 构造可链式调用、可触发 end/error 的 ffmpeg 假对象，并记录输入/输出选项与保存路径 */
function mockRun() {
  const state: {
    inputs: string[];
    inputOptions: string[];
    outputs: string[];
    filterComplex: string;
    saved: string;
    /** end/error 监听器列表（真实 EventEmitter 语义：多个监听器都要触发） */
    endHandlers: Array<() => void>;
    errHandlers: Array<(e: Error) => void>;
    failOnSave?: boolean;
  } = {
    inputs: [],
    inputOptions: [],
    outputs: [],
    filterComplex: '',
    saved: '',
    endHandlers: [],
    errHandlers: [],
    failOnSave: false,
  };
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
    complexFilter: (f: string) => {
      state.filterComplex = f;
      return chain;
    },
    on: (event: string, cb: (e?: Error) => void) => {
      if (event === 'end') state.endHandlers.push(cb as () => void);
      else if (event === 'error') state.errHandlers.push(cb as (e: Error) => void);
      return chain;
    },
    save: (out: string) => {
      state.saved = out;
      if (state.failOnSave) {
        for (const cb of [...state.errHandlers]) cb(new Error('ffmpeg 执行失败'));
      } else {
        for (const cb of [...state.endHandlers]) cb();
      }
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
  const base = { codec: 'h264', width: 1280, height: 720, fps: 25, hasAudio: true, duration: 4 };

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

    const result = await concatVideos('p', ['assert/v1.mp4', 'assert/v2.mp4'], 'assert/out.mp4', { mode: 'copy' });

    expect(result).toBe('assert/out.mp4');
    // 列表文件写入（UTF-8，含两个 file 行，正斜杠）
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [listPath, listBody, opts] = mockWriteFileSync.mock.calls[0] as unknown as [string, string, { encoding: string }];
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

  it('规格不一致（copy）抛 INVALID 并提示改用重编码，且不执行 ffmpeg', async () => {
    const { chain } = mockRun();
    mockFfmpeg.mockReturnValue(chain);
    mockGetVideoInfo
      .mockResolvedValueOnce({ duration: 4, fps: 25, width: 1280, height: 720, codec: 'h264' })
      .mockResolvedValueOnce({ duration: 4, fps: 25, width: 1920, height: 1080, codec: 'h264' });
    mockGetAudioInfo.mockResolvedValue({ duration: 4 });

    const err = await concatVideos('p', ['assert/v1.mp4', 'assert/v2.mp4'], 'assert/out.mp4', { mode: 'copy' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConcatError);
    expect(err).toMatchObject({
      code: 'INVALID',
      message: expect.stringContaining('分辨率'),
    });
    expect((err as Error).message).toContain('重编码');
    expect(mockFfmpeg).not.toHaveBeenCalled();
  });

  it('ffmpeg 执行失败抛 INVALID 并仍清理列表文件', async () => {
    const { chain, state } = mockRun();
    state.failOnSave = true;
    mockFfmpeg.mockReturnValue(chain);
    mockCompatibleSegments();

    await expect(
      concatVideos('p', ['assert/v1.mp4', 'assert/v2.mp4'], 'assert/out.mp4', { mode: 'copy' }),
    ).rejects.toMatchObject({
      code: 'INVALID',
      message: expect.stringContaining('拼接失败'),
    });
    const [listPath] = mockWriteFileSync.mock.calls[0] as unknown as [string];
    expect(mockUnlink).toHaveBeenCalledWith(listPath);
  });
});

describe('normalizeConcatParams', () => {
  it('缺省为 reencode + max + 关闭自然过渡（过渡时长缺省 0.5）', () => {
    expect(normalizeConcatParams()).toEqual({
      mode: 'reencode',
      sizeMode: 'max',
      transition: false,
      crossfadeDuration: 0.5,
    });
  });

  it('非法枚举回退缺省，custom 保留宽高', () => {
    // 运行时容错：非法枚举值（如前端旧数据/手工构造）回退缺省 max
    expect(normalizeConcatParams({ mode: 'copy', sizeMode: 'weird' as unknown as 'max' })).toEqual({
      mode: 'copy',
      sizeMode: 'max',
      transition: false,
      crossfadeDuration: 0.5,
    });
    expect(normalizeConcatParams({ sizeMode: 'custom', width: 1920, height: 1080 })).toEqual({
      mode: 'reencode',
      sizeMode: 'custom',
      width: 1920,
      height: 1080,
      transition: false,
      crossfadeDuration: 0.5,
    });
  });

  it('copy 模式忽略自然过渡开关（xfade 需重编码）', () => {
    expect(normalizeConcatParams({ mode: 'copy', transition: true, crossfadeDuration: 1 })).toEqual({
      mode: 'copy',
      sizeMode: 'max',
      transition: false,
      crossfadeDuration: 1,
    });
  });

  it('reencode 开启自然过渡并规整过渡时长到 0.1~5 秒，非法值回退 0.5', () => {
    expect(normalizeConcatParams({ transition: true, crossfadeDuration: 1.24 })).toMatchObject({
      transition: true,
      crossfadeDuration: 1.24,
    });
    // 超过 5 秒 / 非正数 / 非法类型均被夹回合法区间或回退缺省
    expect(normalizeConcatParams({ transition: true, crossfadeDuration: 8 })).toMatchObject({
      transition: true,
      crossfadeDuration: 5,
    });
    expect(normalizeConcatParams({ transition: true, crossfadeDuration: -1 })).toMatchObject({
      transition: true,
      crossfadeDuration: 0.1,
    });
    expect(normalizeConcatParams({ transition: true, crossfadeDuration: 'abc' as unknown as number })).toMatchObject({
      transition: true,
      crossfadeDuration: 0.5,
    });
    // 未开启过渡时不要求时长合法（前端可能只带 switch 状态）
    expect(normalizeConcatParams({ transition: false, crossfadeDuration: 8 }).crossfadeDuration).toBe(5);
  });
});

describe('toEven', () => {
  it('奇数向上取偶、最小 2', () => {
    expect(toEven(1920)).toBe(1920);
    expect(toEven(1921)).toBe(1922);
    expect(toEven(1)).toBe(2);
    expect(toEven(1.4)).toBe(2);
  });
});

describe('resolveOutputSize', () => {
  const seg = (width: number, height: number): { codec: string; width: number; height: number; fps: number; hasAudio: boolean; duration: number } => ({
    codec: 'h264',
    width,
    height,
    fps: 25,
    hasAudio: true,
    duration: 4,
  });

  it('max：按像素面积取最大那一段的完整宽高', () => {
    const specs = [seg(1280, 720), seg(1920, 1080), seg(640, 480)];
    expect(resolveOutputSize(specs, normalizeConcatParams({ sizeMode: 'max' }))).toEqual({ width: 1920, height: 1080 });
  });

  it('min：按像素面积取最小那一段的完整宽高', () => {
    const specs = [seg(1280, 720), seg(1920, 1080), seg(640, 480)];
    expect(resolveOutputSize(specs, normalizeConcatParams({ sizeMode: 'min' }))).toEqual({ width: 640, height: 480 });
  });

  it('竖屏素材不产生奇怪尺寸（整段宽高，而非宽高分别取极值）', () => {
    const specs = [seg(1920, 1080), seg(1080, 1920)];
    expect(resolveOutputSize(specs, normalizeConcatParams({ sizeMode: 'max' }))).toEqual({ width: 1920, height: 1080 });
  });

  it('custom：使用用户宽高并规整为偶数', () => {
    const specs = [seg(1280, 720)];
    expect(resolveOutputSize(specs, normalizeConcatParams({ sizeMode: 'custom', width: 1921, height: 1081 }))).toEqual({
      width: 1922,
      height: 1082,
    });
  });

  it('custom 缺宽高或非法抛 INVALID', () => {
    const specs = [seg(1280, 720)];
    expect(() => resolveOutputSize(specs, normalizeConcatParams({ sizeMode: 'custom' }))).toThrowError(
      expect.objectContaining({ code: 'INVALID' }),
    );
    expect(() =>
      resolveOutputSize(specs, normalizeConcatParams({ sizeMode: 'custom', width: 0, height: 1080 })),
    ).toThrowError(expect.objectContaining({ code: 'INVALID' }));
  });
});

describe('resolveOutputFps', () => {
  it('取各段最高帧率；全部不可用时回退 30', () => {
    const specs = [
      { codec: 'h264', width: 1280, height: 720, fps: 24, hasAudio: true, duration: 4 },
      { codec: 'h264', width: 1280, height: 720, fps: 30, hasAudio: true, duration: 4 },
    ];
    expect(resolveOutputFps(specs)).toBe(30);
    expect(resolveOutputFps([{ ...specs[0], fps: 0 }])).toBe(30);
  });
});

describe('buildReencodeArgs', () => {
  const seg = (
    width: number,
    height: number,
    fps: number,
    hasAudio: boolean,
    duration = 4,
  ): { codec: string; width: number; height: number; fps: number; hasAudio: boolean; duration: number } => ({
    codec: 'h264',
    width,
    height,
    fps,
    hasAudio,
    duration,
  });

  it('等比缩放 + 居中黑边 + 统一帧率 + setsar=1', () => {
    const specs = [seg(1280, 720, 25, true), seg(640, 480, 30, true)];
    const args = buildReencodeArgs(specs, normalizeConcatParams({ sizeMode: 'max' }));
    expect(args.width).toBe(1280);
    expect(args.height).toBe(720);
    expect(args.fps).toBe(30);
    expect(args.filterComplex).toContain('scale=1280:720:force_original_aspect_ratio=decrease');
    expect(args.filterComplex).toContain('pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black');
    expect(args.filterComplex).toContain('setsar=1');
    expect(args.filterComplex).toContain('fps=30');
    expect(args.filterComplex).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]');
    expect(args.outputOptions).toEqual(
      expect.arrayContaining(['-map', '[vout]', '[aout]', '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac']),
    );
    expect(args.extraInputs).toHaveLength(0);
    expect(args.withAudio).toBe(true);
  });

  it('无音轨段用 anullsrc 补齐静音轨（lavfi 输入 + 该段时长）', () => {
    const specs = [seg(1280, 720, 25, true, 5), seg(1280, 720, 25, false, 3)];
    const args = buildReencodeArgs(specs, normalizeConcatParams({ sizeMode: 'max' }));
    expect(args.withAudio).toBe(true);
    expect(args.extraInputs).toHaveLength(1);
    expect(args.extraInputs[0]).toEqual([
      '-f',
      'lavfi',
      '-t',
      '3',
      '-i',
      'anullsrc=r=48000:cl=stereo',
    ]);
    // 静音源输入下标 = 段数（2）+ 已追加的静音源数（0）
    expect(args.filterComplex).toContain('[2:a]aformat=channel_layouts=stereo[a1]');
  });

  it('全部无音轨时只拼视频流并 -an', () => {
    const specs = [seg(1280, 720, 25, false), seg(1280, 720, 25, false)];
    const args = buildReencodeArgs(specs, normalizeConcatParams({ sizeMode: 'max' }));
    expect(args.withAudio).toBe(false);
    expect(args.extraInputs).toHaveLength(0);
    expect(args.filterComplex).toContain('[v0][v1]concat=n=2:v=1:a=0[vout]');
    expect(args.outputOptions).toContain('-an');
    expect(args.outputOptions).not.toContain('-c:a');
  });

  it('开启自然过渡：视频 xfade + 音频 acrossfade 链替代 concat（offset 递增）', () => {
    const specs = [
      seg(1280, 720, 25, true, 3),
      seg(1280, 720, 25, true, 4),
      seg(1280, 720, 25, true, 5),
    ];
    const args = buildReencodeArgs(specs, normalizeConcatParams({ transition: true, crossfadeDuration: 0.5 }));
    // 第 1 次过渡 offset = 3 − 0.5 = 2.5；中间段标签 [xf1]
    expect(args.filterComplex).toContain('[v0][v1]xfade=transition=fade:duration=0.5:offset=2.5[xf1]');
    // 第 2 次过渡 offset = 3 + 4 − 2×0.5 = 6；末段直接输出 [vout]
    expect(args.filterComplex).toContain('[xf1][v2]xfade=transition=fade:duration=0.5:offset=6[vout]');
    // 音频 acrossfade 链（末段输出 [aout]）
    expect(args.filterComplex).toContain('[a0][a1]acrossfade=d=0.5:c1=tri[af1]');
    expect(args.filterComplex).toContain('[af1][a2]acrossfade=d=0.5:c1=tri[aout]');
    // 不再有 concat 滤镜
    expect(args.filterComplex).not.toContain('concat=');
    expect(args.outputOptions).toEqual(
      expect.arrayContaining(['-map', '[vout]', '[aout]', '-c:v', 'libx264', '-c:a', 'aac']),
    );
  });

  it('开启自然过渡 + 全部无音轨：仅视频 xfade 链并 -an', () => {
    const specs = [seg(1280, 720, 25, false, 3), seg(1280, 720, 25, false, 4)];
    const args = buildReencodeArgs(specs, normalizeConcatParams({ transition: true, crossfadeDuration: 1 }));
    expect(args.withAudio).toBe(false);
    expect(args.filterComplex).toContain('[v0][v1]xfade=transition=fade:duration=1:offset=2[vout]');
    expect(args.filterComplex).not.toContain('acrossfade');
    expect(args.outputOptions).toContain('-an');
  });

  it('开启自然过渡但某段时长不足过渡时长抛 INVALID 并提示', () => {
    const specs = [seg(1280, 720, 25, true, 3), seg(1280, 720, 25, true, 0.4)];
    expect(() => buildReencodeArgs(specs, normalizeConcatParams({ transition: true, crossfadeDuration: 0.5 }))).toThrowError(
      expect.objectContaining({
        code: 'INVALID',
        message: expect.stringContaining('第 2 段时长（0.4 秒）需大于交叉过渡时长（0.5 秒）'),
      }),
    );
  });
});

describe('concatVideos（重编码）', () => {
  it('异构规格可拼接：走 filter_complex 且不写 concat 列表文件', async () => {
    const { chain, state } = mockRun();
    mockFfmpeg.mockReturnValue(chain);
    mockGetVideoInfo
      .mockResolvedValueOnce({ duration: 4, fps: 25, width: 1280, height: 720, codec: 'h264' })
      .mockResolvedValueOnce({ duration: 4, fps: 30, width: 640, height: 480, codec: 'hevc' });
    mockGetAudioInfo.mockResolvedValue({ duration: 4 });

    await concatVideos('p', ['assert/v1.mp4', 'assert/v2.mp4'], 'assert/out.mp4', { mode: 'reencode' });

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(state.inputs).toHaveLength(2);
    expect(state.filterComplex).toContain('concat=n=2');
    expect(state.saved).toMatch(/out\.mp4$/);
  });

  it('buildConcatCommand 返回命令与总时长（供统一任务执行器使用）', async () => {
    mockGetVideoInfo
      .mockResolvedValueOnce({ duration: 4, fps: 25, width: 1280, height: 720, codec: 'h264' })
      .mockResolvedValueOnce({ duration: 6, fps: 25, width: 1280, height: 720, codec: 'h264' });
    mockGetAudioInfo.mockResolvedValue({ duration: 4 });

    const spec = await buildConcatCommand('p', ['assert/v1.mp4', 'assert/v2.mp4'], 'assert/out.mp4', {
      mode: 'reencode',
      sizeMode: 'min',
    });
    expect(spec.duration).toBe(10);
    expect(spec.info).toMatchObject({ mode: 'reencode', sizeMode: 'min', width: 1280, height: 720 });
    expect(spec.outputAbs).toMatch(/out\.mp4$/);
  });

  it('开启自然过渡时总时长 = 各段时长之和 − 过渡时长×(段数−1)，info 携带过渡信息', async () => {
    mockGetVideoInfo
      .mockResolvedValueOnce({ duration: 4, fps: 25, width: 1280, height: 720, codec: 'h264' })
      .mockResolvedValueOnce({ duration: 6, fps: 25, width: 1280, height: 720, codec: 'h264' })
      .mockResolvedValueOnce({ duration: 6, fps: 25, width: 1280, height: 720, codec: 'h264' });
    mockGetAudioInfo.mockResolvedValue({ duration: 4 });

    const spec = await buildConcatCommand('p', ['assert/v1.mp4', 'assert/v2.mp4', 'assert/v3.mp4'], 'assert/out.mp4', {
      mode: 'reencode',
      transition: true,
      crossfadeDuration: 1.5,
    });
    // 4 + 6 + 6 − 1.5×2 = 13
    expect(spec.duration).toBe(13);
    expect(spec.info).toMatchObject({ transition: true, crossfadeDuration: 1.5 });
  });
});
