import { describe, expect, it } from 'vitest';
import { deriveWorkflowType, deriveCapabilities, deriveParams } from './bridge-derive.js';
import type { BridgeDeclaredParam, BridgeTagGroup } from '../providers/comfyui-bridge/client.js';

const group = (id: string, children: BridgeTagGroup[] = [], metadata: Record<string, unknown> = {}): BridgeTagGroup => ({ id, metadata, tags: children });

describe('deriveWorkflowType', () => {
  it('text-to-image 父标签 → text-to-image', () => {
    expect(deriveWorkflowType([group('text-to-image')])).toBe('text-to-image');
  });
  it('image-edit → image-edit', () => {
    expect(deriveWorkflowType([group('image-edit')])).toBe('image-edit');
  });
  it('tts-voice-design → tts-voice-design', () => {
    expect(deriveWorkflowType([group('tts-voice-design')])).toBe('tts-voice-design');
  });
  it('image-to-video → image-to-video', () => {
    expect(deriveWorkflowType([group('image-to-video')])).toBe('image-to-video');
  });
  it('tts-voice-clone 父标签 → tts-voice-clone', () => {
    expect(deriveWorkflowType([group('tts-voice-clone')])).toBe('tts-voice-clone');
  });
  it('未知类型 → null', () => {
    expect(deriveWorkflowType([group('text-to-video')])).toBeNull();
  });
  it('空标签 → null', () => {
    expect(deriveWorkflowType([])).toBeNull();
  });
});

describe('deriveCapabilities', () => {
  it('reference 子标签 → modes 含 reference + 参考上限元数据', () => {
    const caps = deriveCapabilities([group('image-to-video', [group('reference', [], { maxImageCount: 9, maxAudioCount: 3, maxVideoCount: 3, maxTotalCount: 12 })])], 'image-to-video');
    expect(caps.video?.modes).toContain('reference');
    expect(caps.video?.reference).toMatchObject({ maxTotal: 12 });
  });
  it('director 子标签 → modes 含 director + audio', () => {
    const caps = deriveCapabilities([group('image-to-video', [group('director'), group('audio-input')])], 'image-to-video');
    expect(caps.video?.modes).toContain('director');
    expect(caps.video?.audio).toBe(true);
  });
  it('first-last-frame 子标签 → maxFrames=2', () => {
    const caps = deriveCapabilities([group('image-to-video', [group('first-last-frame')])], 'image-to-video');
    expect(caps.video?.modes).toContain('first-last-frame');
    expect(caps.video?.firstLastFrame?.maxFrames).toBe(2);
  });
  it('first-frame 子标签 → maxFrames=1', () => {
    const caps = deriveCapabilities([group('image-to-video', [group('first-frame')])], 'image-to-video');
    expect(caps.video?.firstLastFrame?.maxFrames).toBe(1);
  });
  it('reference 子标签缺省元数据时使用默认上限', () => {
    const caps = deriveCapabilities([group('image-to-video', [group('reference')])], 'image-to-video');
    expect(caps.video?.reference).toEqual({
      maxTotal: 12,
      types: { image: { max: 9 }, video: { max: 3 }, audio: { max: 3 } },
    });
  });
  it('reference 子标签读取用户配置的非默认上限', () => {
    const caps = deriveCapabilities(
      [group('image-to-video', [group('reference', [], { maxImageCount: 5, maxTotalCount: 20 })])],
      'image-to-video',
    );
    expect(caps.video?.reference?.maxTotal).toBe(20);
    expect(caps.video?.reference?.types?.image?.max).toBe(5);
    // 未配置的 video/audio 仍用默认值
    expect(caps.video?.reference?.types?.video?.max).toBe(3);
    expect(caps.video?.reference?.types?.audio?.max).toBe(3);
  });
  it('audio-output 子标签 → audio=true', () => {
    const caps = deriveCapabilities([group('image-to-video', [group('audio-output')])], 'image-to-video');
    expect(caps.video?.audio).toBe(true);
  });
  it('非视频类型 → 无 video 能力、cancelable=true', () => {
    const caps = deriveCapabilities([group('text-to-image')], 'text-to-image');
    expect(caps.video).toBeUndefined();
    expect(caps.cancelable).toBe(true);
  });
  it('文生图/图编辑/图生视频 → 声明统一尺寸能力（含自定义宽高）', () => {
    const expected = {
      ratio: ['16:9', '9:16', '3:2', '2:3', '21:9', '1:1', '4:3', '3:4'],
      size: ['360P', '480P', '720P', '768P', '1080P', '2K', '4K'],
      supportCustomSize: true,
    };
    expect(deriveCapabilities([group('text-to-image')], 'text-to-image').size).toEqual(expected);
    expect(deriveCapabilities([group('image-edit')], 'image-edit').size).toEqual(expected);
    expect(deriveCapabilities([group('image-to-video')], 'image-to-video').size).toEqual(expected);
  });
  it('TTS 类型不声明尺寸能力', () => {
    expect(deriveCapabilities([group('tts-voice-design')], 'tts-voice-design').size).toBeUndefined();
    expect(deriveCapabilities([group('tts-voice-clone')], 'tts-voice-clone').size).toBeUndefined();
  });
});

describe('deriveParams', () => {
  const fixed: BridgeDeclaredParam[] = [
    { alias: 'prompt', label: '提示词', paramType: 'text' },
    { alias: 'steps', label: '步数', paramType: 'number' },
    { alias: 'enhance', label: '增强', paramType: 'boolean' },
    { alias: 'input_image', label: '输入图', paramType: 'image' },
  ];
  it('按 expose_field 过滤并映射（params 优先）', () => {
    const params = deriveParams('steps,enhance', fixed, []);
    expect(params).toEqual([
      { key: 'steps', name: '步数', type: 'integer', defaultValue: '' },
      { key: 'enhance', name: '增强', type: 'boolean', defaultValue: false },
    ]);
  });
  it('expose_field 为空 → 空数组', () => {
    expect(deriveParams(undefined, fixed, [])).toEqual([]);
    expect(deriveParams('', fixed, [])).toEqual([]);
  });
  it('image/video/audio 类型跳过', () => {
    const params = deriveParams('prompt,input_image', fixed, []);
    expect(params.map((p) => p.key)).toEqual(['prompt']);
  });
  it('expose_field 含空白与尾逗号时正确解析', () => {
    const params = deriveParams('steps, enhance ,', fixed, []);
    expect(params.map((p) => p.key)).toEqual(['steps', 'enhance']);
  });
  it('params 优先：同一别名以 params 字段信息为准，declaredParams 兜底缺失别名', () => {
    const declared: BridgeDeclaredParam[] = [
      { alias: 'steps', label: '步数(旧)', paramType: 'number' },
      { alias: 'extra_field', label: '额外字段', paramType: 'text' },
    ];
    const params = deriveParams('steps,extra_field', fixed, declared);
    expect(params).toEqual([
      { key: 'steps', name: '步数', type: 'integer', defaultValue: '' }, // params 优先（label=步数）
      { key: 'extra_field', name: '额外字段', type: 'string', defaultValue: '' }, // declaredParams 兜底
    ]);
  });
  it('declaredParams 兜底：别名仅存在于 declaredParams 时仍映射', () => {
    const declared: BridgeDeclaredParam[] = [{ alias: 'extra_field', label: '额外字段', paramType: 'text' }];
    expect(deriveParams('extra_field', [], declared)).toEqual([
      { key: 'extra_field', name: '额外字段', type: 'string', defaultValue: '' },
    ]);
  });
  it('defaultValue 非 null 时使用并做类型转换（number→整数、boolean→布尔）', () => {
    const fields: BridgeDeclaredParam[] = [
      { alias: 'steps', label: '步数', paramType: 'number', defaultValue: '20' },
      { alias: 'enhance', label: '增强', paramType: 'boolean', defaultValue: 'true' },
      { alias: 'keep_bg', label: '保留背景', paramType: 'boolean', defaultValue: 'false' },
      { alias: 'prompt', label: '提示词', paramType: 'text', defaultValue: '一只猫' },
    ];
    const params = deriveParams('steps,enhance,keep_bg,prompt', fields, []);
    expect(params).toEqual([
      { key: 'steps', name: '步数', type: 'integer', defaultValue: 20 },
      { key: 'enhance', name: '增强', type: 'boolean', defaultValue: true },
      { key: 'keep_bg', name: '保留背景', type: 'boolean', defaultValue: false },
      { key: 'prompt', name: '提示词', type: 'string', defaultValue: '一只猫' },
    ]);
  });
  it('defaultValue 为 null 时取 nodeRawValue（number/boolean 同样类型转换）', () => {
    const fields: BridgeDeclaredParam[] = [
      { alias: 'steps', label: '步数', paramType: 'number', defaultValue: null, nodeRawValue: '30' },
      { alias: 'enhance', label: '增强', paramType: 'boolean', defaultValue: null, nodeRawValue: '1' },
      { alias: 'prompt', label: '提示词', paramType: 'text', defaultValue: null, nodeRawValue: '一只猫' },
    ];
    const params = deriveParams('steps,enhance,prompt', fields, []);
    expect(params).toEqual([
      { key: 'steps', name: '步数', type: 'integer', defaultValue: 30 },
      { key: 'enhance', name: '增强', type: 'boolean', defaultValue: true },
      { key: 'prompt', name: '提示词', type: 'string', defaultValue: '一只猫' },
    ]);
  });
  it('number 默认值非法数值时回退 0；boolean 非 true/1 视为 false', () => {
    const fields: BridgeDeclaredParam[] = [
      { alias: 'steps', label: '步数', paramType: 'number', defaultValue: 'abc' },
      { alias: 'enhance', label: '增强', paramType: 'boolean', defaultValue: 'yes' },
    ];
    const params = deriveParams('steps,enhance', fields, []);
    expect(params).toEqual([
      { key: 'steps', name: '步数', type: 'integer', defaultValue: 0 },
      { key: 'enhance', name: '增强', type: 'boolean', defaultValue: false },
    ]);
  });
  it('defaultValue 与 nodeRawValue 均缺省时回退类型缺省值（布尔 false，其余空串）', () => {
    const fields: BridgeDeclaredParam[] = [
      { alias: 'steps', label: '步数', paramType: 'number' },
      { alias: 'enhance', label: '增强', paramType: 'boolean' },
      { alias: 'prompt', label: '提示词', paramType: 'text' },
    ];
    const params = deriveParams('steps,enhance,prompt', fields, []);
    expect(params).toEqual([
      { key: 'steps', name: '步数', type: 'integer', defaultValue: '' },
      { key: 'enhance', name: '增强', type: 'boolean', defaultValue: false },
      { key: 'prompt', name: '提示词', type: 'string', defaultValue: '' },
    ]);
  });
});
