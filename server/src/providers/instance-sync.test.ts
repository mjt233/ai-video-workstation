import { describe, expect, it, vi, beforeEach } from 'vitest';
import { syncAllInstances } from './instance-sync.js';
import { getImplementations, register } from '../workflows/registry.js';
import type { WorkflowDefinition } from '../workflows/types.js';

vi.mock('./config-store.js', () => ({
  listInstances: vi.fn(async () => [
    { id: 'inst-1', type: 'volcengine-ark', name: '方舟A', config: {}, enabledWorkflows: ['text-to-image:seedream'] },
    { id: 'inst-2', type: 'volcengine-ark', name: '方舟B', config: {}, enabledWorkflows: [] },
  ]),
  resolveInstanceConfig: vi.fn(() => ({})),
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
  it('按 enabledWorkflows 注册实例工作流，impl 带实例前缀', async () => {
    await syncAllInstances();
    const impls = getImplementations('text-to-image');
    expect(impls).toHaveLength(1);
    expect(impls[0].impl).toBe('seedream-inst-1');
    expect(impls[0].providerInstanceId).toBe('inst-1');
    expect(impls[0].providerName).toBe('方舟A');
  });

  it('未启用的工作流不注册', async () => {
    await syncAllInstances();
    expect(getImplementations('image-edit')).toHaveLength(0);
  });
});