/**
 * 任务日志清理调度器测试。
 *
 * 单独成文件的原因：本文件对 `log-cleaner` 的 `runTaskLogAutoClean` 取模块级 mock
 * （只验证调度时机与重入/停止语义，不重复验证清理逻辑），而 mock 会作用于同模块注册表内
 * 所有导入方——清理逻辑本身的用例见 `log-cleaner.test.ts`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isTaskLogCleanRunning,
  startTaskLogCleanScheduler,
  stopTaskLogCleanScheduler,
} from './log-scheduler.js';
import { writeSystemSettings, type SystemSettings } from './system-settings.js';

/** 清理器替身：只关心被调用的时机与参数（reason/force），不重复验证清理逻辑 */
const mockRunClean = vi.hoisted(() =>
  vi.fn(async (_options?: { reason?: string; force?: boolean }) => ({ ran: true, deleted: 0 })),
);
vi.mock('./log-cleaner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./log-cleaner.js')>();
  return { ...actual, runTaskLogAutoClean: mockRunClean };
});

let dir = '';
let configPath = '';

/**
 * 写入系统设置（只关心任务日志子类的开关/间隔/上次执行时间）。
 *
 * @param taskLog 任务日志子类配置
 */
async function writeSettings(taskLog: Partial<SystemSettings['taskLog']>): Promise<void> {
  await writeSystemSettings(
    {
      trash: { autoClean: { enabled: true, intervalDays: 7, retentionDays: 7 }, lastRunAt: null },
      taskLog: {
        autoClean: { enabled: true, intervalHours: 24, retentionDays: 14 },
        heartbeatSeconds: 60,
        lastRunAt: null,
        ...taskLog,
      },
    },
    configPath,
  );
}

/** 等待真实定时器触发（调度器启动补跑） */
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'log-scheduler-'));
  configPath = path.join(dir, 'system.json');
  mockRunClean.mockClear();
});

afterEach(async () => {
  stopTaskLogCleanScheduler();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('任务日志清理调度器', () => {
  it('启动补跑到期时调用清理（reason=startup）', async () => {
    await writeSettings({ lastRunAt: '2026-01-01T00:00:00.000Z' });
    startTaskLogCleanScheduler({ configPath, startupDelayMs: 60, checkIntervalMs: 3_600_000 });
    await wait(400);
    expect(mockRunClean).toHaveBeenCalledTimes(1);
    expect(mockRunClean.mock.calls[0][0]).toMatchObject({ reason: 'startup' });
  });

  it('上次执行未超过间隔时不调用清理', async () => {
    await writeSettings({ lastRunAt: new Date().toISOString() });
    startTaskLogCleanScheduler({ configPath, startupDelayMs: 60, checkIntervalMs: 3_600_000 });
    await wait(400);
    expect(mockRunClean).not.toHaveBeenCalled();
  });

  it('从未执行时启动补跑立即执行', async () => {
    await writeSettings({ lastRunAt: null });
    startTaskLogCleanScheduler({ configPath, startupDelayMs: 60, checkIntervalMs: 3_600_000 });
    await wait(400);
    expect(mockRunClean).toHaveBeenCalledTimes(1);
  });

  it('配置禁用时不调用清理', async () => {
    await writeSettings({ autoClean: { enabled: false, intervalHours: 24, retentionDays: 14 }, lastRunAt: '2026-01-01T00:00:00.000Z' });
    startTaskLogCleanScheduler({ configPath, startupDelayMs: 60, checkIntervalMs: 3_600_000 });
    await wait(400);
    expect(mockRunClean).not.toHaveBeenCalled();
  });

  it('定时轮询按间隔触发（checkInterval 到点后再次执行）', async () => {
    await writeSettings({ lastRunAt: '2026-01-01T00:00:00.000Z' });
    startTaskLogCleanScheduler({ configPath, startupDelayMs: 50, checkIntervalMs: 120 });
    await wait(500);
    // 启动补跑 1 次 + 轮询至少 1 次
    expect(mockRunClean.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockRunClean.mock.calls.some((c) => c[0]?.reason === 'scheduled')).toBe(true);
  });

  it('stop 后不再触发，且重入标志复位', async () => {
    startTaskLogCleanScheduler({ configPath, startupDelayMs: 60, checkIntervalMs: 3_600_000 });
    stopTaskLogCleanScheduler();
    await wait(300);
    expect(mockRunClean).not.toHaveBeenCalled();
    expect(isTaskLogCleanRunning()).toBe(false);
  });

  it('重复 start 幂等（不会出现双份定时器）', async () => {
    await writeSettings({ lastRunAt: '2026-01-01T00:00:00.000Z' });
    startTaskLogCleanScheduler({ configPath, startupDelayMs: 60, checkIntervalMs: 3_600_000 });
    startTaskLogCleanScheduler({ configPath, startupDelayMs: 60, checkIntervalMs: 3_600_000 });
    await wait(400);
    // 旧定时器已被停掉：只应执行一次
    expect(mockRunClean).toHaveBeenCalledTimes(1);
  });

  it('清理抛错时不抛出到定时器外（失败仅打日志）', async () => {
    await writeSettings({ lastRunAt: '2026-01-01T00:00:00.000Z' });
    mockRunClean.mockRejectedValueOnce(new Error('清理失败'));
    startTaskLogCleanScheduler({ configPath, startupDelayMs: 60, checkIntervalMs: 3_600_000 });
    await wait(400);
    expect(mockRunClean).toHaveBeenCalledTimes(1);
    // 失败后重入标志已复位，不影响后续轮次
    expect(isTaskLogCleanRunning()).toBe(false);
  });
});
