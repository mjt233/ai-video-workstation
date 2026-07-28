import { register } from '../registry.js';
import type { VideoGenerateVars, WorkflowDefinition } from '../types.js';

register({
  id: 'video-generate',
  name: '视频生成 (LTX-2.3)',
  impl: 'ltx',
  description: '使用 LTX-2.3 模型基于首帧图生成视频',

  async submit(params) {
    await params.readFile(`prompt/scene/${params.vars.episode}/${params.vars.shot}/prompt.md`);
    return { taskId: 'ltx-mock-' + Date.now() };
  },

  async poll() {
    return { status: 'completed', done: true };
  },

  async parseOutput() {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/video',
      filename: 'video.mp4',
    };
  }
} satisfies WorkflowDefinition<VideoGenerateVars>);
