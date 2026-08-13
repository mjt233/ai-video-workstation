/**
 * ComfyUI Bridge 工作流层封装（payload 构建器）。
 *
 * 传输层（execute/poll/getOutput/cancel + token 认证）在 providers/comfyui-bridge/。
 * 本文件只保留「提交载荷」纯函数构建器：workflowId 作为入参，返回 { workflowId, params, files? }，
 * 不再硬编码任何 Bridge workflow id。动态注册（bridge-sync）据此构建 submit。
 * - resolveImageEditSizeParams — 图片编辑尺寸解析（纯函数，保留）
 */

/** 提交载荷：Bridge execute 的入参 */
export interface BridgeExecutePayload {
  workflowId: string;
  params: Record<string, unknown>;
  files?: Record<string, File>;
}

/** 视频关键帧定义（导演台 mode 用） */
export interface FrameDefine {
  frameSeq: number;
  cursor: number;
}

// ── 文本类构建器 ─────────────────────────────────────────────────────

/**
 * 文生图提交载荷。
 * @param args.workflowId Bridge 工作流 id
 * @param args.prompt 提示词
 * @param args.width 宽度（像素）
 * @param args.height 高度（像素）
 * @param args.seed 随机种子（可选）
 * @param args.enhance_prompt 提示词强化开关（可选）
 */
export function buildTextToImagePayload(args: {
  workflowId: string;
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  enhance_prompt?: boolean;
  extraParams?: Record<string, unknown>;
}): BridgeExecutePayload {
  const params: Record<string, unknown> = {
    ...(args.extraParams ?? {}),
    prompt: args.prompt,
    width: args.width,
    height: args.height,
  };
  if (args.seed != null) params.seed = args.seed;
  if (args.enhance_prompt !== undefined) params.enhance_prompt = args.enhance_prompt;
  return { workflowId: args.workflowId, params };
}

/**
 * TTS 音色设计提交载荷。
 * @param args.workflowId Bridge 工作流 id
 * @param args.prompt 声线描述
 * @param args.text 朗读文本
 * @param args.seed 随机种子（可选）
 */
export function buildTtsPayload(args: {
  workflowId: string;
  prompt: string;
  text: string;
  seed?: string;
  extraParams?: Record<string, unknown>;
}): BridgeExecutePayload {
  const params: Record<string, unknown> = { ...(args.extraParams ?? {}), prompt: args.prompt, text: args.text };
  if (args.seed != null) params.seed = args.seed;
  return { workflowId: args.workflowId, params };
}

/**
 * TTS 音色克隆提交载荷。
 * @param args.workflowId Bridge 工作流 id
 * @param args.text 朗读文本
 * @param args.refText 参考音频的语音内容文字
 * @param args.refAudio 参考音频文件（multipart 文件 key audio_0）
 * @param args.seed 随机种子（可选）
 */
export function buildTtsClonePayload(args: {
  workflowId: string;
  text: string;
  refText: string;
  refAudio: File;
  seed?: string;
  extraParams?: Record<string, unknown>;
}): BridgeExecutePayload {
  const params: Record<string, unknown> = { ...(args.extraParams ?? {}), text: args.text, ref_text: args.refText };
  if (args.seed != null) params.seed = args.seed;
  return { workflowId: args.workflowId, params, files: { audio_0: args.refAudio } };
}

// ── 图片编辑构建器 ───────────────────────────────────────────────────

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
 * 图片编辑提交载荷（多图动态 key image_0/image_1/...，0-based）。
 *
 * 结构字段（prompt/seed/尺寸）由本构建器组装；其余动态用户参数（如 Bridge 经
 * expose_field 暴露的 enable_multiple_angles_lora）经 extraParams 透传合并，
 * 结构字段优先。
 *
 * @param args.workflowId Bridge 工作流 id
 * @param args.prompt 编辑描述
 * @param args.imgs 输入图片（按数组顺序映射 image_{n}）
 * @param args.seed 随机种子（可选）
 * @param args.size 尺寸参数（仅 enable_specified_size 为 true 时透传，见 resolveImageEditSizeParams）
 * @param args.extraParams 额外透传的用户参数（结构字段优先，可选）
 */
export function buildImageEditPayload(args: {
  workflowId: string;
  prompt: string;
  imgs: File[];
  seed?: string | number;
  size?: ImageEditSizeParams;
  extraParams?: Record<string, unknown>;
}): BridgeExecutePayload {
  const files: Record<string, File> = {};
  args.imgs.forEach((f, idx) => { files[`image_${idx}`] = f; });
  const params: Record<string, unknown> = { ...(args.extraParams ?? {}), prompt: args.prompt };
  if (args.seed != null) params.seed = args.seed;
  if (args.size?.enable_specified_size != null) params.enable_specified_size = args.size.enable_specified_size;
  if (args.size?.width != null) params.width = args.size.width;
  if (args.size?.height != null) params.height = args.size.height;
  return { workflowId: args.workflowId, params, files };
}

// ── 图生视频构建器 ───────────────────────────────────────────────────

/**
 * 首尾帧模式图生视频提交载荷（文件 key image_{0..n-1}）。
 *
 * - 恰好 3 帧时附带 params.mid_frame_cursor=0.5（对应 FML2V 约定）；
 * - 提供 audio 时以 audio 键上传并将 auto_generate_audio 置 false；
 * - 调用方须校验帧数 1~3（本构建器不做数量校验）。
 *
 * @param args.workflowId Bridge 工作流 id
 * @param args.prompt 视频描述提示词
 * @param args.width 视频宽度（像素）
 * @param args.height 视频高度（像素）
 * @param args.duration 视频时长（秒）
 * @param args.fps 帧率
 * @param args.seed 随机种子（可选）
 * @param args.frames 参考帧图片（按时间顺序，1~3 张）
 * @param args.audio 背景音频（可选）
 * @returns Bridge execute 载荷
 */
export function buildFirstLastFramePayload(args: {
  workflowId: string;
  prompt: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  seed?: number;
  frames: File[];
  audio?: File;
  extraParams?: Record<string, unknown>;
}): BridgeExecutePayload {
  const params: Record<string, unknown> = {
    ...(args.extraParams ?? {}),
    prompt: args.prompt,
    width: args.width,
    height: args.height,
    duration: args.duration,
    fps: args.fps,
    auto_generate_audio: true,
  };
  if (args.seed != null) params.seed = args.seed;
  if (args.frames.length === 3) params.mid_frame_cursor = 0.5;
  const files: Record<string, File> = {};
  args.frames.forEach((f, idx) => { files[`image_${idx}`] = f; });
  if (args.audio) {
    files.audio = args.audio;
    params.auto_generate_audio = false;
  }
  return { workflowId: args.workflowId, params, files };
}

/**
 * 导演台模式图生视频提交载荷。
 *
 * - body 中 frame_define 为 JSON.stringify(FrameDefine[]) 字符串；
 * - 文件以动态键 image_{frameSeq} 上传，frameSeq 与 frameDefines 一一对应；
 * - 提供 audio 时以 audio 键上传并将 auto_generate_audio 置 false。
 *
 * @param args.workflowId Bridge 工作流 id
 * @param args.prompt 视频描述提示词
 * @param args.width 视频宽度（像素）
 * @param args.height 视频高度（像素）
 * @param args.duration 视频时长（秒）
 * @param args.fps 帧率
 * @param args.seed 随机种子（可选）
 * @param args.frameDefines 关键帧定义（frameSeq 0-based，cursor 0~1）
 * @param args.frameFiles 关键帧图片文件（与 frameDefines 顺序一致）
 * @param args.audio 背景音频（可选）
 * @returns Bridge execute 载荷
 *
 * 注意：本函数为纯载荷构建器，与 director-inject.ts 导出的 DirectorPayload（导演台解析负载）同名不同义。
 */
export function buildDirectorPayload(args: {
  workflowId: string;
  prompt: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  seed?: number;
  frameDefines: FrameDefine[];
  frameFiles: File[];
  audio?: File;
  extraParams?: Record<string, unknown>;
}): BridgeExecutePayload {
  const params: Record<string, unknown> = {
    ...(args.extraParams ?? {}),
    prompt: args.prompt,
    width: args.width,
    height: args.height,
    duration: args.duration,
    fps: args.fps,
    auto_generate_audio: true,
    frame_define: JSON.stringify(args.frameDefines),
  };
  if (args.seed != null) params.seed = args.seed;
  const files: Record<string, File> = {};
  args.frameFiles.forEach((f, idx) => { files[`image_${idx}`] = f; });
  if (args.audio) {
    files.audio = args.audio;
    params.auto_generate_audio = false;
  }
  return { workflowId: args.workflowId, params, files };
}

/**
 * 参考模式图生视频提交载荷。
 *
 * - 文件 key image_{n}/video_{n}/audio_{n}，各类型序号独立从 0 开始递增；
 * - 参考素材文件与数量由调用方（工作流实现）负责校验。
 *
 * @param args.workflowId Bridge 工作流 id
 * @param args.prompt 视频描述提示词
 * @param args.width 视频宽度（像素）
 * @param args.height 视频高度（像素）
 * @param args.duration 视频时长（秒）
 * @param args.seed 随机种子（可选）
 * @param args.imageRefs 有序图片参考（可选）
 * @param args.videoRefs 有序视频参考（可选）
 * @param args.audioRefs 有序音频参考（可选）
 * @returns Bridge execute 载荷
 */
export function buildReferencePayload(args: {
  workflowId: string;
  prompt: string;
  width: number;
  height: number;
  duration: number;
  seed?: number;
  imageRefs?: File[];
  videoRefs?: File[];
  audioRefs?: File[];
  extraParams?: Record<string, unknown>;
}): BridgeExecutePayload {
  const params: Record<string, unknown> = {
    ...(args.extraParams ?? {}),
    prompt: args.prompt,
    width: args.width,
    height: args.height,
    duration: args.duration,
  };
  if (args.seed != null) params.seed = args.seed;
  const files: Record<string, File> = {};
  (args.imageRefs ?? []).forEach((f, idx) => { files[`image_${idx}`] = f; });
  (args.videoRefs ?? []).forEach((f, idx) => { files[`video_${idx}`] = f; });
  (args.audioRefs ?? []).forEach((f, idx) => { files[`audio_${idx}`] = f; });
  return { workflowId: args.workflowId, params, files };
}

