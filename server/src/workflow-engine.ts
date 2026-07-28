import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as db from './db.js';
import { register, getImpl, getAllWorkflows } from './workflows/registry.js';
import type { ProjectConfig, WorkflowDefinition, WorkflowParams, WorkflowVarsBase } from './workflows/types.js';
import { getBatchConcurrency } from './routes/workflow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.resolve(__dirname, '../../design');
const WORKFLOWS_DIR = path.resolve(__dirname, 'workflows');

// Re-export for API routes
export { getAllWorkflows };

/**
 * 读取项目级配置（project.json）。
 * 文件不存在或解析失败时返回 width/height 为 0 的默认配置。
 */
async function loadProjectConfig(project: string): Promise<ProjectConfig> {
  const configPath = path.resolve(DESIGN_DIR, project, 'project.json');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Partial<ProjectConfig>;
    return {
      width: config.width != null ? Number(config.width) : 0,
      height: config.height != null ? Number(config.height) : 0,
      aspectRatio: config.aspectRatio != null ? String(config.aspectRatio) : undefined,
    };
  } catch {
    // 文件不存在或解析失败，静默忽略以保持向后兼容
    return { width: 0, height: 0 };
  }
}

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

interface SceneStageDefinition {
  基础场景?: string;
  登场角色?: string[];
  prompt?: string;
}

function resolveProjectAssertPath(project: string, relPath: string): string {
  const full = path.resolve(DESIGN_DIR, project, relPath);
  const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;
  if (!full.startsWith(projectRoot)) {
    throw new Error(`Path traversal denied: ${relPath}`);
  }
  const relAssertPath = path.relative(path.resolve(DESIGN_DIR, project), full);
  if (!relAssertPath.startsWith('assert')) {
    throw new Error(`Path must be under assert/: ${relPath}`);
  }
  return full;
}

function parseBaseStageImagePath(baseStage: string): string {
  const trimmed = baseStage.trim();
  if (!trimmed) {
    throw new Error('基础场景不能为空');
  }
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new Error(`基础场景格式无效（期望 场景名/标签）: ${baseStage}`);
  }
  const stageName = trimmed.slice(0, slash);
  const stageLabel = trimmed.slice(slash + 1);
  return `assert/stage/${stageName}/${stageLabel}.jpg`;
}

interface ScriptLine {
  角色名?: string;
  台词?: string;
  情绪?: string;
}

/**
 * scene-tts：由引擎统一读取 script.json / voice.md，
 * 注入 character / text / voiceDesc / emotion，并规范输出路径为
 * assert/scene/{ep}/{shot}/voice/{index}-{character}.flac
 */
async function enrichSceneTtsParams(
  project: string,
  paramsObj: {
    vars?: Record<string, string>;
    promptPaths?: string[];
    outputPath?: string;
  },
): Promise<{
  vars: Record<string, string>;
  outputPath: string;
}> {
  const vars = { ...(paramsObj.vars ?? {}) };
  const episode = vars.episode?.trim();
  const shot = vars.shot?.trim();
  const indexStr = vars.index?.trim();
  if (!episode || !shot || indexStr == null || indexStr === '') {
    throw new Error('scene-tts 需要 vars.episode / vars.shot / vars.index');
  }

  const index = Number(indexStr);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`scene-tts 无效的台词序号 index=${indexStr}`);
  }

  const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;

  const scriptRel = `prompt/scene/${episode}/${shot}/script.json`;
  const scriptFull = path.resolve(DESIGN_DIR, project, scriptRel);
  if (!scriptFull.startsWith(projectRoot)) {
    throw new Error('Path traversal denied');
  }

  let script: ScriptLine[];
  try {
    const raw = await fs.readFile(scriptFull, 'utf-8');
    script = JSON.parse(raw) as ScriptLine[];
  } catch {
    throw new Error(`无法读取台词文件: ${scriptRel}`);
  }
  if (!Array.isArray(script)) {
    throw new Error(`script.json 格式无效: ${scriptRel}`);
  }
  if (index >= script.length) {
    throw new Error(`台词序号越界: index=${index}, script.json 共 ${script.length} 项`);
  }

  const line = script[index];
  const character = (line.角色名 ?? '').trim();
  const text = (line.台词 ?? '').trim();
  const emotion = (line.情绪 ?? '').trim();
  if (!character) {
    throw new Error(`台词 #${index} 缺少角色名`);
  }
  if (!text) {
    throw new Error(`台词 #${index}（${character}）内容为空`);
  }

  const voiceRel = `prompt/character/${character}/voice.md`;
  const voiceFull = path.resolve(DESIGN_DIR, project, voiceRel);
  if (!voiceFull.startsWith(projectRoot)) {
    throw new Error('Path traversal denied');
  }
  let voiceDesc: string;
  try {
    voiceDesc = (await fs.readFile(voiceFull, 'utf-8')).trim();
  } catch {
    throw new Error(`角色声线描述不存在: ${voiceRel}`);
  }
  if (!voiceDesc) {
    throw new Error(`角色声线描述为空: ${voiceRel}`);
  }

  const outputPath = `assert/scene/${episode}/${shot}/voice/${index}-${character}.flac`;

  return {
    vars: {
      ...vars,
      episode,
      shot,
      index: String(index),
      character,
      text,
      voiceDesc,
      emotion,
    },
    outputPath,
  };
}

/**
 * scene-stage-image 直接引用：登场角色与 prompt 同时为空时，
 * 由调度引擎将基础场景图复制为独立的分镜场景图资产，不调用 AI 工作流。
 * @returns true 表示已处理完成（成功或失败均已落库），调用方应直接 return
 */
async function tryHandleSceneStageDirectReference(
  taskId: string,
  project: string,
  paramsObj: { vars?: Record<string, string>; outputPath?: string },
): Promise<boolean> {
  const vars = paramsObj.vars ?? {};
  const { episode, shot } = vars;
  const index = Number(vars.index ?? '0');
  if (!episode || !shot || !Number.isInteger(index) || index < 0) {
    return false;
  }

  const stageJsonRel = `prompt/scene/${episode}/${shot}/stage.json`;
  const stageJsonFull = path.resolve(DESIGN_DIR, project, stageJsonRel);
  const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;
  if (!stageJsonFull.startsWith(projectRoot)) {
    throw new Error('Path traversal denied');
  }

  let defs: SceneStageDefinition[];
  try {
    const raw = await fs.readFile(stageJsonFull, 'utf-8');
    defs = JSON.parse(raw) as SceneStageDefinition[];
  } catch {
    // stage.json 不存在或无法解析时，交由工作流处理/报错
    return false;
  }
  if (!Array.isArray(defs) || index >= defs.length) {
    return false;
  }

  const stage = defs[index];
  const characters = stage.登场角色 ?? [];
  const prompt = (stage.prompt ?? '').trim();
  if (characters.length > 0 || prompt) {
    return false;
  }

  // 直接引用路径：复制基础场景图 → 分镜场景图资产
  db.addLog(taskId, 'info', '检测到直接引用基础场景（登场角色与 prompt 均为空），由调度引擎复制资产');
  db.updateTaskStatus(taskId, 'running');

  const outputPath = paramsObj.outputPath;
  if (!outputPath) {
    throw new Error('outputPath is required in task params');
  }

  const baseStage = (stage.基础场景 ?? '').trim();
  if (!baseStage) {
    throw new Error('基础场景不能为空');
  }

  const sourceRel = parseBaseStageImagePath(baseStage);
  const sourceFull = resolveProjectAssertPath(project, sourceRel);
  const destFull = resolveProjectAssertPath(project, outputPath);

  try {
    await fs.access(sourceFull);
  } catch {
    throw new Error(`基础场景图不存在: ${sourceRel}`);
  }

  await fs.mkdir(path.dirname(destFull), { recursive: true });
  await fs.copyFile(sourceFull, destFull);

  db.addLog(taskId, 'info', `已复制基础场景图 ${sourceRel} → ${outputPath}`);
  db.updateTaskStatus(taskId, 'completed', { result: { path: outputPath, directReference: true } });
  return true;
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

  const paramsObj = JSON.parse(task.params) as {
    vars?: Record<string, string>;
    promptPaths?: string[];
    outputPath?: string;
  };
  const projectConfig = await loadProjectConfig(task.project);

  // scene-tts：引擎统一读取台词/声线/情绪，并规范输出路径
  if (task.workflow_id === 'scene-tts') {
    const enriched = await enrichSceneTtsParams(task.project, paramsObj);
    paramsObj.vars = enriched.vars;
    paramsObj.outputPath = enriched.outputPath;
  }

  // vars 仅含业务字段 + 引擎注入的 seed；尺寸等走 projectConfig
  const vars: WorkflowVarsBase & Record<string, string> = {
    ...(paramsObj.vars ?? {}),
    seed: String(Date.now()),
  };

  const workflowParams: WorkflowParams = {
    project: task.project,
    vars,
    projectConfig,
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
    // scene-stage-image：直接引用由调度引擎处理，仍写出独立分镜场景图资产
    if (task.workflow_id === 'scene-stage-image') {
      const handled = await tryHandleSceneStageDirectReference(taskId, task.project, paramsObj);
      if (handled) {
        return;
      }
    }

    db.addLog(taskId, 'info', `Starting workflow: ${wf.name} (impl: ${wf.impl})`);
    db.updateTaskStatus(taskId, 'running');

    // Step 1: Submit
    db.addLog(taskId, 'info', 'Submitting task to AI API...');
    const { taskId: remoteTaskId } = await wf.submit(workflowParams);
    db.addLog(taskId, 'info', `Submitted, remote task ID: ${remoteTaskId}`);

    let pollResponse: Record<string, unknown> | undefined;

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

        db.addLog(taskId, 'debug', `Poll result: ${Object.keys(result).map(k => k + '=' + result[k]).join(',')}`);

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
    const assertFullPath = resolveProjectAssertPath(task.project, outputPath);
    const assertDir = path.dirname(assertFullPath);

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

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    db.addLog(taskId, 'error', `Task failed: ${msg}`);

    // Retry logic
    if (task.retry_count < task.max_retries) {
      db.incrementRetry(taskId);
      db.updateTaskStatus(taskId, 'pending');
      db.addLog(taskId, 'info', `Scheduled for retry (${task.retry_count + 1}/${task.max_retries})`);
    } else {
      db.updateTaskStatus(taskId, 'failed', { error_msg: msg });
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
      const allTasks = db.getPendingTasks();

      // Group tasks by batch_id
      const batchGroups = new Map<string, typeof allTasks>();
      const nonBatchTasks: typeof allTasks = [];

      for (const task of allTasks) {
        if (task.batch_id) {
          const group = batchGroups.get(task.batch_id) ?? [];
          group.push(task);
          batchGroups.set(task.batch_id, group);
        } else {
          nonBatchTasks.push(task);
        }
      }

      // Process non-batch tasks (backward compatible) — no concurrency limit
      for (const task of nonBatchTasks) {
        if (task.status === 'pending') {
          db.updateTaskStatus(task.id, 'running');
          runTask(task.id).catch(err => {
            console.error(`Task ${task.id} crashed:`, err);
          });
        }
      }

      // Process batch tasks with per-batch concurrency limit
      for (const [batchId, tasks] of batchGroups) {
        const concurrency = getBatchConcurrency(batchId);
        const runningCount = tasks.filter(t => t.status === 'running').length;
        const slots = concurrency - runningCount;

        if (slots > 0) {
          const pendingTasks = tasks.filter(t => t.status === 'pending');
          for (const task of pendingTasks.slice(0, slots)) {
            db.updateTaskStatus(task.id, 'running');
            runTask(task.id).catch(err => {
              console.error(`Task ${task.id} crashed:`, err);
            });
          }
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
