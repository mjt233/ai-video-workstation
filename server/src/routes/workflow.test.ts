import { describe, expect, it } from 'vitest';
import { parseTaskParams, canCancelTask, getRemoteTaskId, validateWorkflowImpl, validateDiscoveredImpls, extractComfyuiProviderId } from './workflow.js';
import { register } from '../workflows/registry.js';
import type { TaskRecord } from '../db.js';
import type { WorkflowDefinition } from '../workflows/types.js';
import type { DiscoveredTask } from '../workflows/discovery.js';

/** 注册一个最小假实现（与 capabilities.test.ts 一致），供 validateWorkflowImpl 用例使用 */
function registerFake(type: string, impl: string, provider?: string): void {
  register({
    type,
    name: type,
    impl,
    provider,
    // 注册表语义：无实例 = 候选定义（getImplementations 不可见），补实例 ID 使其可执行
    providerInstanceId: 'test-inst',
    submit: async () => ({ taskId: 't' }),
  } as WorkflowDefinition);
}

describe('validateWorkflowImpl', () => {
  it('合法显式实现返回 ok 与规范化定义', () => {
    registerFake('validate-impl-ok', 'seedream-5-pro');
    const r = validateWorkflowImpl('validate-impl-ok', '  seedream-5-pro  ');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.impl).toBe('seedream-5-pro');
      expect(r.implDef.impl).toBe('seedream-5-pro');
    }
  });

  it('缺失/空串/纯空白拒绝', () => {
    registerFake('validate-impl-empty', 'ceb-x');
    for (const impl of [undefined, '', '   ']) {
      const r = validateWorkflowImpl('validate-impl-empty', impl);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('workflow_impl_required');
    }
  });

  it('不存在的实现拒绝', () => {
    registerFake('validate-impl-missing', 'ceb-x');
    const r = validateWorkflowImpl('validate-impl-missing', 'seedream-5-pro');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('workflow_impl_not_found');
  });

  it('候选定义（未绑定实例）不可执行，拒绝', () => {
    register({
      type: 'validate-impl-candidate',
      name: '候选',
      impl: 'seedream',
      provider: 'volcengine-ark',
      // 不填 providerInstanceId：仅候选定义，不可执行
      submit: async () => ({ taskId: 't' }),
    } as WorkflowDefinition);
    const r = validateWorkflowImpl('validate-impl-candidate', 'seedream');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('workflow_impl_not_found');
  });
});

describe('validateDiscoveredImpls', () => {
  it('全部显式合法时返回解析结果', () => {
    registerFake('validate-batch-ok', 'ceb-t2i');
    const tasks: DiscoveredTask[] = [
      { workflowId: 'validate-batch-ok', impl: 'ceb-t2i', vars: {}, promptPaths: [], outputPath: 'assert/a.jpg', assetType: 'stage-image' },
    ];
    const r = validateDiscoveredImpls(tasks);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolved).toHaveLength(1);
  });

  it('任一任务缺失/非法实现时整体失败并列出资产类型', () => {
    registerFake('validate-batch-mixed', 'ceb-t2i');
    const tasks: DiscoveredTask[] = [
      { workflowId: 'validate-batch-mixed', impl: 'ceb-t2i', vars: {}, promptPaths: [], outputPath: 'assert/a.jpg', assetType: 'stage-image' },
      { workflowId: 'validate-batch-mixed', vars: {}, promptPaths: [], outputPath: 'assert/b.jpg', assetType: 'variant-edit' },
    ];
    const r = validateDiscoveredImpls(tasks);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('variant-edit');
      expect(r.message).toContain('必须显式指定工作流实现');
    }
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
