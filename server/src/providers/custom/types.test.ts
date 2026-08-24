import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUSTOM_WORKFLOW_SIZE_CONFIG,
  parseCustomWorkflowEntry,
  parseCustomWorkflowSizeConfig,
  parseCustomWorkflows,
  parseUserConfigFields,
} from './types.js';

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
    expect(entries[0].sizeConfig).toBeNull();
  });
});

describe('parseCustomWorkflowSizeConfig', () => {
  it('缺失 / null / 空串返回 null（使用默认全量）', () => {
    expect(parseCustomWorkflowSizeConfig(undefined, 'x')).toBeNull();
    expect(parseCustomWorkflowSizeConfig(null, 'x')).toBeNull();
    expect(parseCustomWorkflowSizeConfig('', 'x')).toBeNull();
  });

  it('非对象报错', () => {
    expect(() => parseCustomWorkflowSizeConfig('oops', 'x')).toThrow(/需要是对象/);
    expect(() => parseCustomWorkflowSizeConfig([], 'x')).toThrow(/需要是对象/);
  });

  it('解析合法配置：清单保留声明顺序并去重，supportCustomSize 按 true 解析', () => {
    expect(parseCustomWorkflowSizeConfig({
      ratio: ['16:9', '4:3', 'auto', '16:9'],
      size: ['1K', '2K', 'auto'],
      supportCustomSize: false,
    }, 'x')).toEqual({
      ratio: ['16:9', '4:3', 'auto'],
      size: ['1K', '2K', 'auto'],
      supportCustomSize: false,
    });
  });

  it('缺失清单回退空数组（= 默认全量），未知档位过滤', () => {
    expect(parseCustomWorkflowSizeConfig({ supportCustomSize: true }, 'x')).toEqual({
      ratio: [],
      size: [],
      supportCustomSize: true,
    });
    expect(parseCustomWorkflowSizeConfig({
      ratio: ['999P', '16:9'],
      size: ['bad'],
      supportCustomSize: true,
    }, 'x')).toEqual({ ratio: ['16:9'], size: [], supportCustomSize: true });
  });

  it('非数组清单报错', () => {
    expect(() => parseCustomWorkflowSizeConfig({ ratio: 'oops' }, 'x')).toThrow(/「比例」需要是数组/);
    expect(() => parseCustomWorkflowSizeConfig({ size: 42 }, 'x')).toThrow(/「尺寸」需要是数组/);
  });

  it('默认全量常量与解析 null 一致（未配置条目使用）', () => {
    expect(DEFAULT_CUSTOM_WORKFLOW_SIZE_CONFIG).toEqual({
      ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', 'auto'],
      size: ['360P', '720P', '1080P', '2K', '4K', 'auto'],
      supportCustomSize: true,
    });
  });
});

describe('parseCustomWorkflowEntry 输出尺寸配置', () => {
  it('携带 sizeConfig 时解析保留', () => {
    const entry = parseCustomWorkflowEntry({
      name: 'wf',
      types: ['text-to-image'],
      sizeConfig: { ratio: ['16:9', 'auto'], size: ['1K'], supportCustomSize: false },
    }, 0);
    expect(entry.sizeConfig).toEqual({ ratio: ['16:9', 'auto'], size: ['1K'], supportCustomSize: false });
  });

  it('缺失时 sizeConfig 为 null（使用默认全量）', () => {
    const entry = parseCustomWorkflowEntry({
      name: 'wf',
      types: ['text-to-image'],
    }, 0);
    expect(entry.sizeConfig).toBeNull();
  });

  it('非法 sizeConfig 报中文错误（含条目位置）', () => {
    expect(() => parseCustomWorkflowEntry({
      name: 'wf',
      types: ['text-to-image'],
      sizeConfig: 'oops',
    }, 0)).toThrow(/输出尺寸配置需要是对象/);
  });
});
