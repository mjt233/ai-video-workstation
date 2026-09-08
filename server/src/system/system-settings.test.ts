import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  computeNextRunAt,
  DEFAULT_SYSTEM_SETTINGS,
  markTrashAutoCleanRun,
  normalizeDays,
  normalizeSystemSettings,
  readSystemSettings,
  updateTrashAutoClean,
  writeSystemSettings,
} from './system-settings.js';

let dir = '';
let configPath = '';

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'system-settings-'));
  configPath = path.join(dir, 'system.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('readSystemSettings', () => {
  it('配置文件缺失时返回默认值（启用 / 7 天 / 7 天）', async () => {
    const settings = await readSystemSettings(configPath);
    expect(settings.trash.autoClean).toEqual({ enabled: true, intervalDays: 7, retentionDays: 7 });
    expect(settings.trash.lastRunAt).toBeNull();
  });

  it('字段缺失时逐字段回退默认值', async () => {
    await fs.writeFile(configPath, JSON.stringify({ trash: { autoClean: { intervalDays: 30 } } }), 'utf-8');
    const settings = await readSystemSettings(configPath);
    expect(settings.trash.autoClean).toEqual({ enabled: true, intervalDays: 30, retentionDays: 7 });
  });

  it('JSON 损坏时回退默认值且不抛错', async () => {
    await fs.writeFile(configPath, '{ not json', 'utf-8');
    const settings = await readSystemSettings(configPath);
    expect(settings).toEqual(DEFAULT_SYSTEM_SETTINGS);
  });

  it('天数非法时回退默认值', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({ trash: { autoClean: { intervalDays: 0, retentionDays: -3, enabled: 'yes' } } }),
      'utf-8',
    );
    const settings = await readSystemSettings(configPath);
    expect(settings.trash.autoClean).toEqual({ enabled: true, intervalDays: 7, retentionDays: 7 });
  });
});

describe('normalizeSystemSettings', () => {
  it('非对象输入返回默认值', () => {
    expect(normalizeSystemSettings(null)).toEqual(DEFAULT_SYSTEM_SETTINGS);
    expect(normalizeSystemSettings([])).toEqual(DEFAULT_SYSTEM_SETTINGS);
  });

  it('保留合法 lastRunAt，忽略非法值', () => {
    expect(normalizeSystemSettings({ trash: { lastRunAt: '2026-01-01T00:00:00.000Z' } }).trash.lastRunAt)
      .toBe('2026-01-01T00:00:00.000Z');
    expect(normalizeSystemSettings({ trash: { lastRunAt: 123 } }).trash.lastRunAt).toBeNull();
  });
});

describe('normalizeDays', () => {
  it('接受 1~3650 的整数（含字符串数字）', () => {
    expect(normalizeDays('执行间隔', 1)).toBe(1);
    expect(normalizeDays('执行间隔', 3650)).toBe(3650);
    expect(normalizeDays('执行间隔', '14')).toBe(14);
  });

  it('拒绝 0、负数、小数、超上限与非数字', () => {
    for (const bad of [0, -1, 1.5, 3651, 'abc', null, undefined]) {
      expect(() => normalizeDays('执行间隔', bad)).toThrowError(/整数/);
    }
  });
});

describe('updateTrashAutoClean', () => {
  it('局部更新并落盘（未传字段保持原值）', async () => {
    await updateTrashAutoClean({ intervalDays: 3 }, configPath);
    let settings = await readSystemSettings(configPath);
    expect(settings.trash.autoClean).toEqual({ enabled: true, intervalDays: 3, retentionDays: 7 });

    await updateTrashAutoClean({ enabled: false, retentionDays: 30 }, configPath);
    settings = await readSystemSettings(configPath);
    expect(settings.trash.autoClean).toEqual({ enabled: false, intervalDays: 3, retentionDays: 30 });
  });

  it('天数非法时抛 INVALID 且不落盘', async () => {
    await expect(updateTrashAutoClean({ retentionDays: 0 }, configPath)).rejects.toMatchObject({ code: 'INVALID' });
    await expect(updateTrashAutoClean({ enabled: 1 as unknown as boolean }, configPath))
      .rejects.toMatchObject({ code: 'INVALID' });
    await expect(fs.access(configPath)).rejects.toBeTruthy();
  });
});

describe('markTrashAutoCleanRun / computeNextRunAt', () => {
  it('记录执行时间并计算下次执行时间', async () => {
    const at = '2026-08-20T00:00:00.000Z';
    await markTrashAutoCleanRun(at, configPath);
    const settings = await readSystemSettings(configPath);
    expect(settings.trash.lastRunAt).toBe(at);
    expect(computeNextRunAt(at, 7)).toBe('2026-08-27T00:00:00.000Z');
  });

  it('从未执行时 nextRunAt 为 null（表示应立即执行）', () => {
    expect(computeNextRunAt(null, 7)).toBeNull();
    expect(computeNextRunAt('bad-date', 7)).toBeNull();
  });
});

describe('writeSystemSettings', () => {
  it('原子写入后可直接读回', async () => {
    await writeSystemSettings(
      { trash: { autoClean: { enabled: false, intervalDays: 10, retentionDays: 20 }, lastRunAt: null } },
      configPath,
    );
    const settings = await readSystemSettings(configPath);
    expect(settings.trash.autoClean).toEqual({ enabled: false, intervalDays: 10, retentionDays: 20 });
  });
});
