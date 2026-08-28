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

  it('解析候选项：label 缺省回退 value、multiple/allowCustom 按声明解析', () => {
    expect(parseUserConfigFields([
      {
        key: 'style',
        name: '画风',
        type: 'string',
        defaultValue: 'realism,anime',
        options: [
          { label: '写实风格', value: 'realism' },
          { value: 'anime' }, // label 缺省回退 value
        ],
        multiple: true,
      },
      {
        key: 'mode',
        name: '模式',
        type: 'string',
        defaultValue: 'fast',
        options: [{ label: '快速', value: 'fast' }],
        multiple: false,
        allowCustom: false, // 严格下拉
      },
    ], 'x')).toEqual([
      {
        key: 'style',
        name: '画风',
        type: 'string',
        defaultValue: 'realism,anime',
        options: [
          { label: '写实风格', value: 'realism' },
          { label: 'anime', value: 'anime' },
        ],
        multiple: true,
      },
      {
        key: 'mode',
        name: '模式',
        type: 'string',
        defaultValue: 'fast',
        options: [{ label: '快速', value: 'fast' }],
        allowCustom: false, // multiple=false 不携带（非多选即缺省语义）
      },
    ]);
  });

  it('候选项 value 去首尾空白；未配置候选项时不携带 multiple/allowCustom', () => {
    const fields = parseUserConfigFields([
      { key: 'a', name: 'A', type: 'string', defaultValue: '', options: [{ label: ' X ', value: ' x ' }], multiple: true },
      { key: 'b', name: 'B', type: 'string', defaultValue: '', multiple: true, allowCustom: false }, // 无候选项 → 忽略
    ], 'x');
    expect(fields[0].options).toEqual([{ label: 'X', value: 'x' }]);
    expect(fields[0].multiple).toBe(true);
    expect(fields[1].options).toBeUndefined();
    expect(fields[1].multiple).toBeUndefined();
    expect(fields[1].allowCustom).toBeUndefined();
  });

  it('候选项结构非法报中文错误', () => {
    const base = { key: 'style', name: '画风', type: 'string', defaultValue: '' };
    expect(() => parseUserConfigFields([{ ...base, options: 'oops' }], 'x')).toThrow(/候选项需要是数组/);
    expect(() => parseUserConfigFields([{ ...base, options: ['fast'] }], 'x')).toThrow(/候选项第 1 项需要是对象/);
    expect(() => parseUserConfigFields([{ ...base, options: [{ label: '快速' }] }], 'x')).toThrow(/缺少 value/);
    expect(() => parseUserConfigFields([{ ...base, options: [{ label: 'a', value: 'a,b' }] }], 'x')).toThrow(/不能包含英文逗号/);
    expect(() => parseUserConfigFields([{ ...base, options: [{ value: 'a' }, { value: 'a' }] }], 'x')).toThrow(/value 重复/);
  });

  it('非 string 类型配置候选项报错', () => {
    expect(() => parseUserConfigFields([
      { key: 'steps', name: '步数', type: 'integer', defaultValue: '', options: [{ label: '20', value: '20' }] },
    ], 'x')).toThrow(/仅字符串类型支持配置候选项/);
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
