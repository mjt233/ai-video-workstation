import { describe, expect, it } from 'vitest';
import { parseTaskParams, canCancelTask, getRemoteTaskId } from './workflow.js';
import type { TaskRecord } from '../db.js';

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

  it('无 video 时返回 undefined', () => {
    const parsed = parseTaskParams(JSON.stringify({ vars: {}, outputPath: 'assert/x.mp4' }));
    expect(parsed.video).toBeUndefined();
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

  it('canCancelTask：pending（本地排队）允许本地取消', () => {
    const result = canCancelTask(mkTask({ status: 'pending', params: JSON.stringify({ vars: {} }) }), { capabilities: { cancelable: true } });
    expect(result.ok).toBe(true);
  });
});
