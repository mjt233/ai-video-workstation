import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));

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
  categorizeHistoryPath,
  createCustomRefChecker,
  historyOwnerPath,
  parseHistoryStamp,
  previewKindOf,
  scanCleanup,
  scanStaleHistory,
  scanUnreferencedCustomAssets,
} from './cleanup.js';

/** 写文件（自动建目录） */
async function write(rel: string, content = 'x'): Promise<void> {
  const full = path.join(state.root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

/** 写文件并设置 mtime */
async function writeWithMtime(rel: string, mtime: string, content = 'x'): Promise<void> {
  await write(rel, content);
  const t = new Date(mtime);
  await fs.utimes(path.join(state.root, rel), t, t);
}

/** 搭建带引用的项目夹具 */
async function setupProject(): Promise<void> {
  // 候选自定义资产
  await write('p1/assert/custom/canvas/used.png');
  await write('p1/assert/custom/stage/门外/门.png');
  await write('p1/assert/custom/prop/ref.png');
  await write('p1/assert/custom/canvas/whole/inside.png');
  await write('p1/assert/custom/orphan.png');
  await write('p1/assert/custom/orphan-dir/deep.png');

  // 引用来源
  await write('p1/prompt/scene/1/1/canvas.json', JSON.stringify({
    nodes: [
      { id: 'n1', config: { assetPath: 'assert/custom/canvas/used.png' } },
      { id: 'n2', config: { assetPath: 'assert/custom/canvas/whole' } },
    ],
  }));
  await write('p1/prompt/scene/1/1/stage.json', JSON.stringify([
    { 基础场景: 'custom/stage/门外/门.png', 登场角色: [], prompt: '' },
  ]));
  await write('p1/prompt/prop/武器/刀/refs.json', JSON.stringify({
    image: ['assert/custom/prop/ref.png'],
    video: [],
  }));
}

const NOW = new Date('2026-08-20T00:00:00.000Z');

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanup-'));
  await setupProject();
});

afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true });
});

describe('scanUnreferencedCustomAssets', () => {
  it('只列出未被任何引用命中的自定义资产', async () => {
    const result = await scanUnreferencedCustomAssets('p1');
    expect(result.items.map((i) => i.path).sort()).toEqual([
      'assert/custom/orphan-dir/deep.png',
      'assert/custom/orphan.png',
    ]);
    expect(result.customFiles).toBe(6);
    expect(result.customReferenced).toBe(4);
    expect(result.items[0].category).toBe('custom-orphan');
    expect(result.items[0].previewKind).toBe('image');
  });

  it('目录前缀引用会把目录下全部文件标记为已引用', async () => {
    const result = await scanUnreferencedCustomAssets('p1');
    expect(result.items.some((i) => i.path === 'assert/custom/canvas/whole/inside.png')).toBe(false);
  });

  it('createCustomRefChecker 可用于移入回收站前的二次校验', async () => {
    const checker = await createCustomRefChecker('p1');
    expect(checker('assert/custom/canvas/used.png')).toBe(true);
    expect(checker('assert/custom/orphan.png')).toBe(false);
  });

  it('assert/custom 不存在时返回空结果', async () => {
    const result = await scanUnreferencedCustomAssets('empty-project');
    expect(result).toEqual({ items: [], customFiles: 0, customReferenced: 0 });
  });
});

describe('scanStaleHistory', () => {
  beforeEach(async () => {
    // 达标（2026-01-01，远超 7 天）
    await write('p1/assert/character/陈书文/history/appearance/20260101-120000.jpg');
    await write('p1/assert/character/陈书文/variants/history/v1/20260101-120000.jpg');
    await write('p1/assert/character/陈书文/voice-variants/history/声音1/20260101-120000.flac');
    await write('p1/assert/stage/商场/history/门外/20260101-120000.jpg');
    await write('p1/assert/stage/商场/variants/门外/history/变体1/20260101-120000.jpg');
    await write('p1/assert/prop/武器/刀/history/image/20260101-120000.jpg');
    await write('p1/assert/scene/1/1/canvas/n1/history/output/20260101-120000.jpg');
    await write('p1/assert/stage/商场/canvas/门外/n2/history/output/20260101-120000.jpg');
    // 未达标（1 天）
    await write('p1/assert/character/陈书文/history/appearance/20260819-120000.jpg');
    // 不在范围内：分镜产物历史
    await write('p1/assert/scene/1/1/stage/history/0/20260101-120000.jpg');
    await write('p1/assert/scene/1/1/voice/history/0-陈书文/20260101-120000.flac');
    await write('p1/assert/scene/1/1/video/history/0/20260101-120000.mp4');
    // 文件名无时间戳 → 回退 mtime
    await writeWithMtime('p1/assert/prop/武器/刀/history/audio/random.flac', '2026-01-01T00:00:00.000Z');
  });

  it('按阈值筛选并按分组归类，排除分镜产物历史', async () => {
    const result = await scanStaleHistory('p1', 7, NOW);
    const byCategory: Record<string, string[]> = {};
    for (const item of result.items) {
      (byCategory[item.category] ??= []).push(item.path);
    }
    expect(byCategory['character-history']).toHaveLength(3);
    expect(byCategory['stage-history']).toHaveLength(2);
    expect(byCategory['prop-history']).toHaveLength(2);
    expect(byCategory['canvas-history']).toHaveLength(2);
    expect(result.items.some((i) => i.path.includes('/stage/history/0/'))).toBe(false);
    expect(result.items.some((i) => i.path.includes('/voice/history/'))).toBe(false);
    expect(result.items.some((i) => i.path.includes('/video/history/'))).toBe(false);
    expect(result.items.some((i) => i.path.endsWith('20260819-120000.jpg'))).toBe(false);
    // historyFiles 只统计「在覆盖范围内」的历史文件（13 个历史文件中 3 个属于分镜产物历史）
    expect(result.historyFiles).toBe(10);
    expect(result.historyStale).toBe(9);
  });

  it('归档时间取文件名时间戳，缺失时回退 mtime', async () => {
    const result = await scanStaleHistory('p1', 7, NOW);
    const stamped = result.items.find((i) => i.path.endsWith('20260101-120000.jpg'))!;
    expect(stamped.time).toBe(new Date(2026, 0, 1, 12, 0, 0).toISOString());
    const fallback = result.items.find((i) => i.path.endsWith('random.flac'))!;
    expect(fallback.time).toBe('2026-01-01T00:00:00.000Z');
  });

  it('推导所属当前资产路径', async () => {
    const result = await scanStaleHistory('p1', 7, NOW);
    const item = result.items.find((i) => i.path === 'assert/character/陈书文/history/appearance/20260101-120000.jpg')!;
    expect(item.ownerPath).toBe('assert/character/陈书文/appearance.jpg');
    const canvasItem = result.items.find((i) => i.path.startsWith('assert/scene/1/1/canvas/'))!;
    expect(canvasItem.ownerPath).toBe('assert/scene/1/1/canvas/n1/output.jpg');
  });

  it('阈值极大时不再命中任何历史记录', async () => {
    const result = await scanStaleHistory('p1', 3650, NOW);
    expect(result.items).toEqual([]);
  });
});

describe('scanCleanup', () => {
  it('合并两类结果并统计总大小与分组', async () => {
    await write('p1/assert/character/陈书文/history/appearance/20260101-120000.jpg', 'abcd');
    const result = await scanCleanup('p1', 7, NOW);
    expect(result.olderThanDays).toBe(7);
    expect(result.scannedAt).toBe(NOW.toISOString());
    expect(result.items).toHaveLength(3); // 2 个无引用资产 + 1 条历史
    expect(result.groupTotals['custom-orphan'].count).toBe(2);
    expect(result.groupTotals['character-history']).toEqual({ count: 1, size: 4 });
    expect(result.totalSize).toBe(result.items.reduce((sum, i) => sum + i.size, 0));
    expect(result.stats.customFiles).toBe(6);
    expect(result.stats.historyFiles).toBe(1);
  });
});

describe('纯函数', () => {
  it('parseHistoryStamp 解析文件名时间戳（忽略 -N 后缀）', () => {
    expect(parseHistoryStamp('20260101-120000.jpg')?.getFullYear()).toBe(2026);
    expect(parseHistoryStamp('20260101-120000-1.jpg')?.getMinutes()).toBe(0);
    expect(parseHistoryStamp('random.jpg')).toBeNull();
  });

  it('categorizeHistoryPath 归类并排除分镜产物历史', () => {
    expect(categorizeHistoryPath('assert/character/a/history/appearance/x.jpg')).toBe('character-history');
    expect(categorizeHistoryPath('assert/stage/s/history/l/x.jpg')).toBe('stage-history');
    expect(categorizeHistoryPath('assert/prop/c/p/history/image/x.jpg')).toBe('prop-history');
    expect(categorizeHistoryPath('assert/scene/1/1/canvas/n/history/output/x.jpg')).toBe('canvas-history');
    expect(categorizeHistoryPath('assert/stage/s/canvas/l/n/history/output/x.jpg')).toBe('canvas-history');
    expect(categorizeHistoryPath('assert/scene/1/1/stage/history/0/x.jpg')).toBeNull();
    expect(categorizeHistoryPath('assert/custom/a.png')).toBeNull();
  });

  it('historyOwnerPath 推导所属资产', () => {
    expect(historyOwnerPath('assert/prop/武器/刀/history/audio/x.flac')).toBe('assert/prop/武器/刀/audio.flac');
    expect(historyOwnerPath('assert/custom/a.png')).toBeNull();
    expect(historyOwnerPath('assert/prop/武器/刀/history/x.flac')).toBeNull();
  });

  it('previewKindOf 按扩展名推断预览类型', () => {
    expect(previewKindOf('.JPG')).toBe('image');
    expect(previewKindOf('.flac')).toBe('audio');
    expect(previewKindOf('.mp4')).toBe('video');
    expect(previewKindOf('.json')).toBe('text');
    expect(previewKindOf('.blend')).toBe('none');
  });
});
