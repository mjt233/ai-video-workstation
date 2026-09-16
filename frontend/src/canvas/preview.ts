/**
 * 画布资产预览 URL 工具。
 * 沿用全项目约定：/api/fs/{project}/{relPath}?t=... 防缓存。
 */

/**
 * 构建资产预览 URL。
 *
 * @param project 项目名
 * @param relPath 项目内相对路径（assert/ 下）
 * @param version 可选版本号；提供时作为缓存键（版本变化即刷新缓存）
 * @returns 预览 URL
 */
export function buildPreviewUrl(project: string, relPath: string, version?: number): string {
  const base = `/api/fs/${project}/${relPath}`
  if (version != null) {
    return `${base}?t=v${version}`
  }
  return `${base}?t=${Date.now()}`
}

/** 媒体类型（按产物扩展名判定；无法识别时为 `none`） */
export type MediaKind = 'image' | 'video' | 'audio' | 'none'

/** 各媒体类型的产物扩展名（小写、无点号） */
const MEDIA_EXTENSIONS: Record<Exclude<MediaKind, 'none'>, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'm4v'],
  audio: ['flac', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus'],
}

/**
 * 按产物路径扩展名判定媒体类型（完成通知气泡与任务管理器历史行共用）。
 *
 * 以**路径扩展名**为唯一判据：气泡/历史行只拿到产物相对路径，不需要也不应该
 * 再回溯节点配置（生成类节点产物固定 `output.{ext}`，扩展名即媒体类型）。
 *
 * @param path 产物相对路径（可为空：失败任务无产物）
 * @returns 媒体类型；为空或扩展名无法识别时返回 `none`
 */
export function mediaKindOfPath(path?: string | null): MediaKind {
  if (!path) return 'none'
  const ext = path.replace(/\\/g, '/').split('?')[0].split('.').pop()?.toLowerCase() ?? ''
  if (!ext) return 'none'
  const kinds = Object.keys(MEDIA_EXTENSIONS) as Array<Exclude<MediaKind, 'none'>>
  return kinds.find((kind) => MEDIA_EXTENSIONS[kind].includes(ext)) ?? 'none'
}
