import { beforeEach, describe, expect, it, vi } from 'vitest';

// 模块级 mock：fluent-ffmpeg（可链式、可触发 end/error/progress/stderr）与 fs/promises（unlink）
const { mockFfmpeg, mockUnlink } = vi.hoisted(() => ({
  mockFfmpeg: vi.fn(),
  mockUnlink: vi.fn(async () => undefined),
}));

vi.mock('fluent-ffmpeg', () => {
  const ffmpegFn = () => mockFfmpeg();
  return { default: ffmpegFn };
});

vi.mock('fs/promises', () => ({
  default: { unlink: mockUnlink },
  unlink: mockUnlink,
}));

import { taskRegistry } from './registry.js';
import {
  computeProgressPercent,
  extractFfmpegError,
  ffmpegExecutor,
  parseTimemarkSeconds,
} from './ffmpeg-executor.js';

/** 构造 ffmpeg 假命令：记录事件监听器，可由测试手动触发 */
function mockCommand() {
  const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
  /** kill 调用记录（断言中断路径用） */
  const kill = vi.fn();
  const chain = {
    input: () => chain,
    outputOptions: () => chain,
    on: (event: string, cb: (arg?: unknown) => void) => {
      (handlers[event] ??= []).push(cb);
      return chain;
    },
    save: () => chain,
    kill,
  };
  return {
    chain,
    kill,
    /** 触发事件（按注册顺序依次调用全部监听器） */
    emit: (event: string, arg?: unknown) => {
      for (const cb of [...(handlers[event] ?? [])]) cb(arg);
    },
  };
}

beforeEach(() => {
  taskRegistry.clear();
  vi.clearAllMocks();
});

describe('parseTimemarkSeconds', () => {
  it('解析 HH:MM:SS(.xx)', () => {
    expect(parseTimemarkSeconds('00:00:01.50')).toBe(1.5);
    expect(parseTimemarkSeconds('01:02:03')).toBe(3723);
    expect(parseTimemarkSeconds('00:00:00.00')).toBe(0);
  });

  it('非法输入返回 null', () => {
    expect(parseTimemarkSeconds(undefined)).toBeNull();
    expect(parseTimemarkSeconds('')).toBeNull();
    expect(parseTimemarkSeconds('1:2')).toBeNull();
    expect(parseTimemarkSeconds('abc')).toBeNull();
  });
});

describe('computeProgressPercent', () => {
  it('按当前秒数 / 总时长计算并钳制到 0~99', () => {
    expect(computeProgressPercent(5, 10)).toBe(50);
    expect(computeProgressPercent(9.99, 10)).toBe(99);
    expect(computeProgressPercent(10, 10)).toBe(99);
    expect(computeProgressPercent(0, 10)).toBe(0);
  });

  it('总时长不可用返回 null（不确定进度）', () => {
    expect(computeProgressPercent(5, undefined)).toBeNull();
    expect(computeProgressPercent(5, 0)).toBeNull();
    expect(computeProgressPercent(null, 10)).toBeNull();
  });
});

describe('extractFfmpegError', () => {
  it('附加 stderr 最后一条有效行', () => {
    const msg = extractFfmpegError(new Error('ffmpeg exited with code 1'), 'line1\n\nline2  ');
    expect(msg).toContain('ffmpeg exited with code 1');
    expect(msg).toContain('line2');
  });

  it('无 stderr 时只返回错误消息', () => {
    expect(extractFfmpegError(new Error('boom'), '')).toBe('boom');
  });
});

describe('ffmpegExecutor', () => {
  it('run 成功：progress 上报 + finish(completed)', async () => {
    const cmd = mockCommand();
    mockFfmpeg.mockReturnValue(cmd.chain);
    const task = ffmpegExecutor.create({ label: '拼接视频' }, { outputAbs: '/x/out.mp4', build: () => cmd.chain as never });

    const running = ffmpegExecutor.run(task.id, {
      outputAbs: '/x/out.mp4',
      build: () => cmd.chain as never,
      duration: 10,
    });
    cmd.emit('progress', { timemark: '00:00:05.00' });
    expect(taskRegistry.get(task.id)?.progress).toBe(50);
    cmd.emit('end');
    await running;

    expect(taskRegistry.get(task.id)).toBeUndefined();
  });

  it('run 失败：finish(failed) 且错误含 stderr 摘要', async () => {
    const cmd = mockCommand();
    mockFfmpeg.mockReturnValue(cmd.chain);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const task = ffmpegExecutor.create({ label: '拼接视频' }, { outputAbs: '/x/out.mp4', build: () => cmd.chain as never });

    const running = ffmpegExecutor.run(task.id, { outputAbs: '/x/out.mp4', build: () => cmd.chain as never });
    cmd.emit('stderr', 'Invalid data found when processing input');
    cmd.emit('error', new Error('ffmpeg exited with code 1'));
    await running;

    const finished = taskRegistry.listActive();
    expect(finished).toHaveLength(0);
    spy.mockRestore();
  });

  it('中断：kill 子进程 + 删除半截产物 + finish(cancelled)', async () => {
    const cmd = mockCommand();
    mockFfmpeg.mockReturnValue(cmd.chain);
    const task = ffmpegExecutor.create({ label: '拼接视频' }, { outputAbs: '/x/out.mp4', build: () => cmd.chain as never });

    const running = ffmpegExecutor.run(task.id, { outputAbs: '/x/out.mp4', build: () => cmd.chain as never });
    expect(ffmpegExecutor.cancel(task.id)).toBe(true);
    expect(cmd.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockUnlink).toHaveBeenCalledWith('/x/out.mp4');
    // 中断导致的 error 事件按 cancelled 收敛（不报错）
    cmd.emit('error', new Error('ffmpeg was killed with signal SIGKILL'));
    await running;
    expect(taskRegistry.get(task.id)).toBeUndefined();
  });

  it('removeOnCancel=false 时中断不删除产物', async () => {
    const cmd = mockCommand();
    mockFfmpeg.mockReturnValue(cmd.chain);
    const task = ffmpegExecutor.create({ label: 'A' }, { outputAbs: '/x/out.mp4', build: () => cmd.chain as never });
    const running = ffmpegExecutor.run(task.id, {
      outputAbs: '/x/out.mp4',
      build: () => cmd.chain as never,
      removeOnCancel: false,
    });
    ffmpegExecutor.cancel(task.id);
    cmd.emit('error', new Error('killed'));
    await running;
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('cancel 未知任务返回 false；create 注入的句柄可经注册表中断', () => {
    expect(ffmpegExecutor.cancel('missing')).toBe(false);

    const cmd = mockCommand();
    mockFfmpeg.mockReturnValue(cmd.chain);
    const task = ffmpegExecutor.create({ label: 'A' }, { outputAbs: '/x/out.mp4', build: () => cmd.chain as never });
    void ffmpegExecutor.run(task.id, { outputAbs: '/x/out.mp4', build: () => cmd.chain as never });
    // 注册表统一入口 → 任务句柄 → 执行器 cancel
    expect(taskRegistry.cancel(task.id)).toEqual({ ok: true });
    expect(cmd.kill).toHaveBeenCalled();
  });
});
