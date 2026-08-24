import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderClient } from '../providers/types.js';
import { getImpl, unregisterByInstance } from './registry.js';
import { resolveOpenAICompatibleSize, syncOpenAICompatibleInstance } from './openai-compatible-sync.js';
import type { ImageEditVars, TextToImageVars, WorkflowRunContext } from './types.js';

vi.mock('../providers/config-store.js', () => ({
  resolveInstanceConfig: vi.fn((inst: { config: Record<string, unknown> }) => inst.config),
}));

const executeMock = vi.fn();
const stubProvider = {
  execute: executeMock,
  poll: vi.fn(),
  getOutput: vi.fn(),
  cancel: vi.fn(),
} as unknown as ProviderClient;

describe('resolveOpenAICompatibleSize', () => {
  it('指定尺寸且宽高有效时返回 WxH', () => {
    expect(resolveOpenAICompatibleSize(true, '720', '1280', 1080, 1920)).toBe('720x1280');
  });

  it('指定尺寸但宽高无效时回退项目尺寸', () => {
    expect(resolveOpenAICompatibleSize(true, '', '', 1080, 1920)).toBe('1080x1920');
  });

  it('未指定尺寸时使用项目尺寸', () => {
    expect(resolveOpenAICompatibleSize(false, '1', '2', 1080, 1920)).toBe('1080x1920');
  });

  it('都无效时不传 size', () => {
    expect(resolveOpenAICompatibleSize(false, undefined, undefined)).toBeUndefined();
  });
});

describe('syncOpenAICompatibleInstance', () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue({ taskId: 't1' });
    unregisterByInstance('inst-oai', new Set());
  });

  it('按能力注册文生图与图片编辑，impl 含实例 id', async () => {
    await syncOpenAICompatibleInstance({
      id: 'inst-oai',
      type: 'openai-compatible',
      name: '中转A',
      config: {
        models: [
          { id: 'gpt-image-1', capabilities: ['text-to-image', 'image-edit'] },
          { id: 'edit-only', capabilities: ['image-edit'] },
        ],
      },
    });
    const t2i = getImpl('text-to-image', 'oai-gpt-image-1-inst-oai');
    expect(t2i?.name).toBe('gpt-image-1 文生图');
    expect(t2i?.providerName).toBe('中转A');
    expect(t2i?.workflowKey).toBe('text-to-image:gpt-image-1');
    // 尺寸能力声明：支持自定义任意宽高，直传 "WxH"
    expect(t2i?.capabilities?.size).toEqual({
      ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', 'auto'],
      size: ['auto'],
      supportCustomSize: true,
    });
    expect(getImpl('image-edit', 'oai-gpt-image-1-inst-oai')).toBeDefined();
    expect(getImpl('image-edit', 'oai-edit-only-inst-oai')).toBeDefined();
    expect(getImpl('text-to-image', 'oai-edit-only-inst-oai')).toBeUndefined();
  });

  it('模型变更后注销消失的工作流', async () => {
    const inst = {
      id: 'inst-oai',
      type: 'openai-compatible',
      name: '中转A',
      config: { models: [{ id: 'gpt-image-1', capabilities: ['text-to-image', 'image-edit'] }] },
    };
    await syncOpenAICompatibleInstance(inst);
    await syncOpenAICompatibleInstance({
      ...inst,
      config: { models: [{ id: 'gpt-image-1', capabilities: ['text-to-image'] }] },
    });
    expect(getImpl('text-to-image', 'oai-gpt-image-1-inst-oai')).toBeDefined();
    expect(getImpl('image-edit', 'oai-gpt-image-1-inst-oai')).toBeUndefined();
  });

  it('文生图 submit 读取 prompt 并按尺寸门控传 size', async () => {
    await syncOpenAICompatibleInstance({
      id: 'inst-oai',
      type: 'openai-compatible',
      name: '中转A',
      config: { models: [{ id: 'gpt-image-1', capabilities: ['text-to-image'] }] },
    });
    const impl = getImpl('text-to-image', 'oai-gpt-image-1-inst-oai')!;
    const ctx: WorkflowRunContext<TextToImageVars> = {
      project: 'p',
      projectConfig: { width: 1080, height: 1920 },
      vars: { promptPath: 'prompt/a.md', enable_specified_size: 'true', width: '512', height: '768' },
      provider: stubProvider,
      readFile: async () => '一只猫',
      readAssertFile: async () => new File(['x'], 'x.png'),
    };
    await impl.submit(ctx);
    expect(executeMock).toHaveBeenCalledWith({
      workflowId: 'gpt-image-1',
      params: { prompt: '一只猫', size: '512x768' },
    });
  });

  it('文生图 sizeConfig 宽高优先于 vars 门控（统一尺寸配置直传 "WxH"）', async () => {
    await syncOpenAICompatibleInstance({
      id: 'inst-oai',
      type: 'openai-compatible',
      name: '中转A',
      config: { models: [{ id: 'gpt-image-1', capabilities: ['text-to-image'] }] },
    });
    const impl = getImpl('text-to-image', 'oai-gpt-image-1-inst-oai')!;
    const ctx: WorkflowRunContext<TextToImageVars> = {
      project: 'p',
      projectConfig: { width: 1080, height: 1920 },
      vars: { promptPath: 'prompt/a.md', enable_specified_size: 'false', width: '512', height: '768' },
      sizeConfig: { ratio: '1:1', size: 'auto', width: 1024, height: 1024 },
      provider: stubProvider,
      readFile: async () => '一只猫',
      readAssertFile: async () => new File(['x'], 'x.png'),
    };
    await impl.submit(ctx);
    expect(executeMock).toHaveBeenCalledWith({
      workflowId: 'gpt-image-1',
      params: { prompt: '一只猫', size: '1024x1024' },
    });
  });

  it('文生图 sizeConfig 仅带比例/尺寸档（无宽高）时回退 projectConfig 尺寸', async () => {
    await syncOpenAICompatibleInstance({
      id: 'inst-oai',
      type: 'openai-compatible',
      name: '中转A',
      config: { models: [{ id: 'gpt-image-1', capabilities: ['text-to-image'] }] },
    });
    const impl = getImpl('text-to-image', 'oai-gpt-image-1-inst-oai')!;
    const ctx: WorkflowRunContext<TextToImageVars> = {
      project: 'p',
      projectConfig: { width: 1080, height: 1920 },
      vars: { promptPath: 'prompt/a.md' },
      sizeConfig: { ratio: '16:9', size: 'auto' },
      provider: stubProvider,
      readFile: async () => '一只猫',
      readAssertFile: async () => new File(['x'], 'x.png'),
    };
    await impl.submit(ctx);
    expect(executeMock).toHaveBeenCalledWith({
      workflowId: 'gpt-image-1',
      params: { prompt: '一只猫', size: '1080x1920' },
    });
  });

  it('图片编辑 submit 单图走 files.image，并带 mode=edit', async () => {
    await syncOpenAICompatibleInstance({
      id: 'inst-oai',
      type: 'openai-compatible',
      name: '中转A',
      config: { models: [{ id: 'gpt-image-1', capabilities: ['image-edit'] }] },
    });
    const impl = getImpl('image-edit', 'oai-gpt-image-1-inst-oai')!;
    const file = new File(['img'], 'a.jpg', { type: 'image/jpeg' });
    const ctx: WorkflowRunContext<ImageEditVars> = {
      project: 'p',
      projectConfig: { width: 1080, height: 1920 },
      vars: { prompt: '把门打开', imagePaths: JSON.stringify(['assert/a.jpg']) },
      provider: stubProvider,
      userParams: { enable_specified_size: 'true', width: '720', height: '1280' },
      readFile: async () => '',
      readAssertFile: async () => file,
    };
    await impl.submit(ctx);
    const call = executeMock.mock.calls[0][0] as {
      workflowId: string;
      params: Record<string, unknown>;
      files: Record<string, File>;
    };
    expect(call.workflowId).toBe('gpt-image-1');
    expect(call.params).toEqual({ mode: 'edit', prompt: '把门打开', size: '720x1280' });
    expect(call.files.image).toBe(file);
  });
});
