import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getImpl, getImplementations, unregister, register } from './registry.js';
import { syncBridgeWorkflows, buildSubmit } from './bridge-sync.js';
import type { BridgeWorkflowDetail } from '../providers/comfyui-bridge/client.js';
import type { WorkflowDefinition } from './types.js';

// ── mock getProviderConfig / getProvider（避免真实配置与网络） ──
// 注意：vi.mock 工厂被 hoist 到顶部，mock 客户端必须用 vi.hoisted 定义
const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    listWorkflows: vi.fn(),
    getWorkflowDetail: vi.fn(),
  },
}));

vi.mock('../providers/config-store.js', () => ({
  getProviderConfig: vi.fn(async () => ({ baseUrl: 'http://b', password: 'pw', autoRegisterTag: 'auto' })),
}));
vi.mock('../providers/registry.js', () => ({
  getProvider: vi.fn(() => ({ id: 'comfyui-bridge', createClient: () => mockClient })),
}));

const detail = (over: Partial<BridgeWorkflowDetail> = {}): BridgeWorkflowDetail => ({
  id: 'text_to_image', name: '文生图', description: '', declaredParams: [], tags: [{ id: 'text-to-image', metadata: {}, tags: [] }], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // 清空动态注册（测试隔离）
  for (const t of ['text-to-image', 'image-edit', 'tts-voice-design', 'image-to-video']) {
    for (const w of getImplementations(t)) unregister(t, w.impl);
  }
});

describe('syncBridgeWorkflows', () => {
  it('带标签时拉取列表并逐个拉详情注册（impl=ceb-{id}）', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'text_to_image', name: '文生图', declaredParams: '[]', tags: [{ id: 'text-to-image', metadata: {}, tags: [] }] }]);
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockResolvedValue(detail());
    await syncBridgeWorkflows();
    expect(mockClient.listWorkflows).toHaveBeenCalledWith('auto');
    const w = getImpl('text-to-image', 'ceb-text_to_image');
    expect(w).toBeDefined();
    expect(w!.name).toBe('文生图');
    expect(w!.provider).toBe('comfyui-bridge');
  });

  it('未知类型工作流跳过且不注册', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'tv', name: '文生视频', declaredParams: '[]', tags: [{ id: 'text-to-video', metadata: {}, tags: [] }] }]);
    await syncBridgeWorkflows();
    expect(getImpl('text-to-video', 'ceb-tv')).toBeUndefined();
  });

  it('拉取失败时保留既有注册', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unreachable'));
    register({ type: 'text-to-image', impl: 'ceb-keep', name: 'keep', provider: 'comfyui-bridge', submit: async () => ({ taskId: 't' }) } as WorkflowDefinition);
    await expect(syncBridgeWorkflows()).resolves.toBeUndefined();
    expect(getImpl('text-to-image', 'ceb-keep')).toBeDefined();
  });
});

describe('buildSubmit（text-to-image）', () => {
  it('读取 promptPath 并执行 execute（workflowId 透传）', async () => {
    const execute = vi.fn(async () => ({ taskId: 't1' }));
    const submit = buildSubmit('ceb-text_to_image', 'text-to-image', { cancelable: true });
    const ctx = {
      vars: { promptPath: 'p.md' },
      projectConfig: { width: 1080, height: 1920 },
      readFile: async () => '一只猫',
      provider: { execute },
    } as never;
    await submit(ctx as never);
    expect(execute).toHaveBeenCalledWith({
      workflowId: 'ceb-text_to_image',
      params: expect.objectContaining({ prompt: '一只猫', width: 1080, height: 1920 }),
    });
  });
});
