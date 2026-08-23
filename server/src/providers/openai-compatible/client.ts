import { randomUUID } from 'crypto';
import type { ProviderClient, ResolvedProviderConfig, WorkflowOutput } from '../types.js';

/** OpenAI Images 响应中的单张图片 */
interface OpenAIImageData {
  url?: string;
  b64_json?: string;
}

/** OpenAI 兼容客户端：传输能力 + 连接测试 */
export interface OpenAICompatibleClient extends ProviderClient {
  /** 连接测试：GET {baseUrl}/models 验证鉴权与连通性（Bearer apiKey；HTTP 200 即通过） */
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

/**
 * 创建 OpenAI Images 兼容传输客户端。
 *
 * OpenAI Images 是「同步」API（一次请求直接返回结果），本客户端把它适配为任务式 ProviderClient：
 * - execute：文生图 POST {baseUrl}/images/generations（JSON）；图片编辑 POST {baseUrl}/images/edits（multipart）；
 *   同步等待完成，把输出规格缓存到内存 Map；
 * - poll：直接返回 completed（execute 已同步完成）；
 * - getOutput：从缓存返回输出（download 或 body）；
 * - cancel：no-op（同步请求已结束，无法中止；中断走 deferredCancel 标记机制）；
 * - testConnection：GET {baseUrl}/models（Bearer 鉴权），200 即连接正常。
 *
 * @param config 已解析配置（apiKey / baseUrl / timeout）
 * @returns ProviderClient
 */
export function createOpenAICompatibleClient(config: ResolvedProviderConfig): OpenAICompatibleClient {
  const apiKey = String(config.apiKey ?? '');
  const baseUrl = String(config.baseUrl ?? '').replace(/\/+$/, '');
  const timeoutSec = Number(config.timeout ?? 120);
  const timeoutMs = (Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 120) * 1000;

  const outputs = new Map<string, WorkflowOutput>();

  return {
    async execute(p) {
      if (!baseUrl) throw new Error('OpenAI 兼容 API 地址未配置');
      const params = { ...(p.params ?? {}) };
      const isEdit = params.mode === 'edit';
      delete params.mode;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = isEdit
          ? await postImageEdit(baseUrl, apiKey, p.workflowId, params, p.files ?? {}, controller.signal)
          : await postImageGeneration(baseUrl, apiKey, p.workflowId, params, controller.signal);
        if (!res.ok) {
          const text = (await res.text()).trim() || '(empty body)';
          throw new Error(`OpenAI 兼容 API 错误 (${res.status}): ${text}`);
        }
        const data = (await res.json()) as { data?: OpenAIImageData[] };
        const images = data.data ?? [];
        if (images.length === 0) {
          throw new Error('OpenAI 兼容响应无图片数据');
        }
        const first = images[0];
        const taskId = randomUUID();
        if (first.url) {
          outputs.set(taskId, { type: 'download', url: first.url, filename: 'output.png' });
        } else if (first.b64_json) {
          outputs.set(taskId, { type: 'body', contentType: 'image/png', data: first.b64_json, filename: 'output.png' });
        } else {
          throw new Error('OpenAI 兼容响应图片缺少 url/b64_json');
        }
        return { taskId };
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new Error(`OpenAI 兼容请求超时（${Math.round(timeoutMs / 1000)}s）`, { cause: e });
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },

    async poll() {
      return { status: 'completed', progress: 100, done: true, errorMessage: null };
    },

    async getOutput(taskId): Promise<WorkflowOutput | null> {
      const out = outputs.get(taskId);
      outputs.delete(taskId);
      return out ?? null;
    },

    async cancel() {
      // 同步请求已在 execute 内完成，无法中止；幂等 no-op
    },

    async testConnection(): Promise<{ ok: boolean; message: string }> {
      if (!baseUrl) return { ok: false, message: 'API 地址未配置' };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      try {
        const res = await fetch(`${baseUrl}/models`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = (await res.text()).trim() || '(空响应体)';
          return { ok: false, message: `连接失败（HTTP ${res.status}）: ${text}` };
        }
        return { ok: true, message: '连接成功（HTTP 200）' };
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          return { ok: false, message: '连接超时（10s）' };
        }
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * 提交文生图：POST {baseUrl}/images/generations（JSON）。
 *
 * @param baseUrl API 基础地址（已去尾斜杠）
 * @param apiKey Bearer Token
 * @param model 模型 ID
 * @param params 其余 JSON 字段（prompt / size 等）
 * @param signal 超时中止信号
 * @returns fetch Response
 */
async function postImageGeneration(
  baseUrl: string,
  apiKey: string,
  model: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  const body: Record<string, unknown> = { ...params, model, n: 1 };
  return fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * 提交图片编辑：POST {baseUrl}/images/edits（multipart）。
 *
 * 单图文件键 `image` 以字段名 `image` 上传；多图（`image_0` / `image_1` / … 或
 * 多个 `image`）以字段名 `image[]` 依次追加，兼容部分网关的多图约定。
 *
 * @param baseUrl API 基础地址（已去尾斜杠）
 * @param apiKey Bearer Token
 * @param model 模型 ID
 * @param params 文本字段（prompt / size 等）
 * @param files 参考图文件
 * @param signal 超时中止信号
 * @returns fetch Response
 */
async function postImageEdit(
  baseUrl: string,
  apiKey: string,
  model: string,
  params: Record<string, unknown>,
  files: Record<string, File>,
  signal: AbortSignal,
): Promise<Response> {
  const form = new FormData();
  form.append('model', model);
  form.append('n', '1');
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    form.append(key, String(value));
  }
  const images = collectEditImages(files);
  if (images.length === 0) {
    throw new Error('OpenAI 兼容图片编辑至少需要一张参考图');
  }
  if (images.length === 1) {
    form.append('image', images[0], images[0].name || 'image.png');
  } else {
    for (const img of images) {
      form.append('image[]', img, img.name || 'image.png');
    }
  }
  return fetch(`${baseUrl}/images/edits`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: form,
    signal,
  });
}

/**
 * 按约定收集编辑参考图：优先 `image`，再按 `image_0` / `image_1` … 顺序追加。
 *
 * @param files execute 传入的文件字典
 * @returns 有序参考图列表
 */
export function collectEditImages(files: Record<string, File>): File[] {
  const out: File[] = [];
  if (files.image) out.push(files.image);
  const indexed = Object.keys(files)
    .map((k) => {
      const m = /^image_(\d+)$/.exec(k);
      return m ? { i: Number(m[1]), file: files[k] } : null;
    })
    .filter((x): x is { i: number; file: File } => !!x)
    .sort((a, b) => a.i - b.i);
  for (const item of indexed) out.push(item.file);
  return out;
}
