import { resolveInstanceConfig } from '../providers/config-store.js';
import { parseOpenAICompatibleModels } from '../providers/openai-compatible/models.js';
import type { ProviderInstance } from '../providers/types.js';
import { registerOrReplace, unregisterByInstance } from './registry.js';
import { resolveOutputSize, resolveSpecifiedGate, SIZE_PARAMS } from './size.js';
import type {
  ImageEditVars,
  TextToImageVars,
  WorkflowCapabilities,
  WorkflowRunContext,
} from './types.js';

/** OpenAI 兼容 Provider 插件 id */
const PROVIDER_ID = 'openai-compatible';

/** 统一尺寸能力声明（OpenAI 兼容：支持自定义任意宽高，直传 "WxH"） */
const SIZE_CAPABILITIES: WorkflowCapabilities['size'] = {
  ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', 'auto'],
  size: ['auto'],
  supportCustomSize: true,
};

/**
 * 把统一解析器给出的生效宽高转为 OpenAI 兼容的 `size` 字段（`"WxH"`）。
 *
 * 尺寸来源与优先级由 `size.ts` 的 `resolveOutputSize` 统一决定，本函数不做任何
 * 二次判断——宽高恒为有效正整数，直接拼接即可。
 *
 * @param size 生效宽高（像素）
 * @returns OpenAI `size` 字段值（`"WxH"`）
 */
function toOpenAISize(size: { width: number; height: number }): string {
  return `${size.width}x${size.height}`;
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
    // 尺寸：统一解析器（sizeConfig 显式宽高 → 档位换算 → 旧 vars 门控 → projectConfig）
    const size = resolveOutputSize({
      sizeConfig: ctx.sizeConfig,
      // 缺省严格：工作流声明 enable_specified_size，必须显式开启才采用 vars 宽高
      enableSpecified: resolveSpecifiedGate(ctx.sizeConfig, ctx.vars.enable_specified_size, false),
      vars: ctx.vars,
      userParams: ctx.userParams,
      fallbackWidth: ctx.projectConfig.width,
      fallbackHeight: ctx.projectConfig.height,
    });
    return ctx.provider.execute({
      workflowId: modelId,
      params: { prompt, size: toOpenAISize(size) },
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
    // 尺寸：统一解析器（sizeConfig 显式宽高 → 档位换算 → 旧 userParams/vars 门控 → projectConfig）
    const legacyGate = up['enable_specified_size'] ?? ctx.vars.enable_specified_size;
    const size = resolveOutputSize({
      sizeConfig: ctx.sizeConfig,
      enableSpecified: resolveSpecifiedGate(ctx.sizeConfig, legacyGate, false),
      vars: ctx.vars,
      userParams: up,
      fallbackWidth: ctx.projectConfig.width,
      fallbackHeight: ctx.projectConfig.height,
    });
    return ctx.provider.execute({
      workflowId: modelId,
      params: { mode: 'edit', prompt, size: toOpenAISize(size) },
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
        capabilities: { cancelable: true, deferredCancel: true, size: SIZE_CAPABILITIES },
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
        capabilities: { cancelable: true, deferredCancel: true, size: SIZE_CAPABILITIES },
        params: SIZE_PARAMS,
        submit: imageEditSubmit(m.id),
      });
      keepKeys.add(key);
    }
  }
  unregisterByInstance(instance.id, keepKeys);
}
