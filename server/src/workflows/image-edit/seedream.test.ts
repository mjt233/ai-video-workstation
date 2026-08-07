import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderClient } from '../../providers/types.js';
import { getImpl } from '../registry.js';
import type { ImageEditVars, WorkflowRunContext } from '../types.js';
import './seedream.js'; // 触发注册（模块顶层 register）

const executeMock = vi.fn();
const stubProvider = {
  execute: executeMock,
  poll: vi.fn(),
  getOutput: vi.fn(),
  cancel: vi.fn(),
} as unknown as ProviderClient;

const mkCtx = (overrides: Partial<WorkflowRunContext<ImageEditVars>> = {}): WorkflowRunContext<ImageEditVars> => ({
  project: 'p',
  projectConfig: { width: 1080, height: 1920 },
  vars: {
    prompt: '把猫放进商场',
    imagePaths: JSON.stringify(['assert/stage/商场/白天.jpg', 'assert/character/张三/appearance.jpg']),
  },
  provider: stubProvider,
  userParams: {},
  readFile: async () => '',
  readAssertFile: async (rel) => new File([rel], 'a.jpg', { type: 'image/jpeg' }),
  ...overrides,
});

describe('image-edit/seedream', () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue({ taskId: 't1' });
  });

  it('注册 seedream-5-pro / seedream-5-lite，provider=volcengine-ark，能力含 deferredCancel', () => {
    const pro = getImpl('image-edit', 'seedream-5-pro');
    expect(pro).toBeDefined();
    expect(pro!.provider).toBe('volcengine-ark');
    expect(pro!.capabilities).toMatchObject({ cancelable: true, deferredCancel: true });
    expect(getImpl('image-edit', 'seedream-5-lite')).toBeDefined();
  });

  it('多图：image 为 data URL 数组、prompt=编辑描述、尺寸回退 2K', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await impl.submit(mkCtx());

    const call = executeMock.mock.calls[0][0] as { workflowId: string; params: Record<string, unknown> };
    expect(call.workflowId).toBe('doubao-seedream-5-0-pro-260628');
    expect(call.params.prompt).toBe('把猫放进商场');
    const image = call.params.image as string[];
    expect(image).toHaveLength(2);
    expect(image[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(call.params.size).toBe('2K');
  });

  it('enable_specified_size=true 且宽高有效时显式 WxH', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await impl.submit(mkCtx({ userParams: { enable_specified_size: 'true', width: '720', height: '1280' } }));
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.size).toBe('720x1280');
  });

  it('enable_specified_size=true 但宽高无效时回退 2K', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await impl.submit(mkCtx({ userParams: { enable_specified_size: 'true', width: '', height: '' } }));
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.size).toBe('2K');
  });

  it('单图：image 为字符串', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await impl.submit(mkCtx({
      vars: { prompt: 'x', imagePaths: JSON.stringify(['assert/stage/商场/白天.jpg']) },
    }));
    const call = executeMock.mock.calls[0][0] as { params: { image: string | string[] } };
    expect(typeof call.params.image).toBe('string');
  });

  it('超过 10 张参考图抛错', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    const many = Array.from({ length: 11 }, (_, i) => `assert/stage/商场/${i}.jpg`);
    await expect(
      impl.submit(mkCtx({ vars: { prompt: 'x', imagePaths: JSON.stringify(many) } })),
    ).rejects.toThrow('最多支持 10 张参考图');
  });

  it('prompt 缺失抛错', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await expect(
      impl.submit(mkCtx({ vars: { prompt: '  ', imagePaths: '[]' } })),
    ).rejects.toThrow('需要 vars.prompt');
  });

  it('无输入图抛错', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await expect(
      impl.submit(mkCtx({ vars: { prompt: 'x', imagePaths: '[]' } })),
    ).rejects.toThrow('至少需要一张输入图片');
  });

  it('imagePaths 非法 JSON 抛错', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await expect(
      impl.submit(mkCtx({ vars: { prompt: 'x', imagePaths: 'not-json' } })),
    ).rejects.toThrow('imagePaths 无效');
  });

  it('imagePaths 含非字符串元素抛错', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await expect(
      impl.submit(mkCtx({ vars: { prompt: 'x', imagePaths: JSON.stringify([1, 2]) } })),
    ).rejects.toThrow('imagePaths 无效');
  });

  it('单张超过 30MB 抛错且不调用 execute', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    const big = new File([new Uint8Array(30 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' });
    await expect(
      impl.submit(mkCtx({
        vars: { prompt: 'x', imagePaths: JSON.stringify(['assert/stage/商场/大图.jpg']) },
        readAssertFile: async () => big,
      })),
    ).rejects.toThrow('超过 30MB');
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('空白路径被过滤后仍可提交', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await impl.submit(mkCtx({
      vars: { prompt: 'x', imagePaths: JSON.stringify(['   ', 'assert/stage/商场/白天.jpg']) },
    }));
    const call = executeMock.mock.calls[0][0] as { params: { image: string | string[] } };
    expect(typeof call.params.image).toBe('string');
  });

  it('readAssertFile 抛错时透传（不吞掉）', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await expect(
      impl.submit(mkCtx({
        vars: { prompt: 'x', imagePaths: JSON.stringify(['assert/stage/不存在/缺图.jpg']) },
        readAssertFile: async () => { throw new Error('assert 文件不存在: assert/stage/不存在/缺图.jpg'); },
      })),
    ).rejects.toThrow('assert 文件不存在');
  });

  it('lite 实现提交使用 lite 模型 ID', async () => {
    const impl = getImpl('image-edit', 'seedream-5-lite')!;
    await impl.submit(mkCtx());
    const call = executeMock.mock.calls[0][0] as { workflowId: string };
    expect(call.workflowId).toBe('doubao-seedream-5-0-260128');
  });
});
