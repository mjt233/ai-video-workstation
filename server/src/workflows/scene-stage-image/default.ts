import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'scene-stage-image',
  name: '分镜场景图生成 (图片编辑)',
  impl: 'default',
  description: '基于基础场景图片和角色合成分镜场景图',

  async submit(params) {
    return { taskId: 'edit-mock-' + Date.now() };
  },

  async poll(taskId) {
    return { status: 'completed', done: true };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/1024',
      filename: 'scene-stage.jpg',
    };
  }
} satisfies WorkflowDefinition);
