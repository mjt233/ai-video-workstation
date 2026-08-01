import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as db from './db.js';
import { register, getImpl, getAllWorkflows } from './workflows/registry.js';
import type { ProjectConfig, WorkflowDefinition, WorkflowParams, WorkflowVarsBase } from './workflows/types.js';
import { getBatchConcurrency } from './routes/workflow.js';
import { archiveExistingAsset } from './assets/history.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.resolve(__dirname, '../../design');
const WORKFLOWS_DIR = path.resolve(__dirname, 'workflows');

// Re-export for API routes
export { getAllWorkflows };

/**
 * 读取项目级配置（project.json）。
 * 文件不存在或解析失败时返回 width/height 为 0 的默认配置。
 */
const DEFAULT_PROJECT_FPS = 24;

async function loadProjectConfig(project: string): Promise<ProjectConfig> {
  const configPath = path.resolve(DESIGN_DIR, project, 'project.json');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Partial<ProjectConfig> & Record<string, unknown>;
    const fpsRaw = config.fps;
    const fpsNum = fpsRaw != null ? Number(fpsRaw) : DEFAULT_PROJECT_FPS;
    return {
      width: config.width != null ? Number(config.width) : 0,
      height: config.height != null ? Number(config.height) : 0,
      aspectRatio: config.aspectRatio != null ? String(config.aspectRatio) : undefined,
      fps: Number.isInteger(fpsNum) && fpsNum > 0 ? fpsNum : DEFAULT_PROJECT_FPS,
    };
  } catch {
    // 文件不存在或解析失败，静默忽略以保持向后兼容
    return { width: 0, height: 0, fps: DEFAULT_PROJECT_FPS };
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


interface ScriptLine {
  角色名?: string;
  台词?: string;
  情绪?: string;
}

/**
 * image-to-video：由引擎统一读取分镜 overview.json / stage.json，
 * 注入 duration（秒，正整数）与 stageImages（场景图相对路径 JSON 数组）。
 * 分辨率/帧率走 projectConfig。
 */
async function enrichImageToVideoParams(
  project: string,
  paramsObj: {
    vars?: Record<string, string>;
  },
): Promise<{
  vars: Record<string, string>;
}> {
  const vars = { ...(paramsObj.vars ?? {}) };
  const episode = vars.episode?.trim();
  const shot = vars.shot?.trim();
  if (!episode || !shot) {
    throw new Error('image-to-video 需要 vars.episode / vars.shot');
  }

  const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;

  const resolveUnderProject = (relPath: string): string => {
    const full = path.resolve(DESIGN_DIR, project, relPath);
    if (!full.startsWith(projectRoot)) {
      throw new Error(`Path traversal denied: ${relPath}`);
    }
    return full;
  };

  // ── duration from overview.json ──
  const overviewRel = `prompt/scene/${episode}/${shot}/overview.json`;
  let overview: { duration?: unknown };
  try {
    const raw = await fs.readFile(resolveUnderProject(overviewRel), 'utf-8');
    overview = JSON.parse(raw) as { duration?: unknown };
  } catch {
    throw new Error(`无法读取分镜总览: ${overviewRel}`);
  }
  if (!overview || typeof overview !== 'object' || Array.isArray(overview)) {
    throw new Error(`overview.json 格式无效: ${overviewRel}`);
  }

  const duration = overview.duration;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration <= 0) {
    throw new Error(
      `分镜时长无效（overview.json.duration 须为正整数秒）: ${overviewRel}, 当前=${String(duration)}`,
    );
  }

  // ── stage images from stage.json + assert/scene/.../stage/{i}.jpg ──
  const stageJsonRel = `prompt/scene/${episode}/${shot}/stage.json`;
  let stageDefs: unknown;
  try {
    const raw = await fs.readFile(resolveUnderProject(stageJsonRel), 'utf-8');
    stageDefs = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`无法读取分镜场景定义: ${stageJsonRel}`);
  }
  if (!Array.isArray(stageDefs) || stageDefs.length === 0) {
    throw new Error(`stage.json 须为非空数组: ${stageJsonRel}`);
  }

  const stageImages: string[] = [];
  const missing: string[] = [];
  for (let i = 0; i < stageDefs.length; i++) {
    const rel = `assert/scene/${episode}/${shot}/stage/${i}.jpg`;
    const full = resolveUnderProject(rel);
    try {
      await fs.access(full);
      stageImages.push(rel);
    } catch {
      missing.push(rel);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `分镜场景图缺失（请先生成 scene-stage-image / image-edit）: ${missing.join(', ')}`,
    );
  }

  // ── merged audio from audio-edit.json ──
  let audioPath = '';
  const audioEditRel = `prompt/scene/${episode}/${shot}/audio-edit.json`;
  const mergedAudioRel = `assert/scene/${episode}/${shot}/audio/merged.flac`;
  try {
    await fs.access(resolveUnderProject(audioEditRel));
    await fs.access(resolveUnderProject(mergedAudioRel));
    audioPath = mergedAudioRel;
  } catch {
    // 没有音频编辑或合并产物，跳过
  }

  return {
    vars: {
      ...vars,
      episode,
      shot,
      duration: String(duration),
      stageImages: JSON.stringify(stageImages),
      ...(audioPath ? { audioPath } : {}),
    },
  };
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

  const desc = emotion
    ? `${voiceDesc}\n当前情绪：${emotion}`
    : voiceDesc;

  return {
    vars: {
      ...vars,
      purpose: 'scene-tts',
      episode,
      shot,
      index: String(index),
      character,
      text,
      voiceDesc,
      emotion,
      desc,
    },
    outputPath,
  };
}

/**
 * scene-stage-image 直接引用：登场角色与 prompt 同时为空时，
 * 由调度引擎将基础场景图复制为独立的分镜场景图资产，不调用 AI 工作流。
 * @returns true 表示已处理完成（成功或失败均已落库），调用方应直接 return
 */

/**
 * 解析基础场景引用为 assert 路径（不含 `prev`）。
 * 支持：
 * - `场景名/标签` → assert/stage/{场景名}/{标签}.jpg
 * - `场景名/标签@变体id` → assert/stage/{场景名}/variants/{标签}/{变体id}.jpg
 * - `custom/{路径}` → assert/custom/{路径}（自定义资产引用，路径含扩展名）
 * @param baseStage 基础场景引用
 * @returns assert 相对路径
 */
function resolveStageAssetPath(baseStage: string): string {
  const trimmed = baseStage.trim();
  if (!trimmed) throw new Error('基础场景不能为空');
  if (trimmed === 'prev') {
    throw new Error('基础场景 prev 需结合分镜上下文解析，不能单独解析为 stage 资产路径');
  }
  // 自定义资产引用：custom/{相对 assert/custom 的完整路径（含扩展名）}
  if (trimmed.startsWith('custom/')) {
    return `assert/custom/${trimmed.slice('custom/'.length)}`;
  }
  const at = trimmed.indexOf('@');
  const main = at >= 0 ? trimmed.slice(0, at) : trimmed;
  const variantId = at >= 0 ? trimmed.slice(at + 1).trim() : '';
  const slash = main.indexOf('/');
  if (slash <= 0 || slash === main.length - 1) {
    throw new Error(`基础场景格式无效（期望 场景名/标签、场景名/标签@变体，或关键字 prev）: ${baseStage}`);
  }
  const stageName = main.slice(0, slash);
  const stageLabel = main.slice(slash + 1);
  if (variantId) {
    return `assert/stage/${stageName}/variants/${stageLabel}/${variantId}.jpg`;
  }
  return `assert/stage/${stageName}/${stageLabel}.jpg`;
}

/**
 * 解析 `prev`：同集上一分镜 stage.json 最后一项对应的分镜场景图。
 * @param project 项目名
 * @param episode 集数
 * @param shot 当前分镜编号
 * @returns assert 相对路径
 */
async function resolvePrevStageAssetPath(
  project: string,
  episode: string,
  shot: string,
): Promise<string> {
  const shotNum = Number(String(shot).trim());
  if (!Number.isInteger(shotNum) || shotNum <= 1) {
    throw new Error('第 1 个分镜不能使用基础场景 prev（无上一分镜）');
  }
  const prevShot = String(shotNum - 1);
  const prevStageJsonRel = `prompt/scene/${episode}/${prevShot}/stage.json`;
  const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;
  const prevStageJsonFull = path.resolve(DESIGN_DIR, project, prevStageJsonRel);
  if (!prevStageJsonFull.startsWith(projectRoot)) {
    throw new Error('Path traversal denied');
  }

  let prevDefs: SceneStageDefinition[];
  try {
    const raw = await fs.readFile(prevStageJsonFull, 'utf-8');
    prevDefs = JSON.parse(raw) as SceneStageDefinition[];
  } catch {
    throw new Error(`无法读取上一分镜场景定义: ${prevStageJsonRel}`);
  }
  if (!Array.isArray(prevDefs) || prevDefs.length === 0) {
    throw new Error(`上一分镜 ${episode}/${prevShot} 的 stage.json 为空，无法引用 prev`);
  }
  const lastIndex = prevDefs.length - 1;
  return `assert/scene/${episode}/${prevShot}/stage/${lastIndex}.jpg`;
}

/**
 * 解析角色引用为 assert 路径。
 * 支持：
 * - `角色名` → assert/character/{角色名}/appearance.jpg
 * - `角色名@变体id` → assert/character/{角色名}/variants/{变体id}.jpg
 * - `custom/{路径}` → assert/custom/{路径}（自定义资产引用，路径含扩展名）
 */
function resolveCharacterAssetPath(character: string): string {
  const trimmed = character.trim();
  if (!trimmed) throw new Error('角色名不能为空');
  // 自定义资产引用：custom/{相对 assert/custom 的完整路径（含扩展名）}
  if (trimmed.startsWith('custom/')) {
    return `assert/custom/${trimmed.slice('custom/'.length)}`;
  }
  const at = trimmed.indexOf('@');
  if (at < 0) {
    return `assert/character/${trimmed}/appearance.jpg`;
  }
  const name = trimmed.slice(0, at).trim();
  const variantId = trimmed.slice(at + 1).trim();
  if (!name || !variantId) {
    throw new Error(`角色引用格式无效（期望 角色名 或 角色名@变体）: ${character}`);
  }
  return `assert/character/${name}/variants/${variantId}.jpg`;
}

/**
 * image-edit / scene-stage-image：由引擎读取 stage.json，组装 desc 与 imagePaths。
 * 直接引用（无角色且无 prompt）由 tryHandleSceneStageDirectReference 处理，不应进入本函数。
 */
async function enrichSceneStageImageParams(
  project: string,
  paramsObj: {
    vars?: Record<string, string>;
    outputPath?: string;
  },
): Promise<{
  vars: Record<string, string>;
}> {
  const vars = { ...(paramsObj.vars ?? {}) };
  const episode = vars.episode?.trim();
  const shot = vars.shot?.trim();
  const indexStr = vars.index?.trim() ?? '0';
  if (!episode || !shot) {
    throw new Error('scene-stage-image 需要 vars.episode / vars.shot / vars.index');
  }
  const index = Number(indexStr);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`scene-stage-image 无效的分镜场景索引 index=${indexStr}`);
  }

  const stageJsonRel = `prompt/scene/${episode}/${shot}/stage.json`;
  const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;
  const stageJsonFull = path.resolve(DESIGN_DIR, project, stageJsonRel);
  if (!stageJsonFull.startsWith(projectRoot)) {
    throw new Error('Path traversal denied');
  }

  let defs: SceneStageDefinition[];
  try {
    const raw = await fs.readFile(stageJsonFull, 'utf-8');
    defs = JSON.parse(raw) as SceneStageDefinition[];
  } catch {
    throw new Error(`无法读取分镜场景定义: ${stageJsonRel}`);
  }
  if (!Array.isArray(defs) || index >= defs.length) {
    throw new Error(
      `分镜场景索引越界: index=${index}, stage.json 共 ${Array.isArray(defs) ? defs.length : 0} 项`,
    );
  }

  const stage = defs[index];
  const baseStage = (stage.基础场景 ?? '').trim();
  if (!baseStage) {
    throw new Error('基础场景不能为空');
  }
  if (baseStage === 'prev') {
    throw new Error('基础场景 prev 仅支持直接引用，不能用于图像编辑合成');
  }
  const characters = stage.登场角色 ?? [];
  const prompt = (stage.prompt ?? '').trim();
  if (characters.length === 0 && !prompt) {
    throw new Error('直接引用基础场景应由调度引擎处理，不应进入图像编辑参数组装');
  }
  if (!prompt) {
    throw new Error('非直接引用时 prompt 不能为空（有登场角色时必须提供合成提示词）');
  }

  const imagePaths: string[] = [];
  imagePaths.push(resolveStageAssetPath(baseStage));
  for (const character of characters) {
    imagePaths.push(resolveCharacterAssetPath(character));
  }

  return {
    vars: {
      ...vars,
      purpose: 'scene-stage-image',
      episode,
      shot,
      index: String(index),
      desc: prompt,
      imagePaths: JSON.stringify(imagePaths),
    },
  };
}

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

  // 直接引用路径：复制基础场景图 / 上一分镜最后场景图 → 分镜场景图资产
  const baseStage = (stage.基础场景 ?? '').trim();
  if (!baseStage) {
    throw new Error('基础场景不能为空');
  }

  const isPrev = baseStage === 'prev';
  db.addLog(
    taskId,
    'info',
    isPrev
      ? '检测到直接引用上一分镜最后场景（基础场景=prev，登场角色与 prompt 均为空），由调度引擎复制资产'
      : '检测到直接引用基础场景（登场角色与 prompt 均为空），由调度引擎复制资产',
  );
  db.updateTaskStatus(taskId, 'running');

  const outputPath = paramsObj.outputPath;
  if (!outputPath) {
    throw new Error('outputPath is required in task params');
  }

  const sourceRel = isPrev
    ? await resolvePrevStageAssetPath(project, episode, shot)
    : resolveStageAssetPath(baseStage);
  const sourceFull = resolveProjectAssertPath(project, sourceRel);
  const destFull = resolveProjectAssertPath(project, outputPath);

  try {
    await fs.access(sourceFull);
  } catch {
    throw new Error(
      isPrev
        ? `上一分镜最后场景图不存在: ${sourceRel}（请先生成上一分镜对应场景图）`
        : `基础场景图不存在: ${sourceRel}`,
    );
  }

  const archived = await archiveExistingAsset(project, outputPath);
  if (archived) {
    db.addLog(taskId, 'info', `已有资产已归档为历史版本: ${archived}`);
  }

  await fs.mkdir(path.dirname(destFull), { recursive: true });
  await fs.copyFile(sourceFull, destFull);

  db.addLog(
    taskId,
    'info',
    isPrev
      ? `已复制上一分镜最后场景图 ${sourceRel} → ${outputPath}`
      : `已复制基础场景图 ${sourceRel} → ${outputPath}`,
  );
  db.updateTaskStatus(taskId, 'completed', {
    result: { path: outputPath, directReference: true, prevReference: isPrev },
  });
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

  // tts-voice-design + purpose=scene-tts：引擎统一读取台词/声线/情绪，并规范输出路径
  if (
    task.workflow_id === 'tts-voice-design'
    && (
      paramsObj.vars?.purpose === 'scene-tts'
      || (
        !paramsObj.vars?.desc
        && !!paramsObj.vars?.episode
        && !!paramsObj.vars?.shot
        && paramsObj.vars?.index != null
        && paramsObj.vars?.index !== ''
      )
    )
  ) {
    const enriched = await enrichSceneTtsParams(task.project, paramsObj);
    paramsObj.vars = enriched.vars;
    paramsObj.outputPath = enriched.outputPath;
  }

  // tts-voice-design + purpose=character-voice：若未提供 desc，从 voice.md 读取
  if (
    task.workflow_id === 'tts-voice-design'
    && paramsObj.vars?.purpose === 'character-voice'
    && !(paramsObj.vars?.desc ?? '').trim()
  ) {
    const name = (paramsObj.vars?.character || paramsObj.vars?.name || '').trim();
    if (!name) {
      throw new Error('character-voice 需要 vars.character 或 vars.name');
    }
    const voiceRel = `prompt/character/${name}/voice.md`;
    const projectRoot = path.resolve(DESIGN_DIR, task.project) + path.sep;
    const voiceFull = path.resolve(DESIGN_DIR, task.project, voiceRel);
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
    paramsObj.vars = {
      ...paramsObj.vars,
      purpose: 'character-voice',
      character: name,
      name,
      desc: voiceDesc,
      text: (paramsObj.vars?.text ?? '').trim() || `你好，我叫${name}`,
    };
  }

  // image-to-video：引擎统一读取 overview.json / stage 图路径
  if (task.workflow_id === 'image-to-video') {
    const enriched = await enrichImageToVideoParams(task.project, paramsObj);
    paramsObj.vars = enriched.vars;
  }

  // image-edit + purpose=scene-stage-image：直接引用或组装 desc/imagePaths
  if (
    task.workflow_id === 'image-edit'
    && paramsObj.vars?.purpose === 'scene-stage-image'
  ) {
    const handled = await tryHandleSceneStageDirectReference(taskId, task.project, paramsObj);
    if (handled) {
      return;
    }
    const enriched = await enrichSceneStageImageParams(task.project, paramsObj);
    paramsObj.vars = enriched.vars;
  }

  // vars 仅含业务字段 + 引擎注入的 seed；尺寸/帧率等走 projectConfig
  const vars: WorkflowVarsBase & Record<string, string> = {
    ...(paramsObj.vars ?? {}),
    seed: String(Date.now()),
  };

  const projectRoot = path.resolve(DESIGN_DIR, task.project) + path.sep;

  const workflowParams: WorkflowParams = {
    project: task.project,
    vars,
    projectConfig,
    async readFile(relPath: string): Promise<string> {
      const full = path.resolve(DESIGN_DIR, task.project, relPath);
      if (!full.startsWith(projectRoot)) {
        throw new Error('Path traversal denied');
      }
      return fs.readFile(full, 'utf-8');
    },
    async readAssertFile(relPath: string): Promise<File> {
      const full = path.resolve(DESIGN_DIR, task.project, relPath);
      if (!full.startsWith(projectRoot)) {
        throw new Error(`Path traversal denied: ${relPath}`);
      }
      const relAssertPath = path.relative(path.resolve(DESIGN_DIR, task.project), full);
      // Windows 下 relative 使用反斜杠，统一为正斜杠再判断
      const normalized = relAssertPath.split(path.sep).join('/');
      if (!normalized.startsWith('assert/') && normalized !== 'assert') {
        throw new Error(`Path must be under assert/: ${relPath}`);
      }
      try {
        const buf = await fs.readFile(full);
        const filename = path.basename(full);
        const ext = path.extname(filename).toLowerCase();
        const type =
          ext === '.png' ? 'image/png'
            : ext === '.webp' ? 'image/webp'
              : ext === '.flac' ? 'audio/flac'
                : ext === '.mp4' ? 'video/mp4'
                  : 'image/jpeg';
        return new File([buf], filename, { type });
      } catch {
        throw new Error(`assert 文件不存在: ${relPath}`);
      }
    },
  };

  try {
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

    // 重复生成时，将已有资产归档到历史版本
    const archived = await archiveExistingAsset(task.project, outputPath);
    if (archived) {
      db.addLog(taskId, 'info', `已有资产已归档为历史版本: ${archived}`);
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
        headers: output.request.headers,
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

      // Process batch tasks with per-batch concurrency limit + phase ordering
      for (const [batchId, tasks] of batchGroups) {
        // 找出当前批次的最低 active phase（有 pending 或 running 任务的最小 phase）
        const phases = [...new Set(tasks.map(t => t.phase))].sort((a, b) => a - b);
        let currentPhase = phases[0];
        for (const ph of phases) {
          const hasIncomplete = tasks.some(
            t => t.phase === ph && (t.status === 'pending' || t.status === 'running'),
          );
          if (hasIncomplete) {
            currentPhase = ph;
            break;
          }
        }

        // 检查更低 phase 的任务是否全部 completed
        const lowerPhasesDone = phases
          .filter(ph => ph < currentPhase)
          .every(ph => tasks
            .filter(t => t.phase === ph)
            .every(t => t.status === 'completed'),
          );

        if (!lowerPhasesDone) {
          continue; // 前置阶段未完成，本轮不启动该批次任务
        }

        const concurrency = getBatchConcurrency(batchId);
        const runningCount = tasks.filter(
          t => t.phase === currentPhase && t.status === 'running',
        ).length;
        const slots = concurrency - runningCount;

        if (slots > 0) {
          const pendingTasks = tasks.filter(
            t => t.phase === currentPhase && t.status === 'pending',
          );
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
