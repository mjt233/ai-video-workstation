/**
 * 系统设置与回收站路由（系统级，不区分项目）。
 *
 * - `GET/PUT /api/system/settings`——系统设置读写（含「回收站」与「任务日志」两个子类）；
 * - `GET /api/system/trash`——全局回收站内容（按批次分组）；
 * - `POST /api/system/trash/restore`——恢复条目到原项目位置；
 * - `POST /api/system/trash/purge`——彻底删除（指定条目 / 批次 / 全部）；
 * - `POST /api/system/trash/auto-clean`——立即执行一次超期清理（手动触发，忽略开关）；
 * - `GET /api/system/task-log/stats`——任务日志占用统计（行数/最早时间/可清理行数/占用）；
 * - `POST /api/system/task-log/clean`——立即执行一次超期日志清理（手动触发，忽略开关）；
 * - `POST /api/system/task-log/purge`——清空全部**已终态任务**日志（运行中任务受保护）。
 *
 * 自动清理的定时触发由 `system/trash-scheduler.ts`（默认每 7 天）与
 * `system/log-scheduler.ts`（默认每 24 小时）负责。
 */
import { Router, type Request, type Response } from 'express';
import { listTrash, purgeTrash, restoreTrash } from '../assets/trash.js';
import { httpError } from '../assets/paths.js';
import * as db from '../db.js';
import {
  computeNextRunAt,
  readSystemSettings,
  updateTaskLogSettings,
  updateTrashAutoClean,
  type TaskLogPatch,
  type TrashAutoCleanPatch,
} from '../system/system-settings.js';
import { runTrashAutoClean } from '../system/trash-cleaner.js';
import { runTaskLogAutoClean, taskLogSnapshot } from '../system/log-cleaner.js';

export const systemRouter = Router();

/**
 * 组装系统设置响应（附回收站统计、任务日志统计与下次自动清理时间）。
 *
 * 任务日志统计走 `log-cleaner.ts: taskLogSnapshot`（与 `GET /api/system/task-log/stats`
 * 共用同一函数，保证两处形状一致）。
 *
 * @returns 系统设置 + 回收站统计 + 日志统计 + 两组下次执行时间
 */
async function settingsPayload() {
  const settings = await readSystemSettings();
  const listed = await listTrash({ retentionDays: settings.trash.autoClean.retentionDays });
  const logStats = await taskLogSnapshot();
  return {
    settings,
    trashStats: { count: listed.count, totalSize: listed.totalSize },
    nextRunAt: computeNextRunAt(settings.trash.lastRunAt, settings.trash.autoClean.intervalDays),
    taskLogStats: logStats,
    taskLogNextRunAt: logStats.nextRunAt,
  };
}

// GET /api/system/settings — 读取系统设置
systemRouter.get('/system/settings', async (_req: Request, res: Response) => {
  try {
    res.json(await settingsPayload());
  } catch (err) {
    httpError(res, err, '读取系统设置失败');
  }
});

// PUT /api/system/settings — 局部更新系统设置（「回收站 → 自动清理」/「任务日志」）
systemRouter.put('/system/settings', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      trash?: { autoClean?: TrashAutoCleanPatch };
      taskLog?: TaskLogPatch;
    };
    if (body.trash?.autoClean) await updateTrashAutoClean(body.trash.autoClean);
    if (body.taskLog) await updateTaskLogSettings(body.taskLog);
    res.json(await settingsPayload());
  } catch (err) {
    httpError(res, err, '保存系统设置失败');
  }
});

// GET /api/system/trash — 全局回收站内容
systemRouter.get('/system/trash', async (_req: Request, res: Response) => {
  try {
    const settings = await readSystemSettings();
    const listed = await listTrash({ retentionDays: settings.trash.autoClean.retentionDays });
    res.json({
      ...listed,
      retentionDays: settings.trash.autoClean.retentionDays,
    });
  } catch (err) {
    httpError(res, err, '读取回收站失败');
  }
});

// POST /api/system/trash/restore — 恢复条目
systemRouter.post('/system/trash/restore', async (req: Request, res: Response) => {
  try {
    const raw = (req.body as { items?: unknown }).items;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw Object.assign(new Error('items 必填且不能为空数组'), { code: 'INVALID' });
    }
    const result = await restoreTrash(
      raw as Array<{ batchId?: unknown; project?: unknown; relPath?: unknown }>,
    );
    res.json(result);
  } catch (err) {
    httpError(res, err, '恢复失败');
  }
});

// POST /api/system/trash/purge — 彻底删除
systemRouter.post('/system/trash/purge', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { items?: unknown; batchId?: unknown; all?: unknown };
    const items = Array.isArray(body.items)
      ? (body.items as Array<{ batchId?: unknown; project?: unknown; relPath?: unknown }>)
      : undefined;
    const batchId = typeof body.batchId === 'string' && body.batchId ? body.batchId : undefined;
    const all = body.all === true;
    if (!all && !batchId && (!items || items.length === 0)) {
      throw Object.assign(new Error('请指定 items、batchId 或 all 之一'), { code: 'INVALID' });
    }
    const result = await purgeTrash({ items, batchId, all });
    res.json(result);
  } catch (err) {
    httpError(res, err, '彻底删除失败');
  }
});

// POST /api/system/trash/auto-clean — 立即执行一次自动清理
systemRouter.post('/system/trash/auto-clean', async (_req: Request, res: Response) => {
  try {
    // 手动触发：即使配置为禁用也执行（force），但沿用配置的保留期
    const result = await runTrashAutoClean({ reason: 'manual', force: true });
    res.json(result);
  } catch (err) {
    httpError(res, err, '执行自动清理失败');
  }
});

// GET /api/system/task-log/stats — 任务日志占用统计
systemRouter.get('/system/task-log/stats', async (_req: Request, res: Response) => {
  try {
    res.json(await taskLogSnapshot());
  } catch (err) {
    httpError(res, err, '读取任务日志统计失败');
  }
});

// POST /api/system/task-log/clean — 立即清理超期日志（手动触发，忽略开关）
systemRouter.post('/system/task-log/clean', async (_req: Request, res: Response) => {
  try {
    // 手动触发：即使配置为禁用也执行（force），沿用配置的保留期与 VACUUM 策略
    const result = await runTaskLogAutoClean({ reason: 'manual', force: true });
    res.json(result);
  } catch (err) {
    httpError(res, err, '清理任务日志失败');
  }
});

// POST /api/system/task-log/purge — 清空全部已终态任务日志（运行中任务日志受保护）
systemRouter.post('/system/task-log/purge', async (_req: Request, res: Response) => {
  try {
    // 先取「运行中任务日志行数」：这些行无论何时都不会被清理，回给前端做提示
    const retentionDays = (await readSystemSettings()).taskLog.autoClean.retentionDays;
    const protectedRows = db.getLogStats(retentionDays).activeRows;
    const result = db.purgeTaskLogs();
    res.json({ ...result, protectedRows });
  } catch (err) {
    httpError(res, err, '清空任务日志失败');
  }
});
