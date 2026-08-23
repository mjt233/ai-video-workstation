import { resolveInstanceConfig } from '../providers/config-store.js';
import { parseOpenAICompatibleModels } from '../providers/openai-compatible/models.js';
import type { ProviderInstance } from '../providers/types.js';
import { registerOrReplace, unregisterByInstance } from './registry.js';
import type {
  ImageEditVars,
  TextToImageVars,
  WorkflowRunContext,
  WorkflowUserParamDeclaration,
} from './types.js';

/** OpenAI 兼容 Provider 插件 id */
const PROVIDER_ID = 'openai-compatible';

/** 文生图 / 图片编辑共用的尺寸参数声明 */
const SIZE_PARAMS: WorkflowUserParamDeclaration[] = [
  {
    name: '指定输出尺寸',
    key: 'enable_specified_size',
    type: 'boolean',
    defaultValue: false,
    description: '启用后按下方选定的宽高输出图片',
  },
  {
    name: '输出宽度',
    key: 'width',
    type: 'integer',
    defaultValue: '',
    description: '输出图片宽度（像素）',
  },
  {
    name: '输出高度',
    key: 'height',
    type: 'integer',
    defaultValue: '',
    description: '输出图片高度（像素）',
  },
];

/**
 * 解析输出尺寸：仅当 enable_specified_size === 'true' 且宽高为正数时返回 "WxH"；
 * 否则回退 projectConfig 宽高；都无效则返回 undefined（请求不传 size）。
 *
 * @param specified 是否启用指定尺寸（字符串 "true" 才生效）
 * @param width 用户/变量宽度
 * @param height 用户/变量高度
 * @param fallbackWidth 项目默认宽度
 * @param fallbackHeight 项目默认高度
 * @returns OpenAI size 字段，或 undefined
 */
export function resolveOpenAICompatibleSize(
  specified: boolean,
  width: string | number | boolean | undefined,
  height: string | number | boolean | undefined,
  fallbackWidth?: number,
  fallbackHeight?: number,
): string | undefined {
  const pick = (raw: string | number | boolean | undefined): number | undefined => {
    if (raw === undefined || raw === '' || typeof raw === 'boolean') return undefined;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
  };
  const w = specified ? pick(width) : undefined;
  const h = specified ? pick(height) : undefined;
  if (w && h) return `${w}x${h}`;
  const fw = pick(fallbackWidth);
  const fh = pick(fallbackHeight);
  if (fw && fh) return `${fw}x${fh}`;
  return undefined;
}

/**
 * 文生图提交：读 promptPath，按尺寸门控组装 /images/generations 载荷。
 *
 * @param modelId 对端模型 ID（原样作为 execute.workflowId）
 * @returns submit 函数
 */
function textToImageSubmit(modelId: string) {
  return async (ctx: WorkflowRunContext<TextToImageVars>) => {
    const promptPath = ctx.vars.promptPath?.trim();
    if (!promptPath) throw new Error('text-to-image 需要 vars.promptPath');
    const prompt = await ctx.readFile(promptPath);
    const specified = ctx.vars.enable_specified_size === 'true';
    const size = resolveOpenAICompatibleSize(
      specified,
      ctx.vars.width,
      ctx.vars.height,
      ctx.projectConfig.width,
      ctx.projectConfig.height,
    );
    return ctx.provider.execute({
      workflowId: modelId,
      params: { prompt, ...(size ? { size } : {}) },
    });
  };
}

/**
 * 图片编辑提交：读 prompt + imagePaths，按尺寸门控组装 /images/edits 载荷。
 *
 * 单图以 files.image 传递；多图以 image_0 / image_1 … 传递，由客户端编进 multipart。
 *
 * @param modelId 对端模型 ID（原样作为 execute.workflowId）
 * @returns submit 函数
 */
function imageEditSubmit(modelId: string) {
  return async (ctx: WorkflowRunContext<ImageEditVars>) => {
    const prompt = (ctx.vars.prompt ?? '').trim();
    if (!prompt) throw new Error('image-edit 需要 vars.prompt（编辑描述）');
    let paths: string[] = [];
    try {
      const parsed = JSON.parse(ctx.vars.imagePaths ?? '[]') as unknown;
      if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) {
        throw new Error('imagePaths 须为字符串数组');
      }
      paths = parsed.map((p) => p.trim()).filter(Boolean);
    } catch (e) {
      throw new Error(
        `image-edit imagePaths 无效: ${ctx.vars.imagePaths}; ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (paths.length === 0) {
      throw new Error('image-edit 至少需要一张输入图片（vars.imagePaths）');
    }
    const files: Record<string, File> = {};
    if (paths.length === 1) {
      files.image = await ctx.readAssertFile(paths[0]);
    } else {
      for (let i = 0; i < paths.length; i++) {
        files[`image_${i}`] = await ctx.readAssertFile(paths[i]);
      }
    }
    const up = ctx.userParams ?? {};
    const specified = String(up.enable_specified_size ?? ctx.vars.enable_specified_size) === 'true';
    const size = resolveOpenAICompatibleSize(
      specified,
      up.width ?? ctx.vars.width,
      up.height ?? ctx.vars.height,
      ctx.projectConfig.width,
      ctx.projectConfig.height,
    );
    return ctx.provider.execute({
      workflowId: modelId,
      params: { mode: 'edit', prompt, ...(size ? { size } : {}) },
      files,
    });
  };
}

/**
 * 按实例同步 OpenAI 兼容工作流：根据配置的模型能力动态注册文生图 / 图片编辑。
 *
 * 注册键 impl = oai-{safeModelId}-{instanceId}；workflowKey = {type}:{safeModelId}。
 * 模型变更后以本次 keepKeys 清理该实例下已消失的工作流。
 *
 * @param instance 服务商实例
 */
export async function syncOpenAICompatibleInstance(instance: ProviderInstance): Promise<void> {
  const config = resolveInstanceConfig(instance);
  const models = parseOpenAICompatibleModels(config.models);
  const keepKeys = new Set<string>();
  for (const m of models) {
    if (m.capabilities.includes('text-to-image')) {
      const key = `text-to-image:${m.safeId}`;
      registerOrReplace<TextToImageVars>({
        type: 'text-to-image',
        impl: `oai-${m.safeId}-${instance.id}`,
        name: `${m.id} 文生图`,
        description: `OpenAI 兼容文生图（模型 ${m.id}）`,
        provider: PROVIDER_ID,
        providerInstanceId: instance.id,
        providerName: instance.name,
        workflowKey: key,
        capabilities: { cancelable: true, deferredCancel: true },
        params: SIZE_PARAMS,
        submit: textToImageSubmit(m.id),
      });
      keepKeys.add(key);
    }
    if (m.capabilities.includes('image-edit')) {
      const key = `image-edit:${m.safeId}`;
      registerOrReplace<ImageEditVars>({
        type: 'image-edit',
        impl: `oai-${m.safeId}-${instance.id}`,
        name: `${m.id} 图片编辑`,
        description: `OpenAI 兼容图片编辑（模型 ${m.id}）`,
        provider: PROVIDER_ID,
        providerInstanceId: instance.id,
        providerName: instance.name,
        workflowKey: key,
        capabilities: { cancelable: true, deferredCancel: true },
        params: SIZE_PARAMS,
        submit: imageEditSubmit(m.id),
      });
      keepKeys.add(key);
    }
  }
  unregisterByInstance(instance.id, keepKeys);
}
