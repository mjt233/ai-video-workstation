/**
 * 导演台配置解析与关键帧定义计算助手。
 *
 * 本模块负责：
 * 1. 解析分镜目录下的 `prompt/scene/{ep}/{shot}/director.json` 导演台配置文件
 *    （`parseDirectorJson`），对外提供强类型、经过校验的配置对象；
 * 2. 将导演台配置中的图像片段（imageClips）按起始时间升序转换为
 *    视频生成所需的关键帧定义（`computeFrameDefines`），供
 *    `submitLtxDirectorImageToVideo` 提交 ltx-2.3-director 工作流使用。
 *
 * 消费方（workflows/director-inject.ts）读取 director.json 后调用本模块，
 * 因此解析必须防御性校验，宁可抛出中文错误信息，也不要把脏数据传入工作流。
 */

/**
 * 导演台配置中的图像片段（关键帧来源）。
 *
 * 对应 director.json 的 `imageClips` 数组元素，描述一张静态图像
 * 在最终视频时间轴上的出现位置与停留时长。
 */
export interface DirectorImageClipFile {
  /** 图像文件路径（相对项目根，如 `assert/scene/1/1/stage/0.jpg`） */
  path: string
  /** 该图像在视频时间轴上的起始偏移（秒，>= 0） */
  startOffset: number
  /** 该图像在视频中停留的时长（秒） */
  duration: number
}

/**
 * 导演台配置中的音频片段。
 *
 * 对应 director.json 的 `audioClips` 数组元素，描述一段音频文件
 * 在最终视频时间轴上的出现位置、停留时长以及从原文件裁剪的起止。
 */
export interface DirectorAudioClipFile {
  /** 音频文件路径（相对项目根，如 `assert/scene/1/1/audio/0.flac`） */
  path: string
  /** 该音频在视频时间轴上的起始偏移（秒，>= 0） */
  startOffset: number
  /** 该音频在视频中播放的时长（秒） */
  duration: number
  /** 从音频文件开头裁剪掉的时长（秒，>= 0） */
  trimStart: number
  /** 从音频文件末尾裁剪掉的时长（秒，>= 0） */
  trimEnd: number
}

/**
 * 导演台配置文件（director.json）的解析结果。
 *
 * 描述整个分镜视频的生成参数：视频规格、图像关键帧片段与音频片段。
 */
export interface DirectorConfigFile {
  /** 配置格式版本号（当前为 1） */
  version: number
  /** 视频总时长（秒，正整数） */
  duration: number
  /** 视频宽度（像素，正数） */
  width: number
  /** 视频高度（像素，正数） */
  height: number
  /** 视频帧率（fps，正数） */
  fps: number
  /** 图像关键帧片段列表（按视频时间轴排列） */
  imageClips: DirectorImageClipFile[]
  /** 音频片段列表 */
  audioClips: DirectorAudioClipFile[]
}

/**
 * 解析并校验导演台配置 JSON 字符串。
 *
 * 对 `JSON.parse` 的结果做防御性校验：duration 必须是正整数，
 * width/height/fps 必须是数字，imageClips/audioClips 必须是数组，
 * 且每个片段字段也逐项校验（path 非空、startOffset/trimStart/trimEnd >= 0、
 * duration > 0，均为有限数字）。任一校验失败都会抛出带中文说明的 Error，
 * 避免脏数据流入后续工作流。
 *
 * @param raw director.json 的原始文本内容
 * @returns 校验通过的导演台配置对象
 * @throws {Error} JSON 语法非法或字段类型不符合要求时抛出中文错误
 */
export function parseDirectorJson(raw: string): DirectorConfigFile {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('导演台配置不是合法的 JSON');
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error('导演台配置必须是 JSON 对象');
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.duration !== 'number' || !Number.isInteger(obj.duration) || obj.duration <= 0) {
    throw new Error('导演台配置的 duration 必须是正整数');
  }
  if (typeof obj.width !== 'number' || !Number.isFinite(obj.width) || obj.width <= 0) {
    throw new Error('导演台配置的 width 必须是正数');
  }
  if (typeof obj.height !== 'number' || !Number.isFinite(obj.height) || obj.height <= 0) {
    throw new Error('导演台配置的 height 必须是正数');
  }
  if (typeof obj.fps !== 'number' || !Number.isFinite(obj.fps) || obj.fps <= 0) {
    throw new Error('导演台配置的 fps 必须是正数');
  }
  if (!Array.isArray(obj.imageClips)) {
    throw new Error('导演台配置的 imageClips 必须是数组');
  }
  if (!Array.isArray(obj.audioClips)) {
    throw new Error('导演台配置的 audioClips 必须是数组');
  }

  // 逐片段防御性校验：任一字段非法都抛出中文错误，避免脏数据流入工作流
  for (const [index, clip] of (obj.imageClips as unknown[]).entries()) {
    validateImageClip(clip, index);
  }
  for (const [index, clip] of (obj.audioClips as unknown[]).entries()) {
    validateAudioClip(clip, index);
  }

  return {
    version: typeof obj.version === 'number' ? obj.version : 1,
    duration: obj.duration,
    width: obj.width,
    height: obj.height,
    fps: obj.fps,
    imageClips: obj.imageClips as DirectorImageClipFile[],
    audioClips: obj.audioClips as DirectorAudioClipFile[],
  };
}

/**
 * 校验单个图像片段字段。
 *
 * 要求：path 为非空字符串、startOffset 为有限数字且 >= 0、
 * duration 为有限数字且 > 0。任一不满足即抛出中文 Error。
 *
 * @param clip 待校验的图像片段（未知类型）
 * @param index 片段在 imageClips 数组中的下标（用于错误提示）
 * @throws {Error} 字段不合法时抛出中文错误
 */
function validateImageClip(clip: unknown, index: number): void {
  const c = (clip ?? {}) as Record<string, unknown>;
  if (typeof c.path !== 'string' || c.path.trim() === '') {
    throw new Error(`导演台配置 imageClips[${index}] 的 path 必须是非空字符串`);
  }
  if (typeof c.startOffset !== 'number' || !Number.isFinite(c.startOffset) || c.startOffset < 0) {
    throw new Error(`导演台配置 imageClips[${index}] 的 startOffset 必须是 >= 0 的有限数字`);
  }
  if (typeof c.duration !== 'number' || !Number.isFinite(c.duration) || c.duration <= 0) {
    throw new Error(`导演台配置 imageClips[${index}] 的 duration 必须是 > 0 的有限数字`);
  }
}

/**
 * 校验单个音频片段字段。
 *
 * 在图像片段要求（path 非空、startOffset/duration 为有限数字且范围合法）基础上，
 * 额外要求 trimStart/trimEnd 为有限数字且 >= 0。任一不满足即抛出中文 Error。
 *
 * @param clip 待校验的音频片段（未知类型）
 * @param index 片段在 audioClips 数组中的下标（用于错误提示）
 * @throws {Error} 字段不合法时抛出中文错误
 */
function validateAudioClip(clip: unknown, index: number): void {
  const c = (clip ?? {}) as Record<string, unknown>;
  if (typeof c.path !== 'string' || c.path.trim() === '') {
    throw new Error(`导演台配置 audioClips[${index}] 的 path 必须是非空字符串`);
  }
  if (typeof c.startOffset !== 'number' || !Number.isFinite(c.startOffset) || c.startOffset < 0) {
    throw new Error(`导演台配置 audioClips[${index}] 的 startOffset 必须是 >= 0 的有限数字`);
  }
  if (typeof c.duration !== 'number' || !Number.isFinite(c.duration) || c.duration <= 0) {
    throw new Error(`导演台配置 audioClips[${index}] 的 duration 必须是 > 0 的有限数字`);
  }
  if (typeof c.trimStart !== 'number' || !Number.isFinite(c.trimStart) || c.trimStart < 0) {
    throw new Error(`导演台配置 audioClips[${index}] 的 trimStart 必须是 >= 0 的有限数字`);
  }
  if (typeof c.trimEnd !== 'number' || !Number.isFinite(c.trimEnd) || c.trimEnd < 0) {
    throw new Error(`导演台配置 audioClips[${index}] 的 trimEnd 必须是 >= 0 的有限数字`);
  }
}

/**
 * 由图像片段生成关键帧定义（frame defines）。
 *
 * 将图像片段按 `startOffset` 升序排列，为每个片段生成：
 * - `frameSeq`：从 0 开始递增的关键帧序号（对应工作流文件键 `frame_{frameSeq}`）；
 * - `cursor`：该帧在视频长度中的出现位置比值，即 `startOffset / duration`，
 *   钳制在 [0, 1] 区间（防御 startOffset 异常超界）。
 *
 * @param imageClips 导演台配置中的图像片段列表
 * @param duration 视频总时长（秒），作为 cursor 归一化的分母
 * @returns 按 startOffset 升序排列的关键帧定义数组
 */
export function computeFrameDefines(
  imageClips: DirectorImageClipFile[],
  duration: number,
): Array<{ path: string; frameSeq: number; cursor: number }> {
  return [...imageClips]
    .sort((a, b) => a.startOffset - b.startOffset)
    .map((clip, index) => {
      const cursor = Math.min(Math.max(clip.startOffset / duration, 0), 1);
      return { path: clip.path, frameSeq: index, cursor };
    });
}
