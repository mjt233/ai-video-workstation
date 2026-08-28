import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));

// 将 script-episodes 的文件系统操作重定向到每个用例的临时目录。
// mock 须覆盖 script-episodes.ts 从 paths.js 导入的全部符号。
vi.mock('./paths.js', () => ({
  assertPositiveIntId: (id: string, label: string): void => {
    if (!/^[1-9]\d*$/.test(id)) {
      throw Object.assign(new Error(`${label}必须是正整数`), { code: 'INVALID' });
    }
  },
  ensureDir: async (p: string): Promise<void> => {
    await fs.mkdir(p, { recursive: true });
  },
  pathExists: async (p: string): Promise<boolean> => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  },
  resolveProjectPath: (_project: string, rel: string): string => path.resolve(state.root, rel),
}));

import { createScriptEpisode, deleteScriptEpisode } from './script-episodes.js';

async function write(rel: string, content: string): Promise<void> {
  const full = path.join(state.root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(state.root, rel), 'utf8');
}

async function exists(rel: string): Promise<boolean> {
  try {
    await fs.access(path.join(state.root, rel));
    return true;
  } catch {
    return false;
  }
}

/** 按模板创建第 1..n 集，模拟真实顺序创建 */
async function seedEpisodes(n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    await createScriptEpisode('project', String(i));
  }
}

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'script-episodes-'));
});

afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true });
});

describe('createScriptEpisode（创建剧本分集）', () => {
  it('编号为空时自动追加末尾（max+1），内容含默认标题', async () => {
    await seedEpisodes(2);
    const r = await createScriptEpisode('project');
    expect(r.episode).toBe('3');
    expect(r.path).toBe('prompt/script/episodes/3.md');
    expect(await exists('prompt/script/episodes/3.md')).toBe(true);
    expect(await read('prompt/script/episodes/3.md')).toContain('# 第3集');
  });

  it('空目录下自动编号为 1', async () => {
    const r = await createScriptEpisode('project');
    expect(r.episode).toBe('1');
    expect(await exists('prompt/script/episodes/1.md')).toBe(true);
  });

  it('指定编号时可创建下一个连续编号', async () => {
    await seedEpisodes(1);
    const r = await createScriptEpisode('project', '2');
    expect(r.episode).toBe('2');
    expect(await read('prompt/script/episodes/2.md')).toContain('# 第2集');
  });

  it('已存在编号返回 EXISTS', async () => {
    await seedEpisodes(1);
    await expect(createScriptEpisode('project', '1')).rejects.toMatchObject({ code: 'EXISTS' });
  });

  it('跳号（超过 max+1）返回 INVALID', async () => {
    await seedEpisodes(1);
    await expect(createScriptEpisode('project', '5')).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('非正整数编号返回 INVALID', async () => {
    await expect(createScriptEpisode('project', 'abc')).rejects.toMatchObject({ code: 'INVALID' });
    await expect(createScriptEpisode('project', '0')).rejects.toMatchObject({ code: 'INVALID' });
  });
});

describe('deleteScriptEpisode（删除剧本分集）', () => {
  it('删除中间集后后续编号整体前移，默认标题同步改写', async () => {
    await seedEpisodes(3);
    const renames = await deleteScriptEpisode('project', '2');

    expect(renames).toEqual([{ from: '3', to: '2' }]);
    expect(await exists('prompt/script/episodes/2.md')).toBe(true);
    expect(await exists('prompt/script/episodes/3.md')).toBe(false);

    // 原 3 集内容前移为 2.md，首行默认标题 # 第3集 → # 第2集
    const moved = await read('prompt/script/episodes/2.md');
    expect(moved).toContain('# 第2集');
    expect(moved).not.toContain('# 第3集');
  });

  it('删除末集时无重命名', async () => {
    await seedEpisodes(2);
    const renames = await deleteScriptEpisode('project', '2');
    expect(renames).toEqual([]);
    expect(await exists('prompt/script/episodes/2.md')).toBe(false);
    expect(await read('prompt/script/episodes/1.md')).toContain('# 第1集');
  });

  it('连续删除后编号始终保持 1..N 连续', async () => {
    await seedEpisodes(4);
    await deleteScriptEpisode('project', '1');
    await deleteScriptEpisode('project', '1');
    expect(await exists('prompt/script/episodes/1.md')).toBe(true);
    expect(await exists('prompt/script/episodes/2.md')).toBe(true);
    expect(await exists('prompt/script/episodes/3.md')).toBe(false);
    expect(await read('prompt/script/episodes/1.md')).toContain('# 第1集');
    expect(await read('prompt/script/episodes/2.md')).toContain('# 第2集');
    // 删除后可继续追加末尾（max+1）
    const r = await createScriptEpisode('project');
    expect(r.episode).toBe('3');
  });

  it('用户自定义的非默认首行标题不被改写', async () => {
    await seedEpisodes(2);
    await write('prompt/script/episodes/2.md', '# 风雪夜归人\n\n正文内容。');
    const renames = await deleteScriptEpisode('project', '1');
    expect(renames).toEqual([{ from: '2', to: '1' }]);
    expect(await read('prompt/script/episodes/1.md')).toContain('# 风雪夜归人');
  });

  it('分集不存在返回 NOT_FOUND', async () => {
    await seedEpisodes(1);
    await expect(deleteScriptEpisode('project', '9')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
