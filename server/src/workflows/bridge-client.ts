/**
 * ComfyUI Bridge 工作流层封装。
 *
 * 传输层（execute/poll/getOutput/cancel + token 认证）已迁移到
 * providers/comfyui-bridge/（Provider 插件）。本文件只保留「工作流层」内容：
 * - createProviderWorkflow — 通用工作流工厂（声明 provider + submit）
 * - createTextToImageWorkflow / createImageEditWorkflow / createTtsDesignWorkflow — 快捷工厂
 * - submitTextToImage / submitImageEdit / submitImageToVideo / submitLtxDirectorImageToVideo /
 *   submitReferenceVideo / submitMinimaxH3Fl2v — 提交辅助函数（首参为 ProviderClient）
 * - resolveImageEditSizeParams — 图片编辑尺寸解析（纯函数）
 */

import type { ProviderClient } from '../providers/types.js';
import type {
  WorkflowBaseDefinition,
  WorkflowCapabilities,
  WorkflowDefinition,
  WorkflowRunContext,
  WorkflowUserParamDeclaration,
  WorkflowVarsBase,
} from './types.js';

// ── 通用工作流工厂 ───────────────────────────────────────────────────

/**
 * 创建通用工作流定义。
 *
 * 工作流声明自己使用的 provider（默认 comfyui-bridge）；引擎在运行任务时按 provider
 * 解析配置并创建 ProviderClient 注入 ctx.provider，submit 内通过 ctx.provider 提交任务。
 * 轮询与输出获取由引擎直接驱动 provider client，因此本工厂不再预绑 poll/parseOutput。
 *
 * @param args.provider provider 插件 ID（默认 comfyui-bridge）
 * @param args.baseDefinition 工作流基础元信息（type / name / impl / description / params / capabilities）
 * @param args.submit 提交函数，接收 WorkflowRunContext，返回远端任务 ID
 * @returns 完整的工作流定义（WorkflowDefinition<TVars>）
 */
export function createProviderWorkflow<TVars extends WorkflowVarsBase = WorkflowVarsBase>({
  provider = 'comfyui-bridge',
  baseDefinition,
  submit,
}: {
  provider?: string;
  baseDefinition: WorkflowBaseDefinition & { capabilities?: WorkflowCapabilities };
  submit: (ctx: WorkflowRunContext<TVars>) => Promise<{ taskId: string }>;
}): WorkflowDefinition<TVars> {
  return {
    ...baseDefinition,
    provider,
    submit,
  };
}

// ── 文生图提交辅助函数 ───────────────────────────────────────────────

export interface SubmitTextToImageParams {
  /** 图片描述提示词 */
  prompt: string;
  /** 图片宽度（像素） */
  width: number;
  /** 图片高度（像素） */
  height: number;
  /** 随机种子（可选） */
  seed?: number;
  /** 提示词强化开关（布尔值，直接提交给 ComfyUI 工作流；可选） */
  enhance_prompt?: boolean;
}

/**
 * 提交文生图任务（ComfyUI text_to_image 工作流）。
 * @param client Provider 客户端
 * @param params 文生图参数
 * @returns 远端任务 ID
 */
export async function submitTextToImage(
  client: ProviderClient,
  params: SubmitTextToImageParams,
): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    width: params.width,
    height: params.height,
  };
  if (params.seed != null) {
    body.seed = params.seed;
  }
  if (params.enhance_prompt !== undefined) {
    body.enhance_prompt = params.enhance_prompt;
  }
  return client.execute({ workflowId: 'text_to_image', params: body });
}

// ── 图片编辑提交辅助函数 ─────────────────────────────────────────────

interface SubmitImageEditParams {
  imgs: File[];
  prompt: string;
  seed?: string | number;
  /** 启用多机位旋转 LoRA */
  enable_multiple_angles_lora?: boolean;
  /** 启用指定输出图片尺寸 */
  enable_specified_size?: boolean;
  /** 输出图片宽度（enable_specified_size 为 true 时生效） */
  width?: number;
  /** 输出图片高度（enable_specified_size 为 true 时生效） */
  height?: number;
}

export interface ImageEditSizeParams {
  /** 是否启用指定输出尺寸 */
  enable_specified_size?: boolean;
  /** 输出宽度（像素） */
  width?: number;
  /** 输出高度（像素） */
  height?: number;
}

/**
 * 从工作流 vars 解析图片编辑尺寸参数。
 *
 * 仅当 vars.enable_specified_size === 'true' 时返回启用标记与宽高（数字，取整），
 * 否则返回空对象（对应「不指定」模式，不向 Bridge 传任何尺寸参数）。
 *
 * @param vars 工作流 vars（key → 字符串值）
 * @returns 可透传给 Bridge 的尺寸参数
 */
export function resolveImageEditSizeParams(
  vars: Record<string, string | undefined>,
): ImageEditSizeParams {
  if (vars.enable_specified_size !== 'true') return {};
  const out: ImageEditSizeParams = { enable_specified_size: true };
  const width = vars.width ? Number(vars.width) : NaN;
  const height = vars.height ? Number(vars.height) : NaN;
  if (Number.isFinite(width)) out.width = Math.round(width);
  if (Number.isFinite(height)) out.height = Math.round(height);
  return out;
}

/**
 * 提交图片编辑任务（qwen-edit-2509 工作流，多图动态键 image_0/image_1/...）。
 * @param client Provider 客户端
 * @param params 图片编辑参数
 * @returns 远端任务 ID
 */
export async function submitImageEdit(
  client: ProviderClient,
  params: SubmitImageEditParams,
): Promise<{ taskId: string }> {
  const files: Record<string, File> = {};
  // 多个图片时，直接以 image${图片序号}（0-based）命名，触发动态构建工作流实现多图参考编辑
  params.imgs.forEach((f, idx) => {
    files[`image_${idx}`] = f;
  });
  const textParams: Record<string, unknown> = {
    prompt: params.prompt,
    enable_multiple_angles_lora: params.enable_multiple_angles_lora ?? true,
  };
  if (params.seed != null) {
    textParams.seed = params.seed;
  }
  if (params.enable_specified_size != null) {
    textParams.enable_specified_size = params.enable_specified_size;
  }
  if (params.width != null) {
    textParams.width = params.width;
  }
  if (params.height != null) {
    textParams.height = params.height;
  }
  return client.execute({ workflowId: 'qwen-edit-2509', params: textParams, files });
}

// ── 图生视频提交辅助函数 ─────────────────────────────────────────────

export interface ImageToVideoSubmitParams {
  /** 视频描述提示词 */
  prompt: string;
  /** 视频宽度（像素） */
  width: number;
  /** 视频高度（像素） */
  height: number;
  /** 视频时长（秒） */
  duration: number;
  /** 帧率 */
  fps: number;
  /** 随机种子（可选） */
  seed?: number;
  /** 背景音频文件（可选） */
  audio?: File;
  /**
   * 参考帧图片，按时间顺序排列。
   * - 1 张：仅首帧 → 调用 I2V
   * - 2 张：首帧 + 尾帧 → 调用 FL2V
   * - 3 张：首帧 + 中间帧 + 尾帧 → 调用 FML2V（mid_frame_cursor=0.5）
   */
  frames: File[];
}

/**
 * 根据 frames 数量自动选择合适的图生视频工作流。
 *
 * - 1 帧 → I2V（单帧生成）
 * - 2 帧 → FL2V（首尾帧插值）
 * - 3 帧 → FML2V（首中尾帧插值，中间帧位置固定 0.5）
 *
 * @param client Provider 客户端
 * @param params 图生视频参数
 * @returns 远端任务 ID
 */
export async function submitImageToVideo(
  client: ProviderClient,
  params: ImageToVideoSubmitParams,
): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    width: params.width,
    height: params.height,
    duration: params.duration,
    fps: params.fps,
    auto_generate_audio: true,
  };
  if (params.seed != null) {
    body.seed = params.seed;
  }

  const files: Record<string, File> = {};
  if (params.audio) {
    files.audio = params.audio;
    body.auto_generate_audio = false;
  }

  const frameCount = params.frames.length;

  if (frameCount === 1) {
    files.image_0 = params.frames[0];
    return client.execute({ workflowId: 'I2V', params: body, files });
  }

  if (frameCount === 2) {
    files.image_0 = params.frames[0];
    files.image_1 = params.frames[1];
    return client.execute({ workflowId: 'FL2V', params: body, files });
  }

  if (frameCount === 3) {
    body.mid_frame_cursor = 0.5;
    files.image_0 = params.frames[0];
    files.image_1 = params.frames[1];
    files.image_2 = params.frames[2];
    return client.execute({ workflowId: 'FML2V', params: body, files });
  }

  throw new Error(
    `image-to-video 仅支持 1~3 帧参考图，当前 ${frameCount} 帧`,
  );
}

// ── 导演模式图生视频提交辅助函数（ltx-2.3-director）──────────────────

/**
 * 关键帧定义。
 *
 * 描述一张参考帧图像在目标视频中的出现位置与顺序，
 * 与上传的 `frame_{frameSeq}` 文件一一对应。
 */
export interface FrameDefine {
  /**
   * 关键帧图像序号，对应上传文件的动态键 `image_{frameSeq}`（如 image_0、image_1）。
   */
  frameSeq: number;
  /**
   * 该帧图像在视频长度中的出现位置游标比值，取值范围 0~1。
   * 0 表示首帧，1 表示尾帧（视频开头/结尾瞬间帧），0.5 表示视频中间。
   */
  cursor: number;
}

/**
 * ltx-2.3-director 导演模式图生视频的提交参数。
 */
export interface LtxDirectorImageToVideoSubmitParams {
  /** 视频描述提示词 */
  prompt: string;
  /** 视频宽度（像素） */
  width: number;
  /** 视频高度（像素） */
  height: number;
  /** 视频时长（秒） */
  duration: number;
  /** 帧率 */
  fps: number;
  /** 随机种子（可选） */
  seed?: number;
  /** 背景音频文件（可选），存在时自动生成音频关闭 */
  audio?: File;
  /**
   * 关键帧列表，按时间顺序排列。每帧携带文件与游标位置，
   * 关键帧序号由提交函数按数组顺序自动生成（0、1、2…）。
   */
  frames: Array<{
    /** 关键帧图像文件 */
    file: File;
    /** 该帧在视频长度中的出现位置游标比值（0~1） */
    cursor: number;
  }>;
}

/**
 * 提交导演模式图生视频任务（ltx-2.3-director 工作流）。
 *
 * - 关键帧序号由内部按数组顺序自动生成（0、1、2…）；
 * - body 中 `frame_define` 为 JSON.stringify(FrameDefine[]) 字符串；
 * - 文件以动态键 `image_{frameSeq}` 上传，走 multipart/form-data；
 * - 提供 `params.audio` 时以 `audio` 键上传背景音频并将 auto_generate_audio 置 false。
 *
 * @param client Provider 客户端
 * @param params 导演模式图生视频提交参数
 * @returns 远端任务 ID
 */
export async function submitLtxDirectorImageToVideo(
  client: ProviderClient,
  params: LtxDirectorImageToVideoSubmitParams,
): Promise<{ taskId: string }> {
  // 关键帧序号按数组顺序自动生成：0、1、2…
  const frameDefines: FrameDefine[] = params.frames.map((f, idx) => ({
    frameSeq: idx,
    cursor: f.cursor,
  }));

  const body: Record<string, unknown> = {
    prompt: params.prompt,
    width: params.width,
    height: params.height,
    duration: params.duration,
    fps: params.fps,
    auto_generate_audio: true,
    frame_define: JSON.stringify(frameDefines),
  };
  if (params.seed != null) {
    body.seed = params.seed;
  }

  const files: Record<string, File> = {};
  params.frames.forEach((f, idx) => {
    files[`image_${idx}`] = f.file;
  });
  if (params.audio) {
    files.audio = params.audio;
    body.auto_generate_audio = false;
  }

  return client.execute({ workflowId: 'ltx-2.3-director', params: body, files });
}

// ── 参考模式图生视频提交辅助函数（minimax-h3-r2v）────────────────────

/**
 * 参考模式图生视频的提交参数。
 */
export interface ReferenceVideoSubmitParams {
  /** 视频描述提示词 */
  prompt: string;
  /** 视频宽度（像素） */
  width: number;
  /** 视频高度（像素） */
  height: number;
  /** 视频时长（秒） */
  duration: number;
  /** 随机种子（可选） */
  seed?: number;
  /** 有序图片参考（键 image_0, image_1, …，独立从 0 计数） */
  imageRefs?: File[];
  /** 有序视频参考（键 video_0, video_1, …） */
  videoRefs?: File[];
  /** 有序音频参考（键 audio_0, audio_1, …） */
  audioRefs?: File[];
}

/**
 * 提交参考模式图生视频任务（minimax-h3-r2v 工作流）。
 *
 * - 动态文件键：`image_{n}` / `video_{n}` / `audio_{n}`，各类型序号从 0 开始独立递增；
 * - 走 multipart/form-data，params 为 JSON 字符串；
 * - 参考素材的文件与数量由调用方（工作流实现）负责校验。
 *
 * @param client Provider 客户端
 * @param params 参考模式图生视频提交参数
 * @returns 远端任务 ID
 */
export async function submitReferenceVideo(
  client: ProviderClient,
  params: ReferenceVideoSubmitParams,
): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    width: params.width,
    height: params.height,
    duration: params.duration,
  };
  if (params.seed != null) {
    body.seed = params.seed;
  }

  const files: Record<string, File> = {};
  (params.imageRefs ?? []).forEach((f, idx) => { files[`image_${idx}`] = f; });
  (params.videoRefs ?? []).forEach((f, idx) => { files[`video_${idx}`] = f; });
  (params.audioRefs ?? []).forEach((f, idx) => { files[`audio_${idx}`] = f; });

  return client.execute({ workflowId: 'minimax-h3-r2v', params: body, files });
}

// ── 首尾帧模式图生视频提交辅助函数（minimax-h3-fl2v）─────────────────

/**
 * minimax-h3-fl2v 首尾帧模式图生视频的提交参数。
 */
export interface MinimaxH3Fl2vSubmitParams {
  /** 视频描述提示词 */
  prompt: string;
  /** 视频宽度（像素） */
  width: number;
  /** 视频高度（像素） */
  height: number;
  /** 视频时长（秒） */
  duration: number;
  /** 随机种子（可选） */
  seed?: number;
  /** 首帧图片（必填，文件键 image_0） */
  firstFrame: File;
  /** 尾帧图片（可选，文件键 image_1；存在时表示首尾帧插值） */
  lastFrame?: File;
}

/**
 * 提交首尾帧模式图生视频任务（minimax-h3-fl2v 工作流）。
 *
 * - params（prompt/width/height/duration/seed）以 JSON 字符串上传（multipart 方式 B）；
 * - 首帧以文件键 `image_0` 上传；存在尾帧时以 `image_1` 上传。
 *
 * @param client Provider 客户端
 * @param params 首尾帧模式图生视频提交参数
 * @returns 远端任务 ID
 */
export async function submitMinimaxH3Fl2v(
  client: ProviderClient,
  params: MinimaxH3Fl2vSubmitParams,
): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    width: params.width,
    height: params.height,
    duration: params.duration,
  };
  if (params.seed != null) {
    body.seed = params.seed;
  }

  const files: Record<string, File> = { image_0: params.firstFrame };
  if (params.lastFrame) {
    files.image_1 = params.lastFrame;
  }

  return client.execute({ workflowId: 'minimax-h3-fl2v', params: body, files });
}

// ── 文生图工作流快捷工厂 ─────────────────────────────────────────────

export interface TextToImageWorkflowConfig<TVars extends WorkflowVarsBase = WorkflowVarsBase> {
  /** 工作流类型，如 text-to-image */
  type: string;
  name: string;
  impl: string;
  description?: string;
  /** 可由用户手动传入的参数声明（可选，前端据此渲染输入表单） */
  params?: WorkflowUserParamDeclaration[];
  /** 返回文生图的提示词（prompt） */
  getPrompt(ctx: WorkflowRunContext<TVars>): Promise<string> | string;
  /** 返回图片宽度，默认 1080 */
  getWidth?(ctx: WorkflowRunContext<TVars>): number;
  /** 返回图片高度，默认 1920 */
  getHeight?(ctx: WorkflowRunContext<TVars>): number;
}

/**
 * 创建文生图工作流的快捷工厂。
 *
 * 调用方只需提供 getPrompt / getWidth / getHeight；
 * submit 通过 ctx.provider 提交（传输层由 provider 提供）。
 */
export function createTextToImageWorkflow<TVars extends WorkflowVarsBase = WorkflowVarsBase>(
  config: TextToImageWorkflowConfig<TVars>,
): WorkflowDefinition<TVars> {
  const WIDTH_DEFAULT = 1080;
  const HEIGHT_DEFAULT = 1920;

  return createProviderWorkflow<TVars>({
    baseDefinition: {
      type: config.type,
      name: config.name,
      impl: config.impl,
      description: config.description,
      params: config.params,
    },
    async submit(ctx) {
      const prompt = await config.getPrompt(ctx);
      const width = config.getWidth ? config.getWidth(ctx) : WIDTH_DEFAULT;
      const height = config.getHeight ? config.getHeight(ctx) : HEIGHT_DEFAULT;
      const seed = ctx.vars.seed ? Number(ctx.vars.seed) : undefined;
      // enhance_prompt 仅作为布尔值提交给 ComfyUI 工作流，不修改提示词内容
      const enhancePrompt = (ctx.vars as Record<string, unknown>).enhance_prompt === 'true';
      const result = await submitTextToImage(ctx.provider, {
        prompt,
        width,
        height,
        seed,
        enhance_prompt: enhancePrompt,
      });
      return { taskId: result.taskId };
    },
  });
}

// ── 图片编辑工作流快捷工厂 ───────────────────────────────────────────

export interface ImageEditWorkflowConfig<TVars extends WorkflowVarsBase = WorkflowVarsBase> {
  /** 工作流类型，如 image-edit */
  type: string;
  name: string;
  impl: string;
  description?: string;
  /** 可由用户手动传入的参数声明（可选，前端据此渲染输入表单） */
  params?: WorkflowUserParamDeclaration[];
  getParams(ctx: WorkflowRunContext<TVars>): Promise<{
    prompt: string;
    imgs: File[];
    seed?: string | number;
  }>;
}

/**
 * 创建图片编辑工作流的快捷工厂。
 *
 * 调用方只需提供 getParams（返回 prompt / imgs / seed）；
 * 内部通过 ctx.provider 以 multipart 提交到 qwen-edit-2509 工作流。
 */
export function createImageEditWorkflow<TVars extends WorkflowVarsBase = WorkflowVarsBase>(
  config: ImageEditWorkflowConfig<TVars>,
): WorkflowDefinition<TVars> {
  return createProviderWorkflow<TVars>({
    baseDefinition: {
      type: config.type,
      name: config.name,
      impl: config.impl,
      description: config.description,
      params: config.params,
    },
    async submit(ctx) {
      const { prompt, imgs, seed } = await config.getParams(ctx);
      if (!imgs.length) {
        throw new Error('Image edit workflow requires at least one input image');
      }
      const size = resolveImageEditSizeParams(ctx.vars as unknown as Record<string, string | undefined>);
      const result = await submitImageEdit(ctx.provider, { imgs, prompt, seed, ...size });
      return { taskId: result.taskId };
    },
  });
}

// ── TTS 音色设计工作流快捷工厂 ───────────────────────────────────────

export interface TtsWorkflowParam {
  prompt: string;
  text: string;
  seed?: string;
}

/**
 * 创建 TTS 音色设计工作流的快捷工厂。
 *
 * 调用方只需提供 getTtsWorkflowParams（返回 prompt / text / seed）；
 * submit 通过 ctx.provider 提交到 tts_voice_design 工作流。
 */
export function createTtsDesignWorkflow<TVars extends WorkflowVarsBase = WorkflowVarsBase>(
  baseDefinition: WorkflowBaseDefinition,
  getTtsWorkflowParams: (ctx: WorkflowRunContext<TVars>) => Promise<TtsWorkflowParam> | TtsWorkflowParam,
): WorkflowDefinition<TVars> {
  return createProviderWorkflow<TVars>({
    baseDefinition,
    async submit(ctx) {
      return ctx.provider.execute({
        workflowId: 'tts_voice_design',
        params: {
          ...(await getTtsWorkflowParams(ctx)),
        },
      });
    },
  });
}
