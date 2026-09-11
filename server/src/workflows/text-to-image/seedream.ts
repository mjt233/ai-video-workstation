import { register } from '../registry.js';
import type { TextToImageVars, WorkflowRunContext } from '../types.js';
import { resolveSeedreamSize, SEEDREAM_MODELS, SEEDREAM_SIZE_LIMITS, submitSeedreamTextToImage } from '../seedream.js';
import { resolveOutputSize, resolveSpecifiedGate, SIZE_PARAMS } from '../size.js';

for (const def of SEEDREAM_MODELS) {
  register<TextToImageVars>({
    type: 'text-to-image',
    impl: def.impl,
    name: def.name,
    description: '使用火山方舟 Seedream 文生图模型，根据提示词生成图片（角色外观 / 场景图等）',
    provider: 'volcengine-ark',
    capabilities: {
      cancelable: true,
      deferredCancel: true,
      size: {
        ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
        size: ['1K', '2K'],
        supportCustomSize: true,
      },
    },
    params: [
      {
        name: '提示词优化',
        key: 'enhance_prompt',
        type: 'boolean',
        defaultValue: false,
        description: '启用后使用方舟 standard 模式优化提示词（质量更优，耗时更长）',
      },
      // 旧版尺寸参数（新交互下由统一尺寸组件写入 params.sizeConfig，此处仅为兼容与回显）
      ...SIZE_PARAMS,
    ],
    async submit(ctx: WorkflowRunContext<TextToImageVars>) {
      const promptPath = ctx.vars.promptPath?.trim();
      if (!promptPath) {
        throw new Error('text-to-image 需要 vars.promptPath');
      }
      const prompt = await ctx.readFile(promptPath);
      // 尺寸：统一解析器（sizeConfig 显式宽高 → 档位换算 → 旧 vars 门控 → projectConfig），
      // 再经 resolveSeedreamSize 按模型约束校验/自动匹配最接近的允许尺寸
      const size = resolveOutputSize({
        sizeConfig: ctx.sizeConfig,
        // 缺省严格：方舟工作流声明 enable_specified_size，必须显式开启才采用 vars 宽高
        enableSpecified: resolveSpecifiedGate(ctx.sizeConfig, ctx.vars.enable_specified_size, false),
        vars: ctx.vars,
        userParams: ctx.userParams,
        fallbackWidth: ctx.projectConfig.width,
        fallbackHeight: ctx.projectConfig.height,
      });
      const optimizeMode = ctx.userParams?.enhance_prompt === 'true' ? ('standard' as const) : undefined;
      return submitSeedreamTextToImage(ctx.provider, {
        model: def.model,
        prompt,
        size: resolveSeedreamSize(SEEDREAM_SIZE_LIMITS[def.kind], size.width, size.height),
        ...(optimizeMode ? { optimizeMode } : {}),
      });
    },
  });
}
