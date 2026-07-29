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
 * vars.imagePaths 为 JSON 数组字符串；vars.desc 为编辑描述。
 */
register(createImageEditWorkflow<ImageEditVars>({
  id: 'image-edit',
  name: '图片编辑',
  impl: 'default',
  description: '基于输入图片与编辑描述进行图像编辑/合成（分镜场景图、衍生变体等）',
  async getParams(params) {
    const desc = (params.vars.desc ?? '').trim();
    if (!desc) {
      throw new Error('image-edit 需要 vars.desc（编辑描述）');
    }

    let paths: string[] = [];
    try {
      const parsed = JSON.parse(params.vars.imagePaths ?? '[]') as unknown;
      if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) {
        throw new Error('imagePaths 须为字符串数组');
      }
      paths = parsed.map((p) => p.trim()).filter(Boolean);
    } catch (e) {
      throw new Error(
        `image-edit imagePaths 无效: ${params.vars.imagePaths}; ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (paths.length === 0) {
      throw new Error('image-edit 至少需要一张输入图片（vars.imagePaths）');
    }

    const imgs: File[] = [];
    for (const rel of paths) {
      imgs.push(await params.readAssertFile(rel));
    }

    return {
      desc,
      imgs,
      seed: params.vars.seed,
    };
  },
}));
