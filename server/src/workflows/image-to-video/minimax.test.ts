import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 副作用注册：minimax 实现靠模块顶层 register() 注册，测试必须导入才能让 getImpl 找到。
// 注意：这里不 mock ../bridge-client.js 模块——真实 submitReferenceVideo 内部的
// submitComfyuiBridge 调用走模块内部绑定，模块级 vi.mock 无法拦截；
// 因此沿用 bridge-client.test.ts 的既有模式：mock 全局 fetch（网络边界），
// 让真实 submitReferenceVideo → submitComfyuiBridge → fetch 全链路（除网络外）都被覆盖。
import './minimax-h3-r2v.js';

import { getImpl } from '../registry.js';
import type { WorkflowRunContext } from '../types.js';

const fetchMock = vi.fn();

const mkContext = (video: unknown): WorkflowRunContext =>
  ({
    project: 'p',
    projectConfig: { width: 1080, height: 1920, fps: 24 },
    vars: {},
    video: video as never,
    readFile: async () => '',
    readAssertFile: async () => new File(['x'], 'x.png', { type: 'image/png' }),
  }) as WorkflowRunContext;

describe('minimax-h3-r2v 参考模式实现', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 'ref-task', status: 'accepted', comfyui_response: {} }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('能力声明含 reference 模式与限制', () => {
    const impl = getImpl('image-to-video', 'minimax-h3-r2v');
    expect(impl).toBeDefined();
    expect(impl!.capabilities?.video?.modes).toEqual(['reference']);
    expect(impl!.capabilities?.video?.reference?.types.image?.max).toBe(9);
    expect(impl!.capabilities?.video?.reference?.maxTotal).toBe(12);
    expect(impl!.capabilities?.cancelable).toBe(true);
  });

  it('按类型序号独立映射动态文件键 image_n/video_n/audio_n', async () => {
    const impl = getImpl('image-to-video', 'minimax-h3-r2v')!;
    const mk = (n: string, type: string) => new File([n], n, { type });
    const video = {
      mode: 'reference',
      resolution: { width: 1080, height: 1920 },
      duration: 5,
      prompt: '参考模式',
      references: [
        { type: 'image', file: mk('i0', 'image/png') },
        { type: 'image', file: mk('i1', 'image/png') },
        { type: 'audio', file: mk('a0', 'audio/flac') },
        { type: 'video', file: mk('v0', 'video/mp4') },
        { type: 'image', file: mk('i2', 'image/png') },
      ],
      extraParams: {},
    };
    const result = await impl.submit(mkContext(video));
    expect(result.taskId).toBe('ref-task');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toBe('http://localhost:10721/api/workflows/minimax-h3-r2v/execute');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    const params = JSON.parse(form.get('params') as string) as Record<string, unknown>;
    expect(params).toMatchObject({ prompt: '参考模式', width: 1080, height: 1920, duration: 5 });
    // 文件键顺序：实现按类型分组（imageRefs → videoRefs → audioRefs），
    // 各类型序号独立从 0 计数（params 固定在最前）
    const fileKeys = [...form.keys()].filter((k) => k !== 'params');
    expect(fileKeys).toEqual(['image_0', 'image_1', 'image_2', 'video_0', 'audio_0']);
    expect((form.get('image_0') as File).name).toBe('i0');
    expect((form.get('audio_0') as File).name).toBe('a0');
    expect((form.get('video_0') as File).name).toBe('v0');
  });

  it('超过总上限抛错', async () => {
    const impl = getImpl('image-to-video', 'minimax-h3-r2v')!;
    const mk = () => new File(['x'], 'x.png', { type: 'image/png' });
    const references = Array.from({ length: 13 }, () => ({ type: 'image' as const, file: mk() }));
    await expect(impl.submit(mkContext({ mode: 'reference', resolution: { width: 1, height: 1 }, duration: 1, prompt: 'x', references, extraParams: {} }))).rejects.toThrow('参考素材总数量');
  });
});
