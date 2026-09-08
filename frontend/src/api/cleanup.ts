import client from './client'

/**
 * 存储清理（项目侧）：扫描「无引用自定义资产」与「久远历史记录」，并把选中项移入系统全局回收站。
 *
 * 回收站的查看/恢复/彻底删除与自动清理配置属于系统级功能，见 `api/system.ts`。
 */

/** 扫描分组 */
export type CleanupCategory =
  | 'custom-orphan'
  | 'canvas-history'
  | 'character-history'
  | 'stage-history'
  | 'prop-history'

/** 预览类型（决定用图片/音视频/文本方式预览） */
export type CleanupPreviewKind = 'image' | 'audio' | 'video' | 'text' | 'none'

/** 单条扫描结果 */
export interface CleanupItem {
  /** 稳定标识（= path） */
  id: string
  category: CleanupCategory
  /** 分组显示名 */
  groupLabel: string
  /** 项目内相对路径 */
  path: string
  /** 文件大小（字节） */
  size: number
  /** 时间（ISO）：历史项为归档时间，自定义资产为文件修改时间 */
  time: string
  /** 距今毫秒数 */
  ageMs: number
  /** 历史项的所属当前资产路径 */
  ownerPath?: string
  previewKind: CleanupPreviewKind
}

/** 分组统计 */
export interface CleanupGroupTotal {
  count: number
  size: number
}

/** 扫描结果 */
export interface CleanupScanResult {
  scannedAt: string
  olderThanDays: number
  items: CleanupItem[]
  /** 全部结果总大小（字节） */
  totalSize: number
  groupTotals: Record<CleanupCategory, CleanupGroupTotal>
  stats: {
    customFiles: number
    customReferenced: number
    historyFiles: number
    historyStale: number
  }
}

/** 移入回收站时被跳过的条目 */
export interface CleanupSkipped {
  path: string
  reason: string
}

/** 移入回收站结果 */
export interface CleanupTrashResult {
  /** 本次批次号（可在系统设置 → 回收站中按批次定位） */
  batchId: string
  /** 成功移入的路径 */
  moved: string[]
  /** 跳过项及原因 */
  skipped: CleanupSkipped[]
}

/** 历史记录「久远」阈值默认值（天），与服务端一致 */
export const DEFAULT_OLDER_THAN_DAYS = 7

/**
 * 扫描可清理项。
 *
 * @param project 项目名
 * @param olderThanDays 历史记录阈值（天，默认 7）
 * @returns 扫描结果
 */
export async function scanCleanup(project: string, olderThanDays = DEFAULT_OLDER_THAN_DAYS): Promise<CleanupScanResult> {
  const { data } = await client.post<CleanupScanResult>(
    `/assets/${encodeURIComponent(project)}/cleanup/scan`,
    { olderThanDays },
  )
  return data
}

/**
 * 把选中项移入系统全局回收站（`design/.trash/{批次}/{项目名}/...`）。
 *
 * 服务端会在移入前二次校验引用，仍被引用的资产会被跳过并返回原因。
 *
 * @param project 项目名
 * @param paths 项目内相对路径数组（`assert/` 下）
 * @returns 批次号、成功移入路径与跳过项
 */
export async function moveCleanupToTrash(project: string, paths: string[]): Promise<CleanupTrashResult> {
  const { data } = await client.post<CleanupTrashResult>(
    `/assets/${encodeURIComponent(project)}/cleanup/trash`,
    { paths },
  )
  return data
}
