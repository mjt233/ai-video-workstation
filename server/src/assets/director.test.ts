import { describe, expect, it } from 'vitest';
import { parseDirectorJson, computeFrameDefines } from './director.js';

describe('parseDirectorJson', () => {
  it('解析合法配置', () => {
    const c = parseDirectorJson(JSON.stringify({
      version: 1, duration: 10, width: 1080, height: 1920, fps: 24,
      imageClips: [{ path: 'assert/scene/1/1/stage/0.jpg', startOffset: 0, duration: 2 }],
      audioClips: [],
    }));
    expect(c.duration).toBe(10);
    expect(c.imageClips).toHaveLength(1);
  });
  it('非法 JSON 抛错', () => { expect(() => parseDirectorJson('not-json')).toThrow(); });
  it('duration 非正整数抛错', () => {
    expect(() => parseDirectorJson(JSON.stringify({ version: 1, duration: -1, imageClips: [], audioClips: [] }))).toThrow();
  });
  it('imageClip 缺少 path 抛错', () => {
    expect(() => parseDirectorJson(JSON.stringify({
      version: 1, duration: 10, width: 1080, height: 1920, fps: 24,
      imageClips: [{ startOffset: 0, duration: 2 }],
      audioClips: [],
    }))).toThrow(/path/);
  });
  it('imageClip startOffset 为负抛错', () => {
    expect(() => parseDirectorJson(JSON.stringify({
      version: 1, duration: 10, width: 1080, height: 1920, fps: 24,
      imageClips: [{ path: 'a.jpg', startOffset: -1, duration: 2 }],
      audioClips: [],
    }))).toThrow(/startOffset/);
  });
  it('audioClip trimStart 为负抛错', () => {
    expect(() => parseDirectorJson(JSON.stringify({
      version: 1, duration: 10, width: 1080, height: 1920, fps: 24,
      imageClips: [{ path: 'a.jpg', startOffset: 0, duration: 2 }],
      audioClips: [{ path: 'b.flac', startOffset: 0, duration: 3, trimStart: -1, trimEnd: 0 }],
    }))).toThrow(/trimStart/);
  });
});

describe('computeFrameDefines', () => {
  it('按 startOffset 升序生成 frameSeq 与 cursor', () => {
    const defs = computeFrameDefines([
      { path: 'b', startOffset: 6, duration: 2 },
      { path: 'a', startOffset: 0, duration: 2 },
      { path: 'c', startOffset: 3, duration: 2 },
    ], 10);
    expect(defs.map(d => d.path)).toEqual(['a', 'c', 'b']);
    expect(defs[0].frameSeq).toBe(0);
    expect(defs[0].cursor).toBe(0);
    expect(defs[1].cursor).toBe(0.3);
    expect(defs[2].frameSeq).toBe(2);
    expect(defs[2].cursor).toBe(0.6);
  });
  it('startOffset 接近时长时 cursor 正确钳制', () => {
    const defs = computeFrameDefines([{ path: 'a', startOffset: 9, duration: 2 }], 10);
    expect(defs[0].cursor).toBe(0.9);
  });
  it('startOffset 超过时长时 cursor 钳制为 1', () => {
    const defs = computeFrameDefines([{ path: 'a', startOffset: 15, duration: 10 }], 10);
    expect(defs[0].cursor).toBe(1);
  });
  it('startOffset 为负时 cursor 钳制为 0', () => {
    const defs = computeFrameDefines([{ path: 'a', startOffset: -1, duration: 10 }], 10);
    expect(defs[0].cursor).toBe(0);
  });
});
