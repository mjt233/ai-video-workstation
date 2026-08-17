import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVolcengineArkClient, fileToDataUrl } from './client.js';

describe('createVolcengineArkClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('execute 同步提交 images/generations，url 响应缓存为 download 输出', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://tos/out.jpg' }] }),
    } as unknown as Response);

    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark/', timeout: 900 });
    const { taskId } = await client.execute({
      workflowId: 'doubao-seedream-5-0-pro-260628',
      params: { prompt: '猫', size: '1080x1920', watermark: false, output_format: 'jpeg', response_format: 'url' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://ark/images/generations');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'Authorization': 'Bearer k' });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('doubao-seedream-5-0-pro-260628');
    expect(body.watermark).toBe(false);

    const out = await client.getOutput(taskId);
    expect(out).toEqual({ type: 'download', url: 'https://tos/out.jpg', filename: 'output.jpg' });
  });

  it('b64_json 响应缓存为 body 输出', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'QUJD' }] }),
    } as unknown as Response);

    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    const { taskId } = await client.execute({ workflowId: 'm', params: { prompt: 'x' } });
    const out = await client.getOutput(taskId);
    expect(out).toEqual({ type: 'body', contentType: 'image/jpeg', data: 'QUJD', filename: 'output.jpg' });
  });

  it('files 逐键转 data URL 合并进 body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://tos/out.jpg' }] }),
    } as unknown as Response);

    const file = new File(['hello'], 'a.png', { type: 'image/png' });
    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    await client.execute({ workflowId: 'm', params: { prompt: 'x' }, files: { image: file } });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.image).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('poll 直接返回 completed（同步 API）', async () => {
    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    const result = await client.poll('any');
    expect(result.status).toBe('completed');
    expect(result.done).toBe(true);
  });

  it('getOutput 无缓存返回 null', async () => {
    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    expect(await client.getOutput('nope')).toBeNull();
  });

  it('getOutput 删除即读：二次读取返回 null（防止缓存无界增长）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://tos/out.jpg' }] }),
    } as unknown as Response);

    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    const { taskId } = await client.execute({ workflowId: 'm', params: { prompt: 'x' } });
    expect(await client.getOutput(taskId)).toEqual({ type: 'download', url: 'https://tos/out.jpg', filename: 'output.jpg' });
    expect(await client.getOutput(taskId)).toBeNull();
  });

  it('cancel 为 no-op（不抛错）', async () => {
    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    await expect(client.cancel('any')).resolves.toBeUndefined();
  });

  it('execute 非 2xx 抛带状态错误', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"bad key"}}',
    } as unknown as Response);

    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    await expect(client.execute({ workflowId: 'm', params: {} })).rejects.toThrow('火山方舟 API 错误 (401)');
  });

  it('execute 响应 data 为空数组抛错', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as unknown as Response);

    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    await expect(client.execute({ workflowId: 'm', params: {} })).rejects.toThrow('火山方舟响应无图片数据');
  });

  it('execute 响应图片缺少 url/b64_json 抛错', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [{}] }) } as unknown as Response);
    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    await expect(client.execute({ workflowId: 'm', params: {} })).rejects.toThrow('缺少 url/b64_json');
  });

  it('execute 超时（AbortError）重映射为中文超时错误', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    await expect(client.execute({ workflowId: 'm', params: {} })).rejects.toThrow('火山方舟请求超时（900s）');
  });

  it('execute 非超时异常原样抛出', async () => {
    const boom = new Error('network down');
    fetchMock.mockRejectedValue(boom);
    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    await expect(client.execute({ workflowId: 'm', params: {} })).rejects.toThrow('network down');
  });

  it('testConnection 200 返回 ok:true 并携带任务总数（Bearer 鉴权 GET 任务列表）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ total: 0, items: [] }),
    } as unknown as Response);

    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    const res = await client.testConnection();

    expect(res.ok).toBe(true);
    expect(res.message).toContain('连接成功');
    expect(res.message).toContain('0');
    // 请求详情：GET + 任务列表路由 + Bearer 鉴权
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ark/contents/generations/tasks?page_size=3&filter.status=succeeded');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'Authorization': 'Bearer k' });
  });

  it('testConnection 非 200 返回 ok:false 并携带状态与错误信息（如密钥格式错误）', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"code":"AuthenticationError","message":"The API key format is incorrect."}}',
    } as unknown as Response);

    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    expect(res.message).toContain('401');
    expect(res.message).toContain('AuthenticationError');
  });

  it('testConnection 网络异常返回 ok:false', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    expect(res.message).toContain('network down');
  });

  it('fileToDataUrl 生成 data URL', async () => {
    const file = new File(['hello'], 'a.png', { type: 'image/png' });
    expect(await fileToDataUrl(file)).toBe('data:image/png;base64,aGVsbG8=');
  });
});
