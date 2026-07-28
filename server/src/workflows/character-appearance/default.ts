import { register } from '../registry.js';
import { createTextToImageWorkflow } from '../bridge-client.js';
import type { CharacterAppearanceVars } from '../types.js';

register(createTextToImageWorkflow<CharacterAppearanceVars>({
  id: 'character-appearance',
  name: 'Krea2',
  impl: 'default',
  description: '使用 ComfyUI 文生图工作流生成角色外观图片',
  // 角色设定图固定 16:9 720P
  getPrompt: (params) => params.readFile(`prompt/character/${params.vars.name}/appearance.md`),
  getWidth: () => 1280,
  getHeight: () => 720,
}));
