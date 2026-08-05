import type { VideoWorkflowSubmitParams } from '../api/workflow'
import type { CanvasNodeData } from './types'
import type { CanvasInputInfo } from './generate'
import type { CanvasDirectorConfig, VideoGenerateMode } from './videoTypes'

/** 提交参数类型复用 api/workflow.ts 的 VideoWorkflowSubmitParams（与后端 wire 形态一致） */
export type VideoSubmitParams = VideoWorkflowSubmitParams

/** 按端口分组的输入资产 */
export interface VideoNodeInputs {
  /** 图片端口输入资产（images 端口） */
  images: CanvasInputInfo[]
  /** 视频端口输入资产（videos 端口） */
  videos: CanvasInputInfo[]
  /** 音频端口输入资产（audios 端口） */
  audios: CanvasInputInfo[]
}

/**
 * 首尾帧模式 cursor：首帧 0、尾帧 1、中间帧均匀分布。
 *
 * @param index 帧在有序列表中的下标
 * @param total 帧总数
 * @returns 归一化 cursor（0~1；仅 1 帧时固定 0）
 */
function frameCursor(index: number, total: number): number {
  if (total <= 1) return 0
  return index / (total - 1)
}

/**
 * 由节点配置 + 输入资产组装视频工作流提交参数（wire 形态）。
 * 画布【生成视频】节点提交前调用。
 *
 * 三种模式：
 * - director：按 imageClips.startOffset 升序生成 frames（cursor = startOffset / duration），
 *   音频取第一条 audioClip 对应输入；
 * - first-last-frame：复用 director 配置，但 cursor 按首尾帧自动均匀分布；
 * - reference：按 config.inputOrder 对三组端口输入统一排序，分组生成 references。
 *
 * workflowParams.seed 会从 extraParams 中剥离并转换为数字型 seed（字符串数字也可转换）。
 *
 * @param node 视频生成节点（config 含 mode/prompt/workflowParams/director 或 inputOrder/resolution/duration）
 * @param inputs 按端口分组的输入资产
 * @returns 视频提交参数（与后端 VideoWorkflowSubmitParams wire 形态一致）
 */
export function buildVideoSubmitParams(node: CanvasNodeData, inputs: VideoNodeInputs): VideoSubmitParams {
  const config = node.config
  const mode: VideoGenerateMode =
    config.mode === 'director' || config.mode === 'first-last-frame' || config.mode === 'reference'
      ? config.mode
      : 'director'
  const prompt = typeof config.prompt === 'string' ? config.prompt : ''
  const seedRaw = (config.workflowParams as Record<string, unknown> | undefined)?.seed
  const seed =
    typeof seedRaw === 'number'
      ? seedRaw
      : typeof seedRaw === 'string' && seedRaw !== ''
        ? Number(seedRaw)
        : undefined
  const extraParams = { ...((config.workflowParams as Record<string, unknown> | undefined) ?? {}) }
  delete extraParams.seed

  if (mode === 'reference') {
    const order: string[] = Array.isArray(config.inputOrder) ? (config.inputOrder as string[]) : []
    const sortByOrder = (list: CanvasInputInfo[]): CanvasInputInfo[] =>
      [...list].sort((a, b) => {
        const ia = order.indexOf(a.nodeId)
        const ib = order.indexOf(b.nodeId)
        return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
      })
    const refs = [
      ...sortByOrder(inputs.images).map((i) => ({ type: 'image' as const, path: i.path })),
      ...sortByOrder(inputs.videos).map((i) => ({ type: 'video' as const, path: i.path })),
      ...sortByOrder(inputs.audios).map((i) => ({ type: 'audio' as const, path: i.path })),
    ]
    const r = config.resolution as { width?: number; height?: number } | undefined
    const duration = Number(config.duration) || 5
    return {
      mode,
      resolution: { width: r?.width || 1280, height: r?.height || 720 },
      duration,
      prompt,
      ...(seed != null && !Number.isNaN(seed) ? { seed } : {}),
      references: refs,
      extraParams,
    }
  }

  // director / first-last-frame
  const d = (config.director ?? {}) as Partial<CanvasDirectorConfig>
  const bySource = new Map(inputs.images.concat(inputs.videos).concat(inputs.audios).map((i) => [i.nodeId, i.path]))
  const imageClips = (d.imageClips ?? []).slice()
  const audioClips = d.audioClips ?? []

  let frames: Array<{ path: string; cursor: number }>
  if (mode === 'director') {
    frames = [...imageClips]
      .sort((a, b) => a.startOffset - b.startOffset)
      .map((c) => ({
        path: bySource.get(c.sourceNodeId) ?? '',
        cursor: d.duration && d.duration > 0 ? Math.min(Math.max(c.startOffset / d.duration, 0), 1) : 0,
      }))
      .filter((f) => f.path)
  } else {
    // first-last-frame：cursor 自动均匀分布
    frames = [...imageClips]
      .sort((a, b) => a.startOffset - b.startOffset)
      .map((c) => bySource.get(c.sourceNodeId) ?? '')
      .filter(Boolean)
      .map((path, i, arr) => ({ path, cursor: frameCursor(i, arr.length) }))
  }

  const audioPath = audioClips.length > 0 ? bySource.get(audioClips[0].sourceNodeId) : undefined

  return {
    mode,
    resolution: { width: d.width || 1280, height: d.height || 720 },
    ...(d.fps ? { fps: d.fps } : {}),
    duration: d.duration || 5,
    prompt,
    ...(seed != null && !Number.isNaN(seed) ? { seed } : {}),
    director: {
      frames,
      ...(audioPath ? { audio: { path: audioPath } } : {}),
    },
    extraParams,
  }
}
