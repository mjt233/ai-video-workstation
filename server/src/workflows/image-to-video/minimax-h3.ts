import type { MinimaxContentInput, MinimaxRatio } from '../../providers/minimax-h3/client.js';
import { register } from '../registry.js';
import type { VideoWorkflowSubmitData, WorkflowRunContext, WorkflowVarsBase } from '../types.js';

/**
 * MiniMax H3 图生视频工作流实现（provider: minimax-h3）。
 *
 * 在 image-to-video 类型下注册两个实现：
 * - minimax-h3-i2v：图生视频（I2VA）——首帧（或首尾两帧）图片驱动生成，对应官方 i2va 场景；
 * - minimax-h3-r2v：多模态参考生视频（R2VA）——参考图片/视频/音频驱动生成，对应官方 r2va 场景。
 *
 * 官方文档：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create
 *
 * 两种实现的提交载荷统一走 MiniMax 传输客户端（providers/minimax-h3）：
 * - text 项承载提示词（每个请求必须包含一个非空 text）；
 * - 媒体项以 fileKey 引用文件，客户端负责上传（/v1/files/upload）并以 mm_file://{file_id} 引用。
 */

/** 视频时长约束（官方：duration 为 4~15 的整数） */
const MIN_DURATION = 4;
const MAX_DURATION = 15;

/** 参考素材数量上限（官方输入媒体限制） */
const MAX_REF_IMAGES = 9;
const MAX_REF_VIDEOS = 3;
const MAX_REF_AUDIOS = 3;
/** 参考素材总数量上限（图片 + 视频 + 音频） */
const MAX_REF_TOTAL = MAX_REF_IMAGES + MAX_REF_VIDEOS + MAX_REF_AUDIOS;

/** 标准宽高比（r2va 显式 ratio 匹配用；i2va 恒 adaptive 由输入图片决定） */
const STANDARD_RATIOS: Array<{ ratio: Exclude<MinimaxRatio, 'adaptive'>; value: number }> = [
  { ratio: '21:9', value: 21 / 9 },
  { ratio: '16:9', value: 16 / 9 },
  { ratio: '4:3', value: 4 / 3 },
  { ratio: '1:1', value: 1 },
  { ratio: '3:4', value: 3 / 4 },
  { ratio: '9:16', value: 9 / 16 },
];

/**
 * 取引擎注入的自包含视频提交数据。
 *
 * @param ctx 工作流运行上下文
 * @returns 视频提交数据
 * @throws {Error} 未注入 ctx.video 时
 */
function getVideo(ctx: WorkflowRunContext<WorkflowVarsBase>): VideoWorkflowSubmitData {
  const video = (ctx as { video?: VideoWorkflowSubmitData }).video;
  if (!video) {
    throw new Error('image-to-video 需要引擎注入 ctx.video');
  }
  return video;
}

/**
 * 解析并校验视频时长：四舍五入取整后须落在 4~15 秒（官方 duration 约束）。
 *
 * @param duration 原始时长（秒）
 * @returns 规范化后的整数时长
 * @throws {Error} 时长非法或超出 4~15 秒时
 */
export function resolveMinimaxDuration(duration: number): number {
  if (!Number.isFinite(duration)) {
    throw new Error(`MiniMax H3 视频时长无效: ${String(duration)}`);
  }
  const rounded = Math.round(duration);
  if (rounded < MIN_DURATION || rounded > MAX_DURATION) {
    throw new Error(`MiniMax H3 视频时长须为 ${MIN_DURATION}~${MAX_DURATION} 秒的整数，当前 ${duration} 秒`);
  }
  return rounded;
}

/**
 * 把输出宽高映射为 MiniMax ratio：命中标准宽高比（容差 2%）时返回对应值，否则返回 adaptive。
 *
 * @param width 输出宽度（像素）
 * @param height 输出高度（像素）
 * @returns ratio 值（标准比例或 adaptive）
 */
export function resolveMinimaxRatio(width: number, height: number): MinimaxRatio {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'adaptive';
  }
  const value = width / height;
  for (const item of STANDARD_RATIOS) {
    if (Math.abs(value - item.value) / item.value < 0.02) {
      return item.ratio;
    }
  }
  return 'adaptive';
}

/**
 * 图生视频（I2VA）提交实现。
 *
 * - 取视频数据 director.frames（按 cursor 升序），第 1 帧作为 first_frame；
 * - 帧数 ≥2 时最后一帧作为 last_frame（官方首尾帧场景，中间帧不参与）；
 * - 官方 i2va 宽高比由输入图片决定（ratio 恒 adaptive），且不支持输入音频：
 *   导演台/首尾帧附带的音频被忽略（H3 会按提示词自带音频），如需音频请改用 R2VA。
 *
 * @param ctx 工作流运行上下文（ctx.video 为引擎注入的自包含视频提交数据）
 * @returns 远端任务 ID
 */
async function submitI2va(ctx: WorkflowRunContext<WorkflowVarsBase>): Promise<{ taskId: string }> {
  const video = getVideo(ctx);
  const prompt = (video.prompt ?? '').trim();
  if (!prompt) {
    throw new Error('MiniMax H3 图生视频（I2VA）需要提示词（prompt）');
  }
  const frames = [...(video.director?.frames ?? [])].sort((a, b) => a.cursor - b.cursor);
  if (frames.length === 0) {
    throw new Error('MiniMax H3 图生视频（I2VA）至少需要 1 帧图片（首帧）');
  }
  if (video.director?.audio) {
    // I2VA 仅支持首/尾帧图片输入；H3 为原生多模态模型，会按提示词生成自带音频
    console.warn('[minimax-h3-i2v] I2VA 不支持音频输入，已忽略附加音频（如需使用参考音频请改用 R2VA）');
  }

  const content: MinimaxContentInput[] = [{ type: 'text', text: prompt }];
  const files: Record<string, File> = {};
  files.first_frame = frames[0].file;
  content.push({ type: 'image_url', role: 'first_frame', fileKey: 'first_frame' });
  if (frames.length > 1) {
    files.last_frame = frames[frames.length - 1].file;
    content.push({ type: 'image_url', role: 'last_frame', fileKey: 'last_frame' });
  }

  return ctx.provider.execute({
    workflowId: 'MiniMax-H3',
    params: {
      content,
      duration: resolveMinimaxDuration(video.duration),
      // i2va：宽高比由输入图片决定，官方约定恒为 adaptive
      ratio: 'adaptive' as const,
    },
    files,
  });
}

/**
 * 多模态参考生视频（R2VA）提交实现。
 *
 * - references 按类型分拣：图片 → reference_image、视频 → reference_video、音频 → reference_audio；
 * - 校验：至少 1 个图片或视频（音频不能作为唯一输入）、各类型数量上限与总数上限；
 * - 输出宽高命中标准比例时显式传 ratio，否则 adaptive（由模型自适应）。
 *
 * @param ctx 工作流运行上下文（ctx.video 为引擎注入的自包含视频提交数据）
 * @returns 远端任务 ID
 */
async function submitR2va(ctx: WorkflowRunContext<WorkflowVarsBase>): Promise<{ taskId: string }> {
  const video = getVideo(ctx);
  const prompt = (video.prompt ?? '').trim();
  if (!prompt) {
    throw new Error('MiniMax H3 参考生视频（R2VA）需要提示词（prompt）');
  }
  const refs = video.references ?? [];
  const images = refs.filter((r) => r.type === 'image');
  const videos = refs.filter((r) => r.type === 'video');
  const audios = refs.filter((r) => r.type === 'audio');

  if (images.length + videos.length < 1) {
    throw new Error('MiniMax H3 参考生视频（R2VA）至少需要 1 个图片或视频参考素材（音频不能单独作为输入）');
  }
  if (images.length > MAX_REF_IMAGES) {
    throw new Error(`MiniMax H3 参考图片数量超过上限（${MAX_REF_IMAGES}），当前 ${images.length}`);
  }
  if (videos.length > MAX_REF_VIDEOS) {
    throw new Error(`MiniMax H3 参考视频数量超过上限（${MAX_REF_VIDEOS}），当前 ${videos.length}`);
  }
  if (audios.length > MAX_REF_AUDIOS) {
    throw new Error(`MiniMax H3 参考音频数量超过上限（${MAX_REF_AUDIOS}），当前 ${audios.length}`);
  }
  if (refs.length > MAX_REF_TOTAL) {
    throw new Error(`MiniMax H3 参考素材总数量超过上限（${MAX_REF_TOTAL}），当前 ${refs.length}`);
  }

  const content: MinimaxContentInput[] = [{ type: 'text', text: prompt }];
  const files: Record<string, File> = {};
  images.forEach((r, i) => {
    const key = `image_${i}`;
    files[key] = r.file;
    content.push({ type: 'image_url', role: 'reference_image', fileKey: key });
  });
  videos.forEach((r, i) => {
    const key = `video_${i}`;
    files[key] = r.file;
    content.push({ type: 'video_url', role: 'reference_video', fileKey: key });
  });
  audios.forEach((r, i) => {
    const key = `audio_${i}`;
    files[key] = r.file;
    content.push({ type: 'audio_url', role: 'reference_audio', fileKey: key });
  });

  const ratio = resolveMinimaxRatio(video.resolution.width, video.resolution.height);
  return ctx.provider.execute({
    workflowId: 'MiniMax-H3',
    params: {
      content,
      duration: resolveMinimaxDuration(video.duration),
      ...(ratio !== 'adaptive' ? { ratio } : {}),
    },
    files,
  });
}

/** MiniMax H3 图生视频（I2VA）实现注册 */
register({
  type: 'image-to-video',
  impl: 'minimax-h3-i2v',
  name: 'MiniMax H3 图生视频（I2VA）',
  description: 'MiniMax H3 图生视频：以首帧（或首尾两帧）图片驱动生成 2K/768P 视频（4~15 秒）',
  provider: 'minimax-h3',
  capabilities: {
    cancelable: true,
    video: {
      modes: ['first-last-frame'],
      firstLastFrame: { maxFrames: 2 },
      maxDuration: 15,
    },
  },
  submit: submitI2va,
});

/** MiniMax H3 多模态参考生视频（R2VA）实现注册 */
register({
  type: 'image-to-video',
  impl: 'minimax-h3-r2v',
  name: 'MiniMax H3 参考生视频（R2VA）',
  description: 'MiniMax H3 多模态参考生视频：参考图片/视频/音频驱动生成 2K/768P 视频（4~15 秒）',
  provider: 'minimax-h3',
  capabilities: {
    cancelable: true,
    video: {
      modes: ['reference'],
      reference: {
        maxTotal: MAX_REF_TOTAL,
        types: {
          image: { max: MAX_REF_IMAGES },
          video: { max: MAX_REF_VIDEOS, minDuration: 2, maxDuration: 15 },
          audio: { max: MAX_REF_AUDIOS, minDuration: 2, maxDuration: 15 },
        },
        audioRequiresVisual: true,
      },
      maxDuration: 15,
    },
  },
  submit: submitR2va,
});
