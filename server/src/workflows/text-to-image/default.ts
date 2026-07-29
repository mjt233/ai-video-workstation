import { register } from '../registry.js';
import { createTextToImageWorkflow } from '../bridge-client.js';
import type { TextToImageVars } from '../types.js';

/**
 * 文生图默认实现（ComfyUI text_to_image）。
 *
 * 角色外观、场景图等均通过本工作流生成：
 * - vars.promptPath：提示词文件路径
 * - vars.width / height：可选覆盖分辨率
 */
register(createTextToImageWorkflow<TextToImageVars>({
  id: 'text-to-image',
  name: '文生图 (Krea2)',
  impl: 'default',
  description: '使用 ComfyUI 文生图工作流，根据提示词生成图片（角色外观 / 场景图等）',
  getPrompt: (params) => {
    const promptPath = params.vars.promptPath?.trim();
    if (!promptPath) {
      throw new Error('text-to-image 需要 vars.promptPath');
    }
    return params.readFile(promptPath);
  },
  getWidth: (params) => {
    if (params.vars.width != null && params.vars.width !== '') {
      const n = Number(params.vars.width);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return params.projectConfig.width || 1080;
  },
  getHeight: (params) => {
    if (params.vars.height != null && params.vars.height !== '') {
      const n = Number(params.vars.height);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return params.projectConfig.height || 1920;
  },
}));
