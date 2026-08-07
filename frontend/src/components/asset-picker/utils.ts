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

/** 支持的图片扩展名集合 */
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

/** 支持的音频扩展名集合 */
const AUDIO_EXTS = new Set(['flac', 'mp3', 'wav', 'm4a', 'ogg', 'opus'])

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
  if (path.startsWith('assert/scene/')) {
    const m = path.match(/\/stage\/(\d+)\.jpg$/)
    if (m) return `分镜场景图 ${Number(m[1]) + 1}`
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
      } else {
        const ext = entry.name.toLowerCase().split('.').pop()
        if (ext && IMAGE_EXTS.has(`.${ext}`)) {
          results.push(childRel)
        }
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
 * 判断文件名是否为支持的音频文件。
 *
 * @param name 文件名
 * @returns true 表示音频文件
 */
export function isAudioFile(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop()
  return !!ext && AUDIO_EXTS.has(ext)
}
