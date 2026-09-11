/**
 * 任务日志自动清理：按保留期删除**已终态任务**的超期日志并回收磁盘。
 *
 * 执行内容与触发时机分离：
 * - 本模块负责「清理什么」——调用 `db.cleanupTaskLogs` 删除超期日志、`VACUUM` 回收空间，
 *   并更新 `taskLog.lastRunAt`；
 * - 触发时机（每 N 小时 / 启动补跑 / 手动执行）由 `log-scheduler.ts` 与
 *   `POST /api/system/task-log/clean` 负责。
 *
 * **安全边界**：
 * - 只删 `task_logs` 中属于 `completed` / `failed` 任务的超期日志；
 * - `pending` / `running` 任务的日志**永不删除**（否则运行中任务的排查线索会丢失）；
 * - `tasks` 行、产物文件与产物历史一律保留（任务管理器「历史」页签仍可列出任务）。
 *
 * 所有触发都会在控制台打印日志（前缀 `[tasklog-auto-clean]`），便于运维排查。
 */
import {
  cleanupTaskLogs,
  countCleanableLogs,
  getLogStats,
  type LogCleanupResult,
  type LogStats,
} from '../db.js';
import {
  computeNextRunAtHours,
  readSystemSettings,
  markTaskLogCleanRun,
  SYSTEM_SETTINGS_PATH,
} from './system-settings.js';
import { formatBytesForLog } from './trash-cleaner.js';

/** 自动清理触发来源（仅用于日志） */
export type TaskLogCleanReason = 'scheduled' | 'startup' | 'manual';

/** 一次任务日志自动清理的执行结果 */
export interface TaskLogCleanResult {
  /** 是否真正执行了清理（已禁用且非手动触发时为 false） */
  ran: boolean;
  /** 删除的日志行数 */
  deleted: number;
  /** 删除前数据库已分配页占用（字节） */
  allocatedBytesBefore: number;
  /** 回收后数据库已分配页占用（字节） */
  allocatedBytesAfter: number;
  /** 回收后空闲页数量（0 = 已 VACUUM 回收） */
  freelistAfter: number;
  /** 清理后剩余的日志行数 */
  remaining: number;
  /** 本次使用的保留期（天） */
  retentionDays: number;
  /** 截止时间（ISO 字符串） */
  cutoff: string;
}

/**
 * 判断是否已到达执行间隔（纯函数，供调度器与单测使用）。
 *
 * @param lastRunAt 上次执行时间（ISO 字符串；null = 从未执行 → 应立即执行）
 * @param intervalHours 执行间隔（小时）
 * @param now 当前时间
 * @returns 需要执行返回 true
 */
export function shouldRunLogAutoClean(lastRunAt: string | null, intervalHours: number, now: Date): boolean {
  if (!lastRunAt) return true;
  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= intervalHours * 3600000;
}

/**
 * 采集任务日志统计快照（附保留期、心跳、上次与下次执行时间）。
 *
 * `GET /api/system/settings` 与 `GET /api/system/task-log/stats` **共用**本函数，
 * 保证两处返回的任务日志统计结构完全一致（前端 `TaskLogStats` 只有一个形状）。
 *
 * @param options.configPath 系统设置文件路径（默认 SYSTEM_SETTINGS_PATH）
 * @param options.now 当前时间（测试可注入）
 * @returns 任务日志统计快照
 */
export async function taskLogSnapshot(
  options: { configPath?: string; now?: Date } = {},
): Promise<LogStats & {
  retentionDays: number;
  heartbeatSeconds: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
}> {
  const configPath = options.configPath ?? SYSTEM_SETTINGS_PATH;
  const settings = await readSystemSettings(configPath);
  const { retentionDays, intervalHours } = settings.taskLog.autoClean;
  return {
    ...getLogStats(retentionDays, options.now ?? new Date()),
    retentionDays,
    heartbeatSeconds: settings.taskLog.heartbeatSeconds,
    lastRunAt: settings.taskLog.lastRunAt,
    nextRunAt: computeNextRunAtHours(settings.taskLog.lastRunAt, intervalHours),
  };
}

/**
 * 统计当前可清理的日志行数（供确认弹窗与手动清理预演使用）。
 *
 * @param options.configPath 系统设置文件路径（默认 SYSTEM_SETTINGS_PATH）
 * @param options.now 当前时间（测试可注入）
 * @returns 可清理行数
 */
export async function previewTaskLogClean(
  options: { configPath?: string; now?: Date } = {},
): Promise<number> {
  const settings = await readSystemSettings(options.configPath ?? SYSTEM_SETTINGS_PATH);
  return countCleanableLogs(settings.taskLog.autoClean.retentionDays, options.now ?? new Date());
}

/**
 * 执行一次任务日志清理（删除已终态任务的超期日志并回收空间）。
 *
 * @param options.reason 触发来源（日志用）
 * @param options.force 强制执行：即使配置为「禁用」也执行（手动触发用）
 * @param options.configPath 系统设置文件路径（默认 SYSTEM_SETTINGS_PATH）
 * @param options.now 当前时间（测试可注入）
 * @param options.vacuum 是否回收磁盘（默认 true；测试可关闭以提速）
 * @returns 执行结果
 */
export async function runTaskLogAutoClean(
  options: {
    reason: TaskLogCleanReason;
    force?: boolean;
    configPath?: string;
    now?: Date;
    vacuum?: boolean;
  } = { reason: 'scheduled' },
): Promise<TaskLogCleanResult> {
  const configPath = options.configPath ?? SYSTEM_SETTINGS_PATH;
  const now = options.now ?? new Date();
  const settings = await readSystemSettings(configPath);
  const { enabled, retentionDays } = settings.taskLog.autoClean;

  if (!enabled && !options.force) {
    console.log('[tasklog-auto-clean] 自动清理已禁用，跳过本轮');
    return emptyResult(false, retentionDays);
  }

  const started = Date.now();
  const stats = getLogStats(retentionDays, now);
  console.log(
    `[tasklog-auto-clean] 触发清理（来源：${options.reason}，保留期 ${retentionDays} 天，`
    + `现有 ${stats.totalRows} 行 / 表+索引 ${formatBytesForLog(stats.tableBytes + stats.indexBytes)}，`
    + `可清理 ${stats.cleanableRows} 行，运行中任务 ${stats.activeRows} 行受保护）`,
  );

  let cleanup: LogCleanupResult;
  try {
    cleanup = cleanupTaskLogs({ retentionDays, now, vacuum: options.vacuum !== false });
  } catch (e) {
    // 清理失败不更新 lastRunAt：下一轮自动重试（错误向上抛给调用方决定如何提示）
    console.error('[tasklog-auto-clean] 清理失败:', e);
    throw e;
  }

  const at = now.toISOString();
  await markTaskLogCleanRun(at, configPath);
  const remaining = stats.totalRows - cleanup.deleted;

  console.log(
    `[tasklog-auto-clean] 完成：删除 ${cleanup.deleted} 行日志，`
    + `库占用 ${formatBytesForLog(cleanup.allocatedBytesBefore)} → ${formatBytesForLog(cleanup.allocatedBytesAfter)}`
    + `（空闲页 ${cleanup.freelistAfter}），剩余 ${remaining} 行，耗时 ${Date.now() - started} ms`,
  );

  return {
    ran: true,
    deleted: cleanup.deleted,
    allocatedBytesBefore: cleanup.allocatedBytesBefore,
    allocatedBytesAfter: cleanup.allocatedBytesAfter,
    freelistAfter: cleanup.freelistAfter,
    remaining,
    retentionDays,
    cutoff: cleanup.cutoff,
  };
}

/**
 * 构造「未执行」的空结果（清理被禁用时返回）。
 *
 * @param ran 是否执行
 * @param retentionDays 保留期（天）
 * @returns 空结果
 */
function emptyResult(ran: boolean, retentionDays: number): TaskLogCleanResult {
  return {
    ran,
    deleted: 0,
    allocatedBytesBefore: 0,
    allocatedBytesAfter: 0,
    freelistAfter: 0,
    remaining: 0,
    retentionDays,
    cutoff: new Date().toISOString(),
  };
}
