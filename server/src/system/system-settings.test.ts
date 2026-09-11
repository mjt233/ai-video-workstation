import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  computeNextRunAt,
  computeNextRunAtHours,
  DEFAULT_SYSTEM_SETTINGS,
  markTaskLogCleanRun,
  markTrashAutoCleanRun,
  normalizeDays,
  normalizeHeartbeatSeconds,
  normalizeHours,
  normalizeSystemSettings,
  readSystemSettings,
  updateTaskLogSettings,
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
      {
        trash: { autoClean: { enabled: false, intervalDays: 10, retentionDays: 20 }, lastRunAt: null },
        taskLog: { autoClean: { enabled: false, intervalHours: 6, retentionDays: 3 }, heartbeatSeconds: 0, lastRunAt: null },
      },
      configPath,
    );
    const settings = await readSystemSettings(configPath);
    expect(settings.trash.autoClean).toEqual({ enabled: false, intervalDays: 10, retentionDays: 20 });
    expect(settings.taskLog.autoClean).toEqual({ enabled: false, intervalHours: 6, retentionDays: 3 });
    expect(settings.taskLog.heartbeatSeconds).toBe(0);
  });
});

describe('任务日志（taskLog）配置', () => {
  it('配置文件缺失时返回默认值（启用 / 24 小时 / 14 天 / 心跳 60 秒）', async () => {
    const settings = await readSystemSettings(configPath);
    expect(settings.taskLog.autoClean).toEqual({ enabled: true, intervalHours: 24, retentionDays: 14 });
    expect(settings.taskLog.heartbeatSeconds).toBe(60);
    expect(settings.taskLog.lastRunAt).toBeNull();
  });

  it('字段缺失时逐字段回退默认值', async () => {
    await fs.writeFile(configPath, JSON.stringify({ taskLog: { autoClean: { retentionDays: 30 } } }), 'utf-8');
    const settings = await readSystemSettings(configPath);
    expect(settings.taskLog.autoClean).toEqual({ enabled: true, intervalHours: 24, retentionDays: 30 });
    expect(settings.taskLog.heartbeatSeconds).toBe(60);
  });

  it('非法值回退默认值（越界小时/天数、心跳越界、enabled 非布尔）', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        taskLog: {
          autoClean: { enabled: 'yes', intervalHours: 0, retentionDays: 99999 },
          heartbeatSeconds: -5,
        },
      }),
      'utf-8',
    );
    const settings = await readSystemSettings(configPath);
    expect(settings.taskLog).toEqual(DEFAULT_SYSTEM_SETTINGS.taskLog);
  });

  it('心跳间隔允许 0（表示不写心跳日志）', async () => {
    await fs.writeFile(configPath, JSON.stringify({ taskLog: { heartbeatSeconds: 0 } }), 'utf-8');
    expect((await readSystemSettings(configPath)).taskLog.heartbeatSeconds).toBe(0);
  });

  it('旧配置（仅 trash 子类）升级后自动补齐 taskLog 默认值', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({ trash: { autoClean: { enabled: true, intervalDays: 7, retentionDays: 7 }, lastRunAt: null } }),
      'utf-8',
    );
    const settings = await readSystemSettings(configPath);
    expect(settings.taskLog).toEqual(DEFAULT_SYSTEM_SETTINGS.taskLog);
  });
});

describe('normalizeHours / normalizeHeartbeatSeconds', () => {
  it('接受范围内整数（含字符串数字）', () => {
    expect(normalizeHours('执行间隔', 1)).toBe(1);
    expect(normalizeHours('执行间隔', 720)).toBe(720);
    expect(normalizeHours('执行间隔', '6')).toBe(6);
    expect(normalizeHeartbeatSeconds(0)).toBe(0);
    expect(normalizeHeartbeatSeconds(3600)).toBe(3600);
  });

  it('拒绝越界与非法值', () => {
    for (const bad of [0, -1, 1.5, 721, 'abc', null]) {
      expect(() => normalizeHours('执行间隔', bad)).toThrowError(/整数/);
    }
    for (const bad of [-1, 1.5, 3601, 'abc', null]) {
      expect(() => normalizeHeartbeatSeconds(bad)).toThrowError(/整数/);
    }
  });
});

describe('updateTaskLogSettings', () => {
  it('局部更新并落盘（未传字段保持原值）', async () => {
    await updateTaskLogSettings({ autoClean: { intervalHours: 6 } }, configPath);
    let settings = await readSystemSettings(configPath);
    expect(settings.taskLog.autoClean).toEqual({ enabled: true, intervalHours: 6, retentionDays: 14 });
    expect(settings.taskLog.heartbeatSeconds).toBe(60);

    await updateTaskLogSettings({ autoClean: { enabled: false, retentionDays: 30 }, heartbeatSeconds: 0 }, configPath);
    settings = await readSystemSettings(configPath);
    expect(settings.taskLog.autoClean).toEqual({ enabled: false, intervalHours: 6, retentionDays: 30 });
    expect(settings.taskLog.heartbeatSeconds).toBe(0);
  });

  it('不影响回收站子类配置', async () => {
    await updateTrashAutoClean({ intervalDays: 3 }, configPath);
    await updateTaskLogSettings({ heartbeatSeconds: 120 }, configPath);
    const settings = await readSystemSettings(configPath);
    expect(settings.trash.autoClean.intervalDays).toBe(3);
    expect(settings.taskLog.heartbeatSeconds).toBe(120);
  });

  it('非法值抛 INVALID 且不落盘', async () => {
    await expect(updateTaskLogSettings({ autoClean: { retentionDays: 0 } }, configPath))
      .rejects.toMatchObject({ code: 'INVALID' });
    await expect(updateTaskLogSettings({ heartbeatSeconds: 99999 }, configPath))
      .rejects.toMatchObject({ code: 'INVALID' });
    await expect(updateTaskLogSettings({ autoClean: { enabled: 1 as unknown as boolean } }, configPath))
      .rejects.toMatchObject({ code: 'INVALID' });
    await expect(fs.access(configPath)).rejects.toBeTruthy();
  });
});

describe('markTaskLogCleanRun / computeNextRunAtHours', () => {
  it('记录执行时间并按小时计算下次执行时间', async () => {
    const at = '2026-09-11T00:00:00.000Z';
    await markTaskLogCleanRun(at, configPath);
    const settings = await readSystemSettings(configPath);
    expect(settings.taskLog.lastRunAt).toBe(at);
    expect(computeNextRunAtHours(at, 24)).toBe('2026-09-12T00:00:00.000Z');
    expect(computeNextRunAtHours(at, 6)).toBe('2026-09-11T06:00:00.000Z');
  });

  it('从未执行或时间非法时返回 null（表示应立即执行）', () => {
    expect(computeNextRunAtHours(null, 24)).toBeNull();
    expect(computeNextRunAtHours('bad-date', 24)).toBeNull();
  });
});
