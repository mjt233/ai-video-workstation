import { describe, expect, it, beforeEach } from 'vitest';
import { getAllWorkflows, getCandidatesByProvider, getImplementations, register, registerOrReplace, unregisterByInstance } from './registry.js';
import type { WorkflowDefinition } from './types.js';

const mk = (type: string, impl: string, provider?: string, instanceId?: string): WorkflowDefinition =>
  ({ type, impl, name: impl, provider, providerInstanceId: instanceId, submit: async () => ({ taskId: 't' }) } as WorkflowDefinition);

beforeEach(() => {
  for (const t of ['test-reg', 'test-reg2']) {
    for (const w of getImplementations(t)) unregisterByInstance(w.providerInstanceId ?? '', new Set());
  }
});

describe('候选定义与实例定义', () => {
  it('无实例的注册为候选，不进入可执行列表', () => {
    register(mk('test-reg', 'seedream', 'volcengine-ark'));
    expect(getImplementations('test-reg')).toHaveLength(0);
    expect(getCandidatesByProvider('volcengine-ark')).toHaveLength(1);
  });

  it('带实例的注册进入可执行列表，impl 唯一', () => {
    register(mk('test-reg', 'seedream-inst-1', 'volcengine-ark', 'inst-1'));
    register(mk('test-reg', 'seedream-inst-2', 'volcengine-ark', 'inst-2'));
    const impls = getImplementations('test-reg');
    expect(impls).toHaveLength(2);
    expect(new Set(impls.map((i) => i.impl)).size).toBe(2);
  });

  it('registerOrReplace 替换同 impl 不重复', () => {
    registerOrReplace(mk('test-reg', 'seedream-inst-1', 'volcengine-ark', 'inst-1'));
    registerOrReplace(mk('test-reg', 'seedream-inst-1', 'volcengine-ark', 'inst-1'));
    expect(getImplementations('test-reg')).toHaveLength(1);
  });

  it('unregisterByInstance 注销该实例全部工作流', () => {
    register(mk('test-reg', 'seedream-inst-1', 'volcengine-ark', 'inst-1'));
    register(mk('test-reg2', 'other-inst-1', 'volcengine-ark', 'inst-1'));
    register(mk('test-reg', 'seedream-inst-2', 'volcengine-ark', 'inst-2'));
    unregisterByInstance('inst-1', new Set());
    expect(getImplementations('test-reg')).toHaveLength(1);
    expect(getImplementations('test-reg')[0].impl).toBe('seedream-inst-2');
  });

  it('getAllWorkflows 仅返回可执行定义并携带 providerName', () => {
    register(mk('test-reg', 'seedream-inst-1', 'volcengine-ark', 'inst-1'));
    register(mk('test-reg', 'seedream', 'volcengine-ark'));
    const all = getAllWorkflows();
    const impls = all.find((t) => t.type === 'test-reg')!.implementations;
    expect(impls).toHaveLength(1);
    expect(impls[0].providerInstanceId).toBe('inst-1');
  });
});
