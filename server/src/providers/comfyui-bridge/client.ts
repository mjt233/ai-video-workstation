import type { ProviderClient, ResolvedProviderConfig, WorkflowOutput } from '../types.js';

/** Bridge 列表接口返回的工作流摘要（declaredParams 为 JSON 字符串） */
export interface BridgeWorkflowSummary {
  id: string;
  name: string;
  description?: string;
  declaredParams: string;
  tags: BridgeTagGroup[];
}

/** Bridge 详情接口返回的工作流详情（declaredParams 为解析数组） */
export interface BridgeWorkflowDetail {
  id: string;
  name: string;
  description?: string;
  /**
   * 额外声明的动态构建字段示例
   */
  declaredParams: BridgeDeclaredParam[];

  /**
   * 工作流本身固定参数字段
   */
  params: BridgeDeclaredParam[]

  tags: BridgeTagGroup[];
}

/** Bridge 参数下拉候选项（远端 wire 原始结构；label 为展示名，value 为提交值，映射时缺省项容错） */
export interface BridgeCandidate {
  /** 选项展示名（表单中可见文本）；缺省/为空时工作站回退为 value */
  label?: string | null;
  /** 选项提交值（实际提交到执行接口的值）；缺省/为空时该候选项被忽略 */
  value?: string | null;
}

/** 详情接口 declaredParams 元素 */
export interface BridgeDeclaredParam {
  alias: string;
  label?: string | null;
  paramType: 'text' | 'number' | 'boolean' | 'image' | 'video' | 'audio';
  defaultValue?: string | null;
  nodeRawValue?: string
  /**
   * 下拉候选项数组（元素为 { label: 展示名, value: 提交值 }）；
   * 仅 paramType = "text" 的字段生效，空数组/缺省表示未配置（按普通文本框渲染）
   */
  candidates?: BridgeCandidate[];
  /**
   * 是否多选（仅 text 且配置了候选项时为 true）；多选时各候选项 value
   * 以英文逗号 "," 拼接为一个字符串提交
   */
  multiple?: boolean;
}

/** Bridge 标签分组（父/子嵌套；metadata 为合并默认值后的完整元数据） */
export interface BridgeTagGroup {
  id: string;
  name?: string;
  metadata?: Record<string, unknown>;
  configuredMetadata?: Record<string, unknown>;
  tags?: BridgeTagGroup[];
}

/** Bridge 提供商实例列表接口返回的实例摘要（GET /api/providers，仅取所需字段） */
export interface BridgeProviderSummary {
  id: string;
  name: string;
  /** 实例类型：comfyui（ComfyUI 原生）或 runninghub（RunningHub 云端） */
  type: string;
  /** 是否启用（禁用的实例不能作为执行目标） */
  enabled?: boolean;
}

/** ComfyUI Bridge 客户端：传输能力 + 工作流列表/详情查询（后者供 bridge-sync 使用） */
export interface ComfyuiBridgeClient extends ProviderClient {
  /** 拉取工作流列表；tag 非空时按标签筛选（GET /api/workflows[?tags=]） */
  listWorkflows(tag?: string): Promise<BridgeWorkflowSummary[]>;
  /** 拉取单个工作流详情（GET /api/workflows/:id，declaredParams 为解析数组） */
  getWorkflowDetail(id: string): Promise<BridgeWorkflowDetail>;
  /** 拉取 Bridge 的提供商实例列表（GET /api/providers，需认证） */
  listProviders(): Promise<BridgeProviderSummary[]>;
  /** 连接测试：验证连通性 + 鉴权（登录成功即通过） */
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

/**
 * 创建 ComfyUI Easy Bridge 传输客户端。
 *
 * - baseUrl / password 来自已解析配置（文件值 > COMFYUI_BRIDGE_URL/COMFYUI_BRIDGE_PASSWORD > 默认值）；
 * - token 缓存按客户端实例持有：配置变更后引擎重新 createClient，即用新配置（含新 token）；
 * - 提交无需认证；poll / getOutput 首次调用时自动登录获取 token。
 *
 * @param config 已解析的 provider 配置（含 baseUrl / password）
 * @returns ComfyuiBridgeClient
 */
export function createComfyuiBridgeClient(config: ResolvedProviderConfig): ComfyuiBridgeClient {
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
      // 保留键 providerId：本次执行显式指定的执行端实例 ID（仅当非空时携带）；
      // JSON 模式为请求体顶层字段，multipart 模式为独立表单字段（不进 params JSON）。
      const providerId = typeof p.providerId === 'string' && p.providerId.trim() !== '' ? p.providerId.trim() : undefined;

      let res: Response;
      if (hasFiles) {
        const form = new FormData();
        form.append('params', JSON.stringify(p.params ?? {}));
        if (providerId) form.append('providerId', providerId);
        for (const [alias, file] of fileEntries) {
          form.append(alias, file);
        }
        // 不手动设置 Content-Type，由 fetch 自动带 multipart boundary
        res = await fetch(url, { method: 'POST', body: form });
      } else {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // providerId 后置展开，保证保留键优先于同名工作流参数
          body: JSON.stringify({ ...(p.params ?? {}), ...(providerId ? { providerId } : {}) }),
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

    async listWorkflows(tag?: string) {
      const token = await ensureToken();
      const url = `${baseUrl}/api/workflows${tag ? `?tags=${encodeURIComponent(tag)}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge list workflows failed (${res.status}): ${text}`);
      }
      return (await res.json()) as BridgeWorkflowSummary[];
    },

    async getWorkflowDetail(id) {
      const token = await ensureToken();
      const res = await fetch(`${baseUrl}/api/workflows/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge workflow detail failed (${res.status}): ${text}`);
      }
      return (await res.json()) as BridgeWorkflowDetail;
    },

    async listProviders() {
      const token = await ensureToken();
      const res = await fetch(`${baseUrl}/api/providers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge list providers failed (${res.status}): ${text}`);
      }
      return (await res.json()) as BridgeProviderSummary[];
    },

    async testConnection(): Promise<{ ok: boolean; message: string }> {
      try {
        await ensureToken();
        return { ok: true, message: '连接成功，鉴权通过' };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
