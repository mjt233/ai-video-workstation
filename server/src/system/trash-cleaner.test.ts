import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TrashItem } from '../assets/trash.js';

const { mockListTrash, mockPurgeTrash } = vi.hoisted(() => ({
  mockListTrash: vi.fn(),
  mockPurgeTrash: vi.fn(),
}));

vi.mock('../assets/trash.js', () => ({
  listTrash: mockListTrash,
  purgeTrash: mockPurgeTrash,
}));

import {
  formatBytesForLog,
  runTrashAutoClean,
  selectExpiredTrashItems,
  shouldRunAutoClean,
} from './trash-cleaner.js';
import { readSystemSettings, updateTrashAutoClean, writeSystemSettings } from './system-settings.js';

let dir = '';
let configPath = '';

/** 构造回收站条目 */
function item(id: string, trashedAt: string, size = 100): TrashItem {
  return {
    id,
    batchId: '20260101-000000',
    project: 'p',
    relPath: `assert/custom/${id}`,
    originalPath: `assert/custom/${id}`,
    size,
    trashedAt,
    expiresInDays: 0,
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trash-cleaner-'));
  configPath = path.join(dir, 'system.json');
  vi.clearAllMocks();
  mockListTrash.mockResolvedValue({ batches: [], count: 0, totalSize: 0 });
  mockPurgeTrash.mockResolvedValue({ deleted: 0, freed: 0 });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('selectExpiredTrashItems', () => {
  const now = new Date('2026-08-20T00:00:00.000Z');

  it('超过保留期的条目被选中，恰好等于保留期的不选中', () => {
    const items = [
      item('old.png', '2026-08-01T00:00:00.000Z'),   // 19 天
      item('exact.png', '2026-08-13T00:00:00.000Z'), // 恰好 7 天
      item('new.png', '2026-08-19T00:00:00.000Z'),   // 1 天
    ];
    const expired = selectExpiredTrashItems(items, 7, now);
    expect(expired.map((i) => i.id)).toEqual(['old.png']);
  });

  it('时间非法（NaN）的条目跳过，不误删', () => {
    expect(selectExpiredTrashItems([item('bad.png', 'not-a-date')], 0, now)).toEqual([]);
  });
});

describe('shouldRunAutoClean', () => {
  const now = new Date('2026-08-20T00:00:00.000Z');

  it('从未执行 → 需要执行', () => {
    expect(shouldRunAutoClean(null, 7, now)).toBe(true);
  });

  it('未达间隔 → 不执行；达到/超过间隔 → 执行', () => {
    expect(shouldRunAutoClean('2026-08-19T00:00:00.000Z', 7, now)).toBe(false);
    expect(shouldRunAutoClean('2026-08-13T00:00:00.000Z', 7, now)).toBe(true);
    expect(shouldRunAutoClean('2026-01-01T00:00:00.000Z', 7, now)).toBe(true);
  });

  it('时间非法 → 需要执行（自愈）', () => {
    expect(shouldRunAutoClean('bad', 7, now)).toBe(true);
  });
});

describe('runTrashAutoClean', () => {
  it('配置为禁用且非强制 → 不执行、不更新 lastRunAt', async () => {
    await updateTrashAutoClean({ enabled: false }, configPath);
    const result = await runTrashAutoClean({ reason: 'scheduled', configPath });
    expect(result.ran).toBe(false);
    expect(mockPurgeTrash).not.toHaveBeenCalled();
    expect((await readSystemSettings(configPath)).trash.lastRunAt).toBeNull();
  });

  it('强制（手动）触发时即使禁用也执行', async () => {
    await updateTrashAutoClean({ enabled: false }, configPath);
    const result = await runTrashAutoClean({ reason: 'manual', force: true, configPath });
    expect(result.ran).toBe(true);
  });

  it('按保留期删除超期条目并更新 lastRunAt', async () => {
    await updateTrashAutoClean({ retentionDays: 7 }, configPath);
    mockListTrash.mockResolvedValue({
      batches: [{
        batchId: '20260101-000000',
        createdAt: '2026-01-01T00:00:00.000Z',
        count: 2,
        size: 300,
        items: [
          item('old.png', '2026-08-01T00:00:00.000Z', 200),
          item('new.png', '2026-08-19T00:00:00.000Z', 100),
        ],
      }],
      count: 2,
      totalSize: 300,
    });
    mockPurgeTrash.mockResolvedValue({ deleted: 1, freed: 200 });

    const now = new Date('2026-08-20T00:00:00.000Z');
    const result = await runTrashAutoClean({ reason: 'scheduled', configPath, now });

    expect(result).toMatchObject({ ran: true, deleted: 1, freed: 200, remaining: 1, retentionDays: 7 });
    expect(mockPurgeTrash).toHaveBeenCalledWith({
      items: [{ batchId: '20260101-000000', project: 'p', relPath: 'assert/custom/old.png' }],
    });
    expect((await readSystemSettings(configPath)).trash.lastRunAt).toBe(now.toISOString());
  });

  it('没有超期条目时不调用 purge，但仍更新 lastRunAt', async () => {
    await writeSystemSettings(
      { trash: { autoClean: { enabled: true, intervalDays: 7, retentionDays: 7 }, lastRunAt: null } },
      configPath,
    );
    mockListTrash.mockResolvedValue({
      batches: [{
        batchId: '20260101-000000',
        createdAt: '2026-01-01T00:00:00.000Z',
        count: 1,
        size: 100,
        items: [item('new.png', '2026-08-19T00:00:00.000Z')],
      }],
      count: 1,
      totalSize: 100,
    });
    const result = await runTrashAutoClean({
      reason: 'scheduled',
      configPath,
      now: new Date('2026-08-20T00:00:00.000Z'),
    });
    expect(result.deleted).toBe(0);
    expect(mockPurgeTrash).not.toHaveBeenCalled();
    expect((await readSystemSettings(configPath)).trash.lastRunAt).not.toBeNull();
  });
});

describe('formatBytesForLog', () => {
  it('格式化常见量级', () => {
    expect(formatBytesForLog(0)).toBe('0 B');
    expect(formatBytesForLog(512)).toBe('512 B');
    expect(formatBytesForLog(2048)).toBe('2.0 KB');
    expect(formatBytesForLog(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
