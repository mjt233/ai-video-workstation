import fs from 'fs/promises';
import { writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import Ffmpeg from 'fluent-ffmpeg';
import { pathExists, resolveProjectPath } from './paths.js';
import { getAudioInfo, getVideoInfo } from './extract-frame.js';
import type { FfmpegCommandSpec } from './ffmpeg-command.js';

/**
 * 拼接视频错误：携带 HTTP 语义（INVALID=规格不一致/参数错误、NOT_FOUND=输入缺失），
 * 路由层据此映射响应。
 */
export class ConcatError extends Error {
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

/** 拼接编码方式：copy = 无损流拷贝（各段规格须一致）；reencode = 重编码（允许异构规格） */
export type ConcatMode = 'copy' | 'reencode';

/**
 * 重编码输出尺寸策略：
 * - custom：用户自定义宽高；
 * - max：按像素面积取最大那一段的完整宽高；
 * - min：按像素面积取最小那一段的完整宽高。
 */
export type ConcatSizeMode = 'custom' | 'max' | 'min';

/** 拼接参数（缺省时按 reencode + max 兜底，兼容旧调用） */
export interface ConcatParams {
  /** 编码方式（缺省 reencode） */
  mode?: ConcatMode;
  /** 输出尺寸策略（缺省 max；仅 reencode 生效） */
  sizeMode?: ConcatSizeMode;
  /** 自定义输出宽度（像素，sizeMode=custom 时必填） */
  width?: number;
  /** 自定义输出高度（像素，sizeMode=custom 时必填） */
  height?: number;
  /** 是否开启自然过渡（相邻段之间交叉淡化；仅 reencode 生效，copy 模式忽略） */
  transition?: boolean;
  /** 交叉过渡时长（秒，0.1~5；transition=true 时生效，须小于每段时长） */
  crossfadeDuration?: number;
}

/** 单段视频的拼接规格（前置校验 / 尺寸计算 / 音轨补齐用） */
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
  /** 时长（秒；重编码进度计算与静音补齐用） */
  duration: number;
}

/** 重编码 ffmpeg 参数（filter_complex 拼装结果） */
export interface ReencodeArgs {
  /** 额外输入选项（静音源 `-f lavfi -i anullsrc...`，每项一组参数） */
  extraInputs: string[][];
  /** `-filter_complex` 表达式 */
  filterComplex: string;
  /** 输出选项（`-map` / 编码参数） */
  outputOptions: string[];
  /** 目标输出尺寸（宽） */
  width: number;
  /** 目标输出尺寸（高） */
  height: number;
  /** 目标帧率 */
  fps: number;
  /** 输出是否含音轨 */
  withAudio: boolean;
}

/** 归一化后的拼接参数（缺省值已填充） */
interface NormalizedConcatParams {
  /** 编码方式 */
  mode: ConcatMode;
  /** 输出尺寸策略 */
  sizeMode: ConcatSizeMode;
  /** 自定义宽（仅 custom） */
  width?: number;
  /** 自定义高（仅 custom） */
  height?: number;
  /** 是否开启自然过渡（仅 reencode 生效） */
  transition: boolean;
  /** 交叉过渡时长（秒，0.1~5，缺省 0.5） */
  crossfadeDuration: number;
}

/** 目标音频采样率（重编码统一） */
const TARGET_AUDIO_RATE = 48000;

/** 目标音频声道布局（重编码统一） */
const TARGET_CHANNEL_LAYOUT = 'stereo';

/**
 * 归一化拼接参数（缺省 reencode + max；非法枚举回退缺省）。
 *
 * 自然过渡仅 reencode 生效：copy 模式强制关闭（xfade 需重编码）；`crossfadeDuration`
 * 须为 0.1~5 秒的有限数，非法回退缺省 0.5。
 *
 * @param params 原始参数（可省略）
 * @returns 归一化后的参数
 */
export function normalizeConcatParams(params?: ConcatParams): NormalizedConcatParams {
  const mode: ConcatMode = params?.mode === 'copy' ? 'copy' : 'reencode';
  const sizeMode: ConcatSizeMode =
    params?.sizeMode === 'custom' || params?.sizeMode === 'min' ? params.sizeMode : 'max';
  const transition = mode !== 'copy' && params?.transition === true;
  const rawDur = params?.crossfadeDuration;
  const dur =
    typeof rawDur === 'number' && Number.isFinite(rawDur) ? Math.min(5, Math.max(0.1, rawDur)) : 0.5;
  return {
    mode,
    sizeMode,
    ...(typeof params?.width === 'number' ? { width: params.width } : {}),
    ...(typeof params?.height === 'number' ? { height: params.height } : {}),
    transition,
    crossfadeDuration: dur,
  };
}

/**
 * 校验多段视频规格一致（copy 模式：concat demuxer + `-c copy` 要求各段编码/分辨率/帧率/音轨结构一致）。
 *
 * 逐段与第 1 段比较，任一字段不一致即抛 `ConcatError(INVALID)` 并列出不一致项，
 * 给出清晰中文提示（含「改用重编码」建议），避免 ffmpeg 的晦涩报错。
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
        `第 ${i + 1} 段与第 1 段视频规格不一致（${mismatches.join('、')}），无法无损拼接。请改用「重编码」编码方式后再拼接。`,
        'INVALID',
      );
    }
  }
}

/**
 * 把宽高规整为偶数（H.264 yuv420p 要求宽高为偶数；奇数时向上 +1）。
 *
 * @param value 原始值（像素）
 * @returns 不小于原值的偶数
 */
export function toEven(value: number): number {
  const v = Math.max(2, Math.round(value));
  return v % 2 === 0 ? v : v + 1;
}

/**
 * 解析重编码的目标输出尺寸。
 *
 * - `custom`：使用用户宽高（必须是正数，规整为偶数）；
 * - `max` / `min`：按**像素面积**取那一段的完整宽高（面积相同时取先出现的一段）；
 * 返回值宽高均规整为偶数。
 *
 * @param specs 各段视频规格（顺序即拼接顺序）
 * @param params 归一化后的拼接参数
 * @returns 目标宽高（像素，偶数）
 * @throws ConcatError 段数为空或自定义宽高非法（code=INVALID）
 */
export function resolveOutputSize(
  specs: ConcatSegmentSpec[],
  params: NormalizedConcatParams,
): { width: number; height: number } {
  if (specs.length === 0) {
    throw new ConcatError('没有可用的视频段', 'INVALID');
  }
  if (params.sizeMode === 'custom') {
    const w = params.width;
    const h = params.height;
    if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0 || typeof h !== 'number' || !Number.isFinite(h) || h <= 0) {
      throw new ConcatError('自定义输出尺寸需要填写有效的宽度与高度（正整数像素）', 'INVALID');
    }
    return { width: toEven(w), height: toEven(h) };
  }
  let picked = specs[0];
  for (const s of specs) {
    const area = s.width * s.height;
    const pickedArea = picked.width * picked.height;
    if (params.sizeMode === 'max' ? area > pickedArea : area < pickedArea) picked = s;
  }
  return { width: toEven(picked.width), height: toEven(picked.height) };
}

/**
 * 解析重编码的目标帧率：取各段最高帧率（避免降帧；无法解析时回退 30）。
 *
 * @param specs 各段视频规格
 * @returns 目标帧率（每秒帧数）
 */
export function resolveOutputFps(specs: ConcatSegmentSpec[]): number {
  let fps = 0;
  for (const s of specs) {
    if (Number.isFinite(s.fps) && s.fps > 0) fps = Math.max(fps, s.fps);
  }
  return fps > 0 ? fps : 30;
}

/**
 * 构造重编码的 ffmpeg 参数（filter_complex 单次编码，不落中间文件）。
 *
 * 每段归一化规则：
 * - 画面：`scale`（等比缩小/放大到目标框内）+ `pad`（居中留黑边）+ `setsar=1`（方形像素）+ `fps`（统一帧率）；
 * - 音轨：任一段含音轨则全部保留音轨结构——无音轨段用 `anullsrc` 静音源补齐，
 *   并统一采样率/声道（`aresample` + `aformat`）；
 * - 拼接：未开启自然过渡时 `concat=n=N:v=1:a=1`（全部无音轨时 `a=0`），各段之间硬切；
 *   开启过渡时（仅 reencode）改为 xfade（视频）+ acrossfade（音频）链式交叉淡化——
 *   第 i 次过渡（新增第 i 段，i 从 1 起）的 xfade offset = Σdur(0..i-1) − i·T，
 *   音频 acrossfade 自动在累积音频末尾 T 秒处与下一段衔接（时间轴与视频链一致）；
 *   输出总时长为各段时长之和 − 时长×(段数−1)。
 *
 * @param specs 各段视频规格（顺序即拼接顺序）
 * @param params 归一化后的拼接参数
 * @returns ffmpeg 参数（额外输入 / filter_complex / 输出选项 / 目标规格）
 * @throws ConcatError 段数为空、自定义尺寸非法（INVALID），或开启过渡时某段时长不足过渡时长（INVALID）
 */
export function buildReencodeArgs(specs: ConcatSegmentSpec[], params: NormalizedConcatParams): ReencodeArgs {
  if (specs.length === 0) {
    throw new ConcatError('没有可用的视频段', 'INVALID');
  }
  const { width, height } = resolveOutputSize(specs, params);
  const fps = resolveOutputFps(specs);
  const withAudio = specs.some((s) => s.hasAudio);
  const transition = params.transition;
  const crossfade = params.crossfadeDuration;

  // 自然过渡前置校验：每段时长必须大于过渡时长，否则 xfade 出现负偏移或整段被过渡吞掉
  // （ffmpeg 报错晦涩，这里提前给出清晰中文提示）
  if (transition) {
    specs.forEach((s, i) => {
      if (!(Number.isFinite(s.duration) && s.duration > crossfade)) {
        const durText = Number.isFinite(s.duration) ? `${s.duration.toFixed(1)} 秒` : '未知';
        throw new ConcatError(
          `第 ${i + 1} 段时长（${durText}）需大于交叉过渡时长（${crossfade} 秒），请缩短过渡时长或另选视频段`,
          'INVALID',
        );
      }
    });
  }

  const filters: string[] = [];
  const extraInputs: string[][] = [];
  /** concat 滤镜的输入标签（按段顺序交错：[v0][a0][v1][a1]...，无音轨时只有 [vN]） */
  const concatInputs: string[] = [];
  specs.forEach((s, i) => {
    filters.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}[v${i}]`,
    );
    concatInputs.push(`[v${i}]`);
    if (withAudio) {
      if (s.hasAudio) {
        filters.push(
          `[${i}:a]aresample=${TARGET_AUDIO_RATE},aformat=channel_layouts=${TARGET_CHANNEL_LAYOUT}[a${i}]`,
        );
      } else {
        // 无音轨段：追加一路 lavfi 静音源（-t 限制为该段时长），补齐音轨结构后参与 concat/acrossfade
        const inputIndex = specs.length + extraInputs.length;
        const dur = Number.isFinite(s.duration) && s.duration > 0 ? s.duration : 0;
        extraInputs.push([
          '-f',
          'lavfi',
          ...(dur > 0 ? ['-t', String(dur)] : []),
          '-i',
          `anullsrc=r=${TARGET_AUDIO_RATE}:cl=${TARGET_CHANNEL_LAYOUT}`,
        ]);
        filters.push(`[${inputIndex}:a]aformat=channel_layouts=${TARGET_CHANNEL_LAYOUT}[a${i}]`);
      }
      concatInputs.push(`[a${i}]`);
    }
  });

  if (!transition) {
    // 无过渡：concat 滤镜以各段归一化输出为输入（标签按段交错串联，无中间段；否则 ffmpeg 报
    // 「No output pad can be associated to link label 'vN'」/「Cannot find a matching stream」）
    filters.push(
      `${concatInputs.join('')}concat=n=${specs.length}:v=1:a=${withAudio ? 1 : 0}[vout]${
        withAudio ? '[aout]' : ''
      }`,
    );
  } else {
    // 视频：xfade 链（transition=fade 淡入淡出）。第 i 次过渡（新增第 i 段）offset =
    // 前 i 段累积时长 − 第 i 个过渡重叠时长；链式累积后输出总时长随之递减
    let prevVideo = '[v0]';
    let accDur = specs[0].duration;
    for (let i = 1; i < specs.length; i++) {
      const offset = accDur - crossfade;
      const outTag = i === specs.length - 1 ? '[vout]' : `[xf${i}]`;
      filters.push(`${prevVideo}[v${i}]xfade=transition=fade:duration=${crossfade}:offset=${offset}${outTag}`);
      prevVideo = outTag;
      accDur = accDur + specs[i].duration - crossfade;
    }
    // 音频：acrossfade 链（自动在累积音频末尾与下一段开头重叠 T 秒，时间轴与 xfade 链一致）
    if (withAudio) {
      let prevAudio = '[a0]';
      for (let i = 1; i < specs.length; i++) {
        const outTag = i === specs.length - 1 ? '[aout]' : `[af${i}]`;
        filters.push(`${prevAudio}[a${i}]acrossfade=d=${crossfade}:c1=tri${outTag}`);
        prevAudio = outTag;
      }
    }
  }

  const outputOptions = ['-map', '[vout]'];
  if (withAudio) outputOptions.push('-map', '[aout]');
  outputOptions.push(
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
  );
  outputOptions.push(...(withAudio ? ['-c:a', 'aac'] : ['-an']));

  return { extraInputs, filterComplex: filters.join(';'), outputOptions, width, height, fps, withAudio };
}

/**
 * 探测单段视频的拼接规格（编码/分辨率/帧率/时长/是否含音轨）。
 *
 * @param project 项目名
 * @param videoPath 视频相对路径（assert/ 下）
 * @returns 视频规格
 * @throws ConcatError 视频不存在（code=NOT_FOUND）或 ffprobe 失败
 */
export async function probeSegmentSpec(project: string, videoPath: string): Promise<ConcatSegmentSpec> {
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
    duration: info.duration,
  };
}

/**
 * 将多段视频按顺序拼接为单个视频。
 *
 * - `mode=copy`（无损）：concat demuxer + `-c copy`，要求各段编码/分辨率/帧率/音轨结构一致，
 *   不一致抛 `ConcatError(INVALID)`（提示改用重编码）；
 * - `mode=reencode`（重编码）：filter_complex 逐段归一化（尺寸/比例黑边/帧率/音轨）后单次编码，
 *   允许各段编码与分辨率完全不同。
 *
 * 前置探测与参数校验在 `buildConcatCommand` 中完成（路由可先构建再交给统一任务执行器异步执行）。
 *
 * @param project 项目名
 * @param videoPaths 视频相对路径数组（assert/ 下，按拼接顺序，至少 2 段）
 * @param outputPath 输出视频相对路径（assert/ 下，.mp4）
 * @param params 拼接参数（编码方式与输出尺寸策略；缺省 reencode + max）
 * @returns 输出视频相对路径
 * @throws ConcatError 输入缺失（NOT_FOUND）、规格不一致/段数不足/尺寸非法（INVALID）或 ffmpeg 执行失败
 */
export async function concatVideos(
  project: string,
  videoPaths: string[],
  outputPath: string,
  params?: ConcatParams,
): Promise<string> {
  const spec = await buildConcatCommand(project, videoPaths, outputPath, params);
  await new Promise<void>((resolve, reject) => {
    spec.build(Ffmpeg())
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new ConcatError(`拼接失败：${err.message}`, 'INVALID')))
      .save(spec.outputAbs);
  });
  return outputPath;
}

/** ffmpeg 命令构建结果（与 `tasks/ffmpeg-executor.ts` 的 FfmpegTaskParams 对齐） */
export type { FfmpegCommandSpec };

/**
 * 构建拼接 ffmpeg 命令（前置探测 + 校验 + 参数装配，不执行）。
 *
 * 路由层用它拿到命令后交给统一任务执行器异步执行（进度/中断由执行器接管）；
 * `concatVideos` 则直接同步执行同一命令（供脚本/测试使用）。
 *
 * @param project 项目名
 * @param videoPaths 视频相对路径数组（至少 2 段）
 * @param outputPath 输出视频相对路径
 * @param params 拼接参数（缺省 reencode + max）
 * @returns 命令构建结果（产物绝对路径 / build / 总时长 / 附加信息）
 * @throws ConcatError 输入缺失（NOT_FOUND）、规格不一致/段数不足/尺寸非法（INVALID）
 */
export async function buildConcatCommand(
  project: string,
  videoPaths: string[],
  outputPath: string,
  params?: ConcatParams,
): Promise<FfmpegCommandSpec> {
  if (videoPaths.length < 2) {
    throw new ConcatError('至少需要两段视频才能拼接', 'INVALID');
  }
  const normalized = normalizeConcatParams(params);
  const outputAbs = resolveProjectPath(project, outputPath);
  await fs.mkdir(path.dirname(outputAbs), { recursive: true });

  // 前置规格探测：copy 用于一致性校验；reencode 用于尺寸/帧率/音轨归一化
  const specs: ConcatSegmentSpec[] = [];
  for (const vp of videoPaths) {
    specs.push(await probeSegmentSpec(project, vp));
  }
  const sumDuration = specs.reduce((sum, s) => sum + (Number.isFinite(s.duration) ? s.duration : 0), 0);

  if (normalized.mode === 'copy') {
    assertConcatCompatible(specs);
    return {
      outputAbs,
      duration: sumDuration > 0 ? sumDuration : undefined,
      info: { mode: 'copy', segments: videoPaths.length },
      build: (cmd) => buildCopyCommand(cmd, project, videoPaths),
    };
  }

  // 自然过渡（仅 reencode）：输出总时长 = 各段时长之和 − 过渡时长×(段数−1)
  const transition = normalized.transition;
  const totalDuration =
    transition && sumDuration > 0 ? sumDuration - normalized.crossfadeDuration * (specs.length - 1) : sumDuration;
  const args = buildReencodeArgs(specs, normalized);
  return {
    outputAbs,
    duration: totalDuration > 0 ? totalDuration : undefined,
    info: {
      mode: 'reencode',
      segments: videoPaths.length,
      sizeMode: normalized.sizeMode,
      width: args.width,
      height: args.height,
      fps: args.fps,
      withAudio: args.withAudio,
      ...(transition ? { transition: true, crossfadeDuration: normalized.crossfadeDuration } : {}),
    },
    build: (cmd) => buildReencodeCommand(cmd, project, videoPaths, args),
  };
}

/**
 * 装配 copy 模式命令（concat demuxer + `-c copy`）。
 *
 * 临时 concat 列表文件在 ffmpeg 启动前写入、结束后删除；中断时由执行器 kill 子进程，
 * 列表文件为临时文件（系统临时目录），不影响产物目录。
 *
 * @param cmd fluent-ffmpeg 命令实例
 * @param project 项目名
 * @param videoPaths 视频相对路径数组
 * @returns 同一命令实例
 * @throws ConcatError 列表文件写入失败
 */
function buildCopyCommand(
  cmd: Ffmpeg.FfmpegCommand,
  project: string,
  videoPaths: string[],
): Ffmpeg.FfmpegCommand {
  const listPath = path.join(os.tmpdir(), `concat-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const listBody =
    videoPaths.map((vp) => `file '${resolveProjectPath(project, vp).replace(/\\/g, '/')}'`).join('\n') + '\n';
  // 列表文件同步写入（build 为同步回调；内容小，写失败即抛错，由路由/执行器收敛为失败任务）
  writeFileSync(listPath, listBody, { encoding: 'utf8' });
  cmd.input(listPath).inputOptions(['-f', 'concat', '-safe', '0']).outputOptions(['-c', 'copy']);
  // 命令结束后清理临时文件（含中断路径：执行器 kill 后也会触发 close）
  cmd.on('end', () => void fs.unlink(listPath).catch(() => undefined));
  cmd.on('error', () => void fs.unlink(listPath).catch(() => undefined));
  return cmd;
}

/**
 * 装配重编码模式命令（filter_complex 逐段归一化 + 单次编码）。
 *
 * @param cmd fluent-ffmpeg 命令实例
 * @param project 项目名
 * @param videoPaths 视频相对路径数组
 * @param args buildReencodeArgs 的结果
 * @returns 同一命令实例
 */
function buildReencodeCommand(
  cmd: Ffmpeg.FfmpegCommand,
  project: string,
  videoPaths: string[],
  args: ReencodeArgs,
): Ffmpeg.FfmpegCommand {
  for (const vp of videoPaths) cmd.input(resolveProjectPath(project, vp));
  // 静音源（lavfi）逐个追加：输入选项紧随其对应的 input 调用，fluent-ffmpeg 会把它附着到该输入
  for (const extra of args.extraInputs) {
    cmd.inputOptions(extra);
    cmd.input(`anullsrc=r=${TARGET_AUDIO_RATE}:cl=${TARGET_CHANNEL_LAYOUT}`);
  }
  return cmd.complexFilter(args.filterComplex).outputOptions(args.outputOptions);
}
