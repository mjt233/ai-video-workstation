/**
 * workflow-executor 可中断性同步单测。
 *
 * 核心回归：工作流任务登记进统一注册表时远端尚未提交（引擎领取即置 running），
 * 判定为「不可中断（任务尚未提交到远端）」；引擎提交远端成功后必须经
 * `update({ remoteTaskId })` 同步注册表，把可中断性收敛为 true——否则任务管理器
 * 中断按钮始终禁用、节点中断被 404 拒绝。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workflowExecutor } from './workflow-executor.js';
import { taskRegistry } from './registry.js';

const { mockDb, mockGetImpl } = vi.hoisted(() => ({
  mockDb: {
    getTask: vi.fn(),
    updateTaskStatus: vi.fn(),
    updateTaskParams: vi.fn(),
    addLog: vi.fn(),
  },
  mockGetImpl: vi.fn(),
}));

vi.mock('../db.js', () => mockDb);
vi.mock('../workflows/registry.js', () => ({ getImpl: mockGetImpl }));
vi.mock('../providers/registry.js', () => ({ getProvider: vi.fn() }));
vi.mock('../providers/config-store.js', () => ({
  listInstances: vi.fn(async () => []),
  resolveInstanceConfig: vi.fn(),
}));
vi.mock('../workflows/cancel.js', () => ({ markCancelRequested: vi.fn((p: unknown) => p) }));

/** 构造工作流定义（Bridge 类远端任务：声明可中断但非 deferredCancel，提交远端 + 轮询） */
const bridgeWf = (): Record<string, unknown> => ({
  type: 'image-to-video',
  impl: 'minimax-h3-i2v',
  name: '图生视频',
  provider: 'minimax-h3',
  providerInstanceId: 'inst-1',
  submit: vi.fn(),
  capabilities: { cancelable: true },
});

/** 构造 SQLite 任务记录（params 可携带已落盘的 remoteTaskId） */
const dbTask = (params: Record<string, unknown> = { outputPath: 'assert/canvas/e1/s1/task-1/output.mp4' }): Record<string, unknown> => ({
  id: 'task-1',
  workflow_id: 'image-to-video',
  impl: 'minimax-h3-i2v',
  status: 'running',
  params: JSON.stringify(params),
});

/** 登记一个测试任务进注册表 */
function createTask(): void {
  workflowExecutor.create({
    taskId: 'task-1',
    project: 'test-project',
    workflowId: 'image-to-video',
    impl: 'minimax-h3-i2v',
    label: '生成视频',
  });
}

describe('workflowExecutor 可中断性同步', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskRegistry.clear();
    mockGetImpl.mockReturnValue(bridgeWf());
  });

  it('登记时 running 且未提交远端：不可中断（任务尚未提交到远端）', () => {
    mockDb.getTask.mockReturnValue(dbTask());
    createTask();
    const rec = taskRegistry.get('task-1');
    expect(rec?.cancelable).toBe(false);
    expect(rec?.cancelBlockReason).toBe('任务尚未提交到远端，无法中断');
  });

  it('提交远端后 update(remoteTaskId)：重算为可中断且原因清空', () => {
    mockDb.getTask.mockReturnValue(dbTask());
    createTask();
    // 引擎提交远端成功：SQLite 落盘 remoteTaskId 后同步注册表
    mockDb.getTask.mockReturnValue(dbTask({ outputPath: 'assert/x.mp4', remoteTaskId: 'remote-1' }));
    workflowExecutor.update('task-1', { remoteTaskId: 'remote-1' });
    const rec = taskRegistry.get('task-1');
    expect(rec?.cancelable).toBe(true);
    expect(rec?.cancelBlockReason).toBeUndefined();
  });

  it('update 仅传 status：remoteTaskId 回退 SQLite 已落盘值，不把已提交远端的任务算回不可中断', () => {
    // 重试/恢复场景：SQLite 已有 remoteTaskId，登记即判定可中断
    mockDb.getTask.mockReturnValue(dbTask({ outputPath: 'assert/x.mp4', remoteTaskId: 'remote-1' }));
    createTask();
    expect(taskRegistry.get('task-1')?.cancelable).toBe(true);
    // 仅状态推进（不带 remoteTaskId）：回退 SQLite 已落盘值，保持可中断
    workflowExecutor.update('task-1', { status: 'running' });
    expect(taskRegistry.get('task-1')?.cancelable).toBe(true);
  });

  it('登记携带画布定位（nodeId / canvas）：画布加载/切换后按 scope 恢复节点 Loading', () => {
    mockDb.getTask.mockReturnValue(dbTask());
    workflowExecutor.create({
      taskId: 'task-1',
      project: 'test-project',
      workflowId: 'image-to-video',
      impl: 'minimax-h3-i2v',
      label: '生成视频',
      outputPath: 'assert/scene/1/1/canvas/vg/output.mp4',
      nodeId: 'vg',
      canvas: { kind: 'scene', episode: '1', shot: '1' },
    });
    const rec = taskRegistry.get('task-1');
    expect(rec?.nodeId).toBe('vg');
    expect(rec?.canvas).toEqual({ kind: 'scene', episode: '1', shot: '1' });
    expect(rec?.payload?.outputPath).toBe('assert/scene/1/1/canvas/vg/output.mp4');
  });

  it('登记未携带画布定位：不写入 nodeId/canvas（非画布任务不参与恢复）', () => {
    mockDb.getTask.mockReturnValue(dbTask());
    createTask();
    const rec = taskRegistry.get('task-1');
    expect(rec?.nodeId).toBeUndefined();
    expect(rec?.canvas).toBeUndefined();
  });
});
