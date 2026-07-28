import { register } from '../registry.js';
import type { CharacterAppearanceVars, WorkflowDefinition } from '../types.js';

register({
  id: 'character-appearance',
  name: '角色外观生成 (Flux)',
  impl: 'flux',
  description: '使用 Flux 模型生成角色外观图片',

  async submit(params) {
    await params.readFile(`prompt/character/${params.vars.name}/appearance.md`);
    return { taskId: 'flux-mock-' + Date.now() };
  },

  async poll() {
    return { status: 'completed', done: true };
  },

  async parseOutput() {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/1024',
      filename: 'appearance.jpg',
    };
  }
} satisfies WorkflowDefinition<CharacterAppearanceVars>);
