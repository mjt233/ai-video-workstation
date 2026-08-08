import client, { readFs, writeFs } from '../api/client'
import { migrateCanvasData, type CanvasData, type CanvasKind } from './types'
import { sceneCanvasRelPath, stageCanvasRelPath } from './paths'

/** 画布目标：定位某张画布 */
export interface CanvasTarget {
  kind: CanvasKind
  /** stage 画布时的场景名 */
  stage?: string
  /** stage 画布时的子场景标签 */
  label?: string
  /** scene 画布时的集数 */
  episode?: string
  /** scene 画布时的分镜号 */
  shot?: string
}

/**
 * 计算画布定义文件的相对路径。
 *
 * @param target 画布目标
 * @returns 项目内相对路径
 * @throws Error 目标参数不完整时
 */
export function canvasRelPath(target: CanvasTarget): string {
  if (target.kind === 'stage') {
    if (!target.stage) throw new Error('场景画布需要 stage')
    if (!target.label) throw new Error('场景画布需要 label')
    return stageCanvasRelPath(target.stage, target.label)
  }
  if (!target.episode || !target.shot) throw new Error('分镜画布需要 episode 与 shot')
  return sceneCanvasRelPath(target.episode, target.shot)
}

/**
 * 加载画布定义；文件不存在或解析失败时返回 null。
 *
 * @param project 项目名
 * @param target 画布目标
 * @returns 画布定义或 null
 */
export async function loadCanvas(project: string, target: CanvasTarget): Promise<CanvasData | null> {
  try {
    const rel = canvasRelPath(target)
    const raw = await readFs(project, rel)
    if (raw == null) return null
    // axios 会尝试对字符串响应做 JSON.parse，因此 .json 文件可能直接返回对象；
    // 同时兼容仍为字符串的情况（如空文件或代理差异）
    if (typeof raw === 'string') {
      if (raw.trim() === '') return null
      return migrateCanvasData(JSON.parse(raw) as unknown)
    }
    return migrateCanvasData(raw)
  } catch {
    return null
  }
}

/**
 * 保存画布定义（写入 canvas.json）。
 *
 * @param project 项目名
 * @param target 画布目标
 * @param data 画布定义
 */
export async function saveCanvas(project: string, target: CanvasTarget, data: CanvasData): Promise<void> {
  const rel = canvasRelPath(target)
  await writeFs(project, rel, JSON.stringify(data, null, 2))
}

/**
 * 提取视频帧：调用服务端 ffmpeg 接口，把输入视频的指定帧输出为图片（png）。
 *
 * 帧索引语义：0=首帧、1=第二帧、-1=尾帧、-2=倒数第二帧，以此类推（越界服务端返回错误）。
 *
 * @param project 项目名
 * @param videoPath 输入视频相对路径（assert/ 下）
 * @param frameIndex 帧索引（整数，可负）
 * @param outputPath 输出图片相对路径（assert/ 下，.png）
 * @returns 服务端执行结果（含输出相对路径）
 */
export async function extractVideoFrame(
  project: string,
  videoPath: string,
  frameIndex: number,
  outputPath: string,
): Promise<{ success: boolean; path: string }> {
  const { data } = await client.post<{ success: boolean; path: string }>('/canvas/extract-frame', {
    project,
    videoPath,
    frameIndex,
    outputPath,
  })
  return data
}
