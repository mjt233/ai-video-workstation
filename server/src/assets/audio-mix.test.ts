import { describe, expect, it } from 'vitest';
import { buildMixFilter } from './audio-mix.js';
describe('buildMixFilter', () => {
  it('单段无裁剪无偏移直接用原输入', () => {
    expect(buildMixFilter([{ startOffset: 0, trimStart: 0, trimEnd: 0, duration: 3 }]))
      .toBe('[0:a]amix=inputs=1:duration=longest:dropout_transition=0[mix]');
  });
  it('trimStart/trimEnd 生成 atrim+asetpts', () => {
    const f = buildMixFilter([{ startOffset: 0, trimStart: 1, trimEnd: 0.5, duration: 4 }]);
    expect(f).toContain('atrim=start=1:end=3.5');
    expect(f).toContain('asetpts=PTS-STARTPTS');
  });
  it('startOffset 生成 adelay（毫秒，双声道）', () => {
    const f = buildMixFilter([{ startOffset: 1.5, trimStart: 0, trimEnd: 0, duration: 2 }]);
    expect(f).toContain('adelay=1500|1500');
  });
  it('多段：先各自裁剪定位，再 amix inputs=N:duration=longest', () => {
    const f = buildMixFilter([
      { startOffset: 0, trimStart: 0, trimEnd: 0, duration: 3 },
      { startOffset: 2, trimStart: 0.5, trimEnd: 0, duration: 4 },
    ]);
    expect(f).toContain('amix=inputs=2:duration=longest:dropout_transition=0[mix]');
  });
});
