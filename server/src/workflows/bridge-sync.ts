import { listInstances, resolveInstanceConfig } from '../providers/config-store.js';
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
  buildTtsClonePayload,
  resolveImageEditSizeParams,
  type BridgeExecutePayload,
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

/** text-to-image 提交按结构字段处理的用户参数键（从透传排除） */
const TEXT_TO_IMAGE_STRUCTURAL_KEYS = new Set(['seed', 'enhance_prompt', 'enable_specified_size', 'width', 'height']);
/** image-edit 提交按结构字段处理的用户参数键（从透传排除） */
const IMAGE_EDIT_STRUCTURAL_KEYS = new Set(['seed', 'enable_specified_size', 'width', 'height']);
/** tts 提交按结构字段处理的用户参数键（从透传排除） */
const TTS_STRUCTURAL_KEYS = new Set(['seed']);
/** image-to-video 提交按结构字段处理的用户参数键（从透传排除） */
const VIDEO_STRUCTURAL_KEYS = new Set(['seed', 'width', 'height', 'duration', 'fps', 'auto_generate_audio', 'mid_frame_cursor', 'frame_define']);

/**
 * 提取待透传的用户参数：从 ctx.userParams（引擎按声明类型转换后的原生值）中排除
 * 本提交函数按结构字段组装（seed/尺寸等）的键，其余（Bridge 动态声明的用户参数，
 * 如 enable_multiple_angles_lora）原样返回，供 payload 构建器合并进 Bridge 请求。
 *
 * @param ctx 工作流运行上下文
 * @param exclude 本提交函数结构处理的字段键集合
 * @returns 透传参数（原生类型值）
 */
function passthroughParams(
  ctx: WorkflowRunContext<WorkflowVarsBase>,
  exclude: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx.userParams ?? {})) {
    if (!exclude.has(k)) out[k] = v;
  }
  return out;
}

/**
 * 以本次任务选择的 Easy Bridge 提供商实例（ctx.comfyuiProviderId）执行提交。
 *
 * providerId 是 Bridge 执行接口的保留键：非空时显式指定执行端实例，留空时
 * 不携带（Bridge 按「工作流配置 → 全局默认」解析）；不进入 params 载荷，
 * 由 provider 客户端在 JSON/multipart 两种模式下分别放到正确位置。
 *
 * @param ctx 工作流运行上下文
 * @param payload Bridge 提交载荷（workflowId + params + files）
 * @returns 远端任务 ID
 */
function executeWithProvider(
  ctx: WorkflowRunContext<WorkflowVarsBase>,
  payload: BridgeExecutePayload,
): Promise<{ taskId: string }> {
  return ctx.provider.execute({
    ...payload,
    ...(ctx.comfyuiProviderId ? { providerId: ctx.comfyuiProviderId } : {}),
  });
}

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

/**
 * 文生图提交实现。
 *
 * 读取 vars.promptPath 对应的提示词文件内容作为 prompt；输出尺寸优先采用
 * vars.width/height（有效正数），未配置时回退 projectConfig（缺省 1080×1920）。
 *
 * 尺寸门控说明：ComfyUI Bridge 工作流（ceb-*，动态注册）通常不声明
 * enable_specified_size 参数（该字段为 Seedream 等云工作流约定），若以其 === 'true'
 * 作为唯一开关，画布节点等提交的 width/height 会被静默忽略而始终使用项目全局尺寸。
 * 因此仅当显式 enable_specified_size === 'false'（前端「不指定」模式，此时不携带
 * width/height）时才回退 projectConfig，其余情况 width/height 有效即采用。
 *
 * @param workflowId Bridge 工作流 id（原始 id，不含 ceb- 前缀），透传给 Bridge execute
 * @returns 动态工作流 submit 函数
 */
function textToImageSubmit(workflowId: string): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<TextToImageVarsLike>) => {
    const promptPath = ctx.vars.promptPath?.trim();
    if (!promptPath) throw new Error('text-to-image 需要 vars.promptPath');
    const prompt = await ctx.readFile(promptPath);
    const specified = ctx.vars.enable_specified_size !== 'false';
    const width = specified
      ? resolveOverrideSize(ctx.vars.width, ctx.projectConfig.width || 1080)
      : (ctx.projectConfig.width || 1080);
    const height = specified
      ? resolveOverrideSize(ctx.vars.height, ctx.projectConfig.height || 1920)
      : (ctx.projectConfig.height || 1920);
    const seed = ctx.vars.seed ? Number(ctx.vars.seed) : undefined;
    const enhance = ctx.vars.enhance_prompt === 'true';
    const extraParams = passthroughParams(ctx, TEXT_TO_IMAGE_STRUCTURAL_KEYS);
    return executeWithProvider(ctx, buildTextToImagePayload({ workflowId, prompt, width, height, seed, enhance_prompt: enhance, extraParams }));
  };
}

/**
 * TTS 音色设计提交实现。
 *
 * 声线描述与朗读文本均来自 vars（prompt / text），任一项缺失即报错。
 *
 * @param workflowId Bridge 工作流 id（原始 id，不含 ceb- 前缀），透传给 Bridge execute
 * @returns 动态工作流 submit 函数
 */
function ttsSubmit(workflowId: string): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<WorkflowVarsBase>) => {
    const vars = ctx.vars as Record<string, string | undefined>;
    const prompt = (vars.prompt ?? '').trim();
    const text = (vars.text ?? '').trim();
    if (!prompt) throw new Error('tts-voice-design 需要 vars.prompt（声线描述）');
    if (!text) throw new Error('tts-voice-design 需要 vars.text（朗读文本）');
    const extraParams = passthroughParams(ctx, TTS_STRUCTURAL_KEYS);
    return executeWithProvider(ctx, buildTtsPayload({ workflowId, prompt, text, seed: vars.seed, extraParams }));
  };
}

/**
 * TTS 音色克隆提交实现。
 *
 * text（朗读文本）与 refText（参考音频文字内容）来自 vars；refAudioPath 为 JSON 数组
 * 字符串（与 imagePaths 同约定），须恰好 1 个音频路径，经 ctx.readAssertFile 读取后
 * 以文件 key audio_0 上传。
 *
 * @param workflowId Bridge 工作流 id（原始 id，不含 ceb- 前缀），透传给 Bridge execute
 * @returns 动态工作流 submit 函数
 */
function ttsCloneSubmit(workflowId: string): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<WorkflowVarsBase>) => {
    const vars = ctx.vars as Record<string, string | undefined>;
    const text = (vars.text ?? '').trim();
    const refText = (vars.refText ?? '').trim();
    if (!text) throw new Error('tts-voice-clone 需要 vars.text（朗读文本）');
    if (!refText) throw new Error('tts-voice-clone 需要 vars.refText（参考音频文字内容）');
    let paths: string[] = [];
    try {
      const parsed = JSON.parse(vars.refAudioPath ?? '[]') as unknown;
      if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) throw new Error('refAudioPath 须为字符串数组');
      paths = parsed.map((p) => p.trim()).filter(Boolean);
    } catch (e) {
      throw new Error(`tts-voice-clone refAudioPath 无效: ${vars.refAudioPath}; ${e instanceof Error ? e.message : String(e)}`);
    }
    if (paths.length !== 1) throw new Error('tts-voice-clone 需要恰好 1 个参考音频（vars.refAudioPath）');
    const refAudio = await ctx.readAssertFile(paths[0]);
    const extraParams = passthroughParams(ctx, TTS_STRUCTURAL_KEYS);
    return executeWithProvider(ctx, buildTtsClonePayload({ workflowId, text, refText, refAudio, seed: vars.seed, extraParams }));
  };
}

/**
 * 图片编辑提交实现。
 *
 * vars.imagePaths 为 JSON 字符串数组（相对 design/{project}/ 的 assert/ 路径）；
 * 逐个经 ctx.readAssertFile 解析为 File 后按顺序映射 image_{n} 上传。
 *
 * @param workflowId Bridge 工作流 id（原始 id，不含 ceb- 前缀），透传给 Bridge execute
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
    // 动态用户参数（如 enable_multiple_angles_lora）经 ctx.userParams 透传，不在本层硬编码
    const extraParams = passthroughParams(ctx, IMAGE_EDIT_STRUCTURAL_KEYS);
    return executeWithProvider(ctx, buildImageEditPayload({
      workflowId, prompt, imgs, seed: vars.seed, size, extraParams,
    }));
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
 * @param workflowId Bridge 工作流 id（原始 id，不含 ceb- 前缀），透传给 Bridge execute
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
      return executeWithProvider(ctx, buildDirectorPayload({
        workflowId, prompt: video.prompt, width: video.resolution.width, height: video.resolution.height,
        duration: video.duration, fps: video.fps ?? 24, seed, frameDefines: defines, frameFiles: files,
        extraParams: passthroughParams(ctx, VIDEO_STRUCTURAL_KEYS),
        ...(video.director?.audio ? { audio: video.director.audio } : {}),
      }));
    }
    if (video.mode === 'first-last-frame') {
      const frames = video.director?.frames ?? [];
      const maxFrames = caps.video?.firstLastFrame?.maxFrames ?? 3;
      if (frames.length < 1 || frames.length > maxFrames) throw new Error(`首尾帧模式需要 1~${maxFrames} 帧参考图`);
      return executeWithProvider(ctx, buildFirstLastFramePayload({
        workflowId, prompt: video.prompt, width: video.resolution.width, height: video.resolution.height,
        duration: video.duration, fps: video.fps ?? 24, seed,
        frames: frames.map((f) => f.file),
        extraParams: passthroughParams(ctx, VIDEO_STRUCTURAL_KEYS),
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
      return executeWithProvider(ctx, buildReferencePayload({
        workflowId, prompt: video.prompt, width: video.resolution.width, height: video.resolution.height,
        duration: video.duration, seed, imageRefs, videoRefs, audioRefs,
        extraParams: passthroughParams(ctx, VIDEO_STRUCTURAL_KEYS),
      }));
    }
    throw new Error(`不支持生成模式: ${video.mode}`);
  };
}

/**
 * 构建动态工作流的 submit（供同步主流程与单测直接使用）。
 *
 * @param workflowId Bridge 工作流 id（原始 id，不含 ceb- 前缀）
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
    case 'tts-voice-clone': return ttsCloneSubmit(workflowId);
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
 * @param detail Bridge 工作流详情（含解析后的 params/declaredParams 与 tags）
 * @param tagId 自动注册标签 id（expose_field 元数据来源；可为空串）
 * @returns 注册键（{type}:{impl}）；未知类型返回 null
 */
function buildAndRegister(detail: BridgeWorkflowDetail, tagId: string): string | null {
  const type = deriveWorkflowType(detail.tags);
  if (!type) {
    console.warn(`[bridge-sync] 跳过未知类型工作流: ${detail.id}（tags=${JSON.stringify(detail.tags)}）`);
    return null;
  }
  // 系统注册键：impl = ceb-{bridgeId}（ceb- 前缀防止与其它提供商工作流 id 冲突）
  const bridgeId = detail.id;
  const impl = `${IMPL_PREFIX}${bridgeId}`;
  const caps = deriveCapabilities(detail.tags, type);
  const expose = exposeFieldOf(detail.tags, tagId);
  // expose_field 字段信息：params 优先（工作流固定参数字段），declaredParams 兜底；
  // providerId 为 Bridge 执行接口保留键（本次执行提供商），不作为用户参数暴露，
  // 防止 expose_field 声明同名字段时与系统「ComfyUI 提供商」选择语义冲突
  const params = deriveParams(expose, detail.params, detail.declaredParams)
    .filter((d) => d.key !== 'providerId');
  const def: WorkflowDefinition = {
    type, impl, name: detail.name || detail.id,
    description: detail.description || undefined,
    provider: PROVIDER_ID,
    params,
    capabilities: caps,
    // 提交载荷使用 Bridge 原始工作流 id（不含 ceb- 前缀）；前缀仅存在于系统注册键 impl
    submit: buildSubmit(bridgeId, type, caps),
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
  const instances = await listInstances();
  const instance = instances.find((i) => i.type === PROVIDER_ID);
  if (!instance) throw new Error(`未配置 ${PROVIDER_ID} 实例`);
  const config = resolveInstanceConfig(instance);
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
