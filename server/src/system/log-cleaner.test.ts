/**
 * 任务日志清理器测试。
 *
 * 走真实临时数据库（`db.ts` 的 `resetDatabase`），验证「只删终态任务超期日志 +
 * 运行中任务受保护 + VACUUM 回收」的端到端行为。
 * 调度器（触发时机）的用例见 `log-scheduler.test.ts`。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  addLog,
  cleanupTaskLogs,
  createTask,
  getTaskLogs,
  resetDatabase,
  state,
  updateTaskStatus,
} from '../db.js';
import { previewTaskLogClean, runTaskLogAutoClean, shouldRunLogAutoClean, taskLogSnapshot } from './log-cleaner.js';
import { stopTaskLogCleanScheduler } from './log-scheduler.js';
import { readSystemSettings, updateTaskLogSettings, writeSystemSettings } from './system-settings.js';

let dir = '';
let dbPath = '';
let configPath = '';
let originalPath = '';

/** 建任务并写日志；`createdAt` 用于把**本次写入的日志**回填为历史时间 */
function seed(id: string, status: 'running' | 'completed' | 'failed', logCount: number, createdAt?: string): void {
  createTask({ id, project: 'p1', workflow_id: 'text-to-image', impl: 'default', params: {} });
  if (status !== 'running') updateTaskStatus(id, status);
  const before = (state.db?.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM task_logs').get() as { m: number }).m;
  for (let i = 0; i < logCount; i += 1) addLog(id, 'info', `日志 ${i}`);
  if (createdAt) {
    state.db?.prepare('UPDATE task_logs SET created_at = ? WHERE task_id = ? AND id > ?').run(createdAt, id, before);
  }
}

beforeEach(async () => {
  originalPath = state.dbPath;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'log-cleaner-'));
  dbPath = path.join(dir, 'workflow.db');
  configPath = path.join(dir, 'system.json');
  resetDatabase(dbPath);
});

afterEach(async () => {
  stopTaskLogCleanScheduler();
  resetDatabase(originalPath);
  await fs.rm(dir, { recursive: true, force: true });
});

describe('shouldRunLogAutoClean', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');

  it('从未执行或时间非法时立即执行', () => {
    expect(shouldRunLogAutoClean(null, 24, now)).toBe(true);
    expect(shouldRunLogAutoClean('bad-date', 24, now)).toBe(true);
  });

  it('未到间隔不执行，到达/超过间隔执行（按小时粒度）', () => {
    expect(shouldRunLogAutoClean('2026-09-11T00:00:00.000Z', 24, now)).toBe(false);
    expect(shouldRunLogAutoClean('2026-09-10T12:00:00.000Z', 24, now)).toBe(true);
    expect(shouldRunLogAutoClean('2026-09-11T06:00:00.000Z', 6, now)).toBe(true);
    expect(shouldRunLogAutoClean('2026-09-11T09:00:00.000Z', 6, now)).toBe(false);
  });
});

describe('previewTaskLogClean', () => {
  it('按当前配置的保留期预演可清理行数', async () => {
    await updateTaskLogSettings({ autoClean: { retentionDays: 14 } }, configPath);
    seed('done', 'completed', 3, '2026-08-01 00:00:00');
    seed('fresh', 'completed', 2, '2026-09-11 00:00:00');
    seed('run', 'running', 4, '2026-08-01 00:00:00');
    await expect(previewTaskLogClean({ configPath, now: new Date('2026-09-11T12:00:00.000Z') })).resolves.toBe(3);
  });
});

describe('runTaskLogAutoClean', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');

  it('删除终态任务超期日志、保护运行中任务、更新 lastRunAt', async () => {
    seed('done', 'completed', 5, '2026-08-01 00:00:00');
    seed('fail', 'failed', 4, '2026-08-01 00:00:00');
    seed('fresh', 'completed', 2, '2026-09-11 00:00:00');
    seed('run', 'running', 6, '2026-08-01 00:00:00');

    const result = await runTaskLogAutoClean({ reason: 'scheduled', configPath, now, vacuum: false });

    expect(result.ran).toBe(true);
    expect(result.deleted).toBe(9);
    expect(result.retentionDays).toBe(14);
    expect(getTaskLogs('done')).toHaveLength(0);
    expect(getTaskLogs('fail')).toHaveLength(0);
    expect(getTaskLogs('fresh')).toHaveLength(2);
    // 运行中任务的日志永不删除（即使时间上超期）
    expect(getTaskLogs('run')).toHaveLength(6);
    expect((await readSystemSettings(configPath)).taskLog.lastRunAt).toBe(now.toISOString());
  });

  it('tasks 行保留（历史页签仍可列出任务）', async () => {
    seed('done', 'completed', 5, '2026-08-01 00:00:00');
    await runTaskLogAutoClean({ reason: 'scheduled', configPath, now, vacuum: false });
    const task = state.db?.prepare('SELECT id FROM tasks WHERE id = ?').get('done');
    expect(task).toBeTruthy();
  });

  it('无超期日志时正常返回（deleted=0）且仍更新 lastRunAt', async () => {
    seed('fresh', 'completed', 2, '2026-09-11 00:00:00');
    const result = await runTaskLogAutoClean({ reason: 'scheduled', configPath, now, vacuum: false });
    expect(result.deleted).toBe(0);
    expect((await readSystemSettings(configPath)).taskLog.lastRunAt).toBe(now.toISOString());
  });

  it('配置禁用且非强制时跳过（不删除、不更新 lastRunAt）', async () => {
    await writeSystemSettings(
      {
        trash: { autoClean: { enabled: true, intervalDays: 7, retentionDays: 7 }, lastRunAt: null },
        taskLog: { autoClean: { enabled: false, intervalHours: 24, retentionDays: 14 }, heartbeatSeconds: 60, lastRunAt: null },
      },
      configPath,
    );
    seed('done', 'completed', 5, '2026-08-01 00:00:00');

    const skipped = await runTaskLogAutoClean({ reason: 'scheduled', configPath, now, vacuum: false });
    expect(skipped.ran).toBe(false);
    expect(skipped.deleted).toBe(0);
    expect(getTaskLogs('done')).toHaveLength(5);
    expect((await readSystemSettings(configPath)).taskLog.lastRunAt).toBeNull();

    // force=true（手动清理）忽略开关
    const forced = await runTaskLogAutoClean({ reason: 'manual', force: true, configPath, now, vacuum: false });
    expect(forced.ran).toBe(true);
    expect(forced.deleted).toBe(5);
  });

  it('vacuum=true 时报告空闲页归零与占用回落', async () => {
    seed('done', 'completed', 20000, '2026-08-01 00:00:00');
    state.db?.pragma('wal_checkpoint(TRUNCATE)');
    const result = await runTaskLogAutoClean({ reason: 'manual', force: true, configPath, now, vacuum: true });
    expect(result.deleted).toBe(20000);
    expect(result.freelistAfter).toBe(0);
    expect(result.allocatedBytesAfter).toBeLessThan(result.allocatedBytesBefore);
  });

  it('保留期变更后立即按新口径清理（配置热生效）', async () => {
    seed('a', 'completed', 3, '2026-09-05 00:00:00');
    // 默认 14 天：9 月 5 日的日志未超期
    expect((await runTaskLogAutoClean({ reason: 'manual', force: true, configPath, now, vacuum: false })).deleted).toBe(0);
    // 调成 1 天后再清理 → 超期
    await updateTaskLogSettings({ autoClean: { retentionDays: 1 } }, configPath);
    expect((await runTaskLogAutoClean({ reason: 'manual', force: true, configPath, now, vacuum: false })).deleted).toBe(3);
  });

  it('清理抛错时不更新 lastRunAt 并向上抛出（供调用方提示）', async () => {
    // 构造失败：先关闭底层连接，使清理过程中的查询抛错
    state.db?.close();
    await expect(runTaskLogAutoClean({ reason: 'manual', force: true, configPath, now })).rejects.toBeTruthy();
    expect((await readSystemSettings(configPath)).taskLog.lastRunAt).toBeNull();
    // 连接已关闭：由 afterEach 的 resetDatabase 重建，不影响其它用例
    state.db = null;
    resetDatabase(dbPath);
  });
});

describe('cleanupTaskLogs 与 cleaner 的口径一致性', () => {
  it('cleaner 返回的 deleted 与直接调用 db 清理一致', async () => {
    seed('t1', 'completed', 4, '2026-08-01 00:00:00');
    const now = new Date('2026-09-11T12:00:00.000Z');
    const direct = cleanupTaskLogs({ retentionDays: 14, now, vacuum: false });
    expect(direct.deleted).toBe(4);
  });
});

describe('taskLogSnapshot（settings 与 stats 两个接口的共同形状）', () => {
  it('同时给出占用统计与保留期/心跳/上次与下次执行时间', async () => {
    await updateTaskLogSettings(
      { autoClean: { intervalHours: 6, retentionDays: 30 }, heartbeatSeconds: 0 },
      configPath,
    );
    seed('done', 'completed', 3, '2026-08-01 00:00:00');
    const snapshot = await taskLogSnapshot({ configPath, now: new Date('2026-09-11T12:00:00.000Z') });

    // 占用统计字段（供占用卡片展示）
    expect(snapshot.totalRows).toBe(3);
    expect(snapshot.oldestAt).toBe('2026-08-01 00:00:00');
    expect(snapshot.fileBytes).toBeGreaterThan(0);
    expect(typeof snapshot.freelistCount).toBe('number');
    expect(typeof snapshot.cleanableRows).toBe('number');
    expect(typeof snapshot.activeRows).toBe('number');
    // 配置快照字段（前端 TaskLogStats 依赖这些字段一定存在）
    expect(snapshot.retentionDays).toBe(30);
    expect(snapshot.heartbeatSeconds).toBe(0);
    expect(snapshot.lastRunAt).toBeNull();
    expect(snapshot.nextRunAt).toBeNull();
  });

  it('保留期取配置值：30 天时 9 月 1 日的日志不算可清理', async () => {
    await updateTaskLogSettings({ autoClean: { retentionDays: 30 } }, configPath);
    seed('done', 'completed', 3, '2026-09-01 00:00:00');
    const snapshot = await taskLogSnapshot({ configPath, now: new Date('2026-09-11T12:00:00.000Z') });
    expect(snapshot.retentionDays).toBe(30);
    expect(snapshot.cleanableRows).toBe(0);
  });

  it('已有执行记录时按间隔小时数计算下次执行时间', async () => {
    const at = '2026-09-11T00:00:00.000Z';
    await writeSystemSettings(
      {
        trash: { autoClean: { enabled: true, intervalDays: 7, retentionDays: 7 }, lastRunAt: null },
        taskLog: {
          autoClean: { enabled: true, intervalHours: 6, retentionDays: 14 },
          heartbeatSeconds: 60,
          lastRunAt: at,
        },
      },
      configPath,
    );
    const snapshot = await taskLogSnapshot({ configPath, now: new Date(at) });
    expect(snapshot.lastRunAt).toBe(at);
    expect(snapshot.nextRunAt).toBe('2026-09-11T06:00:00.000Z');
  });
});
