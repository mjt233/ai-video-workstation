import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  sessionManager,
  LlmSessionError,
  LLM_MAX_ACTIVE_SESSIONS,
  type LlmSession,
  type LlmSessionBeginInput,
} from './session-manager.js';
import type { LlmPersistResult } from './result-persist.js';

/** 构造标准的登记参数（项目/画布/节点可覆盖） */
function beginInput(overrides: Partial<LlmSessionBeginInput> = {}): LlmSessionBeginInput {
  return {
    nodeId: 'node-1',
    providerInstanceId: 'inst-1',
    modelId: 'model-1',
    label: 'AI文本生成',
    project: 'proj',
    canvas: { kind: 'scene', episode: '1', shot: '1' },
    input: '你好',
    snapshot: { modelName: '模型A', presetName: '预设B', mediaLabels: ['图1.png'], userInput: '你好' },
    ...overrides,
  };
}

/** 终态落盘替身：记录调用并返回可配置结果 */
function stubPersister(result: Partial<LlmPersistResult> = { wrote: true, rev: 7 }) {
  const fn = vi.fn(async (_s: LlmSession): Promise<LlmPersistResult> => ({ wrote: true, rev: 7, ...result }));
  sessionManager.setPersister(fn);
  return fn;
}

describe('sessionManager.begin', () => {
  beforeEach(() => {
    sessionManager.setPersister(async () => ({ wrote: true, rev: 1 }));
  });

  afterEach(async () => {
    // 清理全部活跃会话（终止不落盘：直接 cancel + finish 收敛）
    for (const s of sessionManager.listActive()) {
      sessionManager.cancel(s.taskId);
      await sessionManager.finish(s.taskId, { status: 'cancelled' });
    }
  });

  it('登记会话并返回唯一 taskId（初始 running/thinking）', () => {
    const s = sessionManager.begin(beginInput());
    expect(s.taskId).toBeTypeOf('string');
    expect(sessionManager.get(s.taskId)).toBe(s);
    expect(s.status).toBe('running');
    expect(s.phase).toBe('thinking');
    expect(s.inputSent).toBe('你好');
    expect(s.snapshot.userInput).toBe('你好');
    expect(s.canvas).toEqual({ kind: 'scene', episode: '1', shot: '1' });
  });

  it('同节点单飞：nodeId 重复时拒绝（NODE_BUSY）', () => {
    sessionManager.begin(beginInput());
    expect(() => sessionManager.begin(beginInput())).toThrowError(LlmSessionError);
    try {
      sessionManager.begin(beginInput());
    } catch (e) {
      expect((e as LlmSessionError).code).toBe('NODE_BUSY');
    }
  });

  it('不同节点可并行登记（上限内）', () => {
    sessionManager.begin(beginInput({ nodeId: 'a' }));
    const b = sessionManager.begin(beginInput({ nodeId: 'b' }));
    expect(b.status).toBe('running');
    expect(sessionManager.listActive()).toHaveLength(2);
  });

  it('全局活跃上限：超过 8 个拒绝（SESSION_LIMIT）', () => {
    for (let i = 0; i < LLM_MAX_ACTIVE_SESSIONS; i += 1) {
      sessionManager.begin(beginInput({ nodeId: `n${i}` }));
    }
    expect(() => sessionManager.begin(beginInput({ nodeId: 'overflow' }))).toThrowError(LlmSessionError);
    try {
      sessionManager.begin(beginInput({ nodeId: 'overflow' }));
    } catch (e) {
      expect((e as LlmSessionError).code).toBe('SESSION_LIMIT');
    }
  });
});

describe('sessionManager.pushEvent / phase', () => {
  beforeEach(() => {
    sessionManager.setPersister(async () => ({ wrote: true, rev: 1 }));
  });

  afterEach(async () => {
    for (const s of sessionManager.listActive()) {
      sessionManager.cancel(s.taskId);
      await sessionManager.finish(s.taskId, { status: 'cancelled' });
    }
  });

  it('thinking 增量只进 thinking；首个 text 增量切 responding 并进 text', () => {
    const s = sessionManager.begin(beginInput());
    sessionManager.pushEvent(s.taskId, { type: 'thinking', delta: '思考中' });
    expect(s.thinking).toBe('思考中');
    expect(s.phase).toBe('thinking');
    sessionManager.pushEvent(s.taskId, { type: 'thinking', delta: '继续' });
    expect(s.thinking).toBe('思考中继续');
    sessionManager.pushEvent(s.taskId, { type: 'text', delta: '答案' });
    expect(s.phase).toBe('responding');
    expect(s.text).toBe('答案');
    sessionManager.pushEvent(s.taskId, { type: 'text', delta: '补充' });
    expect(s.text).toBe('答案补充');
    // 思考内容不进入 text（config.output 仅正文）
    expect(s.text).not.toContain('思考中');
  });

  it('warning / error 累加；未知/已终态会话忽略（幂等）', async () => {
    const s = sessionManager.begin(beginInput());
    sessionManager.pushEvent(s.taskId, { type: 'warning', message: '图片被忽略' });
    expect(s.warnings).toEqual(['图片被忽略']);
    sessionManager.pushEvent(s.taskId, { type: 'error', message: '模型异常' });
    expect(s.error).toBe('模型异常');
    // 已终态后 pushEvent 不再生效
    await sessionManager.finish(s.taskId, { status: 'completed' });
    sessionManager.pushEvent(s.taskId, { type: 'text', delta: '迟到' });
    expect(s.text).toBe('');
    sessionManager.pushEvent('not-exist', { type: 'text', delta: 'x' });
  });
});

describe('sessionManager.finish / cancel', () => {
  it('正常完成：先落盘（persister 接到终态会话）再移除活跃区', async () => {
    const persister = stubPersister({ wrote: true, rev: 5 });
    const s = sessionManager.begin(beginInput());
    const events: string[] = [];
    const off = sessionManager.on((e) => events.push(e.type));
    sessionManager.pushEvent(s.taskId, { type: 'text', delta: '完整答案' });
    const done = await sessionManager.finish(s.taskId, { status: 'completed' });
    expect(done?.status).toBe('completed');
    expect(done?.persistRev).toBe(5);
    expect(persister).toHaveBeenCalledTimes(1);
    expect(persister.mock.calls[0][0].status).toBe('completed');
    expect(persister.mock.calls[0][0].text).toBe('完整答案');
    expect(sessionManager.get(s.taskId)).toBeUndefined();
    expect(events).toContain('finish');
    off();
  });

  it('取消优先：cancel 后流正常结束也按 cancelled 收敛且不落盘补丁', async () => {
    const persister = stubPersister({ wrote: true, rev: 2 });
    const s = sessionManager.begin(beginInput());
    expect(sessionManager.cancel(s.taskId)).toBe(true);
    expect(s.cancelled).toBe(true);
    const done = await sessionManager.finish(s.taskId, { status: 'completed' });
    expect(done?.status).toBe('cancelled');
    expect(persister.mock.calls[0][0].status).toBe('cancelled');
  });

  it('中止路径：runner 按 abort 判定 cancelled（AbortError 不归类 failed）', async () => {
    stubPersister();
    const s = sessionManager.begin(beginInput());
    sessionManager.cancel(s.taskId);
    // 模拟 runner 捕获 AbortError 后收敛
    const done = await sessionManager.finish(s.taskId, { status: 'cancelled' });
    expect(done?.status).toBe('cancelled');
    expect(done?.error).toBeUndefined();
  });

  it('上游异常：finish(failed, error) 记录错误', async () => {
    stubPersister();
    const s = sessionManager.begin(beginInput());
    const done = await sessionManager.finish(s.taskId, { status: 'failed', error: '网络超时' });
    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('网络超时');
  });

  it('终态幂等：已移除会话重复 finish 返回 null 且不重复落盘', async () => {
    const persister = stubPersister();
    const s = sessionManager.begin(beginInput());
    await sessionManager.finish(s.taskId, { status: 'completed' });
    const again = await sessionManager.finish(s.taskId, { status: 'completed' });
    expect(again).toBeNull();
    expect(persister).toHaveBeenCalledTimes(1);
  });

  it('落盘失败：completed 降级为 failed 且错误不为空', async () => {
    sessionManager.setPersister(async () => {
      throw new Error('磁盘写满');
    });
    const s = sessionManager.begin(beginInput());
    const done = await sessionManager.finish(s.taskId, { status: 'completed' });
    expect(done?.status).toBe('failed');
    expect(done?.error).toContain('结果写入画布失败');
    expect(sessionManager.get(s.taskId)).toBeUndefined();
  });

  it('cancel 幂等：已终态/不存在返回 false', async () => {
    const s = sessionManager.begin(beginInput());
    await sessionManager.finish(s.taskId, { status: 'completed' });
    expect(sessionManager.cancel(s.taskId)).toBe(false);
    expect(sessionManager.cancel('not-exist')).toBe(false);
  });
});
