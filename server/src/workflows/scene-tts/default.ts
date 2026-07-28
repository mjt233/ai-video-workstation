import { createTtsDesignWorkflow } from '../bridge-client.js';
import { register } from '../registry.js';
import type { SceneTtsVars } from '../types.js';

interface ScriptLine {
  角色名: string;
  台词: string;
  情绪?: string;
}

register(createTtsDesignWorkflow<SceneTtsVars>({
  id: 'scene-tts',
  name: 'qwen3-tts-scene',
  impl: 'default',
  description: '根据角色声线与分镜台词生成语音',
}, async params => {
  const { episode, shot, character } = params.vars;
  if (!character) {
    throw new Error('scene-tts 缺少 vars.character');
  }

  const voiceDesc = (await params.readFile(`prompt/character/${character}/voice.md`)).trim();
  if (!voiceDesc) {
    throw new Error(`角色声线描述为空: prompt/character/${character}/voice.md`);
  }

  const scriptJson = await params.readFile(`prompt/scene/${episode}/${shot}/script.json`);
  const script = JSON.parse(scriptJson) as ScriptLine[];
  if (!Array.isArray(script)) {
    throw new Error(`script.json 格式无效: prompt/scene/${episode}/${shot}/script.json`);
  }

  const lines = script.filter(line => line.角色名 === character);
  if (!lines.length) {
    throw new Error(`分镜 ${episode}/${shot} 中未找到角色「${character}」的台词`);
  }

  const text = lines
    .map(line => (line.台词 ?? '').trim())
    .filter(Boolean)
    .join('\n');
  if (!text) {
    throw new Error(`角色「${character}」在分镜 ${episode}/${shot} 中的台词为空`);
  }

  const emotions = [...new Set(
    lines
      .map(line => (line.情绪 ?? '').trim())
      .filter(Boolean),
  )];
  const desc = emotions.length
    ? `${voiceDesc}\n 情绪 ${emotions.join('、')}`
    : voiceDesc;

  return {
    desc,
    text,
    seed: params.vars.seed,
  };
}));
