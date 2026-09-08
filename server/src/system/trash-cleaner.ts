/**
 * 回收站自动清理：按保留期删除回收站中的超期条目。
 *
 * 执行内容与触发时机分离：
 * - 本模块负责「清理什么」——筛选超期条目并彻底删除，同时更新 `lastRunAt`；
 * - 触发时机（每 N 天 / 启动补跑 / 手动执行）由 `trash-scheduler.ts` 与
 *   `POST /api/system/trash/auto-clean` 负责。
 *
 * 所有触发都会在控制台打印日志（前缀 `[trash-auto-clean]`），便于运维排查。
 */
import { listTrash, purgeTrash, type TrashItem } from '../assets/trash.js';
import { readSystemSettings, markTrashAutoCleanRun, SYSTEM_SETTINGS_PATH } from './system-settings.js';

/** 自动清理触发来源（仅用于日志） */
export type TrashCleanReason = 'scheduled' | 'startup' | 'manual';

/** 一次自动清理的执行结果 */
export interface TrashCleanResult {
  /** 是否真正执行了清理（已禁用且非手动触发时为 false） */
  ran: boolean;
  /** 删除的文件数 */
  deleted: number;
  /** 释放空间（字节） */
  freed: number;
  /** 回收站中仍在保留期内的文件数 */
  remaining: number;
  /** 本次使用的保留期（天） */
  retentionDays: number;
}

/** 字节数格式化为日志友好文本 */
export function formatBytesForLog(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

/**
 * 判断是否已到达执行间隔（纯函数，供调度器与单测使用）。
 *
 * @param lastRunAt 上次执行时间（ISO 字符串；null = 从未执行 → 应立即执行）
 * @param intervalDays 执行间隔（天）
 * @param now 当前时间
 * @returns 需要执行返回 true
 */
export function shouldRunAutoClean(lastRunAt: string | null, intervalDays: number, now: Date): boolean {
  if (!lastRunAt) return true;
  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= intervalDays * 86400000;
}

/**
 * 从回收站条目中筛选超期（超过保留期）条目。
 *
 * 边界：恰好等于保留期时**不**算超期（`>` 而非 `>=`）。
 *
 * @param items 回收站条目
 * @param retentionDays 保留期（天）
 * @param now 当前时间
 * @returns 超期条目
 */
export function selectExpiredTrashItems(
  items: TrashItem[],
  retentionDays: number,
  now: Date,
): TrashItem[] {
  const thresholdMs = retentionDays * 86400000;
  return items.filter((item) => {
    const at = Date.parse(item.trashedAt);
    if (Number.isNaN(at)) return false;
    return now.getTime() - at > thresholdMs;
  });
}

/**
 * 执行一次自动清理（删除回收站中超过保留期的条目）。
 *
 * @param options.reason 触发来源（日志用）
 * @param options.force 强制执行：即使配置为「禁用」也执行（手动触发用）
 * @param options.configPath 系统设置文件路径（默认 SYSTEM_SETTINGS_PATH）
 * @param options.now 当前时间（测试可注入）
 * @returns 执行结果
 */
export async function runTrashAutoClean(
  options: { reason: TrashCleanReason; force?: boolean; configPath?: string; now?: Date } = { reason: 'scheduled' },
): Promise<TrashCleanResult> {
  const configPath = options.configPath ?? SYSTEM_SETTINGS_PATH;
  const now = options.now ?? new Date();
  const settings = await readSystemSettings(configPath);
  const { enabled, retentionDays } = settings.trash.autoClean;

  if (!enabled && !options.force) {
    console.log('[trash-auto-clean] 自动清理已禁用，跳过本轮');
    return { ran: false, deleted: 0, freed: 0, remaining: 0, retentionDays };
  }

  const started = Date.now();
  const listed = await listTrash({ retentionDays, now });
  const expired = selectExpiredTrashItems(
    listed.batches.flatMap((batch) => batch.items),
    retentionDays,
    now,
  );

  console.log(
    `[trash-auto-clean] 触发自动清理（来源：${options.reason}，保留期 ${retentionDays} 天，`
    + `回收站现有 ${listed.count} 个文件 / ${formatBytesForLog(listed.totalSize)}）`,
  );

  let deleted = 0;
  let freed = 0;
  if (expired.length > 0) {
    const result = await purgeTrash({
      items: expired.map((item) => ({
        batchId: item.batchId,
        project: item.project,
        relPath: item.relPath,
      })),
    });
    deleted = result.deleted;
    freed = result.freed;
  }

  const at = now.toISOString();
  await markTrashAutoCleanRun(at, configPath);
  const remaining = listed.count - deleted;

  console.log(
    `[trash-auto-clean] 完成：删除 ${deleted} 个文件，释放 ${formatBytesForLog(freed)}，`
    + `保留期内剩余 ${remaining} 个文件，耗时 ${Date.now() - started} ms`,
  );

  return { ran: true, deleted, freed, remaining, retentionDays };
}
