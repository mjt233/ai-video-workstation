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

/**
 * 输出格式哨兵（「原格式」= 产物扩展名跟随输入音频）。
 * 与前端 config.format 同构（frontend/src/canvas/audioTrim.ts），两端须同步修改。
 */
export const AUDIO_TRIM_FORMAT_ORIG = '---';

/** 裁剪音频节点可选输出格式（与前端下拉一致）。 */
export const AUDIO_TRIM_FORMATS = [AUDIO_TRIM_FORMAT_ORIG, 'wav', 'flac', 'mp3'] as const;

/** MP3 码率白名单（kbps）。 */
export const AUDIO_TRIM_MP3_BITRATES = [128, 192, 320] as const;

/** MP3 缺省码率（kbps）。 */
export const AUDIO_TRIM_MP3_BITRATE_DEFAULT = 192;

/**
 * 输出扩展名 → ffmpeg 音频编码器（「原格式」跟随输入扩展名时同样走本表）：
 * - mp3 → libmp3lame（按 mp3Bitrate 追加 -b:a）；
 * - wav → pcm_s16le（源为 24bit/浮点 PCM 时归一为 16bit，属预期）；
 * - m4a → aac（ipod 容器，浏览器可播放）；ogg → libvorbis；aac → aac（ADTS）；
 * 与前端白名单（frontend/src/canvas/audioTrim.ts AUDIO_TRIM_OUTPUT_EXTS）保持一致。
 */
const AUDIO_EXT_CODEC: Record<string, string> = {
  flac: 'flac',
  wav: 'pcm_s16le',
  mp3: 'libmp3lame',
  m4a: 'aac',
  ogg: 'libvorbis',
  aac: 'aac',
};

/**
 * 取文件扩展名（小写，不含点号）。
 *
 * @param relPath 项目内相对路径
 * @returns 小写扩展名（无扩展名时返回空串）
 */
function extensionOf(relPath: string): string {
  const name = relPath.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

/** 音频裁剪请求参数（起始位置与持续时长均使用秒；输出格式为可选附加参数） */
export interface TrimAudioParams {
  /** 起始位置（秒，可为小数，必须大于等于 0） */
  startTime: number;
  /** 裁剪时长（秒，可为小数，必须大于 0） */
  duration: number;
  /**
   * 输出格式（可选；缺省时按 outputPath 扩展名反推编码、不做一致性校验）：
   * - '---'：原格式——产物扩展名必须与输入音频扩展名一致，按输入扩展名编码输出；
   * - 'wav' | 'flac' | 'mp3'：显式输出格式，产物扩展名必须与该格式一致。
   */
  format?: string;
  /** MP3 码率（kbps，白名单 128/192/320，缺省 192）。仅输出为 mp3 编码（libmp3lame）时生效。 */
  mp3Bitrate?: number;
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
 * 允许音频裁剪写入的画布节点固定产物路径（output.`{flac|wav|mp3|ogg|m4a|aac}`）。
 *
 * 与前端 `canvasNodeOutputPath` 保持同一结构，避免接口被用于覆盖任意 assert 资产；
 * 分镜画布的集数/分镜号必须为正整数，场景画布必须包含场景、子场景和节点目录。
 * 输出扩展名白名单须与前端（canvas/audioTrim.ts）及 AUDIO_EXT_CODEC 保持一致。
 */
const CANVAS_AUDIO_OUTPUT_PATH =
  /^assert\/(?:scene\/[1-9]\d*\/[1-9]\d*\/canvas\/[^/]+|stage\/[^/]+\/canvas\/[^/]+\/[^/]+)\/output\.(flac|wav|mp3|ogg|m4a|aac)$/u;

/**
 * 校验并规范化音频裁剪节点的固定输出路径。
 *
 * @param relPath 项目内相对路径
 * @returns 规范化后的画布节点固定产物路径（output.{flac|wav|mp3|ogg|m4a|aac}）
 * @throws TrimAudioError 目标不是合法画布节点产物路径时抛出
 */
export function assertAudioTrimOutputPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || !CANVAS_AUDIO_OUTPUT_PATH.test(normalized)) {
    throw new TrimAudioError(
      '音频裁剪输出必须是画布节点的固定产物路径（output.flac / output.wav / output.mp3 / output.ogg / output.m4a / output.aac）',
      'INVALID',
    );
  }
  return normalized;
}

/**
 * 将项目内音频精准裁剪为独立音频文件（扩展名/编码按 params.format 与输出路径决定）。
 *
 * 使用输出端 `-ss` 与 `-t`，按呈现时间定位并保留小数秒；音频**重新编码**（不使用流拷贝），
 * 避免部分容器/编码的关键帧或时间戳造成切口偏移：
 * - 显式格式 wav/flac/mp3：输出对应扩展名与编码（mp3 按 mp3Bitrate 定码率）；
 * - 「原格式」（format = '---' 或缺省不校验）：产物扩展名须与输入一致，按输入扩展名重编码
 *   （如输入 .m4a 输出 aac-in-m4a、输入 .ogg 输出 vorbis——上传加载节点可提供这些格式）。
 *
 * @param project 项目名
 * @param audioPath 输入音频相对路径（assert/ 下）
 * @param params 起始位置与裁剪时长（秒），以及可选的输出格式 format/mp3Bitrate
 * @param outputPath 输出音频相对路径（画布节点固定 output.{ext}）
 * @returns 输出音频相对路径与实际裁剪时长
 * @throws TrimAudioError 输入缺失、参数非法、格式/码率非法、扩展名不一致、输出路径非法或 ffmpeg 执行失败
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

  // 输出编码与扩展名一致性校验
  const outputExt = extensionOf(outputRel);
  const inputExt = extensionOf(audioPath);
  if (params.format !== undefined) {
    if (!(AUDIO_TRIM_FORMATS as readonly string[]).includes(params.format)) {
      throw new TrimAudioError('format 仅支持：原格式(---)/wav/flac/mp3', 'INVALID');
    }
    if (params.format === AUDIO_TRIM_FORMAT_ORIG) {
      if (!AUDIO_EXT_CODEC[inputExt]) {
        throw new TrimAudioError(
          `「原格式」不支持的输入音频扩展名${inputExt ? `（.${inputExt}）` : ''}，请选择显式输出格式（wav/flac/mp3）`,
          'INVALID',
        );
      }
      if (outputExt !== inputExt) {
        throw new TrimAudioError(
          `「原格式」要求输出扩展名与输入一致：输入 .${inputExt}，输出 .${outputExt}`,
          'INVALID',
        );
      }
    } else if (outputExt !== params.format) {
      throw new TrimAudioError(`输出格式 ${params.format} 与产物路径扩展名 .${outputExt} 不一致`, 'INVALID');
    }
  }
  const bitrate = params.mp3Bitrate === undefined ? AUDIO_TRIM_MP3_BITRATE_DEFAULT : params.mp3Bitrate;
  if (!(AUDIO_TRIM_MP3_BITRATES as readonly number[]).includes(bitrate)) {
    throw new TrimAudioError('mp3Bitrate 仅支持 128/192/320（kbps）', 'INVALID');
  }
  const codec = AUDIO_EXT_CODEC[outputExt];
  if (!codec) {
    throw new TrimAudioError(`不支持的输出扩展名 .${outputExt || '(空)'}`, 'INVALID');
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
    const outputOptions = [
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
      codec,
      '-avoid_negative_ts',
      'make_zero',
    ];
    // mp3（libmp3lame）追加定码率
    if (codec === 'libmp3lame') {
      outputOptions.push('-b:a', `${bitrate}k`);
    }
    Ffmpeg(audioAbs)
      .outputOptions(outputOptions)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new TrimAudioError(`音频裁剪失败：${err.message}`, 'INVALID')))
      .save(outputAbs);
  });

  return { path: outputRel, duration: window.duration };
}
