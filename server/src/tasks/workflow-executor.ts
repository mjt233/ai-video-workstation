/**
 * 工作流任务执行器（统一任务架构中的**镜像适配器**）。
 *
 * 工作流任务（AI 生成）的**持久化权威仍是 SQLite `tasks` 表**（引擎轮询 + 前端产物回调），
 * 本模块只做两件事：
 * 1. 把引擎执行中的任务**登记进统一注册表**（任务管理器可见，运行态唯一展示源）；
 * 2. 提供中断实现（复用既有 `canCancelTask` + Bridge/延迟取消语义），供注册表 `handle.cancel()` 调用。
 *
 * 登记点为「引擎开始执行」与「终态收敛」两处（见 `workflow-engine.ts` 的 `runTask`），
 * 避免在任务创建处登记导致排队中的任务被误显示为运行中。
 */

import * as db from '../db.js';
import { getImpl } from '../workflows/registry.js';
import { getProvider } from '../providers/registry.js';
import { listInstances, resolveInstanceConfig } from '../providers/config-store.js';
import { markCancelRequested } from '../workflows/cancel.js';
import { parseTaskParams } from '../routes/workflow.js';
import { taskRegistry, type TaskRecord } from './registry.js';
import { createTaskHandle } from './executor.js';

/** 工作流任务登记参数（引擎侧调用） */
export interface WorkflowTaskRegisterInput {
  /** 任务 id（SQLite tasks 主键，即注册表任务 id） */
  taskId: string;
  /** 项目名 */
  project: string;
  /** 工作流类型 id（如 image-to-video） */
  workflowId: string;
  /** 工作流实现标识 */
  impl: string;
  /** 展示名（节点名 / 资产类型中文名） */
  label: string;
  /** 产物相对路径（payload 展示用） */
  outputPath?: string;
}

/**
 * 判断工作流任务是否可中断（与 `canCancelTask` 同一语义，此处仅取布尔与原因）。
 *
 * @param workflowId 工作流类型 id
 * @param impl 工作流实现标识
 * @param status 任务当前状态
 * @param remoteTaskId 已提交的远端任务 id（可选）
 * @returns 可中断性判定
 */
export function workflowCancelability(
  workflowId: string,
  impl: string,
  status: string,
  remoteTaskId?: string,
): { cancelable: boolean; reason?: string } {
  const wf = getImpl(workflowId, impl);
  if (!wf?.capabilities?.cancelable) {
    return { cancelable: false, reason: '该工作流不支持中断' };
  }
  if (status === 'pending') return { cancelable: true };
  if (status !== 'running') {
    return { cancelable: false, reason: `任务状态不是 pending 或 running（当前 ${status}）` };
  }
  if (!remoteTaskId && !wf?.capabilities?.deferredCancel) {
    return { cancelable: false, reason: '任务尚未提交到远端，无法中断' };
  }
  if (wf?.capabilities?.deferredCancel) {
    return { cancelable: true, reason: '已请求取消将在执行完成后生效' };
  }
  return { cancelable: true };
}

/**
 * 执行工作流任务中断（复用既有语义：本地排队直接失败 / 运行中调 Bridge cancel / 延迟取消标记）。
 *
 * @param taskId 任务 id
 * @throws Error 中断失败（provider 未注册 / 实例缺失 / 远端取消失败）
 */
export async function cancelWorkflowTask(taskId: string): Promise<void> {
  const task = db.getTask(taskId);
  if (!task) return;
  const wf = getImpl(task.workflow_id, task.impl);
  if (!wf?.capabilities?.cancelable) return;

  if (task.status === 'running') {
    // 同步执行 provider（deferredCancel）：无法中止在途请求 → 写取消标记，
    // 由引擎在 execute 完成后检查并持久化为失败（用户中断）
    if (wf?.capabilities?.deferredCancel) {
      db.updateTaskParams(task.id, markCancelRequested(JSON.parse(task.params)));
      db.addLog(task.id, 'info', '已请求取消，将在执行完成后生效');
      return;
    }
    const providerId = wf?.provider ?? 'comfyui-bridge';
    const providerDef = getProvider(providerId);
    if (!providerDef) throw new Error(`provider 未注册: ${providerId}`);
    const instances = await listInstances();
    // 优先按工作流绑定的服务商实例 ID 定位（多实例时避免把取消请求发错实例）
    const inst = wf?.providerInstanceId
      ? instances.find((i) => i.id === wf.providerInstanceId && i.type === providerId)
      : instances.find((i) => i.type === providerId);
    if (!inst) throw new Error(`未配置 ${providerId} 实例`);
    const remoteTaskId = parseTaskParams(task.params).remoteTaskId;
    if (!remoteTaskId) throw new Error('任务尚未提交到远端，无法中断');
    await providerDef.createClient(resolveInstanceConfig(inst)).cancel(remoteTaskId);
  }
  db.updateTaskStatus(task.id, 'failed', { error_msg: '用户中断' });
  db.addLog(task.id, 'info', 'Task cancelled by user');
}

/** 工作流任务执行器（登记 + 中断委托） */
class WorkflowExecutor {
  /** 任务类型 */
  readonly type = 'workflow' as const;

  /**
   * 登记工作流任务（引擎开始执行时调用）。
   *
   * 已登记（重试/恢复）时直接返回既有记录，不重复登记。
   *
   * @param input 登记参数
   * @returns 任务记录
   */
  create(input: WorkflowTaskRegisterInput): TaskRecord {
    const existing = taskRegistry.get(input.taskId);
    if (existing) return existing;
    const record = db.getTask(input.taskId);
    const remoteTaskId = record ? parseTaskParams(record.params).remoteTaskId : undefined;
    const cancelability = workflowCancelability(
      input.workflowId,
      input.impl,
      record?.status ?? 'running',
      remoteTaskId,
    );
    return taskRegistry.register({
      type: this.type,
      label: input.label,
      project: input.project,
      status: record?.status === 'pending' ? 'pending' : 'running',
      idOverride: input.taskId,
      cancelable: cancelability.cancelable,
      ...(cancelability.reason ? { cancelBlockReason: cancelability.reason } : {}),
      payload: {
        workflowId: input.workflowId,
        impl: input.impl,
        ...(input.outputPath ? { outputPath: input.outputPath } : {}),
      },
      handle: createTaskHandle(() => cancelWorkflowTask(input.taskId)),
    });
  }

  /**
   * 终态收敛：从统一注册表移除（SQLite 记录已由引擎更新）。
   *
   * @param taskId 任务 id
   * @param status 终态
   */
  finish(taskId: string, status: 'completed' | 'failed' | 'cancelled'): void {
    taskRegistry.finish(taskId, { status });
  }

  /**
   * 任务状态推进（引擎轮询远端后调用）：更新状态与可中断性。
   *
   * @param taskId 任务 id
   * @param patch 状态/进度/远端任务 id 变化
   */
  update(taskId: string, patch: { status?: 'pending' | 'running'; progress?: number; remoteTaskId?: string }): void {
    const record = taskRegistry.get(taskId);
    if (!record) return;
    const wf = record.payload?.workflowId;
    const impl = record.payload?.impl;
    let cancelable = record.cancelable;
    let reason = record.cancelBlockReason;
    if (typeof wf === 'string' && typeof impl === 'string' && patch.status) {
      const c = workflowCancelability(wf, impl, patch.status, patch.remoteTaskId);
      cancelable = c.cancelable;
      reason = c.reason;
    }
    taskRegistry.update(taskId, {
      ...(patch.status ? { status: patch.status } : {}),
      ...(typeof patch.progress === 'number' ? { progress: patch.progress } : {}),
      cancelable,
      cancelBlockReason: reason ?? '',
      ...(patch.remoteTaskId ? { payload: { remoteTaskId: patch.remoteTaskId } } : {}),
    });
  }
}

/** 全局工作流任务执行器单例 */
export const workflowExecutor = new WorkflowExecutor();
