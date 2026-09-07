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
    if (trimmed !== name) throw Object.assign(new Error(`${label}不能有首尾空白`), { code: 'INVALID' });
    if (/[\\/:*?"<>|]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
      throw Object.assign(new Error(`${label}包含非法字符`), { code: 'INVALID' });
    }
  },
  ensureDir: async (full: string) => { await fs.mkdir(full, { recursive: true }); },
  pathExists: async (p: string): Promise<boolean> => {
    try { await fs.access(p); return true; } catch { return false; }
  },
  resolveProjectPath: (_project: string, rel: string): string => path.resolve(state.root, rel),
}));

import {
  bumpCanvasRevInJsonText,
  canvasDefRelPath,
  readCanvasDefRev,
  saveCanvasDef,
} from './canvas-def.js';

async function write(rel: string, content: string): Promise<void> {
  const full = path.join(state.root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(state.root, rel), 'utf8');
}

async function exists(rel: string): Promise<boolean> {
  try { await fs.access(path.join(state.root, rel)); return true; } catch { return false; }
}

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-def-'));
});

afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true });
});

describe('canvasDefRelPath', () => {
  it('分镜画布路径', () => {
    expect(canvasDefRelPath({ kind: 'scene', episode: '1', shot: '3' }))
      .toBe('prompt/scene/1/3/canvas.json');
  });

  it('场景画布路径', () => {
    expect(canvasDefRelPath({ kind: 'stage', stage: '林府', label: '正门' }))
      .toBe('prompt/stage/林府/canvas/正门.json');
  });

  it('参数缺失时抛 INVALID', () => {
    expect(() => canvasDefRelPath({ kind: 'scene' })).toThrowError(/episode 与 shot 必填/);
    expect(() => canvasDefRelPath({ kind: 'stage', stage: '林府' })).toThrowError(/stage 与 label 必填/);
    expect(() => canvasDefRelPath({ kind: '其他' as never })).toThrowError(/kind 必须是/);
  });
});

describe('readCanvasDefRev', () => {
  it('文件不存在时 rev=0', async () => {
    const r = await readCanvasDefRev('p', { kind: 'scene', episode: '1', shot: '1' });
    expect(r).toEqual({ rev: 0, exists: false, updatedAt: null });
  });

  it('读取现有 rev 与 updatedAt；无 rev 字段按 0', async () => {
    await write('prompt/scene/1/1/canvas.json', JSON.stringify({ rev: 7, updatedAt: '2024-01-01T00:00:00.000Z' }));
    const r = await readCanvasDefRev('p', { kind: 'scene', episode: '1', shot: '1' });
    expect(r.rev).toBe(7);
    expect(r.exists).toBe(true);
    expect(r.updatedAt).toBe('2024-01-01T00:00:00.000Z');

    await write('prompt/scene/1/2/canvas.json', JSON.stringify({ nodes: [] }));
    expect((await readCanvasDefRev('p', { kind: 'scene', episode: '1', shot: '2' })).rev).toBe(0);
  });

  it('损坏文件抛 CORRUPT', async () => {
    await write('prompt/scene/1/1/canvas.json', '{bad json');
    await expect(readCanvasDefRev('p', { kind: 'scene', episode: '1', shot: '1' }))
      .rejects.toMatchObject({ code: 'CORRUPT' });
  });
});

describe('saveCanvasDef（CAS）', () => {
  const target = { kind: 'scene' as const, episode: '1', shot: '1' };

  it('首次保存（expectedRev=0）：rev 变为 1 并落盘', async () => {
    const r = await saveCanvasDef('p', target, { kind: 'scene', nodes: [] }, 0, false);
    expect(r.rev).toBe(1);
    const file = JSON.parse(await read('prompt/scene/1/1/canvas.json'));
    expect(file.rev).toBe(1);
    expect(file.nodes).toEqual([]);
  });

  it('版本一致时保存并逐次 +1', async () => {
    await saveCanvasDef('p', target, { kind: 'scene', nodes: [] }, 0, false);
    const r2 = await saveCanvasDef('p', target, { kind: 'scene', nodes: [{ id: 'a' }] }, 1, false);
    expect(r2.rev).toBe(2);
    const file = JSON.parse(await read('prompt/scene/1/1/canvas.json'));
    expect(file.rev).toBe(2);
    expect(file.nodes).toEqual([{ id: 'a' }]);
  });

  it('版本过期抛 VERSION_CONFLICT，且不覆盖文件', async () => {
    await saveCanvasDef('p', target, { kind: 'scene', nodes: [] }, 0, false);
    await expect(saveCanvasDef('p', target, { kind: 'scene', nodes: [{ id: 'stale' }] }, 0, false))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentRev: 1, expectedRev: 0 });
    const file = JSON.parse(await read('prompt/scene/1/1/canvas.json'));
    expect(file.rev).toBe(1);
    expect(file.nodes).toEqual([]);
  });

  it('force=true 跳过校验并 bump', async () => {
    await saveCanvasDef('p', target, { kind: 'scene', nodes: [] }, 0, false);
    const r = await saveCanvasDef('p', target, { kind: 'scene', nodes: [{ id: 'force' }] }, 0, true);
    expect(r.rev).toBe(2);
    const file = JSON.parse(await read('prompt/scene/1/1/canvas.json'));
    expect(file.rev).toBe(2);
    expect(file.nodes).toEqual([{ id: 'force' }]);
  });

  it('损坏文件抛 CORRUPT', async () => {
    await write('prompt/scene/1/1/canvas.json', '{bad');
    await expect(saveCanvasDef('p', target, { kind: 'scene', nodes: [] }, 0, false))
      .rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('data 非对象 / 类型不匹配 / expectedRev 非法时抛 INVALID', async () => {
    await expect(saveCanvasDef('p', target, 'x', 0, false)).rejects.toMatchObject({ code: 'INVALID' });
    await expect(saveCanvasDef('p', target, { kind: 'stage', nodes: [] }, 0, false))
      .rejects.toMatchObject({ code: 'INVALID' });
    await expect(saveCanvasDef('p', target, { kind: 'scene' }, -1, false))
      .rejects.toMatchObject({ code: 'INVALID' });
  });

  it('并发保存（同一路径互斥）：最终 rev = N+1 且每个请求基于自己的版本', async () => {
    await saveCanvasDef('p', target, { kind: 'scene', nodes: [] }, 0, false);
    const results = await Promise.allSettled([
      saveCanvasDef('p', target, { kind: 'scene', nodes: [1] }, 1, false),
      saveCanvasDef('p', target, { kind: 'scene', nodes: [2] }, 1, false),
      saveCanvasDef('p', target, { kind: 'scene', nodes: [3] }, 1, false),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const conflicted = results.filter((r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'VERSION_CONFLICT').length;
    // 三个请求基于同一版本 1 并发：恰好一个成功，其余两个冲突
    expect(ok).toBe(1);
    expect(conflicted).toBe(2);
    const file = JSON.parse(await read('prompt/scene/1/1/canvas.json'));
    expect(file.rev).toBe(2);
  });
});

describe('bumpCanvasRevInJsonText', () => {
  it('rev 递增并刷新 updatedAt', () => {
    const out = bumpCanvasRevInJsonText(JSON.stringify({ rev: 3, updatedAt: 'x', nodes: [] }));
    const obj = JSON.parse(out);
    expect(obj.rev).toBe(4);
    expect(obj.updatedAt).not.toBe('x');
    expect(obj.nodes).toEqual([]);
  });

  it('无 rev 字段从 1 开始', () => {
    const out = bumpCanvasRevInJsonText(JSON.stringify({ nodes: [] }));
    expect(JSON.parse(out).rev).toBe(1);
  });

  it('非法 JSON 原样返回', () => {
    expect(bumpCanvasRevInJsonText('{bad')).toBe('{bad');
  });

  it('落盘后的文件可再次 bump（模拟分镜重编号连续改写）', async () => {
    await saveCanvasDef('p', { kind: 'scene', episode: '1', shot: '1' }, { kind: 'scene', nodes: [] }, 0, false);
    const raw = await read('prompt/scene/1/1/canvas.json');
    await write('prompt/scene/1/1/canvas.json', bumpCanvasRevInJsonText(raw));
    expect((JSON.parse(await read('prompt/scene/1/1/canvas.json'))).rev).toBe(2);
    expect(await exists('prompt/scene/1/1/canvas.json')).toBe(true);
  });
});
