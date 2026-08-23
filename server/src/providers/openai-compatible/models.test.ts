import { describe, expect, it } from 'vitest';
import { expandOpenAICompatibleWorkflows, parseOpenAICompatibleModels, toSafeModelId } from './models.js';

describe('toSafeModelId', () => {
  it('保留字母数字点下划线短横，其余替换为 _', () => {
    expect(toSafeModelId('gpt-image-1')).toBe('gpt-image-1');
    expect(toSafeModelId('vendor/foo:bar')).toBe('vendor_foo_bar');
    expect(toSafeModelId('@@@')).toBe('model');
  });
});

describe('parseOpenAICompatibleModels', () => {
  it('非数组返回空列表', () => {
    expect(parseOpenAICompatibleModels(undefined)).toEqual([]);
    expect(parseOpenAICompatibleModels('x')).toEqual([]);
  });

  it('丢弃空 id 与未勾选能力的行', () => {
    expect(parseOpenAICompatibleModels([
      { id: '  ', capabilities: ['text-to-image'] },
      { id: 'm1', capabilities: [] },
      { id: 'm2', capabilities: ['nope'] },
    ])).toEqual([]);
  });

  it('同一 id 多次出现时合并能力，并按首次出现排序', () => {
    const parsed = parseOpenAICompatibleModels([
      { id: ' gpt-image-1 ', capabilities: ['text-to-image'] },
      { id: 'other', capabilities: ['image-edit'] },
      { id: 'gpt-image-1', capabilities: ['image-edit', 'text-to-image'] },
    ]);
    expect(parsed.map((m) => m.id)).toEqual(['gpt-image-1', 'other']);
    expect(parsed[0].capabilities).toEqual(['text-to-image', 'image-edit']);
    expect(parsed[0].safeId).toBe('gpt-image-1');
  });
});

describe('expandOpenAICompatibleWorkflows', () => {
  it('按能力展开文生图 / 图片编辑条目', () => {
    const entries = expandOpenAICompatibleWorkflows([
      { id: 'gpt-image-1', capabilities: ['text-to-image', 'image-edit'] },
      { id: 'edit-only', capabilities: ['image-edit'] },
    ]);
    expect(entries).toEqual([
      {
        key: 'text-to-image:gpt-image-1',
        name: 'gpt-image-1 文生图',
        type: 'text-to-image',
        description: 'OpenAI 兼容文生图（模型 gpt-image-1）',
      },
      {
        key: 'image-edit:gpt-image-1',
        name: 'gpt-image-1 图片编辑',
        type: 'image-edit',
        description: 'OpenAI 兼容图片编辑（模型 gpt-image-1）',
      },
      {
        key: 'image-edit:edit-only',
        name: 'edit-only 图片编辑',
        type: 'image-edit',
        description: 'OpenAI 兼容图片编辑（模型 edit-only）',
      },
    ]);
  });
});
