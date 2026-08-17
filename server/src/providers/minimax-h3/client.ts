import type { ProviderClient, ResolvedProviderConfig, WorkflowOutput } from '../types.js';

/**
 * MiniMax H3 视频生成 V2 API 传输客户端。
 *
 * 官方文档：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create
 *
 * API 概览（默认 baseUrl https://api.minimaxi.com）：
 * - POST /v2/video_generation        创建视频生成任务（异步），返回 { task_id }
 * - GET  /v2/query/video_generation/{task_id}  查询任务状态（queued/running/succeeded/failed/cancelled）
 * - DELETE /v2/video_generation/{task_id}      取消排队中任务 / 删除成功或失败任务（运行中不可取消）
 * - POST /v1/files/upload            上传输入素材（purpose=video_generation_input），返回 file_id，
 *                                    生成请求中以 `mm_file://{file_id}` 引用（有效期 7 天）
 *
 * 本客户端把上述异步 API 适配为任务式 ProviderClient：
 * - execute：先上传 content 中媒体项引用的文件（fileKey → File），再把 content 的媒体项替换为
 *   `mm_file://{file_id}` 形式后 POST 创建任务，返回远端 task_id；
 * - poll：GET 查询任务，succeeded 时缓存输出 URL（getOutput 读取即删除）；failed/cancelled 返回
 *   对应错误信息；
 * - getOutput：从缓存返回 { type: 'download', url, filename }；
 * - cancel：DELETE 取消任务（仅排队中任务可取消，运行中远端会返回错误）。
 */

/** MiniMax H3 分辨率档位 */
export type MinimaxResolution = '768P' | '2K';

/** MiniMax H3 宽高比（i2va 恒为 adaptive；r2va 可显式指定） */
export type MinimaxRatio = 'adaptive' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';

/** 媒体项 role：图片首帧/尾帧（i2va）与参考图片/视频/音频（r2va） */
export type MinimaxMediaRole =
  | 'first_frame'
  | 'last_frame'
  | 'reference_image'
  | 'reference_video'
  | 'reference_audio';

/** 文本输入项（每个请求必须包含一个非空 text，即 prompt） */
export interface MinimaxTextInput {
  type: 'text';
  /** 提示词（≤7000 字符） */
  text: string;
}

/** 媒体输入项（图片 / 视频 / 音频）：文件经 files[fileKey] 提供，客户端上传后以 mm_file:// 引用 */
export interface MinimaxMediaInput {
  type: 'image_url' | 'video_url' | 'audio_url';
  /** 媒体用途（first_frame / last_frame / reference_image / reference_video / reference_audio） */
  role: MinimaxMediaRole;
  /** 文件在 execute 的 files 参数中的键（上传后转换为 mm_file://{file_id}） */
  fileKey: string;
}

/** content 数组元素（文本 + 媒体项） */
export type MinimaxContentInput = MinimaxTextInput | MinimaxMediaInput;

/**
 * MiniMax H3 视频生成请求（execute 的 params 载荷）。
 *
 * @see https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create
 */
export interface MinimaxVideoGenerationParams {
  /** 多模态输入内容数组（必须包含一个非空 text 项） */
  content: MinimaxContentInput[];
  /** 视频时长（秒，整数，4~15） */
  duration: number;
  /** 分辨率（缺省走 provider 配置的默认分辨率） */
  resolution?: MinimaxResolution;
  /** 宽高比（i2va 恒 adaptive，无需传；r2va 可选，缺省 adaptive） */
  ratio?: MinimaxRatio;
  /** 是否添加 AIGC 标识水印（默认 false） */
  aigc_watermark?: boolean;
}

/** MiniMax 查询任务返回的任务对象（按需字段） */
interface MinimaxTask {
  id?: string;
  status?: string;
  content?: { url?: string; prompt?: string };
  error?: { code?: string; message?: string };
}

/** 文件上传响应（POST /v1/files/upload） */
interface MinimaxUploadResponse {
  file?: { file_id?: string | number; purpose?: string };
  base_resp?: { status_code?: number; status_msg?: string };
}

/** MiniMax H3 客户端：传输能力 + 连接测试 */
export interface MinimaxH3Client extends ProviderClient {
  /** 连接测试：验证地址可达（暂不校验密钥，后续优化） */
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

/** 单类媒体的上传大小上限（字节），来自官方文档输入媒体限制 */
const MEDIA_MAX_BYTES: Record<MinimaxMediaInput['type'], number> = {
  image_url: 30 * 1024 * 1024,
  video_url: 50 * 1024 * 1024,
  audio_url: 15 * 1024 * 1024,
};

/** 单类媒体的中文名（错误提示用） */
const MEDIA_LABEL: Record<MinimaxMediaInput['type'], string> = {
  image_url: '图片',
  video_url: '视频',
  audio_url: '音频',
};

/**
 * 解析 HTTP 错误响应体，优先取 OpenAI 风格错误里的 message，否则取原始文本。
 *
 * @param res fetch 响应对象
 * @returns 错误详情文本（响应体为空时为 '(empty body)'）
 */
async function readErrorDetail(res: Response): Promise<string> {
  let raw = '';
  try {
    raw = await res.text();
  } catch {
    // 响应体读取失败时回退默认文案
  }
  const trimmed = raw.trim();
  if (!trimmed) return '(empty body)';
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // 非 JSON 响应体，原样返回文本
  }
  return trimmed;
}

/**
 * 创建 MiniMax H3 传输客户端。
 *
 * 客户端按实例持有输出缓存 Map（taskId → 输出规格）与配置值；每次引擎创建独立实例。
 *
 * @param config 已解析配置（apiKey / baseUrl / resolution / timeout）
 * @returns ProviderClient（异步任务式：execute 提交 → poll 轮询 → getOutput 取输出）
 */
export function createMinimaxH3Client(config: ResolvedProviderConfig): MinimaxH3Client {
  const apiKey = String(config.apiKey ?? '');
  const baseUrl = String(config.baseUrl ?? 'https://api.minimaxi.com').replace(/\/+$/, '');
  const defaultResolution: MinimaxResolution = config.resolution === '768P' ? '768P' : '2K';
  // 超时下限钳制：非法/非正数回退默认 300s，防止 0/NaN 导致 setTimeout 立即触发
  const timeoutSec = Number(config.timeout ?? 300);
  const timeoutMs = (Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 300) * 1000;

  /** 输出缓存：poll 到 succeeded 时写入，getOutput 读取即删除（防止无界增长） */
  const outputs = new Map<string, WorkflowOutput>();

  /**
   * 带超时执行一次 HTTP 请求。
   *
   * @param url 请求地址
   * @param init fetch 初始化参数
   * @param label 中文操作名（超时错误提示用）
   * @returns fetch 响应
   */
  async function requestWithTimeout(url: string, init: RequestInit, label: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`MiniMax ${label}请求超时（${Math.round(timeoutMs / 1000)}s）`, { cause: e });
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 上传一个输入素材文件到 MiniMax 平台（POST /v1/files/upload，purpose=video_generation_input）。
   *
   * @param file 素材文件（图片/视频/音频）
   * @param mediaType 媒体类型（校验大小上限与错误提示用）
   * @returns 平台 file_id（生成请求中以 mm_file://{file_id} 引用）
   */
  async function uploadInputFile(file: File, mediaType: MinimaxMediaInput['type']): Promise<string> {
    if (file.size > MEDIA_MAX_BYTES[mediaType]) {
      throw new Error(
        `MiniMax 输入${MEDIA_LABEL[mediaType]}超过 ${MEDIA_MAX_BYTES[mediaType] / 1024 / 1024}MB 上限: ${file.name}`,
      );
    }
    const form = new FormData();
    form.append('purpose', 'video_generation_input');
    form.append('file', file, file.name);
    const res = await requestWithTimeout(
      `${baseUrl}/v1/files/upload`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: form },
      '上传素材',
    );
    if (!res.ok) {
      throw new Error(`MiniMax 上传素材错误 (${res.status}): ${await readErrorDetail(res)}`);
    }
    const data = (await res.json()) as MinimaxUploadResponse;
    const statusCode = data.base_resp?.status_code;
    const fileId = data.file?.file_id;
    if (statusCode !== 0 || fileId == null || String(fileId) === '') {
      throw new Error(
        `MiniMax 上传素材失败: ${data.base_resp?.status_msg ?? '响应缺少 file_id'}（status_code=${String(statusCode)}）`,
      );
    }
    return String(fileId);
  }

  return {
    async execute(p) {
      if (!apiKey) {
        throw new Error('MiniMax API Key 未配置（请到「服务商配置」填写 MiniMax H3 的 API Key）');
      }
      const params = (p.params ?? {}) as unknown as MinimaxVideoGenerationParams;
      const files = p.files ?? {};
      const content = params.content ?? [];
      if (!content.some((item) => item.type === 'text' && (item.text ?? '').trim() !== '')) {
        throw new Error('MiniMax 创建任务需要至少一个非空 text 提示词');
      }
      const duration = Number(params.duration);
      if (!Number.isInteger(duration) || duration < 4 || duration > 15) {
        throw new Error(`MiniMax 视频时长须为 4~15 的整数，当前: ${String(params.duration)}`);
      }
      const resolution: MinimaxResolution = params.resolution ?? defaultResolution;
      if (resolution !== '768P' && resolution !== '2K') {
        throw new Error(`MiniMax 分辨率无效: ${resolution}（可选 768P / 2K）`);
      }

      // 上传媒体项引用的文件，并组装最终的 content（mm_file://{file_id} 引用）
      const finalContent: Record<string, unknown>[] = [];
      for (const item of content) {
        if (item.type === 'text') {
          finalContent.push({ type: 'text', text: item.text });
          continue;
        }
        const file = files[item.fileKey];
        if (!file) {
          throw new Error(`MiniMax 提交缺少上传文件: ${item.fileKey}`);
        }
        const fileId = await uploadInputFile(file, item.type);
        finalContent.push({ type: item.type, [item.type]: { url: `mm_file://${fileId}` }, role: item.role });
      }

      const body: Record<string, unknown> = {
        model: 'MiniMax-H3',
        content: finalContent,
        resolution,
        duration,
      };
      if (params.ratio) body.ratio = params.ratio;
      if (params.aigc_watermark != null) body.aigc_watermark = params.aigc_watermark;

      const res = await requestWithTimeout(
        `${baseUrl}/v2/video_generation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        },
        '创建任务',
      );
      if (!res.ok) {
        throw new Error(`MiniMax 创建任务错误 (${res.status}): ${await readErrorDetail(res)}`);
      }
      const data = (await res.json()) as { task_id?: string };
      if (!data.task_id) {
        throw new Error('MiniMax 创建任务响应缺少 task_id');
      }
      return { taskId: data.task_id };
    },

    async poll(taskId) {
      const res = await requestWithTimeout(
        `${baseUrl}/v2/query/video_generation/${encodeURIComponent(taskId)}`,
        { headers: { 'Authorization': `Bearer ${apiKey}` } },
        '查询任务',
      );
      if (!res.ok) {
        throw new Error(`MiniMax 查询任务错误 (${res.status}): ${await readErrorDetail(res)}`);
      }
      const data = (await res.json()) as { task?: MinimaxTask };
      const task = data.task;
      if (!task) {
        throw new Error('MiniMax 查询任务响应缺少 task 字段');
      }
      switch (task.status) {
        case 'queued':
          return { status: 'queued', done: false, errorMessage: null };
        case 'running':
          return { status: 'running', done: false, errorMessage: null };
        case 'succeeded': {
          const url = task.content?.url;
          if (!url) {
            throw new Error('MiniMax 任务成功但响应缺少视频 URL');
          }
          outputs.set(taskId, { type: 'download', url, filename: 'output.mp4' });
          return { status: 'completed', progress: 100, done: true, errorMessage: null };
        }
        case 'failed':
          return {
            status: 'failed',
            done: true,
            errorMessage: task.error?.message ?? 'MiniMax 视频生成失败（未知原因）',
          };
        case 'cancelled':
          return { status: 'failed', done: true, errorMessage: 'MiniMax 任务已被取消' };
        default:
          // 未知状态按进行中处理（引擎继续轮询）
          return { status: String(task.status ?? 'unknown'), done: false, errorMessage: null };
      }
    },

    async getOutput(taskId): Promise<WorkflowOutput | null> {
      // 引擎在任务完成后只读取一次输出，读取即删除防止 Map 无界增长
      const out = outputs.get(taskId);
      outputs.delete(taskId);
      return out ?? null;
    },

    async cancel(taskId) {
      const res = await requestWithTimeout(
        `${baseUrl}/v2/video_generation/${encodeURIComponent(taskId)}`,
        { method: 'DELETE', headers: { 'Authorization': `Bearer ${apiKey}` } },
        '取消任务',
      );
      if (!res.ok) {
        // 仅排队中（queued）任务可取消；运行中任务远端返回错误，将错误上抛给调用方
        throw new Error(`MiniMax 取消任务错误 (${res.status}): ${await readErrorDetail(res)}`);
      }
    },

    async testConnection(): Promise<{ ok: boolean; message: string }> {
      // 轻量 GET 基础地址验证可达；5 秒超时，任何异常（网络不可达/超时）均返回 ok:false
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(baseUrl, { method: 'GET', signal: ctrl.signal });
        return { ok: true, message: `地址可达（HTTP ${res.status}）` };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
