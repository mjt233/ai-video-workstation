import fs from 'fs/promises';
import path from 'path';
import Ffmpeg from 'fluent-ffmpeg';

/**
 * 混音单段音频的裁剪/定位参数。
 *
 * 用于描述一段音频在最终混音结果中的出现方式：先从原文件裁剪出
 * 有效片段（trimStart/trimEnd），再按 startOffset 在混音时间轴上
 * 定位（开头插入静音）。
 */
export interface AudioMixInput {
  /** 该段在混音结果时间轴上的起始偏移（秒）。0 表示从 0 开始。 */
  startOffset: number
  /** 从音频开头裁剪掉的时长（秒），即有效片段起始点。0 表示不裁剪开头。 */
  trimStart: number
  /** 从音频末尾裁剪掉的时长（秒）。0 表示不裁剪末尾。 */
  trimEnd: number
  /** 音频原始总时长（秒），用于计算裁剪终点 = duration - trimEnd。 */
  duration: number
}

/**
 * 生成 ffmpeg filter_complex 混音命令字符串。
 *
 * 对每段输入按顺序应用过滤器：
 * 1. atrim：裁剪起止（trimStart 为 start，duration - trimEnd 为 end）
 * 2. asetpts=PTS-STARTPTS：裁剪后时间戳归零，避免静音定位错乱
 * 3. adelay=ms|ms：按 startOffset 在开头添加静音（毫秒，双声道）
 * 最后用 amix 混合所有轨道，必须使用 `duration=longest`，
 * 保证 startOffset 靠后的轨道不会被截断。
 *
 * 单段且无任何裁剪/偏移时，直接使用原输入 `[0:a]` 进入 amix，不做多余处理。
 *
 * @param inputs 各段音频的裁剪/定位参数（顺序对应 ffmpeg 输入序号）
 * @returns 可直接传给 ffmpeg -filter_complex 的完整命令字符串
 */
export function buildMixFilter(inputs: AudioMixInput[]): string {
  const filterParts: string[] = [];
  const mixInputLabels: string[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const inLabel = `[${i}:a]`;
    const outLabel = `[p${i}]`;
    const filters: string[] = [];

    // atrim：裁剪起止；trimStart/trimEnd 任一非 0 时才需要裁剪
    if (input.trimStart > 0 || input.trimEnd > 0) {
      const actualEnd = input.duration - input.trimEnd;
      const parts: string[] = [];
      if (input.trimStart > 0) parts.push(`start=${input.trimStart}`);
      if (input.trimEnd > 0) parts.push(`end=${actualEnd}`);
      if (parts.length) {
        filters.push(`atrim=${parts.join(':')}`);
        filters.push('asetpts=PTS-STARTPTS');
      }
    }

    // adelay：按 startOffset 在开头添加静音（毫秒，双声道）
    if (input.startOffset > 0) {
      const delayMs = Math.round(input.startOffset * 1000);
      filters.push(`adelay=${delayMs}|${delayMs}`);
    }

    if (filters.length > 0) {
      filterParts.push(`${inLabel}${filters.join(',')}${outLabel}`);
      mixInputLabels.push(outLabel);
    } else {
      mixInputLabels.push(inLabel);
    }
  }

  // amix：混合所有轨道；duration=longest 保证靠后轨道不被截断
  filterParts.push(
    `${mixInputLabels.join('')}amix=inputs=${mixInputLabels.length}:duration=longest:dropout_transition=0[mix]`,
  );

  return filterParts.join(';');
}

/**
 * 获取音频文件时长（秒）。
 *
 * 通过 ffprobe 读取媒体信息并返回 format.duration；文件不可读、
 * 无时长信息时抛出异常，由调用方决定如何处理。
 *
 * @param filePath 音频文件绝对路径
 * @returns 音频时长（秒）
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    Ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data.format.duration ?? 0);
    });
  });
}

/**
 * 混音输入轨道。
 *
 * 描述一个待混音的音频文件及其在混音结果中的裁剪/定位方式；
 * 文件系统路径版（区别于 {@link AudioMixInput} 的纯参数版，
 * 后者供 buildMixFilter 使用）。
 */
export interface MixTrack {
  /** 音频文件绝对路径（作为 ffmpeg 输入） */
  filePath: string
  /** 该段在混音结果时间轴上的起始偏移（秒） */
  startOffset: number
  /** 从音频开头裁剪掉的时长（秒） */
  trimStart: number
  /** 从音频末尾裁剪掉的时长（秒） */
  trimEnd: number
  /** 音频原始总时长（秒）；缺省时由 mixAudioTracks 自动 ffprobe 获取 */
  duration?: number
}

/** 输出扩展名 → 音频编码器映射，用于按输出文件扩展名推断编码格式 */
const EXT_TO_CODEC: Record<string, string> = {
  flac: 'flac',
  mp3: 'libmp3lame',
  wav: 'pcm_s16le',
  m4a: 'aac',
  ogg: 'libvorbis',
  opus: 'libopus',
};

/**
 * 将多条音频轨道按裁剪/定位参数混音为单个音频文件。
 *
 * 步骤：
 * 1. 逐轨道处理：duration 缺省时用 ffprobe 探测时长，探测失败
 *    或文件不可用的轨道直接跳过（静默）
 * 2. 若没有任何可用轨道，抛出 Error
 * 3. 用 buildMixFilter 生成 filter_complex 命令
 * 4. 多输入 + complexFilter 执行 ffmpeg，按输出文件扩展名推断
 *    编码格式（本计划输出 .flac）写入 outputPath
 *
 * @param tracks 待混音的轨道列表
 * @param outputPath 混音结果输出文件路径（扩展名决定编码格式）
 * @throws 当所有轨道都不可用时抛出 Error
 */
export async function mixAudioTracks(
  tracks: MixTrack[],
  outputPath: string,
): Promise<void> {
  // 1) 逐轨道获取时长（缺省时 ffprobe 探测），跳过不可用文件
  const usable: (MixTrack & { duration: number })[] = [];
  for (const t of tracks) {
    let duration = t.duration;
    if (!duration) {
      try {
        duration = await getAudioDuration(t.filePath);
      } catch {
        continue;
      }
    }
    if (!duration) continue;
    usable.push({ ...t, duration });
  }

  if (!usable.length) {
    throw new Error('没有可用的音频轨道');
  }

  // 2) 构建 filter_complex 命令
  const filter = buildMixFilter(
    usable.map((t) => ({
      startOffset: t.startOffset,
      trimStart: t.trimStart,
      trimEnd: t.trimEnd,
      duration: t.duration,
    })),
  );

  // 3) 确保输出目录存在
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // 4) 按扩展名推断音频编码器
  const ext = path.extname(outputPath).slice(1).toLowerCase();
  const codec = EXT_TO_CODEC[ext];

  // 5) 执行 ffmpeg 混音
  await new Promise<void>((resolve, reject) => {
    const command = Ffmpeg();

    for (const t of usable) {
      command.input(t.filePath);
    }

    command
      .complexFilter(filter)
      .audioChannels(1)
      .audioFrequency(44100)
      .noVideo()
      .outputOptions(['-map', '[mix]']);
    if (codec) command.audioCodec(codec);
    command
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}
