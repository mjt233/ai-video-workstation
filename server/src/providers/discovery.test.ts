import { describe, expect, it } from 'vitest';
import { discoverProviders } from './index.js';
import { getProvider } from './registry.js';

describe('discoverProviders', () => {
  it('扫描 providers/ 目录并注册 comfyui-bridge 插件', async () => {
    await discoverProviders();
    expect(getProvider('comfyui-bridge')).toBeDefined();
    expect(getProvider('openai-compatible')).toBeDefined();
  });
});
