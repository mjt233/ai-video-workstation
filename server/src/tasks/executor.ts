/**
 * 任务执行器门面（接口定义，仅类型 + 公共小工具）。
 *
 * 设计分层（见 `docs/plans/2026-09-09-unified-async-task-manager.md` §6.3）：
 * - `registry.ts`：统一任务模型 + 事件（运行态唯一事实源，**不认识任何具体执行器**）；
 * - `executor.ts`（本文件）：把「启动一个异步任务」统一成同一形状（写侧门面）；
 * - `TaskHandle`：运行态中断凭据，注册表只调 `handle.cancel()`。
 *
 * 三类任务的执行机制天然不同（DB 行 + 引擎轮询 / 上游流 + AbortController / 子进程），
 * 因此门面**不强制**所有类型都实现 `run()`：ffmpeg 完整实现（三个操作共享同一生命周期），
 * llm / workflow 为薄适配（只借用 `create/finish/cancel`）。
 *
 * 本文件只放接口，避免 `registry.ts` 与具体执行器相互 import 形成循环依赖。
 */

import { taskRegistry, type TaskRecord, type TaskRegisterInput, type TaskStatus, type TaskType } from './registry.js';

/** 任务运行态中断凭据（仅内存持有，不进入广播载荷） */
export interface TaskHandle {
  /**
   * 请求中断本任务。
   *
   * 实现方负责「真中断」语义（如 kill 子进程 + 清理半截产物）并最终调用
   * `taskRegistry.finish(id, { status: 'cancelled' })` 收敛；同步/异步均可。
   */
  cancel(): Promise<void> | void;
}

/** 任务登记元信息（executor.create 入参，与 TaskRegisterInput 一致但去掉类型自决字段） */
export type TaskMeta = Omit<TaskRegisterInput, 'type' | 'handle'>;

/** 任务执行器门面 */
export interface TaskExecutor<TParams> {
  /** 本执行器负责的任务类型 */
  readonly type: TaskType;
  /**
   * 登记任务（返回可广播的 TaskRecord；中断句柄由实现注入）。
   *
   * @param meta 登记元信息（label/project/nodeId/canvas/payload 等）
   * @param params 执行参数（实现自有结构）
   * @returns 已登记的任务记录（id 返回给客户端）
   */
  create(meta: TaskMeta, params: TParams): TaskRecord;
  /**
   * 启动执行。**终态必须由执行器负责收敛**（成功/失败/中断都要调用 finish），
   * 否则任务会永远留在活跃区。
   *
   * @param taskId 任务 id
   * @param params 执行参数
   */
  run(taskId: string, params: TParams): Promise<void>;
  /**
   * 请求中断。
   *
   * @param taskId 任务 id
   * @returns 是否已受理（不可中断返回 false）
   */
  cancel(taskId: string): boolean;
  /**
   * 上报进度（可选；未实现则任务进度为不确定）。
   *
   * @param taskId 任务 id
   * @param progress 进度百分比（0~100）
   */
  onProgress?(taskId: string, progress: number): void;
}

/**
 * 构造任务中断句柄：把「取消实现」包成注册表可用的 `TaskHandle`。
 *
 * @param cancel 实际取消实现（如 kill 子进程 + 清理产物）
 * @returns 任务中断句柄
 */
export function createTaskHandle(cancel: () => Promise<void> | void): TaskHandle {
  return { cancel };
}

/**
 * 安全收敛任务终态（执行器内部使用）：任务已被外部移除/已终态时静默忽略。
 *
 * @param taskId 任务 id
 * @param outcome 终态与错误信息
 * @returns 终态任务快照；任务不存在返回 null
 */
export function finishTask(
  taskId: string,
  outcome?: { status?: TaskStatus; error?: string },
): TaskRecord | null {
  return taskRegistry.finish(taskId, outcome);
}
