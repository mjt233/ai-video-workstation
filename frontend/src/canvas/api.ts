import { readFs, writeFs } from '../api/client'
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
  const rel = canvasRelPath(target)
  try {
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
