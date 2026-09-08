/**
 * 回收站自动清理调度器。
 *
 * 触发规则：
 * - 每 `CHECK_INTERVAL_MS`（默认 1 小时）轮询一次配置，判断距上次执行是否已达到
 *   配置的执行间隔（默认 7 天）——到达即执行一轮自动清理；
 * - 服务启动 `STARTUP_DELAY_MS`（默认 60 秒）后补跑一次：从未执行或已超期时立即执行
 *   （延迟启动避免与工作流引擎、目录扫描等服务启动动作争抢 I/O）；
 * - 配置**热生效**：每轮重新读取 `server/config/system.json`，修改间隔/保留期/开关
 *   无需重启服务；
 * - 进程内重入保护：上一轮未结束时跳过本轮（避免手动触发与定时触发并发删同一批文件）。
 *
 * 日志前缀统一为 `[trash-auto-clean]`，仅在「状态变化」「真正触发」「执行失败」时打印，
 * 空闲轮询不产生日志（避免每小时刷屏）。
 */
import { readSystemSettings, SYSTEM_SETTINGS_PATH } from './system-settings.js';
import { runTrashAutoClean, shouldRunAutoClean } from './trash-cleaner.js';

/** 轮询间隔：1 小时 */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** 启动后补跑延迟：60 秒 */
export const STARTUP_DELAY_MS = 60 * 1000;

/** 调度器状态（单例） */
const state: {
  checkTimer: NodeJS.Timeout | null;
  startupTimer: NodeJS.Timeout | null;
  running: boolean;
  /** 上一次观察到的启用状态（用于只在状态变化时打印日志） */
  lastEnabled: boolean | null;
} = {
  checkTimer: null,
  startupTimer: null,
  running: false,
  lastEnabled: null,
};

/**
 * 读取配置，并在「启用状态发生变化」时打印一次日志。
 *
 * @param configPath 系统设置文件路径
 * @returns 自动清理配置与上次执行时间
 */
async function readSettingsAndLogState(configPath: string): Promise<{
  enabled: boolean;
  intervalDays: number;
  retentionDays: number;
  lastRunAt: string | null;
}> {
  const settings = await readSystemSettings(configPath);
  const { enabled, intervalDays, retentionDays } = settings.trash.autoClean;
  if (state.lastEnabled !== enabled) {
    state.lastEnabled = enabled;
    if (enabled) {
      console.log(
        `[trash-auto-clean] 已启用：每 ${intervalDays} 天执行一次，回收站保留期 ${retentionDays} 天`,
      );
    } else {
      console.log('[trash-auto-clean] 已禁用（可在 系统设置 → 系统设置 → 回收站 中开启）');
    }
  }
  return { enabled, intervalDays, retentionDays, lastRunAt: settings.trash.lastRunAt };
}

/**
 * 执行一次调度检查：到期则运行自动清理。
 *
 * @param reason 触发来源（'scheduled' 轮询 / 'startup' 启动补跑）
 * @param configPath 系统设置文件路径
 */
async function tick(reason: 'scheduled' | 'startup', configPath: string): Promise<void> {
  if (state.running) {
    console.log('[trash-auto-clean] 上一轮自动清理尚未结束，跳过本轮');
    return;
  }
  state.running = true;
  try {
    const { enabled, intervalDays, lastRunAt } = await readSettingsAndLogState(configPath);
    if (!enabled) return;
    const now = new Date();
    if (!shouldRunAutoClean(lastRunAt, intervalDays, now)) return;
    if (reason === 'startup') {
      console.log(
        `[trash-auto-clean] 检测到已超期（上次执行 ${lastRunAt ?? '从未执行'}），立即补跑一次`,
      );
    }
    await runTrashAutoClean({ reason, configPath, now });
  } catch (e) {
    // 自动清理失败不影响服务运行：打印完整错误，不更新 lastRunAt（下轮自动重试）
    console.error('[trash-auto-clean] 执行失败:', e);
  } finally {
    state.running = false;
  }
}

/**
 * 启动自动清理调度器（幂等：重复调用会先停掉旧定时器）。
 *
 * @param options.configPath 系统设置文件路径（默认 SYSTEM_SETTINGS_PATH）
 * @param options.checkIntervalMs 轮询间隔（默认 1 小时；测试可注入）
 * @param options.startupDelayMs 启动补跑延迟（默认 60 秒；测试可注入）
 */
export function startTrashAutoCleanScheduler(
  options: {
    configPath?: string;
    checkIntervalMs?: number;
    startupDelayMs?: number;
  } = {},
): void {
  const configPath = options.configPath ?? SYSTEM_SETTINGS_PATH;
  const checkIntervalMs = options.checkIntervalMs ?? CHECK_INTERVAL_MS;
  const startupDelayMs = options.startupDelayMs ?? STARTUP_DELAY_MS;

  stopTrashAutoCleanScheduler();

  state.startupTimer = setTimeout(() => {
    void tick('startup', configPath);
  }, startupDelayMs);
  // 定时器不应阻止进程退出
  state.startupTimer.unref?.();

  state.checkTimer = setInterval(() => {
    void tick('scheduled', configPath);
  }, checkIntervalMs);
  state.checkTimer.unref?.();
}

/**
 * 停止自动清理调度器（服务关闭/测试收尾用）。
 */
export function stopTrashAutoCleanScheduler(): void {
  if (state.startupTimer) {
    clearTimeout(state.startupTimer);
    state.startupTimer = null;
  }
  if (state.checkTimer) {
    clearInterval(state.checkTimer);
    state.checkTimer = null;
  }
  state.lastEnabled = null;
}
