import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));

// 把项目根目录重定向到临时目录（DESIGN_DIR 用 getter 延迟求值，供每个用例独立 root）
vi.mock('./paths.js', () => ({
  get DESIGN_DIR() {
    return state.root;
  },
  isReservedProjectName: (name: string): boolean => name.startsWith('.'),
  resolveProjectPath: (project: string, rel: string): string => path.resolve(state.root, project, rel),
  pathExists: async (p: string): Promise<boolean> => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  },
}));

import {
  assertTrashProjectName,
  assertTrashRelPath,
  listTrash,
  moveToTrash,
  parseBatchTime,
  purgeTrash,
  restoreTrash,
  trashItemFullPath,
  trashRootDir,
} from './trash.js';

/** 写入项目内文件 */
async function write(rel: string, content = 'x'): Promise<void> {
  const full = path.join(state.root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

/** 判断路径是否存在 */
async function exists(rel: string): Promise<boolean> {
  try {
    await fs.access(path.join(state.root, rel));
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'trash-'));
});

afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true });
});

describe('路径校验', () => {
  it('项目名拒绝路径分隔符、. / .. 与保留目录', () => {
    expect(assertTrashProjectName('AI的第一天')).toBe('AI的第一天');
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', '.trash']) {
      expect(() => assertTrashProjectName(bad)).toThrowError(/不合法/);
    }
  });

  it('相对路径必须是 assert/ 前缀且不含 ..', () => {
    expect(assertTrashRelPath('assert/custom/a.png')).toBe('assert/custom/a.png');
    for (const bad of ['prompt/a.md', 'assert/../../etc/passwd', '']) {
      expect(() => assertTrashRelPath(bad)).toThrowError(/路径非法/);
    }
  });
});

describe('moveToTrash', () => {
  it('把文件移入 design/.trash/{批次}/{项目名}/… 并保留原相对路径', async () => {
    await write('p1/assert/custom/canvas/a.png', 'hello');
    const result = await moveToTrash('p1', ['assert/custom/canvas/a.png'], { batchId: '20260820-153000' });

    expect(result.moved).toEqual(['assert/custom/canvas/a.png']);
    expect(result.skipped).toEqual([]);
    expect(await exists('p1/assert/custom/canvas/a.png')).toBe(false);
    expect(await exists('.trash/20260820-153000/p1/custom/canvas/a.png')).toBe(true);
    expect(trashItemFullPath('20260820-153000', 'p1', 'assert/custom/canvas/a.png'))
      .toBe(path.join(trashRootDir(), '20260820-153000', 'p1', 'custom', 'canvas', 'a.png'));
  });

  it('跳过：文件不存在 / 目录 / 非法路径 / 仍被引用', async () => {
    await fs.mkdir(path.join(state.root, 'p1/assert/custom/dir'), { recursive: true });
    await write('p1/assert/custom/ref.png');

    const result = await moveToTrash('p1', [
      'assert/custom/missing.png',
      'assert/custom/dir',
      'prompt/not-assert.md',
      'assert/custom/ref.png',
    ], { batchId: '20260820-153000', refChecker: (rel) => rel === 'assert/custom/ref.png' });

    expect(result.moved).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      '文件不存在',
      '仅支持清理文件（不接受目录）',
      expect.stringMatching(/路径非法/),
      '仍被项目引用，已跳过',
    ]);
    expect(await exists('p1/assert/custom/ref.png')).toBe(true);
  });

  it('同名冲突时追加 -1 后缀，且去重重复入参', async () => {
    await write('p1/assert/custom/a.png', 'first');
    await write('.trash/20260820-153000/p1/custom/a.png', 'existing');
    const result = await moveToTrash('p1', ['assert/custom/a.png', 'assert/custom/a.png'], {
      batchId: '20260820-153000',
    });
    expect(result.moved).toEqual(['assert/custom/a.png']);
    // 原文件仍在（未被覆盖），新文件落在 a-1.png
    expect(await fs.readFile(path.join(state.root, '.trash/20260820-153000/p1/custom/a.png'), 'utf-8')).toBe('existing');
    expect(await fs.readFile(path.join(state.root, '.trash/20260820-153000/p1/custom/a-1.png'), 'utf-8')).toBe('first');
  });
});

describe('listTrash', () => {
  it('按批次分组、统计大小、计算剩余保留天数，并忽略非批次目录', async () => {
    await write('.trash/20260101-000000/p1/custom/old.png', 'abc');
    await write('.trash/20260101-000000/p2/custom/other.png', 'de');
    await write('.trash/20260820-153000/p1/custom/new.png', 'f');
    await write('.trash/not-a-batch/ignored.txt', 'zz');

    const listed = await listTrash({ retentionDays: 7, now: new Date('2026-08-20T00:00:00.000Z') });

    expect(listed.count).toBe(3);
    expect(listed.totalSize).toBe(6);
    expect(listed.batches.map((b) => b.batchId)).toEqual(['20260820-153000', '20260101-000000']);
    const old = listed.batches[1].items.find((i) => i.relPath.endsWith('old.png'))!;
    expect(old.project).toBe('p1');
    expect(old.relPath).toBe('assert/custom/old.png');
    expect(old.originalPath).toBe('assert/custom/old.png');
    expect(old.expiresInDays).toBeLessThan(0); // 早已超期
  });

  it('回收站不存在时返回空结果', async () => {
    expect(await listTrash()).toEqual({ batches: [], count: 0, totalSize: 0 });
  });
});

describe('restoreTrash', () => {
  it('恢复文件到原项目位置并清理空批次目录', async () => {
    await write('.trash/20260820-153000/p1/custom/a.png', 'data');
    const result = await restoreTrash([
      { batchId: '20260820-153000', project: 'p1', relPath: 'assert/custom/a.png' },
    ]);
    expect(result.restored).toEqual([{ project: 'p1', path: 'assert/custom/a.png' }]);
    expect(await fs.readFile(path.join(state.root, 'p1/assert/custom/a.png'), 'utf-8')).toBe('data');
    expect(await exists('.trash/20260820-153000')).toBe(false);
  });

  it('原位置已存在同名文件时跳过（不覆盖）', async () => {
    await write('.trash/20260820-153000/p1/custom/a.png', 'trashed');
    await write('p1/assert/custom/a.png', 'current');
    const result = await restoreTrash([
      { batchId: '20260820-153000', project: 'p1', relPath: 'assert/custom/a.png' },
    ]);
    expect(result.restored).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/已存在同名文件/);
    expect(await fs.readFile(path.join(state.root, 'p1/assert/custom/a.png'), 'utf-8')).toBe('current');
  });

  it('条目不存在 / 参数非法时跳过并给出原因', async () => {
    const result = await restoreTrash([
      { batchId: '20260820-153000', project: 'p1', relPath: 'assert/custom/none.png' },
      { batchId: 'bad', project: 'p1', relPath: 'assert/custom/a.png' },
      { batchId: '20260820-153000', project: '../escape', relPath: 'assert/custom/a.png' },
    ]);
    expect(result.restored).toEqual([]);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped[0].reason).toMatch(/不存在/);
    expect(result.skipped[1].reason).toMatch(/批次号非法/);
    expect(result.skipped[2].reason).toMatch(/项目名不合法/);
  });
});

describe('purgeTrash', () => {
  it('按条目彻底删除并统计释放空间', async () => {
    await write('.trash/20260820-153000/p1/custom/a.png', 'abcd');
    await write('.trash/20260820-153000/p1/custom/b.png', 'ef');
    const result = await purgeTrash({
      items: [{ batchId: '20260820-153000', project: 'p1', relPath: 'assert/custom/a.png' }],
    });
    expect(result).toEqual({ deleted: 1, freed: 4 });
    expect(await exists('.trash/20260820-153000/p1/custom/b.png')).toBe(true);
  });

  it('按批次删除整个批次', async () => {
    await write('.trash/20260101-000000/p1/custom/a.png', 'abc');
    await write('.trash/20260101-000000/p2/custom/b.png', 'de');
    await write('.trash/20260820-153000/p1/custom/c.png', 'f');
    const result = await purgeTrash({ batchId: '20260101-000000' });
    expect(result).toEqual({ deleted: 2, freed: 5 });
    expect(await exists('.trash/20260101-000000')).toBe(false);
    expect(await exists('.trash/20260820-153000/p1/custom/c.png')).toBe(true);
  });

  it('all 清空整个回收站', async () => {
    await write('.trash/20260101-000000/p1/custom/a.png', 'abc');
    await write('.trash/20260820-153000/p2/custom/b.png', 'de');
    const result = await purgeTrash({ all: true });
    expect(result).toEqual({ deleted: 2, freed: 5 });
    expect(await exists('.trash')).toBe(false);
  });

  it('批次号非法时抛 INVALID', async () => {
    await expect(purgeTrash({ batchId: 'not-a-batch' })).rejects.toMatchObject({ code: 'INVALID' });
  });
});

describe('parseBatchTime', () => {
  it('解析批次号时间（忽略同秒 -N 后缀）', () => {
    const d = parseBatchTime('20260820-153000-1');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(7);
    expect(d?.getDate()).toBe(20);
    expect(d?.getHours()).toBe(15);
    expect(d?.getMinutes()).toBe(30);
    expect(parseBatchTime('nope')).toBeNull();
  });
});
