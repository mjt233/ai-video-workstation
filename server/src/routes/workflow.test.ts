import { describe, expect, it } from 'vitest';
import { parseTaskParams, canCancelTask, getRemoteTaskId, resolveImpl, extractComfyuiProviderId } from './workflow.js';
import { register } from '../workflows/registry.js';
import type { TaskRecord } from '../db.js';
import type { WorkflowDefinition } from '../workflows/types.js';

/** 注册一个最小假实现（与 capabilities.test.ts 一致），供 resolveImpl 用例使用 */
function registerFake(type: string, impl: string, provider?: string): void {
  register({
    type,
    name: type,
    impl,
    provider,
    submit: async () => ({ taskId: 't' }),
  } as WorkflowDefinition);
}

describe('resolveImpl', () => {
  it('指定实现存在时返回之', () => {
    registerFake('resolve-impl-test', 'ltx');
    expect(resolveImpl('resolve-impl-test', 'ltx')).toBe('ltx');
  });

  it('指定实现缺失时回退到第一个实现', () => {
    // 该工作流类型只有 ltx（无 default 实现）→ 回退到 ltx
    expect(resolveImpl('resolve-impl-test', 'default')).toBe('ltx');
    expect(resolveImpl('resolve-impl-test', undefined)).toBe('ltx');
  });

  it('未显式指定时优先本地 Bridge 实现（provider=comfyui-bridge）', () => {
    // 第一个实现是 volcengine-ark（付费云）、第二个是 comfyui-bridge（本地）→ 无显式 impl 返回 Bridge 实现
    registerFake('resolve-impl-bridge-pref', 'seedream-5-pro', 'volcengine-ark');
    registerFake('resolve-impl-bridge-pref', 'ceb-xx', 'comfyui-bridge');
    expect(resolveImpl('resolve-impl-bridge-pref', undefined)).toBe('ceb-xx');
    expect(resolveImpl('resolve-impl-bridge-pref', 'default')).toBe('ceb-xx');
  });

  it('无 comfyui-bridge 实现时回退到第一个实现', () => {
    registerFake('resolve-impl-no-bridge', 'seedream-5-pro', 'volcengine-ark');
    registerFake('resolve-impl-no-bridge', 'seedream-2.1', 'volcengine-ark');
    expect(resolveImpl('resolve-impl-no-bridge', undefined)).toBe('seedream-5-pro');
  });

  it('未知工作流类型时回退 default', () => {
    expect(resolveImpl('no-such-workflow', 'x')).toBe('default');
  });
});

const mkTask = (overrides: Partial<TaskRecord> = {}): TaskRecord =>
  ({
    id: 't1',
    project: 'p',
    workflow_id: 'image-to-video',
    impl: 'ltx',
    status: 'running',
    params: JSON.stringify({ vars: {}, outputPath: 'assert/x.mp4', remoteTaskId: 'bridge-1' }),
    result: null,
    error_msg: null,
    retry_count: 0,
    max_retries: 2,
    created_at: '',
    updated_at: '',
    completed_at: null,
    batch_id: null,
    phase: 0,
    ...overrides,
  });

describe('parseTaskParams', () => {
  it('包含 video 自包含提交参数（wire 形态）', () => {
    const parsed = parseTaskParams(JSON.stringify({
      vars: { episode: '1', shot: '1' },
      outputPath: 'assert/scene/1/1/video.mp4',
      video: {
        mode: 'reference',
        resolution: { width: 1080, height: 1920 },
        duration: 5,
        prompt: '测试',
        references: [
          { type: 'image', path: 'assert/scene/1/1/stage/0.jpg' },
          { type: 'audio', path: 'assert/scene/1/1/audio/merged.flac' },
        ],
        extraParams: {},
      },
    }));
    expect(parsed.video?.mode).toBe('reference');
    expect(parsed.video?.references).toHaveLength(2);
    expect(parsed.video?.references?.[0].path).toBe('assert/scene/1/1/stage/0.jpg');
  });

  it('远程任务 ID 透传', () => {
    const parsed = parseTaskParams(JSON.stringify({
      vars: {},
      outputPath: 'assert/x.mp4',
      remoteTaskId: 'bridge-task-1',
    }));
    expect(parsed.remoteTaskId).toBe('bridge-task-1');
  });

  it('comfyuiProviderId 透传', () => {
    const parsed = parseTaskParams(JSON.stringify({
      vars: {},
      outputPath: 'assert/x.mp4',
      comfyuiProviderId: 'inst-9',
    }));
    expect(parsed.comfyuiProviderId).toBe('inst-9');
  });

  it('无 comfyuiProviderId 时返回 undefined', () => {
    const parsed = parseTaskParams(JSON.stringify({ vars: {}, outputPath: 'assert/x.mp4' }));
    expect(parsed.comfyuiProviderId).toBeUndefined();
  });

  it('无 video 时返回 undefined', () => {
    const parsed = parseTaskParams(JSON.stringify({ vars: {}, outputPath: 'assert/x.mp4' }));
    expect(parsed.video).toBeUndefined();
  });
});

describe('extractComfyuiProviderId', () => {
  it('非空字符串 trim 后返回', () => {
    expect(extractComfyuiProviderId({ providerId: '  inst-1  ' })).toBe('inst-1');
  });

  it('缺失 / 空串 / 非字符串返回 undefined', () => {
    expect(extractComfyuiProviderId(undefined)).toBeUndefined();
    expect(extractComfyuiProviderId({})).toBeUndefined();
    expect(extractComfyuiProviderId({ providerId: '' })).toBeUndefined();
    expect(extractComfyuiProviderId({ providerId: '   ' })).toBeUndefined();
    expect(extractComfyuiProviderId({ providerId: 42 })).toBeUndefined();
    expect(extractComfyuiProviderId({ providerId: true })).toBeUndefined();
  });
});

describe('中断支持', () => {
  it('getRemoteTaskId 从 params 解析远端任务 ID', () => {
    expect(getRemoteTaskId(mkTask())).toBe('bridge-1');
    expect(getRemoteTaskId(mkTask({ params: JSON.stringify({ vars: {} }) }))).toBeUndefined();
  });

  it('canCancelTask：running + cancelable → ok', () => {
    const result = canCancelTask(mkTask(), { capabilities: { cancelable: true } });
    expect(result.ok).toBe(true);
  });

  it('canCancelTask：已完成任务拒绝', () => {
    const result = canCancelTask(mkTask({ status: 'completed' }), { capabilities: { cancelable: true } });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('应拒绝已完成任务');
    expect(result.status).toBe(400);
  });

  it('canCancelTask：实现未声明 cancelable 拒绝', () => {
    const result = canCancelTask(mkTask(), { capabilities: {} });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('应拒绝不支持中断的工作流');
    expect(result.code).toBe('not_cancelable');
  });

  it('canCancelTask：running 但无远端任务 ID 拒绝', () => {
    const result = canCancelTask(mkTask({ params: JSON.stringify({ vars: {} }) }), { capabilities: { cancelable: true } });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('应拒绝无远端任务 ID 的任务');
    expect(result.code).toBe('no_remote_task');
  });

  it('canCancelTask：running 无远端任务 ID + deferredCancel → ok（同步 provider 延迟生效）', () => {
    const result = canCancelTask(
      mkTask({ params: JSON.stringify({ vars: {} }) }),
      { capabilities: { cancelable: true, deferredCancel: true } },
    );
    expect(result.ok).toBe(true);
  });

  it('canCancelTask：pending（本地排队）允许本地取消', () => {
    const result = canCancelTask(mkTask({ status: 'pending', params: JSON.stringify({ vars: {} }) }), { capabilities: { cancelable: true } });
    expect(result.ok).toBe(true);
  });
});
