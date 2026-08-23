import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));

// 将 shot-renumber 的文件系统操作重定向到每个用例的临时目录。
vi.mock('./paths.js', () => ({
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

import { shiftShotsDownAfterDelete, shiftShotsUpForInsert } from './shot-renumber.js';

async function mkdir(...rel: string[]): Promise<void> {
  await fs.mkdir(path.join(state.root, ...rel), { recursive: true });
}

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

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'shot-renumber-'));
});

afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true });
});

describe('shiftShotsUpForInsert（插入分镜）', () => {
  it('三目录成组 +1，且全集 JSON 引用（含跨分镜与自定义资产）同步改写', async () => {
    await mkdir('prompt/scene/1/1');
    await mkdir('prompt/scene/1/2');
    await mkdir('assert/scene/1/1');
    await mkdir('assert/scene/1/2');
    await mkdir('assert/custom/scene/1/1');
    await mkdir('assert/custom/scene/1/2');

    // 分镜 1 未被重命名，但其画布引用了分镜 2 的正式资产（跨分镜引用）
    await write('prompt/scene/1/1/canvas.json', JSON.stringify({
      assetPath: 'assert/scene/1/2/stage/0.jpg',
      ownCustom: 'assert/custom/scene/1/1/keep.png',
    }));
    // 分镜 2 被移动到 3，其导演台引用了自身正式资产与自定义资产
    await write('prompt/scene/1/2/director.json', JSON.stringify({
      imageClips: [{ path: 'assert/scene/1/2/stage/1.jpg' }],
      audioClips: [{ path: 'assert/custom/scene/1/2/audio.mp3' }],
    }));

    const renames = await shiftShotsUpForInsert('project', '1', 2);

    expect(renames).toEqual([{ from: '2', to: '3' }]);

    // 三个目录都从 2 移到 3，2 留空给新分镜
    expect(await exists('prompt/scene/1/3')).toBe(true);
    expect(await exists('assert/scene/1/3')).toBe(true);
    expect(await exists('assert/custom/scene/1/3')).toBe(true);
    expect(await exists('prompt/scene/1/2')).toBe(false);
    expect(await exists('assert/scene/1/2')).toBe(false);
    expect(await exists('assert/custom/scene/1/2')).toBe(false);

    const movedDirector = JSON.parse(await read('prompt/scene/1/3/director.json'));
    expect(movedDirector.imageClips[0].path).toBe('assert/scene/1/3/stage/1.jpg');
    expect(movedDirector.audioClips[0].path).toBe('assert/custom/scene/1/3/audio.mp3');

    const untouchedCanvas = JSON.parse(await read('prompt/scene/1/1/canvas.json'));
    expect(untouchedCanvas.assetPath).toBe('assert/scene/1/3/stage/0.jpg');
    expect(untouchedCanvas.ownCustom).toBe('assert/custom/scene/1/1/keep.png');
  });
});

describe('shiftShotsDownAfterDelete（删除分镜）', () => {
  it('三目录成组 -1，且全集 JSON 引用（含跨分镜与自定义资产）同步改写', async () => {
    // 调用方（DELETE 路由）已删除分镜 1 的三个目录
    await mkdir('prompt/scene/1/2');
    await mkdir('prompt/scene/1/3');
    await mkdir('assert/scene/1/2');
    await mkdir('assert/scene/1/3');
    await mkdir('assert/custom/scene/1/2');
    await mkdir('assert/custom/scene/1/3');

    // 分镜 2 未被删除但会被重命名，其画布引用了分镜 3 的正式资产（跨分镜引用）
    await write('prompt/scene/1/2/canvas.json', JSON.stringify({
      assetPath: 'assert/scene/1/3/stage/0.jpg',
    }));
    // 分镜 3 被移动到 2，其导演台引用了自身自定义资产
    await write('prompt/scene/1/3/director.json', JSON.stringify({
      imageClips: [{ path: 'assert/custom/scene/1/3/v.mp4' }],
    }));

    const renames = await shiftShotsDownAfterDelete('project', '1', '1');

    expect(renames).toEqual([
      { from: '2', to: '1' },
      { from: '3', to: '2' },
    ]);

    expect(await exists('prompt/scene/1/1')).toBe(true);
    expect(await exists('assert/scene/1/1')).toBe(true);
    expect(await exists('assert/custom/scene/1/1')).toBe(true);
    expect(await exists('prompt/scene/1/2')).toBe(true);
    expect(await exists('assert/custom/scene/1/2')).toBe(true);
    expect(await exists('prompt/scene/1/3')).toBe(false);
    expect(await exists('assert/custom/scene/1/3')).toBe(false);

    const movedCanvas = JSON.parse(await read('prompt/scene/1/1/canvas.json'));
    expect(movedCanvas.assetPath).toBe('assert/scene/1/2/stage/0.jpg');

    const movedDirector = JSON.parse(await read('prompt/scene/1/2/director.json'));
    expect(movedDirector.imageClips[0].path).toBe('assert/custom/scene/1/2/v.mp4');
  });
});
