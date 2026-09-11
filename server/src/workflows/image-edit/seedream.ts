import { register } from '../registry.js';
import type { ImageEditVars, WorkflowRunContext } from '../types.js';
import { fileToDataUrl, resolveSeedreamSize, SEEDREAM_MODELS, SEEDREAM_SIZE_LIMITS, submitSeedreamImageEdit } from '../seedream.js';
import { resolveOutputSize, resolveSpecifiedGate, SIZE_PARAMS } from '../size.js';

for (const def of SEEDREAM_MODELS) {
  register<ImageEditVars>({
    type: 'image-edit',
    impl: def.impl,
    name: def.name,
    description: '使用火山方舟 Seedream 多图参考生单图，基于输入图片与编辑描述进行图像编辑/合成',
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
    params: SIZE_PARAMS,
    async submit(ctx: WorkflowRunContext<ImageEditVars>) {
      const prompt = (ctx.vars.prompt ?? '').trim();
      if (!prompt) {
        throw new Error('image-edit 需要 vars.prompt（编辑描述）');
      }

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
      if (paths.length > 10) {
        throw new Error('火山方舟图片编辑最多支持 10 张参考图');
      }

      // 逐张读取并转 base64 data URL；单图 ≤30MB（方舟限制）
      const dataUrls: string[] = [];
      for (const rel of paths) {
        const f = await ctx.readAssertFile(rel);
        if (f.size > 30 * 1024 * 1024) {
          throw new Error(`火山方舟输入图片超过 30MB: ${rel}`);
        }
        dataUrls.push(await fileToDataUrl(f));
      }

      // 尺寸：用户配置过尺寸 → 统一解析器（sizeConfig 显式宽高 → 档位换算 → 旧版
      // userParams 门控 → projectConfig）；从未配置过（自动/自动、无宽高）→ **省略 size**，
      // 由方舟按模型默认档位自选，避免把项目尺寸强加给方舟模型
      const up = ctx.userParams ?? {};
      const legacyGate = up['enable_specified_size'] ?? ctx.vars.enable_specified_size;
      const gate = resolveSpecifiedGate(ctx.sizeConfig, legacyGate, false);
      const resolved = gate === 'default-strict'
        ? undefined
        : resolveOutputSize({
            sizeConfig: ctx.sizeConfig,
            enableSpecified: gate,
            vars: ctx.vars,
            userParams: up,
            fallbackWidth: ctx.projectConfig.width,
            fallbackHeight: ctx.projectConfig.height,
          });
      const size = resolved
        ? resolveSeedreamSize(SEEDREAM_SIZE_LIMITS[def.kind], resolved.width, resolved.height)
        : resolveSeedreamSize(SEEDREAM_SIZE_LIMITS[def.kind]);

      return submitSeedreamImageEdit(ctx.provider, {
        model: def.model,
        prompt,
        images: dataUrls,
        size,
      });
    },
  });
}
