import { createTtsDesignWorkflow } from '../bridge-client.js';
import { register } from '../registry.js';
import type { SceneTtsVars } from '../types.js';

register(createTtsDesignWorkflow<SceneTtsVars>({
  id: 'scene-tts',
  name: 'qwen3-tts-scene',
  impl: 'default',
  description: '根据角色声线与分镜台词生成语音',
}, params => {
  const { character, text, voiceDesc, emotion, index } = params.vars;
  if (!character) {
    throw new Error('scene-tts 缺少 vars.character（应由引擎注入）');
  }
  if (!text?.trim()) {
    throw new Error(`scene-tts 台词为空（index=${index}, character=${character}）`);
  }
  if (!voiceDesc?.trim()) {
    throw new Error(`scene-tts 声线描述为空（character=${character}）`);
  }

  const desc = emotion?.trim()
    ? `${voiceDesc.trim()}\n当前情绪：${emotion.trim()}`
    : voiceDesc.trim();

  return {
    desc,
    text: text.trim(),
    seed: '114514', // 固定seed 稳定tts音色
  };
}));
