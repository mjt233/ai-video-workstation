import { describe, expect, it, beforeEach } from 'vitest';
import { getAllWorkflowTypes, getAllWorkflows, getCandidatesByProvider, getImplementations, normalizeWorkflowTypeList, register, registerOrReplace, unregisterByInstance } from './registry.js';
import { SUPPORTED_WORKFLOW_TYPES, type WorkflowDefinition } from './types.js';

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

describe('normalizeWorkflowTypeList（/api/workflow-types 的类型清单）', () => {
  it('尚未注册任何实现的类型也出现在清单里（首次配置可选项）', () => {
    // 注册表为空（全新系统：一个工作流都没配置）
    const types = normalizeWorkflowTypeList(SUPPORTED_WORKFLOW_TYPES, []);
    expect(types).toEqual([...SUPPORTED_WORKFLOW_TYPES]);
    // 「文本生成」必须在列（否则自定义服务商表单选不到它 → 永远注册不上）
    expect(types).toContain('text-generation');
  });

  it('按内置清单顺序稳定输出，且与注册表键去重', () => {
    const types = normalizeWorkflowTypeList(
      ['a', 'b', 'c'],
      ['c', 'a'],
    );
    expect(types).toEqual(['a', 'b', 'c']);
  });

  it('注册表里不在内置清单中的动态类型追加在末尾（不丢）', () => {
    const types = normalizeWorkflowTypeList(['a', 'b'], ['b', 'zzz', 'aaa']);
    expect(types).toEqual(['a', 'b', 'zzz', 'aaa']);
  });

  it('真实注册表：当前已注册类型是支持清单的子集（两者不漂移）', () => {
    const registered = getAllWorkflowTypes();
    const types = normalizeWorkflowTypeList(SUPPORTED_WORKFLOW_TYPES, registered);
    for (const t of registered) expect(types).toContain(t);
    expect(types.length).toBeGreaterThanOrEqual(SUPPORTED_WORKFLOW_TYPES.length);
  });
});
