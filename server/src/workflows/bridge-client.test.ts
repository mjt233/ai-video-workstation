import { describe, expect, it } from 'vitest';
import {
  buildTextToImagePayload,
  buildTtsPayload,
  buildImageEditPayload,
  buildFirstLastFramePayload,
  buildDirectorPayload,
  buildReferencePayload,
  resolveImageEditSizeParams,
} from './bridge-client.js';

const img = (name: string) => new File(['x'], name, { type: 'image/png' });
const aud = new File(['a'], 'bg.flac', { type: 'audio/flac' });

describe('buildTextToImagePayload', () => {
  it('基础字段 + 可选 seed/enhance_prompt', () => {
    const p = buildTextToImagePayload({ workflowId: 'text_to_image', prompt: '猫', width: 1080, height: 1920, seed: 1, enhance_prompt: true });
    expect(p).toEqual({ workflowId: 'text_to_image', params: { prompt: '猫', width: 1080, height: 1920, seed: 1, enhance_prompt: true } });
  });
  it('省略可选字段不上送', () => {
    const p = buildTextToImagePayload({ workflowId: 'text_to_image', prompt: '猫', width: 1080, height: 1920 });
    expect(p.params).toEqual({ prompt: '猫', width: 1080, height: 1920 });
  });
});

describe('buildTtsPayload', () => {
  it('prompt/text/seed', () => {
    const p = buildTtsPayload({ workflowId: 'tts_voice_design', prompt: '温柔女声', text: '你好', seed: '1' });
    expect(p).toEqual({ workflowId: 'tts_voice_design', params: { prompt: '温柔女声', text: '你好', seed: '1' } });
  });
});

describe('buildImageEditPayload', () => {
  it('多图映射 image_0/image_1（0-based）', () => {
    const p = buildImageEditPayload({ workflowId: 'qwen-edit-2509', prompt: '改成夜景', imgs: [img('a.jpg'), img('b.jpg')] });
    expect(p.params.prompt).toBe('改成夜景');
    expect(Object.keys(p.files!)).toEqual(['image_0', 'image_1']);
  });
  it('尺寸仅在 enable_specified_size 时透传', () => {
    const p = buildImageEditPayload({ workflowId: 'qwen-edit-2509', prompt: 'x', imgs: [img('a.jpg')], size: { enable_specified_size: true, width: 720, height: 1280 } });
    expect(p.params).toMatchObject({ enable_specified_size: true, width: 720, height: 1280 });
    const p2 = buildImageEditPayload({ workflowId: 'qwen-edit-2509', prompt: 'x', imgs: [img('a.jpg')], size: {} });
    expect(p2.params).toEqual({ prompt: 'x' });
  });
});

describe('buildFirstLastFramePayload', () => {
  it('1 帧 image_0，auto_generate_audio=true', () => {
    const p = buildFirstLastFramePayload({ workflowId: 'I2V', prompt: 'p', width: 1280, height: 720, duration: 5, fps: 24, frames: [img('f0.png')] });
    expect(p.params).toMatchObject({ prompt: 'p', width: 1280, height: 720, duration: 5, fps: 24, auto_generate_audio: true });
    expect(Object.keys(p.files!)).toEqual(['image_0']);
    expect(p.params.mid_frame_cursor).toBeUndefined();
  });
  it('3 帧 image_0..2 + mid_frame_cursor=0.5', () => {
    const p = buildFirstLastFramePayload({ workflowId: 'FML2V', prompt: 'p', width: 1280, height: 720, duration: 5, fps: 24, frames: [img('a'), img('b'), img('c')] });
    expect(Object.keys(p.files!)).toEqual(['image_0', 'image_1', 'image_2']);
    expect(p.params.mid_frame_cursor).toBe(0.5);
  });
  it('提供 audio 时 audio 键 + auto_generate_audio=false', () => {
    const p = buildFirstLastFramePayload({ workflowId: 'FL2V', prompt: 'p', width: 1280, height: 720, duration: 5, fps: 24, frames: [img('a'), img('b')], audio: aud });
    expect(p.params.auto_generate_audio).toBe(false);
    expect(p.files!.audio).toBe(aud);
  });
});

describe('buildDirectorPayload', () => {
  it('frame_define JSON + image_{frameSeq} + audio', () => {
    const p = buildDirectorPayload({
      workflowId: 'ltx-2.3-director', prompt: 'p', width: 1920, height: 1080, duration: 5, fps: 24,
      frameDefines: [{ frameSeq: 0, cursor: 0 }, { frameSeq: 1, cursor: 0.5 }],
      frameFiles: [img('a'), img('b')], audio: aud,
    });
    expect(p.params.frame_define).toBe(JSON.stringify([{ frameSeq: 0, cursor: 0 }, { frameSeq: 1, cursor: 0.5 }]));
    expect(p.params.auto_generate_audio).toBe(false);
    expect(Object.keys(p.files!)).toEqual(['image_0', 'image_1', 'audio']);
  });
});

describe('buildReferencePayload', () => {
  it('image/video/audio 各自 0-based', () => {
    const p = buildReferencePayload({ workflowId: 'minimax-h3-r2v', prompt: 'p', width: 1280, height: 720, duration: 5, imageRefs: [img('a'), img('b')], videoRefs: [], audioRefs: [aud] });
    expect(Object.keys(p.files!)).toEqual(['image_0', 'image_1', 'audio_0']);
  });
});

describe('resolveImageEditSizeParams', () => {
  it('enable_specified_size=true 时返回宽高', () => {
    expect(resolveImageEditSizeParams({ enable_specified_size: 'true', width: '720', height: '1280' })).toEqual({ enable_specified_size: true, width: 720, height: 1280 });
  });
  it('否则返回空对象', () => {
    expect(resolveImageEditSizeParams({ width: '720' })).toEqual({});
  });
});
