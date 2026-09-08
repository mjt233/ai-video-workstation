/**
 * 统一任务路由（`/api/tasks`）。
 *
 * - `GET /api/tasks`：当前活跃任务列表（WS 不可用时的降级/调试路径；任务管理器主通道是 WS）；
 * - `POST /api/tasks/:taskId/cancel`：统一中断入口（路由到注册表的任务句柄）。
 */

import { Router, type Request, type Response } from 'express';
import { taskRegistry } from './registry.js';
import { toTaskInfo, wsHub } from './task-ws.js';

/** 统一任务路由 */
export const taskRouter = Router();

// GET /api/tasks — 当前活跃任务列表（可选 ?project= 过滤）
taskRouter.get('/tasks', (req: Request, res: Response) => {
  const project = typeof req.query.project === 'string' && req.query.project ? req.query.project : undefined;
  const tasks = taskRegistry
    .listActive()
    .filter((t) => !project || t.project === project)
    .map((t) => toTaskInfo(t));
  res.json({ tasks });
});

// POST /api/tasks/:taskId/cancel — 统一中断（幂等：任务不存在/已终态返回 404）
taskRouter.post('/tasks/:taskId/cancel', (req: Request, res: Response) => {
  const taskId = String(req.params.taskId ?? '');
  if (!taskId) {
    res.status(400).json({ error: 'taskId 必填', code: 'INVALID' });
    return;
  }
  const result = taskRegistry.cancel(taskId);
  if (!result.ok) {
    res.status(404).json({ error: result.reason, code: 'NOT_CANCELABLE' });
    return;
  }
  // 通知订阅者：中断已受理（终态由执行器收敛后广播 task-update/tasks）
  wsHub.taskEvent(taskId, { type: 'cancelling', taskId });
  res.json({ success: true, taskId });
});
