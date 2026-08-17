import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimaxH3Client } from './client.js';

/**
 * 构造 fetch mock 路由：按 URL 区分上传素材 / 创建任务 / 查询任务 / 取消任务。
 *
 * @param overrides 各接口响应覆盖（upload / create / query / del）
 * @returns fetch mock 函数
 */
function routeFetch(overrides: {
  upload?: unknown;
  create?: unknown;
  query?: unknown;
  del?: unknown;
} = {}): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: unknown, _init?: RequestInit) => {
    const target = String(url);
    const ok = (body: unknown): Response => ({ ok: true, json: async () => body }) as unknown as Response;
    if (target.includes('/v1/files/upload')) {
      return ok(overrides.upload ?? { file: { file_id: 123456 }, base_resp: { status_code: 0, status_msg: 'success' } });
    }
    if (target.includes('/v2/query/video_generation/')) {
      return ok(overrides.query ?? { task: { status: 'running' } });
    }
    if (target.endsWith('/v2/video_generation')) {
      return ok(overrides.create ?? { task_id: 'remote-1' });
    }
    if (target.includes('/v2/video_generation/')) {
      return ok(overrides.del ?? { task_id: 'remote-1', action: 'cancelled', status: 'cancelled' });
    }
    throw new Error(`unexpected url: ${target}`);
  });
  return mock;
}

describe('createMinimaxH3Client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = routeFetch();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const config = { apiKey: 'k', baseUrl: 'http://mm', resolution: '2K', timeout: 300 };

  it('execute：上传媒体文件后以 mm_file:// 引用创建任务', async () => {
    const client = createMinimaxH3Client(config);
    const file = new File(['img'], 'a.png', { type: 'image/png' });
    const { taskId } = await client.execute({
      workflowId: 'MiniMax-H3',
      params: {
        content: [
          { type: 'text', text: '镜头缓缓推进' },
          { type: 'image_url', role: 'first_frame', fileKey: 'first_frame' },
        ],
        duration: 5,
        ratio: 'adaptive',
      },
      files: { first_frame: file },
    });

    expect(taskId).toBe('remote-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 第 1 次调用：multipart 上传素材
    const uploadCall = fetchMock.mock.calls[0];
    expect(uploadCall[0]).toBe('http://mm/v1/files/upload');
    const uploadInit = uploadCall[1] as RequestInit;
    expect(uploadInit.method).toBe('POST');
    expect(uploadInit.headers).toMatchObject({ Authorization: 'Bearer k' });
    expect(uploadInit.body).toBeInstanceOf(FormData);
    const form = uploadInit.body as FormData;
    expect(form.get('purpose')).toBe('video_generation_input');
    expect(form.get('file')).toBeInstanceOf(File);

    // 第 2 次调用：创建任务（mm_file:// 引用 + 必填字段）
    const createCall = fetchMock.mock.calls[1];
    expect(createCall[0]).toBe('http://mm/v2/video_generation');
    const createInit = createCall[1] as RequestInit;
    expect(createInit.method).toBe('POST');
    expect(createInit.headers).toMatchObject({ 'Content-Type': 'application/json', 'Authorization': 'Bearer k' });
    const body = JSON.parse(createInit.body as string) as Record<string, unknown>;
    expect(body.model).toBe('MiniMax-H3');
    expect(body.resolution).toBe('2K');
    expect(body.duration).toBe(5);
    expect(body.ratio).toBe('adaptive');
    expect(body.content).toEqual([
      { type: 'text', text: '镜头缓缓推进' },
      { type: 'image_url', image_url: { url: 'mm_file://123456' }, role: 'first_frame' },
    ]);
  });

  it('execute：未配置 API Key 时抛错', async () => {
    const client = createMinimaxH3Client({ apiKey: '', baseUrl: 'http://mm' });
    await expect(
      client.execute({
        workflowId: 'MiniMax-H3',
        params: { content: [{ type: 'text', text: 'x' }], duration: 5 },
      }),
    ).rejects.toThrow('API Key 未配置');
  });

  it('execute：content 缺少非空 text 时抛错', async () => {
    const client = createMinimaxH3Client(config);
    await expect(
      client.execute({ workflowId: 'MiniMax-H3', params: { content: [], duration: 5 } }),
    ).rejects.toThrow('至少一个非空 text');
  });

  it('execute：时长非法（<4 / >15 / 非整数）时抛错', async () => {
    const client = createMinimaxH3Client(config);
    for (const duration of [3, 16, 5.5]) {
      await expect(
        client.execute({
          workflowId: 'MiniMax-H3',
          params: { content: [{ type: 'text', text: 'x' }], duration },
        }),
      ).rejects.toThrow('时长须为 4~15 的整数');
    }
  });

  it('execute：媒体项缺少对应文件时抛错', async () => {
    const client = createMinimaxH3Client(config);
    await expect(
      client.execute({
        workflowId: 'MiniMax-H3',
        params: {
          content: [
            { type: 'text', text: 'x' },
            { type: 'image_url', role: 'reference_image', fileKey: 'image_0' },
          ],
          duration: 5,
        },
      }),
    ).rejects.toThrow('缺少上传文件: image_0');
  });

  it('execute：素材超过大小上限（音频 >15MB）时抛错', async () => {
    const client = createMinimaxH3Client(config);
    const big = new File([new Uint8Array(16 * 1024 * 1024)], 'big.wav', { type: 'audio/wav' });
    await expect(
      client.execute({
        workflowId: 'MiniMax-H3',
        params: {
          content: [
            { type: 'text', text: 'x' },
            { type: 'audio_url', role: 'reference_audio', fileKey: 'audio_0' },
          ],
          duration: 5,
        },
        files: { audio_0: big },
      }),
    ).rejects.toThrow('输入音频超过 15MB 上限');
  });

  it('execute：创建任务非 2xx 时透出官方错误信息', async () => {
    const mock = vi.fn(async (url: unknown) => {
      if (String(url).includes('/v2/video_generation')) {
        return {
          ok: false,
          status: 422,
          text: async () => JSON.stringify({ error: { message: 'video description contains sensitive content' } }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({}) } as unknown as Response;
    });
    vi.stubGlobal('fetch', mock);
    const client = createMinimaxH3Client(config);
    await expect(
      client.execute({
        workflowId: 'MiniMax-H3',
        params: { content: [{ type: 'text', text: 'x' }], duration: 5 },
      }),
    ).rejects.toThrow('MiniMax 创建任务错误 (422): video description contains sensitive content');
  });

  it('poll：queued / running 返回未完成', async () => {
    const client = createMinimaxH3Client(config);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { status: 'queued' } }),
    } as unknown as Response);
    const queued = await client.poll('t1');
    expect(queued).toMatchObject({ status: 'queued', done: false });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { status: 'running' } }),
    } as unknown as Response);
    const running = await client.poll('t1');
    expect(running).toMatchObject({ status: 'running', done: false });
  });

  it('poll：succeeded 缓存 download 输出', async () => {
    const client = createMinimaxH3Client(config);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { status: 'succeeded', content: { url: 'https://cdn/v.mp4' } } }),
    } as unknown as Response);
    const result = await client.poll('t1');
    expect(result).toMatchObject({ status: 'completed', progress: 100, done: true });
    expect(await client.getOutput('t1')).toEqual({ type: 'download', url: 'https://cdn/v.mp4', filename: 'output.mp4' });
  });

  it('poll：succeeded 但缺少视频 URL 抛错', async () => {
    const client = createMinimaxH3Client(config);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { status: 'succeeded' } }),
    } as unknown as Response);
    await expect(client.poll('t1')).rejects.toThrow('缺少视频 URL');
  });

  it('poll：failed 返回错误信息，cancelled 映射为用户取消错误', async () => {
    const client = createMinimaxH3Client(config);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { status: 'failed', error: { code: '1026', message: 'sensitive' } } }),
    } as unknown as Response);
    const failed = await client.poll('t1');
    expect(failed).toMatchObject({ status: 'failed', done: true, errorMessage: 'sensitive' });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { status: 'cancelled' } }),
    } as unknown as Response);
    const cancelled = await client.poll('t2');
    expect(cancelled).toMatchObject({ status: 'failed', done: true, errorMessage: 'MiniMax 任务已被取消' });
  });

  it('getOutput：读取即删除，二次读取返回 null', async () => {
    const client = createMinimaxH3Client(config);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { status: 'succeeded', content: { url: 'https://cdn/v.mp4' } } }),
    } as unknown as Response);
    await client.poll('t1');
    expect(await client.getOutput('t1')).not.toBeNull();
    expect(await client.getOutput('t1')).toBeNull();
    expect(await client.getOutput('nope')).toBeNull();
  });

  it('cancel：DELETE 取消任务（携带鉴权头）', async () => {
    const client = createMinimaxH3Client(config);
    await expect(client.cancel('remote-1')).resolves.toBeUndefined();
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('http://mm/v2/video_generation/remote-1');
    expect((call[1] as RequestInit).method).toBe('DELETE');
    expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer k' });
  });

  it('cancel：远端拒绝（运行中不可取消）时抛错', async () => {
    const mock = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: 'task is running, cannot cancel' } }),
    } as unknown as Response));
    vi.stubGlobal('fetch', mock);
    const client = createMinimaxH3Client(config);
    await expect(client.cancel('remote-1')).rejects.toThrow('task is running, cannot cancel');
  });

  it('请求超时（AbortError）重映射为中文超时错误', async () => {
    const mock = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    vi.stubGlobal('fetch', mock);
    const client = createMinimaxH3Client(config);
    await expect(
      client.execute({
        workflowId: 'MiniMax-H3',
        params: { content: [{ type: 'text', text: 'x' }], duration: 5 },
      }),
    ).rejects.toThrow('MiniMax 创建任务请求超时（300s）');
  });

  it('分辨率缺省时使用 provider 配置默认值（768P）', async () => {
    const client = createMinimaxH3Client({ apiKey: 'k', baseUrl: 'http://mm', resolution: '768P' });
    await client.execute({
      workflowId: 'MiniMax-H3',
      params: { content: [{ type: 'text', text: 'x' }], duration: 5 },
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.resolution).toBe('768P');
  });

  it('testConnection 200 + status_code 2013 判定连接成功（Bearer 鉴权 GET 查询接口）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ base_resp: { status_code: 2013, status_msg: 'invalid params' } }),
    } as unknown as Response);

    const client = createMinimaxH3Client(config);
    const res = await client.testConnection();

    expect(res.ok).toBe(true);
    expect(res.message).toContain('连接成功');
    // 请求详情：GET + /v1/query/video_generation + Bearer 鉴权
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://mm/v1/query/video_generation');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ 'Authorization': 'Bearer k' });
  });

  it('testConnection 200 + status_code 1004 判定鉴权失败（login fail）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        base_resp: { status_code: 1004, status_msg: 'login fail: Please carry the API secret key in the Authorization field' },
      }),
    } as unknown as Response);

    const client = createMinimaxH3Client(config);
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    expect(res.message).toContain('鉴权未通过');
    expect(res.message).toContain('login fail');
  });

  it('testConnection 非 200 判定失败并回显状态码与响应体', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'bad key' } }),
      text: async () => '{"error":{"message":"bad key"}}',
    } as unknown as Response);

    const client = createMinimaxH3Client(config);
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    expect(res.message).toContain('401');
  });

  it('testConnection 网络异常判定失败', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const client = createMinimaxH3Client(config);
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    expect(res.message).toContain('network down');
  });
});
