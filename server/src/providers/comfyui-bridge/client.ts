import type { ProviderClient, ResolvedProviderConfig, WorkflowOutput } from '../types.js';

/**
 * 创建 ComfyUI Easy Bridge 传输客户端。
 *
 * - baseUrl / password 来自已解析配置（文件值 > COMFYUI_BRIDGE_URL/COMFYUI_BRIDGE_PASSWORD > 默认值）；
 * - token 缓存按客户端实例持有：配置变更后引擎重新 createClient，即用新配置（含新 token）；
 * - 提交无需认证；poll / getOutput 首次调用时自动登录获取 token。
 *
 * @param config 已解析的 provider 配置（含 baseUrl / password）
 * @returns ProviderClient
 */
export function createComfyuiBridgeClient(config: ResolvedProviderConfig): ProviderClient {
  const baseUrl = String(config.baseUrl ?? 'http://localhost:10721').replace(/\/+$/, '');
  const password = String(config.password ?? '0d000721');

  let authToken: string | null = null;
  let tokenExpiry = 0;

  /** 获取认证 token（缓存 30 分钟；过期或缺失时登录） */
  async function ensureToken(): Promise<string> {
    if (authToken && Date.now() < tokenExpiry) {
      return authToken;
    }
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bridge auth failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as { token: string };
    authToken = data.token;
    // Token 有效期未知，保守缓存 30 分钟
    tokenExpiry = Date.now() + 30 * 60 * 1000;
    return authToken;
  }

  return {
    async execute(p) {
      const url = `${baseUrl}/api/workflows/${p.workflowId}/execute`;
      const fileEntries = Object.entries(p.files ?? {});
      const hasFiles = fileEntries.length > 0;

      let res: Response;
      if (hasFiles) {
        const form = new FormData();
        form.append('params', JSON.stringify(p.params ?? {}));
        for (const [alias, file] of fileEntries) {
          form.append(alias, file);
        }
        // 不手动设置 Content-Type，由 fetch 自动带 multipart boundary
        res = await fetch(url, { method: 'POST', body: form });
      } else {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p.params ?? {}),
        });
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge submit failed (${res.status}): ${text}`);
      }

      const data = (await res.json()) as {
        task_id: string;
        status: string;
        comfyui_response: unknown;
      };
      return { taskId: data.task_id };
    },

    async poll(taskId) {
      const token = await ensureToken();
      const res = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge poll failed (${res.status}): ${text}`);
      }
      const data = (await res.json()) as {
        status: string;
        progress?: number;
        errorMessage?: string | null;
      };
      const done = data.status === 'completed' || data.status === 'failed';
      return {
        status: data.status,
        progress: data.progress ?? 0,
        done,
        errorMessage: data.errorMessage ?? null,
      };
    },

    async getOutput(taskId): Promise<WorkflowOutput | null> {
      const token = await ensureToken();
      const res = await fetch(`${baseUrl}/api/tasks/${taskId}/output-files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge output-files failed (${res.status}): ${text}`);
      }
      const data = (await res.json()) as { files?: Array<{ url: string }> };
      const files = data.files ?? [];
      if (files.length === 0) return null;

      const url = files[0].url.startsWith('http') ? files[0].url : `${baseUrl}${files[0].url}`;
      const filename = url.split('/').pop()?.split('?')[0] ?? 'output.png';
      return {
        type: 'fetch',
        request: { url, method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        filename,
      };
    },

    async cancel(taskId) {
      const res = await fetch(`${baseUrl}/api/tasks/${taskId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge cancel failed (${res.status}): ${text}`);
      }
      await res.json();
    },
  };
}
