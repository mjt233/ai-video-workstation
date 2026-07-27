import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'scene-tts',
  name: '分镜台词语音生成',
  impl: 'default',
  description: '将分镜台词转为语音',

  async submit(params) {
    const scriptJson = await params.readFile(`prompt/scene/${params.vars.episode}/${params.vars.shot}/script.json`);
    const script = JSON.parse(scriptJson);
    const charLine = script.find((l: any) => l.角色名 === params.vars.character);
    return { taskId: 'tts-mock-' + Date.now() };
  },

  async poll(taskId) {
    return { status: 'completed', done: true };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/audio',
      filename: 'voice.flac',
    };
  }
} satisfies WorkflowDefinition);
