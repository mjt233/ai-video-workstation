/**
 * 系统设置存储（系统配置 → 系统设置页签）。
 *
 * 系统级属性（不区分项目）统一落盘为 `server/config/system.json`，按**子类**分组，
 * 当前包含「回收站」子类：
 * ```jsonc
 * {
 *   "trash": {
 *     "autoClean": { "enabled": true, "intervalDays": 7, "retentionDays": 7 },
 *     "lastRunAt": "2026-08-20T10:00:00.000Z"
 *   }
 * }
 * ```
 *
 * 约定：
 * - 文件缺失 / 字段缺失 → 逐字段回退默认值（`DEFAULT_SYSTEM_SETTINGS`）；
 * - 文件 JSON 损坏 → 打印日志并整体回退默认值（不抛错，避免单个坏文件导致系统设置页打不开）；
 * - 写入使用「临时文件 + rename」原子落盘，避免写坏半截；
 * - `lastRunAt` 由服务端（自动清理调度器）维护，前端不可写。
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 系统设置配置文件路径：server/config/system.json */
export const SYSTEM_SETTINGS_PATH = path.resolve(__dirname, '../../config/system.json');

/** 天数类配置的合法范围（1 天 ~ 10 年） */
export const DAYS_MIN = 1;
export const DAYS_MAX = 3650;

/** 回收站自动清理配置 */
export interface TrashAutoCleanSettings {
  /** 是否启用定时自动清理（默认 true） */
  enabled: boolean;
  /** 执行间隔（天，默认 7）：距上次执行达到该间隔即触发一轮 */
  intervalDays: number;
  /** 回收站保留期（天，默认 7）：移入回收站超过该天数的条目会被彻底删除 */
  retentionDays: number;
}

/** 回收站子类设置 */
export interface TrashSettings {
  autoClean: TrashAutoCleanSettings;
  /** 上次自动清理执行时间（ISO 字符串；从未执行为 null，由服务端写入） */
  lastRunAt: string | null;
}

/** 系统设置整体结构（按子类分组，后续新增子类在此扩展） */
export interface SystemSettings {
  trash: TrashSettings;
}

/** 系统设置默认值（配置文件缺失/字段缺失时的回退值） */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  trash: {
    autoClean: { enabled: true, intervalDays: 7, retentionDays: 7 },
    lastRunAt: null,
  },
};

/** 自动清理配置的可写字段（PUT 局部更新用） */
export interface TrashAutoCleanPatch {
  enabled?: boolean;
  intervalDays?: number;
  retentionDays?: number;
}

/**
 * 校验并规范化天数类配置。
 *
 * @param label 字段中文标签（用于报错）
 * @param value 前端提交的原始值
 * @returns 规范化后的正整数天数
 * @throws code=INVALID 非整数或超出 [1, 3650]
 */
export function normalizeDays(label: string, value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < DAYS_MIN || n > DAYS_MAX) {
    throw Object.assign(
      new Error(`${label}必须是 ${DAYS_MIN}~${DAYS_MAX} 之间的整数（天）`),
      { code: 'INVALID' },
    );
  }
  return n;
}

/**
 * 把配置文件中的任意值规范为自动清理配置（逐字段回退默认值）。
 *
 * @param raw 配置文件中 `trash.autoClean` 的原始值
 * @returns 规范化后的自动清理配置
 */
function normalizeAutoClean(raw: unknown): TrashAutoCleanSettings {
  const fallback = DEFAULT_SYSTEM_SETTINGS.trash.autoClean;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...fallback };
  const data = raw as Record<string, unknown>;
  const enabled = typeof data.enabled === 'boolean' ? data.enabled : fallback.enabled;
  const interval = Number(data.intervalDays);
  const retention = Number(data.retentionDays);
  return {
    enabled,
    intervalDays: Number.isInteger(interval) && interval >= DAYS_MIN && interval <= DAYS_MAX
      ? interval
      : fallback.intervalDays,
    retentionDays: Number.isInteger(retention) && retention >= DAYS_MIN && retention <= DAYS_MAX
      ? retention
      : fallback.retentionDays,
  };
}

/**
 * 把配置文件内容规范为完整的系统设置（逐字段回退默认值）。
 *
 * @param raw 配置文件解析后的任意值
 * @returns 规范化后的系统设置
 */
export function normalizeSystemSettings(raw: unknown): SystemSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return structuredClone(DEFAULT_SYSTEM_SETTINGS);
  }
  const data = raw as Record<string, unknown>;
  const trashRaw = data.trash;
  const trash = trashRaw && typeof trashRaw === 'object' && !Array.isArray(trashRaw)
    ? (trashRaw as Record<string, unknown>)
    : {};
  const lastRunAt = typeof trash.lastRunAt === 'string' && trash.lastRunAt ? trash.lastRunAt : null;
  return {
    trash: {
      autoClean: normalizeAutoClean(trash.autoClean),
      lastRunAt,
    },
  };
}

/**
 * 读取系统设置。
 *
 * 文件不存在或内容损坏时回退默认值：系统设置属于「读失败也要能用」的配置，
 * 损坏时打印日志（不静默）并返回默认值，避免系统设置页整体打不开。
 *
 * @param configPath 配置文件路径（默认 SYSTEM_SETTINGS_PATH；测试可注入临时路径）
 * @returns 规范化后的系统设置
 */
export async function readSystemSettings(configPath: string = SYSTEM_SETTINGS_PATH): Promise<SystemSettings> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      // 尚未创建配置文件：使用默认值（首次保存时才落盘）
      return structuredClone(DEFAULT_SYSTEM_SETTINGS);
    }
    console.error('[system-settings] 读取系统设置失败，回退默认值:', e);
    return structuredClone(DEFAULT_SYSTEM_SETTINGS);
  }
  try {
    return normalizeSystemSettings(JSON.parse(raw) as unknown);
  } catch (e) {
    // JSON 损坏：打印并回退默认值（保存时会整体覆写为合法 JSON）
    console.error('[system-settings] 系统设置文件解析失败，回退默认值:', e);
    return structuredClone(DEFAULT_SYSTEM_SETTINGS);
  }
}

/**
 * 原子写入系统设置（先写临时文件再 rename）。
 *
 * @param settings 待写入的完整设置
 * @param configPath 配置文件路径
 */
export async function writeSystemSettings(
  settings: SystemSettings,
  configPath: string = SYSTEM_SETTINGS_PATH,
): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, configPath);
}

/**
 * 局部更新「回收站 → 自动清理」配置（未传字段保持原值）。
 *
 * @param patch 可部分更新的字段（enabled / intervalDays / retentionDays）
 * @param configPath 配置文件路径（默认 SYSTEM_SETTINGS_PATH）
 * @returns 更新后的回收站设置
 * @throws code=INVALID 天数非法或 enabled 非布尔
 */
export async function updateTrashAutoClean(
  patch: TrashAutoCleanPatch,
  configPath: string = SYSTEM_SETTINGS_PATH,
): Promise<TrashSettings> {
  const settings = await readSystemSettings(configPath);
  const next: TrashAutoCleanSettings = { ...settings.trash.autoClean };
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') {
      throw Object.assign(new Error('enabled 必须是布尔值'), { code: 'INVALID' });
    }
    next.enabled = patch.enabled;
  }
  if (patch.intervalDays !== undefined) {
    next.intervalDays = normalizeDays('执行间隔', patch.intervalDays);
  }
  if (patch.retentionDays !== undefined) {
    next.retentionDays = normalizeDays('保留期', patch.retentionDays);
  }
  settings.trash.autoClean = next;
  await writeSystemSettings(settings, configPath);
  return settings.trash;
}

/**
 * 记录自动清理执行时间（服务端内部调用）。
 *
 * @param at 执行时间（ISO 字符串）
 * @param configPath 配置文件路径（默认 SYSTEM_SETTINGS_PATH）
 * @returns 更新后的回收站设置
 */
export async function markTrashAutoCleanRun(
  at: string,
  configPath: string = SYSTEM_SETTINGS_PATH,
): Promise<TrashSettings> {
  const settings = await readSystemSettings(configPath);
  settings.trash.lastRunAt = at;
  await writeSystemSettings(settings, configPath);
  return settings.trash;
}

/**
 * 计算下次自动清理时间。
 *
 * @param lastRunAt 上次执行时间（ISO 字符串；null 表示从未执行）
 * @param intervalDays 执行间隔（天）
 * @returns 下次执行时间（ISO 字符串）；从未执行时返回 null（表示「应立即执行」）
 */
export function computeNextRunAt(lastRunAt: string | null, intervalDays: number): string | null {
  if (!lastRunAt) return null;
  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last)) return null;
  return new Date(last + intervalDays * 24 * 60 * 60 * 1000).toISOString();
}
