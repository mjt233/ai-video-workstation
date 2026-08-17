import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createInstance, deleteInstance, getInstance, getInstanceConfigMasked, listInstances,
  migrateLegacyConfig, resolveInstanceConfig, updateInstance,
} from './config-store.js';
import { registerProvider } from './registry.js';
import type { ProviderDefinition } from './types.js';

const mkTestProvider = (id: string): ProviderDefinition => ({
  id,
  name: id,
  configSchema: [
    { key: 'url', label: '地址', type: 'string', required: true },
    { key: 'key', label: '密钥', type: 'password', secret: true },
    { key: 'timeout', label: '超时', type: 'number', defaultValue: 10 },
  ],
  createClient: () => ({ execute: async () => ({ taskId: 't' }), poll: async () => ({ status: 'done', done: true }), getOutput: async () => null, cancel: async () => {} }),
  listWorkflows: async () => [],
  testConnection: async () => ({ ok: true, message: 'ok' }),
});

let tmpDir: string;
let configPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'providers-'));
  configPath = path.join(tmpDir, 'providers.json');
  registerProvider(mkTestProvider('test-store'));
});

describe('config-store 实例 CRUD', () => {
  it('创建实例并读取', async () => {
    const inst = await createInstance({ type: 'test-store', name: '实例A', config: { url: 'http://a', key: 'secret' } }, configPath);
    expect(inst.id).toBeTruthy();
    expect(inst.enabledWorkflows).toEqual([]);
    const list = await listInstances(configPath);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('实例A');
  });

  it('secret 字段保存后读取脱敏为空串', async () => {
    const inst = await createInstance({ type: 'test-store', name: 'A', config: { url: 'http://a', key: 'secret' } }, configPath);
    const updated = await updateInstance(inst.id, { config: { url: 'http://b' } }, configPath);
    expect(updated.config.key).toBe('secret'); // 未在更新中 → 保留原值
    const masked = getInstanceConfigMasked(updated);
    expect(masked.key).toBe(''); // 脱敏读取为空串
    const resolved = resolveInstanceConfig(updated);
    expect(resolved.key).toBe('secret'); // 解析时用原值
  });

  it('删除实例', async () => {
    const inst = await createInstance({ type: 'test-store', name: 'A', config: { url: 'http://a' } }, configPath);
    await deleteInstance(inst.id, configPath);
    expect(await getInstance(inst.id, configPath)).toBeUndefined();
  });

  it('必填字段缺失时报错', async () => {
    await expect(createInstance({ type: 'test-store', name: 'A', config: {} }, configPath)).rejects.toThrow('必填');
  });
});

describe('config-store 迁移', () => {
  it('旧格式（按类型一份）迁移为实例数组', async () => {
    const legacy = { 'test-store': { url: 'http://old', key: 'oldkey' } };
    await import('fs/promises').then((fs) => fs.writeFile(configPath, JSON.stringify(legacy), 'utf-8'));
    const migrated = await migrateLegacyConfig(configPath);
    expect(migrated).toBe(true);
    const list = await listInstances(configPath);
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('test-store');
    expect(list[0].name).toContain('默认');
    expect(list[0].config.url).toBe('http://old');
  });

  it('已是新格式则跳过', async () => {
    await createInstance({ type: 'test-store', name: 'A', config: { url: 'http://a' } }, configPath);
    const migrated = await migrateLegacyConfig(configPath);
    expect(migrated).toBe(false);
    expect(await listInstances(configPath)).toHaveLength(1);
  });
});
