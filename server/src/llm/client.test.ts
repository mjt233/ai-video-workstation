import { describe, expect, it } from 'vitest';
import { createLlmClient } from './client.js';

describe('createLlmClient', () => {
  it('暴露已归一化的 baseUrl 与 apiKey（原生 SSE 客户端使用）', () => {
    const client = createLlmClient('openai-chat', { baseUrl: ' https://open.bigmodel.cn/api/paas/v4/ ', apiKey: 'sk-test' });
    expect(client.protocol).toBe('openai-chat');
    expect(client.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
    expect(client.apiKey).toBe('sk-test');
  });

  it('BaseURL 为空时回退协议官方默认地址', () => {
    expect(createLlmClient('gemini', { apiKey: 'k' }).baseUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta',
    );
    expect(createLlmClient('anthropic', { apiKey: 'k' }).baseUrl).toBe('https://api.anthropic.com');
  });

  it('openai-chat 能力矩阵：图片/音频内联、视频公网 URL', () => {
    const client = createLlmClient('openai-chat', { apiKey: 'k' });
    expect(client.mediaRule('image')?.transport).toBe('inline');
    expect(client.mediaRule('audio')?.transport).toBe('inline');
    expect(client.mediaRule('video')?.transport).toBe('public-url');
  });

  it('gemini 三类媒体均内联；anthropic / grok / openai-responses 仅图片', () => {
    const gemini = createLlmClient('gemini', { apiKey: 'k' });
    for (const type of ['image', 'audio', 'video'] as const) {
      expect(gemini.mediaRule(type)?.transport).toBe('inline');
    }
    for (const protocol of ['openai-responses', 'anthropic', 'grok'] as const) {
      const client = createLlmClient(protocol, { apiKey: 'k' });
      expect(client.mediaRule('image')?.transport).toBe('inline');
      expect(client.mediaRule('audio')).toBeUndefined();
      expect(client.mediaRule('video')).toBeUndefined();
    }
  });

  it('reasoningOptions 按协议映射（非法挡位返回 undefined）', () => {
    expect(createLlmClient('openai-chat', { apiKey: 'k' }).reasoningOptions(' High ')).toEqual({
      openai: { reasoningEffort: 'high' },
    });
    expect(createLlmClient('anthropic', { apiKey: 'k' }).reasoningOptions('low')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 2048 } },
    });
    expect(createLlmClient('gemini', { apiKey: 'k' }).reasoningOptions('medium')).toEqual({
      google: { thinkingConfig: { thinkingBudget: 2048 } },
    });
    expect(createLlmClient('grok', { apiKey: 'k' }).reasoningOptions('high')).toEqual({
      xai: { reasoningEffort: 'high' },
    });
    expect(createLlmClient('openai-chat', { apiKey: 'k' }).reasoningOptions('bogus')).toBeUndefined();
    expect(createLlmClient('openai-chat', { apiKey: 'k' }).reasoningOptions('')).toBeUndefined();
  });

  it('model() 按协议返回 AI SDK 语言模型实例（不发起网络请求）', () => {
    for (const protocol of ['openai-chat', 'openai-responses', 'anthropic', 'grok', 'gemini'] as const) {
      const client = createLlmClient(protocol, { apiKey: 'k' });
      expect(client.model('test-model')).toBeTruthy();
    }
  });
});
