import { register } from '../registry.js';
import type { TextToImageVars, WorkflowRunContext } from '../types.js';
import { resolveSeedreamOutputSize, resolveSeedreamSize, SEEDREAM_MODELS, SEEDREAM_SIZE_LIMITS, submitSeedreamTextToImage } from '../seedream.js';

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
    ],
    async submit(ctx: WorkflowRunContext<TextToImageVars>) {
      const promptPath = ctx.vars.promptPath?.trim();
      if (!promptPath) {
        throw new Error('text-to-image 需要 vars.promptPath');
      }
      const prompt = await ctx.readFile(promptPath);
      // 尺寸：优先统一尺寸配置（ctx.sizeConfig，新交互），其次旧 vars 门控
      // （enable_specified_size==="true" 时采用 vars.width/height），最后回退 projectConfig；
      // 经 resolveSeedreamSize 按模型约束校验/自动匹配最接近的允许尺寸
      const specified = ctx.vars.enable_specified_size === 'true';
      const size = resolveSeedreamOutputSize(
        ctx.sizeConfig,
        specified,
        ctx.vars.width,
        ctx.vars.height,
        ctx.projectConfig.width,
        ctx.projectConfig.height,
      );
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
