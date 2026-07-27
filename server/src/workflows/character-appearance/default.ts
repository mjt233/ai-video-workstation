import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'character-appearance',
  name: '角色外观生成 (Qwen)',
  impl: 'default',
  description: '使用 Qwen 文生图模型生成角色外观图片',

  async submit(params) {
    const prompt = await params.readFile(`prompt/character/${params.vars.name}/appearance.md`);
    return { taskId: 'mock-' + Date.now() };
  },

  async poll(taskId) {
    return { status: 'completed', done: true };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/1024',
      filename: 'appearance.jpg',
    };
  }
} satisfies WorkflowDefinition);
