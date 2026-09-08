/**
 * LLM 任务执行器（统一任务架构中的**薄适配**）。
 *
 * LLM 会话的执行权在 `llm/session-manager.ts`（上游流 + AbortController + 终态落盘），
 * 本执行器只负责两件事：
 * 1. 把会话**登记进统一注册表**（会话 id 即任务 id，便于任务管理器与画布共用一套凭据）；
 * 2. 把「中断」委托给会话管理器（`sessionManager.cancel` → abort 上游）。
 *
 * **LLM 流式增量（thinking/text/warning）不进任务模型**，仍走 `task-ws` 的按任务订阅通道。
 */

import { taskRegistry, type TaskRecord } from './registry.js';
import { createTaskHandle } from './executor.js';
import { setLlmSessionLookup } from './llm-bridge.js';
import { sessionManager, type LlmSessionLifecycle } from '../llm/session-manager.js';

/** LLM 任务登记参数（由 `llm/session-manager.begin` 传入） */
export interface LlmTaskRegisterInput {
  /** 会话 id（由会话管理器生成，即任务 id） */
  taskId: string;
  /** 发起节点 id */
  nodeId: string;
  /** 展示名 */
  label: string;
  /** 项目名 */
  project: string;
  /** 画布定位 */
  canvas: { kind: 'scene' | 'stage'; episode?: string; shot?: string; stage?: string; label?: string };
  /** 模型展示名（任务管理器展示） */
  modelName?: string;
}

/** LLM 任务执行器 */
class LlmExecutor {
  /** 任务类型 */
  readonly type = 'llm' as const;

  /**
   * 以会话 id 为任务 id 登记 LLM 任务（保证两套 id 一致，前端只需一个凭据）。
   *
   * @param input 登记参数
   * @returns 已登记的任务记录
   */
  create(input: LlmTaskRegisterInput): TaskRecord {
    const task = taskRegistry.register({
      type: this.type,
      label: input.label,
      project: input.project,
      nodeId: input.nodeId,
      canvas: input.canvas,
      progress: undefined,
      cancelable: true,
      payload: { ...(input.modelName ? { modelName: input.modelName } : {}) },
      handle: createTaskHandle(() => {
        sessionManager.cancel(input.taskId);
      }),
      idOverride: input.taskId,
    });
    return task;
  }

  /**
   * 同步会话阶段/警告到任务（任务管理器展示）。
   *
   * @param taskId 会话 id
   * @param patch 变更字段
   */
  update(taskId: string, patch: { phase?: 'thinking' | 'responding'; modelName?: string }): void {
    taskRegistry.update(taskId, {
      payload: { ...(patch.phase ? { phase: patch.phase } : {}), ...(patch.modelName ? { modelName: patch.modelName } : {}) },
    });
  }

  /**
   * 会话终态收敛：从统一注册表移除（终态载荷由 task-ws 按会话快照广播）。
   *
   * @param taskId 会话 id
   * @param status 终态
   */
  finish(taskId: string, status: 'completed' | 'failed' | 'cancelled'): void {
    taskRegistry.finish(taskId, { status });
  }

  /**
   * 构造会话生命周期回调（`sessionManager.begin` 的 lifecycle 参数）。
   *
   * 会话管理器只负责调用回调，不认识注册表——避免 `session-manager → llm-executor → session-manager` 模块环。
   *
   * @param taskId 会话 id
   * @returns 生命周期回调
   */
  lifecycleOf(taskId: string): LlmSessionLifecycle {
    return {
      onPhase: (phase) => this.update(taskId, { phase }),
      onFinish: (status) => this.finish(taskId, status),
    };
  }
}

/** 全局 LLM 任务执行器单例 */
export const llmExecutor = new LlmExecutor();

// 注入 LLM 会话查询实现（task-ws 读快照/终态载荷用；此处注入避免模块环）
setLlmSessionLookup((taskId) => sessionManager.get(taskId));
