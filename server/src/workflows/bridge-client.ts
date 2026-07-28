/**
 * ComfyUI Bridge Client
 *
 * 封装对 comfyui-easy-bridge 的 HTTP 调用，提供：
 * - 通用工作流执行 (POST /api/workflows/:id/execute)，支持 JSON 与 multipart/form-data
 * - 任务状态轮询 (GET /api/tasks/:taskId)
 * - 输出文件列表获取 (GET /api/tasks/:taskId/output-files)
 * - createTextToImageWorkflow — 文生图工作流快捷工厂
 *
 * 认证方式：submit 无需认证，status/output-files 需要 Bearer token。
 * 首次调用 status/output-files 时自动登录获取 token 并缓存。
 */

import type { WorkflowDefinition, WorkflowParams, WorkflowBaseDefinition } from './types.js';

const BRIDGE_URL = (process.env.COMFYUI_BRIDGE_URL || 'http://localhost:10721').replace(/\/+$/, '');
const BRIDGE_PASSWORD = process.env.COMFYUI_BRIDGE_PASSWORD || '0d000721';

// ── Auth token cache ────────────────────────────────────────────────
let authToken: string | null = null;
let tokenExpiry = 0;

async function ensureToken(): Promise<string> {
  if (authToken && Date.now() < tokenExpiry) {
    return authToken;
  }

  const res = await fetch(`${BRIDGE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: BRIDGE_PASSWORD }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bridge auth failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { token: string };
  authToken = data.token;
  // Token 有效期未知，保守缓存 30 分钟
  tokenExpiry = Date.now() + 30 * 60 * 1000;
  return authToken;
}

// ── Public API ──────────────────────────────────────────────────────

export interface SubmitTextToImageParams {
  /** 图片描述提示词 */
  imd_desc: string;
  /** 图片宽度（像素） */
  width: number;
  /** 图片高度（像素） */
  height: number;
  /** 随机种子（可选） */
  seed?: number;
}

export interface BridgeSubmitResult {
  taskId: string;
  comfyuiResponse: unknown;
}

export interface ComfyuiBridgeExecuteParams {
  /**
   * 工作流id
   */
  workflowId: string

  /**
   * 工作流参数，key为工作流参数字段别名，value为字段值
   */
  params?: Record<string, unknown>

  /**
   * 需要上传的文件。
   * key为工作流参数中需要加载文件的字段别名
   * value为本地文件
   */
  files?: Record<string, File>
}

/**
 * 提交工作流执行到 ComfyUI Bridge。
 * - 无文件：JSON body（方式 A）
 * - 有文件：multipart/form-data，params 为 JSON 字符串，文件按 alias 字段上传（方式 B）
 */
export async function submitComfyuiBridge(executeParams: ComfyuiBridgeExecuteParams): Promise<BridgeSubmitResult> {
  const url = `${BRIDGE_URL}/api/workflows/${executeParams.workflowId}/execute`;
  const fileEntries = Object.entries(executeParams.files ?? {});
  const hasFiles = fileEntries.length > 0;

  let res: Response;
  if (hasFiles) {
    const form = new FormData();
    form.append('params', JSON.stringify(executeParams.params || {}));
    for (const [alias, file] of fileEntries) {
      form.append(alias, file);
    }
    // 不手动设置 Content-Type，由 fetch 自动带 multipart boundary
    res = await fetch(url, {
      method: 'POST',
      body: form,
    });
  } else {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(executeParams.params ?? {}),
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bridge submit failed (${res.status}): ${text}`);
  }

  const data = await res.json() as {
    task_id: string;
    status: string;
    comfyui_response: unknown;
  };

  return {
    taskId: data.task_id,
    comfyuiResponse: data.comfyui_response,
  };
}

interface SubmitImageEditParams {
  imgs: File[],
  desc: string,
  seed?: string | number
}

export async function submitImageEdit(params: SubmitImageEditParams): Promise<BridgeSubmitResult> {
  const files: Record<string, File> = {};
  params.imgs.forEach((f, idx) => {
    files[`img${idx + 1}`] = f;
  });
  const textParams: Record<string, unknown> = { desc: params.desc };
  if (params.seed != null) {
    textParams.seed = params.seed;
  }
  return submitComfyuiBridge({
    workflowId: `img_edit_${params.imgs.length}`,
    params: textParams,
    files,
  });
}

/**
 * 提交文生图任务到 ComfyUI Bridge
 * POST /api/workflows/text_to_image/execute
 */
export async function submitTextToImage(params: SubmitTextToImageParams): Promise<BridgeSubmitResult> {
  const body: Record<string, unknown> = {
    imd_desc: params.imd_desc,
    width: params.width,
    height: params.height
  };
  if (params.seed != null) {
    body.seed = params.seed;
  }
  return submitComfyuiBridge({
    workflowId: 'text_to_image',
    params: body
  })
}

export interface BridgeTaskStatus {
  status: string;
  progress: number;
  outputFiles: Array<{
    filename: string;
    subfolder: string;
    type: string;
    nodeId: string;
    fileType: string;
    url: string;
  }> | null;
  errorMessage: string | null;
}

/**
 * 轮询任务状态
 * GET /api/tasks/:taskId
 */
export async function pollTask(taskId: string): Promise<BridgeTaskStatus> {
  const token = await ensureToken();

  const res = await fetch(`${BRIDGE_URL}/api/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bridge poll failed (${res.status}): ${text}`);
  }

  const data = await res.json() as {
    status: string;
    progress?: number;
    outputFiles?: Array<{
      filename: string;
      subfolder: string;
      type: string;
      nodeId: string;
      fileType: string;
      url: string;
    }> | null;
    errorMessage?: string | null;
  };

  return {
    status: data.status,
    progress: data.progress ?? 0,
    outputFiles: data.outputFiles ?? null,
    errorMessage: data.errorMessage ?? null,
  };
}

export interface BridgeOutputFile {
  filename: string;
  subfolder: string;
  type: string;
  nodeId: string;
  fileType: string;
  /** 桥接服务上的相对路径 */
  url: string;
}

/**
 * 获取任务的输出文件列表
 * GET /api/tasks/:taskId/output-files
 */
export async function getTaskOutputFiles(taskId: string): Promise<BridgeOutputFile[]> {
  const token = await ensureToken();

  const res = await fetch(`${BRIDGE_URL}/api/tasks/${taskId}/output-files`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bridge output-files failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { files: BridgeOutputFile[] };
  return data.files ?? [];
}

/**
 * 构建输出文件的完整下载 URL（含认证 header 信息）
 * 返回 fetch 类型的请求参数，引擎会携带 auth header 下载文件
 */
export async function buildDownloadRequest(taskId: string): Promise<{
  url: string;
  headers: Record<string, string>;
} | null> {
  const files = await getTaskOutputFiles(taskId);
  if (files.length === 0) return null;

  const file = files[0];
  const token = await ensureToken();

  return {
    // 如果 bridge 返回的 url 是相对路径，拼接完整 URL
    url: file.url.startsWith('http') ? file.url : `${BRIDGE_URL}${file.url}`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

// ── 文生图工作流快捷工厂 ─────────────────────────────────────────────

export interface TextToImageWorkflowConfig {
  id: string;
  name: string;
  impl: string;
  description?: string;
  /** 返回文生图的提示词（imd_desc） */
  getPrompt(params: WorkflowParams): Promise<string> | string;
  /** 返回图片宽度，默认 1080 */
  getWidth?(params: WorkflowParams): number;
  /** 返回图片高度，默认 1920 */
  getHeight?(params: WorkflowParams): number;
}

export function createComfyuiBridgeWorkflow({ baseDefinition, submit }: {
  baseDefinition: WorkflowBaseDefinition,
  submit: (params: WorkflowParams) => Promise<{ taskId: string }>
}): WorkflowDefinition {
  return {
    ...baseDefinition,
    submit,
    async poll(taskId) {
      const result = await pollTask(taskId);
      const done = result.status === 'completed' || result.status === 'failed';
      return { status: result.status, progress: result.progress, done };
    },

    async parseOutput(taskId) {
      const download = await buildDownloadRequest(taskId);
      if (!download) {
        throw new Error('No output files found from bridge task');
      }
      const filename = download.url.split('/').pop()?.split('?')[0] ?? 'output.png';
      return {
        type: 'fetch',
        request: { url: download.url, method: 'GET', headers: download.headers },
        filename,
      };
    },
  }
}

/**
 * 创建文生图工作流的快捷工厂。
 *
 * 封装了 submit → poll → parseOutput 的完整生命周期，
 * 调用方只需提供 getPrompt / getWidth / getHeight 即可，
 * 无需重复编写轮询和输出处理的样板代码。
 */
export function createTextToImageWorkflow(
  config: TextToImageWorkflowConfig,
): WorkflowDefinition {
  const WIDTH_DEFAULT = 1080;
  const HEIGHT_DEFAULT = 1920;

  return createComfyuiBridgeWorkflow({
    baseDefinition: {
      id: config.id,
      name: config.name,
      impl: config.impl,
      description: config.description,
    },
    async submit(params) {
      const prompt = await config.getPrompt(params);
      const width = config.getWidth ? config.getWidth(params) : WIDTH_DEFAULT;
      const height = config.getHeight ? config.getHeight(params) : HEIGHT_DEFAULT;
      const seed = params.vars.seed ? Number(params.vars.seed) : undefined;
      const result = await submitTextToImage({ imd_desc: prompt, width, height, seed });
      return { taskId: result.taskId };
    },
  })
}

// ── 图片编辑工作流快捷工厂 ───────────────────────────────────────────

export interface ImageEditWorkflowConfig {
  id: string;
  name: string;
  impl: string;
  description?: string;
  getParams(params: WorkflowParams): Promise<{
    desc: string,
    imgs: File[],
    seed?: string | number
  }>
}

/**
 * 创建图片编辑工作流的快捷工厂。
 *
 * 封装了 submit → poll → parseOutput 的完整生命周期，
 * 调用方只需提供 getParams（返回 desc / imgs / seed）即可，
 * 内部通过 multipart 提交到 image_edit_N 工作流。
 */
export function createImageEditWorkflow(
  config: ImageEditWorkflowConfig,
): WorkflowDefinition {
  return createComfyuiBridgeWorkflow({
    baseDefinition: {
      id: config.id,
      name: config.name,
      impl: config.impl,
      description: config.description,
    },
    async submit(params) {
      const { desc, imgs, seed } = await config.getParams(params)
      if (!imgs.length) {
        throw new Error('Image edit workflow requires at least one input image');
      }
      const result = await submitImageEdit({ imgs, desc, seed });
      return { taskId: result.taskId };
    },
  });
}


export interface TtsWorkflowParam {
  desc: string
  text: string
  seed?: string
}

/**
 * 创建图片编辑工作流的快捷工厂。
 *
 * 封装了 submit → poll → parseOutput 的完整生命周期，
 * 调用方只需提供 getParams（返回 desc / imgs / seed）即可，
 * 内部通过 multipart 提交到 image_edit_N 工作流。
 */
export function createTtsDesignWorkflow(
  baseDefinition: WorkflowBaseDefinition,
  getTtsWorkflowParams: (params: WorkflowParams) => Promise<TtsWorkflowParam> | TtsWorkflowParam
): WorkflowDefinition {
  return createComfyuiBridgeWorkflow({
    baseDefinition: baseDefinition,
    async submit(params) {
      return submitComfyuiBridge({
        workflowId: 'tts_voice_design',
        params: {
          ...await getTtsWorkflowParams(params)
        }
      })
    },
  });
}
