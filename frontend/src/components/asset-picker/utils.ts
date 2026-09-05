/**
 * 资产选择器（asset-picker）共享工具函数。
 *
 * 包含缩略图直链生成、路径标签解析、变体树拍平、图片/音频文件递归
 * 列举与扩展名判断等纯函数，供各页签子组件复用。
 */
import { readFs, type DirResponse } from '../../api/client'
import type { VariantInfo } from '../../api/assets'
import type { AssetItem } from './types'

/** 缓存破坏时间戳（保证缩略图 URL 每次刷新） */
export const ts = () => Date.now()

/** 支持的图片扩展名列表（不含点、小写） */
export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'] as const

/** 支持的音频扩展名列表（不含点、小写） */
export const AUDIO_EXTS = ['flac', 'mp3', 'wav', 'm4a', 'ogg', 'opus'] as const

/** 支持的视频扩展名列表（不含点、小写） */
export const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'] as const

/** 媒体分类（与 PropMediaFilter 同义，供扩展名映射使用） */
export type MediaKind = 'image' | 'audio' | 'video'

/**
 * 判断文件名扩展名是否命中可接受扩展名列表（忽略大小写）。
 *
 * @param name 文件名（大小写不敏感）
 * @param acceptExts 可接受扩展名列表（不含点；为空列表时恒返回 false）
 * @returns true 表示扩展名命中可选项
 */
export function hasAcceptExt(name: string, acceptExts: readonly string[]): boolean {
  if (acceptExts.length === 0) return false
  const idx = name.lastIndexOf('.')
  const ext = idx >= 0 && idx < name.length - 1 ? name.slice(idx + 1).toLowerCase() : ''
  return ext !== '' && acceptExts.some((e) => e.toLowerCase() === ext)
}

/**
 * 将媒体分类映射为可接受的扩展名列表（不含点、小写）。
 *
 * @param kind 媒体分类：image / audio / video
 * @returns 该媒体分类的扩展名列表副本
 */
export function acceptExtsForMedia(kind: MediaKind): string[] {
  if (kind === 'audio') return [...AUDIO_EXTS]
  if (kind === 'video') return [...VIDEO_EXTS]
  return [...IMAGE_EXTS]
}

/**
 * 判断文件名是否为支持的图片文件（扩展名忽略大小写）。
 *
 * @param name 文件名
 * @returns true 表示图片文件
 */
export function isImageFile(name: string): boolean {
  return hasAcceptExt(name, IMAGE_EXTS)
}

/**
 * 判断文件名是否为支持的视频文件（扩展名忽略大小写）。
 *
 * @param name 文件名
 * @returns true 表示视频文件
 */
export function isVideoFile(name: string): boolean {
  return hasAcceptExt(name, VIDEO_EXTS)
}

/**
 * 生成资产缩略图直链（带缓存破坏参数）。
 *
 * @param project 项目名
 * @param path 资产相对路径（project 根）
 * @returns 可直接用于 v-img src 的 URL
 */
export function thumbUrl(project: string, path: string): string {
  return `/api/fs/${project}/${path}?t=${ts()}`
}

/**
 * 根据路径生成可读的显示标签，用于初始化 selected 条目的显示。
 *
 * @param path 资产相对路径（project 根）
 * @returns 面向用户的可读标签
 */
export function getPathLabel(path: string): string {
  if (path.startsWith('assert/custom/')) {
    return '自定义/' + path.slice('assert/custom/'.length)
  }
  if (path.startsWith('assert/character/')) {
    const rest = path.slice('assert/character/'.length)
    return rest
      .replace('/appearance.jpg', '/外观')
      .replace('/voice.flac', '/音色')
      // 声音变体：assert/character/{name}/voice-variants/{id}.flac → {name}/音色/{id}
      .replace('/voice-variants/', '/音色/')
      .replace('/variants/', '/')
      .replace(/\.(jpg|flac)$/, '')
  }
  if (path.startsWith('assert/stage/')) {
    const rest = path.slice('assert/stage/'.length)
    return rest.replace('/variants/', '/').replace(/\.jpg$/, '')
  }
  if (path.startsWith('assert/prop/')) {
    // 道具产物：assert/prop/{分类}/{道具}/{文件名} → 道具/分类/道具/文件名
    const rest = path.slice('assert/prop/'.length)
    const parts = rest.split('/')
    if (parts.length >= 3) {
      const [category, propName, file] = parts
      const fileLabel = file === 'image.jpg' ? '图片' : file === 'video.mp4' ? '视频' : file
      return `道具/${category}/${propName}/${fileLabel}`
    }
    return `道具/${rest}`
  }
  if (path.startsWith('assert/scene/')) {
    const m = path.match(/\/stage\/(\d+)\.jpg$/)
    if (m) return `分镜场景图 ${Number(m[1]) + 1}`
    const vi = path.match(/^assert\/scene\/(\d+)\/(\d+)\/video\/(.+)\.mp4$/)
    if (vi) return `分镜视频（第${vi[1]}集 分镜${vi[2]}）#${vi[3]}`
    const vm = path.match(/^assert\/scene\/(\d+)\/(\d+)\/video\.mp4$/)
    if (vm) return `分镜视频（第${vm[1]}集 分镜${vm[2]}）`
    return path.split('/').pop() ?? path
  }
  return path.split('/').pop() ?? path
}

/**
 * 递归将 VariantInfo 列表拍平为带缩进层级的树形 AssetItem 数组。
 *
 * @param variants 变体列表
 * @param project 项目名
 * @param exclude 需要排除的资产路径（不展示为可选）
 * @param parentId 父变体 id（根层级传 undefined）
 * @param startDepth 起始缩进层级
 * @returns 按 parentId 递归嵌套的树形条目数组
 */
export function flattenVariantTree(
  variants: VariantInfo[],
  project: string,
  exclude: string[],
  parentId?: string,
  startDepth: number = 1,
): AssetItem[] {
  const items: AssetItem[] = []
  const children = variants.filter(
    (v) => (v.parentId ?? undefined) === (parentId ?? undefined) && !exclude.includes(v.imagePath),
  )
  for (const v of children) {
    items.push({
      path: v.imagePath,
      label: v.id,
      thumbnail: thumbUrl(project, v.imagePath),
      depth: startDepth,
    })
    items.push(...flattenVariantTree(variants, project, exclude, v.id, startDepth + 1))
  }
  return items
}

/**
 * 递归列出目录下的所有图片文件路径。
 * 服务端目前不支持 recursive 参数，故客户端递归实现。
 *
 * @param project 项目名
 * @param dirRelPath 目录相对路径（project 根）
 * @returns 目录下所有图片文件的相对路径列表（目录不存在时返回空数组）
 */
export async function listImageFilesRecursive(project: string, dirRelPath: string): Promise<string[]> {
  const results: string[] = []

  async function walk(relPath: string) {
    const res = await readFs(project, relPath) as DirResponse
    const entries = res.entries ?? []
    for (const entry of entries) {
      const childRel = relPath.endsWith('/') ? `${relPath}${entry.name}` : `${relPath}/${entry.name}`
      if (entry.type === 'dir') {
        await walk(childRel)
      } else if (isImageFile(entry.name)) {
        results.push(childRel)
      }
    }
  }

  try {
    await walk(dirRelPath)
  } catch {
    // 目录不存在时静默处理
  }
  return results
}

/**
 * 递归列出目录下的所有音频文件路径。
 * 服务端目前不支持 recursive 参数，故客户端递归实现。
 *
 * @param project 项目名
 * @param dirRelPath 目录相对路径（project 根）
 * @returns 目录下所有音频文件的相对路径列表（目录不存在时返回空数组）
 */
export async function listAudioFilesRecursive(project: string, dirRelPath: string): Promise<string[]> {
  const results: string[] = []

  async function walk(relPath: string) {
    const res = await readFs(project, relPath) as DirResponse
    const entries = res.entries ?? []
    for (const entry of entries) {
      const childRel = relPath.endsWith('/') ? `${relPath}${entry.name}` : `${relPath}/${entry.name}`
      if (entry.type === 'dir') {
        await walk(childRel)
      } else if (isAudioFile(entry.name)) {
        results.push(childRel)
      }
    }
  }

  try {
    await walk(dirRelPath)
  } catch {
    // 目录不存在时静默处理
  }
  return results
}

/**
 * 递归列出目录下的所有视频文件路径。
 * 服务端目前不支持 recursive 参数，故客户端递归实现。
 *
 * @param project 项目名
 * @param dirRelPath 目录相对路径（project 根）
 * @returns 目录下所有视频文件的相对路径列表（目录不存在时返回空数组）
 */
export async function listVideoFilesRecursive(project: string, dirRelPath: string): Promise<string[]> {
  const results: string[] = []

  async function walk(relPath: string) {
    const res = await readFs(project, relPath) as DirResponse
    const entries = res.entries ?? []
    for (const entry of entries) {
      const childRel = relPath.endsWith('/') ? `${relPath}${entry.name}` : `${relPath}/${entry.name}`
      if (entry.type === 'dir') {
        await walk(childRel)
      } else if (isVideoFile(entry.name)) {
        results.push(childRel)
      }
    }
  }

  try {
    await walk(dirRelPath)
  } catch {
    // 目录不存在时静默处理
  }
  return results
}

/**
 * 判断文件名是否为支持的音频文件（扩展名忽略大小写）。
 *
 * @param name 文件名
 * @returns true 表示音频文件
 */
export function isAudioFile(name: string): boolean {
  return hasAcceptExt(name, AUDIO_EXTS)
}
