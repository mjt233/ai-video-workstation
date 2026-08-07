import { createImageEditWorkflow } from '../bridge-client.js';
import { register } from '../registry.js';
import type { ImageEditVars } from '../types.js';

/**
 * 图片编辑默认实现（ComfyUI img_edit_N）。
 *
 * 用于：
 * - 分镜场景图合成（基础场景 + 角色外观 + prompt）
 * - 衍生变体编辑（基础图 + 衍生描述）
 *
 * vars.imagePaths 为 JSON 数组字符串；vars.prompt 为编辑描述。
 */
register(createImageEditWorkflow<ImageEditVars>({
  type: 'image-edit',
  name: 'Qwen Image Edit 2509',
  impl: 'default',
  description: '基于输入图片与编辑描述进行图像编辑/合成（分镜场景图、衍生变体等）',
  params: [
    {
      key: 'enable_multiple_angles_lora',
      name: '启用多机位旋转LoRA模型',
      defaultValue: true,
      type: 'boolean',
      description: '启用后可在提示词中使用“摄像机向左/右移动90度，摄像机向上/下移动，拉近/推远”等方式精准控制视角变换'
    },
    {
      key: 'enable_specified_size',
      name: '指定输出尺寸',
      defaultValue: false,
      type: 'boolean',
      description: '启用后按下方选定的宽高输出图片'
    },
    {
      key: 'width',
      name: '输出宽度',
      defaultValue: '',
      type: 'integer',
      description: '输出图片宽度（像素）'
    },
    {
      key: 'height',
      name: '输出高度',
      defaultValue: '',
      type: 'integer',
      description: '输出图片高度（像素）'
    }
  ],
  async getParams(ctx) {
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

    const imgs: File[] = [];
    for (const rel of paths) {
      imgs.push(await ctx.readAssertFile(rel));
    }

    return {
      prompt,
      imgs,
      seed: ctx.vars.seed,
    };
  },
}));
