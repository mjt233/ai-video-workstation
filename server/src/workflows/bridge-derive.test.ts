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
  it('非视频类型 → 无 video 能力、cancelable=true', () => {
    const caps = deriveCapabilities([group('text-to-image')], 'text-to-image');
    expect(caps.video).toBeUndefined();
    expect(caps.cancelable).toBe(true);
  });
});

describe('deriveParams', () => {
  const declared: BridgeDeclaredParam[] = [
    { alias: 'prompt', label: '提示词', paramType: 'text' },
    { alias: 'steps', label: '步数', paramType: 'number' },
    { alias: 'enhance', label: '增强', paramType: 'boolean' },
    { alias: 'input_image', label: '输入图', paramType: 'image' },
  ];
  it('按 expose_field 过滤并映射', () => {
    const params = deriveParams('steps,enhance', declared);
    expect(params).toEqual([
      { key: 'steps', name: '步数', type: 'integer', defaultValue: '' },
      { key: 'enhance', name: '增强', type: 'boolean', defaultValue: false },
    ]);
  });
  it('expose_field 为空 → 空数组', () => {
    expect(deriveParams(undefined, declared)).toEqual([]);
    expect(deriveParams('', declared)).toEqual([]);
  });
  it('image/video/audio 类型跳过', () => {
    const params = deriveParams('prompt,input_image', declared);
    expect(params.map((p) => p.key)).toEqual(['prompt']);
  });
});
