import { register } from '../registry.js';
import type { TextToImageVars, WorkflowRunContext } from '../types.js';
import { resolveSeedreamSize, submitSeedreamTextToImage } from '../seedream.js';

/** Seedream 文生图模型定义（impl → 阅读名 → 方舟模型 ID） */
const SEEDREAM_MODELS = [
  { impl: 'seedream-5-pro', name: 'Seedream 5.0 Pro（火山方舟）', model: 'doubao-seedream-5-0-pro-260628' },
  { impl: 'seedream-5-lite', name: 'Seedream 5.0 Lite（火山方舟）', model: 'doubao-seedream-5-0-260128' },
] as const;

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
      // 尺寸：vars.width/height 优先，否则 projectConfig；经 resolveSeedreamSize 校验/回退
      const width = ctx.vars.width ?? ctx.projectConfig.width;
      const height = ctx.vars.height ?? ctx.projectConfig.height;
      const optimizeMode = ctx.userParams?.enhance_prompt === 'true' ? ('standard' as const) : undefined;
      return submitSeedreamTextToImage(ctx.provider, {
        model: def.model,
        prompt,
        size: resolveSeedreamSize(width, height),
        ...(optimizeMode ? { optimizeMode } : {}),
      });
    },
  });
}
