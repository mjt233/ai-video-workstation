import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  MASKED_SECRET,
  getProviderConfig,
  getProviderConfigMasked,
  resolveProviderConfig,
  setProviderConfig,
} from './config-store.js';
import { getProvider, registerProvider } from './registry.js';
import type { ProviderDefinition } from './types.js';

/**
 * 测试用 provider：覆盖 string（envVar 兜底）/ password(secret) / number / boolean 四类字段。
 */
const mkTestProvider = (id: string): ProviderDefinition => ({
  id,
  name: `test-${id}`,
  configSchema: [
    { key: 'baseUrl', label: '服务地址', type: 'string', defaultValue: 'http://default:1', envVar: 'TEST_BRIDGE_URL' },
    { key: 'apiKey', label: 'API Key', type: 'password', secret: true },
    { key: 'retries', label: '重试次数', type: 'number', defaultValue: 3 },
    { key: 'flag', label: '开关', type: 'boolean', defaultValue: false },
  ],
  createClient: () => {
    throw new Error('not used in config-store test');
  },
});

describe('config-store', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'providers-'));
    configPath = path.join(tmpDir, 'providers.json');
    registerProvider(mkTestProvider('test-store'));
    delete process.env.TEST_BRIDGE_URL;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    delete process.env.TEST_BRIDGE_URL;
  });

  it('resolveProviderConfig 无文件无环境变量时合并 defaultValue', () => {
    const p = getProvider('test-store')!;
    expect(resolveProviderConfig(p.configSchema, undefined)).toEqual({
      baseUrl: 'http://default:1',
      retries: 3,
      flag: false,
    });
  });

  it('环境变量优先于 defaultValue', () => {
    process.env.TEST_BRIDGE_URL = 'http://env:2';
    const p = getProvider('test-store')!;
    expect(resolveProviderConfig(p.configSchema, undefined).baseUrl).toBe('http://env:2');
  });

  it('文件值优先于环境变量', () => {
    process.env.TEST_BRIDGE_URL = 'http://env:2';
    const p = getProvider('test-store')!;
    expect(resolveProviderConfig(p.configSchema, { baseUrl: 'http://file:3' }).baseUrl).toBe('http://file:3');
  });

  it('setProviderConfig 落盘并可读取（数字/布尔字符串强转）', async () => {
    await setProviderConfig('test-store', { baseUrl: 'http://file:3', retries: '5', flag: 'true' }, configPath);
    const config = await getProviderConfig('test-store', configPath);
    expect(config.baseUrl).toBe('http://file:3');
    expect(config.retries).toBe(5);
    expect(config.flag).toBe(true);
  });

  it('secret 字段在 getProviderConfigMasked 中脱敏为 MASKED_SECRET', async () => {
    await setProviderConfig('test-store', { apiKey: 'sk-secret' }, configPath);
    const masked = await getProviderConfigMasked('test-store', configPath);
    expect(masked.apiKey).toBe(MASKED_SECRET);
  });

  it('secret 传空串时保留原值', async () => {
    await setProviderConfig('test-store', { apiKey: 'sk-original' }, configPath);
    await setProviderConfig('test-store', { apiKey: '' }, configPath);
    const masked = await getProviderConfigMasked('test-store', configPath);
    expect(masked.apiKey).toBe(MASKED_SECRET);
  });

  it('未知键被忽略', async () => {
    await setProviderConfig('test-store', { unknownKey: 1, baseUrl: 'http://file:3' }, configPath);
    const config = await getProviderConfig('test-store', configPath);
    expect(config).not.toHaveProperty('unknownKey');
    expect(config.baseUrl).toBe('http://file:3');
  });

  it('number 字段非法值抛错', async () => {
    await expect(setProviderConfig('test-store', { retries: 'abc' }, configPath)).rejects.toThrow('需要数字');
  });

  it('必填字段缺失且无任何兜底时报错', async () => {
    // apiKey 无 defaultValue/envVar，标记为 required 后必须显式提供
    registerProvider({
      ...mkTestProvider('test-store-required'),
      configSchema: [
        { key: 'apiKey', label: 'API Key', type: 'password', secret: true, required: true },
      ],
    });
    await expect(
      setProviderConfig('test-store-required', { baseUrl: 'http://x' }, configPath),
    ).rejects.toThrow('必填');
  });

  it('secret 提交 MASKED_SECRET 占位符时保留原值（防回写）', async () => {
    await setProviderConfig('test-store', { apiKey: 'sk-original' }, configPath);
    await setProviderConfig('test-store', { apiKey: MASKED_SECRET }, configPath);
    // 未脱敏读取：真实值仍是 sk-original，而不是被 '__set__' 覆盖
    const config = await getProviderConfig('test-store', configPath);
    expect(config.apiKey).toBe('sk-original');
  });

  it('配置文件损坏（非法 JSON）时 setProviderConfig 抛错而非覆盖', async () => {
    await fs.writeFile(configPath, '{ 这不是合法 JSON', 'utf-8');
    await expect(
      setProviderConfig('test-store', { baseUrl: 'http://x' }, configPath),
    ).rejects.toThrow();
    // 损坏文件未被覆盖
    const raw = await fs.readFile(configPath, 'utf-8');
    expect(raw).toBe('{ 这不是合法 JSON');
  });

  it('配置文件不存在时 setProviderConfig 正常创建（ENOENT 不算损坏）', async () => {
    await setProviderConfig('test-store', { baseUrl: 'http://fresh' }, configPath);
    const config = await getProviderConfig('test-store', configPath);
    expect(config.baseUrl).toBe('http://fresh');
  });
});
