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

  it('用户配置字段注册为 params 声明（前端运行表单数据源）', async () => {
    await syncCustomInstance(makeInstance([entry('wf-uc', ['text-to-image'], {
      userConfigFields: [
        { key: 'model', name: '模型名称', type: 'string', defaultValue: 'gpt-image-2', description: '选择模型' },
        { key: 'steps', name: '步数', type: 'integer', defaultValue: '20' },
        { key: 'enhance', name: '增强', type: 'boolean', defaultValue: 'false' },
      ],
    })]));
    const impl = getImpl('text-to-image', 'custom-wf-uc-' + INSTANCE_ID);
    expect(impl?.params).toEqual([
      { name: '模型名称', key: 'model', type: 'string', defaultValue: 'gpt-image-2', description: '选择模型' },
      { name: '步数', key: 'steps', type: 'integer', defaultValue: 20 },
      { name: '增强', key: 'enhance', type: 'boolean', defaultValue: false },
    ]);
  });

  it('下拉字段注册为 params 声明（candidates/multiple/allowCustom 映射）', async () => {
    await syncCustomInstance(makeInstance([entry('wf-cand', ['text-to-image'], {
      userConfigFields: [
        {
          key: 'style',
          name: '画风',
          type: 'string',
          defaultValue: 'realism,anime',
          options: [
            { label: '写实风格', value: 'realism' },
            { label: '动漫风格', value: 'anime' },
          ],
          multiple: true,
        },
        {
          key: 'mode',
          name: '模式',
          type: 'string',
          defaultValue: 'fast',
          options: [{ label: '快速', value: 'fast' }],
          allowCustom: false, // 严格下拉
        },
        { key: 'plain', name: '普通字段', type: 'string', defaultValue: '', multiple: true }, // 无候选项 → 不携带下拉字段
      ],
    })]));
    const impl = getImpl('text-to-image', 'custom-wf-cand-' + INSTANCE_ID);
    expect(impl?.params).toEqual([
      {
        name: '画风',
        key: 'style',
        type: 'string',
        defaultValue: 'realism,anime',
        candidates: [
          { label: '写实风格', value: 'realism' },
          { label: '动漫风格', value: 'anime' },
        ],
        multiple: true,
      },
      {
        name: '模式',
        key: 'mode',
        type: 'string',
        defaultValue: 'fast',
        candidates: [{ label: '快速', value: 'fast' }],
        allowCustom: false,
      },
      { name: '普通字段', key: 'plain', type: 'string', defaultValue: '' },
    ]);
  });

  it('submit 组装 userConfig（默认值回退 + 按类型转换）并透传 Base64 读取回调', async () => {
    await syncCustomInstance(makeInstance([entry('wf-uc2', ['text-to-image'], {
      userConfigFields: [
        { key: 'model', name: '模型', type: 'string', defaultValue: 'gpt-image-2' },
        { key: 'steps', name: '步数', type: 'integer', defaultValue: '20' },
        { key: 'enhance', name: '增强', type: 'boolean', defaultValue: 'false' },
      ],
    })]));
    const impl = getImpl('text-to-image', 'custom-wf-uc2-' + INSTANCE_ID);
    expect(impl).toBeDefined();
    const execute = vi.fn(async (_p: {
      workflowId: string;
      workflowType?: string;
      userConfig?: Record<string, boolean | number | string>;
      readFileToBase64?: (p: string, withDataPrefix?: boolean) => Promise<string>;
      readFileAsBase64Object?: (p: string) => Promise<{ mimeType: string; data: string }>;
    }) => ({ taskId: 'task-1' }));
    const fakeProvider = { execute } as unknown as CustomProviderClient;
    const readFileToBase64 = async (p: string, withDataPrefix?: boolean) =>
      (withDataPrefix ? 'data:image/png;base64,' : '') + 'b64:' + p;
    const readFileAsBase64Object = async (p: string) => ({ mimeType: 'image/png', data: 'obj:' + p });
    const ctx = {
      vars: { promptPath: 'prompt/a.md', model: 'gpt-4o', steps: '30' },
      projectConfig: { width: 1080, height: 1920, fps: 24 },
      readFile: async (p: string) => '提示词:' + p,
      readAssertFile: async () => new File([], 'x.png'),
      readFileToBase64,
      readFileAsBase64Object,
      provider: fakeProvider,
    } as never;
    await impl!.submit(ctx);
    expect(execute).toHaveBeenCalledTimes(1);
    const arg = execute.mock.calls[0][0] as {
      workflowType?: string;
      userConfig?: Record<string, unknown>;
      readFileToBase64?: (p: string, withDataPrefix?: boolean) => Promise<string>;
      readFileAsBase64Object?: (p: string) => Promise<{ mimeType: string; data: string }>;
    };
    // vars 有值优先；enhance 未填写回退默认值 false；steps 字符串转数字
    expect(arg.workflowType).toBe('text-to-image');
    expect(arg.userConfig).toEqual({ model: 'gpt-4o', steps: 30, enhance: false });
    expect(await arg.readFileToBase64?.('assert/a.png')).toBe('b64:assert/a.png');
    expect(await arg.readFileToBase64?.('assert/a.png', true)).toBe('data:image/png;base64,b64:assert/a.png');
    expect(await arg.readFileAsBase64Object?.('assert/a.png')).toEqual({ mimeType: 'image/png', data: 'obj:assert/a.png' });
  });

  it('生图/生视频类型注册尺寸能力（未配置条目 = 默认全量），TTS 类型不声明', async () => {
    await syncCustomInstance(makeInstance([
      entry('wf-size-default', ['text-to-image']),
      entry('wf-size-tts', ['tts-voice-design']),
    ]));
    const t2i = getImpl('text-to-image', 'custom-wf-size-default-' + INSTANCE_ID);
    expect(t2i?.capabilities?.size).toEqual({
      ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', 'auto'],
      size: ['360P', '720P', '1080P', '2K', '4K', 'auto'],
      supportCustomSize: true,
    });
    const tts = getImpl('tts-voice-design', 'custom-wf-size-tts-' + INSTANCE_ID);
    expect(tts?.capabilities?.size).toBeUndefined();
  });

  it('条目配置的尺寸能力按声明注册（含空清单回退默认）', async () => {
    await syncCustomInstance(makeInstance([
      entry('wf-size-cfg', ['image-to-video'], {
        sizeConfig: { ratio: ['21:9', '16:9', 'adaptive'], size: ['768P', '2K'], supportCustomSize: false },
      }),
      entry('wf-size-empty', ['image-edit'], {
        sizeConfig: { ratio: [], size: ['1K'], supportCustomSize: false },
      }),
    ]));
    const i2v = getImpl('image-to-video', 'custom-wf-size-cfg-' + INSTANCE_ID);
    expect(i2v?.capabilities?.size).toEqual({
      ratio: ['21:9', '16:9', 'adaptive'],
      size: ['768P', '2K'],
      supportCustomSize: false,
    });
    const edit = getImpl('image-edit', 'custom-wf-size-empty-' + INSTANCE_ID);
    expect(edit?.capabilities?.size).toEqual({
      ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', 'auto'],
      size: ['1K'],
      supportCustomSize: false,
    });
  });

  it('submit 透传 ctx.params.sizeConfig（生图/生视频类型，含自定义宽高）', async () => {
    await syncCustomInstance(makeInstance([
      entry('wf-sc-t2i', ['text-to-image']),
      entry('wf-sc-i2v', ['image-to-video']),
    ]));
    const t2i = getImpl('text-to-image', 'custom-wf-sc-t2i-' + INSTANCE_ID);
    const i2v = getImpl('image-to-video', 'custom-wf-sc-i2v-' + INSTANCE_ID);
    expect(t2i).toBeDefined();
    expect(i2v).toBeDefined();

    // 文生图：sizeConfig 含比例/尺寸/自定义宽高
    const executeT2i = vi.fn(async (_p: { workflowId: string; params?: Record<string, unknown> }) => ({ taskId: 't1' }));
    const ctxT2i = {
      vars: { promptPath: 'prompt/a.md' },
      projectConfig: { width: 1080, height: 1920 },
      sizeConfig: { ratio: '1:1', size: '2K', width: 1024, height: 1024 },
      readFile: async () => 'p',
      readAssertFile: async () => new File([], 'x.png'),
      provider: { execute: executeT2i },
    } as never;
    await t2i!.submit(ctxT2i);
    const argT2i = executeT2i.mock.calls[0]![0] as { params?: Record<string, unknown> };
    expect(argT2i.params?.sizeConfig).toEqual({
      ratio: '1:1', size: '2K', width: 1024, height: 1024,
    });

    // 图生视频：sizeConfig 只带比例/尺寸（无宽高）
    const executeI2v = vi.fn(async (_p: { workflowId: string; params?: Record<string, unknown> }) => ({ taskId: 't2' }));
    const ctxI2v = {
      vars: {},
      projectConfig: { width: 1080, height: 1920 },
      sizeConfig: { ratio: '16:9', size: '768P' },
      video: {
        mode: 'director',
        resolution: { width: 0, height: 0 },
        duration: 5,
        prompt: 'p',
        director: { frames: [{ file: new File([], 'f.png'), cursor: 0 }] },
        extraParams: {},
      },
      readFile: async () => '',
      readAssertFile: async () => new File([], 'x.png'),
      provider: { execute: executeI2v },
    } as never;
    await i2v!.submit(ctxI2v);
    const argI2v = executeI2v.mock.calls[0]![0] as { params?: Record<string, unknown> };
    expect(argI2v.params?.sizeConfig).toEqual({ ratio: '16:9', size: '768P' });
  });

  it('submit 无 sizeConfig 时不携带该字段（兼容旧任务）', async () => {
    await syncCustomInstance(makeInstance([entry('wf-sc-none', ['text-to-image'])]));
    const impl = getImpl('text-to-image', 'custom-wf-sc-none-' + INSTANCE_ID);
    const execute = vi.fn(async (_p: { workflowId: string; params?: Record<string, unknown> }) => ({ taskId: 't' }));
    const ctx = {
      vars: { promptPath: 'prompt/a.md' },
      projectConfig: { width: 1080, height: 1920 },
      readFile: async () => 'p',
      readAssertFile: async () => new File([], 'x.png'),
      provider: { execute },
    } as never;
    await impl!.submit(ctx);
    const arg = execute.mock.calls[0]![0] as { params?: Record<string, unknown> };
    expect(arg.params?.sizeConfig).toBeUndefined();
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
