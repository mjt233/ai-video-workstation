import fs from 'fs/promises';
import path from 'path';
import Ffmpeg from 'fluent-ffmpeg';
import { pathExists, resolveProjectPath } from './paths.js';

/**
 * 视频帧索引越界错误：携带 HTTP 400 语义，路由层据此映射响应。
 */
export class FrameIndexError extends Error {
  code = 'FRAME_INDEX_OUT_OF_RANGE';

  constructor(message: string) {
    super(message);
  }
}

/**
 * 解析视频帧索引为绝对帧序号（0 基）。
 *
 * 帧索引语义：
 * - 0 = 首帧、1 = 第二帧，以此类推（非负索引直接作为帧序号）；
 * - -1 = 尾帧、-2 = 倒数第二帧，以此类推（负索引按 总帧数 + 索引 换算）。
 *
 * @param frameIndex 用户输入帧索引（整数）
 * @param totalFrames 视频总帧数
 * @returns 绝对帧序号（0 基）
 * @throws FrameIndexError 当总帧数不可用或换算后越界时
 */
export function resolveFrameNumber(frameIndex: number, totalFrames: number): number {
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) {
    throw new FrameIndexError('无法读取视频帧数');
  }
  const n = frameIndex >= 0 ? frameIndex : totalFrames + frameIndex;
  if (n < 0 || n >= totalFrames) {
    throw new FrameIndexError(`帧索引越界：共 ${totalFrames} 帧，索引 ${frameIndex} 不可用`);
  }
  return n;
}

/**
 * 解析 ffprobe 帧率字段（如 "24000/1001"、"25/1" 或数字）为每秒帧数。
 *
 * @param rate ffprobe 返回的帧率字段（avg_frame_rate / r_frame_rate）
 * @returns 每秒帧数；无法解析返回 0
 */
export function parseFps(rate: string | number | undefined): number {
  if (typeof rate === 'number') return rate;
  if (typeof rate !== 'string' || !rate) return 0;
  const parts = rate.split('/');
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (parts.length === 2 && Number.isFinite(num) && Number.isFinite(den) && den > 0) {
    return num / den;
  }
  return Number.isFinite(num) ? num : 0;
}

/**
 * 获取视频总帧数：优先读 ffprobe 的视频流 nb_frames，缺失时按 时长 × 帧率 估算。
 *
 * @param filePath 视频绝对路径
 * @returns 总帧数
 */
export function getTotalFrames(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    Ffmpeg.ffprobe(filePath, (err: Error | null, data?: { streams?: Array<{ codec_type?: string; nb_frames?: string | number; avg_frame_rate?: string | number }>; format?: { duration?: number } }) => {
      if (err) {
        reject(err);
        return;
      }
      const stream = data?.streams?.find((s) => s.codec_type === 'video');
      const nbRaw = stream?.nb_frames;
      if (nbRaw != null && nbRaw !== '' && Number(nbRaw) > 0 && Number.isFinite(Number(nbRaw))) {
        resolve(Math.round(Number(nbRaw)));
        return;
      }
      const fps = stream ? parseFps(stream.avg_frame_rate) : 0;
      const duration = data?.format?.duration ?? 0;
      const frames = Math.round(duration * fps);
      if (Number.isFinite(frames) && frames > 0) {
        resolve(frames);
        return;
      }
      reject(new FrameIndexError('无法读取视频帧数'));
    });
  });
}

/**
 * 从视频中提取指定帧并输出为图片（png）。
 *
 * 使用 ffmpeg select 过滤器按帧序号精确选帧（帧精确，非时间点近似），
 * 输出文件扩展名由 outputPath 决定（画布约定 .png）。
 *
 * @param project 项目名
 * @param videoPath 视频相对路径（assert/ 下）
 * @param frameIndex 帧索引（整数，可负，语义见 resolveFrameNumber）
 * @param outputPath 输出图片相对路径（assert/ 下）
 * @returns 输出图片相对路径
 * @throws Error 视频不存在（code=NOT_FOUND）、路径越权（code=INVALID）、帧索引越界（FrameIndexError）或 ffmpeg 执行失败
 */
export async function extractVideoFrame(
  project: string,
  videoPath: string,
  frameIndex: number,
  outputPath: string,
): Promise<string> {
  const videoAbs = resolveProjectPath(project, videoPath);
  const outputAbs = resolveProjectPath(project, outputPath);
  if (!(await pathExists(videoAbs))) {
    throw Object.assign(new Error('视频文件不存在'), { code: 'NOT_FOUND' });
  }
  await fs.mkdir(path.dirname(outputAbs), { recursive: true });

  const totalFrames = await getTotalFrames(videoAbs);
  const frameNo = resolveFrameNumber(frameIndex, totalFrames);

  await new Promise<void>((resolve, reject) => {
    Ffmpeg(videoAbs)
      .outputOptions([
        // select=eq(n,N)：n 为解码帧序号（0 基），帧精确选取第 N 帧
        `-vf`,
        `select=eq(n\\,${frameNo})`,
        `-frames:v`,
        `1`,
        `-vsync`,
        `vfr`,
      ])
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .save(outputAbs);
  });

  return outputPath;
}
