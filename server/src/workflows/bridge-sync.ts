import { getProviderConfig } from '../providers/config-store.js';
import { getProvider } from '../providers/registry.js';
import type {
  BridgeTagGroup,
  BridgeWorkflowDetail,
  BridgeWorkflowSummary,
  ComfyuiBridgeClient,
} from '../providers/comfyui-bridge/client.js';
import { getAllWorkflows, register, unregister } from './registry.js';
import { deriveCapabilities, deriveParams, deriveWorkflowType, type BridgeDerivedType } from './bridge-derive.js';
import {
  buildDirectorPayload,
  buildFirstLastFramePayload,
  buildImageEditPayload,
  buildReferencePayload,
  buildTextToImagePayload,
  buildTtsPayload,
  resolveImageEditSizeParams,
} from './bridge-client.js';
import type {
  VideoWorkflowSubmitData,
  WorkflowCapabilities,
  WorkflowDefinition,
  WorkflowRunContext,
  WorkflowVarsBase,
} from './types.js';

/** ComfyUI Bridge Provider 插件 id */
const PROVIDER_ID = 'comfyui-bridge';

/** 动态注册实现标识前缀：impl = ceb-{bridge workflow id} */
const IMPL_PREFIX = 'ceb-';

/** 并发同步串行化：重叠调用共享同一 promise（in-flight 完成后置空） */
let inflight: Promise<void> | null = null;

/**
 * 从自动注册标签元数据取 expose_field（逗号分隔的用户可配置参数字段别名）。
 * 标签可能是顶层分组或某分组的子标签，两者都查。
 *
 * @param tags Bridge 工作流详情返回的标签分组数组
 * @param tagId 自动注册标签 id（expose_field 元数据挂在该标签或其子标签上）
 * @returns expose_field 值（字符串）；标签或元数据缺失返回 undefined
 */
function exposeFieldOf(tags: BridgeTagGroup[], tagId: string): string | undefined {
  for (const g of tags) {
    if (g.id === tagId) {
      const v = (g.metadata ?? {})['expose_field'];
      if (v != null) return String(v);
    }
    const child = (g.tags ?? []).find((c) => c.id === tagId);
    if (child) {
      const v = (child.metadata ?? {})['expose_field'];
      if (v != null) return String(v);
    }
  }
  return undefined;
}

/**
 * 以工作流 id 集合驱动陈旧清理：unregister 掉本次列表之外的所有 ceb-* 实现。
 *
 * 以 summaries 的 id 集合为准（而非注册键），详情拉取失败的工作流 id 仍在集合中，
 * 因此其旧注册会被保留；列表不再出现的工作流才被清理。
 *
 * @param summaryIds 本次列表中出现的工作流 id 集合
 */
function cleanupStale(summaryIds: Set<string>): void {
  for (const wf of getAllWorkflows()) {
    for (const impl of wf.implementations) {
      if (impl.provider !== PROVIDER_ID || !impl.impl.startsWith(IMPL_PREFIX)) continue;
      const id = impl.impl.slice(IMPL_PREFIX.length);
      if (!summaryIds.has(id)) unregister(wf.type, impl.impl);
    }
  }
}

/** TextToImageVars 形状（避免与业务 vars 强耦合，仅取本模块使用的字段） */
interface TextToImageVarsLike extends WorkflowVarsBase {
  /** 提示词文件相对路径（相对 design/{project}/） */
  promptPath?: string;
  /** 是否启用指定输出尺寸（"true" 时 width/height 生效） */
  enable_specified_size?: string;
  /** 覆盖宽度（像素，字符串形式） */
  width?: string;
  /** 覆盖高度（像素，字符串形式） */
  height?: string;
  /** 提示词强化开关（"true"/"false"） */
  enhance_prompt?: string;
}

/**
 * 文生图提交实现。
 *
 * 读取 vars.promptPath 对应的提示词文件内容作为 prompt；输出尺寸按
 * enable_specified_size 门控：为 "true" 且 width/height 非空时覆盖 projectConfig，
 * 否则回退 projectConfig（缺省 1080×1920）。
 *
 * @param workflowId 注册后的实现标识（ceb-{id}），透传给 Bridge execute
 * @returns 动态工作流 submit 函数
 */
/**
 * 解析覆盖尺寸：仅接受有限正数（与 resolveImageEditSizeParams 行为一致），否则回退默认值。
 *
 * @param value 用户传入的尺寸字符串（可空）
 * @param fallback 回退值（projectConfig 或缺省 1080/1920）
 * @returns 有效覆盖尺寸或回退值
 */
function resolveOverrideSize(value: string | undefined, fallback: number): number {
  if (!value || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function textToImageSubmit(workflowId: string): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<TextToImageVarsLike>) => {
    const promptPath = ctx.vars.promptPath?.trim();
    if (!promptPath) throw new Error('text-to-image 需要 vars.promptPath');
    const prompt = await ctx.readFile(promptPath);
    const specified = ctx.vars.enable_specified_size === 'true';
    const width = specified
      ? resolveOverrideSize(ctx.vars.width, ctx.projectConfig.width || 1080)
      : (ctx.projectConfig.width || 1080);
    const height = specified
      ? resolveOverrideSize(ctx.vars.height, ctx.projectConfig.height || 1920)
      : (ctx.projectConfig.height || 1920);
    const seed = ctx.vars.seed ? Number(ctx.vars.seed) : undefined;
    const enhance = ctx.vars.enhance_prompt === 'true';
    return ctx.provider.execute(buildTextToImagePayload({ workflowId, prompt, width, height, seed, enhance_prompt: enhance }));
  };
}

/**
 * TTS 音色设计提交实现。
 *
 * 声线描述与朗读文本均来自 vars（prompt / text），任一项缺失即报错。
 *
 * @param workflowId 注册后的实现标识（ceb-{id}），透传给 Bridge execute
 * @returns 动态工作流 submit 函数
 */
function ttsSubmit(workflowId: string): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<WorkflowVarsBase>) => {
    const vars = ctx.vars as Record<string, string | undefined>;
    const prompt = (vars.prompt ?? '').trim();
    const text = (vars.text ?? '').trim();
    if (!prompt) throw new Error('tts-voice-design 需要 vars.prompt（声线描述）');
    if (!text) throw new Error('tts-voice-design 需要 vars.text（朗读文本）');
    return ctx.provider.execute(buildTtsPayload({ workflowId, prompt, text, seed: vars.seed }));
  };
}

/**
 * 图片编辑提交实现。
 *
 * vars.imagePaths 为 JSON 字符串数组（相对 design/{project}/ 的 assert/ 路径）；
 * 逐个经 ctx.readAssertFile 解析为 File 后按顺序映射 image_{n} 上传。
 *
 * @param workflowId 注册后的实现标识（ceb-{id}），透传给 Bridge execute
 * @returns 动态工作流 submit 函数
 */
function imageEditSubmit(workflowId: string): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<WorkflowVarsBase>) => {
    const vars = ctx.vars as Record<string, string | undefined>;
    const prompt = (vars.prompt ?? '').trim();
    if (!prompt) throw new Error('image-edit 需要 vars.prompt（编辑描述）');
    let paths: string[] = [];
    try {
      const parsed = JSON.parse(vars.imagePaths ?? '[]') as unknown;
      if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) throw new Error('imagePaths 须为字符串数组');
      paths = parsed.map((p) => p.trim()).filter(Boolean);
    } catch (e) {
      throw new Error(`image-edit imagePaths 无效: ${vars.imagePaths}; ${e instanceof Error ? e.message : String(e)}`);
    }
    if (paths.length === 0) throw new Error('image-edit 至少需要一张输入图片（vars.imagePaths）');
    const imgs: File[] = [];
    for (const rel of paths) imgs.push(await ctx.readAssertFile(rel));
    const size = resolveImageEditSizeParams(vars);
    return ctx.provider.execute(buildImageEditPayload({ workflowId, prompt, imgs, seed: vars.seed, size }));
  };
}

/**
 * 图生视频提交实现：按引擎注入的 ctx.video.mode 分发到对应 payload 构建器。
 *
 * - director：读取 director.frames（文件 + cursor）组装导演台载荷；
 * - first-last-frame：帧数须在 1~maxFrames（能力声明，缺省 3）之间；
 * - reference：按 references 类型分拣图片/视频/音频组装参考载荷；
 * - 模式不在工作流能力声明（caps.video.modes）内时报错。
 *
 * @param workflowId 注册后的实现标识（ceb-{id}），透传给 Bridge execute
 * @param caps 推导的工作流能力（决定支持的模式与首尾帧上限）
 * @returns 动态工作流 submit 函数
 */
function videoSubmit(workflowId: string, caps: WorkflowCapabilities): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<WorkflowVarsBase>) => {
    const video = (ctx as { video?: VideoWorkflowSubmitData }).video;
    if (!video) throw new Error('image-to-video 需要引擎注入 ctx.video');
    const modes = caps.video?.modes ?? [];
    if (!modes.includes(video.mode)) throw new Error(`工作流 ${workflowId} 不支持生成模式: ${video.mode}`);
    const seed = video.seed != null ? Number(video.seed) : undefined;
    if (video.mode === 'director') {
      const frames = video.director?.frames ?? [];
      if (frames.length < 1) throw new Error('导演台模式需要 director.frames');
      const defines = frames.map((f, i) => ({ frameSeq: i, cursor: f.cursor }));
      const files = frames.map((f) => f.file);
      return ctx.provider.execute(buildDirectorPayload({
        workflowId, prompt: video.prompt, width: video.resolution.width, height: video.resolution.height,
        duration: video.duration, fps: video.fps ?? 24, seed, frameDefines: defines, frameFiles: files,
        ...(video.director?.audio ? { audio: video.director.audio } : {}),
      }));
    }
    if (video.mode === 'first-last-frame') {
      const frames = video.director?.frames ?? [];
      const maxFrames = caps.video?.firstLastFrame?.maxFrames ?? 3;
      if (frames.length < 1 || frames.length > maxFrames) throw new Error(`首尾帧模式需要 1~${maxFrames} 帧参考图`);
      return ctx.provider.execute(buildFirstLastFramePayload({
        workflowId, prompt: video.prompt, width: video.resolution.width, height: video.resolution.height,
        duration: video.duration, fps: video.fps ?? 24, seed,
        frames: frames.map((f) => f.file),
        ...(video.director?.audio ? { audio: video.director.audio } : {}),
      }));
    }
    if (video.mode === 'reference') {
      const refs = video.references ?? [];
      if (refs.length < 1) throw new Error('参考模式需要至少 1 个参考素材');
      // 按能力声明校验参考素材数量上限与分类型上限（caps.video.reference）
      const cap = caps.video?.reference as
        | { maxTotal?: number; types?: Record<string, { max?: number }> }
        | undefined;
      if (cap?.maxTotal != null && refs.length > cap.maxTotal) {
        throw new Error(`参考素材总数量超过上限（${cap.maxTotal}）`);
      }
      const imageRefs: File[] = []; const videoRefs: File[] = []; const audioRefs: File[] = [];
      for (const r of refs) {
        if (r.type === 'image') imageRefs.push(r.file);
        else if (r.type === 'video') videoRefs.push(r.file);
        else audioRefs.push(r.file);
      }
      const types = cap?.types ?? {};
      const maxImage = types.image?.max ?? 0;
      const maxVideo = types.video?.max ?? 0;
      const maxAudio = types.audio?.max ?? 0;
      if (maxImage && imageRefs.length > maxImage) throw new Error(`图片参考数量超过上限（${maxImage}）`);
      if (maxVideo && videoRefs.length > maxVideo) throw new Error(`视频参考数量超过上限（${maxVideo}）`);
      if (maxAudio && audioRefs.length > maxAudio) throw new Error(`音频参考数量超过上限（${maxAudio}）`);
      // 音频参考不能作为唯一输入（audioRequiresVisual 约定）
      if (audioRefs.length > 0 && imageRefs.length === 0 && videoRefs.length === 0) {
        throw new Error('音频参考必须与图片或视频参考一同输入，不能作为唯一输入');
      }
      return ctx.provider.execute(buildReferencePayload({
        workflowId, prompt: video.prompt, width: video.resolution.width, height: video.resolution.height,
        duration: video.duration, seed, imageRefs, videoRefs, audioRefs,
      }));
    }
    throw new Error(`不支持生成模式: ${video.mode}`);
  };
}

/**
 * 构建动态工作流的 submit（供同步主流程与单测直接使用）。
 *
 * @param workflowId 注册后的实现标识（ceb-{id}）
 * @param type 推导的工作流类型（BridgeDerivedType）
 * @param caps 推导的工作流能力（仅 image-to-video 使用）
 * @returns 对应类型的 submit 函数（type 恒为四类之一，无需默认分支）
 */
export function buildSubmit(
  workflowId: string,
  type: BridgeDerivedType,
  caps: WorkflowCapabilities,
): WorkflowDefinition['submit'] {
  switch (type) {
    case 'text-to-image': return textToImageSubmit(workflowId);
    case 'image-edit': return imageEditSubmit(workflowId);
    case 'tts-voice-design': return ttsSubmit(workflowId);
    case 'image-to-video': return videoSubmit(workflowId, caps);
  }
}

/**
 * 从详情构建并注册一个动态工作流定义（替换语义）。
 *
 * 类型推导失败（未知类型）时告警并返回 null，由调用方跳过；对同 id 实现
 * 先注销旧定义再注册（unregister + register），保证重同步刷新
 * name/params/capabilities 且不会重复注册。
 *
 * @param detail Bridge 工作流详情（含解析后的 declaredParams 与 tags）
 * @param tagId 自动注册标签 id（expose_field 元数据来源；可为空串）
 * @returns 注册键（{type}:{impl}）；未知类型返回 null
 */
function buildAndRegister(detail: BridgeWorkflowDetail, tagId: string): string | null {
  const type = deriveWorkflowType(detail.tags);
  if (!type) {
    console.warn(`[bridge-sync] 跳过未知类型工作流: ${detail.id}（tags=${JSON.stringify(detail.tags)}）`);
    return null;
  }
  const impl = `${IMPL_PREFIX}${detail.id}`;
  const caps = deriveCapabilities(detail.tags, type);
  const expose = exposeFieldOf(detail.tags, tagId);
  const params = deriveParams(expose, detail.declaredParams);
  const def: WorkflowDefinition = {
    type, impl, name: detail.name || detail.id,
    description: detail.description || undefined,
    provider: PROVIDER_ID,
    params,
    capabilities: caps,
    submit: buildSubmit(impl, type, caps),
  };
  // 替换语义：先注销旧定义再注册，保证重同步刷新 name/params/capabilities 且不重复
  unregister(type, impl);
  register(def);
  return `${type}:${impl}`;
}

/**
 * 从 Bridge 同步并注册工作流（核心集成入口，并发安全）。
 *
 * 并发调用串行化：重叠调用共享同一 in-flight promise，避免交错清理与重复注册。
 * 内部逻辑见 {@link doSync}。
 *
 * @returns 同步完成（无返回值；失败不抛出，仅记录日志）
 */
export function syncBridgeWorkflows(): Promise<void> {
  if (!inflight) {
    inflight = doSync().finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * 同步主流程。
 *
 * 流程：
 * 1. 读 comfyui-bridge 配置取 autoRegisterTag；非空按标签筛选列表，空则拉取全部；
 * 2. 对每个工作流拉取详情 → 推导类型/能力/参数 → 注册（impl=ceb-{id}，幂等）；
 * 3. 以本次 summaries 的 id 集合驱动陈旧清理（cleanupStale）；
 * 4. 列表拉取失败（Bridge 不可达 / 鉴权失败）：记 error，保留既有注册不清空；
 *    单个详情拉取失败：告警并跳过该工作流（id 仍在 summaries 中 → 旧注册保留）。
 *
 * @returns 同步完成（无返回值；失败不抛出，仅记录日志）
 */
async function doSync(): Promise<void> {
  const config = await getProviderConfig(PROVIDER_ID);
  const providerDef = getProvider(PROVIDER_ID);
  if (!providerDef) throw new Error(`Provider 未注册: ${PROVIDER_ID}`);
  const client = providerDef.createClient(config) as ComfyuiBridgeClient;
  const tagId = String(config.autoRegisterTag ?? '').trim();

  let summaries: BridgeWorkflowSummary[];
  try {
    summaries = tagId ? await client.listWorkflows(tagId) : await client.listWorkflows();
  } catch (e) {
    console.error(`[bridge-sync] 拉取工作流列表失败，保留既有注册: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  // 先注册新列表（本次出现的实现，幂等）
  for (const s of summaries) {
    try {
      const detail = await client.getWorkflowDetail(s.id);
      buildAndRegister(detail, tagId);
    } catch (e) {
      console.warn(`[bridge-sync] 工作流详情拉取失败，跳过: ${s.id}; ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 清理陈旧注册（本次 summaries 之外的历史 ceb-*）
  cleanupStale(new Set(summaries.map((s) => s.id)));
}
