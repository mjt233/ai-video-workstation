import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'stage-image',
  name: '场景图片生成',
  impl: 'default',
  description: '根据场景 prompt 生成场景图片',

  async submit(params) {
    const prompt = await params.readFile(`prompt/stage/${params.vars.name}/${params.vars.label}.md`);
    return { taskId: 'stage-mock-' + Date.now() };
  },

  async poll(taskId) {
    return { status: 'completed', done: true };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/1024',
      filename: 'scene.jpg',
    };
  }
} satisfies WorkflowDefinition);
