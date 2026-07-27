import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/workflow.db');

// Ensure the data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
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
`);

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
}

export interface LogEntry {
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
}): void {
  const stmt = db.prepare(`
    INSERT INTO tasks (id, project, workflow_id, impl, params)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(task.id, task.project, task.workflow_id, task.impl, JSON.stringify(task.params));
}

export function getTask(id: string): TaskRecord | undefined {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRecord | undefined;
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
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function listTasks(project?: string, status?: string): TaskRecord[] {
  const conditions: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [];
  if (project) { conditions.push('project = ?'); values.push(project); }
  if (status) { conditions.push('status = ?'); values.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC`).all(...values) as TaskRecord[];
}

export function addLog(taskId: string, level: string, message: string, metadata?: object): void {
  db.prepare('INSERT INTO task_logs (task_id, level, message, metadata) VALUES (?, ?, ?, ?)')
    .run(taskId, level, message, metadata ? JSON.stringify(metadata) : null);
}

export function getTaskLogs(taskId: string): LogEntry[] {
  return db.prepare('SELECT level, message, metadata, created_at FROM task_logs WHERE task_id = ? ORDER BY id').all(taskId) as LogEntry[];
}

export function incrementRetry(id: string): void {
  db.prepare("UPDATE tasks SET retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?").run(id);
}

export function getPendingTasks(): TaskRecord[] {
  return db.prepare("SELECT * FROM tasks WHERE status IN ('pending', 'running') ORDER BY created_at ASC").all() as TaskRecord[];
}

export default db;
