/**
 * 裁剪音频节点输出格式工具：config 数据模型约定与产物扩展名解析。
 *
 * config 相关字段（均为可选，兼容旧数据）：
 * - `format`：输出格式。显式格式为 'wav' | 'flac' | 'mp3'；「原格式」使用哨兵值
 *   `'---'`（AUDIO_TRIM_FORMAT_ORIG），表示输出扩展名跟随输入音频；字段缺省视同 '---'；
 * - `mp3Bitrate`：输出为 mp3 编码时的码率（kbps），白名单 128 / 192 / 320，缺省 192；
 * - `outputExt`：**镜像字段**（静默维护、不入撤销栈）。记录最近一次成功裁剪的真实输出
 *   扩展名，供「原格式 + 无输入链路上下文」的固定产物路径推导兜底（画布加载刷新
 *   node-info、保存为/自定义资产对话框、下游输入收集等拿不到输入路径的调用点）。
 *
 * 产物固定文件名 `output.{ext}`，ext 取值见 AUDIO_TRIM_OUTPUT_EXTS。
 * 扩展名白名单/编码映射须与服务端 `assets/trim-audio.ts` 保持一致（两端同步修改）。
 */

import type { NodeConfig } from './types'

/** 「原格式」在 config.format 中的哨兵值（输出扩展名跟随输入音频）。 */
export const AUDIO_TRIM_FORMAT_ORIG = '---'

/** 裁剪音频节点可选输出格式：三个显式格式 + 「原格式」哨兵。 */
export type AudioTrimFormat = typeof AUDIO_TRIM_FORMAT_ORIG | 'wav' | 'flac' | 'mp3'

/** 输出格式下拉选项（value 持久化到 config.format，label 为界面展示文案）。 */
export const AUDIO_TRIM_FORMAT_OPTIONS: ReadonlyArray<{ value: AudioTrimFormat; label: string }> = [
  { value: AUDIO_TRIM_FORMAT_ORIG, label: '原格式' },
  { value: 'wav', label: 'wav' },
  { value: 'flac', label: 'flac' },
  { value: 'mp3', label: 'mp3' },
]

/** MP3 码率选项（kbps，升序）。 */
export const AUDIO_TRIM_MP3_BITRATES = [128, 192, 320] as const

/** MP3 码率类型（kbps）。 */
export type AudioTrimMp3Bitrate = (typeof AUDIO_TRIM_MP3_BITRATES)[number]

/** MP3 缺省码率（kbps）。 */
export const AUDIO_TRIM_MP3_BITRATE_DEFAULT: AudioTrimMp3Bitrate = 192

/**
 * 服务端允许写入的输出扩展名白名单（output.{ext}）：
 * flac / wav / mp3 为下拉显式格式；ogg / m4a / aac 仅「原格式」跟随输入时可能出现
 * （加载音频节点可上传这些格式）。须与服务端 assets/trim-audio.ts 扩展名→编码表一致。
 */
export const AUDIO_TRIM_OUTPUT_EXTS = ['flac', 'wav', 'mp3', 'ogg', 'm4a', 'aac'] as const

/** 裁剪音频节点产物扩展名（output.{ext} 中的 ext）。 */
export type AudioTrimOutputExt = (typeof AUDIO_TRIM_OUTPUT_EXTS)[number]

/** 供白名单判定的运行时可变数组（includes 使用）。 */
const AUDIO_TRIM_OUTPUT_EXT_LIST: readonly string[] = AUDIO_TRIM_OUTPUT_EXTS

/**
 * 判断值是否为合法的输出格式（config.format 净化用）。
 *
 * @param v 待判断值（config 存储的任意值）
 * @returns 是否为合法输出格式
 */
function isAudioTrimFormatValue(v: unknown): v is AudioTrimFormat {
  return v === AUDIO_TRIM_FORMAT_ORIG || v === 'wav' || v === 'flac' || v === 'mp3'
}

/**
 * 读取节点输出格式并净化（缺省/非法一律视为「原格式」）。
 *
 * @param config 节点 config（可选）
 * @returns 输出格式
 */
export function audioTrimFormatOf(config?: NodeConfig | null): AudioTrimFormat {
  const v = config?.format
  return isAudioTrimFormatValue(v) ? v : AUDIO_TRIM_FORMAT_ORIG
}

/**
 * 读取 MP3 码率并净化（缺省/非法回退 192）。
 *
 * @param config 节点 config（可选）
 * @returns 码率（kbps）
 */
export function audioTrimBitrateOf(config?: NodeConfig | null): AudioTrimMp3Bitrate {
  const v = config?.mp3Bitrate
  return AUDIO_TRIM_MP3_BITRATES.includes(v as AudioTrimMp3Bitrate)
    ? (v as AudioTrimMp3Bitrate)
    : AUDIO_TRIM_MP3_BITRATE_DEFAULT
}

/**
 * 取路径扩展名（小写）；不在白名单内或无法解析时返回 null。
 *
 * @param relPath 资产相对路径
 * @returns 扩展名或 null
 */
export function extOfAudioPath(relPath?: string | null): AudioTrimOutputExt | null {
  if (!relPath) return null
  const name = relPath.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return null
  const ext = name.slice(dot + 1).toLowerCase()
  return AUDIO_TRIM_OUTPUT_EXT_LIST.includes(ext) ? (ext as AudioTrimOutputExt) : null
}

/**
 * 判断值是否为允许的输出扩展名（config.outputExt 镜像合法性/服务端回传路径校验）。
 *
 * @param v 待判断值
 * @returns 是否为合法输出扩展名
 */
export function isAudioTrimOutputExt(v: unknown): v is AudioTrimOutputExt {
  return typeof v === 'string' && AUDIO_TRIM_OUTPUT_EXT_LIST.includes(v.toLowerCase())
}

/**
 * 本次裁剪实际是否输出 mp3 编码（编辑器据此决定「MP3 码率」下拉显隐）：
 * 显式格式为 mp3，或「原格式」且输入音频扩展名为 mp3 时输出均为 mp3。
 *
 * @param config 节点 config（可选）
 * @param inputPath 输入音频路径（可选，「原格式」判断需要）
 * @returns 是否输出 mp3
 */
export function audioTrimTargetsMp3(config?: NodeConfig | null, inputPath?: string | null): boolean {
  const format = audioTrimFormatOf(config)
  if (format === 'mp3') return true
  return format === AUDIO_TRIM_FORMAT_ORIG && extOfAudioPath(inputPath) === 'mp3'
}

/**
 * 解析裁剪音频节点的产物扩展名（output.{ext} 的 ext）。
 *
 * 优先级：
 * 1. 显式格式（wav / flac / mp3）→ 该格式；
 * 2. 「原格式」且提供输入路径 → 输入音频的扩展名（在白名单内）；
 * 3. 「原格式」无输入路径 → config.outputExt 镜像（最近一次成功裁剪的真实扩展名）；
 * 4. 以上均不可得 → 兜底 flac（仅影响尚无产物的节点，裁剪时必带输入路径不会命中）。
 *
 * @param config 节点 config（可选）
 * @param inputPath 输入音频路径（可选；裁剪等有输入上下文的调用点应传入）
 * @returns 输出扩展名
 */
export function audioTrimOutputExt(config?: NodeConfig | null, inputPath?: string | null): AudioTrimOutputExt {
  const format = audioTrimFormatOf(config)
  if (format !== AUDIO_TRIM_FORMAT_ORIG) return format
  if (inputPath) {
    const ext = extOfAudioPath(inputPath)
    if (ext) return ext
  }
  const mirror = config?.outputExt
  if (isAudioTrimOutputExt(mirror)) return mirror
  return 'flac'
}
