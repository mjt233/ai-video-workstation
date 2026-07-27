import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as db from './db.js';
import { register, getImpl, getAllWorkflows } from './workflows/registry.js';
import type { WorkflowDefinition, WorkflowParams } from './workflows/types.js';

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
      const mod = await import(pathToFileURL(path.join(categoryDir, file)).href);
      // Each module calls register() on import
      if (mod.default) {
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
      const projectRoot = path.resolve(DESIGN_DIR, task.project) + path.sep;
      if (!full.startsWith(projectRoot)) {
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
      const MAX_POLL_TIME = 5 * 60 * 1000;
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

    // Security: verify path is within project directory
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

  // Reset tasks stuck in 'running' state (from a previous crash) to 'pending'
  const staleRunning = db.getPendingTasks().filter(t => t.status === 'running');
  for (const task of staleRunning) {
    db.updateTaskStatus(task.id, 'pending');
    db.addLog(task.id, 'warn', 'Task reset from running to pending after server restart');
  }
  if (staleRunning.length > 0) {
    console.log(`Reset ${staleRunning.length} stale running tasks to pending`);
  }

  // Run immediately, then every 2 seconds
  tick();
  setInterval(tick, 2000);
}
