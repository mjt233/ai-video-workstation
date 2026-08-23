import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectEditImages, createOpenAICompatibleClient } from './client.js';

describe('createOpenAICompatibleClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('文生图 POST /images/generations，url 响应缓存为 download', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://cdn/out.png' }] }),
    } as unknown as Response);

    const client = createOpenAICompatibleClient({ apiKey: 'k', baseUrl: 'https://api.openai.com/v1/', timeout: 120 });
    const { taskId } = await client.execute({
      workflowId: 'gpt-image-1',
      params: { prompt: '猫', size: '1024x1024' },
    });

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/generations');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Bearer k' });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'gpt-image-1', prompt: '猫', size: '1024x1024', n: 1 });
    expect(await client.getOutput(taskId)).toEqual({
      type: 'download',
      url: 'https://cdn/out.png',
      filename: 'output.png',
    });
  });

  it('b64_json 响应缓存为 body 输出', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'QUJD' }] }),
    } as unknown as Response);
    const client = createOpenAICompatibleClient({ apiKey: 'k', baseUrl: 'http://oai' });
    const { taskId } = await client.execute({ workflowId: 'm', params: { prompt: 'x' } });
    expect(await client.getOutput(taskId)).toEqual({
      type: 'body',
      contentType: 'image/png',
      data: 'QUJD',
      filename: 'output.png',
    });
  });

  it('图片编辑走 /images/edits multipart，单图字段名为 image', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://cdn/edit.png' }] }),
    } as unknown as Response);
    const file = new File(['img'], 'a.png', { type: 'image/png' });
    const client = createOpenAICompatibleClient({ apiKey: 'k', baseUrl: 'http://oai' });
    await client.execute({
      workflowId: 'gpt-image-1',
      params: { mode: 'edit', prompt: '改一下', size: '512x512' },
      files: { image: file },
    });
    expect(fetchMock.mock.calls[0][0]).toBe('http://oai/images/edits');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-image-1');
    expect(form.get('prompt')).toBe('改一下');
    expect(form.get('size')).toBe('512x512');
    expect(form.get('n')).toBe('1');
    expect(form.get('image')).toBeInstanceOf(File);
    expect(form.has('mode')).toBe(false);
  });

  it('多图编辑以 image[] 追加', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://cdn/edit.png' }] }),
    } as unknown as Response);
    const client = createOpenAICompatibleClient({ apiKey: 'k', baseUrl: 'http://oai' });
    await client.execute({
      workflowId: 'm',
      params: { mode: 'edit', prompt: '合成' },
      files: {
        image_0: new File(['a'], 'a.png', { type: 'image/png' }),
        image_1: new File(['b'], 'b.png', { type: 'image/png' }),
      },
    });
    const form = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(form.getAll('image[]')).toHaveLength(2);
    expect(form.get('image')).toBeNull();
  });

  it('poll 直接 completed；getOutput 读一次即删', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://cdn/out.png' }] }),
    } as unknown as Response);
    const client = createOpenAICompatibleClient({ apiKey: 'k', baseUrl: 'http://oai' });
    expect(await client.poll('x')).toMatchObject({ status: 'completed', done: true });
    const { taskId } = await client.execute({ workflowId: 'm', params: { prompt: 'x' } });
    expect(await client.getOutput(taskId)).not.toBeNull();
    expect(await client.getOutput(taskId)).toBeNull();
  });

  it('HTTP 错误抛出状态码与正文', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' } as unknown as Response);
    const client = createOpenAICompatibleClient({ apiKey: 'k', baseUrl: 'http://oai' });
    await expect(client.execute({ workflowId: 'm', params: { prompt: 'x' } })).rejects.toThrow('401');
  });

  it('testConnection GET /models，200 成功、非 200 失败', async () => {
    fetchMock.mockResolvedValue({ ok: true } as unknown as Response);
    const client = createOpenAICompatibleClient({ apiKey: 'k', baseUrl: 'http://oai/' });
    expect(await client.testConnection()).toMatchObject({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe('http://oai/models');

    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'nope' } as unknown as Response);
    const fail = await client.testConnection();
    expect(fail.ok).toBe(false);
    expect(fail.message).toContain('401');
  });
});

describe('collectEditImages', () => {
  it('单图 image + 按 image_n 排序', () => {
    const a = new File(['a'], 'a.png');
    const b = new File(['b'], 'b.png');
    const c = new File(['c'], 'c.png');
    expect(collectEditImages({ image: a, image_1: c, image_0: b })).toEqual([a, b, c]);
  });
});
