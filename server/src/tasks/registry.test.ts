import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskRegistry, TaskError, type TaskEvent } from './registry.js';

/** 每个用例前清空注册表（单例跨用例共享） */
beforeEach(() => {
  taskRegistry.clear();
});

describe('taskRegistry.register', () => {
  it('登记后出现在活跃列表，字段与事件正确', () => {
    const events: TaskEvent[] = [];
    const off = taskRegistry.on((e) => events.push(e));

    const task = taskRegistry.register({
      type: 'ffmpeg',
      label: '拼接视频',
      project: 'p',
      nodeId: 'n1',
      canvas: { kind: 'scene', episode: '1', shot: '2' },
      progress: 0,
    });

    expect(task.id).toBeTruthy();
    expect(task.status).toBe('running');
    expect(task.cancelable).toBe(true);
    expect(task.startedAt).toBeGreaterThan(0);
    expect(taskRegistry.listActive()).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('begin');
    off();
  });

  it('同节点单飞：已有活跃任务时抛 NODE_BUSY', () => {
    taskRegistry.register({ type: 'ffmpeg', label: 'A', nodeId: 'n1' });
    expect(() => taskRegistry.register({ type: 'workflow', label: 'B', nodeId: 'n1' })).toThrowError(TaskError);
    try {
      taskRegistry.register({ type: 'workflow', label: 'B', nodeId: 'n1' });
    } catch (e) {
      expect((e as TaskError).code).toBe('NODE_BUSY');
    }
  });

  it('不同节点可并行；未指定 nodeId 不参与单飞', () => {
    taskRegistry.register({ type: 'ffmpeg', label: 'A', nodeId: 'n1' });
    taskRegistry.register({ type: 'ffmpeg', label: 'B', nodeId: 'n2' });
    taskRegistry.register({ type: 'workflow', label: 'C' });
    taskRegistry.register({ type: 'workflow', label: 'D' });
    expect(taskRegistry.listActive()).toHaveLength(4);
  });

  it('idOverride 指定任务 id（LLM 会话 id 即任务 id）', () => {
    const t = taskRegistry.register({ type: 'llm', label: 'AI', idOverride: 'sess-1' });
    expect(t.id).toBe('sess-1');
    expect(taskRegistry.get('sess-1')).toBe(t);
  });

  it('不可中断任务必须带原因', () => {
    const t = taskRegistry.register({
      type: 'workflow',
      label: 'AI 生成',
      cancelable: false,
      cancelBlockReason: '该工作流不支持中断',
    });
    expect(t.cancelable).toBe(false);
    expect(t.cancelBlockReason).toBe('该工作流不支持中断');
  });
});

describe('taskRegistry.update', () => {
  it('合并进度/状态/payload 并广播 update 事件', () => {
    const events: TaskEvent[] = [];
    taskRegistry.on((e) => events.push(e));
    const t = taskRegistry.register({ type: 'ffmpeg', label: '拼接视频', progress: 0 });

    taskRegistry.update(t.id, { progress: 42, payload: { mode: 'reencode' } });
    taskRegistry.update(t.id, { payload: { width: 1920 } });

    expect(taskRegistry.get(t.id)?.progress).toBe(42);
    expect(taskRegistry.get(t.id)?.payload).toEqual({ mode: 'reencode', width: 1920 });
    expect(events.filter((e) => e.type === 'update')).toHaveLength(2);
  });

  it('进度钳制到 0~100', () => {
    const t = taskRegistry.register({ type: 'ffmpeg', label: 'A' });
    taskRegistry.update(t.id, { progress: 150 });
    expect(taskRegistry.get(t.id)?.progress).toBe(100);
    taskRegistry.update(t.id, { progress: -5 });
    expect(taskRegistry.get(t.id)?.progress).toBe(0);
  });

  it('空串 cancelBlockReason 清空原因', () => {
    const t = taskRegistry.register({
      type: 'workflow',
      label: 'A',
      cancelable: false,
      cancelBlockReason: '原因',
    });
    taskRegistry.update(t.id, { cancelable: true, cancelBlockReason: '' });
    expect(taskRegistry.get(t.id)?.cancelBlockReason).toBeUndefined();
  });

  it('终态任务忽略后续 update', () => {
    const t = taskRegistry.register({ type: 'ffmpeg', label: 'A' });
    taskRegistry.finish(t.id, { status: 'completed' });
    taskRegistry.update(t.id, { progress: 50 });
    expect(taskRegistry.get(t.id)).toBeUndefined();
  });
});

describe('taskRegistry.finish', () => {
  it('终态移出活跃区并广播 finish 事件（completed 补进度 100）', () => {
    const events: TaskEvent[] = [];
    taskRegistry.on((e) => events.push(e));
    const t = taskRegistry.register({ type: 'ffmpeg', label: 'A' });

    const finished = taskRegistry.finish(t.id, { status: 'completed' });

    expect(finished?.status).toBe('completed');
    expect(finished?.progress).toBe(100);
    expect(finished?.finishedAt).toBeGreaterThan(0);
    expect(taskRegistry.listActive()).toHaveLength(0);
    expect(events.map((e) => e.type)).toEqual(['begin', 'finish']);
  });

  it('失败携带错误信息；幂等（重复 finish 不重复广播）', () => {
    const events: TaskEvent[] = [];
    taskRegistry.on((e) => events.push(e));
    const t = taskRegistry.register({ type: 'ffmpeg', label: 'A' });

    const first = taskRegistry.finish(t.id, { status: 'failed', error: '编码失败' });
    const second = taskRegistry.finish(t.id, { status: 'completed' });

    expect(first?.status).toBe('failed');
    expect(first?.error).toBe('编码失败');
    expect(second).toBe(first);
    expect(events.filter((e) => e.type === 'finish')).toHaveLength(1);
  });

  it('未知任务返回 null', () => {
    expect(taskRegistry.finish('nope')).toBeNull();
  });
});

describe('taskRegistry.cancel', () => {
  it('调用任务句柄的 cancel', async () => {
    const cancel = vi.fn();
    const t = taskRegistry.register({ type: 'ffmpeg', label: 'A', handle: { cancel } });
    expect(taskRegistry.cancel(t.id)).toEqual({ ok: true });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('不可中断任务返回原因且不调用句柄', () => {
    const cancel = vi.fn();
    const t = taskRegistry.register({
      type: 'workflow',
      label: 'A',
      handle: { cancel },
      cancelable: false,
      cancelBlockReason: '该工作流不支持中断',
    });
    expect(taskRegistry.cancel(t.id)).toEqual({ ok: false, reason: '该工作流不支持中断' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('无句柄 / 不存在 / 已终态均返回 ok=false', () => {
    const noHandle = taskRegistry.register({ type: 'workflow', label: 'A' });
    expect(taskRegistry.cancel(noHandle.id).ok).toBe(false);
    expect(taskRegistry.cancel('missing').ok).toBe(false);
    const done = taskRegistry.register({ type: 'ffmpeg', label: 'B', handle: { cancel: vi.fn() } });
    taskRegistry.finish(done.id, { status: 'completed' });
    expect(taskRegistry.cancel(done.id).ok).toBe(false);
  });

  it('句柄异步抛错只打日志，不向调用方抛出', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const t = taskRegistry.register({
      type: 'ffmpeg',
      label: 'A',
      handle: {
        cancel: () => Promise.reject(new Error('kill 失败')),
      },
    });
    expect(taskRegistry.cancel(t.id)).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('taskRegistry.listActive', () => {
  it('按登记时间倒序', () => {
    const a = taskRegistry.register({ type: 'ffmpeg', label: 'A' });
    const b = taskRegistry.register({ type: 'ffmpeg', label: 'B' });
    expect(taskRegistry.listActive().map((t) => t.id)).toEqual([b.id, a.id]);
  });
});
