import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderClient } from '../../providers/types.js';
import { getImpl } from '../registry.js';
import type { TextToImageVars, WorkflowRunContext } from '../types.js';
import './default.js'; // 触发注册（模块顶层 register）

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

describe('text-to-image/default', () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue({ taskId: 't1' });
  });

  it('注册 default 实现，provider=comfyui-bridge，声明尺寸参数（供尺寸组件渲染）', () => {
    const impl = getImpl('text-to-image', 'default');
    expect(impl).toBeDefined();
    expect(impl!.provider).toBe('comfyui-bridge');
    const keys = (impl!.params ?? []).map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['enable_specified_size', 'width', 'height']));
  });

  it('enable_specified_size=true 时提交指定宽高', async () => {
    const impl = getImpl('text-to-image', 'default')!;
    await impl.submit(mkCtx({
      vars: { promptPath: 'x.md', enable_specified_size: 'true', width: '720', height: '1280' },
    }));
    const call = executeMock.mock.calls[0][0] as { workflowId: string; params: Record<string, unknown> };
    expect(call.workflowId).toBe('text_to_image');
    expect(call.params).toMatchObject({ prompt: '一只猫', width: 720, height: 1280 });
  });

  it('未启用指定尺寸时回退 projectConfig 宽高（忽略 vars.width/height）', async () => {
    const impl = getImpl('text-to-image', 'default')!;
    await impl.submit(mkCtx({ vars: { promptPath: 'x.md', width: '720', height: '1280' } }));
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params).toMatchObject({ width: 1080, height: 1920 });
  });

  it('promptPath 缺失抛错', async () => {
    const impl = getImpl('text-to-image', 'default')!;
    await expect(impl.submit(mkCtx({ vars: { promptPath: '  ' } }))).rejects.toThrow('需要 vars.promptPath');
  });
});
