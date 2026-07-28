import { register } from '../registry.js';
import type { VideoGenerateVars, WorkflowDefinition } from '../types.js';

register({
  id: 'video-generate',
  name: '视频生成 (图生视频)',
  impl: 'default',
  description: '基于分镜图片和 prompt 生成视频',

  async submit(params) {
    await params.readFile(`prompt/scene/${params.vars.episode}/${params.vars.shot}/prompt.md`);
    return { taskId: 'video-mock-' + Date.now() };
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
