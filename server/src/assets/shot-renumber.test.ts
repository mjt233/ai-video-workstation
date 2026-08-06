import { describe, expect, it } from 'vitest';
import { rewriteSceneShotPathsInText } from './shot-renumber.js';

describe('rewriteSceneShotPathsInText', () => {
  it('空 renames 返回原文', () => {
    const text = '{"path": "assert/scene/1/3/canvas/a/v1.mp4"}';
    expect(rewriteSceneShotPathsInText(text, '1', [])).toBe(text);
  });

  it('删除分镜（整体下移）：自己的产物路径 3→2，后续分镜引用 4→3', () => {
    const text = JSON.stringify({
      current: { path: 'assert/scene/1/3/canvas/n3/v1.mp4' },
      history: [{ path: 'assert/scene/1/3/canvas/n3/v1.mp4' }],
      assetPath: 'assert/scene/1/4/stage/0.jpg',
    });
    const out = rewriteSceneShotPathsInText(text, '1', [
      { from: '3', to: '2' },
      { from: '4', to: '3' },
    ]);
    expect(out).toContain('assert/scene/1/2/canvas/n3/v1.mp4');
    expect(out).not.toContain('assert/scene/1/3/canvas/n3');
    expect(out).toContain('assert/scene/1/3/stage/0.jpg');
    expect(out).not.toContain('assert/scene/1/4/stage/0.jpg');
  });

  it('插入分镜（整体上移）：自己的路径 2→3，不会被后续 3→4 再次匹配（防双移）', () => {
    const text = '{"path": "assert/scene/1/2/canvas/n2/v1.mp4"}';
    const out = rewriteSceneShotPathsInText(text, '1', [
      { from: '2', to: '3' },
      { from: '3', to: '4' },
      { from: '4', to: '5' },
    ]);
    expect(out).toContain('assert/scene/1/3/canvas/n2/v1.mp4');
    expect(out).not.toContain('assert/scene/1/4/canvas/n2');
    expect(out).not.toContain('assert/scene/1/5/canvas/n2');
  });

  it('插入分镜时对后续分镜的引用也同步 +1（3→4、4→5）', () => {
    const text = JSON.stringify({
      own: 'assert/scene/1/2/stage/0.jpg',
      next: 'assert/scene/1/3/stage/0.jpg',
      next2: 'assert/scene/1/4/stage/0.jpg',
    });
    const out = rewriteSceneShotPathsInText(text, '1', [
      { from: '2', to: '3' },
      { from: '3', to: '4' },
      { from: '4', to: '5' },
    ]);
    expect(out).toContain('assert/scene/1/3/stage/0.jpg');
    expect(out).toContain('assert/scene/1/4/stage/0.jpg');
    expect(out).toContain('assert/scene/1/5/stage/0.jpg');
  });

  it('不误伤多位数分镜号：scene/1/1 不匹配 scene/1/12', () => {
    const text = '{"a": "assert/scene/1/1/canvas/x/v1.jpg", "b": "assert/scene/1/12/canvas/y/v1.jpg"}';
    const out = rewriteSceneShotPathsInText(text, '1', [{ from: '1', to: '0' }]);
    expect(out).toContain('assert/scene/1/0/canvas/x/v1.jpg');
    // 12 不受 from=1 影响（from=1 只匹配后跟 / 或 " 的完整分镜号）
    expect(out).toContain('assert/scene/1/12/canvas/y/v1.jpg');
  });

  it('路径以分镜号结尾（后跟引号）也替换', () => {
    const text = '{"dir": "assert/scene/1/3"}';
    const out = rewriteSceneShotPathsInText(text, '1', [{ from: '3', to: '2' }]);
    expect(out).toContain('assert/scene/1/2"');
  });

  it('prompt 前缀的 scene 路径同样改写', () => {
    const text = '{"ref": "prompt/scene/1/3/canvas.json"}';
    const out = rewriteSceneShotPathsInText(text, '1', [{ from: '3', to: '2' }]);
    expect(out).toContain('prompt/scene/1/2/canvas.json');
  });

  it('未被重命名的分镜（<= 删除号）引用保持不变', () => {
    const text = '{"prev": "assert/scene/1/1/canvas/a/v1.jpg", "own": "assert/scene/1/3/canvas/b/v1.jpg"}';
    const out = rewriteSceneShotPathsInText(text, '1', [{ from: '3', to: '2' }]);
    expect(out).toContain('assert/scene/1/1/canvas/a/v1.jpg');
    expect(out).toContain('assert/scene/1/2/canvas/b/v1.jpg');
  });
});
