/**
 * 剪贴板媒体识别纯函数：把系统剪贴板中的图片/视频/音频文件归类为对应加载节点原型。
 * 与 DOM 事件解耦（仅依赖 File/DataTransfer 类型），便于单元测试。
 */

/** 粘贴媒体文件对应的加载节点原型（加载图片/加载视频/加载音频） */
export type PastedMediaPrototype = 'image-loader' | 'video-loader' | 'audio-loader'

/** 剪贴板中的媒体文件项：文件对象 + 对应节点原型 */
export interface PastedMedia {
  /** 剪贴板文件（图片/视频/音频） */
  file: File
  /** 对应创建的加载节点原型 id */
  prototypeId: PastedMediaPrototype
}

/** 粘贴上传结果：成功携带产物路径与原型，失败携带文件名 */
export type PastedUploadResult =
  | { ok: true; path: string; prototypeId: PastedMediaPrototype }
  | { ok: false; name: string }

/** 常见图片扩展名（剪贴板文件 MIME 为空时按文件名兜底识别） */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'])
/** 常见视频扩展名 */
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'])
/** 常见音频扩展名 */
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'])

/**
 * 识别剪贴板文件对应的加载节点原型：优先 MIME 类型，MIME 为空时按扩展名兜底。
 *
 * @param file 剪贴板文件
 * @returns 加载节点原型 id；无法识别返回 undefined
 */
export function classifyPastedFile(file: File): PastedMediaPrototype | undefined {
  const type = file.type.toLowerCase()
  if (type.startsWith('image/')) return 'image-loader'
  if (type.startsWith('video/')) return 'video-loader'
  if (type.startsWith('audio/')) return 'audio-loader'
  const ext = (file.name.toLowerCase().split('.').pop() ?? '').trim()
  if (IMAGE_EXTS.has(ext)) return 'image-loader'
  if (VIDEO_EXTS.has(ext)) return 'video-loader'
  if (AUDIO_EXTS.has(ext)) return 'audio-loader'
  return undefined
}

/**
 * 从剪贴板数据收集可识别的媒体文件（不支持的记录文件名供提示）。
 *
 * @param data 剪贴板数据（可为 null）
 * @returns 媒体文件列表与不支持的文件名列表
 */
export function collectPastedMedia(data: DataTransfer | null): { media: PastedMedia[]; unsupported: string[] } {
  const media: PastedMedia[] = []
  const unsupported: string[] = []
  if (!data?.items) return { media, unsupported }
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (!file) continue
    const prototypeId = classifyPastedFile(file)
    if (prototypeId) media.push({ file, prototypeId })
    else unsupported.push(file.name)
  }
  return { media, unsupported }
}

/**
 * 计算加载节点上传的目标路径（自定义资产目录 assert/custom/canvas/）。
 * 时间戳 + 原文件名（与粘贴命名规则一致，仅不带批次序号）。
 *
 * @param file 上传文件
 * @param now 当前时间戳（可注入，测试用；默认 Date.now()）
 * @returns 项目内相对路径
 */
export function buildLoaderUploadDest(file: File, now: number = Date.now()): string {
  return `assert/custom/canvas/${now}-${file.name}`
}

/**
 * 计算粘贴上传的目标路径（自定义资产目录 assert/custom/canvas/）。
 * 时间戳 + 序号 + 原文件名保证并发粘贴多个文件不冲突。
 *
 * @param file 剪贴板文件
 * @param index 批次内序号（错位命名用）
 * @param now 当前时间戳（可注入，测试用；默认 Date.now()）
 * @returns 项目内相对路径
 */
export function buildClipboardAssetDest(file: File, index: number, now: number = Date.now()): string {
  return `assert/custom/canvas/${now}-${index}-${file.name}`
}
