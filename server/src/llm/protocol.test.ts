import { describe, expect, it } from 'vitest';
import {
  formatContextWindow,
  isValidContextWindow,
  normalizeBaseUrl,
  parseContextWindow,
  resolveBaseUrl,
} from './protocol.js';

describe('normalizeBaseUrl', () => {
  it('去首尾空白与尾部斜杠', () => {
    expect(normalizeBaseUrl(' https://open.bigmodel.cn/api/paas/v4/ ')).toBe('https://open.bigmodel.cn/api/paas/v4');
    expect(normalizeBaseUrl('https://api.openai.com/v1///')).toBe('https://api.openai.com/v1');
    expect(normalizeBaseUrl('')).toBe('');
  });
});

describe('resolveBaseUrl', () => {
  it('用户配置优先，空则回退协议默认', () => {
    expect(resolveBaseUrl('openai-chat', 'https://example.com/v1/')).toBe('https://example.com/v1');
    expect(resolveBaseUrl('openai-chat', '')).toBe('https://api.openai.com/v1');
    expect(resolveBaseUrl('anthropic', '')).toBe('https://api.anthropic.com');
    expect(resolveBaseUrl('grok', '')).toBe('https://api.x.ai/v1');
    expect(resolveBaseUrl('gemini', '')).toBe('https://generativelanguage.googleapis.com/v1beta');
  });
});

describe('parseContextWindow', () => {
  it('纯数字', () => {
    expect(parseContextWindow('128000')).toBe(128000);
    expect(parseContextWindow(' 32768 ')).toBe(32768);
  });

  it('K / M（大小写不敏感，支持小数）', () => {
    expect(parseContextWindow('128K')).toBe(128000);
    expect(parseContextWindow('128k')).toBe(128000);
    expect(parseContextWindow('1M')).toBe(1000000);
    expect(parseContextWindow('1.5M')).toBe(1500000);
    expect(parseContextWindow('32.8K')).toBe(32800);
  });

  it('非法输入返回 null', () => {
    expect(parseContextWindow('')).toBeNull();
    expect(parseContextWindow('abc')).toBeNull();
    expect(parseContextWindow('1.2.3K')).toBeNull();
    expect(parseContextWindow('-100')).toBeNull();
  });

  it('isValidContextWindow 与 parse 一致', () => {
    expect(isValidContextWindow('128K')).toBe(true);
    expect(isValidContextWindow('x')).toBe(false);
  });
});

describe('formatContextWindow', () => {
  it('优先使用 K / M 展示', () => {
    expect(formatContextWindow('128000')).toBe('128K');
    expect(formatContextWindow('1000000')).toBe('1M');
    expect(formatContextWindow('1500000')).toBe('1.5M');
    expect(formatContextWindow('32768')).toBe('32.8K');
    expect(formatContextWindow(262144)).toBe('262.1K');
    expect(formatContextWindow(5000)).toBe('5K');
    expect(formatContextWindow(256)).toBe('256');
    expect(formatContextWindow('128K')).toBe('128K');
    expect(formatContextWindow('1M')).toBe('1M');
  });

  it('空/非法输入', () => {
    expect(formatContextWindow('')).toBe('');
    expect(formatContextWindow(null)).toBe('');
    expect(formatContextWindow(undefined)).toBe('');
    expect(formatContextWindow('abc')).toBe('abc');
  });
});
