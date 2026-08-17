import { describe, expect, it, vi, beforeEach } from 'vitest';
import { syncAllInstances } from './instance-sync.js';
import { getImplementations, register } from '../workflows/registry.js';
import type { WorkflowDefinition } from '../workflows/types.js';

vi.mock('./config-store.js', () => ({
  listInstances: vi.fn(async () => [
    { id: 'inst-1', type: 'volcengine-ark', name: '方舟A', config: {} },
    { id: 'inst-2', type: 'volcengine-ark', name: '方舟B', config: {} },
  ]),
}));

vi.mock('./registry.js', () => ({
  getProvider: vi.fn(() => ({ id: 'volcengine-ark', createClient: () => ({}), listWorkflows: async () => [], testConnection: async () => ({ ok: true, message: '' }) })),
}));

const mkCandidate = (type: string, impl: string): WorkflowDefinition =>
  ({ type, impl, name: impl, provider: 'volcengine-ark', submit: async () => ({ taskId: 't' }) } as WorkflowDefinition);

beforeEach(() => {
  register(mkCandidate('text-to-image', 'seedream'));
  register(mkCandidate('image-edit', 'seedream'));
});

describe('instance-sync', () => {
  it('默认全量可用：每个实例注册类型下全部候选工作流，impl 带实例前缀', async () => {
    await syncAllInstances();
    const impls = getImplementations('text-to-image');
    // 两个实例都注册各自的 text-to-image 实现（不再有启用过滤）
    expect(impls).toHaveLength(2);
    const inst1 = impls.find((i) => i.providerInstanceId === 'inst-1');
    expect(inst1?.impl).toBe('seedream-inst-1');
    expect(inst1?.providerName).toBe('方舟A');
  });

  it('注册全部候选：两个实例都注册 image-edit 实现', async () => {
    await syncAllInstances();
    const impls = getImplementations('image-edit');
    expect(impls).toHaveLength(2);
    expect(impls.map((i) => i.providerInstanceId).sort()).toEqual(['inst-1', 'inst-2']);
  });
});