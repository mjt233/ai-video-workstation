import { register } from '../registry.js';
import { createTextToImageWorkflow } from '../bridge-client.js';
import type { StageImageVars } from '../types.js';

register(createTextToImageWorkflow<StageImageVars>({
  id: 'stage-image',
  name: '场景图片生成',
  impl: 'default',
  description: '使用 ComfyUI 文生图工作流生成场景图片',
  getPrompt: (params) => params.readFile(`prompt/stage/${params.vars.name}/${params.vars.label}.md`),
  getWidth: (params) => params.projectConfig.width || 1080,
  getHeight: (params) => params.projectConfig.height || 1920,
}));
