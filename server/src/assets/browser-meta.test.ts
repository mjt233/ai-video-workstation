/**
 * browser-meta 模块单测：集数/分镜别名读写与清除、角色分类树校验、
 * 归属映射校验、删除角色清理、无文件/脏文件兼容。
 *
 * 通过 vi.mock 将 paths.js 的文件系统操作重定向到每个用例的临时目录，
 * 校验类函数（assertPositiveIntId / assertSafeName）在 mock 中重建等价实现。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));

vi.mock('./paths.js', () => ({
  assertPositiveIntId: (id: string, label: string): void => {
    if (!/^[1-9]\d*$/.test(id)) {
      throw Object.assign(new Error(`${label}必须是正整数`), { code: 'INVALID' });
    }
  },
  assertSafeName: (name: string, label: string): void => {
    const trimmed = name.trim();
    if (!trimmed || trimmed !== name) {
      throw Object.assign(new Error(`${label}不能为空`), { code: 'INVALID' });
    }
    if (/[\\/:*?"<>|]/.test(trimmed)) {
      throw Object.assign(new Error(`${label}包含非法字符`), { code: 'INVALID' });
    }
  },
  listNumericDirNames: async (dir: string): Promise<string[]> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory() && /^[1-9]\d*$/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => Number(a) - Number(b));
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

import {
  readBrowserMeta,
  readCharacterCategories,
  removeCharacterAssignment,
  saveAlias,
  saveCharacterCategories,
} from './browser-meta.js';

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

async function mkdir(rel: string): Promise<void> {
  await fs.mkdir(path.join(state.root, rel), { recursive: true });
}

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-meta-'));
});

afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true });
});

describe('集数/分镜别名', () => {
  it('无任何 metadata.json 时读取为空态', async () => {
    await mkdir('prompt/scene/1/2');
    const meta = await readBrowserMeta('demo');
    expect(meta.episodes).toEqual({});
    expect(meta.shots).toEqual({});
    expect(meta.characters).toEqual({ categories: [], assignments: {} });
  });

  it('保存与覆盖集数别名，清除后删除文件', async () => {
    await mkdir('prompt/scene/1');
    await saveAlias('demo', 'episode', '1', undefined, '觉醒');
    await saveAlias('demo', 'episode', '1', undefined, '新征程');

    let meta = await readBrowserMeta('demo');
    expect(meta.episodes['1']).toEqual({ alias: '新征程', showPrefix: true });
    expect(JSON.parse(await read('prompt/scene/1/metadata.json'))).toEqual({ alias: '新征程' });

    // 清除别名 → 文件删除
    await saveAlias('demo', 'episode', '1', undefined, null);
    expect(await exists('prompt/scene/1/metadata.json')).toBe(false);
    meta = await readBrowserMeta('demo');
    expect(meta.episodes['1']).toBeUndefined();
  });

  it('保存分镜别名并聚合读取', async () => {
    await mkdir('prompt/scene/1/2');
    await saveAlias('demo', 'shot', '1', '2', '初遇');
    const meta = await readBrowserMeta('demo');
    expect(meta.shots['1']?.['2']).toEqual({ alias: '初遇', showPrefix: true });
  });

  it('showPrefix=false 落盘并回读；true 时不落盘（默认值）', async () => {
    await mkdir('prompt/scene/1');
    await saveAlias('demo', 'episode', '1', undefined, '觉醒', false);
    expect(JSON.parse(await read('prompt/scene/1/metadata.json'))).toEqual({ alias: '觉醒', showPrefix: false });
    let meta = await readBrowserMeta('demo');
    expect(meta.episodes['1']).toEqual({ alias: '觉醒', showPrefix: false });

    await saveAlias('demo', 'episode', '1', undefined, '觉醒', true);
    expect(JSON.parse(await read('prompt/scene/1/metadata.json'))).toEqual({ alias: '觉醒' });
    meta = await readBrowserMeta('demo');
    expect(meta.episodes['1']).toEqual({ alias: '觉醒', showPrefix: true });

    // 清除别名：showPrefix 一并移除
    await saveAlias('demo', 'episode', '1', undefined, null, false);
    expect(await exists('prompt/scene/1/metadata.json')).toBe(false);
  });

  it('旧格式 metadata.json（无 showPrefix 字段）按显示前缀处理', async () => {
    await mkdir('prompt/scene/1');
    await write('prompt/scene/1/metadata.json', JSON.stringify({ alias: '旧格式' }));
    const meta = await readBrowserMeta('demo');
    expect(meta.episodes['1']).toEqual({ alias: '旧格式', showPrefix: true });
  });

  it('别名写入时保留 metadata.json 中的其它字段', async () => {
    await mkdir('prompt/scene/1');
    await write('prompt/scene/1/metadata.json', JSON.stringify({ alias: '旧', tag: 'x' }));
    await saveAlias('demo', 'episode', '1', undefined, '新');
    expect(JSON.parse(await read('prompt/scene/1/metadata.json'))).toEqual({ alias: '新', tag: 'x' });
    // 清除别名但其它字段仍在 → 文件保留
    await saveAlias('demo', 'episode', '1', undefined, null);
    expect(JSON.parse(await read('prompt/scene/1/metadata.json'))).toEqual({ tag: 'x' });
  });

  it('非法输入报 INVALID / NOT_FOUND', async () => {
    await mkdir('prompt/scene/1');
    await expect(saveAlias('demo', 'episode', '0', undefined, 'x')).rejects.toMatchObject({ code: 'INVALID' });
    await expect(saveAlias('demo', 'episode', '9', undefined, 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(saveAlias('demo', 'shot', '1', '5', 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(saveAlias('demo', 'episode', '1', undefined, '   ')).rejects.toMatchObject({ code: 'INVALID' });
    await expect(saveAlias('demo', 'episode', '1', undefined, 'a'.repeat(51))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(saveAlias('demo', 'episode', '1', undefined, 123 as unknown as string)).rejects.toMatchObject({ code: 'INVALID' });
    await expect(saveAlias('demo', 'episode', '1', undefined, 'x', 'yes' as unknown as boolean)).rejects.toMatchObject({ code: 'INVALID' });
  });
});

describe('角色分类', () => {
  const validTree = {
    categories: [
      { name: '主角', children: [{ name: '男主角', children: [] }, { name: '女主角', children: [] }] },
      { name: '配角', children: [] },
    ],
    assignments: { '张伟': ['主角', '男主角'], '李娜': ['配角'], '路人甲': [] },
  };

  it('全量保存并回读（规范化 trim）', async () => {
    await mkdir('prompt/character/张伟');
    await mkdir('prompt/character/李娜');
    await mkdir('prompt/character/路人甲');
    await saveCharacterCategories('demo', validTree);
    const meta = await readCharacterCategories('demo');
    expect(meta.categories[0].children?.[0]?.name).toBe('男主角');
    expect(meta.assignments['张伟']).toEqual(['主角', '男主角']);
    expect(meta.assignments['路人甲']).toEqual([]);
  });

  it('未出现在 assignments 的角色 = 未分类（读取不抛错）', async () => {
    await mkdir('prompt/character/张三');
    await saveCharacterCategories('demo', { categories: [{ name: '主角', children: [] }], assignments: {} });
    const meta = await readCharacterCategories('demo');
    expect(meta.assignments).toEqual({});
    expect(meta.categories).toHaveLength(1);
  });

  it('同层分类名重复 → INVALID', async () => {
    await mkdir('prompt/character/张伟');
    await expect(saveCharacterCategories('demo', {
      categories: [{ name: '主角', children: [] }, { name: '主角', children: [] }],
      assignments: {},
    })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('子级同层分类名重复 → INVALID', async () => {
    await mkdir('prompt/character/张伟');
    await expect(saveCharacterCategories('demo', {
      categories: [{ name: '主角', children: [{ name: '男', children: [] }, { name: '男', children: [] }] }],
      assignments: {},
    })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('分类路径不存在 → INVALID', async () => {
    await mkdir('prompt/character/张伟');
    await expect(saveCharacterCategories('demo', {
      categories: [{ name: '主角', children: [] }],
      assignments: { '张伟': ['主角', '不存在'] },
    })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('分配的角色目录不存在 → INVALID', async () => {
    await expect(saveCharacterCategories('demo', {
      categories: [{ name: '主角', children: [] }],
      assignments: { '幽灵': ['主角'] },
    })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('删除角色后清理归属；清空后删除文件', async () => {
    await mkdir('prompt/character/张伟');
    await mkdir('prompt/character/李娜');
    await mkdir('prompt/character/路人甲');
    await saveCharacterCategories('demo', validTree);

    await removeCharacterAssignment('demo', '张伟');
    const meta = await readCharacterCategories('demo');
    expect(meta.assignments['张伟']).toBeUndefined();
    expect(meta.assignments['李娜']).toEqual(['配角']);
    expect(await exists('prompt/character/metadata.json')).toBe(true);

    await removeCharacterAssignment('demo', '李娜');
    await removeCharacterAssignment('demo', '路人甲');
    // 分类树仍存在 → 文件保留（仅清空归属）
    expect(await exists('prompt/character/metadata.json')).toBe(true);
    expect(JSON.parse(await read('prompt/character/metadata.json'))).toEqual({
      categories: [
        { name: '主角', children: [{ name: '男主角', children: [] }, { name: '女主角', children: [] }] },
        { name: '配角', children: [] },
      ],
      assignments: {},
    });
  });

  it('分类树与归属全部为空时删除文件', async () => {
    await mkdir('prompt/character/张伟');
    await write('prompt/character/metadata.json', JSON.stringify({ categories: [], assignments: { '张伟': [] } }));
    await removeCharacterAssignment('demo', '张伟');
    expect(await exists('prompt/character/metadata.json')).toBe(false);
  });

  it('读取损坏的 metadata.json 回退为空态（不抛错）', async () => {
    await mkdir('prompt/character');
    await write('prompt/character/metadata.json', '{ not json');
    expect(await readCharacterCategories('demo')).toEqual({ categories: [], assignments: {} });
  });
});
