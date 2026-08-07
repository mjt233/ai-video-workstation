import { createTtsDesignWorkflow } from '../bridge-client.js';
import { register } from '../registry.js';
import type { TtsVoiceDesignVars } from '../types.js';

/**
 * 音色设计默认实现（ComfyUI tts_voice_design）。
 *
 * 用于：
 * - 角色声音样本（prompt=voice.md，text=试听句）
 * - 分镜台词 TTS（prompt=声线+情绪，text=台词；可由引擎注入）
 */
register(createTtsDesignWorkflow<TtsVoiceDesignVars>({
  type: 'tts-voice-design',
  name: '音色设计 (qwen3-tts)',
  impl: 'default',
  description: '根据声线描述与文本生成语音（角色声音 / 分镜台词）',
}, (ctx) => {
  const prompt = (ctx.vars.prompt ?? '').trim();
  const text = (ctx.vars.text ?? '').trim();
  if (!prompt) {
    throw new Error('tts-voice-design 需要 vars.prompt（声线描述）');
  }
  if (!text) {
    throw new Error('tts-voice-design 需要 vars.text（朗读文本）');
  }

  // 分镜台词使用固定 seed 稳定音色；角色声音可用引擎注入的 seed
  const isSceneTts = ctx.vars.purpose === 'scene-tts';
  return {
    prompt,
    text,
    seed: isSceneTts ? '114514' : ctx.vars.seed,
  };
}));
