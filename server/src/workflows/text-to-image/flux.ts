import { register } from '../registry.js';
import type { TextToImageVars, WorkflowDefinition } from '../types.js';

/**
 * 文生图 Flux 实现（Mock）。
 * 真实适配时替换 submit/poll/parseOutput。
 */
register({
  type: 'text-to-image',
  name: '文生图 (Flux)',
  impl: 'flux',
  description: '使用 Flux 模型根据提示词生成图片（Mock）',

  async submit(ctx) {
    const promptPath = ctx.vars.promptPath?.trim();
    if (!promptPath) {
      throw new Error('text-to-image 需要 vars.promptPath');
    }
    await ctx.readFile(promptPath);
    return { taskId: 'flux-mock-' + Date.now() };
  },

  async poll() {
    return { status: 'completed', done: true };
  },

  async parseOutput() {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/1024',
      filename: 'output.jpg',
    };
  },
} satisfies WorkflowDefinition<TextToImageVars>);
