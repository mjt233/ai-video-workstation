import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));

// 将文件系统操作重定向到每个用例的临时目录。
vi.mock('./paths.js', () => ({
  assertPositiveIntId: (id: string, label: string) => {
    if (!/^[1-9]\d*$/.test(id)) {
      throw Object.assign(new Error(`${label}必须是正整数`), { code: 'INVALID' });
    }
  },
  assertSafeName: (name: string, label = '名称') => {
    const trimmed = name.trim();
    if (!trimmed) throw Object.assign(new Error(`${label}不能为空`), { code: 'INVALID' });
    if (/[\\/:*?"<>|]/.test(name) || name !== trimmed) {
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
  moveShot,
  rewriteSceneShotMovePathsInText,
  type ShotMoveRename,
} from './shot-move.js';

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

/** 搭建基础目录：源集 1..3，目标集 1..4（含三侧目录） */
async function setupCrossEpisode(): Promise<void> {
  for (const ep of ['1', '2']) {
    for (const shot of ['1', '2', '3', '4']) {
      await mkdir('prompt', 'scene', ep, shot);
      await mkdir('assert', 'scene', ep, shot);
      await mkdir('assert', 'custom', 'scene', ep, shot);
    }
  }
  // 源集只有 1..3：移除 4 号目录（便于断言源集移位后的边界）
  await fs.rm(path.join(state.root, 'prompt/scene/1/4'), { recursive: true });
  await fs.rm(path.join(state.root, 'assert/scene/1/4'), { recursive: true });
  await fs.rm(path.join(state.root, 'assert/custom/scene/1/4'), { recursive: true });
}

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'shot-move-'));
});

afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true });
});

describe('rewriteSceneShotMovePathsInText', () => {
  it('跨集路径改写（正式资产/定义/自定义资产三类前缀）', () => {
    const text = JSON.stringify({
      a: 'assert/scene/1/3/stage/0.jpg',
      b: 'prompt/scene/1/3/overview.json',
      c: 'assert/custom/scene/1/3/audio.mp3',
      d: 'assert/scene/1/12/stage/0.jpg', // 前缀保护：不误伤 1/12
      e: 'assert/scene/2/3/stage/0.jpg', // 目标集已有引用（移位时由其它映射处理）
    });
    const renames: ShotMoveRename[] = [
      { fromEpisode: '2', fromShot: '3', toEpisode: '2', toShot: '4' },
      { fromEpisode: '1', fromShot: '1', toEpisode: '1', toShot: '2' },
      { fromEpisode: '1', fromShot: '3', toEpisode: '2', toShot: '3' },
    ];
    const out = JSON.parse(rewriteSceneShotMovePathsInText(text, renames));
    expect(out.a).toBe('assert/scene/2/3/stage/0.jpg');
    expect(out.b).toBe('prompt/scene/2/3/overview.json');
    expect(out.c).toBe('assert/custom/scene/2/3/audio.mp3');
    expect(out.d).toBe('assert/scene/1/12/stage/0.jpg');
    expect(out.e).toBe('assert/scene/2/4/stage/0.jpg');
  });

  it('顺序敏感：先移位、后移动映射（4→3 与 3→5 不互相污染）', () => {
    const text = JSON.stringify({
      old3: 'assert/scene/1/3/stage/0.jpg', // 被移动的分镜
      old4: 'assert/scene/1/4/stage/0.jpg', // 移位后的分镜
    });
    const renames: ShotMoveRename[] = [
      { fromEpisode: '1', fromShot: '4', toEpisode: '1', toShot: '3' },
      { fromEpisode: '1', fromShot: '3', toEpisode: '1', toShot: '5' },
    ];
    const out = JSON.parse(rewriteSceneShotMovePathsInText(text, renames));
    expect(out.old3).toBe('assert/scene/1/5/stage/0.jpg');
    expect(out.old4).toBe('assert/scene/1/3/stage/0.jpg');
  });
});

describe('moveShot（跨集数移动）', () => {
  it('目标集让位 + 源集前移 + 全项目引用改写（含跨画布与自身引用）+ 别名跟随 + rev bump', async () => {
    await setupCrossEpisode();
    // 被移动分镜 1/1：带别名 metadata.json；画布同时引用自身与源集其它分镜（跨分镜引用）
    await write('prompt/scene/1/1/metadata.json', JSON.stringify({ alias: '开篇', showPrefix: false }));
    await write('prompt/scene/1/1/canvas.json', JSON.stringify({
      rev: 5,
      nodes: [
        { id: 'self', assetPath: 'assert/scene/1/1/stage/0.jpg' },
        { id: 'cross', assetPath: 'assert/scene/1/3/stage/0.jpg' },
      ],
    }));
    await write('prompt/scene/1/1/director.json', JSON.stringify({
      imageClips: [{ path: 'assert/scene/1/1/stage/0.jpg' }],
    }));
    // 源集 1/2（未移动，但会被前移）画布引用被移动分镜的源位置
    await write('prompt/scene/1/2/canvas.json', JSON.stringify({
      rev: 1,
      nodes: [{ id: 'a', assetPath: 'assert/custom/scene/1/1/keep.png' }],
    }));
    // 目标集 2/3 画布引用目标集分镜（移位后 3 → 4）
    await write('prompt/scene/2/3/canvas.json', JSON.stringify({
      rev: 3,
      nodes: [{ id: 'c', assetPath: 'assert/scene/2/3/stage/0.jpg' }],
    }));

    const result = await moveShot('project', '1', '1', '2', 3);

    expect(result.episode).toBe('2');
    expect(result.shot).toBe('3');
    // 返回的集内重编号映射：目标集移位 + 源集前移
    expect(result.renames).toEqual([
      { episode: '2', from: '3', to: '4' },
      { episode: '2', from: '4', to: '5' },
      { episode: '1', from: '2', to: '1' },
      { episode: '1', from: '3', to: '2' },
    ]);

    // 目录：源 1/1 三侧内容已移走（metadata.json 别名随之搬走，不留原处）；
    // 源集移位后 1/1/1/2 为原 1/2/1/3 前移后的目录
    expect(await exists('prompt/scene/1/1/metadata.json')).toBe(false);
    expect(await exists('prompt/scene/2/3')).toBe(true);
    expect(await exists('assert/scene/2/3')).toBe(true);
    expect(await exists('assert/custom/scene/2/3')).toBe(true);
    expect(await exists('assert/scene/1/1')).toBe(true);

    // 别名随目录移动
    const aliasMeta = JSON.parse(await read('prompt/scene/2/3/metadata.json'));
    expect(aliasMeta).toEqual({ alias: '开篇', showPrefix: false });

    // 被移动分镜自身引用改写（自引用 → 2/3；跨分镜引用 1/3 → 1/2），rev 5 → 6
    const moved = JSON.parse(await read('prompt/scene/2/3/canvas.json'));
    expect(moved.nodes[0].assetPath).toBe('assert/scene/2/3/stage/0.jpg');
    expect(moved.nodes[1].assetPath).toBe('assert/scene/1/2/stage/0.jpg');
    expect(moved.rev).toBe(6);
    const movedDirector = JSON.parse(await read('prompt/scene/2/3/director.json'));
    expect(movedDirector.imageClips[0].path).toBe('assert/scene/2/3/stage/0.jpg');

    // 源集 1/2（前移为 1/1）画布：引用 1/1 → 2/3（move 映射最后应用，不被移位映射再次改写）
    const srcCanvas = JSON.parse(await read('prompt/scene/1/1/canvas.json'));
    expect(srcCanvas.nodes[0].assetPath).toBe('assert/custom/scene/2/3/keep.png');
    expect(srcCanvas.rev).toBe(2);

    // 目标集 3 号（移位后）画布：2/3 → 2/4，rev bump
    const dstCanvas = JSON.parse(await read('prompt/scene/2/4/canvas.json'));
    expect(dstCanvas.nodes[0].assetPath).toBe('assert/scene/2/4/stage/0.jpg');
    expect(dstCanvas.rev).toBe(4);
  });

  it('目标集不存在抛 NOT_FOUND；位置越界抛 INVALID', async () => {
    await setupCrossEpisode();
    await expect(moveShot('project', '1', '1', '9', 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(moveShot('project', '1', '1', '2', 6)).rejects.toMatchObject({ code: 'INVALID' });
  });
});

describe('moveShot（同集数内重排）', () => {
  it('向后移动（3 → 5）：先下移后移入，引用同步改写', async () => {
    for (const shot of ['1', '2', '3', '4', '5']) {
      await mkdir('prompt/scene/1', shot);
      await mkdir('assert/scene/1', shot);
      await mkdir('assert/custom/scene/1', shot);
    }
    await write('prompt/scene/1/3/canvas.json', JSON.stringify({
      rev: 1,
      nodes: [{ id: 'self', assetPath: 'assert/scene/1/3/stage/0.jpg' }],
    }));
    await write('prompt/scene/1/4/canvas.json', JSON.stringify({
      rev: 1,
      nodes: [{ id: 'x', assetPath: 'assert/scene/1/3/stage/0.jpg' }],
    }));

    const result = await moveShot('project', '1', '3', '1', 5);
    expect(result.shot).toBe('5');
    expect(result.renames).toEqual([
      { episode: '1', from: '4', to: '3' },
      { episode: '1', from: '5', to: '4' },
    ]);

    expect(await exists('prompt/scene/1/3')).toBe(true);
    expect(await exists('prompt/scene/1/5')).toBe(true);
    // 被移动分镜自引用：1/3 → 1/5
    const moved = JSON.parse(await read('prompt/scene/1/5/canvas.json'));
    expect(moved.nodes[0].assetPath).toBe('assert/scene/1/5/stage/0.jpg');
    expect(moved.rev).toBe(2);
    // 原 4 号（移位到 3）的跨分镜引用：1/3 → 1/5
    const shifted = JSON.parse(await read('prompt/scene/1/3/canvas.json'));
    expect(shifted.nodes[0].assetPath).toBe('assert/scene/1/5/stage/0.jpg');
    expect(shifted.rev).toBe(2);
  });

  it('向前移动（5 → 2）：先上移后移入', async () => {
    for (const shot of ['1', '2', '3', '4', '5']) {
      await mkdir('prompt/scene/1', shot);
    }
    await write('prompt/scene/1/5/canvas.json', JSON.stringify({ rev: 3, ref: 'assert/scene/1/5/stage/0.jpg' }));
    const result = await moveShot('project', '1', '5', '1', 2);
    expect(result.shot).toBe('2');
    expect(result.renames).toEqual([
      { episode: '1', from: '2', to: '3' },
      { episode: '1', from: '3', to: '4' },
      { episode: '1', from: '4', to: '5' },
    ]);
    expect(await exists('prompt/scene/1/2')).toBe(true);
    const moved = JSON.parse(await read('prompt/scene/1/2/canvas.json'));
    expect(moved.ref).toBe('assert/scene/1/2/stage/0.jpg');
    expect(moved.rev).toBe(4);
  });

  it('移回原位 = 无操作', async () => {
    for (const shot of ['1', '2', '3']) {
      await mkdir('prompt/scene/1', shot);
    }
    const result = await moveShot('project', '1', '3', '1', 3);
    expect(result.renames).toEqual([]);
    expect(result.shot).toBe('3');
  });

  it('源分镜不存在抛 NOT_FOUND；位置越界抛 INVALID', async () => {
    await mkdir('prompt/scene/1', '3');
    await expect(moveShot('project', '1', '9', '1', 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(moveShot('project', '1', '3', '1', 4)).rejects.toMatchObject({ code: 'INVALID' });
  });
});
