import { describe, expect, it, vi } from 'vitest';
import { getCandidatesByProvider, getImpl, registerOrReplace } from '../registry.js';
import type { ProviderClient } from '../../providers/types.js';
import type { VideoWorkflowSubmitData, WorkflowRunContext, WorkflowVarsBase } from '../types.js';
import {
  resolveMinimaxDuration,
  resolveMinimaxRatio,
} from './minimax-h3.js';
import './minimax-h3.js';

/**
 * 将 minimax-h3 静态候选定义提升为可执行定义（补 providerInstanceId），
 * 使 getImpl 能检索到（注册表语义：无实例 = 候选，不可执行）。
 */
function promoteStaticCandidates(): void {
  for (const w of getCandidatesByProvider('minimax-h3')) {
    registerOrReplace({ ...w, providerInstanceId: 'test-inst', providerName: '测试实例' });
  }
}
promoteStaticCandidates();

/** provider.execute 的函数类型（测试 mock 用） */
type ExecuteFn = ProviderClient['execute'];

/** 构建最小可用的运行上下文（video 为自包含视频提交数据，provider.execute 可注入 mock） */
function makeCtx(
  video: Partial<VideoWorkflowSubmitData>,
  execute?: ExecuteFn,
): WorkflowRunContext<WorkflowVarsBase> {
  return {
    project: 'p',
    projectConfig: { width: 1080, height: 1920 },
    vars: {},
    provider: { execute: execute ?? (async () => ({ taskId: 'remote-1' })) },
    video,
  } as unknown as WorkflowRunContext<WorkflowVarsBase>;
}

/** 取注册表中某个实现的 submit 函数 */
function getSubmit(impl: string) {
  const def = getImpl('image-to-video', impl);
  if (!def) throw new Error(`impl not registered: ${impl}`);
  return def.submit;
}

/** 取 execute mock 第 1 次调用的入参（params 断言为非空） */
function firstExecuteCall(execute: ExecuteFn): {
  workflowId: string;
  params: Record<string, unknown>;
  files: Record<string, File>;
} {
  const mock = execute as ReturnType<typeof vi.fn<ExecuteFn>>;
  const call = mock.mock.calls[0][0];
  return {
    workflowId: call.workflowId,
    params: (call.params ?? {}) as Record<string, unknown>,
    files: (call.files ?? {}) as Record<string, File>,
  };
}

describe('resolveMinimaxDuration', () => {
  it('4~15 的整数时长原样返回', () => {
    expect(resolveMinimaxDuration(4)).toBe(4);
    expect(resolveMinimaxDuration(15)).toBe(15);
    expect(resolveMinimaxDuration(10)).toBe(10);
  });

  it('小数时长四舍五入取整', () => {
    expect(resolveMinimaxDuration(5.4)).toBe(5);
    expect(resolveMinimaxDuration(5.5)).toBe(6);
  });

  it('超出 4~15 或非法值抛错', () => {
    expect(() => resolveMinimaxDuration(3)).toThrow('4~15');
    expect(() => resolveMinimaxDuration(16)).toThrow('4~15');
    expect(() => resolveMinimaxDuration(Number.NaN)).toThrow('时长无效');
  });
});

describe('resolveMinimaxRatio', () => {
  it('命中标准宽高比时返回对应 ratio', () => {
    expect(resolveMinimaxRatio(1920, 1080)).toBe('16:9');
    expect(resolveMinimaxRatio(1080, 1920)).toBe('9:16');
    expect(resolveMinimaxRatio(1024, 1024)).toBe('1:1');
    expect(resolveMinimaxRatio(1280, 720)).toBe('16:9');
  });

  it('非标准比例或无效尺寸返回 adaptive', () => {
    expect(resolveMinimaxRatio(1280, 800)).toBe('adaptive');
    expect(resolveMinimaxRatio(0, 0)).toBe('adaptive');
    expect(resolveMinimaxRatio(Number.NaN, 1080)).toBe('adaptive');
  });
});

describe('minimax-h3-i2v submit', () => {
  it('单帧 → first_frame 载荷（ratio 恒 adaptive）', async () => {
    const execute = vi.fn<ExecuteFn>(async () => ({ taskId: 'r1' }));
    const frame = new File(['a'], 'a.png', { type: 'image/png' });
    const ctx = makeCtx(
      {
        mode: 'first-last-frame',
        prompt: '镜头缓缓推进',
        duration: 5,
        resolution: { width: 1920, height: 1080 },
        director: { frames: [{ file: frame, cursor: 0 }] },
      },
      execute,
    );
    const { taskId } = await getSubmit('minimax-h3-i2v')(ctx);
    expect(taskId).toBe('r1');
    const call = firstExecuteCall(execute);
    expect(call.workflowId).toBe('MiniMax-H3');
    expect(call.params.duration).toBe(5);
    expect(call.params.ratio).toBe('adaptive');
    expect(call.params.content).toEqual([
      { type: 'text', text: '镜头缓缓推进' },
      { type: 'image_url', role: 'first_frame', fileKey: 'first_frame' },
    ]);
    expect(Object.keys(call.files)).toEqual(['first_frame']);
  });

  it('多帧（乱序 cursor）→ 首帧 + 尾帧，中间帧不参与', async () => {
    const execute = vi.fn<ExecuteFn>(async () => ({ taskId: 'r2' }));
    const f0 = new File(['0'], '0.png', { type: 'image/png' });
    const f1 = new File(['1'], '1.png', { type: 'image/png' });
    const f2 = new File(['2'], '2.png', { type: 'image/png' });
    const ctx = makeCtx(
      {
        mode: 'first-last-frame',
        prompt: '连续运动',
        duration: 8,
        resolution: { width: 1920, height: 1080 },
        director: {
          frames: [
            { file: f1, cursor: 0.5 },
            { file: f0, cursor: 0 },
            { file: f2, cursor: 1 },
          ],
        },
      },
      execute,
    );
    await getSubmit('minimax-h3-i2v')(ctx);
    const call = firstExecuteCall(execute);
    expect(call.params.content).toEqual([
      { type: 'text', text: '连续运动' },
      { type: 'image_url', role: 'first_frame', fileKey: 'first_frame' },
      { type: 'image_url', role: 'last_frame', fileKey: 'last_frame' },
    ]);
    expect(call.files.first_frame).toBe(f0);
    expect(call.files.last_frame).toBe(f2);
  });

  it('附带的音频被忽略（I2VA 不支持音频输入）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const execute = vi.fn<ExecuteFn>(async () => ({ taskId: 'r3' }));
    const frame = new File(['a'], 'a.png', { type: 'image/png' });
    const audio = new File(['au'], 'a.wav', { type: 'audio/wav' });
    const ctx = makeCtx(
      {
        mode: 'first-last-frame',
        prompt: 'x',
        duration: 5,
        resolution: { width: 1280, height: 720 },
        director: { frames: [{ file: frame, cursor: 0 }], audio },
      },
      execute,
    );
    await getSubmit('minimax-h3-i2v')(ctx);
    const call = firstExecuteCall(execute);
    expect(Object.keys(call.files)).toEqual(['first_frame']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('不支持音频输入'));
    warn.mockRestore();
  });

  it('无帧图片 / 空提示词 / 时长越界均抛错', async () => {
    const execute = vi.fn<ExecuteFn>(async () => ({ taskId: 'r4' }));
    const frame = new File(['a'], 'a.png', { type: 'image/png' });
    const base = {
      mode: 'first-last-frame' as const,
      prompt: 'x',
      duration: 5,
      resolution: { width: 1280, height: 720 },
    };
    await expect(
      getSubmit('minimax-h3-i2v')(makeCtx({ ...base, director: { frames: [] } }, execute)),
    ).rejects.toThrow('至少需要 1 帧图片');
    await expect(
      getSubmit('minimax-h3-i2v')(makeCtx({ ...base, prompt: '  ' }, execute)),
    ).rejects.toThrow('需要提示词');
    await expect(
      getSubmit('minimax-h3-i2v')(
        makeCtx({ ...base, duration: 20, director: { frames: [{ file: frame, cursor: 0 }] } }, execute),
      ),
    ).rejects.toThrow('4~15');
  });
});

describe('minimax-h3-r2v submit', () => {
  it('图片/视频/音频参考 → 对应 role 与文件键', async () => {
    const execute = vi.fn<ExecuteFn>(async () => ({ taskId: 'r5' }));
    const img1 = new File(['i'], 'i.png', { type: 'image/png' });
    const img2 = new File(['j'], 'j.png', { type: 'image/png' });
    const vid = new File(['v'], 'v.mp4', { type: 'video/mp4' });
    const aud = new File(['a'], 'a.mp3', { type: 'audio/mpeg' });
    const ctx = makeCtx(
      {
        mode: 'reference',
        prompt: '参考素材演绎',
        duration: 10,
        resolution: { width: 1920, height: 1080 },
        references: [
          { type: 'image', file: img1 },
          { type: 'video', file: vid },
          { type: 'image', file: img2 },
          { type: 'audio', file: aud },
        ],
      },
      execute,
    );
    const { taskId } = await getSubmit('minimax-h3-r2v')(ctx);
    expect(taskId).toBe('r5');
    const call = firstExecuteCall(execute);
    expect(call.params.content).toEqual([
      { type: 'text', text: '参考素材演绎' },
      { type: 'image_url', role: 'reference_image', fileKey: 'image_0' },
      { type: 'image_url', role: 'reference_image', fileKey: 'image_1' },
      { type: 'video_url', role: 'reference_video', fileKey: 'video_0' },
      { type: 'audio_url', role: 'reference_audio', fileKey: 'audio_0' },
    ]);
    expect(call.params.duration).toBe(10);
    expect(call.params.ratio).toBe('16:9');
    expect(call.files).toEqual({ image_0: img1, video_0: vid, image_1: img2, audio_0: aud });
  });

  it('非标准分辨率时不传 ratio（adaptive）', async () => {
    const execute = vi.fn<ExecuteFn>(async () => ({ taskId: 'r6' }));
    const img = new File(['i'], 'i.png', { type: 'image/png' });
    const ctx = makeCtx(
      {
        mode: 'reference',
        prompt: 'x',
        duration: 5,
        resolution: { width: 1280, height: 800 },
        references: [{ type: 'image', file: img }],
      },
      execute,
    );
    await getSubmit('minimax-h3-r2v')(ctx);
    const call = firstExecuteCall(execute);
    expect(call.params.ratio).toBeUndefined();
  });

  it('仅音频参考 / 数量超上限 / 无提示词均抛错', async () => {
    const execute = vi.fn<ExecuteFn>(async () => ({ taskId: 'r7' }));
    const aud = new File(['a'], 'a.mp3', { type: 'audio/mpeg' });
    const base = {
      mode: 'reference' as const,
      prompt: 'x',
      duration: 5,
      resolution: { width: 1280, height: 720 },
    };
    await expect(
      getSubmit('minimax-h3-r2v')(makeCtx({ ...base, references: [{ type: 'audio', file: aud }] }, execute)),
    ).rejects.toThrow('至少需要 1 个图片或视频参考素材');

    const imgs = Array.from({ length: 10 }, (_, i) => ({
      type: 'image' as const,
      file: new File(['i'], `${i}.png`, { type: 'image/png' }),
    }));
    await expect(
      getSubmit('minimax-h3-r2v')(makeCtx({ ...base, references: imgs }, execute)),
    ).rejects.toThrow('参考图片数量超过上限');

    await expect(
      getSubmit('minimax-h3-r2v')(makeCtx({ ...base, prompt: '' }, execute)),
    ).rejects.toThrow('需要提示词');
  });
});

describe('image-to-video 注册', () => {
  it('两个 MiniMax H3 实现已注册且声明正确的 provider 与能力', () => {
    const i2v = getImpl('image-to-video', 'minimax-h3-i2v');
    expect(i2v?.provider).toBe('minimax-h3');
    expect(i2v?.capabilities?.cancelable).toBe(true);
    expect(i2v?.capabilities?.video?.modes).toEqual(['first-last-frame']);
    expect(i2v?.capabilities?.video?.firstLastFrame?.maxFrames).toBe(2);

    const r2v = getImpl('image-to-video', 'minimax-h3-r2v');
    expect(r2v?.provider).toBe('minimax-h3');
    expect(r2v?.capabilities?.cancelable).toBe(true);
    expect(r2v?.capabilities?.video?.modes).toEqual(['reference']);
    expect(r2v?.capabilities?.video?.reference).toMatchObject({
      maxTotal: 15,
      audioRequiresVisual: true,
      types: {
        image: { max: 9 },
        video: { max: 3 },
        audio: { max: 3 },
      },
    });
  });
});
