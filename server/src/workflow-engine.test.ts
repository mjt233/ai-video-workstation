import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mimeTypeForFile, runTask, toBase64Output } from './workflow-engine.js';
import type { TaskRecord } from './db.js';
import type { WorkflowDefinition } from './workflows/types.js';
import type { ProviderInstance } from './providers/types.js';

// ── mock 依赖：db / registry / config-store / provider registry / routes / history ──
// 注意：vi.mock 工厂被 hoist 到顶部，mock 客户端与可变配置必须用 vi.hoisted 定义；
// 各 mock 函数在测试中直接引用（mockGetInstance 等），可随时改返回值。
const {
  mockDb,
  mockGetImpl,
  mockGetInstance,
  mockResolveInstanceConfig,
  mockGetProvider,
  mockCreateClient,
  mockClient,
  mockCopyExistingAssetToHistory,
  mockGetBatchConcurrency,
} = vi.hoisted(() => {
  const mockClient = {
    execute: vi.fn(),
    poll: vi.fn(),
    getOutput: vi.fn(),
    cancel: vi.fn(),
  };
  return {
    mockDb: {
      getTask: vi.fn(),
      updateTaskStatus: vi.fn(),
      addLog: vi.fn(),
      updateTaskParams: vi.fn(),
    },
    mockGetImpl: vi.fn(),
    mockGetInstance: vi.fn(),
    mockResolveInstanceConfig: vi.fn(),
    mockGetProvider: vi.fn(),
    mockCreateClient: vi.fn(() => mockClient),
    mockClient,
    mockCopyExistingAssetToHistory: vi.fn(async () => null),
    mockGetBatchConcurrency: vi.fn(() => 1),
  };
});

vi.mock('./db.js', () => mockDb);
vi.mock('./workflows/registry.js', () => ({
  register: vi.fn(),
  getImpl: mockGetImpl,
  getAllWorkflows: vi.fn(),
}));
vi.mock('./providers/config-store.js', () => ({
  getInstance: mockGetInstance,
  resolveInstanceConfig: mockResolveInstanceConfig,
}));
vi.mock('./providers/registry.js', () => ({
  getProvider: mockGetProvider,
}));
vi.mock('./routes/workflow.js', () => ({
  getBatchConcurrency: mockGetBatchConcurrency,
}));
vi.mock('./assets/history.js', () => ({
  copyExistingAssetToHistory: mockCopyExistingAssetToHistory,
}));

/** 构造任务记录（默认 text-to-image / seedream-inst-1，绑定实例 inst-1） */
const taskRecord = (over: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 'task-1',
  project: 'test-project',
  workflow_id: 'text-to-image',
  impl: 'seedream-inst-1',
  status: 'pending',
  params: JSON.stringify({ outputPath: 'assert/test.png' }),
  result: null,
  error_msg: null,
  retry_count: 0,
  max_retries: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  completed_at: null,
  batch_id: null,
  phase: 0,
  ...over,
});

/** 构造工作流定义（默认绑定实例 inst-1，submit 为可覆写的 mock） */
const wf = (over: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  type: 'text-to-image',
  impl: 'seedream-inst-1',
  name: '文生图',
  provider: 'volcengine-ark',
  providerInstanceId: 'inst-1',
  submit: vi.fn(),
  ...over,
});

/** 构造服务商实例（默认 volcengine-ark / inst-1） */
const instance = (over: Partial<ProviderInstance> = {}): ProviderInstance => ({
  id: 'inst-1',
  type: 'volcengine-ark',
  name: '火山方舟-主账号',
  config: { apiKey: 'key' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // 默认 provider 定义：createClient 返回 mockClient
  mockGetProvider.mockReturnValue({
    id: 'volcengine-ark',
    name: '火山方舟',
    createClient: mockCreateClient,
  });
});

describe('runTask provider 解析（按实例）', () => {
  it('按 wf.providerInstanceId 精确查实例，用实例配置创建客户端并注入 submit', async () => {
    mockDb.getTask.mockReturnValue(taskRecord());
    const submit = vi.fn().mockRejectedValue(new Error('stop-after-submit'));
    mockGetImpl.mockReturnValue(wf({ submit }));
    mockGetInstance.mockResolvedValue(instance());
    mockResolveInstanceConfig.mockReturnValue({ apiKey: 'resolved-key' });

    await runTask('task-1');

    // 按 providerInstanceId 精确查实例（而非按类型取第一个）
    expect(mockGetInstance).toHaveBeenCalledWith('inst-1');
    // 用实例解析出的配置创建客户端
    expect(mockCreateClient).toHaveBeenCalledWith({ apiKey: 'resolved-key' });
    // 客户端注入 submit 的 runContext
    expect(submit).toHaveBeenCalledTimes(1);
    const ctx = submit.mock.calls[0][0] as { provider: unknown };
    expect(ctx.provider).toBe(mockClient);
    // 流程走到 submit（submit 抛错 → 任务失败，验证未在 provider 解析阶段提前失败）
    expect(mockDb.updateTaskStatus).toHaveBeenCalledWith('task-1', 'failed', {
      error_msg: 'stop-after-submit',
    });
  });

  it('实例不存在时报错并标记任务失败，不创建客户端', async () => {
    mockDb.getTask.mockReturnValue(taskRecord());
    mockGetImpl.mockReturnValue(wf());
    mockGetInstance.mockResolvedValue(undefined);

    await runTask('task-1');

    expect(mockGetInstance).toHaveBeenCalledWith('inst-1');
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockDb.updateTaskStatus).toHaveBeenCalledWith('task-1', 'failed', {
      error_msg: '工作流 text-to-image/seedream-inst-1 绑定的服务商实例不存在: inst-1',
    });
  });

  it('未绑定服务商实例时报错并标记任务失败', async () => {
    mockDb.getTask.mockReturnValue(taskRecord());
    mockGetImpl.mockReturnValue(wf({ providerInstanceId: undefined }));

    await runTask('task-1');

    expect(mockGetInstance).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockDb.updateTaskStatus).toHaveBeenCalledWith('task-1', 'failed', {
      error_msg: '工作流 text-to-image/seedream-inst-1 未绑定服务商实例',
    });
  });
});

describe('mimeTypeForFile / toBase64Output', () => {
  it('按扩展名推断 MIME 类型，未知扩展名默认 image/jpeg', () => {
    expect(mimeTypeForFile('a.png')).toBe('image/png');
    expect(mimeTypeForFile('a.webp')).toBe('image/webp');
    expect(mimeTypeForFile('a.flac')).toBe('audio/flac');
    expect(mimeTypeForFile('a.mp4')).toBe('video/mp4');
    expect(mimeTypeForFile('a.bin')).toBe('image/jpeg');
    expect(mimeTypeForFile('a.PNG')).toBe('image/png');
  });

  it('withDataPrefix=false（默认）只返回 base64，true 时添加 data: 前缀', () => {
    expect(toBase64Output('QUJD', 'a.png', false)).toBe('QUJD');
    expect(toBase64Output('QUJD', 'a.png', true)).toBe('data:image/png;base64,QUJD');
    expect(toBase64Output('QUJD', 'a.mp4', true)).toBe('data:video/mp4;base64,QUJD');
  });
});