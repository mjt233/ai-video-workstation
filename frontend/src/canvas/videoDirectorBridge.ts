import type { DirectorProject } from '../components/video-director/types'
import type { CanvasDirectorConfig } from './videoTypes'

/**
 * 画布导演台配置（sourceNodeId 引用）↔ VideoDirector 的 DirectorProject（path 引用）双向转换。
 *
 * 画布节点 config.director 以 sourceNodeId 引用连线输入；VideoDirector 组件以
 * 资产路径引用素材。转换在编辑器层完成：渲染前 inputs(sourceNodeId→path) 转成
 * DirectorProject，用户编辑回写时按 path 反查 sourceNodeId。
 */

/**
 * config.director → DirectorProject（供 VideoDirector 渲染）。
 *
 * @param config 画布导演台配置
 * @param inputs sourceNodeId → 资产相对路径
 * @returns DirectorProject（version=1，素材 path 由 inputs 解析，缺失时为空串）
 */
export function canvasDirectorToProject(
  config: CanvasDirectorConfig,
  inputs: Record<string, string>,
): DirectorProject {
  return {
    version: 1,
    duration: config.duration,
    width: config.width,
    height: config.height,
    fps: config.fps,
    imageClips: config.imageClips.map((c) => ({
      id: c.id,
      path: inputs[c.sourceNodeId] ?? '',
      startOffset: c.startOffset,
      duration: c.duration,
    })),
    audioClips: config.audioClips.map((c) => ({
      id: c.id,
      path: inputs[c.sourceNodeId] ?? '',
      startOffset: c.startOffset,
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
      duration: c.duration,
    })),
  }
}

/**
 * DirectorProject → config.director（用户编辑回写）。
 * 按 path 反查 sourceNodeId；path 不在映射中时以 path 兜底（保留数据不丢失）。
 *
 * @param project VideoDirector 编辑后的项目数据
 * @param pathToSource 资产路径 → sourceNodeId
 * @returns 画布导演台配置
 */
export function projectToCanvasDirector(
  project: DirectorProject,
  pathToSource: Record<string, string>,
): CanvasDirectorConfig {
  const resolveSource = (path: string): string => pathToSource[path] ?? path
  return {
    duration: project.duration,
    width: project.width,
    height: project.height,
    fps: project.fps,
    imageClips: project.imageClips.map((c) => ({
      id: c.id,
      sourceNodeId: resolveSource(c.path),
      startOffset: c.startOffset,
      duration: c.duration,
    })),
    audioClips: project.audioClips.map((c) => ({
      id: c.id,
      sourceNodeId: resolveSource(c.path),
      startOffset: c.startOffset,
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
      duration: c.duration,
    })),
  }
}
