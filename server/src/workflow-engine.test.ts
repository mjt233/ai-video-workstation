import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mimeTypeForFile, resolvePollHeartbeatMs, runTask, toBase64Object, toBase64Output } from './workflow-engine.js';
import { taskRegistry, type TaskRecord as TaskRegistryRecord } from './tasks/registry.js';
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
  mockReadSystemSettings,
  mockReadFile,
  mockAccess,
  mockCopyFile,
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
    mockReadSystemSettings: vi.fn(),
    /** 读取 stage.json / project.json 等文本文件（用例按需覆写返回值） */
    mockReadFile: vi.fn(async () => '[]'),
    /** 存在性探测（默认视为存在） */
    mockAccess: vi.fn(async () => undefined),
    /** 资产复制（默认空实现） */
    mockCopyFile: vi.fn(async () => undefined),
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
// 系统设置：心跳间隔由测试注入（真实实现读 server/config/system.json）
vi.mock('./system/system-settings.js', () => ({
  readSystemSettings: mockReadSystemSettings,
}));
// 产物落盘路径改到临时目录：轮询降噪用例只需跑通产物写入，不触碰真实 design/
vi.mock('./assets/paths.js', () => ({
  resolveProjectAssertPath: (_project: string, rel: string) => path.join(os.tmpdir(), 'dsh-engine-test', rel),
}));
// 产物写入为纯副作用：改为空实现，避免用例在临时目录留下文件
// （readFile/access/copyFile 保留可由用例覆写的 mock：直接引用分支会读 stage.json 并复制资产）
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const mocked = {
    ...actual,
    default: {
      ...actual,
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      readFile: mockReadFile,
      access: mockAccess,
      copyFile: mockCopyFile,
    },
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    readFile: mockReadFile,
    access: mockAccess,
    copyFile: mockCopyFile,
  };
  return mocked;
});

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
  taskRegistry.clear();
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

describe('runTask 统一注册表登记（画布恢复 Loading 用）', () => {
  it('params.nodeId/canvas 随登记透传（画布加载/切换后按 项目 + 画布 scope + 节点 恢复）', async () => {
    mockDb.getTask.mockReturnValue(
      taskRecord({
        params: JSON.stringify({
          outputPath: 'assert/scene/1/1/canvas/vg/output.mp4',
          nodeId: 'vg',
          canvas: { kind: 'scene', episode: '1', shot: '1' },
        }),
      }),
    );
    mockGetImpl.mockReturnValue(wf({ submit: vi.fn().mockRejectedValue(new Error('stop')) }));
    mockGetInstance.mockResolvedValue(instance());
    mockResolveInstanceConfig.mockReturnValue({ apiKey: 'resolved-key' });

    // 登记发生在 runTask 开始处，终态 finish 会移出活跃区 → 用事件订阅捕获 begin 快照
    const begun: TaskRegistryRecord[] = [];
    const off = taskRegistry.on((e) => {
      if (e.type === 'begin') begun.push(e.task);
    });
    await runTask('task-1');
    off();

    expect(begun).toHaveLength(1);
    expect(begun[0].nodeId).toBe('vg');
    expect(begun[0].canvas).toEqual({ kind: 'scene', episode: '1', shot: '1' });
    expect(begun[0].payload?.outputPath).toBe('assert/scene/1/1/canvas/vg/output.mp4');
  });
});

describe('mimeTypeForFile / toBase64Output / toBase64Object', () => {
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

  it('toBase64Object 返回 { mimeType, data }（data 为不带 data: 前缀的纯 Base64）', () => {
    expect(toBase64Object('QUJD', 'a.png')).toEqual({ mimeType: 'image/png', data: 'QUJD' });
    expect(toBase64Object('QUJD', 'a.mp4')).toEqual({ mimeType: 'video/mp4', data: 'QUJD' });
    expect(toBase64Object('QUJD', 'a.bin')).toEqual({ mimeType: 'image/jpeg', data: 'QUJD' });
  });
});

// ── 轮询日志降噪（变化才记 + 心跳）────────────────────────────────────────────

/** 默认系统设置（心跳 60 秒） */
const defaultSettings = {
  trash: { autoClean: { enabled: true, intervalDays: 7, retentionDays: 7 }, lastRunAt: null },
  taskLog: { autoClean: { enabled: true, intervalHours: 24, retentionDays: 14 }, heartbeatSeconds: 60, lastRunAt: null },
};

/** 取所有已写入日志的 [level, message] */
const loggedEntries = (): [string, string][] =>
  mockDb.addLog.mock.calls.map((c) => [String(c[1]), String(c[2])] as [string, string]);

/** 取轮询类日志消息（进度更新 / 心跳） */
const pollMessages = (): string[] =>
  loggedEntries().map(([, m]) => m).filter((m) => m.startsWith('进度更新：') || m.startsWith('轮询中（状态未变）'));

/**
 * 把 poll 调用脚本化为「每次调用弹出队列首项，队列耗尽后重复最后一项」。
 *
 * @param results 依次返回的 poll 结果
 */
function scriptPoll(results: Array<{ status: string; progress?: number; done?: boolean; errorMessage?: string }>): void {
  let i = 0;
  mockClient.poll.mockImplementation(async () => {
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    return r;
  });
}

/**
 * 在假定时器下运行任务直至结束。
 *
 * 轮询间隔固定 2 秒，按 2 秒步进推进虚拟时间；任务结束（promise 落定）后停止推进。
 *
 * @param maxSteps 最大推进步数（防用例挂死）
 */
async function runTaskWithFakeTimers(maxSteps = 400): Promise<void> {
  vi.useFakeTimers();
  let settled = false;
  const done = runTask('task-1').finally(() => { settled = true; });
  try {
    for (let step = 0; step < maxSteps && !settled; step += 1) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    await done;
  } finally {
    vi.useRealTimers();
  }
}

describe('轮询日志降噪（变化才记 + 心跳）', () => {
  beforeEach(() => {
    mockReadSystemSettings.mockResolvedValue(defaultSettings);
    mockDb.getTask.mockReturnValue(taskRecord());
    // submit 成功返回远端任务 id（轮询循环随后由 mockClient.poll 脚本化驱动）
    mockGetImpl.mockReturnValue(wf({ submit: vi.fn(async () => ({ taskId: 'remote-1' })) }));
    mockGetInstance.mockResolvedValue(instance());
    mockResolveInstanceConfig.mockReturnValue({ apiKey: 'key' });
    mockClient.execute.mockResolvedValue({ taskId: 'remote-1' });
    mockClient.getOutput.mockResolvedValue({ type: 'body', data: 'QUJD' });
  });

  it('状态与进度始终不变：30 次轮询只写 1 条进度日志（心跳 0 = 关闭）', async () => {
    mockReadSystemSettings.mockResolvedValue({
      ...defaultSettings,
      taskLog: { ...defaultSettings.taskLog, heartbeatSeconds: 0 },
    });
    // 前 30 次 pending，第 31 次完成
    scriptPoll([
      ...Array.from({ length: 30 }, () => ({ status: 'pending', progress: 40 })),
      { status: 'completed', progress: 100, done: true },
    ]);

    await runTaskWithFakeTimers();

    const polls = pollMessages();
    expect(mockClient.poll).toHaveBeenCalledTimes(31);
    // 30 次状态不变只留 1 条（进度变化那条），无心跳
    expect(polls.filter((m) => m.startsWith('进度更新：'))).toHaveLength(2); // pending + completed
    expect(polls.filter((m) => m.startsWith('轮询中（状态未变）'))).toHaveLength(0);
  });

  it('心跳开启：状态不变时按间隔补写心跳，日志量远小于轮询次数', async () => {
    // 心跳 10 秒 = 每 5 次轮询一条
    mockReadSystemSettings.mockResolvedValue({
      ...defaultSettings,
      taskLog: { ...defaultSettings.taskLog, heartbeatSeconds: 10 },
    });
    scriptPoll([
      ...Array.from({ length: 30 }, () => ({ status: 'running', progress: 40 })),
      { status: 'completed', progress: 100, done: true },
    ]);

    await runTaskWithFakeTimers();

    const heartbeats = pollMessages().filter((m) => m.startsWith('轮询中（状态未变）'));
    // 31 次轮询：1 条进度 + 约 6 条心跳（30 秒 / 10 秒），远少于 31
    expect(heartbeats.length).toBeGreaterThanOrEqual(5);
    expect(heartbeats.length).toBeLessThanOrEqual(7);
    expect(pollMessages().length).toBeLessThan(10);
  });

  it('进度每次变化时逐条记录（无信息丢失）', async () => {
    scriptPoll([
      { status: 'running', progress: 10 },
      { status: 'running', progress: 20 },
      { status: 'running', progress: 30 },
      { status: 'completed', progress: 100, done: true },
    ]);

    await runTaskWithFakeTimers();

    expect(pollMessages()).toEqual([
      '进度更新：status=running progress=10',
      '进度更新：status=running progress=20',
      '进度更新：status=running progress=30',
      '进度更新：status=completed progress=100',
    ]);
  });

  it('终态里程碑日志保留（完成 / 解析 / 产物落盘）', async () => {
    scriptPoll([{ status: 'completed', progress: 100, done: true }]);

    await runTaskWithFakeTimers();

    const messages = loggedEntries().map(([, m]) => m);
    expect(messages).toContain('Polling task status...');
    expect(messages).toContain('Task completed with status: completed');
    expect(messages).toContain('Parsing output...');
    expect(messages).toContain('Decoding base64 output body');
    expect(messages).toContain('Output written to: assert/test.png');
  });

  it('被中断（cancelRequested）时写入失败里程碑而非静默', async () => {
    scriptPoll([{ status: 'completed', progress: 100, done: true }]);
    mockDb.getTask.mockReturnValue(
      taskRecord({ params: JSON.stringify({ outputPath: 'assert/test.png', cancelRequested: true }) }),
    );

    await runTaskWithFakeTimers();

    expect(mockDb.updateTaskStatus).toHaveBeenCalledWith('task-1', 'failed', { error_msg: '用户中断' });
    expect(loggedEntries().map(([, m]) => m)).toContain('Task failed: 用户中断');
  });

  it('远端失败：错误详情写入 error 日志', async () => {
    scriptPoll([{ status: 'failed', progress: 0, done: true, errorMessage: '敏感内容拦截' }]);

    await runTaskWithFakeTimers();

    expect(loggedEntries()).toContainEqual(['error', 'Task failed: 敏感内容拦截']);
  });
});

describe('画布节点任务登记（注册表生命周期）', () => {
  it('失败路径收敛注册表：终态后不再留在活跃区', async () => {
    mockReadSystemSettings.mockResolvedValue(defaultSettings);
    mockDb.getTask.mockReturnValue(
      taskRecord({ params: JSON.stringify({ outputPath: 'assert/x.png', nodeId: 'node-a' }) }),
    );
    mockGetImpl.mockReturnValue(wf({ submit: vi.fn().mockRejectedValue(new Error('submit 失败')) }));
    mockGetInstance.mockResolvedValue(instance());
    mockResolveInstanceConfig.mockReturnValue({ apiKey: 'key' });

    await runTask('task-1');

    // 失败也必须移出活跃区，否则任务管理器会一直显示"运行中"
    expect(taskRegistry.listActive().find((t) => t.id === 'task-1')).toBeUndefined();
  });

  it('「直接引用基础场景」分支（提前 return）同样收敛注册表', async () => {
    // 该分支不调用 provider，走「复制基础场景图」短路路径；若不收敛注册表，
    // 任务会永久留在活跃区并让同节点后续任务被 NODE_BUSY 拒绝
    mockReadSystemSettings.mockResolvedValue(defaultSettings);
    mockDb.getTask.mockReturnValue(
      taskRecord({
        workflow_id: 'image-edit',
        params: JSON.stringify({
          outputPath: 'assert/scene/1/2/stage/0.png',
          vars: { purpose: 'scene-stage-image', episode: '1', shot: '2', index: '0' },
          nodeId: 'node-stage',
        }),
      }),
    );
    // image-edit 的直接引用分支在 provider 解析之前执行，因此实现可以取不到实例
    mockGetImpl.mockReturnValue(wf({ type: 'image-edit', submit: vi.fn() }));
    mockGetInstance.mockResolvedValue(instance());
    mockResolveInstanceConfig.mockReturnValue({ apiKey: 'key' });
    // stage.json：登场角色与 prompt 均为空 + 基础场景=基础/正面 → 命中直接引用
    mockReadFile.mockResolvedValue(JSON.stringify([{ 基础场景: '基础/正面', 登场角色: [], prompt: '' }]));
    mockAccess.mockResolvedValue(undefined);
    mockCopyFile.mockResolvedValue(undefined);

    await runTask('task-1');

    // 产物落盘 + 任务完成 + **注册表收敛**
    expect(mockDb.updateTaskStatus).toHaveBeenCalledWith('task-1', 'completed', {
      result: { path: 'assert/scene/1/2/stage/0.png', directReference: true, prevReference: false },
    });
    expect(taskRegistry.listActive().find((t) => t.id === 'task-1')).toBeUndefined();
  });
});

describe('resolvePollHeartbeatMs', () => {  it('读取系统设置并换算为毫秒', async () => {
    mockReadSystemSettings.mockResolvedValue(defaultSettings);
    await expect(resolvePollHeartbeatMs()).resolves.toBe(60_000);
  });

  it('heartbeatSeconds=0 返回 0（不写心跳）', async () => {
    mockReadSystemSettings.mockResolvedValue({
      ...defaultSettings,
      taskLog: { ...defaultSettings.taskLog, heartbeatSeconds: 0 },
    });
    await expect(resolvePollHeartbeatMs()).resolves.toBe(0);
  });

  it('读取失败时回退默认 60 秒且不抛错', async () => {
    mockReadSystemSettings.mockRejectedValue(new Error('配置读取失败'));
    await expect(resolvePollHeartbeatMs()).resolves.toBe(60_000);
  });
});