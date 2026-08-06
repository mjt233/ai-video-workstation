import { describe, expect, it, vi } from 'vitest';
import { resolveImageEditSizeParams, submitLtxDirectorImageToVideo } from './bridge-client.js';
import type { ProviderClient } from '../providers/types.js';

describe('resolveImageEditSizeParams', () => {
  it('enable_specified_size=true 时解析出启用的宽高（数字）', () => {
    expect(
      resolveImageEditSizeParams({
        enable_specified_size: 'true',
        width: '1920',
        height: '1080',
      }),
    ).toEqual({ enable_specified_size: true, width: 1920, height: 1080 });
  });

  it('enable_specified_size=false 时不返回任何尺寸参数', () => {
    expect(
      resolveImageEditSizeParams({ enable_specified_size: 'false', width: '1920', height: '1080' }),
    ).toEqual({});
  });

  it('未声明 enable_specified_size 时不返回任何尺寸参数', () => {
    expect(resolveImageEditSizeParams({ width: '1920', height: '1080' })).toEqual({});
  });

  it('启用但未提供宽高时只返回启用标记', () => {
    expect(resolveImageEditSizeParams({ enable_specified_size: 'true' })).toEqual({
      enable_specified_size: true,
    });
  });

  it('非法宽高值被忽略', () => {
    expect(
      resolveImageEditSizeParams({ enable_specified_size: 'true', width: 'abc', height: '' }),
    ).toEqual({ enable_specified_size: true });
  });

  it('小数宽高取整', () => {
    expect(
      resolveImageEditSizeParams({ enable_specified_size: 'true', width: '1920.5', height: '1080.5' }),
    ).toEqual({ enable_specified_size: true, width: 1921, height: 1081 });
  });
});

describe('submitLtxDirectorImageToVideo', () => {
  it('构造 ltx-2.3-director 提交参数与动态文件键，调用 client.execute', async () => {
    const execute = vi.fn(async (_p: {
      workflowId: string;
      params?: Record<string, unknown>;
      files?: Record<string, File>;
    }) => ({ taskId: 'task-123' }));
    const client = { execute } as unknown as ProviderClient;
    const file0 = new File(['f0'], 'f0.png', { type: 'image/png' });
    const file1 = new File(['f1'], 'f1.png', { type: 'image/png' });

    const result = await submitLtxDirectorImageToVideo(client, {
      prompt: '镜头推进',
      width: 1920,
      height: 1080,
      duration: 5,
      fps: 24,
      seed: 42,
      frames: [
        { file: file0, cursor: 0 },
        { file: file1, cursor: 0.5 },
      ],
    });

    expect(result.taskId).toBe('task-123');
    expect(execute).toHaveBeenCalledTimes(1);
    const arg = execute.mock.calls[0][0] as {
      workflowId: string;
      params: Record<string, unknown>;
      files: Record<string, File>;
    };
    expect(arg.workflowId).toBe('ltx-2.3-director');
    expect(arg.params).toMatchObject({
      prompt: '镜头推进',
      width: 1920,
      height: 1080,
      duration: 5,
      fps: 24,
      seed: 42,
      auto_generate_audio: true,
    });
    expect(arg.params.frame_define).toBe(
      JSON.stringify([
        { frameSeq: 0, cursor: 0 },
        { frameSeq: 1, cursor: 0.5 },
      ]),
    );
    expect(Object.keys(arg.files)).toEqual(['frame_0', 'frame_1']);
    expect(arg.files.frame_0).toBe(file0);
    expect(arg.files.frame_1).toBe(file1);
  });
});
