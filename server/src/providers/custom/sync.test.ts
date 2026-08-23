import { afterEach, describe, expect, it, vi } from 'vitest';
// 导入 index.ts 以注册 custom provider（syncCustomInstance → resolveInstanceConfig 需要）
import './index.js';
import { syncCustomInstance } from './sync.js';
import { getImpl, unregisterByInstance } from '../../workflows/registry.js';
import type { ProviderConfigValue, ProviderInstance } from '../types.js';
import type { CustomProviderClient } from './client.js';

const INSTANCE_ID = 'inst-test-1';

/** 构造测试实例 */
function makeInstance(workflows: unknown): ProviderInstance {
  return {
    id: INSTANCE_ID,
    type: 'custom',
    name: '自定义-测试',
    config: { baseUrl: 'https://example.com', apiKey: 'sk-x', timeout: 60, workflows } as unknown as Record<string, ProviderConfigValue>,
  };
}

/** 构造最小可注册条目 */
function entry(name: string, types: string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    types,
    async: false,
    cancelable: false,
    callCode: 'export default async function(ctx: any) { return { url: ctx.providerConfig.baseUrl + "/run" } }',
    extractCode: 'export default async function(ctx: any, r: any) { return { isFinish: true, outputs: [r.data.url] } }',
    cancelCode: '',
    ...extra,
  };
}

afterEach(() => {
  unregisterByInstance(INSTANCE_ID, new Set());
});

describe('syncCustomInstance', () => {
  it('按条目×类型注册可执行工作流', async () => {
    await syncCustomInstance(makeInstance([entry('wf-a', ['text-to-image', 'image-edit'])]));
    const t2i = getImpl('text-to-image', 'custom-wf-a-' + INSTANCE_ID);
    expect(t2i).toBeDefined();
    expect(t2i?.provider).toBe('custom');
    expect(t2i?.providerInstanceId).toBe(INSTANCE_ID);
    expect(t2i?.capabilities?.cancelable).toBe(false);
    expect(getImpl('image-edit', 'custom-wf-a-' + INSTANCE_ID)).toBeDefined();
  });

  it('cancelable 能力按条目透传', async () => {
    await syncCustomInstance(makeInstance([entry('wf-c', ['text-to-image'], { cancelable: true, cancelCode: 'export default async function() {}' })]));
    const impl = getImpl('text-to-image', 'custom-wf-c-' + INSTANCE_ID);
    expect(impl?.capabilities?.cancelable).toBe(true);
  });

  it('重同步清理已删除的工作流', async () => {
    await syncCustomInstance(makeInstance([entry('wf-a', ['text-to-image']), entry('wf-b', ['text-to-image'])]));
    expect(getImpl('text-to-image', 'custom-wf-b-' + INSTANCE_ID)).toBeDefined();
    await syncCustomInstance(makeInstance([entry('wf-a', ['text-to-image'])]));
    expect(getImpl('text-to-image', 'custom-wf-a-' + INSTANCE_ID)).toBeDefined();
    expect(getImpl('text-to-image', 'custom-wf-b-' + INSTANCE_ID)).toBeUndefined();
  });

  it('submit 按类型组装 ctx.params 并交给客户端 execute', async () => {
    await syncCustomInstance(makeInstance([entry('wf-t2i', ['text-to-image'])]));
    const impl = getImpl('text-to-image', 'custom-wf-t2i-' + INSTANCE_ID);
    expect(impl).toBeDefined();
    const execute = vi.fn(async (_p: { workflowId: string; params?: Record<string, unknown> }) => ({ taskId: 'task-1' }));
    const fakeProvider = { execute } as unknown as CustomProviderClient;
    const ctx = {
      vars: { promptPath: 'prompt/character/陈书文/appearance.md', seed: '42', width: '512' },
      projectConfig: { width: 1080, height: 1920, fps: 24 },
      readFile: async (p: string) => '提示词:' + p,
      readAssertFile: async () => new File([], 'x.png'),
      provider: fakeProvider,
    } as never;
    const result = await impl!.submit(ctx);
    expect(result).toEqual({ taskId: 'task-1' });
    expect(execute).toHaveBeenCalledTimes(1);
    const arg = execute.mock.calls[0][0];
    expect(arg.workflowId).toBe('wf-t2i');
    expect(arg.params?.prompt).toBe('提示词:prompt/character/陈书文/appearance.md');
    expect(arg.params?.width).toBe(512);
    expect(arg.params?.seed).toBe('42');
  });

  it('image-edit 的 imagePaths 非法时报错', async () => {
    await syncCustomInstance(makeInstance([entry('wf-edit', ['image-edit'])]));
    const impl = getImpl('image-edit', 'custom-wf-edit-' + INSTANCE_ID);
    const ctx = {
      vars: { prompt: '编辑', imagePaths: 'not-json' },
      projectConfig: {},
      readFile: async () => '',
      readAssertFile: async () => new File([], 'x.png'),
      provider: { execute: async () => ({ taskId: 't' }) },
    } as never;
    await expect(impl!.submit(ctx)).rejects.toThrow(/imagePaths/);
  });

  it('未配置工作流的实例同步后无实现', async () => {
    await syncCustomInstance(makeInstance([]));
    expect(getImpl('text-to-image', 'custom-x-' + INSTANCE_ID)).toBeUndefined();
  });
});
