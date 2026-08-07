import { register } from '../registry.js';
import type { ImageEditVars, WorkflowRunContext } from '../types.js';
import { fileToDataUrl, resolveSeedreamSize, SEEDREAM_MODELS, SEEDREAM_SIZE_LIMITS, submitSeedreamImageEdit } from '../seedream.js';

for (const def of SEEDREAM_MODELS) {
  register<ImageEditVars>({
    type: 'image-edit',
    impl: def.impl,
    name: def.name,
    description: '使用火山方舟 Seedream 多图参考生单图，基于输入图片与编辑描述进行图像编辑/合成',
    provider: 'volcengine-ark',
    capabilities: { cancelable: true, deferredCancel: true },
    params: [
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
    async submit(ctx: WorkflowRunContext<ImageEditVars>) {
      const desc = (ctx.vars.desc ?? '').trim();
      if (!desc) {
        throw new Error('image-edit 需要 vars.desc（编辑描述）');
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

      // 尺寸：enable_specified_size=true 且宽高有效 → 显式 WxH；否则回退档位
      // 注：userParams 值类型为 boolean|number|string，需 String() 强转后再解析
      const up = ctx.userParams ?? {};
      const size = String(up.enable_specified_size) === 'true'
        ? resolveSeedreamSize(SEEDREAM_SIZE_LIMITS[def.kind], String(up.width ?? ''), String(up.height ?? ''))
        : resolveSeedreamSize(SEEDREAM_SIZE_LIMITS[def.kind]);

      return submitSeedreamImageEdit(ctx.provider, {
        model: def.model,
        prompt: desc,
        images: dataUrls,
        size,
      });
    },
  });
}
