import type { DirectorProject } from '../components/video-director/types'
import type { CanvasDirectorClips } from './videoTypes'
import type { VideoSpec } from './videoSpec'

/**
 * 画布导演台素材（sourceNodeId 引用）↔ VideoDirector 的 DirectorProject（path 引用）双向转换。
 *
 * 画布节点 config.director 以 sourceNodeId 引用连线输入；VideoDirector 组件以
 * 资产路径引用素材。转换在编辑器层完成：渲染前 inputs(sourceNodeId→path) 转成
 * DirectorProject，用户编辑回写时按 path 反查 sourceNodeId。
 *
 * 输出规格（时长/宽高/帧率）不属于本模块：由 `videoSpec.readVideoSpec` 统一读取后
 * 以参数传入（渲染方向），回写方向只产出素材块——避免时间轴上的任意一次拖动
 * 把陈旧的规格值写回节点配置。
 */

/**
 * config.director 素材 + 输出规格 → DirectorProject（供 VideoDirector 渲染）。
 *
 * @param clips 画布导演台素材（imageClips/audioClips，sourceNodeId 引用）
 * @param inputs sourceNodeId → 资产相对路径
 * @param spec 输出规格（时长/宽高/帧率；由 readVideoSpec 读取）
 * @returns DirectorProject（version=1，素材 path 由 inputs 解析，缺失时为空串）
 */
export function canvasDirectorToProject(
  clips: CanvasDirectorClips,
  inputs: Record<string, string>,
  spec: VideoSpec,
): DirectorProject {
  return {
    version: 1,
    duration: spec.duration,
    width: spec.width,
    height: spec.height,
    fps: spec.fps,
    imageClips: clips.imageClips.map((c) => ({
      id: c.id,
      path: inputs[c.sourceNodeId] ?? '',
      startOffset: c.startOffset,
      duration: c.duration,
    })),
    audioClips: clips.audioClips.map((c) => ({
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
 * DirectorProject → config.director 素材（用户编辑回写）。
 * 按 path 反查 sourceNodeId；path 不在映射中时以 path 兜底（保留数据不丢失）。
 *
 * 只返回素材块：输出规格不在此回写（时间轴编辑不产生规格变更，
 * 规格变更只来自参数行的时长/尺寸控件）。
 *
 * @param project VideoDirector 编辑后的项目数据
 * @param pathToSource 资产路径 → sourceNodeId
 * @returns 画布导演台素材（imageClips/audioClips）
 */
export function projectToCanvasDirector(
  project: DirectorProject,
  pathToSource: Record<string, string>,
): CanvasDirectorClips {
  const resolveSource = (path: string): string => pathToSource[path] ?? path
  return {
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
