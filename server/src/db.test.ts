/**
 * 数据库层测试：任务日志读取、清理、统计与任务列表过滤分页。
 *
 * 通过 `state.dbPath` + `resetDatabase()` 指向临时库文件，避免触碰真实 `data/workflow.db`。
 * 涉及「超期」的用例直接写 SQL 回填 `created_at`（表默认值为 `datetime('now')`，无法指定历史时间）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  addLog,
  cleanupTaskLogs,
  countCleanableLogs,
  createTask,
  getLogStats,
  getRecentTaskLogs,
  getTaskLogCount,
  getTaskLogs,
  listTasks,
  purgeTaskLogs,
  resetDatabase,
  state,
  updateTaskStatus,
} from './db.js';

/** 临时目录 */
let dir = '';
/** 临时数据库路径 */
let dbPath = '';
/** 原始数据库路径（收尾恢复，避免影响其它测试文件） */
let originalPath = '';

/** 建一个任务（默认 completed，便于清理类用例） */
function seedTask(id: string, status: 'pending' | 'running' | 'completed' | 'failed' = 'completed', project = 'p1'): void {
  createTask({ id, project, workflow_id: 'text-to-image', impl: 'default', params: { outputPath: `assert/${id}.jpg` } });
  if (status !== 'pending') updateTaskStatus(id, status);
}

/** 写若干日志，并可选地把**本次写入的行**回填为指定历史时间（精确作用于新插入的行） */
function seedLogs(taskId: string, count: number, createdAt?: string): void {
  const before = (state.db?.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM task_logs').get() as { m: number }).m;
  for (let i = 0; i < count; i += 1) addLog(taskId, 'info', `第 ${i} 条日志`);
  if (createdAt) {
    state.db?.prepare('UPDATE task_logs SET created_at = ? WHERE task_id = ? AND id > ?').run(createdAt, taskId, before);
  }
}

beforeEach(async () => {
  originalPath = state.dbPath;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-logs-'));
  dbPath = path.join(dir, 'workflow.db');
  resetDatabase(dbPath);
});

afterEach(async () => {
  resetDatabase(originalPath);
  await fs.rm(dir, { recursive: true, force: true });
});

describe('getRecentTaskLogs / getTaskLogCount', () => {
  it('limit=N 返回最后 N 条并按写入顺序正序', () => {
    seedTask('t1');
    seedLogs('t1', 10);
    const logs = getRecentTaskLogs('t1', 3);
    expect(logs.map(l => l.message)).toEqual(['第 7 条日志', '第 8 条日志', '第 9 条日志']);
    expect(logs.map(l => l.id)).toEqual([...logs.map(l => l.id)].sort((a, b) => a - b));
  });

  it('limit=1 只取最后一条（画布轮询路径）', () => {
    seedTask('t1');
    seedLogs('t1', 500);
    const logs = getRecentTaskLogs('t1', 1);
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('第 499 条日志');
    expect(getTaskLogCount('t1')).toBe(500);
  });

  it('limit<=0 或非整数时退化为全量', () => {
    seedTask('t1');
    seedLogs('t1', 4);
    expect(getRecentTaskLogs('t1', 0)).toEqual(getTaskLogs('t1'));
    expect(getRecentTaskLogs('t1', -1)).toEqual(getTaskLogs('t1'));
    expect(getRecentTaskLogs('t1', 1.5)).toEqual(getTaskLogs('t1'));
  });

  it('无日志的任务返回空数组且计数为 0', () => {
    seedTask('t1');
    expect(getRecentTaskLogs('t1', 5)).toEqual([]);
    expect(getTaskLogCount('t1')).toBe(0);
  });
});

describe('countCleanableLogs / cleanupTaskLogs', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');
  /** 保留期 14 天 → 截止 2026-08-28T12:00:00Z */
  const old = '2026-08-01 00:00:00';
  const fresh = '2026-09-11 00:00:00';

  it('只统计「已终态 + 超期」的日志行', () => {
    seedTask('done', 'completed');
    seedTask('fail', 'failed');
    seedTask('run', 'running');
    seedLogs('done', 3, old);
    seedLogs('fail', 2, old);
    seedLogs('run', 4, old);
    seedLogs('done', 1, fresh);
    expect(countCleanableLogs(14, now)).toBe(5);
  });

  it('删除超期终态日志，保留运行中任务日志与未超期日志', () => {
    seedTask('done', 'completed');
    seedTask('run', 'running');
    seedLogs('done', 3, old);
    seedLogs('done', 2, fresh);
    seedLogs('run', 4, old);

    const result = cleanupTaskLogs({ retentionDays: 14, now, vacuum: false });
    expect(result.deleted).toBe(3);
    expect(result.cutoff).toBe('2026-08-28T12:00:00.000Z');
    expect(getTaskLogCount('done')).toBe(2);
    // 运行中任务的日志一条不删（即使时间上「超期」）
    expect(getTaskLogCount('run')).toBe(4);
  });

  it('任务行本身不受影响（历史列表仍可展示终态与错误摘要）', () => {
    seedTask('done', 'completed');
    seedLogs('done', 3, old);
    cleanupTaskLogs({ retentionDays: 14, now, vacuum: false });
    const task = state.db?.prepare('SELECT id, status FROM tasks WHERE id = ?').get('done') as { id: string; status: string };
    expect(task).toEqual({ id: 'done', status: 'completed' });
  });

  it('截止时间边界：早于截止时间删除，等于/晚于保留', () => {
    seedTask('t1', 'completed');
    seedLogs('t1', 1, '2026-08-28 11:59:59');
    seedLogs('t1', 1, '2026-08-28 12:00:00');
    cleanupTaskLogs({ retentionDays: 14, now, vacuum: false });
    const kept = getTaskLogs('t1').map(l => l.created_at);
    expect(kept).toEqual(['2026-08-28 12:00:00']);
  });

  it('无超期日志时不删除、文件占用前后一致', () => {
    seedTask('t1', 'completed');
    seedLogs('t1', 3, fresh);
    const result = cleanupTaskLogs({ retentionDays: 14, now, vacuum: false });
    expect(result.deleted).toBe(0);
    expect(result.fileBytesAfter).toBe(result.fileBytesBefore);
    expect(getTaskLogCount('t1')).toBe(3);
  });

  it('分批删除超过单批上限的量（5000 行一批）', () => {
    seedTask('t1', 'completed');
    seedLogs('t1', 11000, old);
    const result = cleanupTaskLogs({ retentionDays: 14, now, vacuum: false });
    expect(result.deleted).toBe(11000);
    expect(getTaskLogCount('t1')).toBe(0);
  });

  it('vacuum=true 时回收空间（已分配页回落、空闲页归零）', () => {
    seedTask('t1', 'completed');
    seedLogs('t1', 20000, old);
    // 先 checkpoint，让「删除前」的占用不含 WAL 中尚未并回的页
    state.db?.pragma('wal_checkpoint(TRUNCATE)');
    const before = state.db?.pragma('page_count', { simple: true }) as number;
    const result = cleanupTaskLogs({ retentionDays: 14, now, vacuum: true });
    expect(result.deleted).toBe(20000);
    // VACUUM：空闲页归零，已分配页从高水位回落到实际数据量
    expect(result.freelistAfter).toBe(0);
    expect(result.allocatedBytesAfter).toBeLessThan(result.allocatedBytesBefore);
    expect(state.db?.pragma('page_count', { simple: true })).toBeLessThan(before);
  });

  it('vacuum=false 时空间不回收（空闲页保留，供后续复用）', () => {
    seedTask('t1', 'completed');
    seedLogs('t1', 20000, old);
    state.db?.pragma('wal_checkpoint(TRUNCATE)');
    const result = cleanupTaskLogs({ retentionDays: 14, now, vacuum: false });
    expect(result.deleted).toBe(20000);
    // 删除只是把页放进空闲链表：文件高水位不变、空闲页 > 0
    expect(result.freelistAfter).toBeGreaterThan(0);
    expect(result.allocatedBytesAfter).toBe(result.allocatedBytesBefore);
  });
});

describe('purgeTaskLogs', () => {
  it('清空全部终态任务日志，运行中任务日志保留', () => {
    seedTask('done', 'completed');
    seedTask('fail', 'failed');
    seedTask('run', 'running');
    seedLogs('done', 5, '2026-09-11 00:00:00');
    seedLogs('fail', 4, '2026-09-11 00:00:00');
    seedLogs('run', 3, '2026-09-11 00:00:00');

    const result = purgeTaskLogs({ vacuum: false });
    expect(result.deleted).toBe(9);
    expect(getTaskLogCount('done')).toBe(0);
    expect(getTaskLogCount('fail')).toBe(0);
    expect(getTaskLogCount('run')).toBe(3);
  });
});

describe('getLogStats', () => {
  it('返回总行数、最早时间、可清理行数与活跃行数', () => {
    seedTask('done', 'completed');
    seedTask('run', 'running');
    seedLogs('done', 4, '2026-08-01 00:00:00');
    seedLogs('run', 2, '2026-09-11 00:00:00');
    const stats = getLogStats(14, new Date('2026-09-11T12:00:00.000Z'));
    expect(stats.totalRows).toBe(6);
    expect(stats.oldestAt).toBe('2026-08-01 00:00:00');
    expect(stats.cleanableRows).toBe(4);
    expect(stats.activeRows).toBe(2);
    expect(stats.fileBytes).toBeGreaterThan(0);
    // dbstat 可用时占用为正（SQLite 编译含 dbstat 模块）
    expect(stats.tableBytes).toBeGreaterThan(0);
  });

  it('空库返回零值且不抛错', () => {
    const stats = getLogStats(14);
    expect(stats.totalRows).toBe(0);
    expect(stats.oldestAt).toBeNull();
    expect(stats.cleanableRows).toBe(0);
  });
});

describe('listTasks（过滤与分页）', () => {
  it('不传任何选项时返回全部（倒序）与总数', () => {
    seedTask('a', 'completed', 'p1');
    seedTask('b', 'failed', 'p2');
    const { tasks, total } = listTasks();
    expect(total).toBe(2);
    expect(tasks).toHaveLength(2);
  });

  it('project / status / batchId 过滤仍与既有语义一致', () => {
    seedTask('a', 'completed', 'p1');
    seedTask('b', 'failed', 'p2');
    expect(listTasks({ project: 'p1' }).tasks.map(t => t.id)).toEqual(['a']);
    expect(listTasks({ status: 'failed' }).tasks.map(t => t.id)).toEqual(['b']);
    expect(listTasks({ project: 'p1', status: 'failed' }).total).toBe(0);
  });

  it('since / until 按创建时间过滤（ISO 串经 datetime(utc) 归一化）', () => {
    seedTask('old', 'completed');
    state.db?.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run('2026-08-01 00:00:00', 'old');
    seedTask('new', 'completed');
    state.db?.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run('2026-09-11 00:00:00', 'new');

    expect(listTasks({ since: '2026-09-01T00:00:00.000Z' }).tasks.map(t => t.id)).toEqual(['new']);
    expect(listTasks({ until: '2026-09-01T00:00:00.000Z' }).tasks.map(t => t.id)).toEqual(['old']);
    expect(listTasks({ since: '2026-08-01T00:00:00.000Z', until: '2026-09-11T00:00:00.000Z' }).total).toBe(2);
    // 日期形态（YYYY-MM-DD）同样可用
    expect(listTasks({ since: '2026-09-01' }).tasks.map(t => t.id)).toEqual(['new']);
  });

  it('limit / offset 分页且 total 不受分页影响', () => {
    for (let i = 0; i < 5; i += 1) {
      seedTask(`t${i}`, 'completed');
      state.db?.prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run(`2026-09-0${i + 1} 00:00:00`, `t${i}`);
    }
    const page1 = listTasks({ limit: 2, offset: 0 });
    const page2 = listTasks({ limit: 2, offset: 2 });
    expect(page1.total).toBe(5);
    expect(page1.tasks.map(t => t.id)).toEqual(['t4', 't3']);
    expect(page2.tasks.map(t => t.id)).toEqual(['t2', 't1']);
    // 非法分页参数容错为「不分页」
    expect(listTasks({ limit: 0 }).tasks).toHaveLength(5);
    expect(listTasks({ limit: 2, offset: -1 }).tasks.map(t => t.id)).toEqual(['t4', 't3']);
  });
});
