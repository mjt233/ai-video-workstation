import { register } from '../registry.js';
import type { TextToImageVars, WorkflowRunContext } from '../types.js';
import { resolveSeedreamSize, SEEDREAM_MODELS, SEEDREAM_SIZE_LIMITS, submitSeedreamTextToImage } from '../seedream.js';

for (const def of SEEDREAM_MODELS) {
  register<TextToImageVars>({
    type: 'text-to-image',
    impl: def.impl,
    name: def.name,
    description: '使用火山方舟 Seedream 文生图模型，根据提示词生成图片（角色外观 / 场景图等）',
    provider: 'volcengine-ark',
    capabilities: { cancelable: true, deferredCancel: true },
    params: [
      {
        name: '提示词优化',
        key: 'enhance_prompt',
        type: 'boolean',
        defaultValue: false,
        description: '启用后使用方舟 standard 模式优化提示词（质量更优，耗时更长）',
      },
    ],
    async submit(ctx: WorkflowRunContext<TextToImageVars>) {
      const promptPath = ctx.vars.promptPath?.trim();
      if (!promptPath) {
        throw new Error('text-to-image 需要 vars.promptPath');
      }
      const prompt = await ctx.readFile(promptPath);
      // 尺寸：vars.width/height 非空时优先，否则 projectConfig（空串视为未提供，与 default.ts 一致）；
      // 经 resolveSeedreamSize 按模型约束校验/自动匹配最接近的允许尺寸
      const width = (ctx.vars.width != null && ctx.vars.width !== '') ? ctx.vars.width : ctx.projectConfig.width;
      const height = (ctx.vars.height != null && ctx.vars.height !== '') ? ctx.vars.height : ctx.projectConfig.height;
      const optimizeMode = ctx.userParams?.enhance_prompt === 'true' ? ('standard' as const) : undefined;
      return submitSeedreamTextToImage(ctx.provider, {
        model: def.model,
        prompt,
        size: resolveSeedreamSize(SEEDREAM_SIZE_LIMITS[def.kind], width, height),
        ...(optimizeMode ? { optimizeMode } : {}),
      });
    },
  });
}
