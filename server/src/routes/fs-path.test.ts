import { describe, expect, it } from 'vitest';
import path from 'path';
import {
  FsRouteError,
  isUnderAssert,
  normalizeRelPath,
  resolveProjectPath,
  validateCopyRequest,
} from './fs-path.js';

/** 测试用项目根（纯路径运算，无需真实目录） */
const PROJECT_ROOT = path.resolve('C:/proj-canvas-test');

describe('normalizeRelPath', () => {
  it('将反斜杠路径规范化为正斜杠', () => {
    expect(normalizeRelPath('assert\\scene\\1\\1\\canvas\\a.png')).toBe('assert/scene/1/1/canvas/a.png');
  });

  it('正斜杠路径保持不变', () => {
    expect(normalizeRelPath('assert/scene/1/1')).toBe('assert/scene/1/1');
  });
});

describe('isUnderAssert', () => {
  it('assert/ 前缀返回 true', () => {
    expect(isUnderAssert('assert/scene/1/1/canvas/x.jpg')).toBe(true);
  });

  it('assert 无斜杠前缀返回 false', () => {
    expect(isUnderAssert('assertfoo/bar')).toBe(false);
  });

  it('prompt/ 前缀返回 false', () => {
    expect(isUnderAssert('prompt/scene/1/1/overview.json')).toBe(false);
  });
});

describe('resolveProjectPath', () => {
  it('正常路径解析到项目根之下', () => {
    const full = resolveProjectPath(PROJECT_ROOT, 'assert/scene/1/1/canvas/a.png');
    expect(full.startsWith(PROJECT_ROOT + path.sep)).toBe(true);
    expect(full.endsWith(path.join('assert', 'scene', '1', '1', 'canvas', 'a.png'))).toBe(true);
  });

  it('反斜杠路径同样解析', () => {
    const full = resolveProjectPath(PROJECT_ROOT, 'assert\\scene\\1');
    expect(full.startsWith(PROJECT_ROOT + path.sep)).toBe(true);
  });

  it('.. 逃逸项目根抛出 FsRouteError(403)', () => {
    let caught: unknown;
    try {
      resolveProjectPath(PROJECT_ROOT, '../outside');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FsRouteError);
    expect((caught as FsRouteError).status).toBe(403);
  });
});

describe('validateCopyRequest', () => {
  it('from/to 均在 assert/ 下时返回规范化路径', () => {
    const r = validateCopyRequest(
      PROJECT_ROOT,
      'assert/scene/1/1/canvas/src',
      'assert/scene/1/1/canvas/dst',
    );
    expect(r.fromNorm).toBe('assert/scene/1/1/canvas/src');
    expect(r.toNorm).toBe('assert/scene/1/1/canvas/dst');
    expect(r.fromFull.startsWith(PROJECT_ROOT + path.sep)).toBe(true);
    expect(r.toFull.startsWith(PROJECT_ROOT + path.sep)).toBe(true);
  });

  it('from 为空时抛出 FsRouteError(400)', () => {
    let caught: unknown;
    try {
      validateCopyRequest(PROJECT_ROOT, '', 'assert/a/b');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FsRouteError);
    expect((caught as FsRouteError).status).toBe(400);
  });

  it('from 不在 assert/ 下抛出 FsRouteError(403)', () => {
    expect(() => validateCopyRequest(PROJECT_ROOT, 'prompt/a', 'assert/a/b')).toThrow(FsRouteError);
  });

  it('to 不在 assert/ 下抛出 FsRouteError(403)', () => {
    expect(() => validateCopyRequest(PROJECT_ROOT, 'assert/a/b', 'prompt/a')).toThrow(FsRouteError);
  });
});
