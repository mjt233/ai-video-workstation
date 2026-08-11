import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import Ffmpeg from 'fluent-ffmpeg';
import { pathExists, resolveProjectPath } from './paths.js';
import { getAudioInfo, getVideoInfo } from './extract-frame.js';

/**
 * 拼接视频错误：携带 HTTP 语义（INVALID=规格不一致/参数错误、NOT_FOUND=输入缺失），
 * 路由层据此映射响应。
 */
export class ConcatError extends Error {
  /** 错误码：NOT_FOUND / INVALID */
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** 单段视频的拼接规格（前置校验用） */
export interface ConcatSegmentSpec {
  /** 视频编码（如 h264/hevc） */
  codec: string;
  /** 视频宽度（像素） */
  width: number;
  /** 视频高度（像素） */
  height: number;
  /** 帧率（每秒帧数） */
  fps: number;
  /** 是否含音轨 */
  hasAudio: boolean;
}

/**
 * 校验多段视频规格一致（策略 B：concat demuxer + `-c copy` 要求各段编码/分辨率/帧率/音轨结构一致）。
 *
 * 逐段与第 1 段比较，任一字段不一致即抛 `ConcatError(INVALID)` 并列出不一致项，
 * 给出清晰中文提示，避免 ffmpeg 的晦涩报错。
 *
 * @param specs 各段视频规格（顺序与 videoPaths 一致）
 * @throws ConcatError 存在不一致时（code=INVALID）
 */
export function assertConcatCompatible(specs: ConcatSegmentSpec[]): void {
  if (specs.length === 0) return;
  const first = specs[0];
  for (let i = 1; i < specs.length; i++) {
    const s = specs[i];
    const mismatches: string[] = [];
    if (s.codec !== first.codec) mismatches.push('视频编码');
    if (s.width !== first.width || s.height !== first.height) mismatches.push('分辨率');
    if (Math.abs(s.fps - first.fps) > 0.01) mismatches.push('帧率');
    if (s.hasAudio !== first.hasAudio) mismatches.push('音轨结构');
    if (mismatches.length > 0) {
      throw new ConcatError(
        `第 ${i + 1} 段与第 1 段视频规格不一致（${mismatches.join('、')}），无法无损拼接。请先统一各段规格后再拼接。`,
        'INVALID',
      );
    }
  }
}

/**
 * 探测单段视频的拼接规格（编码/分辨率/帧率/是否含音轨）。
 *
 * @param project 项目名
 * @param videoPath 视频相对路径（assert/ 下）
 * @returns 视频规格
 * @throws ConcatError 视频不存在（code=NOT_FOUND）或 ffprobe 失败
 */
async function probeSegmentSpec(project: string, videoPath: string): Promise<ConcatSegmentSpec> {
  const abs = resolveProjectPath(project, videoPath);
  if (!(await pathExists(abs))) {
    throw new ConcatError('视频文件不存在', 'NOT_FOUND');
  }
  const info = await getVideoInfo(abs);
  // 探测音轨：getAudioInfo 无音频流时 reject，视为无音轨
  const hasAudio = await getAudioInfo(abs)
    .then(() => true)
    .catch(() => false);
  return {
    codec: info.codec ?? '',
    width: info.width,
    height: info.height,
    fps: info.fps,
    hasAudio,
  };
}

/**
 * 将多段视频按顺序无损拼接为单个视频（concat demuxer + `-c copy`）。
 *
 * 前置校验各段规格一致（编码/分辨率/帧率/音轨结构），不一致抛 `ConcatError(INVALID)`；
 * 拼接前把各段绝对路径写入临时 concat 列表文件（UTF-8），ffmpeg 按列表顺序读取，
 * 完成后删除临时文件。
 *
 * @param project 项目名
 * @param videoPaths 视频相对路径数组（assert/ 下，按拼接顺序，至少 2 段）
 * @param outputPath 输出视频相对路径（assert/ 下，.mp4）
 * @returns 输出视频相对路径
 * @throws ConcatError 输入缺失（code=NOT_FOUND）、规格不一致/段数不足（code=INVALID）或 ffmpeg 执行失败
 */
export async function concatVideos(
  project: string,
  videoPaths: string[],
  outputPath: string,
): Promise<string> {
  if (videoPaths.length < 2) {
    throw new ConcatError('至少需要两段视频才能拼接', 'INVALID');
  }
  const outputAbs = resolveProjectPath(project, outputPath);
  await fs.mkdir(path.dirname(outputAbs), { recursive: true });

  // 前置规格校验：各段编码/分辨率/帧率/音轨结构一致（-c copy 要求）
  const specs: ConcatSegmentSpec[] = [];
  for (const vp of videoPaths) {
    specs.push(await probeSegmentSpec(project, vp));
  }
  assertConcatCompatible(specs);

  // 写入 concat 列表文件（UTF-8；路径统一正斜杠，Windows 下 ffmpeg 可读）
  const listPath = path.join(os.tmpdir(), `concat-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const listBody =
    videoPaths.map((vp) => `file '${resolveProjectPath(project, vp).replace(/\\/g, '/')}'`).join('\n') + '\n';
  await fs.writeFile(listPath, listBody, { encoding: 'utf8' });

  try {
    await new Promise<void>((resolve, reject) => {
      Ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(new ConcatError(`拼接失败：${err.message}`, 'INVALID')))
        .save(outputAbs);
    });
  } finally {
    await fs.unlink(listPath).catch(() => undefined);
  }

  return outputPath;
}
