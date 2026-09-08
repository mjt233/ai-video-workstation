import client from './client'

/**
 * 系统设置与回收站（系统级，不区分项目）。
 *
 * - 系统设置按**子类**分组，当前含「回收站」子类（自动清理开关 / 执行间隔 / 保留期）；
 * - 全局回收站位于 `design/.trash/`，所有项目共用，条目按批次 + 项目名组织。
 */

/** 回收站自动清理配置 */
export interface TrashAutoCleanSettings {
  /** 是否启用定时自动清理 */
  enabled: boolean
  /** 执行间隔（天） */
  intervalDays: number
  /** 回收站保留期（天）：移入超过该天数的条目会被自动彻底删除 */
  retentionDays: number
}

/** 回收站子类设置 */
export interface TrashSettings {
  autoClean: TrashAutoCleanSettings
  /** 上次自动清理执行时间（ISO；从未执行为 null） */
  lastRunAt: string | null
}

/** 系统设置整体结构 */
export interface SystemSettings {
  trash: TrashSettings
}

/** 系统设置响应（附回收站统计与下次自动清理时间） */
export interface SystemSettingsPayload {
  settings: SystemSettings
  trashStats: { count: number; totalSize: number }
  /** 下次自动清理时间（ISO）；从未执行时为 null（表示应立即执行） */
  nextRunAt: string | null
}

/** 自动清理配置的可写字段 */
export interface TrashAutoCleanPatch {
  enabled?: boolean
  intervalDays?: number
  retentionDays?: number
}

/** 回收站条目 */
export interface TrashItem {
  id: string
  batchId: string
  /** 原所属项目名 */
  project: string
  /** 原 `assert/` 内相对路径 */
  relPath: string
  /** 原项目内相对路径（= relPath，展示用） */
  originalPath: string
  size: number
  /** 移入回收站时间（ISO） */
  trashedAt: string
  /** 距保留期到期剩余天数（负数 = 已超期） */
  expiresInDays: number
}

/** 回收站批次 */
export interface TrashBatch {
  batchId: string
  createdAt: string
  items: TrashItem[]
  count: number
  size: number
}

/** 回收站列表响应 */
export interface TrashListResult {
  batches: TrashBatch[]
  count: number
  totalSize: number
  retentionDays: number
}

/** 自动清理执行结果 */
export interface TrashCleanResult {
  ran: boolean
  deleted: number
  freed: number
  remaining: number
  retentionDays: number
}

/**
 * 读取系统设置（含回收站统计与下次自动清理时间）。
 *
 * @returns 系统设置 + 回收站统计 + 下次执行时间
 */
export async function getSystemSettings(): Promise<SystemSettingsPayload> {
  const { data } = await client.get<SystemSettingsPayload>('/system/settings')
  return data
}

/**
 * 局部更新系统设置（当前仅「回收站 → 自动清理」）。
 *
 * @param patch 可部分更新的自动清理字段
 * @returns 更新后的系统设置响应
 */
export async function updateSystemSettings(patch: TrashAutoCleanPatch): Promise<SystemSettingsPayload> {
  const { data } = await client.put<SystemSettingsPayload>('/system/settings', {
    trash: { autoClean: patch },
  })
  return data
}

/**
 * 读取全局回收站内容（按批次分组，新批次在前）。
 *
 * @returns 批次列表、总文件数与总大小、当前保留期
 */
export async function getTrash(): Promise<TrashListResult> {
  const { data } = await client.get<TrashListResult>('/system/trash')
  return data
}

/**
 * 从回收站恢复条目到原项目位置。
 *
 * @param items 待恢复条目（批次号 + 项目名 + assert 内相对路径）
 * @returns 恢复成功的条目与跳过项
 */
export async function restoreTrash(
  items: Array<Pick<TrashItem, 'batchId' | 'project' | 'relPath'>>,
): Promise<{ restored: Array<{ project: string; path: string }>; skipped: Array<{ path: string; reason: string }> }> {
  const { data } = await client.post<{
    restored: Array<{ project: string; path: string }>
    skipped: Array<{ path: string; reason: string }>
  }>('/system/trash/restore', { items })
  return data
}

/**
 * 彻底删除回收站条目（不可恢复）。
 *
 * @param options 删除范围：指定条目 / 指定批次 / 全部
 * @returns 删除文件数与释放空间
 */
export async function purgeTrash(options: {
  items?: Array<Pick<TrashItem, 'batchId' | 'project' | 'relPath'>>
  batchId?: string
  all?: boolean
}): Promise<{ deleted: number; freed: number }> {
  const { data } = await client.post<{ deleted: number; freed: number }>('/system/trash/purge', options)
  return data
}

/**
 * 立即执行一次自动清理（手动触发，忽略「启用」开关，沿用配置的保留期）。
 *
 * @returns 执行结果（删除数量 / 释放空间 / 剩余数量）
 */
export async function runTrashAutoClean(): Promise<TrashCleanResult> {
  const { data } = await client.post<TrashCleanResult>('/system/trash/auto-clean')
  return data
}
