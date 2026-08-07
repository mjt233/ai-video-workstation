import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderClient } from '../../providers/types.js';
import { getImpl } from '../registry.js';
import type { TextToImageVars, WorkflowRunContext } from '../types.js';
import './seedream.js'; // 触发注册（模块顶层 register）

const executeMock = vi.fn();
const stubProvider = {
  execute: executeMock,
  poll: vi.fn(),
  getOutput: vi.fn(),
  cancel: vi.fn(),
} as unknown as ProviderClient;

const mkCtx = (overrides: Partial<WorkflowRunContext<TextToImageVars>> = {}): WorkflowRunContext<TextToImageVars> => ({
  project: 'p',
  projectConfig: { width: 1080, height: 1920 },
  vars: { promptPath: 'prompt/character/张三/appearance.md' },
  provider: stubProvider,
  userParams: {},
  readFile: async () => '一只猫',
  readAssertFile: async () => new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
  ...overrides,
});

describe('text-to-image/seedream', () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue({ taskId: 't1' });
  });

  it('注册 seedream-5-pro / seedream-5-lite，provider=volcengine-ark，能力含 deferredCancel', () => {
    const pro = getImpl('text-to-image', 'seedream-5-pro');
    expect(pro).toBeDefined();
    expect(pro!.provider).toBe('volcengine-ark');
    expect(pro!.capabilities).toMatchObject({ cancelable: true, deferredCancel: true });
    expect(getImpl('text-to-image', 'seedream-5-lite')).toBeDefined();
  });

  it('pro 实现：读 promptPath、映射尺寸、提交正确 body', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-pro')!;
    await impl.submit(mkCtx());

    expect(executeMock).toHaveBeenCalledTimes(1);
    const call = executeMock.mock.calls[0][0] as { workflowId: string; params: Record<string, unknown> };
    expect(call.workflowId).toBe('doubao-seedream-5-0-pro-260628');
    expect(call.params).toMatchObject({
      model: 'doubao-seedream-5-0-pro-260628',
      prompt: '一只猫',
      size: '1080x1920',
      output_format: 'jpeg',
      watermark: false,
      response_format: 'url',
    });
  });

  it('lite 实现使用 lite 模型 ID', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-lite')!;
    await impl.submit(mkCtx());
    const call = executeMock.mock.calls[0][0] as { workflowId: string };
    expect(call.workflowId).toBe('doubao-seedream-5-0-260128');
  });

  it('enhance_prompt=true 时提交 optimize_prompt_options.mode=standard', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-pro')!;
    await impl.submit(mkCtx({ userParams: { enhance_prompt: 'true' } }));
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.optimize_prompt_options).toEqual({ mode: 'standard' });
  });

  it('enhance_prompt 未开启时不带 optimize_prompt_options', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-pro')!;
    await impl.submit(mkCtx());
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.optimize_prompt_options).toBeUndefined();
  });

  it('enable_specified_size=true 时 vars.width/height 覆盖 projectConfig 尺寸', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-pro')!;
    await impl.submit(mkCtx({
      vars: { promptPath: 'x.md', enable_specified_size: 'true', width: '720', height: '1280' },
    }));
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.size).toBe('720x1280');
  });

  it('未启用指定尺寸时回退 projectConfig 尺寸（忽略 vars.width/height）', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-pro')!;
    await impl.submit(mkCtx({ vars: { promptPath: 'x.md', width: '720', height: '1280' } }));
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.size).toBe('1080x1920');
  });

  it('promptPath 缺失抛错', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-pro')!;
    await expect(impl.submit(mkCtx({ vars: { promptPath: '  ' } }))).rejects.toThrow('需要 vars.promptPath');
  });
});
