import { describe, expect, it, vi } from 'vitest';

// fs/promises 全量 mock：仅 stat 被使用；resolveProjectPath 显式 mock 隔离路径解析
const { mockStat } = vi.hoisted(() => ({ mockStat: vi.fn() }));

vi.mock('fs/promises', () => ({
  default: { stat: mockStat },
  stat: mockStat,
}));

vi.mock('../assets/paths.js', () => ({
  resolveProjectPath: (project: string, relPath: string) =>
    `C:\\design\\${project}\\${relPath.replace(/\//g, '\\')}`,
}));

import { readCanvasNodeInfo } from './node-info.js';

describe('readCanvasNodeInfo', () => {
  it('文件存在：返回 mtime 与 size', async () => {
    mockStat.mockResolvedValue({ isFile: () => true, mtimeMs: 1234, size: 5678 });

    const info = await readCanvasNodeInfo('p', 'assert/scene/1/1/canvas/n1/output.jpg');

    expect(info).toEqual({ exists: true, mtime: 1234, size: 5678 });
    expect(mockStat).toHaveBeenCalledWith('C:\\design\\p\\assert\\scene\\1\\1\\canvas\\n1\\output.jpg');
  });

  it('路径指向目录：视为不存在', async () => {
    mockStat.mockResolvedValue({ isFile: () => false, mtimeMs: 1, size: 2 });
    await expect(readCanvasNodeInfo('p', 'assert/scene')).resolves.toEqual({
      exists: false,
      mtime: null,
      size: null,
    });
  });

  it('文件不存在（ENOENT）或 stat 失败：exists=false 且不抛错', async () => {
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await expect(readCanvasNodeInfo('p', 'assert/missing.jpg')).resolves.toEqual({
      exists: false,
      mtime: null,
      size: null,
    });
  });
});