import { createTtsDesignWorkflow } from '../bridge-client.js';
import { register } from '../registry.js';

register(createTtsDesignWorkflow({
  id: 'character-voice',
  name: 'qwen3-tts-voice-design',
  impl: 'default',
  description: '根据角色声音描述生成语音样本'
}, async params => {
  const voiceDesc = await params.readFile(`prompt/character/${params.vars.name}/voice.md`);
  return {
    desc: voiceDesc,
    text: '你好，我叫' + params.vars.name,
    seed: params.vars.seed
  }
}))
