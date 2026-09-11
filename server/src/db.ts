import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 数据库模块状态（测试可注入临时库路径后调用 `resetDatabase()`）。
 *
 * 生产环境使用默认路径 `data/workflow.db`；测试通过 `state.dbPath` 指向临时文件，
 * 避免污染真实库。
 */
export const state: { dbPath: string; db: Database.Database | null } = {
  dbPath: path.resolve(__dirname, '../../data/workflow.db'),
  db: null,
};

/** 建表 DDL（初始化与测试重置共用） */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    project      TEXT NOT NULL,
    workflow_id  TEXT NOT NULL,
    impl         TEXT NOT NULL DEFAULT 'default',
    status       TEXT NOT NULL DEFAULT 'pending',
    params       TEXT NOT NULL,
    result       TEXT,
    error_msg    TEXT,
    retry_count  INTEGER DEFAULT 0,
    max_retries  INTEGER DEFAULT 3,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS task_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT NOT NULL REFERENCES tasks(id),
    level      TEXT NOT NULL DEFAULT 'info',
    message    TEXT NOT NULL,
    metadata   TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id);
`;

/**
 * 建立数据库连接（按 `state.dbPath`）并初始化 schema 与迁移。
 *
 * 幂等：已连接时直接复用；需要换库（测试）时先 `resetDatabase()`。
 *
 * @returns better-sqlite3 数据库实例
 */
function openDatabase(): Database.Database {
  const dbPath = state.dbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const instance = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  instance.pragma('journal_mode = WAL');

  // Initialize schema
  instance.exec(SCHEMA_SQL);

  // Migration: add batch_id column
  try {
    instance.exec(`ALTER TABLE tasks ADD COLUMN batch_id TEXT;`);
  } catch {
    // Column already exists, ignore
  }
  instance.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_batch ON tasks(batch_id);`);

  // Migration: add phase column（批量任务执行阶段；历史库可能缺失）
  try {
    instance.exec(`ALTER TABLE tasks ADD COLUMN phase INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // Column already exists, ignore
  }

  state.db = instance;
  return instance;
}

/**
 * 关闭并按当前 `state.dbPath` 重建连接（测试注入临时库路径用）。
 *
 * @param dbPath 可选的数据库路径（省略时沿用当前 `state.dbPath`）
 */
export function resetDatabase(dbPath?: string): void {
  if (state.db) {
    try {
      state.db.close();
    } catch (e) {
      // 关闭失败（重复关闭/句柄已释放）不影响后续重建：打印后继续
      console.error('[db] 关闭数据库连接失败:', e);
    }
    state.db = null;
  }
  if (dbPath) state.dbPath = dbPath;
  openDatabase();
}

/**
 * 当前数据库连接（按需惰性建立）。
 *
 * @returns better-sqlite3 数据库实例
 */
function conn(): Database.Database {
  return state.db ?? openDatabase();
}

export default new Proxy({} as Database.Database, {
  get(_target, prop) {
    const db = conn();
    const value = Reflect.get(db, prop) as unknown;
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(db) : value;
  },
});

export interface TaskRecord {
  id: string;
  project: string;
  workflow_id: string;
  impl: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  params: string;
  result: string | null;
  error_msg: string | null;
  retry_count: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  batch_id: string | null;
  phase: number;
}

/**
 * 日志条目（任务日志读取结果）。
 *
 * `id` 为自增主键，供前端列表稳定 key 与「按 id 增量拉取」使用。
 */
export interface LogEntry {
  id: number;
  level: string;
  message: string;
  metadata?: string;
  created_at: string;
}

export function createTask(task: {
  id: string;
  project: string;
  workflow_id: string;
  impl: string;
  params: object;
  batch_id?: string;
  phase?: number;
}): void {
  const stmt = conn().prepare(`
    INSERT INTO tasks (id, project, workflow_id, impl, params, batch_id, phase)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(task.id, task.project, task.workflow_id, task.impl, JSON.stringify(task.params), task.batch_id ?? null, task.phase ?? 0);
}

export function getTask(id: string): TaskRecord | undefined {
  return conn().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRecord | undefined;
}

export function updateTaskStatus(
  id: string,
  status: TaskRecord['status'],
  extra?: { result?: object; error_msg?: string }
): void {
  const sets = ["status = ?", "updated_at = datetime('now')"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [status];
  if (extra?.result) { sets.push('result = ?'); values.push(JSON.stringify(extra.result)); }
  if (extra?.error_msg) { sets.push('error_msg = ?'); values.push(extra.error_msg); }
  if (status === 'completed' || status === 'failed') {
    sets.push("completed_at = datetime('now')");
  }
  values.push(id);
  conn().prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

/** 任务列表查询选项（全部可选；省略时与历史行为一致） */
export interface ListTasksOptions {
  /** 项目名过滤 */
  project?: string;
  /** 状态过滤（pending / running / completed / failed） */
  status?: string;
  /** 批次 id 过滤 */
  batchId?: string;
  /** 创建时间下界（ISO 字符串或 `YYYY-MM-DD`；含） */
  since?: string;
  /** 创建时间上界（ISO 字符串或 `YYYY-MM-DD`；含） */
  until?: string;
  /** 分页大小（缺省 = 不分页，返回全部） */
  limit?: number;
  /** 分页偏移（仅 limit 生效时有意义） */
  offset?: number;
}

/** 任务列表查询结果（含分页元信息） */
export interface ListTasksResult {
  /** 当前页任务（按创建时间倒序） */
  tasks: TaskRecord[];
  /** 满足条件的任务总数（不受 limit/offset 影响） */
  total: number;
}

/**
 * 查询任务列表（支持项目/状态/批次/时间范围过滤与分页）。
 *
 * **时间比较**：`tasks.created_at` 由 SQLite `datetime('now')` 写入，形如
 * `2026-09-11 04:30:15`（UTC、无毫秒）；传入的 ISO 串必须经 `datetime(?, 'utc')`
 * 归一化后再比较，否则字符串直比会得到错误结果。
 *
 * @param options 过滤与分页选项（全部可选；`project`/`status`/`batchId` 兼容既有调用）
 * @returns 当前页任务与总数
 */
export function listTasks(options: ListTasksOptions = {}): ListTasksResult {
  const conditions: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [];
  if (options.project) { conditions.push('project = ?'); values.push(options.project); }
  if (options.status) { conditions.push('status = ?'); values.push(options.status); }
  if (options.batchId) { conditions.push('batch_id = ?'); values.push(options.batchId); }
  if (options.since) { conditions.push("created_at >= datetime(?, 'utc')"); values.push(options.since); }
  if (options.until) { conditions.push("created_at <= datetime(?, 'utc')"); values.push(options.until); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (conn().prepare(`SELECT COUNT(*) AS c FROM tasks ${where}`).get(...values) as { c: number }).c;

  let sql = `SELECT * FROM tasks ${where} ORDER BY created_at DESC`;
  const pageValues = [...values];
  if (typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit > 0) {
    sql += ' LIMIT ? OFFSET ?';
    pageValues.push(options.limit, Number.isInteger(options.offset) && (options.offset ?? 0) > 0 ? options.offset : 0);
  }
  const tasks = conn().prepare(sql).all(...pageValues) as TaskRecord[];
  return { tasks, total };
}

export function addLog(taskId: string, level: string, message: string, metadata?: object): void {
  conn().prepare('INSERT INTO task_logs (task_id, level, message, metadata) VALUES (?, ?, ?, ?)')
    .run(taskId, level, message, metadata ? JSON.stringify(metadata) : null);
}

/**
 * 读取某任务的**全部**日志（按写入顺序正序）。
 *
 * @param taskId 任务 id
 * @returns 日志条目数组
 */
export function getTaskLogs(taskId: string): LogEntry[] {
  return conn().prepare('SELECT id, level, message, metadata, created_at FROM task_logs WHERE task_id = ? ORDER BY id')
    .all(taskId) as LogEntry[];
}

/**
 * 读取某任务**最后 N 条**日志（正序返回）。
 *
 * 画布节点轮询只需要最后一条：`limit = 1` 时用 `ORDER BY id DESC LIMIT 1`
 * 命中主键索引，避免把上千行日志全量搬进内存。
 *
 * @param taskId 任务 id
 * @param limit 条数上限；`<= 0` 或非整数时退化为全量（与 `getTaskLogs` 等价）
 * @returns 日志条目数组（按写入顺序正序）
 */
export function getRecentTaskLogs(taskId: string, limit: number): LogEntry[] {
  if (!Number.isInteger(limit) || limit <= 0) return getTaskLogs(taskId);
  const rows = conn().prepare(
    'SELECT id, level, message, metadata, created_at FROM task_logs WHERE task_id = ? ORDER BY id DESC LIMIT ?',
  ).all(taskId, limit) as LogEntry[];
  return rows.reverse();
}

/**
 * 统计某任务的日志总行数。
 *
 * @param taskId 任务 id
 * @returns 日志行数
 */
export function getTaskLogCount(taskId: string): number {
  return (conn().prepare('SELECT COUNT(*) AS c FROM task_logs WHERE task_id = ?').get(taskId) as { c: number }).c;
}

/** 日志统计信息（系统设置「日志」子类展示） */
export interface LogStats {
  /** 日志总行数 */
  totalRows: number;
  /** 最早一条日志时间（SQLite UTC 格式；无日志时为 null） */
  oldestAt: string | null;
  /** 日志表数据占用字节（dbstat 实测，含 task_logs 表本身） */
  tableBytes: number;
  /** 日志索引占用字节（dbstat 实测） */
  indexBytes: number;
  /** 数据库文件占用字节（主库 + WAL + SHM） */
  fileBytes: number;
  /** 数据库已分配页占用字节（page_count × page_size） */
  allocatedBytes: number;
  /** 空闲页字节数（> 0 表示删除过数据但尚未 VACUUM 回收） */
  freelistBytes: number;
  /** 空闲页数量 */
  freelistCount: number;
  /** 已终态任务中超过保留期、可被清理的日志行数 */
  cleanableRows: number;
  /** 运行中（pending/running）任务的日志行数（永不被清理） */
  activeRows: number;
}

/**
 * 计算可清理的日志行数（仅**已终态**任务且早于截止时间）。
 *
 * @param retentionDays 保留期（天）
 * @param now 当前时间（用于计算截止时间；测试可注入）
 * @returns 可清理行数
 */
export function countCleanableLogs(retentionDays: number, now: Date = new Date()): number {
  const cutoff = cutoffIso(retentionDays, now);
  return (conn().prepare(`
    SELECT COUNT(*) AS c FROM task_logs
    WHERE created_at < datetime(?, 'utc')
      AND task_id IN (SELECT id FROM tasks WHERE status IN ('completed', 'failed'))
  `).get(cutoff) as { c: number }).c;
}

/**
 * 采集日志与数据库占用统计。
 *
 * `dbstat` 为 SQLite 编译期可选模块；当前 better-sqlite3 构建包含该模块。
 * 若不可用（抛错），表/索引占用退化为 0 并打印日志，不影响其余统计。
 *
 * @param retentionDays 保留期（天；用于计算可清理行数）
 * @param now 当前时间（测试可注入）
 * @returns 日志统计信息
 */
export function getLogStats(retentionDays: number, now: Date = new Date()): LogStats {
  const database = conn();
  const totalRows = (database.prepare('SELECT COUNT(*) AS c FROM task_logs').get() as { c: number }).c;
  const oldest = database.prepare('SELECT MIN(created_at) AS a FROM task_logs').get() as { a: string | null };
  const activeRows = (database.prepare(`
    SELECT COUNT(*) AS c FROM task_logs
    WHERE task_id IN (SELECT id FROM tasks WHERE status IN ('pending', 'running'))
  `).get() as { c: number }).c;

  let tableBytes = 0;
  let indexBytes = 0;
  try {
    const rows = database.prepare(`
      SELECT name, SUM(pgsize) AS bytes FROM dbstat
      WHERE name = 'task_logs' OR name = 'idx_task_logs_task'
      GROUP BY name
    `).all() as { name: string; bytes: number }[];
    for (const row of rows) {
      if (row.name === 'task_logs') tableBytes = row.bytes;
      else indexBytes = row.bytes;
    }
  } catch (e) {
    // dbstat 不可用（SQLite 未编译该模块）：统计退化为 0，打印日志不阻断系统设置页
    console.error('[db] dbstat 不可用，日志占用统计退化为 0:', e);
  }

  const pages = dbPageStats();
  return {
    totalRows,
    oldestAt: oldest.a,
    tableBytes,
    indexBytes,
    fileBytes: dbFileBytes(),
    allocatedBytes: pages.allocatedBytes,
    freelistBytes: pages.freelistBytes,
    freelistCount: pages.freelistCount,
    cleanableRows: countCleanableLogs(retentionDays, now),
    activeRows,
  };
}

/** 日志清理结果 */
export interface LogCleanupResult {
  /** 实际删除的日志行数 */
  deleted: number;
  /** 删除前数据库文件占用（字节；主库 + WAL + SHM） */
  fileBytesBefore: number;
  /** 删除并回收后数据库文件占用（字节；主库 + WAL + SHM） */
  fileBytesAfter: number;
  /** 删除前数据库已分配页占用（字节 = page_count × page_size） */
  allocatedBytesBefore: number;
  /** 回收后数据库已分配页占用（字节；VACUUM 成功时回落到实际数据量） */
  allocatedBytesAfter: number;
  /** 回收后空闲页数量（VACUUM 成功时为 0；未回收时 > 0） */
  freelistAfter: number;
  /** 截止时间（ISO 字符串）：早于该时间的终态任务日志已被删除 */
  cutoff: string;
}

/**
 * 计算截止时间（当前时间减去保留期）。
 *
 * @param retentionDays 保留期（天）
 * @param now 当前时间
 * @returns 截止时间（ISO 字符串）
 */
function cutoffIso(retentionDays: number, now: Date): string {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 数据库页分配统计。
 *
 * **口径说明**：删除数据后 SQLite 把页放入空闲链表，`page_count`（文件高水位）不会下降；
 * 因此「清理有没有腾出空间」的判据是 `freelistCount`，而 `VACUUM` 的效果是
 * 「空闲页归零 + `allocatedBytes` 回落到实际数据量」。
 * 文件长度（`stat` 大小）在 Windows 等平台截断后仍保留磁盘分配，不能作为判据。
 *
 * @returns `{ allocatedBytes, freelistBytes, freelistCount }`
 */
function dbPageStats(): { allocatedBytes: number; freelistBytes: number; freelistCount: number } {
  const database = conn();
  const pageSize = database.pragma('page_size', { simple: true }) as number;
  const pageCount = database.pragma('page_count', { simple: true }) as number;
  const freelistCount = database.pragma('freelist_count', { simple: true }) as number;
  return {
    allocatedBytes: pageCount * pageSize,
    freelistBytes: freelistCount * pageSize,
    freelistCount,
  };
}

/**
 * 数据库文件占用（主库 + WAL + SHM）。
 *
 * @returns 字节数（文件不存在按 0 计）
 */
function dbFileBytes(): number {
  let total = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      total += fs.statSync(`${state.dbPath}${suffix}`).size;
    } catch {
      // 文件不存在（如未启用 WAL 时的 -wal/-shm）：按 0 计
    }
  }
  return total;
}

/**
 * 单批删除行数上限：分批删除避免一次 DELETE 长时间持写锁。
 */
const CLEANUP_BATCH_SIZE = 5000;

/**
 * 清理超期的**已终态任务**日志（运行中任务的日志永不删除）。
 *
 * 语义：
 * - 只删 `task_logs`；`tasks` 行、产物文件与产物历史一律保留（历史页签仍能列出任务）；
 * - 只删 `status IN ('completed','failed')` 的任务日志，`pending`/`running` 任务不受影响；
 * - 分批删除（每批 `CLEANUP_BATCH_SIZE` 行）以缩短写锁持有时间；
 * - 删除后 `wal_checkpoint(TRUNCATE)` + `VACUUM` 回收磁盘（含索引占用）。
 *
 * **VACUUM 必须在事务外执行**；此处不使用显式事务，靠分批 DELETE 的原子性保证一致性。
 *
 * @param options.retentionDays 保留期（天）
 * @param options.now 当前时间（测试可注入）
 * @param options.vacuum 是否在删除后回收空间（默认 true；测试可关闭以提速）
 * @returns 清理结果（删除行数与回收前后文件占用）
 */
export function cleanupTaskLogs(options: {
  retentionDays: number;
  now?: Date;
  vacuum?: boolean;
}): LogCleanupResult {
  const now = options.now ?? new Date();
  const cutoff = cutoffIso(options.retentionDays, now);
  const database = conn();
  const fileBytesBefore = dbFileBytes();
  const allocatedBytesBefore = dbPageStats().allocatedBytes;

  const before = (database.prepare('SELECT COUNT(*) AS c FROM task_logs').get() as { c: number }).c;
  const del = database.prepare(`
    DELETE FROM task_logs WHERE id IN (
      SELECT id FROM task_logs
      WHERE created_at < datetime(?, 'utc')
        AND task_id IN (SELECT id FROM tasks WHERE status IN ('completed', 'failed'))
      LIMIT ?
    )
  `);
  for (;;) {
    const info = del.run(cutoff, CLEANUP_BATCH_SIZE);
    if (info.changes === 0) break;
  }
  const after = (database.prepare('SELECT COUNT(*) AS c FROM task_logs').get() as { c: number }).c;
  const deleted = before - after;

  if (deleted > 0 && options.vacuum !== false) {
    // 先 checkpoint 把 WAL 内容并回主库，否则 VACUUM 后 WAL 仍占着旧空间
    database.pragma('wal_checkpoint(TRUNCATE)');
    database.exec('VACUUM');
  } else if (deleted > 0) {
    database.pragma('wal_checkpoint(TRUNCATE)');
  }

  const pages = dbPageStats();
  return {
    deleted,
    fileBytesBefore,
    fileBytesAfter: dbFileBytes(),
    allocatedBytesBefore,
    allocatedBytesAfter: pages.allocatedBytes,
    freelistAfter: pages.freelistCount,
    cutoff,
  };
}

/**
 * 清空**已终态任务**的全部日志（保留运行中任务日志）。
 *
 * 与 `cleanupTaskLogs` 的区别：忽略保留期，一次性清空终态任务日志（手动「清空历史日志」）。
 *
 * @param options.vacuum 是否在删除后回收空间（默认 true）
 * @returns 清理结果（cutoff 为当前时间）
 */
export function purgeTaskLogs(options: { vacuum?: boolean } = {}): LogCleanupResult {
  const database = conn();
  const fileBytesBefore = dbFileBytes();
  const allocatedBytesBefore = dbPageStats().allocatedBytes;
  const before = (database.prepare('SELECT COUNT(*) AS c FROM task_logs').get() as { c: number }).c;

  const del = database.prepare(`
    DELETE FROM task_logs WHERE id IN (
      SELECT id FROM task_logs
      WHERE task_id IN (SELECT id FROM tasks WHERE status IN ('completed', 'failed'))
      LIMIT ?
    )
  `);
  for (;;) {
    const info = del.run(CLEANUP_BATCH_SIZE);
    if (info.changes === 0) break;
  }
  const after = (database.prepare('SELECT COUNT(*) AS c FROM task_logs').get() as { c: number }).c;
  const deleted = before - after;

  if (deleted > 0 && options.vacuum !== false) {
    database.pragma('wal_checkpoint(TRUNCATE)');
    database.exec('VACUUM');
  } else if (deleted > 0) {
    database.pragma('wal_checkpoint(TRUNCATE)');
  }

  const pages = dbPageStats();
  return {
    deleted,
    fileBytesBefore,
    fileBytesAfter: dbFileBytes(),
    allocatedBytesBefore,
    allocatedBytesAfter: pages.allocatedBytes,
    freelistAfter: pages.freelistCount,
    cutoff: new Date().toISOString(),
  };
}

export function incrementRetry(id: string): void {
  conn().prepare("UPDATE tasks SET retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?").run(id);
}

/**
 * 更新任务 params（JSON），用于提交后持久化远端任务 ID 等运行时信息。
 *
 * @param id - 任务 ID
 * @param params - 新的任务 params 对象（将序列化为 JSON 存入 tasks.params 列）
 */
export function updateTaskParams(id: string, params: object): void {
  conn().prepare("UPDATE tasks SET params = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(params), id);
}

export function getPendingTasks(): TaskRecord[] {
  return conn().prepare("SELECT * FROM tasks WHERE status IN ('pending', 'running') ORDER BY phase ASC, created_at ASC").all() as TaskRecord[];
}

export interface BatchSummary {
  batch_id: string
  project: string
  total: number
  completed: number
  failed: number
  running: number
  pending: number
}

export function getBatchSummary(batchId: string): BatchSummary | null {
  const rows = conn().prepare(`
    SELECT
      batch_id,
      project,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
    FROM tasks WHERE batch_id = ?
  `).get(batchId) as BatchSummary | undefined;
  return rows ?? null;
}
