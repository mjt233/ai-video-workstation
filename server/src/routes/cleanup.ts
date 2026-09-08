/**
 * 存储清理路由（项目侧）：扫描 + 移入全局回收站。
 *
 * - `POST /api/assets/:project/cleanup/scan`——扫描「无引用自定义资产」与「久远历史记录」；
 * - `POST /api/assets/:project/cleanup/trash`——把选中的文件移入系统全局回收站
 *   （`design/.trash/{批次}/{项目名}/...`）。
 *
 * 回收站的查看/恢复/彻底删除/自动清理属于系统级功能，见 `routes/system.ts`。
 */
import { Router, type Request, type Response } from 'express';
import { createCustomRefChecker, scanCleanup } from '../assets/cleanup.js';
import { moveToTrash } from '../assets/trash.js';
import { httpError } from '../assets/paths.js';

export const cleanupRouter = Router();

/** 历史记录「久远」阈值默认值（天） */
export const DEFAULT_OLDER_THAN_DAYS = 7;

/** 历史记录「久远」阈值上限（天，约 10 年） */
export const MAX_OLDER_THAN_DAYS = 3650;

/**
 * 解析并校验阈值参数。
 *
 * @param raw 请求体中的 olderThanDays
 * @returns 合法天数（缺省时返回默认 7）
 * @throws code=INVALID 非整数或超出 1~3650
 */
function parseOlderThanDays(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_OLDER_THAN_DAYS;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_OLDER_THAN_DAYS) {
    throw Object.assign(
      new Error(`olderThanDays 必须是 1~${MAX_OLDER_THAN_DAYS} 之间的整数（天）`),
      { code: 'INVALID' },
    );
  }
  return n;
}

// POST /api/assets/:project/cleanup/scan — 扫描可清理项
cleanupRouter.post('/assets/:project/cleanup/scan', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const olderThanDays = parseOlderThanDays((req.body as { olderThanDays?: unknown }).olderThanDays);
    const result = await scanCleanup(project, olderThanDays);
    res.json(result);
  } catch (err) {
    httpError(res, err, '扫描失败');
  }
});

// POST /api/assets/:project/cleanup/trash — 移入系统全局回收站
cleanupRouter.post('/assets/:project/cleanup/trash', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const raw = (req.body as { paths?: unknown }).paths;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw Object.assign(new Error('paths 必填且不能为空数组'), { code: 'INVALID' });
    }
    const paths = raw.map((p) => String(p ?? ''));
    // 移入前二次校验引用：扫描后画布/分镜可能已被改动，仍被引用的资产一律跳过
    const refChecker = await createCustomRefChecker(project);
    const result = await moveToTrash(project, paths, { refChecker });
    res.json(result);
  } catch (err) {
    httpError(res, err, '移入回收站失败');
  }
});
