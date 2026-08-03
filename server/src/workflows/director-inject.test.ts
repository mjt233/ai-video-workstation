import { describe, expect, it } from 'vitest';
import { buildDirectorPayload } from './director-inject.js';

const baseConfig = { version: 1, duration: 10, width: 1080, height: 1920, fps: 24 };

function deps(overrides = {}) {
  return {
    readFile: async () => JSON.stringify({ ...baseConfig, imageClips: [
      { path: 'assert/2.jpg', startOffset: 6, duration: 2 },
      { path: 'assert/1.jpg', startOffset: 0, duration: 2 },
    ], audioClips: [] }),
    readAssertFile: async (p: string) => ({ name: p.split('/').pop() }) as unknown as File,
    mixAudioTracks: async () => {},
    readTempAudio: async () => new Uint8Array([1, 2, 3]),
    ...overrides,
  };
}

describe('buildDirectorPayload', () => {
  it('返回按 startOffset 排序的 frames 与 cursor', async () => {
    const p = await buildDirectorPayload('AI的第一天', '1', '1', deps());
    expect(p).not.toBeNull();
    expect(p!.frames.map(f => f.frameSeq)).toEqual([0, 1]);
    expect(p!.frames[0].cursor).toBe(0);
    expect(p!.frames[1].cursor).toBe(0.6);
    expect(p!.duration).toBe(10);
  });
  it('readFile 抛错（无 director.json）时返回 null', async () => {
    const p = await buildDirectorPayload('p', '1', '1', deps({
      readFile: async () => { throw new Error('ENOENT'); },
    }));
    expect(p).toBeNull();
  });
  it('imageClips 为空时返回 null', async () => {
    const p = await buildDirectorPayload('p', '1', '1', deps({
      readFile: async () => JSON.stringify({ ...baseConfig, imageClips: [], audioClips: [] }),
    }));
    expect(p).toBeNull();
  });
  it('audioClips 非空时调用混音并注入 audio', async () => {
    const d = deps({ readFile: async () => JSON.stringify({ ...baseConfig, imageClips: [
      { path: 'assert/1.jpg', startOffset: 0, duration: 2 },
    ], audioClips: [{ path: 'assert/bg.flac', startOffset: 0, duration: 3, trimStart: 0, trimEnd: 0 }] }) });
    const p = await buildDirectorPayload('p', '1', '1', d);
    expect(p!.audio).toBeTruthy();
  });
});
