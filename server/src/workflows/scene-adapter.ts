/**
 * 场景适配层：将"分镜/集数"维度的文件数据组装为自包含的视频提交数据
 * （VideoWorkflowSubmitData），供工作流实现直接消费。
 *
 * 这是执行解耦的核心：分镜/批量路径由引擎调用本模块读取
 * director.json / overview.json / stage.json / script.json / voice.md / prompt.md，
 * 组装成与画布节点一致的自包含数据；工作流实现内部不再读取任何分镜文件。
 */
import { buildDirectorPayload, type DirectorInjectDeps } from './director-inject.js';
import type { ProjectConfig, VideoCapabilities, VideoWorkflowSubmitData } from './types.js';

/** 场景适配层依赖集合（由引擎注入，便于单测 mock） */
export interface SceneAdapterDeps extends DirectorInjectDeps {
  /** 判断项目内相对路径是否存在 */
  fileExists(rel: string): Promise<boolean>;
  /** 拼接台词生成配音；返回 null 表示无台词/生成失败降级（不注入音频） */
  generateVoice(text: string, voiceDesc: string): Promise<File | null>;
}

/** 场景帧定义（stage.json 元素的最小形态） */
interface SceneStageDef {
  基础场景?: string;
  登场角色?: string[];
  prompt?: string;
  /** 是否禁用该场景帧：true 时视频生成跳过此帧 */
  disabled?: boolean;
}

/** 台词行（script.json 元素） */
interface ScriptLine {
  角色名?: string;
  台词?: string;
}

/**
 * 读取分镜 prompt.md 并校验非空。
 *
 * @param deps 场景适配层依赖
 * @param episode 集数
 * @param shot 分镜编号
 * @returns 提示词文本
 * @throws {Error} prompt.md 不存在或为空时
 */
async function readScenePrompt(deps: SceneAdapterDeps, episode: string, shot: string): Promise<string> {
  const prompt = (await deps.readFile(`prompt/scene/${episode}/${shot}/prompt.md`)).trim();
  if (!prompt) {
    throw new Error('分镜 prompt.md 为空');
  }
  return prompt;
}

/**
 * 从 overview.json 读取分镜时长（正整数秒）。
 *
 * @param deps 场景适配层依赖
 * @param episode 集数
 * @param shot 分镜编号
 * @returns 时长（秒）
 */
async function readSceneDuration(deps: SceneAdapterDeps, episode: string, shot: string): Promise<number> {
  const raw = await deps.readFile(`prompt/scene/${episode}/${shot}/overview.json`);
  const overview = JSON.parse(raw) as { duration?: unknown };
  if (typeof overview.duration !== 'number' || !Number.isInteger(overview.duration) || overview.duration <= 0) {
    throw new Error(`分镜时长无效（overview.json.duration 须为正整数秒）: ${String(overview.duration)}`);
  }
  return overview.duration;
}

/**
 * 收集分镜启用（未禁用）的场景帧图片路径，并按 index 升序返回。
 * 缺失图片时抛错（与既有 enrichImageToVideoParams 行为一致）。
 *
 * @param deps 场景适配层依赖
 * @param episode 集数
 * @param shot 分镜编号
 * @returns assert/ 相对路径数组
 */
async function collectStageImages(deps: SceneAdapterDeps, episode: string, shot: string): Promise<string[]> {
  const raw = await deps.readFile(`prompt/scene/${episode}/${shot}/stage.json`);
  const stageDefs = JSON.parse(raw) as unknown;
  if (!Array.isArray(stageDefs) || stageDefs.length === 0) {
    throw new Error('stage.json 须为非空数组');
  }
  const images: string[] = [];
  for (let i = 0; i < stageDefs.length; i++) {
    const def = stageDefs[i] as SceneStageDef | undefined;
    if (def && def.disabled === true) continue;
    const rel = `assert/scene/${episode}/${shot}/stage/${i}.jpg`;
    if (await deps.fileExists(rel)) {
      images.push(rel);
    } else {
      throw new Error(`分镜场景图缺失（请先生成 scene-stage-image / image-edit）: ${rel}`);
    }
  }
  if (images.length < 1) {
    throw new Error('分镜没有可用的场景帧（stage.json 为空或全部禁用）');
  }
  return images;
}

/**
 * 计算首尾帧模式下第 i 帧的 cursor：首帧 0、尾帧 1、中间帧均匀分布。
 *
 * @param index 帧序号（0 起）
 * @param total 帧总数
 * @returns cursor 值（0~1）
 */
export function stageCursor(index: number, total: number): number {
  if (total <= 1) return 0;
  return index / (total - 1);
}

/**
 * 依据 script.json 拼接台词并调用 generateVoice 生成配音。
 * script.json 缺失/无台词/生成失败时返回 undefined（不注入音频）。
 *
 * @param deps 场景适配层依赖
 * @param episode 集数
 * @param shot 分镜编号
 * @returns 配音 File 或 undefined
 */
async function buildTtsAudio(deps: SceneAdapterDeps, episode: string, shot: string): Promise<File | undefined> {
  try {
    const scriptRaw = await deps.readFile(`prompt/scene/${episode}/${shot}/script.json`);
    const script = JSON.parse(scriptRaw) as unknown;
    if (!Array.isArray(script)) return undefined;
    const lines = script as ScriptLine[];
    const texts = lines.map((l) => (l.台词 ?? '').trim()).filter(Boolean);
    if (texts.length === 0) return undefined;
    const combined = texts.join('。') + '。';

    const firstChar = lines.find((l) => (l.角色名 ?? '').trim());
    let desc = '自然、清晰的中文女声，语速适中，情感平和。';
    if (firstChar?.角色名) {
      try {
        const voiceMd = await deps.readFile(`prompt/character/${firstChar.角色名.trim()}/voice.md`);
        if (voiceMd.trim()) desc = voiceMd.trim();
      } catch {
        // voice.md 缺失则保持默认声线描述
      }
    }
    return (await deps.generateVoice(combined, desc)) ?? undefined;
  } catch {
    // script.json 不存在或无效 → 没有台词，不生成音频
    return undefined;
  }
}

/**
 * 组装场景自包含视频提交数据。
 *
 * 模式优先级：
 * 1. 实现声明支持 director 且分镜存在 director.json（含有效 imageClips）→ 导演台模式，
 *    复用 buildDirectorPayload（含用户滑块 cursor 与混音音频）；
 * 2. 否则 → 首尾帧模式：stage.json 启用帧 + cursor 均匀分布 + 音频
 *    （优先 merged.flac，其次 script.json TTS）。
 *
 * @param project 项目名
 * @param episode 集数
 * @param shot 分镜编号
 * @param capabilities 所选实现的视频能力声明（可为空）
 * @param projectConfig 项目配置（分辨率/帧率兜底）
 * @param deps 场景适配层依赖
 * @returns 自包含视频提交数据
 */
export async function buildSceneVideoSubmitData(
  project: string,
  episode: string,
  shot: string,
  capabilities: VideoCapabilities | undefined,
  projectConfig: ProjectConfig,
  deps: SceneAdapterDeps,
): Promise<VideoWorkflowSubmitData> {
  const prompt = await readScenePrompt(deps, episode, shot);

  // ── 导演台模式 ──
  if (capabilities?.modes?.includes('director')) {
    const payload = await buildDirectorPayload(project, episode, shot, deps);
    if (payload) {
      return {
        mode: 'director',
        resolution: { width: payload.width, height: payload.height },
        fps: payload.fps,
        duration: payload.duration,
        prompt,
        director: {
          frames: payload.frames.map((f) => ({ file: f.file, cursor: f.cursor })),
          ...(payload.audio ? { audio: payload.audio } : {}),
        },
        extraParams: {},
      };
    }
  }

  // ── 首尾帧模式 ──
  const duration = await readSceneDuration(deps, episode, shot);
  const stageImages = await collectStageImages(deps, episode, shot);
  const files = await Promise.all(stageImages.map((p) => deps.readAssertFile(p)));
  const frames = files.map((file, i) => ({ file, cursor: stageCursor(i, files.length) }));

  let audio: File | undefined;
  const mergedRel = `assert/scene/${episode}/${shot}/audio/merged.flac`;
  if (await deps.fileExists(mergedRel)) {
    audio = await deps.readAssertFile(mergedRel);
  } else {
    audio = await buildTtsAudio(deps, episode, shot);
  }

  return {
    mode: 'first-last-frame',
    resolution: { width: projectConfig.width, height: projectConfig.height },
    fps: projectConfig.fps,
    duration,
    prompt,
    director: { frames, ...(audio ? { audio } : {}) },
    extraParams: {},
  };
}
