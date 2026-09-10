/**
 * workflow-executor 可中断性同步单测。
 *
 * 核心回归：工作流任务登记进统一注册表时远端尚未提交（引擎领取即置 running），
 * 判定为「不可中断（任务尚未提交到远端）」；引擎提交远端成功后必须经
 * `update({ remoteTaskId })` 同步注册表，把可中断性收敛为 true——否则任务管理器
 * 中断按钮始终禁用、节点中断被 404 拒绝。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelWorkflowTask, workflowExecutor } from './workflow-executor.js';
import { taskRegistry } from './registry.js';

const { mockDb, mockGetImpl, mockGetProvider, mockListInstances, mockResolveInstanceConfig } = vi.hoisted(() => ({
  mockDb: {
    getTask: vi.fn(),
    updateTaskStatus: vi.fn(),
    updateTaskParams: vi.fn(),
    addLog: vi.fn(),
  },
  mockGetImpl: vi.fn(),
  mockGetProvider: vi.fn(),
  mockListInstances: vi.fn(async () => [] as unknown[]),
  mockResolveInstanceConfig: vi.fn(() => ({})),
}));

vi.mock('../db.js', () => mockDb);
vi.mock('../workflows/registry.js', () => ({ getImpl: mockGetImpl }));
vi.mock('../providers/registry.js', () => ({ getProvider: mockGetProvider }));
vi.mock('../providers/config-store.js', () => ({
  listInstances: mockListInstances,
  resolveInstanceConfig: mockResolveInstanceConfig,
}));
vi.mock('../workflows/cancel.js', () => ({ markCancelRequested: vi.fn((p: unknown) => ({ ...(p as object), cancelRequested: true })) }));

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

/** 构造 deferredCancel 工作流定义（同步执行类：自定义服务商同步工作流 / 火山方舟等） */
const deferredWf = (): Record<string, unknown> => ({
  type: 'text-to-image',
  impl: 'custom-wf-sync-inst-1',
  name: '自定义同步工作流',
  provider: 'custom',
  providerInstanceId: 'inst-1',
  submit: vi.fn(),
  capabilities: { cancelable: true, deferredCancel: true },
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

describe('cancelWorkflowTask（延迟取消分支）', () => {
  /** deferredCancel 任务记录（impl 与 deferredWf 对应） */
  const deferredTask = (params: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'task-1',
    workflow_id: 'text-to-image',
    impl: 'custom-wf-sync-inst-1',
    status: 'running',
    params: JSON.stringify({ outputPath: 'assert/canvas/e1/s1/task-1/output.png', ...params }),
  });

  /** provider 定义 + 实例：cancel 记录调用 */
  const setupProvider = (cancel: (taskId: string) => Promise<void>): { calls: string[] } => {
    const calls: string[] = [];
    mockGetProvider.mockReturnValue({
      id: 'custom',
      createClient: () => ({
        cancel: async (remoteTaskId: string) => {
          calls.push(remoteTaskId);
          await cancel(remoteTaskId);
        },
      }),
    });
    mockListInstances.mockResolvedValue([{ id: 'inst-1', type: 'custom', name: '自定义', config: {} }]);
    return { calls };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImpl.mockReturnValue(deferredWf());
  });

  it('已提交远端：写取消标记 + 通知 provider 中止在途请求', async () => {
    const { calls } = setupProvider(async () => undefined);
    mockDb.getTask.mockReturnValue(deferredTask({ remoteTaskId: 'local-1' }));
    await cancelWorkflowTask('task-1');
    // 取消标记已写入（引擎写产物前检查 → 中断后不落产物）
    expect(mockDb.updateTaskParams).toHaveBeenCalledTimes(1);
    expect(mockDb.updateTaskParams.mock.calls[0][1]).toMatchObject({ cancelRequested: true });
    // provider 收到中止通知（自定义服务商据此 abort 在途 HTTP 请求）
    expect(calls).toEqual(['local-1']);
    // 延迟取消分支不改写任务状态（由引擎收敛为「用户中断」）
    expect(mockDb.updateTaskStatus).not.toHaveBeenCalled();
    const logs = mockDb.addLog.mock.calls.map((c) => String(c[2])).join('\n');
    expect(logs).toContain('已通知服务商');
  });

  it('尚未提交远端（execute 未返回任务 id 的窗口）：仅写标记，不报错', async () => {
    const { calls } = setupProvider(async () => undefined);
    mockDb.getTask.mockReturnValue(deferredTask());
    await cancelWorkflowTask('task-1');
    expect(mockDb.updateTaskParams).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    const logs = mockDb.addLog.mock.calls.map((c) => String(c[2])).join('\n');
    expect(logs).toContain('将在执行完成后生效');
  });

  it('通知 provider 失败：只告警，不抛错（标记已写入，任务仍收敛）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setupProvider(async () => {
      throw new Error('实例不可达');
    });
    mockDb.getTask.mockReturnValue(deferredTask({ remoteTaskId: 'local-1' }));
    await expect(cancelWorkflowTask('task-1')).resolves.toBeUndefined();
    expect(mockDb.updateTaskParams).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('通知 provider 中止在途请求失败');
    warnSpy.mockRestore();
  });
});
