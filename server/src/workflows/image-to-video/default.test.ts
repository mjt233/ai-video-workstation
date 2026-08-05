import { describe, expect, it, vi, beforeEach } from 'vitest';

// vi.mock 工厂会被提升到文件顶部，无法访问顶层 const；
// 用 vi.hoisted 声明 mock 函数，工厂与断言共享同一实例。
const { submitLtxDirectorImageToVideo, submitImageToVideo } = vi.hoisted(() => ({
  submitLtxDirectorImageToVideo: vi.fn(async (_p: { duration: number; frames: unknown[] }) => ({ taskId: 'director-task' })),
  submitImageToVideo: vi.fn(async (_p: { frames: unknown[] }) => ({ taskId: 'frame-task' })),
}));

// 注意：本文件与 default.ts 同目录，bridge-client 的相对路径为 ../bridge-client.js
vi.mock('../bridge-client.js', () => ({
  submitLtxDirectorImageToVideo,
  submitImageToVideo,
  submitComfyuiBridge: vi.fn(),
  pollTask: vi.fn(),
  buildDownloadRequest: vi.fn(),
  // 与真实工厂一致：把 baseDefinition 拍平到定义顶层（register 需要顶层 id/impl）
  createComfyuiBridgeWorkflow: (def: { baseDefinition: Record<string, unknown>; submit: unknown }) => ({
    ...def.baseDefinition,
    submit: def.submit,
  }),
}));

// 触发被测实现注册（应用运行时由 discoverWorkflows 动态 import，单测需显式加载）
import './default.js';

import { getImpl } from '../registry.js';
import type { WorkflowRunContext } from '../types.js';

const mkContext = (video: unknown): WorkflowRunContext =>
  ({
    project: 'p',
    projectConfig: { width: 1080, height: 1920, fps: 24 },
    vars: {},
    video: video as never,
    readFile: async () => '',
    readAssertFile: async () => new File(['x'], 'x.png', { type: 'image/png' }),
  }) as WorkflowRunContext;

describe('image-to-video ltx impl', () => {
  beforeEach(() => {
    submitLtxDirectorImageToVideo.mockClear();
    submitImageToVideo.mockClear();
  });

  it('导演台模式调用 submitLtxDirectorImageToVideo', async () => {
    const impl = getImpl('image-to-video', 'ltx');
    expect(impl).toBeDefined();
    const file = new File(['f'], 'f.png', { type: 'image/png' });
    await impl!.submit(mkContext({
      mode: 'director',
      resolution: { width: 720, height: 1280 },
      fps: 30,
      duration: 5,
      prompt: '导演台',
      director: { frames: [{ file, cursor: 0 }], audio: file },
      extraParams: {},
    }));
    expect(submitLtxDirectorImageToVideo).toHaveBeenCalledTimes(1);
    const params = submitLtxDirectorImageToVideo.mock.calls[0][0];
    expect(params.duration).toBe(5);
    expect(params.frames).toHaveLength(1);
  });

  it('首尾帧模式调用 submitImageToVideo（frames 带 cursor 均匀分布）', async () => {
    const impl = getImpl('image-to-video', 'ltx');
    const f1 = new File(['a'], 'a.png', { type: 'image/png' });
    const f2 = new File(['b'], 'b.png', { type: 'image/png' });
    await impl!.submit(mkContext({
      mode: 'first-last-frame',
      resolution: { width: 1080, height: 1920 },
      duration: 4,
      prompt: '首尾帧',
      director: {
        frames: [
          { file: f1, cursor: 0 },
          { file: f2, cursor: 1 },
        ],
      },
      extraParams: {},
    }));
    expect(submitImageToVideo).toHaveBeenCalledTimes(1);
    const params = submitImageToVideo.mock.calls[0][0];
    expect(params.frames).toHaveLength(2);
  });
});
