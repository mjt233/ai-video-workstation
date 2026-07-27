# AI 资产工作流引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI asset generation workflow engine to the video project manager — users can submit generation tasks for character appearances, voices, stage images, scene TTS, scene images, and videos from the asset browser UI.

**Architecture:** Server-side TypeScript workflow engine with auto-discovered workflow scripts, SQLite task persistence, polling-based async tracking. Frontend adds a reusable GenerateDialog component to existing Panel components.

**Tech Stack:** Express + TypeScript (server), better-sqlite3 (SQLite), Vue 3 + Vuetify 3 (frontend), axios (HTTP)

---

### Task 1: Server Dependencies + SQLite Setup

**Files:**
- Modify: `server/package.json`
- Create: `server/src/db.ts`

- [ ] **Step 1: Add better-sqlite3 dependency**

Modify `server/package.json` — add to `dependencies`:
```json
"better-sqlite3": "^11.0.0"
```
Add to `devDependencies`:
```json
"@types/better-sqlite3": "^7.6.0"
```

- [ ] **Step 2: Install dependencies**

Run: `cd server && npm install`
Expected: better-sqlite3 and its types added to node_modules

- [ ] **Step 3: Create server/src/db.ts**

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/workflow.db');

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
```

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/src/db.ts
git commit -m "feat: add SQLite database layer for workflow tasks"
```

---

### Task 2: Server — Types + Registry

**Files:**
- Create: `server/src/workflows/types.ts`
- Create: `server/src/workflows/registry.ts`

- [ ] **Step 1: Create server/src/workflows/types.ts**

```typescript
export interface WorkflowParams {
  project: string;
  /** Read a file from the project's prompt/ directory */
  readFile(relPath: string): Promise<string>;
  /** Variable substitution values, e.g. { name } → "小霓" */
  vars: Record<string, string>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  impl: string;
  description?: string;

  /** Submit task to AI API, return remote task ID */
  submit(params: WorkflowParams): Promise<{ taskId: string }>;

  /** Optional: poll task status. Not implementing = synchronous task */
  poll?(taskId: string): Promise<{ status: string; done: boolean }>;

  /** Extract output spec from completed task */
  parseOutput(taskId: string, response?: any): Promise<WorkflowOutput>;
}

export type WorkflowOutput =
  | { type: 'download'; url: string; filename: string }
  | { type: 'fetch'; request: { url: string; method: string; headers?: Record<string, string> }; filename: string }
  | { type: 'body'; contentType: string; data: string; filename: string };

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';
```

- [ ] **Step 2: Create server/src/workflows/registry.ts**

```typescript
import type { WorkflowDefinition } from './types.js';

const registry = new Map<string, WorkflowDefinition[]>();

export function register(w: WorkflowDefinition): void {
  const list = registry.get(w.id) ?? [];
  list.push(w);
  registry.set(w.id, list);
}

export function getImplementations(id: string): WorkflowDefinition[] {
  return registry.get(id) ?? [];
}

export function getImpl(id: string, impl: string): WorkflowDefinition | undefined {
  return registry.get(id)?.find(w => w.impl === impl);
}

export function getAllWorkflowIds(): string[] {
  return [...registry.keys()];
}

export function getAllWorkflows(): { id: string; name: string; implementations: { impl: string; name: string; description?: string }[] }[] {
  return [...registry.entries()].map(([id, impls]) => ({
    id,
    name: impls[0]?.name ?? id,
    implementations: impls.map(w => ({ impl: w.impl, name: w.name, description: w.description }))
  }));
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/workflows/types.ts server/src/workflows/registry.ts
git commit -m "feat: add workflow types and registry"
```

---

### Task 3: Server — Workflow Engine

**Files:**
- Create: `server/src/workflow-engine.ts`

- [ ] **Step 1: Create server/src/workflow-engine.ts**

```typescript
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import { register, getImpl, getAllWorkflows } from './workflows/registry.js';
import type { WorkflowDefinition, WorkflowParams, WorkflowOutput } from './workflows/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.resolve(__dirname, '../../design');
const WORKFLOWS_DIR = path.resolve(__dirname, 'workflows');

// Re-export for API routes
export { getAllWorkflows };

/**
 * Auto-discover and register all workflow scripts
 */
export async function discoverWorkflows(): Promise<void> {
  const entries = await fs.readdir(WORKFLOWS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const categoryDir = path.join(WORKFLOWS_DIR, entry.name);
    const files = await fs.readdir(categoryDir);
    for (const file of files) {
      if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
      const mod = await import(path.join(categoryDir, file));
      // Each module calls register() on import
      if (mod.default) {
        // If module exports default array, register each
        if (Array.isArray(mod.default)) {
          mod.default.forEach((w: WorkflowDefinition) => register(w));
        } else {
          register(mod.default);
        }
      }
    }
  }
}

/**
 * Run a single workflow task
 */
async function runTask(taskId: string): Promise<void> {
  const task = db.getTask(taskId);
  if (!task) {
    console.error(`Task ${taskId} not found`);
    return;
  }

  const wf = getImpl(task.workflow_id, task.impl);
  if (!wf) {
    db.updateTaskStatus(taskId, 'failed', { error_msg: `Workflow ${task.workflow_id}/${task.impl} not found` });
    db.addLog(taskId, 'error', `Workflow implementation not found: ${task.workflow_id}/${task.impl}`);
    return;
  }

  const paramsObj = JSON.parse(task.params);

  const workflowParams: WorkflowParams = {
    project: task.project,
    vars: paramsObj.vars ?? {},
    async readFile(relPath: string): Promise<string> {
      const full = path.resolve(DESIGN_DIR, task.project, relPath);
      // Ensure no path traversal
      if (!full.startsWith(path.resolve(DESIGN_DIR, task.project) + path.sep)) {
        throw new Error('Path traversal denied');
      }
      return fs.readFile(full, 'utf-8');
    }
  };

  try {
    db.addLog(taskId, 'info', `Starting workflow: ${wf.name} (impl: ${wf.impl})`);
    db.updateTaskStatus(taskId, 'running');

    // Step 1: Submit
    db.addLog(taskId, 'info', 'Submitting task to AI API...');
    const { taskId: remoteTaskId } = await wf.submit(workflowParams);
    db.addLog(taskId, 'info', `Submitted, remote task ID: ${remoteTaskId}`);

    let pollResponse: any = undefined;

    // Step 2: Poll if defined
    if (wf.poll) {
      db.addLog(taskId, 'info', 'Polling task status...');
      const POLL_INTERVAL = 2000;
      const MAX_POLL_TIME = 5 * 60 * 1000; // 5 minutes timeout
      const startTime = Date.now();

      while (true) {
        if (Date.now() - startTime > MAX_POLL_TIME) {
          throw new Error('Task polling timed out after 5 minutes');
        }

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        const result = await wf.poll(remoteTaskId);
        pollResponse = result;

        db.addLog(taskId, 'debug', `Poll result: status=${result.status}, done=${result.done}`);

        if (result.done) {
          db.addLog(taskId, 'info', `Task completed with status: ${result.status}`);
          break;
        }
      }
    }

    // Step 3: Parse output
    db.addLog(taskId, 'info', 'Parsing output...');
    const output = await wf.parseOutput(remoteTaskId, pollResponse);

    // Step 4: Download/fetch output and write to assert/
    const outputPath = paramsObj.outputPath;
    if (!outputPath) {
      throw new Error('outputPath is required in task params');
    }
    const assertFullPath = path.resolve(DESIGN_DIR, task.project, outputPath);
    const assertDir = path.dirname(assertFullPath);

    // Verify the path is within the project's assert/ directory
    const projectRoot = path.resolve(DESIGN_DIR, task.project) + path.sep;
    if (!assertFullPath.startsWith(projectRoot)) {
      throw new Error('Path traversal denied');
    }
    // Verify it's under assert/
    const relAssertPath = path.relative(path.resolve(DESIGN_DIR, task.project), assertFullPath);
    if (!relAssertPath.startsWith('assert')) {
      throw new Error('Output path must be under assert/');
    }

    await fs.mkdir(assertDir, { recursive: true });

    if (output.type === 'download') {
      db.addLog(taskId, 'info', `Downloading output from: ${output.url}`);
      const res = await fetch(output.url);
      if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(assertFullPath, buffer);
    } else if (output.type === 'fetch') {
      db.addLog(taskId, 'info', `Fetching output from: ${output.request.url}`);
      const res = await fetch(output.request.url, {
        method: output.request.method,
        headers: output.request.headers
      });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(assertFullPath, buffer);
    } else if (output.type === 'body') {
      db.addLog(taskId, 'info', 'Decoding base64 output body');
      const buffer = Buffer.from(output.data, 'base64');
      await fs.writeFile(assertFullPath, buffer);
    }

    db.addLog(taskId, 'info', `Output written to: ${outputPath}`);
    db.updateTaskStatus(taskId, 'completed', { result: { path: outputPath } });

  } catch (err: any) {
    db.addLog(taskId, 'error', `Task failed: ${err.message}`);

    // Retry logic
    if (task.retry_count < task.max_retries) {
      db.incrementRetry(taskId);
      db.updateTaskStatus(taskId, 'pending');
      db.addLog(taskId, 'info', `Scheduled for retry (${task.retry_count + 1}/${task.max_retries})`);
    } else {
      db.updateTaskStatus(taskId, 'failed', { error_msg: err.message });
    }
  }
}

/**
 * Start the engine background loop
 */
export function startEngine(): void {
  console.log('Workflow engine started');

  async function tick() {
    try {
      const pending = db.getPendingTasks();
      for (const task of pending) {
        // Only run tasks that are pending (not already running)
        if (task.status === 'pending') {
          db.updateTaskStatus(task.id, 'running');
          runTask(task.id).catch(err => {
            console.error(`Task ${task.id} crashed:`, err);
          });
        }
      }
    } catch (err) {
      console.error('Engine tick error:', err);
    }
  }

  // Run immediately, then every 2 seconds
  tick();
  setInterval(tick, 2000);
}
```

Note: The engine depends on `uuid` package. Add it to server/package.json:
```json
"uuid": "^10.0.0"
```
And to devDependencies:
```json
"@types/uuid": "^10.0.0"
```

- [ ] **Step 2: Install uuid**

Run: `cd server && npm install`
Expected: uuid and its types added

- [ ] **Step 3: Commit**

```bash
git add server/src/workflow-engine.ts
git commit -m "feat: add workflow engine with polling, retry, and output handling"
```

---

### Task 4: Server — Workflow API Routes

**Files:**
- Create: `server/src/routes/workflow.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Create server/src/routes/workflow.ts**

```typescript
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db.js';
import { getAllWorkflows } from '../workflow-engine.js';

export const workflowRouter = Router();

// GET /api/workflows — list available workflow types and implementations
workflowRouter.get('/workflows', (_req: Request, res: Response) => {
  res.json({ workflows: getAllWorkflows() });
});

// POST /api/workflow/run — submit a generation task
workflowRouter.post('/workflow/run', (req: Request, res: Response) => {
  const { project, workflowId, impl, params } = req.body as {
    project: string;
    workflowId: string;
    impl?: string;
    params: {
      vars?: Record<string, string>;
      promptPaths?: string[];
      outputPath: string;
    };
  };

  if (!project || !workflowId || !params?.outputPath) {
    res.status(400).json({ error: 'Missing required fields: project, workflowId, params.outputPath' });
    return;
  }

  const taskId = uuidv4();
  db.createTask({
    id: taskId,
    project,
    workflow_id: workflowId,
    impl: impl ?? 'default',
    params: {
      vars: params.vars ?? {},
      promptPaths: params.promptPaths ?? [],
      outputPath: params.outputPath,
    },
  });

  db.addLog(taskId, 'info', `Task created: ${workflowId}/${impl ?? 'default'}`);

  res.json({ taskId, status: 'pending' });
});

// GET /api/workflow/tasks/:taskId — get task status
workflowRouter.get('/workflow/tasks/:taskId', (req: Request, res: Response) => {
  const task = db.getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({
    taskId: task.id,
    workflowId: task.workflow_id,
    impl: task.impl,
    status: task.status,
    result: task.result ? JSON.parse(task.result) : null,
    errorMsg: task.error_msg,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  });
});

// GET /api/workflow/tasks — list tasks with optional filters
workflowRouter.get('/workflow/tasks', (req: Request, res: Response) => {
  const project = req.query.project as string | undefined;
  const status = req.query.status as string | undefined;
  const tasks = db.listTasks(project, status);
  res.json({
    tasks: tasks.map(t => ({
      taskId: t.id,
      workflowId: t.workflow_id,
      impl: t.impl,
      status: t.status,
      result: t.result ? JSON.parse(t.result) : null,
      errorMsg: t.error_msg,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    }))
  });
});

// GET /api/workflow/tasks/:taskId/log — get task logs
workflowRouter.get('/workflow/tasks/:taskId/log', (req: Request, res: Response) => {
  const logs = db.getTaskLogs(req.params.taskId);
  res.json({ logs });
});

// POST /api/workflow/retry/:taskId — retry a failed task
workflowRouter.post('/workflow/retry/:taskId', (req: Request, res: Response) => {
  const existing = db.getTask(req.params.taskId);
  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const newTaskId = uuidv4();
  db.createTask({
    id: newTaskId,
    project: existing.project,
    workflow_id: existing.workflow_id,
    impl: existing.impl,
    params: JSON.parse(existing.params),
  });

  db.addLog(newTaskId, 'info', `Retry of task ${existing.id}`);

  res.json({ taskId: newTaskId, status: 'pending' });
});
```

- [ ] **Step 2: Register routes and engine in server/src/index.ts**

Modify `server/src/index.ts` — add workflow router and engine startup:

```typescript
import { workflowRouter } from './routes/workflow.js';
import { discoverWorkflows, startEngine } from './workflow-engine.js';

// Add after existing app.use('/api', fsRouter):
app.use('/api', workflowRouter);

// Add before app.listen():
// Discover and register workflow scripts, then start engine
discoverWorkflows().then(() => {
  startEngine();
});
```

The full file after changes:

```typescript
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { fsRouter } from './routes/fs.js';
import { workflowRouter } from './routes/workflow.js';
import { discoverWorkflows, startEngine } from './workflow-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.use('/api', fsRouter);
app.use('/api', workflowRouter);

const distPath = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

discoverWorkflows().then(() => {
  startEngine();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/workflow.ts server/src/index.ts
git commit -m "feat: add workflow API routes and engine bootstrap"
```

---

### Task 5: Server — Example Workflow Scripts

**Files:**
- Create: `server/src/workflows/character-appearance/default.ts`
- Create: `server/src/workflows/character-appearance/flux.ts`
- Create: `server/src/workflows/character-voice/default.ts`
- Create: `server/src/workflows/stage-image/default.ts`
- Create: `server/src/workflows/scene-tts/default.ts`
- Create: `server/src/workflows/scene-stage-image/default.ts`
- Create: `server/src/workflows/video-generate/default.ts`
- Create: `server/src/workflows/video-generate/ltx.ts`

Each file is a stub that calls `register()` on import. Users customize the implementation.

- [ ] **Step 1: Create character-appearance/default.ts**

```typescript
import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'character-appearance',
  name: '角色外观生成 (Qwen)',
  impl: 'default',
  description: '使用 Qwen 文生图模型生成角色外观图片',

  async submit(params) {
    const prompt = await params.readFile(`prompt/character/${params.vars.name}/appearance.md`);
    // TODO: Replace with actual API call
    // const res = await fetch('https://api.example.com/v1/images', {
    //   method: 'POST',
    //   headers: { Authorization: `Bearer ${process.env.QWEN_API_KEY}` },
    //   body: JSON.stringify({ prompt, size: '1024x1024' })
    // });
    // const data = await res.json();
    // return { taskId: data.id };
    return { taskId: 'mock-' + Date.now() };
  },

  async poll(taskId) {
    // TODO: Implement actual polling
    return { status: 'completed', done: true };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/1024',
      filename: 'appearance.jpg',
    };
  }
} satisfies WorkflowDefinition);
```

- [ ] **Step 2: Create character-appearance/flux.ts**

```typescript
import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'character-appearance',
  name: '角色外观生成 (Flux)',
  impl: 'flux',
  description: '使用 Flux 模型生成角色外观图片',

  async submit(params) {
    const prompt = await params.readFile(`prompt/character/${params.vars.name}/appearance.md`);
    // TODO: Replace with actual Flux API call
    return { taskId: 'flux-mock-' + Date.now() };
  },

  async poll(taskId) {
    return { status: 'completed', done: true };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/1024',
      filename: 'appearance.jpg',
    };
  }
} satisfies WorkflowDefinition);
```

- [ ] **Step 3: Create character-voice/default.ts**

```typescript
import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'character-voice',
  name: '角色声音生成 (TTS)',
  impl: 'default',
  description: '根据角色声音描述生成语音样本',

  async submit(params) {
    const voiceDesc = await params.readFile(`prompt/character/${params.vars.name}/voice.md`);
    // TODO: Call TTS API
    return { taskId: 'voice-mock-' + Date.now() };
  },

  async poll(taskId) {
    return { status: 'completed', done: true };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/audio',
      filename: 'voice.flac',
    };
  }
} satisfies WorkflowDefinition);
```

- [ ] **Step 4: Create stage-image/default.ts**

```typescript
import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'stage-image',
  name: '场景图片生成',
  impl: 'default',
  description: '根据场景 prompt 生成场景图片',

  async submit(params) {
    const prompt = await params.readFile(`prompt/stage/${params.vars.name}/${params.vars.label}.md`);
    return { taskId: 'stage-mock-' + Date.now() };
  },

  async poll(taskId) {
    return { status: 'completed', done: true };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/1024',
      filename: 'scene.jpg',
    };
  }
} satisfies WorkflowDefinition);
```

- [ ] **Step 5: Create scene-tts/default.ts**

```typescript
import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'scene-tts',
  name: '分镜台词语音生成',
  impl: 'default',
  description: '将分镜台词转为语音',

  async submit(params) {
    // script.json contains the lines; we generate per character
    const scriptJson = await params.readFile(`prompt/scene/${params.vars.episode}/${params.vars.shot}/script.json`);
    const script = JSON.parse(scriptJson);
    const charLine = script.find((l: any) => l.角色名 === params.vars.character);
    return { taskId: 'tts-mock-' + Date.now() };
  },

  async poll(taskId) {
    return { status: 'completed', done: true };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/audio',
      filename: 'voice.flac',
    };
  }
} satisfies WorkflowDefinition);
```

- [ ] **Step 6: Create scene-stage-image/default.ts**

```typescript
import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'scene-stage-image',
  name: '分镜场景图生成 (图片编辑)',
  impl: 'default',
  description: '基于基础场景图片和角色合成分镜场景图',

  async submit(params) {
    // stage.json references the base stage
    // This workflow does image editing: compose character onto stage background
    return { taskId: 'edit-mock-' + Date.now() };
  },

  async poll(taskId) {
    return { status: 'completed', done: true };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/1024',
      filename: `${params.vars.index}.jpg`,
    };
  }
} satisfies WorkflowDefinition);
```

- [ ] **Step 7: Create video-generate/default.ts**

```typescript
import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'video-generate',
  name: '视频生成 (图生视频)',
  impl: 'default',
  description: '基于分镜图片和 prompt 生成视频',

  async submit(params) {
    const prompt = await params.readFile(`prompt/scene/${params.vars.episode}/${params.vars.shot}/prompt.md`);
    return { taskId: 'video-mock-' + Date.now() };
  },

  async poll(taskId) {
    return { status: 'completed', done: true };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/video',
      filename: 'video.mp4',
    };
  }
} satisfies WorkflowDefinition);
```

- [ ] **Step 8: Create video-generate/ltx.ts**

```typescript
import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'video-generate',
  name: '视频生成 (LTX-2.3)',
  impl: 'ltx',
  description: '使用 LTX-2.3 模型基于首帧图生成视频',

  async submit(params) {
    const prompt = await params.readFile(`prompt/scene/${params.vars.episode}/${params.vars.shot}/prompt.md`);
    return { taskId: 'ltx-mock-' + Date.now() };
  },

  async poll(taskId) {
    return { status: 'completed', done: true };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/video',
      filename: 'video.mp4',
    };
  }
} satisfies WorkflowDefinition);
```

- [ ] **Step 9: Run typecheck and fix any issues**

Run: `cd server && npm run typecheck`
Expected: No type errors

- [ ] **Step 10: Commit**

```bash
git add server/src/workflows/
git commit -m "feat: add workflow script stubs for all asset types"
```

---

### Task 6: Frontend — API Module + Composable

**Files:**
- Create: `frontend/src/api/workflow.ts`
- Create: `frontend/src/composables/useWorkflowTask.ts`

- [ ] **Step 1: Create frontend/src/api/workflow.ts**

```typescript
import client from './client'

export interface WorkflowInfo {
  id: string
  name: string
  implementations: { impl: string; name: string; description?: string }[]
}

export interface TaskResponse {
  taskId: string
  workflowId: string
  impl: string
  status: string
  result: { path: string } | null
  errorMsg?: string
  createdAt: string
  updatedAt: string
}

export interface LogEntry {
  level: string
  message: string
  metadata?: string
  created_at: string
}

export interface WorkflowRunParams {
  project: string
  workflowId: string
  impl?: string
  params: {
    vars: Record<string, string>
    promptPaths?: string[]
    outputPath: string
  }
}

export async function getWorkflows(): Promise<WorkflowInfo[]> {
  const { data } = await client.get<{ workflows: WorkflowInfo[] }>('/workflows')
  return data.workflows
}

export async function runWorkflow(body: WorkflowRunParams): Promise<{ taskId: string; status: string }> {
  const { data } = await client.post<{ taskId: string; status: string }>('/workflow/run', body)
  return data
}

export async function getTaskStatus(taskId: string): Promise<TaskResponse> {
  const { data } = await client.get<TaskResponse>(`/workflow/tasks/${taskId}`)
  return data
}

export async function listTasks(project?: string, status?: string): Promise<TaskResponse[]> {
  const params = new URLSearchParams()
  if (project) params.set('project', project)
  if (status) params.set('status', status)
  const { data } = await client.get<{ tasks: TaskResponse[] }>(`/workflow/tasks?${params}`)
  return data.tasks
}

export async function getTaskLogs(taskId: string): Promise<LogEntry[]> {
  const { data } = await client.get<{ logs: LogEntry[] }>(`/workflow/tasks/${taskId}/log`)
  return data.logs
}

export async function retryTask(taskId: string): Promise<{ taskId: string; status: string }> {
  const { data } = await client.post<{ taskId: string; status: string }>(`/workflow/retry/${taskId}`)
  return data
}
```

- [ ] **Step 2: Create frontend/src/composables/useWorkflowTask.ts**

```typescript
import { ref, watch, onUnmounted, type Ref } from 'vue'
import { getTaskStatus, getTaskLogs, type TaskResponse, type LogEntry } from '../api/workflow'

export function useWorkflowTask(taskId: Ref<string | null>) {
  const status = ref<string>('idle')
  const task = ref<TaskResponse | null>(null)
  const logs = ref<LogEntry[]>([])
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  function startPolling(id: string) {
    stopPolling()
    status.value = 'running'
    error.value = null

    // Initial fetch
    getTaskStatus(id).then(t => {
      task.value = t
      if (t.status === 'completed' || t.status === 'failed') {
        status.value = t.status
        if (t.status === 'failed') error.value = t.errorMsg ?? 'Task failed'
        return
      }
    })

    // Poll every 2 seconds
    timer = setInterval(async () => {
      try {
        const t = await getTaskStatus(id)
        task.value = t
        status.value = t.status

        // Also fetch logs
        logs.value = await getTaskLogs(id)

        if (t.status === 'completed') {
          status.value = 'completed'
          stopPolling()
        } else if (t.status === 'failed') {
          status.value = 'failed'
          error.value = t.errorMsg ?? 'Task failed'
          stopPolling()
        }
      } catch (err: any) {
        console.error('Polling error:', err)
      }
    }, 2000)
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  watch(taskId, (id) => {
    if (id) startPolling(id)
    else stopPolling()
  })

  onUnmounted(stopPolling)

  return { status, task, logs, error }
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd frontend && npm run typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/workflow.ts frontend/src/composables/useWorkflowTask.ts
git commit -m "feat: add frontend workflow API module and polling composable"
```

---

### Task 7: Frontend — GenerateDialog Component

**Files:**
- Create: `frontend/src/components/GenerateDialog.vue`

- [ ] **Step 1: Create frontend/src/components/GenerateDialog.vue**

```vue
<template>
  <v-dialog
    v-model="show"
    max-width="520"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-auto-fix</v-icon>
        {{ workflowName }}
      </v-card-title>

      <v-card-text>
        <!-- Implementation selector -->
        <v-select
          v-if="implementations.length > 1"
          v-model="selectedImpl"
          :items="implementations"
          item-title="name"
          item-value="impl"
          label="选择生成模型"
          variant="outlined"
          class="mb-3"
          hide-details
        />

        <!-- Existing asset info -->
        <div
          v-if="existingAsset"
          class="text-caption text-grey mb-2"
        >
          当前资产: {{ existingAsset }}
        </div>

        <!-- Loading state -->
        <template v-if="polling.status === 'running'">
          <v-progress-linear
            indeterminate
            color="primary"
            class="mb-2"
          />
          <div class="text-caption text-primary mb-2">
            生成中，请稍候...
          </div>
        </template>

        <!-- Logs -->
        <div
          v-if="polling.logs.length"
          ref="logRef"
          class="bg-grey-lighten-3 rounded pa-2 mb-2"
          style="max-height: 180px; overflow-y: auto; font-size: 12px; font-family: monospace;"
        >
          <div
            v-for="(log, i) in polling.logs"
            :key="i"
            class="text-caption"
            :class="log.level === 'error' ? 'text-error' : log.level === 'warn' ? 'text-warning' : 'text-grey-darken-1'"
          >
            [{{ log.created_at }}] {{ log.message }}
          </div>
        </div>

        <!-- Completed -->
        <v-alert
          v-if="polling.status === 'completed'"
          type="success"
          variant="tonal"
          class="mb-2"
        >
          生成完成
          <template #append>
            <v-btn
              size="small"
              variant="text"
              @click="$emit('refresh')"
            >
              刷新查看
            </v-btn>
          </template>
        </v-alert>

        <!-- Failed -->
        <v-alert
          v-if="polling.status === 'failed'"
          type="error"
          variant="tonal"
          class="mb-2"
        >
          {{ polling.error || '生成失败' }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn
          v-if="polling.status === 'idle' || polling.status === 'failed'"
          color="primary"
          :loading="submitting"
          @click="submit"
        >
          {{ polling.status === 'failed' ? '重新生成' : '开始生成' }}
        </v-btn>
        <v-btn
          variant="text"
          @click="close"
        >
          {{ polling.status === 'running' ? '后台运行' : '关闭' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { runWorkflow, getWorkflows, type WorkflowInfo } from '../api/workflow'
import { useWorkflowTask } from '../composables/useWorkflowTask'

const props = defineProps<{
  modelValue: boolean
  project: string
  workflowId: string
  workflowName: string
  vars: Record<string, string>
  outputPath: string
  promptPaths?: string[]
  existingAsset?: string
  defaultImpl?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'refresh'): void
}>()

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const selectedImpl = ref(props.defaultImpl ?? 'default')
const implementations = ref<{ impl: string; name: string; description?: string }[]>([])
const submitting = ref(false)
const taskId = ref<string | null>(null)
const polling = useWorkflowTask(taskId)
const logRef = ref<HTMLElement | null>(null)

// Load implementations when dialog opens
watch(show, async (val) => {
  if (val) {
    try {
      const workflows = await getWorkflows()
      const wf = workflows.find(w => w.id === props.workflowId)
      if (wf) {
        implementations.value = wf.implementations
        if (props.defaultImpl) selectedImpl.value = props.defaultImpl
      }
    } catch {
      // Ignore errors
    }
  } else {
    // Reset on close
    taskId.value = null
    selectedImpl.value = props.defaultImpl ?? 'default'
  }
})

// Auto-scroll logs
watch(() => polling.logs.length, async () => {
  await nextTick()
  if (logRef.value) {
    logRef.value.scrollTop = logRef.value.scrollHeight
  }
})

async function submit() {
  submitting.value = true
  try {
    const result = await runWorkflow({
      project: props.project,
      workflowId: props.workflowId,
      impl: selectedImpl.value,
      params: {
        vars: props.vars,
        promptPaths: props.promptPaths ?? [],
        outputPath: props.outputPath,
      },
    })
    taskId.value = result.taskId
  } catch (err: any) {
    console.error('Failed to submit workflow:', err)
  } finally {
    submitting.value = false
  }
}

function close() {
  show.value = false
}
</script>
```

- [ ] **Step 2: Run typecheck**

Run: `cd frontend && npm run typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/GenerateDialog.vue
git commit -m "feat: add reusable GenerateDialog component"
```

---

### Task 8: Frontend — CharacterPanel Integration

**Files:**
- Modify: `frontend/src/components/CharacterPanel.vue`

- [ ] **Step 1: Add GenerateDialog import and reactive state**

Add to `<script setup>` in `CharacterPanel.vue`:

```typescript
import GenerateDialog from './GenerateDialog.vue'

// Generation state
const genDialog = ref({ show: false, type: '' as 'appearance' | 'voice' })
const genConfig = computed(() => {
  const type = genDialog.value.type
  return {
    workflowId: type === 'appearance' ? 'character-appearance' : 'character-voice',
    workflowName: type === 'appearance' ? '角色外观生成' : '角色声音生成',
    outputPath: type === 'appearance'
      ? `assert/character/${props.name}/appearance.jpg`
      : `assert/character/${props.name}/voice.flac`,
    vars: { name: props.name },
    promptPaths: type === 'appearance'
      ? [`prompt/character/${props.name}/appearance.md`]
      : [`prompt/character/${props.name}/voice.md`],
    existingAsset: type === 'appearance'
      ? (appearanceImg.value ? '已有图片' : undefined)
      : (voiceAudio.value ? '已有音频' : undefined),
  }
})
```

- [ ] **Step 2: Add generate buttons in template**

In the appearance tab, after the existing `<v-img>` and `<div v-else>` for "暂无图片", add a generate button:

```vue
<!-- After the v-img / v-else block in appearance tab -->
<div class="d-flex justify-center mt-2">
  <v-btn
    size="small"
    color="primary"
    variant="tonal"
    prepend-icon="mdi-auto-fix"
    @click="genDialog = { show: true, type: 'appearance' }"
  >
    生成
  </v-btn>
</div>
```

In the voice tab, after the existing `<audio>` and `<div v-else>` for "暂无音频", add a generate button:

```vue
<!-- After the audio / v-else block in voice tab -->
<div class="d-flex justify-center mt-2">
  <v-btn
    size="small"
    color="primary"
    variant="tonal"
    prepend-icon="mdi-auto-fix"
    @click="genDialog = { show: true, type: 'voice' }"
  >
    生成
  </v-btn>
</div>
```

- [ ] **Step 3: Add GenerateDialog component at end of template**

```vue
<!-- Before closing </template> tag -->
<GenerateDialog
  v-model="genDialog.show"
  :project="props.project"
  :workflow-id="genConfig.workflowId"
  :workflow-name="genConfig.workflowName"
  :vars="genConfig.vars"
  :output-path="genConfig.outputPath"
  :prompt-paths="genConfig.promptPaths"
  :existing-asset="genConfig.existingAsset"
  @refresh="load"
/>
```

- [ ] **Step 4: Run typecheck**

Run: `cd frontend && npm run typecheck`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CharacterPanel.vue
git commit -m "feat: add generate buttons to CharacterPanel"
```

---

### Task 9: Frontend — StagePanel Integration

**Files:**
- Modify: `frontend/src/components/StagePanel.vue`

- [ ] **Step 1: Add GenerateDialog import and state**

Add to `<script setup>`:

```typescript
import GenerateDialog from './GenerateDialog.vue'

const genDialog = ref(false)
```

- [ ] **Step 2: Add generate button in image tab**

After the existing `<v-img>` and `<div v-else>` for "暂无图片", add:

```vue
<div class="d-flex justify-center mt-2">
  <v-btn
    size="small"
    color="primary"
    variant="tonal"
    prepend-icon="mdi-auto-fix"
    @click="genDialog = true"
  >
    生成
  </v-btn>
</div>
```

- [ ] **Step 3: Add GenerateDialog component**

```vue
<GenerateDialog
  v-model="genDialog"
  :project="props.project"
  workflow-id="stage-image"
  workflow-name="场景图片生成"
  :vars="{ name: props.name, label: selected?.label ?? '' }"
  :output-path="`assert/stage/${props.name}/${selected?.label}.jpg`"
  :prompt-paths="[`prompt/stage/${props.name}/${selected?.label}.md`]"
  :existing-asset="selected?.imageUrl ? '已有图片' : undefined"
  @refresh="load"
/>
```

- [ ] **Step 4: Run typecheck**

Run: `cd frontend && npm run typecheck`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/StagePanel.vue
git commit -m "feat: add generate button to StagePanel"
```

---

### Task 10: Frontend — ScenePanel Integration

**Files:**
- Modify: `frontend/src/components/ScenePanel.vue`

- [ ] **Step 1: Add GenerateDialog import and state**

Add to `<script setup>`:

```typescript
import GenerateDialog from './GenerateDialog.vue'

const genDialog = ref({ show: false, type: '' as 'image' | 'voice' | 'video', index: 0 })
```

The ScenePanel has three generation scenarios:
1. Scene image generation (per stage index) — workflow: `scene-stage-image`
2. Voice generation (per character in script) — workflow: `scene-tts`
3. Video generation — workflow: `video-generate`

- [ ] **Step 2: Add generate button for scene images**

In the images tab, inside the `v-for` loop for `stageImages`, after each `<v-img>`:

```vue
<div class="d-flex justify-center mt-1">
  <v-btn
    size="x-small"
    color="primary"
    variant="tonal"
    prepend-icon="mdi-auto-fix"
    @click="genDialog = { show: true, type: 'image', index: i }"
  >
    生成
  </v-btn>
</div>
```

- [ ] **Step 3: Add generate voice button in script tab**

In the script tab, next to each script entry:

```vue
<template #append>
  <v-btn
    size="x-small"
    variant="tonal"
    prepend-icon="mdi-account-voice"
    @click="genDialog = { show: true, type: 'voice', index: i }"
  >
    生成语音
  </v-btn>
</template>
```

- [ ] **Step 4: Add generate video button in prompt tab**

```vue
<div class="d-flex justify-center mt-2">
  <v-btn
    color="primary"
    variant="tonal"
    prepend-icon="mdi-video"
    @click="genDialog = { show: true, type: 'video', index: 0 }"
  >
    生成视频
  </v-btn>
</div>
```

- [ ] **Step 5: Add GenerateDialog component(s)**

For scene image generation:
```vue
<GenerateDialog
  v-model="genDialog.show && genDialog.type === 'image'"
  :project="props.project"
  workflow-id="scene-stage-image"
  workflow-name="分镜场景图生成"
  :vars="{ episode: props.episode, shot: props.shot, index: String(genDialog.index) }"
  :output-path="`assert/scene/${props.episode}/${props.shot}/stage/${genDialog.index}.jpg`"
  @refresh="load"
/>
```

For voice generation:
```vue
<GenerateDialog
  v-model="genDialog.show && genDialog.type === 'voice'"
  :project="props.project"
  workflow-id="scene-tts"
  workflow-name="分镜台词语音生成"
  :vars="{ episode: props.episode, shot: props.shot, character: data?.script[genDialog.index]?.角色名 ?? '' }"
  :output-path="`assert/scene/${props.episode}/${props.shot}/voice/${data?.script[genDialog.index]?.角色名}.flac`"
  @refresh="load"
/>
```

For video generation:
```vue
<GenerateDialog
  v-model="genDialog.show && genDialog.type === 'video'"
  :project="props.project"
  workflow-id="video-generate"
  workflow-name="视频生成"
  :vars="{ episode: props.episode, shot: props.shot, index: '0' }"
  :output-path="`assert/scene/${props.episode}/${props.shot}/video/0.mp4`"
  @refresh="load"
/>
```

- [ ] **Step 6: Run typecheck**

Run: `cd frontend && npm run typecheck`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ScenePanel.vue
git commit -m "feat: add generate buttons to ScenePanel"
```

---

### Task 11: Server — Install Dependencies

- [ ] **Step 1: Install all server dependencies**

Run: `cd server && npm install`
Expected: better-sqlite3, uuid and their types installed

- [ ] **Step 2: Run full typecheck**

Run: `cd server && npm run typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add server/package.json
git commit -m "chore: add better-sqlite3 and uuid dependencies"
```

---

### Task 12: Integration Test

- [ ] **Step 1: Start server**

Run: `cd server && npm run dev`
Expected: Server starts, engine begins polling

- [ ] **Step 2: Test workflows API**

Run in another terminal:
```bash
# List workflows
curl http://localhost:3001/api/workflows

# Run a task
curl -X POST http://localhost:3001/api/workflow/run \
  -H "Content-Type: application/json" \
  -d '{"project":"AI的第一天","workflowId":"character-appearance","params":{"vars":{"name":"小霓"},"outputPath":"assert/character/小霓/appearance.jpg"}}'

# Check task status (replace with actual taskId)
curl http://localhost:3001/api/workflow/tasks/<taskId>
```

Expected: Workflows listed, task created and completed (mock).

- [ ] **Step 3: Start frontend and verify UI**

Run: `cd frontend && npm run dev`
Expected: app starts, navigate to a project, click generate buttons, dialog appears

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "feat: complete workflow engine integration"
```
