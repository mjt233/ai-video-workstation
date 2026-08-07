import { describe, expect, it, beforeEach } from 'vitest';
import { register, unregister, getImpl, getImplementations, getAllWorkflowTypes } from './registry.js';
import type { WorkflowDefinition } from './types.js';

const mk = (type: string, impl: string): WorkflowDefinition => ({
  type, impl, name: impl,
  provider: 'test-provider',
  submit: async () => ({ taskId: 't' }),
});

describe('registry unregister', () => {
  beforeEach(() => {
    // 清理测试类型（避免污染其它测试）
    for (const t of getAllWorkflowTypes()) {
      for (const w of getImplementations(t)) unregister(t, w.impl);
    }
  });

  it('unregister 删除指定实现', () => {
    register(mk('test-unreg', 'a'));
    register(mk('test-unreg', 'b'));
    unregister('test-unreg', 'a');
    expect(getImpl('test-unreg', 'a')).toBeUndefined();
    expect(getImpl('test-unreg', 'b')).toBeDefined();
  });

  it('删除最后一个实现后移除该类型', () => {
    register(mk('test-unreg', 'a'));
    unregister('test-unreg', 'a');
    expect(getAllWorkflowTypes()).not.toContain('test-unreg');
  });

  it('unregister 不存在的实现不抛错', () => {
    unregister('test-unreg', 'nope');
    expect(getAllWorkflowTypes()).not.toContain('test-unreg');
  });
});
