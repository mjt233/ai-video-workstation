import fs from 'fs/promises';
import path from 'path';
import Ffmpeg from 'fluent-ffmpeg';
import { pathExists, resolveProjectPath } from './paths.js';
import { getAudioInfo, getVideoInfo, type VideoInfo } from './extract-frame.js';

/**
 * 裁剪视频错误：携带 HTTP 语义（INVALID=参数错误/越界、NOT_FOUND=输入缺失），
 * 路由层据此映射响应。
 */
export class TrimError extends Error {
  /** 错误码：NOT_FOUND / INVALID */
  code: string;

  /**
   * @param message 中文错误说明（直接返回给前端）
   * @param code 错误码（NOT_FOUND / INVALID）
   */
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** 裁剪起点与持续时长（用户输入，二选一指定起点） */
export interface TrimParams {
  /** 起始时间（秒，可小数）；与 startFrame 互斥，优先本字段 */
  startTime?: number;
  /** 起始帧索引（整数 ≥ 0）；无 startTime 时按 帧索引 / fps 换算为秒 */
  startFrame?: number;
  /** 持续时长（秒，> 0，可小数） */
  duration: number;
}

/** 解析后的裁剪窗口（ffmpeg -ss / -t 直接使用） */
export interface TrimWindow {
  /** 起点（秒，≥ 0 且 < 视频时长） */
  start: number;
  /** 实际持续时长（秒，> 0；超出片尾时截到剩余时长） */
  duration: number;
}

/**
 * 把用户填写的起点/时长解析为 ffmpeg 可用的裁剪窗口。
 *
 * - 优先 `startTime`（秒）；否则用 `startFrame / fps`；
 * - 起点必须落在 `[0, 视频时长)`；
 * - 持续时长必须 > 0；起点 + 时长超出片尾时截到剩余时长（不报错）。
 *
 * @param params 用户裁剪参数
 * @param info 视频探测结果（duration / fps）
 * @returns 解析后的裁剪窗口
 * @throws TrimError 参数非法、起点越界或帧模式无法读取帧率（code=INVALID）
 */
export function resolveTrimWindow(params: TrimParams, info: VideoInfo): TrimWindow {
  const videoDuration = info.duration;
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
    throw new TrimError('无法读取视频时长', 'INVALID');
  }
  if (!Number.isFinite(params.duration) || params.duration <= 0) {
    throw new TrimError('持续时长必须大于 0', 'INVALID');
  }

  let start: number;
  if (params.startTime !== undefined && params.startTime !== null) {
    if (!Number.isFinite(params.startTime) || params.startTime < 0) {
      throw new TrimError('起始时间必须是大于等于 0 的数字（秒）', 'INVALID');
    }
    start = params.startTime;
  } else if (params.startFrame !== undefined && params.startFrame !== null) {
    if (!Number.isInteger(params.startFrame) || params.startFrame < 0) {
      throw new TrimError('起始帧索引必须是大于等于 0 的整数', 'INVALID');
    }
    if (!Number.isFinite(info.fps) || info.fps <= 0) {
      throw new TrimError('无法读取视频帧率', 'INVALID');
    }
    const totalFrames = Math.round(videoDuration * info.fps);
    if (params.startFrame >= totalFrames) {
      throw new TrimError(
        `起始帧越界：共 ${totalFrames} 帧，索引 ${params.startFrame} 不可用`,
        'INVALID',
      );
    }
    start = params.startFrame / info.fps;
  } else {
    throw new TrimError('请指定起始时间或起始帧索引', 'INVALID');
  }

  if (start >= videoDuration) {
    throw new TrimError(`起始位置越界：时长 ${videoDuration}s，起点 ${start}s 不可用`, 'INVALID');
  }

  const remaining = videoDuration - start;
  const duration = Math.min(params.duration, remaining);
  if (!(duration > 0)) {
    throw new TrimError('裁剪后时长必须大于 0', 'INVALID');
  }
  return { start, duration };
}

/**
 * 探测输入视频是否含音轨（getAudioInfo 无音频流时 reject，视为无音轨）。
 *
 * @param absPath 视频绝对路径
 * @returns 含音轨返回 true
 */
async function hasAudioTrack(absPath: string): Promise<boolean> {
  return getAudioInfo(absPath)
    .then(() => true)
    .catch(() => false);
}

/**
 * 将输入视频按起点与持续时长裁剪为单个视频（重编码，保证帧/小数秒精度）。
 *
 * 不使用 `-c copy`：流拷贝只能落在关键帧上，无法满足帧索引 / 小数秒切口。
 * 视频编码 libx264 veryfast crf=18 yuv420p；有音轨则 aac，无音轨 -an；+faststart。
 *
 * @param project 项目名
 * @param videoPath 输入视频相对路径（assert/ 下）
 * @param params 裁剪参数（startTime 或 startFrame + duration）
 * @param outputPath 输出视频相对路径（assert/ 下，.mp4）
 * @returns 输出视频相对路径
 * @throws TrimError 输入缺失（NOT_FOUND）、参数非法/越界（INVALID）或 ffmpeg 执行失败
 */
export async function trimVideo(
  project: string,
  videoPath: string,
  params: TrimParams,
  outputPath: string,
): Promise<string> {
  const videoAbs = resolveProjectPath(project, videoPath);
  const outputAbs = resolveProjectPath(project, outputPath);
  if (!(await pathExists(videoAbs))) {
    throw new TrimError('视频文件不存在', 'NOT_FOUND');
  }
  await fs.mkdir(path.dirname(outputAbs), { recursive: true });

  let info: VideoInfo;
  try {
    info = await getVideoInfo(videoAbs);
  } catch {
    throw new TrimError('无法读取视频信息', 'INVALID');
  }
  const window = resolveTrimWindow(params, info);
  const withAudio = await hasAudioTrack(videoAbs);

  const outputOptions = [
    '-ss',
    String(window.start),
    '-t',
    String(window.duration),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
  ];
  if (withAudio) {
    outputOptions.push('-c:a', 'aac');
  } else {
    outputOptions.push('-an');
  }

  await new Promise<void>((resolve, reject) => {
    Ffmpeg(videoAbs)
      .outputOptions(outputOptions)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new TrimError(`裁剪失败：${err.message}`, 'INVALID')))
      .save(outputAbs);
  });

  return outputPath;
}
