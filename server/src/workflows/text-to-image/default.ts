import { register } from '../registry.js';
import { createTextToImageWorkflow } from '../bridge-client.js';
import type { TextToImageVars } from '../types.js';

/**
 * 文生图默认实现（ComfyUI text_to_image）。
 *
 * 角色外观、场景图等均通过本工作流生成：
 * - vars.promptPath：提示词文件路径
 * - vars.enable_specified_size / width / height：用户指定输出尺寸（仅当
 *   enable_specified_size === "true" 时生效，否则回退项目配置分辨率）
 * - vars.enhance_prompt："true"/"false"，以布尔值提交给 ComfyUI 工作流（提示词强化开关，不修改提示词内容）
 */
register(createTextToImageWorkflow<TextToImageVars>({
  type: 'text-to-image',
  name: '文生图 (Krea2)',
  impl: 'default',
  description: '使用 ComfyUI 文生图工作流，根据提示词生成图片（角色外观 / 场景图等）',
  params: [
    {
      name: '提示词强化',
      key: 'enhance_prompt',
      type: 'boolean',
      defaultValue: false,
      description: '以布尔值提交给 ComfyUI 工作流的提示词强化开关',
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
  getPrompt: (ctx) => {
    const promptPath = ctx.vars.promptPath?.trim();
    if (!promptPath) {
      throw new Error('text-to-image 需要 vars.promptPath');
    }
    return ctx.readFile(promptPath);
  },
  getWidth: (ctx) => {
    if (ctx.vars.enable_specified_size === 'true' && ctx.vars.width != null && ctx.vars.width !== '') {
      const n = Number(ctx.vars.width);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return ctx.projectConfig.width || 1080;
  },
  getHeight: (ctx) => {
    if (ctx.vars.enable_specified_size === 'true' && ctx.vars.height != null && ctx.vars.height !== '') {
      const n = Number(ctx.vars.height);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return ctx.projectConfig.height || 1920;
  },
}));
