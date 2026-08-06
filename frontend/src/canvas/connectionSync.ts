import type { CanvasConnection, CanvasData } from './types'
import { newId } from './types'
import { getNodeOutputType } from './connection'
import type { CanvasDirectorConfig, CanvasDirectorImageClip, CanvasDirectorAudioClip } from './videoTypes'

/** 自动追加图片块时的默认占位时长（秒） */
export const DEFAULT_IMAGE_CLIP_DURATION = 2

/** 连线变化事件 */
export interface ConnectionSyncEvent {
  type: 'connect' | 'disconnect'
  connection: CanvasConnection
}

/**
 * 画布节点级连接联动：连线建立/断开时按目标节点原型同步节点数据。
 *
 * 当前实现针对 video-generate 节点（单一 media 输入口，素材类型由来源节点类型决定）：
 * - connect：来源节点输出类型为 image → 追加 imageClip；audio → 追加 audioClip；
 *   video → 不进导演台轨道（仅在参考模式作为参考素材）；
 * - disconnect：删除 sourceNodeId 匹配的 clip。
 * 只增删、不重排——保留用户已拖好的滑块位置。
 *
 * @param data 画布数据
 * @param event 连线变化事件
 * @returns 更新后的画布数据（无变化时返回原引用）
 */
export function applyConnectionSync(data: CanvasData, event: ConnectionSyncEvent): CanvasData {
  const node = data.nodes.find((n) => n.id === event.connection.toNodeId)
  if (!node || node.prototypeId !== 'video-generate') return data

  const director = node.config.director
  if (!director || typeof director !== 'object') return data
  const d = director as Partial<CanvasDirectorConfig>

  if (event.type === 'disconnect') {
    const source = event.connection.fromNodeId
    const imageClips = (d.imageClips ?? []).filter((c) => c.sourceNodeId !== source)
    const audioClips = (d.audioClips ?? []).filter((c) => c.sourceNodeId !== source)
    if (imageClips.length === (d.imageClips?.length ?? 0) && audioClips.length === (d.audioClips?.length ?? 0)) {
      return data
    }
    return withDirector(data, node.id, { ...d, imageClips, audioClips })
  }

  // connect：按来源节点输出类型归类
  const srcType = getNodeOutputType(event.connection.fromNodeId, data.nodes)
  if (srcType === 'image') {
    const imageClips = d.imageClips ?? []
    if (imageClips.some((c) => c.sourceNodeId === event.connection.fromNodeId)) return data
    const maxStart = imageClips.reduce((m, c) => Math.max(m, c.startOffset + c.duration), 0)
    const total = typeof d.duration === 'number' && d.duration > 0 ? d.duration : maxStart + DEFAULT_IMAGE_CLIP_DURATION
    const clip: CanvasDirectorImageClip = {
      id: newId(),
      sourceNodeId: event.connection.fromNodeId,
      startOffset: Math.min(maxStart, Math.max(0, total - DEFAULT_IMAGE_CLIP_DURATION)),
      duration: DEFAULT_IMAGE_CLIP_DURATION,
    }
    return withDirector(data, node.id, { ...d, imageClips: [...imageClips, clip] })
  }

  if (srcType === 'audio') {
    const audioClips = d.audioClips ?? []
    if (audioClips.some((c) => c.sourceNodeId === event.connection.fromNodeId)) return data
    const maxStart = audioClips.reduce((m, c) => Math.max(m, c.startOffset + c.duration), 0)
    const clip: CanvasDirectorAudioClip = {
      id: newId(),
      sourceNodeId: event.connection.fromNodeId,
      startOffset: maxStart,
      trimStart: 0,
      trimEnd: 0,
      duration: 2,
    }
    return withDirector(data, node.id, { ...d, audioClips: [...audioClips, clip] })
  }

  // video 来源不进导演台轨道（参考模式通过分组输入参与生成）
  return data
}

/** 以新 director 配置替换指定节点的 config.director（生成新节点数组） */
function withDirector(data: CanvasData, nodeId: string, director: Partial<CanvasDirectorConfig>): CanvasData {
  return {
    ...data,
    nodes: data.nodes.map((n) =>
      n.id === nodeId ? { ...n, config: { ...n.config, director } } : n,
    ),
  }
}
