import { describe, expect, it, vi, beforeEach } from 'vitest';
import { syncAllInstances } from './instance-sync.js';
import { getImplementations, register } from '../workflows/registry.js';
import type { WorkflowDefinition } from '../workflows/types.js';

/** updateInstance 的 mock 实现（vi.hoisted 供 vi.mock 工厂引用）：记录持久化的 enabledWorkflows 调用 */
const { updateInstanceMock } = vi.hoisted(() => ({
  updateInstanceMock: vi.fn(async () => ({ id: '', type: '', name: '', config: {}, enabledWorkflows: [] })),
}));

vi.mock('./config-store.js', () => ({
  listInstances: vi.fn(async () => [
    { id: 'inst-1', type: 'volcengine-ark', name: '方舟A', config: {}, enabledWorkflows: ['text-to-image:seedream'] },
    { id: 'inst-2', type: 'volcengine-ark', name: '方舟B', config: {}, enabledWorkflows: [] },
  ]),
  updateInstance: updateInstanceMock,
}));

vi.mock('./registry.js', () => ({
  getProvider: vi.fn(() => ({ id: 'volcengine-ark', createClient: () => ({}), listWorkflows: async () => [], testConnection: async () => ({ ok: true, message: '' }) })),
}));

const mkCandidate = (type: string, impl: string): WorkflowDefinition =>
  ({ type, impl, name: impl, provider: 'volcengine-ark', submit: async () => ({ taskId: 't' }) } as WorkflowDefinition);

beforeEach(() => {
  updateInstanceMock.mockClear();
  register(mkCandidate('text-to-image', 'seedream'));
  register(mkCandidate('image-edit', 'seedream'));
});

describe('instance-sync', () => {
  it('按 enabledWorkflows 注册实例工作流，impl 带实例前缀', async () => {
    await syncAllInstances();
    const impls = getImplementations('text-to-image');
    // inst-1 显式启用 text-to-image:seedream；inst-2 空列表 = 全选（也启用 text-to-image:seedream）
    expect(impls).toHaveLength(2);
    const inst1 = impls.find((i) => i.providerInstanceId === 'inst-1');
    expect(inst1?.impl).toBe('seedream-inst-1');
    expect(inst1?.providerName).toBe('方舟A');
  });

  it('空启用集合 = 默认全选：注册全部候选并持久化为显式列表', async () => {
    await syncAllInstances();
    // inst-2 空列表 → 全选：image-edit 也应注册 inst-2 的实现
    const impls = getImplementations('image-edit');
    expect(impls).toHaveLength(1);
    expect(impls[0].providerInstanceId).toBe('inst-2');
    // 展开后的列表持久化回实例
    expect(updateInstanceMock).toHaveBeenCalledWith('inst-2', {
      enabledWorkflows: ['text-to-image:seedream', 'image-edit:seedream'],
    });
  });

  it('显式禁用的工作流不注册（inst-1 未启用 image-edit）', async () => {
    await syncAllInstances();
    // inst-1 显式列表不含 image-edit；inst-2 空列表全选会注册 inst-2 的实现
    const impls = getImplementations('image-edit');
    expect(impls).toHaveLength(1);
    expect(impls[0].providerInstanceId).toBe('inst-2');
  });
});