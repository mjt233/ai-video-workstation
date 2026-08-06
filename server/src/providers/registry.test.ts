import { describe, expect, it } from 'vitest';
import { getAllProviders, getProvider, registerProvider } from './registry.js';
import type { ProviderDefinition } from './types.js';

/** 构造测试用 provider 定义（configSchema 为空、createClient 抛错不会被调用） */
const mkProvider = (id: string): ProviderDefinition => ({
  id,
  name: `provider-${id}`,
  configSchema: [],
  createClient: () => {
    throw new Error('not used in registry test');
  },
});

describe('provider registry', () => {
  it('registerProvider 后 getProvider 可查到', () => {
    registerProvider(mkProvider('test-reg-a'));
    expect(getProvider('test-reg-a')).toBeDefined();
  });

  it('getAllProviders 返回全部已注册 provider', () => {
    registerProvider(mkProvider('test-reg-b'));
    const ids = getAllProviders().map((p) => p.id);
    expect(ids).toContain('test-reg-b');
    expect(ids).toContain('test-reg-a');
  });

  it('未注册的 provider 返回 undefined', () => {
    expect(getProvider('no-such-provider')).toBeUndefined();
  });
});
