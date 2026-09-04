import fs from 'fs/promises';
import path from 'path';
import Ffmpeg from 'fluent-ffmpeg';
import { getAudioInfo, type AudioInfo } from './extract-frame.js';
import { pathExists, resolveProjectPath } from './paths.js';

/**
 * 音频裁剪错误：携带 HTTP 语义，路由层据此映射响应状态码。
 */
export class TrimAudioError extends Error {
  /** 错误码：NOT_FOUND / INVALID */
  code: string;

  /**
   * @param message 中文错误说明，可直接展示给前端
   * @param code 错误码
   */
  constructor(message: string, code: string) {
    super(message);
    this.name = 'TrimAudioError';
    this.code = code;
  }
}

/** 音频裁剪请求参数（起始位置与持续时长均使用秒） */
export interface TrimAudioParams {
  /** 起始位置（秒，可为小数，必须大于等于 0） */
  startTime: number;
  /** 裁剪时长（秒，可为小数，必须大于 0） */
  duration: number;
}

/** 音频裁剪执行结果：产物相对路径 + 实际裁剪时长（供前端提示/回显） */
export interface AudioTrimResult {
  /** 输出音频相对路径（assert/ 下） */
  path: string;
  /** 实际裁剪时长（秒；超出片尾时短于请求值） */
  duration: number;
}

/** 经源音频时长校正后的裁剪窗口 */
export interface AudioTrimWindow {
  /** 实际起始位置（秒） */
  start: number;
  /** 实际裁剪时长（秒；超出片尾时截到剩余时长） */
  duration: number;
}

/**
 * 根据源音频时长解析裁剪窗口。
 *
 * 起始位置必须落在 `[0, 音频时长)`；当起始位置加裁剪时长超过片尾时，
 * 将实际时长截短到剩余部分，避免 ffmpeg 产生空文件或不可预测的尾部数据。
 *
 * @param params 用户输入的起始位置与裁剪时长
 * @param info ffprobe 返回的音频基础信息
 * @returns 可直接交给 ffmpeg 的裁剪窗口
 * @throws TrimAudioError 音频时长、起始位置或持续时长非法
 */
export function resolveAudioTrimWindow(params: TrimAudioParams, info: AudioInfo): AudioTrimWindow {
  const sourceDuration = info.duration;
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new TrimAudioError('无法读取音频时长', 'INVALID');
  }
  if (!Number.isFinite(params.startTime) || params.startTime < 0) {
    throw new TrimAudioError('起始位置必须是大于等于 0 的数字（秒）', 'INVALID');
  }
  if (!Number.isFinite(params.duration) || params.duration <= 0) {
    throw new TrimAudioError('裁剪时长必须大于 0', 'INVALID');
  }
  if (params.startTime >= sourceDuration) {
    throw new TrimAudioError(
      `起始位置越界：音频时长 ${sourceDuration}s，起点 ${params.startTime}s 不可用`,
      'INVALID',
    );
  }

  const duration = Math.min(params.duration, sourceDuration - params.startTime);
  if (!(duration > 0)) {
    throw new TrimAudioError('裁剪后时长必须大于 0', 'INVALID');
  }
  return { start: params.startTime, duration };
}

/**
 * 允许音频裁剪写入的画布节点固定产物路径。
 *
 * 与前端 `canvasNodeOutputPath(..., 'flac')` 保持同一结构，避免接口被用于覆盖任意
 * assert 资产；分镜画布的集数/分镜号必须为正整数，场景画布必须包含场景、子场景和节点目录。
 */
const CANVAS_AUDIO_OUTPUT_PATH =
  /^assert\/(?:scene\/[1-9]\d*\/[1-9]\d*\/canvas\/[^/]+|stage\/[^/]+\/canvas\/[^/]+\/[^/]+)\/output\.flac$/u;

/**
 * 校验并规范化音频裁剪节点的固定输出路径。
 *
 * @param relPath 项目内相对路径
 * @returns 规范化后的画布节点 `output.flac` 路径
 * @throws TrimAudioError 目标不是合法画布节点产物路径时抛出
 */
export function assertAudioTrimOutputPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || !CANVAS_AUDIO_OUTPUT_PATH.test(normalized)) {
    throw new TrimAudioError('音频裁剪输出必须是画布节点的固定 output.flac 路径', 'INVALID');
  }
  return normalized;
}

/**
 * 将项目内音频精准裁剪为独立 FLAC 文件。
 *
 * 使用输出端 `-ss` 与 `-t`，按呈现时间定位并保留小数秒；音频重新编码为 FLAC，
 * 不使用流拷贝，避免部分容器/编码的关键帧或时间戳造成切口偏移。FLAC 为无损格式，
 * 适合作为后续 TTS、导演台及其它音频节点的稳定中间产物。
 *
 * @param project 项目名
 * @param audioPath 输入音频相对路径（assert/ 下）
 * @param params 起始位置与裁剪时长（秒）
 * @param outputPath 输出音频相对路径（画布节点固定 `output.flac`）
 * @returns 输出音频相对路径与实际裁剪时长
 * @throws TrimAudioError 输入缺失、参数非法、输出路径非法或 ffmpeg 执行失败
 */
export async function trimAudio(
  project: string,
  audioPath: string,
  params: TrimAudioParams,
  outputPath: string,
): Promise<AudioTrimResult> {
  const outputRel = assertAudioTrimOutputPath(outputPath);
  const audioAbs = resolveProjectPath(project, audioPath);
  const outputAbs = resolveProjectPath(project, outputRel);
  if (!(await pathExists(audioAbs))) {
    throw new TrimAudioError('音频文件不存在', 'NOT_FOUND');
  }
  if (path.resolve(audioAbs) === path.resolve(outputAbs)) {
    throw new TrimAudioError('输入音频与输出路径不能相同', 'INVALID');
  }

  let info: AudioInfo;
  try {
    info = await getAudioInfo(audioAbs);
  } catch {
    throw new TrimAudioError('无法读取音频信息', 'INVALID');
  }
  const window = resolveAudioTrimWindow(params, info);

  await fs.mkdir(path.dirname(outputAbs), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    Ffmpeg(audioAbs)
      .outputOptions([
        // 输出端 -ss 在解码后按呈现时间定位，适合小数秒精确切口
        '-ss',
        String(window.start),
        '-t',
        String(window.duration),
        // 只取第一路音频，明确去除可能存在的视频流
        '-map',
        '0:a:0',
        '-vn',
        '-c:a',
        'flac',
        '-avoid_negative_ts',
        'make_zero',
      ])
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new TrimAudioError(`音频裁剪失败：${err.message}`, 'INVALID')))
      .save(outputAbs);
  });

  return { path: outputRel, duration: window.duration };
}
