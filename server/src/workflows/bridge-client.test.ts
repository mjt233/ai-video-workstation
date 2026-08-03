import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveImageEditSizeParams,
  submitLtxDirectorImageToVideo,
} from './bridge-client.js';

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
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task-123',
        status: 'accepted',
        comfyui_response: {},
      }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 构造测试用图片文件 */
  function makeFile(name: string): File {
    return new File(['dummy'], name, { type: 'image/png' });
  }

  /** 从最近一次 fetch 调用中解析 multipart 表单的 params JSON */
  function lastForm(): FormData {
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    if (!init?.body || !(init.body instanceof FormData)) {
      throw new Error('fetch 未被 multipart 调用');
    }
    return init.body;
  }

  it('以 multipart 提交多帧，frame_define 与 frame_{seq} 文件键正确', async () => {
    const file0 = makeFile('f0.png');
    const file1 = makeFile('f1.png');

    const result = await submitLtxDirectorImageToVideo({
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
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toBe(
      'http://localhost:10721/api/workflows/ltx-2.3-director/execute',
    );

    const form = lastForm();
    const params = JSON.parse(form.get('params') as string) as Record<string, unknown>;
    expect(params.prompt).toBe('镜头推进');
    expect(params.width).toBe(1920);
    expect(params.height).toBe(1080);
    expect(params.duration).toBe(5);
    expect(params.fps).toBe(24);
    expect(params.auto_generate_audio).toBe(true);
    expect(params.seed).toBe(42);
    expect(params.frame_define).toBe(
      JSON.stringify([
        { frameSeq: 0, cursor: 0 },
        { frameSeq: 1, cursor: 0.5 },
      ]),
    );

    expect(form.get('frame_0')).toBe(file0);
    expect(form.get('frame_1')).toBe(file1);
  });

  it('未提供 seed 时 body 不含 seed 字段', async () => {
    await submitLtxDirectorImageToVideo({
      prompt: 'p',
      width: 1280,
      height: 720,
      duration: 3,
      fps: 24,
      frames: [{ file: makeFile('f0.png'), cursor: 0 }],
    });

    const form = lastForm();
    const params = JSON.parse(form.get('params') as string) as Record<string, unknown>;
    expect(params).not.toHaveProperty('seed');
    expect(params.frame_define).toBe(
      JSON.stringify([{ frameSeq: 0, cursor: 0 }]),
    );
  });

  it('Bridge 返回非 2xx 时抛出错误', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    } as unknown as Response);

    await expect(
      submitLtxDirectorImageToVideo({
        prompt: 'p',
        width: 1280,
        height: 720,
        duration: 3,
        fps: 24,
        frames: [{ file: makeFile('f0.png'), cursor: 0 }],
      }),
    ).rejects.toThrow('Bridge submit failed (500): boom');
  });
});
