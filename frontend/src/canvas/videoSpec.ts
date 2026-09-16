import type { NodeConfig } from './types'
import type { CanvasDirectorConfig } from './videoTypes'

/**
 * 【生成视频】节点输出规格的读取入口。
 *
 * 事实源约定（单一权威）：
 * - `config.duration` / `config.resolution` / `config.sizeConfig` / `config.fps` 是唯一权威，
 *   所有编辑入口（参数行时长、输出尺寸菜单、工作流参数）只写这些字段；
 * - `config.director.duration/width/height/fps` 是**遗留字段**（画布导演台早期自成一套规格），
 *   仅作为旧画布的读取回退，任何写入路径都不再更新它们。
 *
 * 因此导演台模式的「总长」与其它模式的「时长」天然同源，不需要任何双向同步逻辑。
 */

/** 输出时长缺省值（秒；规格未设置时的回退，与 DurationPicker 显示保持一致） */
export const VIDEO_DURATION_FALLBACK = 5

/** 视频输出规格（时长/宽高/帧率；0 表示未设置，由调用方决定回退） */
export interface VideoSpec {
  /** 成片时长（秒；未设置时为 0） */
  duration: number
  /** 输出宽度（像素；未设置时为 0） */
  width: number
  /** 输出高度（像素；未设置时为 0） */
  height: number
  /** 帧率（未设置时为 0） */
  fps: number
}

/**
 * 取正整数/正浮点数；非法（undefined/NaN/字符串非数字/<=0）时返回 0。
 *
 * @param raw 原始值（来自节点 config 的未知类型字段）
 * @returns 有效正数；无效时为 0
 */
function positive(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * 读取【生成视频】节点的输出时长/宽高/帧率。
 *
 * 读取优先级（逐字段独立回退）：
 * - duration：`config.duration` → `config.director.duration` → 0；
 * - width/height：`config.resolution`（双维有效）→ `config.sizeConfig`（双维有效）
 *   → `config.director.width/height`（双维有效）→ 0/0；
 * - fps：`config.fps` → `config.director.fps` → 0。
 *
 * 全 0 表示用户从未设置过（时长由界面回退 `VIDEO_DURATION_FALLBACK`，
 * 分辨率由工作流提交时回退默认尺寸）。
 *
 * @param config 节点配置（`CanvasNodeData.config`；可为空）
 * @returns 输出规格（各字段 0 表示未设置）
 */
export function readVideoSpec(config?: NodeConfig | null): VideoSpec {
  if (!config || typeof config !== 'object') return { duration: 0, width: 0, height: 0, fps: 0 }

  const directorRaw = config.director
  const director =
    directorRaw && typeof directorRaw === 'object' ? (directorRaw as Partial<CanvasDirectorConfig>) : undefined

  const duration = positive(config.duration) || positive(director?.duration) || 0
  const fps = positive(config.fps) || positive(director?.fps) || 0

  const resolution = config.resolution as { width?: unknown; height?: unknown } | undefined
  const resW = positive(resolution?.width)
  const resH = positive(resolution?.height)
  if (resW > 0 && resH > 0) return { duration, width: resW, height: resH, fps }

  const sizeConfig = config.sizeConfig as { width?: unknown; height?: unknown } | undefined
  const scW = positive(sizeConfig?.width)
  const scH = positive(sizeConfig?.height)
  if (scW > 0 && scH > 0) return { duration, width: scW, height: scH, fps }

  const dirW = positive(director?.width)
  const dirH = positive(director?.height)
  if (dirW > 0 && dirH > 0) return { duration, width: dirW, height: dirH, fps }

  return { duration, width: 0, height: 0, fps }
}
