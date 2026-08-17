import { describe, expect, it } from 'vitest';
import {
  FsRouteError,
} from './fs-path.js';
import {
  deriveProjectName,
  isUnsafeZipEntry,
  validateImportName,
} from './project-port.js';

describe('validateImportName', () => {
  it('合法项目名通过校验', () => {
    expect(() => validateImportName('古人在现代')).not.toThrow();
    expect(() => validateImportName('AI的第一天')).not.toThrow();
  });

  it('空项目名抛出 FsRouteError(400)', () => {
    expect(() => validateImportName('')).toThrow(FsRouteError);
    expect(() => validateImportName('   ')).toThrow(FsRouteError);
  });

  it('包含 / 或 \\ 的项目名抛出 FsRouteError(400)', () => {
    expect(() => validateImportName('a/b')).toThrow(FsRouteError);
    expect(() => validateImportName('a\\b')).toThrow(FsRouteError);
  });

  it('. 与 .. 抛出 FsRouteError(400)', () => {
    expect(() => validateImportName('.')).toThrow(FsRouteError);
    expect(() => validateImportName('..')).toThrow(FsRouteError);
  });

  it('超过 64 字符抛出 FsRouteError(400)', () => {
    expect(() => validateImportName('x'.repeat(65))).toThrow(FsRouteError);
    expect(() => validateImportName('x'.repeat(64))).not.toThrow();
  });
});

describe('deriveProjectName', () => {
  it('仅含单个顶层目录时取其目录名', () => {
    const name = deriveProjectName(
      [{ name: '南柯一梦', isDirectory: true }],
      'whatever.zip',
    );
    expect(name).toBe('南柯一梦');
  });

  it('扁平结构（无顶层目录）时取文件名去 .zip 后缀', () => {
    const entries = [
      { name: 'prompt', isDirectory: true },
      { name: 'assert', isDirectory: true },
      { name: 'overview.md', isDirectory: false },
      { name: 'project.json', isDirectory: false },
    ];
    expect(deriveProjectName(entries, '我的项目.zip')).toBe('我的项目');
  });

  it('文件名带路径或大写 .ZIP 后缀均能正确推导', () => {
    const entries = [
      { name: 'prompt', isDirectory: true },
      { name: 'assert', isDirectory: true },
    ];
    expect(deriveProjectName(entries, 'C:\\fakepath\\demo.ZIP')).toBe('demo');
  });

  it('文件名无法推导出合法项目名时抛出 FsRouteError(400)', () => {
    const flatEntries = [
      { name: 'prompt', isDirectory: true },
      { name: 'assert', isDirectory: true },
    ];
    expect(() => deriveProjectName(flatEntries, '.zip')).toThrow(FsRouteError);
    expect(() => deriveProjectName([], '')).toThrow(FsRouteError);
  });

  it('单顶层目录名为非法名称时抛出 FsRouteError(400)', () => {
    expect(() => deriveProjectName(
      [{ name: '../evil', isDirectory: true }],
      'fallback.zip',
    )).toThrow(FsRouteError);
  });
});

describe('isUnsafeZipEntry', () => {
  it('正常相对路径放行', () => {
    expect(isUnsafeZipEntry('南柯一梦/prompt/scene/1/1/overview.json')).toBe(false);
    expect(isUnsafeZipEntry('project/assert/custom/a/b.png')).toBe(false);
  });

  it('.. 路径段判定为危险', () => {
    expect(isUnsafeZipEntry('../evil.txt')).toBe(true);
    expect(isUnsafeZipEntry('project/../../etc/passwd')).toBe(true);
  });

  it('. 路径段判定为危险', () => {
    expect(isUnsafeZipEntry('./evil.txt')).toBe(true);
    expect(isUnsafeZipEntry('project/./a.txt')).toBe(true);
  });

  it('绝对路径判定为危险', () => {
    expect(isUnsafeZipEntry('/etc/passwd')).toBe(true);
    expect(isUnsafeZipEntry('C:/Windows/system32/x.dll')).toBe(true);
    expect(isUnsafeZipEntry('C:\\Windows\\evil.exe')).toBe(true);
  });
});
