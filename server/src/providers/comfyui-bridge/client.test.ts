import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComfyuiBridgeClient } from './client.js';

describe('createComfyuiBridgeClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('execute 使用配置中的 baseUrl 构造 URL（JSON 提交，无文件）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 't1', status: 'accepted', comfyui_response: {} }),
    } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://my-bridge:9999/', password: 'pw' });
    const result = await client.execute({
      workflowId: 'text_to_image',
      params: { prompt: '描述', width: 1080, height: 1920 },
    });

    expect(result.taskId).toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://my-bridge:9999/api/workflows/text_to_image/execute');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('execute 带文件时走 multipart，params 为 JSON 字符串，文件键保留', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 't2', status: 'accepted', comfyui_response: {} }),
    } as unknown as Response);

    const file = new File(['dummy'], 'a.png', { type: 'image/png' });
    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    await client.execute({ workflowId: 'qwen-edit-2509', params: { desc: '编辑' }, files: { image_0: file } });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(JSON.parse(form.get('params') as string)).toEqual({ desc: '编辑' });
    expect(form.get('image_0')).toBe(file);
  });

  it('poll 自动登录获取 token，completed 视为 done，请求带 Bearer', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'abc' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed', progress: 100 }) } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    const result = await client.poll('task-1');

    expect(result.status).toBe('completed');
    expect(result.done).toBe(true);
    expect(result.progress).toBe(100);
    expect(fetchMock.mock.calls[0][0]).toBe('http://b/api/auth/login');
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toContain('pw');
    expect(fetchMock.mock.calls[1][0]).toBe('http://b/api/tasks/task-1');
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toEqual({ Authorization: 'Bearer abc' });
  });

  it('failed 状态视为 done', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'abc' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'failed', errorMessage: 'boom' }) } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    const result = await client.poll('task-1');
    expect(result.done).toBe(true);
    expect(result.errorMessage).toBe('boom');
  });

  it('token 缓存按 client 实例持有：同一实例多次 poll 只登录一次', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'abc' }) } as unknown as Response)
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'running', progress: 10 }) } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    await client.poll('task-1');
    await client.poll('task-1');
    // 1 次 login + 2 次 poll
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('getOutput 返回 fetch 类型输出（相对 url 拼接 baseUrl，含认证 header）', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'abc' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [{ url: '/api/tasks/task-1/outputs/a.png' }] }) } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    const out = await client.getOutput('task-1');

    expect(out).not.toBeNull();
    expect(out!.type).toBe('fetch');
    const fetchOut = out as { type: 'fetch'; request: { url: string; headers: Record<string, string> }; filename: string };
    expect(fetchOut.request.url).toBe('http://b/api/tasks/task-1/outputs/a.png');
    expect(fetchOut.request.headers.Authorization).toBe('Bearer abc');
    expect(fetchOut.filename).toBe('a.png');
  });

  it('getOutput 无输出文件时返回 null', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'abc' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [] }) } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    expect(await client.getOutput('task-1')).toBeNull();
  });

  it('cancel 调用 /api/tasks/:id/cancel', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ task_id: 'task-1', status: 'failed' }) } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    await client.cancel('task-1');

    expect(fetchMock.mock.calls[0][0]).toBe('http://b/api/tasks/task-1/cancel');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });

  it('execute 非 2xx 时抛错（含 status 与响应文本）', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom body',
    } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    await expect(
      client.execute({ workflowId: 'text_to_image', params: {} }),
    ).rejects.toThrow('Bridge submit failed (500): boom body');
  });

  describe('listWorkflows / getWorkflowDetail', () => {
    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'tok' }) } as unknown as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ([{ id: 'text_to_image', name: '文生图', declaredParams: '[]', tags: [] }]) } as unknown as Response);
    });

    it('listWorkflows 带标签时拼 tags 查询参数', async () => {
      const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
      const list = await client.listWorkflows('auto');
      expect(list[0].id).toBe('text_to_image');
      const url = fetchMock.mock.calls[1][0] as string;
      expect(url).toContain('/api/workflows?tags=auto');
    });

    it('listWorkflows 不带标签时不带查询参数', async () => {
      const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
      await client.listWorkflows();
      const url = fetchMock.mock.calls[1][0] as string;
      expect(url).toBe('http://b/api/workflows');
    });

    it('getWorkflowDetail 返回解析数组并带 Bearer', async () => {
      fetchMock.mockReset();
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'tok' }) } as unknown as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'qwen-edit-2509', name: '编辑', declaredParams: [{ alias: 'prompt', label: '提示词', paramType: 'text' }], tags: [] }) } as unknown as Response);
      const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
      const detail = await client.getWorkflowDetail('qwen-edit-2509');
      expect(detail.declaredParams[0].alias).toBe('prompt');
      const init = fetchMock.mock.calls[1][1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    });
  });

  describe('execute providerId 保留键', () => {
    it('JSON 模式：providerId 作为请求体顶层字段', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ task_id: 't3', status: 'accepted', comfyui_response: {} }) } as unknown as Response);
      const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
      await client.execute({ workflowId: 'text_to_image', params: { prompt: 'p' }, providerId: 'inst-1' });
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.prompt).toBe('p');
      expect(body.providerId).toBe('inst-1');
    });

    it('JSON 模式：不带 providerId 时请求体不含该键', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ task_id: 't', status: 'accepted', comfyui_response: {} }) } as unknown as Response);
      const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
      await client.execute({ workflowId: 'text_to_image', params: { prompt: 'p' } });
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect('providerId' in body).toBe(false);
    });

    it('multipart 模式：providerId 为独立表单字段（不进入 params JSON）', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ task_id: 't4', status: 'accepted', comfyui_response: {} }) } as unknown as Response);
      const file = new File(['dummy'], 'a.png', { type: 'image/png' });
      const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
      await client.execute({ workflowId: 'qwen-edit-2509', params: { desc: '编辑' }, files: { image_0: file }, providerId: 'inst-2' });
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const form = init.body as FormData;
      expect(JSON.parse(form.get('params') as string)).toEqual({ desc: '编辑' });
      expect(form.get('providerId')).toBe('inst-2');
    });

    it('multipart 模式：不带 providerId 时表单无该字段', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ task_id: 't', status: 'accepted', comfyui_response: {} }) } as unknown as Response);
      const file = new File(['dummy'], 'a.png', { type: 'image/png' });
      const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
      await client.execute({ workflowId: 'qwen-edit-2509', params: {}, files: { image_0: file } });
      const form = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
      expect(form.get('providerId')).toBeNull();
    });

    it('providerId 为空串时不携带', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ task_id: 't', status: 'accepted', comfyui_response: {} }) } as unknown as Response);
      const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
      await client.execute({ workflowId: 'text_to_image', params: {}, providerId: '  ' });
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect('providerId' in body).toBe(false);
    });
  });

  describe('listProviders', () => {
    it('自动登录并 GET /api/providers 带 Bearer，返回实例数组', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'tok' }) } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ([
            { id: 'p1', name: '本地 ComfyUI', type: 'comfyui', enabled: true },
            { id: 'p2', name: 'RunningHub 24G', type: 'runninghub', enabled: false },
          ]),
        } as unknown as Response);
      const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
      const list = await client.listProviders();
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe('p1');
      expect(list[1].type).toBe('runninghub');
      expect(fetchMock.mock.calls[0][0]).toBe('http://b/api/auth/login');
      expect(fetchMock.mock.calls[1][0]).toBe('http://b/api/providers');
      expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toEqual({ Authorization: 'Bearer tok' });
    });

    it('非 2xx 抛错', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'tok' }) } as unknown as Response)
        .mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'upstream down' } as unknown as Response);
      const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
      await expect(client.listProviders()).rejects.toThrow('Bridge list providers failed (502): upstream down');
    });
  });
});
