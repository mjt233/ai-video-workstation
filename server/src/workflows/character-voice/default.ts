import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'character-voice',
  name: '角色声音生成 (TTS)',
  impl: 'default',
  description: '根据角色声音描述生成语音样本',

  async submit(params) {
    const voiceDesc = await params.readFile(`prompt/character/${params.vars.name}/voice.md`);
    return { taskId: 'voice-mock-' + Date.now() };
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
