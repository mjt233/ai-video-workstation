/**
 * 导演台配置前端 API。
 *
 * 封装 `prompt/scene/{episode}/{shot}/director.json` 的读取与写入，
 * 以及空白导演台项目的构造。
 *
 * 约定：director.json 中不保存前端编辑专用的 `id` 字段（服务端类型无 id），
 * 读取时为每个素材块生成新 id，写入时剥离 id。
 */

import { readFs, writeFs } from './client'
import {
  DIRECTOR_VERSION,
  type DirectorProject,
} from '../components/video-director/types'

/**
 * 读取分镜的导演台配置。
 *
 * @param project 项目名
 * @param episode 集数
 * @param shot 分镜编号
 * @returns 导演台项目；文件不存在或解析失败时返回 null
 */
export async function readDirectorConfig(
  project: string,
  episode: string,
  shot: string,
): Promise<DirectorProject | null> {
  const rel = `prompt/scene/${episode}/${shot}/director.json`
  let raw: unknown
  try {
    raw = await readFs(project, rel)
  } catch {
    return null
  }

  // 兼容 string 与对象两种形态（axios 会自动对 .json 响应做 JSON.parse）
  let obj: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return null
    try {
      obj = JSON.parse(text)
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null

  const d = obj as Record<string, unknown>
  if (!Array.isArray(d.imageClips) || !Array.isArray(d.audioClips)) return null

  return {
    version: Number(d.version) || DIRECTOR_VERSION,
    duration: Number(d.duration) || 0,
    width: Number(d.width) || 0,
    height: Number(d.height) || 0,
    fps: Number(d.fps) || 0,
    // 服务端不存 id，读取时生成新的前端 id
    imageClips: d.imageClips.map((c) => {
      const clip = (c ?? {}) as Record<string, unknown>
      return {
        id: crypto.randomUUID(),
        path: String(clip.path ?? ''),
        startOffset: Number(clip.startOffset) || 0,
        duration: Number(clip.duration) || 0,
      }
    }),
    audioClips: d.audioClips.map((c) => {
      const clip = (c ?? {}) as Record<string, unknown>
      return {
        id: crypto.randomUUID(),
        path: String(clip.path ?? ''),
        startOffset: Number(clip.startOffset) || 0,
        duration: Number(clip.duration) || 0,
        trimStart: Number(clip.trimStart) || 0,
        trimEnd: Number(clip.trimEnd) || 0,
      }
    }),
  }
}

/**
 * 写入分镜的导演台配置。
 *
 * 序列化时剥离前端专用的 `id` 字段（director.json 不保存 id）。
 *
 * @param project 项目名
 * @param episode 集数
 * @param shot 分镜编号
 * @param p 导演台项目
 */
export async function writeDirectorConfig(
  project: string,
  episode: string,
  shot: string,
  p: DirectorProject,
): Promise<void> {
  const rel = `prompt/scene/${episode}/${shot}/director.json`
  const body = {
    version: p.version,
    duration: p.duration,
    width: p.width,
    height: p.height,
    fps: p.fps,
    imageClips: p.imageClips.map((c) => ({
      path: c.path,
      startOffset: c.startOffset,
      duration: c.duration,
    })),
    audioClips: p.audioClips.map((c) => ({
      path: c.path,
      startOffset: c.startOffset,
      duration: c.duration,
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
    })),
  }
  await writeFs(project, rel, JSON.stringify(body, null, 2))
}

/**
 * 构造空白导演台项目。
 *
 * @param duration 视频总时长（秒）
 * @param width 视频宽度（像素）
 * @param height 视频高度（像素）
 * @param fps 帧率
 * @returns 空白导演台项目
 */
export function emptyDirectorProject(
  duration: number,
  width: number,
  height: number,
  fps: number,
): DirectorProject {
  return {
    version: DIRECTOR_VERSION,
    duration,
    width,
    height,
    fps,
    imageClips: [],
    audioClips: [],
  }
}
