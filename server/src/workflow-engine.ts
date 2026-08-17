import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as db from './db.js';
import { register, getImpl, getAllWorkflows } from './workflows/registry.js';
import type {
  ProjectConfig,
  WorkflowDefinition,
  WorkflowRunContext,
  WorkflowVarsBase,
  VideoWorkflowSubmitData,
  VideoWorkflowSubmitParams,
} from './workflows/types.js';
import { buildSceneVideoSubmitData, type SceneAdapterDeps } from './workflows/scene-adapter.js';
import { getInstance, resolveInstanceConfig } from './providers/config-store.js';
import { getProvider } from './providers/registry.js';
import { mixAudioTracks } from './assets/audio-mix.js';
import { getBatchConcurrency } from './routes/workflow.js';
import { copyExistingAssetToHistory } from './assets/history.js';
import { isCancelRequested } from './workflows/cancel.js';
import { toNativeUserParams } from './workflows/user-params.js';

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
 * 将 wire 形态的视频提交参数（路径）解析为运行时形态（File）。
 * 画布节点提交的 params.video 走此转换，随后注入 ctx.video。
 *
 * @param project 项目名
 * @param wire wire 形态提交参数
 * @param readAssertFile 读取 assert/ 文件为 File 的回调
 * @returns 运行时形态视频提交数据
 */
async function resolveVideoSubmitData(
  project: string,
  wire: VideoWorkflowSubmitParams,
  readAssertFile: (relPath: string) => Promise<File>,
): Promise<VideoWorkflowSubmitData> {
  const director = wire.director
    ? {
        frames: await Promise.all(
          wire.director.frames.map(async (f) => ({ file: await readAssertFile(f.path), cursor: f.cursor })),
        ),
        ...(wire.director.audio ? { audio: await readAssertFile(wire.director.audio.path) } : {}),
      }
    : undefined;
  const references = wire.references
    ? await Promise.all(wire.references.map(async (r) => ({ type: r.type, file: await readAssertFile(r.path) })))
    : undefined;
  return {
    mode: wire.mode,
    resolution: wire.resolution,
    ...(wire.fps != null ? { fps: wire.fps } : {}),
    duration: wire.duration,
    prompt: wire.prompt,
    ...(wire.seed != null ? { seed: wire.seed } : {}),
    ...(director ? { director } : {}),
    ...(references ? { references } : {}),
    extraParams: wire.extraParams ?? {},
  };
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
      // 跳过测试文件（*.test.ts / *.spec.ts）：其顶层 vi.mock 在服务启动环境不可用
      if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
      if (file.endsWith('.test.ts') || file.endsWith('.spec.ts') || file.endsWith('.test.js')) continue;
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
  /** 是否禁用该场景帧：true 时视频生成（image-to-video）会跳过此帧 */
  disabled?: boolean;
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

  const prompt = emotion
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
      prompt,
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
 * image-edit / scene-stage-image：由引擎读取 stage.json，组装 prompt 与 imagePaths。
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
      prompt,
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

  // 重复生成时，将已有资产归档到历史版本（copy：原文件保留到新产物覆盖前，运行期间旧图持续可见）
  const archived = await copyExistingAssetToHistory(project, outputPath);
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
 * 执行单个任务（引擎主流程）。
 *
 * 按任务记录解析工作流实现，按实现绑定的服务商实例（providerInstanceId）查实例、
 * 解析实例配置创建 provider 客户端，随后提交/轮询/下载输出并写入 assert/。
 * 任何失败都会把任务标记为 failed（不自动重试）。
 *
 * @param taskId 任务 ID（db.tasks 主键）
 */
export async function runTask(taskId: string): Promise<void> {
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

  // 记录实现声明的能力（capabilities），供导演台负载注入等按需逻辑判断
  const capabilities = wf.capabilities;

  const paramsObj = JSON.parse(task.params) as {
    vars?: Record<string, string>;
    promptPaths?: string[];
    outputPath?: string;
    video?: VideoWorkflowSubmitParams;
    /** 本次执行的 Easy Bridge 提供商实例 ID（用户选择，仅 comfyui-bridge 工作流入库） */
    comfyuiProviderId?: string;
  };
  const projectConfig = await loadProjectConfig(task.project);

  // tts-voice-design + purpose=scene-tts：引擎统一读取台词/声线/情绪，并规范输出路径
  if (
    task.workflow_id === 'tts-voice-design'
    && (
      paramsObj.vars?.purpose === 'scene-tts'
      || (
        !paramsObj.vars?.prompt
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

  // tts-voice-design + purpose=character-voice：若未提供 prompt，从 voice.md 读取
  if (
    task.workflow_id === 'tts-voice-design'
    && paramsObj.vars?.purpose === 'character-voice'
    && !(paramsObj.vars?.prompt ?? '').trim()
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
      prompt: voiceDesc,
      text: (paramsObj.vars?.text ?? '').trim() || `你好，我叫${name}`,
    };
  }

  // image-edit + purpose=scene-stage-image：直接引用或组装 prompt/imagePaths
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
  // 用户可通过工作流参数声明手动传入 seed；未提供时引擎注入随机种子
  const userSeed = (paramsObj.vars?.seed ?? '').trim();
  const vars: WorkflowVarsBase & Record<string, string> = {
    ...(paramsObj.vars ?? {}),
    seed: userSeed !== '' ? userSeed : String(Date.now()),
  };

  const projectRoot = path.resolve(DESIGN_DIR, task.project) + path.sep;

  /**
   * 读取项目内文本文件（UTF-8）。
   * 路径相对 design/{project}/；越界（路径穿越）时抛错。
   */
  const readFile = async (relPath: string): Promise<string> => {
    const full = path.resolve(DESIGN_DIR, task.project, relPath);
    if (!full.startsWith(projectRoot)) {
      throw new Error('Path traversal denied');
    }
    return fs.readFile(full, 'utf-8');
  };

  /**
   * 读取项目 assert/ 下二进制文件为 File 对象。
   * 路径须以 assert/ 开头，相对 design/{project}/；按扩展名推断 MIME 类型。
   */
  const readAssertFile = async (relPath: string): Promise<File> => {
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
  };

  try {
    db.addLog(taskId, 'info', `Starting workflow: ${wf.name} (impl: ${wf.impl})`);
    db.updateTaskStatus(taskId, 'running');

    // ── Provider 解析：工作流实例 → 实例配置 → client（按请求实时解析，配置热加载）──
    const instanceId = wf.providerInstanceId;
    if (!instanceId) {
      throw new Error(`工作流 ${task.workflow_id}/${task.impl} 未绑定服务商实例`);
    }
    const instance = await getInstance(instanceId);
    if (!instance) {
      throw new Error(`工作流 ${task.workflow_id}/${task.impl} 绑定的服务商实例不存在: ${instanceId}`);
    }
    const providerDef = getProvider(instance.type);
    if (!providerDef) {
      throw new Error(`服务商类型未注册: ${instance.type}`);
    }
    const provider = providerDef.createClient(resolveInstanceConfig(instance));

    // ── 视频自包含提交数据 ──
    // 画布节点任务：params.video（wire 形态）→ 解析为 File 形态；
    // 分镜/批量任务：由场景适配层读取分镜文件组装（工作流实现不再读分镜文件）。
    let video: VideoWorkflowSubmitData | undefined;
    if (task.workflow_id === 'image-to-video') {
      if (paramsObj.video) {
        video = await resolveVideoSubmitData(task.project, paramsObj.video, readAssertFile);
      } else {
        const episode = vars.episode?.trim();
        const shot = vars.shot?.trim();
        if (!episode || !shot) {
          throw new Error('image-to-video 需要 params.video 或 vars.episode/vars.shot');
        }
        const sceneDeps: SceneAdapterDeps = {
          readFile,
          readAssertFile,
          fileExists: async (rel: string) => {
            const full = path.resolve(DESIGN_DIR, task.project, rel);
            if (!full.startsWith(projectRoot)) throw new Error('Path traversal denied');
            try {
              await fs.access(full);
              return true;
            } catch {
              return false;
            }
          },
          mixAudioTracks: async (tracks, out) => {
            await mixAudioTracks(
              tracks.map((t) => ({ ...t, filePath: resolveProjectAssertPath(task.project, t.filePath) })),
              out,
            );
          },
          readTempAudio: async (p) => new Uint8Array(await fs.readFile(p)),
          removeTempAudio: async (p) => {
            try {
              await fs.unlink(p);
            } catch {
              /* 忽略清理失败 */
            }
          },
          generateVoice: async (text, voiceDesc) => {
            // 拼接台词 → TTS 生成配音（失败降级返回 null，不注入音频）
            try {
              const ttsResult = await provider.execute({
                workflowId: 'tts_voice_design',
                params: { prompt: voiceDesc, text },
                // 内联 TTS 同样沿用本次任务选择的 Bridge 提供商实例
                ...(paramsObj.comfyuiProviderId ? { providerId: paramsObj.comfyuiProviderId } : {}),
              });
              let ttsOk = false;
              while (true) {
                await new Promise((r) => setTimeout(r, 1000));
                const ttsStatus = await provider.poll(ttsResult.taskId);
                if (ttsStatus.status === 'completed') { ttsOk = true; break; }
                if (ttsStatus.status === 'failed') {
                  console.warn(`TTS 生成失败，跳过音频: ${ttsStatus.errorMessage}`);
                  break;
                }
              }
              if (ttsOk) {
                const output = await provider.getOutput(ttsResult.taskId);
                if (output && output.type === 'fetch') {
                  const resp = await fetch(output.request.url, { headers: output.request.headers });
                  const blob = await resp.blob();
                  return new File([blob], 'voice-combined.flac', { type: 'audio/flac' });
                }
              }
              return null;
            } catch {
              return null;
            }
          },
        };
        video = await buildSceneVideoSubmitData(
          task.project,
          episode,
          shot,
          capabilities?.video,
          projectConfig,
          sceneDeps,
        );
      }
    }

    // 用户手动传入的工作流参数：任务创建时已由路由（normalizeUserParams）合并进 vars，
    // 此处按所选实现声明的参数 key 从 vars 中提取，并按声明类型转换为原生值
    // （boolean/number/string）注入上下文，供工作流 submit 透传给 Bridge payload
    const userParamsVars: Record<string, string> = {};
    for (const decl of wf.params ?? []) {
      const v = vars[decl.key];
      if (v !== undefined && v !== '') {
        userParamsVars[decl.key] = v;
      }
    }
    const userParams = toNativeUserParams(wf.params ?? [], userParamsVars);

    const runContext: WorkflowRunContext = {
      project: task.project,
      projectConfig,
      vars,
      provider,
      // 本次任务选择的 Easy Bridge 提供商实例（留空时由 Bridge 自行解析默认实例）
      comfyuiProviderId: paramsObj.comfyuiProviderId || undefined,
      ...(video ? { video } : {}),
      userParams,
      readFile,
      readAssertFile,
    };

    // Step 1: Submit
    db.addLog(taskId, 'info', `Submitting task to AI API (provider: ${instance.type}, instance: ${instanceId})...`);
    const { taskId: remoteTaskId } = await wf.submit(runContext);
    // 持久化远端任务 ID，供中断端点（/workflow/tasks/:id/cancel）使用。
    // 基于最新 params 合并（勿用提交前快照）：同步 provider 执行期间取消请求可能已写入
    // cancelRequested 标记，用旧快照会覆盖掉该标记，导致执行完成后无法识别取消。
    const taskParams = JSON.parse(task.params) as Record<string, unknown>;
    const latestTask = db.getTask(taskId);
    const latestParams = latestTask
      ? (JSON.parse(latestTask.params) as Record<string, unknown>)
      : taskParams;
    db.updateTaskParams(taskId, { ...latestParams, remoteTaskId });
    db.addLog(taskId, 'info', `Submitted, remote task ID: ${remoteTaskId}`);

    // Step 2: Poll
    // 不设轮询时间上限：视频等生成任务可能远超 5 分钟，轮询直到远端返回 done（completed/failed）。
    // 远端任务悬挂时用户可通过中断（cancel）兜底；provider 不可达时 poll 抛错 → 任务直接 failed。
    db.addLog(taskId, 'info', 'Polling task status...');
    const POLL_INTERVAL = 2000;
    while (true) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      const result = await provider.poll(remoteTaskId);
      db.addLog(taskId, 'debug', `Poll result: status=${result.status} progress=${result.progress}`);

      if (result.done) {
        db.addLog(taskId, 'info', `Task completed with status: ${result.status}`);
        // 远端任务失败：优先透出 provider 返回的错误详情（如 MiniMax 敏感内容/余额不足等），
        // 避免落到统一兜底「No output files found from provider task」而丢失真实原因
        if (result.status === 'failed') {
          throw new Error(result.errorMessage ?? '远端任务失败（未知原因）');
        }
        break;
      }
    }

    // Step 3: Parse output
    db.addLog(taskId, 'info', 'Parsing output...');
    const output = await provider.getOutput(remoteTaskId);
    if (!output) {
      throw new Error('No output files found from provider task');
    }

    // Step 4: Download/fetch output and write to assert/
    const outputPath = paramsObj.outputPath;
    if (!outputPath) {
      throw new Error('outputPath is required in task params');
    }
    const assertFullPath = resolveProjectAssertPath(task.project, outputPath);
    const assertDir = path.dirname(assertFullPath);

    // 同步 provider（deferredCancel）取消回调：execute 完成后检查取消标记，
    // 已请求取消 → 持久化失败（用户中断），不归档已有资产、不写产物
    const freshTask = db.getTask(taskId);
    if (freshTask && isCancelRequested(JSON.parse(freshTask.params))) {
      throw new Error('用户中断');
    }

    // 重复生成时，将已有资产归档到历史版本（copy：固定路径产物在生成期间不消失，预览不断链）
    const archived = await copyExistingAssetToHistory(task.project, outputPath);
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

    // 失败直接标记 failed，不做自动重试/重新提交：避免长时间任务因轮询超时被重复提交远端生成
    // （旧任务被遗弃仍消耗算力/费用）。需要重试时由用户通过节点「重试」/ POST /workflow/retry/:taskId 手动触发。
    db.updateTaskStatus(taskId, 'failed', { error_msg: msg });
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
