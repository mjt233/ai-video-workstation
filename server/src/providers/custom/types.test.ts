import { describe, expect, it } from 'vitest';
import { parseCustomWorkflowEntry, parseCustomWorkflows, parseUserConfigFields } from './types.js';

describe('parseUserConfigFields', () => {
  it('缺失 / 空值回退空数组', () => {
    expect(parseUserConfigFields(undefined, 'x')).toEqual([]);
    expect(parseUserConfigFields(null, 'x')).toEqual([]);
    expect(parseUserConfigFields('', 'x')).toEqual([]);
  });

  it('解析字段：type 非法回退 string，description 缺省省略', () => {
    expect(parseUserConfigFields([
      { key: 'model', name: '模型', type: 'string', defaultValue: 'gpt-image-2', description: '模型名' },
      { key: 'steps', name: '步数', type: 'integer', defaultValue: '20' },
      { key: 'weird', name: '', type: 'unknown-type', defaultValue: 5 },
    ], '工作流配置第 1 项')).toEqual([
      { key: 'model', name: '模型', type: 'string', defaultValue: 'gpt-image-2', description: '模型名' },
      { key: 'steps', name: '步数', type: 'integer', defaultValue: '20' },
      { key: 'weird', name: 'weird', type: 'string', defaultValue: '' },
    ]);
  });

  it('空 key 与重复 key 报错', () => {
    expect(() => parseUserConfigFields([{ key: '', name: 'a', type: 'string', defaultValue: '' }], 'x'))
      .toThrow(/缺少 key/);
    expect(() => parseUserConfigFields([
      { key: 'model', name: 'a', type: 'string', defaultValue: '' },
      { key: 'model', name: 'b', type: 'string', defaultValue: '' },
    ], 'x')).toThrow(/key 重复/);
  });
});

describe('parseCustomWorkflowEntry 用户配置字段', () => {
  it('缺省 userConfigFields 回退空数组', () => {
    const entry = parseCustomWorkflowEntry({
      name: 'wf',
      types: ['text-to-image'],
      async: false,
      cancelable: false,
      callCode: '',
      extractCode: '',
      cancelCode: '',
    }, 0);
    expect(entry.userConfigFields).toEqual([]);
  });

  it('userConfigFields 非数组报错', () => {
    expect(() => parseCustomWorkflowEntry({
      name: 'wf',
      types: ['text-to-image'],
      userConfigFields: 'oops',
    }, 0)).toThrow(/用户配置字段需要是数组/);
  });
});

describe('parseCustomWorkflows 兼容旧数据', () => {
  it('旧条目（无 userConfigFields）解析成功且字段为空数组', () => {
    const entries = parseCustomWorkflows([{ name: 'wf', types: ['text-to-image'] }]);
    expect(entries[0].userConfigFields).toEqual([]);
  });
});
