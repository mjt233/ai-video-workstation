import { resolveInstanceConfig } from '../providers/config-store.js';
import { parseOpenAICompatibleModels } from '../providers/openai-compatible/models.js';
import type { ProviderInstance } from '../providers/types.js';
import { registerOrReplace, unregisterByInstance } from './registry.js';
import { alignSizeToMultiple, resolveOutputSize, resolveSpecifiedGate, SIZE_PARAMS } from './size.js';
import type {
  ImageEditVars,
  TextToImageVars,
  WorkflowCapabilities,
  WorkflowRunContext,
} from './types.js';

/** OpenAI 兼容 Provider 插件 id */
const PROVIDER_ID = 'openai-compatible';

/**
 * 输出宽高的整除约束（像素）：GPT Image 系列要求 `width`/`height` 均为 16 的倍数
 * （另有宽高比 1:3~3:1、单边 ≤3840 的限制，本实现不做自动钳制，超限由对端报错并透出）。
 */
const SIZE_MULTIPLE = 16;

/**
 * 统一尺寸能力声明。
 *
 * - 比例：横竖屏常用档 + 自适应；
 * - 尺寸：自动（沿用项目尺寸）/ 1K / 2K（`SIZE_RESOLUTIONS` 的 base 1024 / 1440，均为 16 的倍数）；
 * - 自定义宽高：允许，提交前按 `SIZE_MULTIPLE` 自动对齐；
 * - 约束：声明 `constraint.multipleOf`，前端据此把预设宽高换算成同样的对齐值。
 */
const SIZE_CAPABILITIES: WorkflowCapabilities['size'] = {
  ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', 'auto'],
  size: ['auto', '1K', '2K'],
  supportCustomSize: true,
  constraint: { multipleOf: SIZE_MULTIPLE },
};

/**
 * 解析本次提交的生效输出宽高，并对齐到服务商要求的整除网格。
 *
 * 尺寸来源与优先级由 `size.ts` 的 `resolveOutputSize` 统一决定
 * （`sizeConfig` 显式宽高 → 档位换算 → 旧版 vars/userParams 门控 → 项目尺寸），
 * 本函数只在其结果上追加对齐：档位换算不保证整除（如 16:9 + 1K = 1820×1024），
 * 而不论尺寸来自哪一优先级，OpenAI 兼容端点都要求宽高为 16 的倍数。
 *
 * @param ctx 工作流执行上下文（文生图 / 图片编辑共用）
 * @param legacyGate 旧版 `enable_specified_size` 门控原始值（vars 或 userParams）
 * @returns 生效宽高（像素，均为 16 的倍数）
 */
function resolveOpenAISize(
  ctx: WorkflowRunContext<TextToImageVars | ImageEditVars>,
  legacyGate: string | number | boolean | undefined,
): { width: number; height: number } {
  const size = resolveOutputSize({
    sizeConfig: ctx.sizeConfig,
    // 缺省严格：工作流声明 enable_specified_size，必须显式开启才采用旧宽高
    enableSpecified: resolveSpecifiedGate(ctx.sizeConfig, legacyGate, false),
    vars: ctx.vars,
    userParams: ctx.userParams,
    fallbackWidth: ctx.projectConfig.width,
    fallbackHeight: ctx.projectConfig.height,
  });
  return alignSizeToMultiple(size, SIZE_MULTIPLE);
}

/**
 * 把统一解析器给出的生效宽高转为 OpenAI 兼容的 `size` 字段（`"WxH"`）。
 *
 * 生效宽高已在 {@link resolveOpenAISize} 内对齐到 16 的倍数，本函数不做任何二次判断
 * ——宽高恒为有效正整数，直接拼接即可。
 *
 * @param size 生效宽高（像素，均为 16 的倍数）
 * @returns OpenAI `size` 字段值（`"WxH"`）
 */
export function toOpenAISize(size: { width: number; height: number }): string {
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
    // 尺寸：统一解析器 + 16 倍数对齐（缺省严格门控：必须显式开启才采用 vars 宽高）
    const size = resolveOpenAISize(ctx, ctx.vars.enable_specified_size);
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
    // 尺寸：统一解析器 + 16 倍数对齐（图片编辑类工作流的旧宽高来自表单 userParams）
    const legacyGate = up['enable_specified_size'] ?? ctx.vars.enable_specified_size;
    const size = resolveOpenAISize(ctx, legacyGate);
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
