import { describe, expect, it, vi } from 'vitest';
import { buildSceneVideoSubmitData, type SceneAdapterDeps } from './scene-adapter.js';
import type { VideoCapabilities } from './types.js';

function makeDeps(overrides: Partial<SceneAdapterDeps> = {}): SceneAdapterDeps {
  const mkFile = (name: string): File => new File(['x'], name, { type: 'image/png' });
  return {
    readFile: async (rel: string) => {
      if (rel.endsWith('overview.json')) return JSON.stringify({ duration: 5 });
      if (rel.endsWith('prompt.md')) return '一个测试分镜';
      if (rel.endsWith('script.json')) return JSON.stringify([{ 角色名: '小明', 台词: '你好' }]);
      if (rel.includes('character/小明/voice.md')) return '低沉男声';
      throw new Error(`unexpected readFile: ${rel}`);
    },
    readAssertFile: async (rel: string) => mkFile(rel.split('/').pop() ?? 'x'),
    // 场景帧图片（stage/{i}.jpg）视为已存在；merged.flac 默认不存在（走 TTS 分支）
    fileExists: async (rel: string) => rel.endsWith('.jpg'),
    mixAudioTracks: async () => {},
    readTempAudio: async () => new Uint8Array([1, 2]),
    removeTempAudio: async () => {},
    generateVoice: async (_text, _desc) => new File(['audio'], 'voice.flac', { type: 'audio/flac' }),
    ...overrides,
  };
}

const PROJECT_CONFIG = { width: 1080, height: 1920, fps: 24 };

describe('buildSceneVideoSubmitData', () => {
  it('导演台模式：有 director.json 且实现支持 director', async () => {
    const deps = makeDeps({
      readFile: async (rel: string) => {
        if (rel.endsWith('director.json')) {
          return JSON.stringify({
            version: 1, duration: 5, width: 720, height: 1280, fps: 30,
            imageClips: [{ path: 'assert/scene/1/1/stage/0.jpg', startOffset: 0, duration: 2 }],
            audioClips: [],
          });
        }
        if (rel.endsWith('prompt.md')) return '导演台提示词';
        throw new Error(`unexpected: ${rel}`);
      },
    });
    const caps: VideoCapabilities = { modes: ['director'], audio: true };
    const data = await buildSceneVideoSubmitData('p', '1', '1', caps, PROJECT_CONFIG, deps);
    expect(data.mode).toBe('director');
    expect(data.duration).toBe(5);
    expect(data.resolution).toEqual({ width: 720, height: 1280 });
    expect(data.director?.frames).toHaveLength(1);
    expect(data.director?.frames[0].cursor).toBe(0);
  });

  it('首尾帧模式：无 director.json 时按 stage.json 生成 frames，cursor 均匀分布', async () => {
    const deps = makeDeps({
      readFile: async (rel: string) => {
        if (rel.endsWith('overview.json')) return JSON.stringify({ duration: 6 });
        if (rel.endsWith('stage.json')) {
          return JSON.stringify([
            { 基础场景: 'a' },
            { 基础场景: 'b' },
            { 基础场景: 'c', disabled: true },
          ]);
        }
        if (rel.endsWith('prompt.md')) return '提示词';
        if (rel.endsWith('script.json')) return JSON.stringify([]);
        throw new Error(`unexpected: ${rel}`);
      },
    });
    const caps: VideoCapabilities = { modes: ['first-last-frame'] };
    const data = await buildSceneVideoSubmitData('p', '1', '1', caps, PROJECT_CONFIG, deps);
    expect(data.mode).toBe('first-last-frame');
    // disabled 的第三帧被跳过 → 只有 2 帧
    expect(data.director?.frames).toHaveLength(2);
    expect(data.director?.frames[0].cursor).toBe(0);
    expect(data.director?.frames[1].cursor).toBe(1);
  });

  it('首尾帧模式：台词生成 TTS 配音', async () => {
    const genVoice = vi.fn(async () => new File(['a'], 'v.flac', { type: 'audio/flac' }));
    const deps = makeDeps({
      readFile: async (rel: string) => {
        if (rel.endsWith('overview.json')) return JSON.stringify({ duration: 6 });
        if (rel.endsWith('stage.json')) return JSON.stringify([{ 基础场景: 'a' }, { 基础场景: 'b' }]);
        if (rel.endsWith('prompt.md')) return '提示词';
        if (rel.endsWith('script.json')) return JSON.stringify([{ 角色名: '小明', 台词: '你好' }]);
        if (rel.includes('character/小明/voice.md')) return '低沉男声';
        throw new Error(`unexpected: ${rel}`);
      },
      generateVoice: genVoice,
    });
    const caps: VideoCapabilities = { modes: ['first-last-frame'] };
    const data = await buildSceneVideoSubmitData('p', '1', '1', caps, PROJECT_CONFIG, deps);
    expect(genVoice).toHaveBeenCalledTimes(1);
    expect(genVoice).toHaveBeenCalledWith('你好。', '低沉男声');
    expect(data.director?.audio).toBeDefined();
  });

  it('参考模式：实现仅支持 reference（不支持首尾帧）时，分镜场景帧组装为参考素材', async () => {
    const genVoice = vi.fn(async () => new File(['a'], 'v.flac', { type: 'audio/flac' }));
    const deps = makeDeps({
      readFile: async (rel: string) => {
        if (rel.endsWith('director.json')) {
          return JSON.stringify({ version: 1, duration: 5, width: 720, height: 1280, fps: 30, imageClips: [], audioClips: [] });
        }
        if (rel.endsWith('overview.json')) return JSON.stringify({ duration: 5 });
        if (rel.endsWith('stage.json')) return JSON.stringify([{ 基础场景: 'a' }, { 基础场景: 'b' }]);
        if (rel.endsWith('prompt.md')) return '提示词';
        if (rel.endsWith('script.json')) return JSON.stringify([{ 角色名: '小明', 台词: '你好' }]);
        if (rel.includes('character/小明/voice.md')) return '低沉男声';
        throw new Error(`unexpected: ${rel}`);
      },
      generateVoice: genVoice,
    });
    const caps: VideoCapabilities = { modes: ['reference'] };
    const data = await buildSceneVideoSubmitData('p', '1', '1', caps, PROJECT_CONFIG, deps);
    expect(data.mode).toBe('reference');
    expect(data.references).toHaveLength(3);
    expect(data.references?.[0]).toEqual({ type: 'image', file: expect.any(File) });
    expect(data.references?.[1]).toEqual({ type: 'image', file: expect.any(File) });
    expect(data.references?.[2]).toEqual({ type: 'audio', file: expect.any(File) });
    expect(data.director).toBeUndefined();
    expect(genVoice).toHaveBeenCalledTimes(1);
  });

  it('参考模式：无台词且无 merged.flac 时不注入参考音频', async () => {
    const deps = makeDeps({
      readFile: async (rel: string) => {
        if (rel.endsWith('overview.json')) return JSON.stringify({ duration: 5 });
        if (rel.endsWith('stage.json')) return JSON.stringify([{ 基础场景: 'a' }]);
        if (rel.endsWith('prompt.md')) return '提示词';
        if (rel.endsWith('script.json')) return JSON.stringify([]);
        throw new Error(`unexpected: ${rel}`);
      },
    });
    const caps: VideoCapabilities = { modes: ['reference'] };
    const data = await buildSceneVideoSubmitData('p', '1', '1', caps, PROJECT_CONFIG, deps);
    expect(data.mode).toBe('reference');
    expect(data.references).toHaveLength(1);
    expect(data.references?.[0]).toEqual({ type: 'image', file: expect.any(File) });
  });

  it('实现同时支持 reference 与 first-last-frame 时仍走首尾帧模式（保持既有行为）', async () => {
    const deps = makeDeps({
      readFile: async (rel: string) => {
        if (rel.endsWith('overview.json')) return JSON.stringify({ duration: 5 });
        if (rel.endsWith('stage.json')) return JSON.stringify([{ 基础场景: 'a' }]);
        if (rel.endsWith('prompt.md')) return '提示词';
        if (rel.endsWith('script.json')) return JSON.stringify([]);
        throw new Error(`unexpected: ${rel}`);
      },
    });
    const caps: VideoCapabilities = { modes: ['reference', 'first-last-frame'] };
    const data = await buildSceneVideoSubmitData('p', '1', '1', caps, PROJECT_CONFIG, deps);
    expect(data.mode).toBe('first-last-frame');
    expect(data.director?.frames).toHaveLength(1);
  });
});
