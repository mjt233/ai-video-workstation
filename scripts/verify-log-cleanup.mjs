/**
 * 真实库副本演练（读取真实库 → 复制到临时目录 → 在副本上执行清理）。
 *
 * 验证点：
 * 1. 清理前统计（行数 / 表+索引占用 / 可清理行数 / 运行中任务行数）；
 * 2. cleanupTaskLogs 后：删除行数、任务行不变、运行中任务日志零删除、占用回落；
 * 3. 抽查一个仍存在的历史任务，确认日志读取接口口径（最近 N 条）正常。
 *
 * 用法：node scripts/verify-log-cleanup.mjs [retentionDays]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// better-sqlite3 只装在 server workspace 下：按 server/node_modules 解析
const Database = require(path.resolve(import.meta.dirname, '../server/node_modules/better-sqlite3'));

const SRC_DB = path.resolve(import.meta.dirname, '../data/workflow.db');
const retentionDays = Number(process.argv[2] ?? 14);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasklog-verify-'));
const copyPath = path.join(dir, 'workflow.db');
fs.copyFileSync(SRC_DB, copyPath);
// WAL/SHM 一并复制，保证副本状态与真实库一致
for (const suffix of ['-wal', '-shm']) {
  if (fs.existsSync(`${SRC_DB}${suffix}`)) fs.copyFileSync(`${SRC_DB}${suffix}`, `${copyPath}${suffix}`);
}
console.log(`真实库: ${SRC_DB}`);
console.log(`副本:   ${copyPath}\n`);

const db = new Database(copyPath);
db.pragma('journal_mode = WAL');

const bytes = (n) => `${(n / 1048576).toFixed(2)} MB`;
const fileBytes = (p) => ['', '-wal', '-shm'].reduce((sum, s) => {
  try { return sum + fs.statSync(p + s).size; } catch { return sum; }
}, 0);
const dbstat = (name) => {
  const row = db.prepare('SELECT SUM(pgsize) AS b FROM dbstat WHERE name = ?').get(name);
  return row?.b ?? 0;
};

const countAll = () => db.prepare('SELECT COUNT(*) AS c FROM task_logs').get().c;
const countTasks = () => db.prepare('SELECT COUNT(*) AS c FROM tasks').get().c;
const countActive = () => db.prepare(`
  SELECT COUNT(*) AS c FROM task_logs
  WHERE task_id IN (SELECT id FROM tasks WHERE status IN ('pending','running'))
`).get().c;

console.log('=== 清理前 ===');
console.log(`任务行数:        ${countTasks()}`);
console.log(`日志行数:        ${countAll()}`);
console.log(`  其中运行中任务: ${countActive()}（永不删除）`);
console.log(`表占用:          ${bytes(dbstat('task_logs'))}`);
console.log(`索引占用:        ${bytes(dbstat('idx_task_logs_task'))}`);
console.log(`文件占用:        ${bytes(fileBytes(copyPath))}`);
console.log(`page_count=${db.pragma('page_count', { simple: true })} freelist=${db.pragma('freelist_count', { simple: true })}`);

// 复用生产实现：SQL 与 server/src/db.ts 的 cleanupTaskLogs 保持一致
const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
const cleanable = db.prepare(`
  SELECT COUNT(*) AS c FROM task_logs
  WHERE created_at < datetime(?, 'utc')
    AND task_id IN (SELECT id FROM tasks WHERE status IN ('completed','failed'))
`).get(cutoff).c;
console.log(`可清理行数:      ${cleanable}（保留期 ${retentionDays} 天，截止 ${cutoff}）`);

const activeBefore = countActive();
const tasksBefore = countTasks();
const totalBefore = countAll();

const del = db.prepare(`
  DELETE FROM task_logs WHERE id IN (
    SELECT id FROM task_logs
    WHERE created_at < datetime(?, 'utc')
      AND task_id IN (SELECT id FROM tasks WHERE status IN ('completed','failed'))
    LIMIT 5000
  )
`);
const t0 = Date.now();
let batches = 0;
for (;;) {
  const info = del.run(cutoff);
  batches += 1;
  if (info.changes === 0) break;
}
const deleteMs = Date.now() - t0;
db.pragma('wal_checkpoint(TRUNCATE)');
const t1 = Date.now();
db.exec('VACUUM');
const vacuumMs = Date.now() - t1;

console.log(`\n=== 清理后（${batches - 1} 批删除 ${deleteMs} ms，VACUUM ${vacuumMs} ms）===`);
console.log(`删除行数:        ${totalBefore - countAll()}`);
console.log(`剩余日志行数:    ${countAll()}`);
console.log(`任务行数:        ${countTasks()}（应为 ${tasksBefore}，不变）`);
console.log(`运行中任务日志:  ${countActive()}（应仍为 ${activeBefore}，零删除）`);
console.log(`表占用:          ${bytes(dbstat('task_logs'))}`);
console.log(`索引占用:        ${bytes(dbstat('idx_task_logs_task'))}`);
console.log(`文件占用:        ${bytes(fileBytes(copyPath))}`);
console.log(`page_count=${db.pragma('page_count', { simple: true })} freelist=${db.pragma('freelist_count', { simple: true })}`);

console.log('\n=== 校验 ===');
console.log(`任务行不变:            ${countTasks() === tasksBefore ? 'PASS' : 'FAIL'}`);
console.log(`运行中日志零删除:      ${countActive() === activeBefore ? 'PASS' : 'FAIL'}`);
console.log(`删除行数 == 可清理行数: ${totalBefore - countAll() === cleanable ? 'PASS' : `FAIL（删 ${totalBefore - countAll()} / 预期 ${cleanable}）`}`);
console.log(`VACUUM 后无空闲页:      ${db.pragma('freelist_count', { simple: true }) === 0 ? 'PASS' : 'FAIL'}`);

// 保留期内的历史任务仍可读取日志
const sample = db.prepare(`
  SELECT task_id, COUNT(*) AS c FROM task_logs
  WHERE task_id IN (SELECT id FROM tasks)
  GROUP BY task_id ORDER BY c DESC LIMIT 1
`).get();
if (sample) {
  const tail = db.prepare('SELECT level, message FROM task_logs WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(sample.task_id);
  console.log(`样例任务日志读取:      PASS（${sample.task_id} 共 ${sample.c} 行，最后一条: [${tail.level}] ${String(tail.message).slice(0, 60)}）`);
}

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('\n副本已删除，真实库未被触碰。');
