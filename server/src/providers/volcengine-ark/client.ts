import { randomUUID } from 'crypto';
import type { ProviderClient, ResolvedProviderConfig, WorkflowOutput } from '../types.js';

/** 方舟图片生成响应（OpenAI 兼容 images/generations） */
interface ArkImageData {
  url?: string;
  b64_json?: string;
}

/** 火山方舟客户端：传输能力 + 连接测试 */
export interface VolcengineArkClient extends ProviderClient {
  /** 连接测试：GET 任务列表接口验证鉴权与连通性（Bearer apiKey；HTTP 200 即通过） */
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

/**
 * 创建火山方舟传输客户端。
 *
 * 方舟图片生成是「同步」API（一次请求直接返回结果），本客户端把其适配为任务式 ProviderClient：
 * - execute：POST {baseUrl}/images/generations，同步等待完成，把输出规格缓存到内存 Map；
 * - poll：直接返回 completed（execute 已同步完成）；
 * - getOutput：从缓存返回输出（download 或 body）；
 * - cancel：no-op（同步请求已结束，无法中止；中断走 deferredCancel 标记机制）；
 * - testConnection：GET {baseUrl}/contents/generations/tasks（Bearer 鉴权），200 即连接正常。
 *
 * @param config 已解析配置（apiKey / baseUrl / timeout）
 * @returns ProviderClient
 */
export function createVolcengineArkClient(config: ResolvedProviderConfig): VolcengineArkClient {
  const apiKey = String(config.apiKey ?? '');
  const baseUrl = String(config.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  // 超时下限钳制：非法/非正数回退默认 900s，防止 0/NaN 导致 setTimeout 立即触发
  const timeoutSec = Number(config.timeout ?? 900);
  const timeoutMs = (Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 900) * 1000;

  const outputs = new Map<string, WorkflowOutput>();

  return {
    async execute(p) {
      // workflowId 即方舟模型 ID，映射为 body.model（params 里也可能带 model，二者一致）
      const body: Record<string, unknown> = { ...(p.params ?? {}), model: p.workflowId };
      // files 逐键转为 base64 data URL 合并进 body（如单图 files.image → body.image）
      for (const [key, file] of Object.entries(p.files ?? {})) {
        body[key] = await fileToDataUrl(file);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = (await res.text()).trim() || '(empty body)';
          throw new Error(`火山方舟 API 错误 (${res.status}): ${text}`);
        }
        const data = (await res.json()) as { data?: ArkImageData[] };
        const images = data.data ?? [];
        if (images.length === 0) {
          throw new Error('火山方舟响应无图片数据');
        }
        const first = images[0];
        const taskId = randomUUID();
        if (first.url) {
          outputs.set(taskId, { type: 'download', url: first.url, filename: 'output.jpg' });
        } else if (first.b64_json) {
          outputs.set(taskId, { type: 'body', contentType: 'image/jpeg', data: first.b64_json, filename: 'output.jpg' });
        } else {
          throw new Error('火山方舟响应图片缺少 url/b64_json');
        }
        return { taskId };
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new Error(`火山方舟请求超时（${Math.round(timeoutMs / 1000)}s）`, { cause: e });
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },

    async poll() {
      // 同步 API：execute 已同步完成，直接视为 done
      return { status: 'completed', progress: 100, done: true, errorMessage: null };
    },

    async getOutput(taskId): Promise<WorkflowOutput | null> {
      // 引擎在任务完成后只读取一次输出，读取即删除防止 Map 无界增长
      const out = outputs.get(taskId);
      outputs.delete(taskId);
      return out ?? null;
    },

    async cancel() {
      // 同步请求已在 execute 内完成，无法中止；幂等 no-op
    },

    async testConnection(): Promise<{ ok: boolean; message: string }> {
      // 调用推理 API 的「任务列表」接口验证连通性与鉴权：
      //   GET {baseUrl}/contents/generations/tasks?page_size=3&filter.status=succeeded
      //   Authorization: Bearer {apiKey}
      // HTTP 200（如 {"total":0,"items":[]}）视为连接正常并附任务总数；
      // 非 200（如 401 AuthenticationError「API key 格式不正确」）视为失败并回显服务端错误。
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      try {
        const url = new URL(`${baseUrl}/contents/generations/tasks`);
        url.searchParams.set('page_size', '3');
        url.searchParams.set('filter.status', 'succeeded');
        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = (await res.text()).trim() || '(空响应体)';
          return { ok: false, message: `连接失败（HTTP ${res.status}）: ${text}` };
        }
        let total: number | undefined;
        try {
          const data = (await res.json()) as { total?: number };
          if (typeof data.total === 'number') total = data.total;
        } catch {
          // 非 JSON 响应不影响成功判定
        }
        return total !== undefined
          ? { ok: true, message: `连接成功（HTTP 200，任务列表 ${total} 条）` }
          : { ok: true, message: '连接成功（HTTP 200）' };
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
 * 把 File 转成 base64 data URL（供方舟 image 字段使用）。
 * @param file 图片文件
 * @returns data:image/...;base64,...
 */
export async function fileToDataUrl(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  return `data:${file.type || 'image/jpeg'};base64,${buf.toString('base64')}`;
}
