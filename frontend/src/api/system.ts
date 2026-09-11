import client from './client'

/**
 * 系统设置与回收站（系统级，不区分项目）。
 *
 * - 系统设置按**子类**分组，含「回收站」与「任务日志」两个子类
 *   （回收站：自动清理开关 / 执行间隔 / 保留期；任务日志：同结构 + 轮询心跳间隔）；
 * - 全局回收站位于 `design/.trash/`，所有项目共用，条目按批次 + 项目名组织；
 * - 任务日志保留在 `data/workflow.db` 的 `task_logs` 表，超期日志按子类配置自动清理。
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

/** 任务日志自动清理配置 */
export interface TaskLogAutoCleanSettings {
  /** 是否启用定时自动清理 */
  enabled: boolean
  /** 执行间隔（小时） */
  intervalHours: number
  /** 日志保留期（天）：**已终态任务**的日志超过该天数会被删除 */
  retentionDays: number
}

/** 任务日志子类设置 */
export interface TaskLogSettings {
  autoClean: TaskLogAutoCleanSettings
  /** 轮询心跳间隔（秒；0 = 不写心跳日志） */
  heartbeatSeconds: number
  /** 上次自动清理执行时间（ISO；从未执行为 null） */
  lastRunAt: string | null
}

/** 系统设置整体结构 */
export interface SystemSettings {
  trash: TrashSettings
  taskLog: TaskLogSettings
}

/** 任务日志占用统计 */
export interface TaskLogStats {
  /** 日志总行数 */
  totalRows: number
  /** 最早一条日志时间（SQLite UTC 格式；无日志时为 null） */
  oldestAt: string | null
  /** 日志表数据占用字节（dbstat 实测） */
  tableBytes: number
  /** 日志索引占用字节（dbstat 实测） */
  indexBytes: number
  /** 数据库文件占用字节（主库 + WAL + SHM） */
  fileBytes: number
  /** 数据库已分配页占用字节 */
  allocatedBytes: number
  /** 空闲页字节数（> 0 表示删除过数据但尚未 VACUUM 回收） */
  freelistBytes: number
  /** 空闲页数量 */
  freelistCount: number
  /** 已终态任务中超过保留期、可被清理的日志行数 */
  cleanableRows: number
  /** 运行中任务的日志行数（永不被清理） */
  activeRows: number
  /** 当前保留期（天） */
  retentionDays: number
  /** 当前轮询心跳间隔（秒） */
  heartbeatSeconds: number
  /** 上次自动清理时间（ISO；从未执行为 null） */
  lastRunAt: string | null
  /** 下次自动清理时间（ISO；从未执行时为 null） */
  nextRunAt: string | null
}

/** 系统设置响应（附回收站统计、日志统计与下次自动清理时间） */
export interface SystemSettingsPayload {
  settings: SystemSettings
  trashStats: { count: number; totalSize: number }
  /** 下次回收站自动清理时间（ISO）；从未执行时为 null（表示应立即执行） */
  nextRunAt: string | null
  /** 任务日志占用统计 */
  taskLogStats: TaskLogStats
  /** 下次任务日志清理时间（ISO）；从未执行时为 null */
  taskLogNextRunAt: string | null
}

/** 自动清理配置的可写字段 */
export interface TrashAutoCleanPatch {
  enabled?: boolean
  intervalDays?: number
  retentionDays?: number
}

/** 任务日志子类的可写字段 */
export interface TaskLogPatch {
  /** 自动清理配置（可部分更新） */
  autoClean?: {
    enabled?: boolean
    intervalHours?: number
    retentionDays?: number
  }
  /** 轮询心跳间隔（秒；0 = 不写心跳） */
  heartbeatSeconds?: number
}

/** 任务日志清理结果（`POST /api/system/task-log/clean`） */
export interface TaskLogCleanResult {
  /** 是否真正执行了清理（配置禁用且非手动触发时为 false；手动入口恒为 true） */
  ran: boolean
  /** 删除的日志行数 */
  deleted: number
  /** 删除前数据库已分配页占用（字节） */
  allocatedBytesBefore: number
  /** 回收后数据库已分配页占用（字节） */
  allocatedBytesAfter: number
  /** 回收后空闲页数量（0 = 已 VACUUM 回收） */
  freelistAfter: number
  /** 清理后剩余日志行数 */
  remaining: number
  /** 本次使用的保留期（天） */
  retentionDays: number
  /** 截止时间（ISO） */
  cutoff: string
}

/**
 * 清空任务日志结果（`POST /api/system/task-log/purge`）。
 *
 * 与 [TaskLogCleanResult] **形状不同**：清空不看保留期，因此服务端不返回
 * `ran`/`remaining`/`retentionDays`，改为返回受保护的运行中日志行数。
 */
export interface TaskLogPurgeResult {
  /** 删除的日志行数 */
  deleted: number
  /** 删除前数据库已分配页占用（字节） */
  allocatedBytesBefore: number
  /** 回收后数据库已分配页占用（字节） */
  allocatedBytesAfter: number
  /** 回收后空闲页数量 */
  freelistAfter: number
  /** 截止时间（ISO；清空操作取当前时间） */
  cutoff: string
  /** 受保护的运行中（pending/running）任务日志行数 */
  protectedRows: number
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
 * 局部更新系统设置（「回收站 → 自动清理」与「任务日志」）。
 *
 * @param patch 可部分更新的子类配置（trash/taskLog 各自可只传部分字段）
 * @returns 更新后的系统设置响应
 */
export async function updateSystemSettings(patch: {
  trash?: TrashAutoCleanPatch
  taskLog?: TaskLogPatch
}): Promise<SystemSettingsPayload> {
  const body: Record<string, unknown> = {}
  if (patch.trash) body.trash = { autoClean: patch.trash }
  if (patch.taskLog) body.taskLog = patch.taskLog
  const { data } = await client.put<SystemSettingsPayload>('/system/settings', body)
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

/**
 * 读取任务日志占用统计（行数 / 最早日志 / 表+索引占用 / 可清理行数 / 下次清理时间）。
 *
 * @returns 任务日志统计
 */
export async function getTaskLogStats(): Promise<TaskLogStats> {
  const { data } = await client.get<TaskLogStats>('/system/task-log/stats')
  return data
}

/**
 * 立即清理超期任务日志（手动触发，忽略「启用」开关，沿用配置的保留期并回收磁盘）。
 *
 * @returns 清理结果（删除行数 / 占用变化 / 空闲页）
 */
export async function cleanTaskLogs(): Promise<TaskLogCleanResult> {
  const { data } = await client.post<TaskLogCleanResult>('/system/task-log/clean')
  return data
}

/**
 * 清空全部**已终态任务**日志（运行中任务的日志受保护，不会删除）。
 *
 * @returns 清空结果（含受保护的运行中日志行数）
 */
export async function purgeTaskLogs(): Promise<TaskLogPurgeResult> {
  const { data } = await client.post<TaskLogPurgeResult>('/system/task-log/purge')
  return data
}
