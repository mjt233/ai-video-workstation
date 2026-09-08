/**
 * LLM 会话查询桥（打破模块环）。
 *
 * `task-ws.ts` 需要按 taskId 读取 LLM 会话（订阅快照 / 终态载荷），但直接 import
 * `llm/session-manager.ts` 会形成环（session-manager → tasks/registry ← task-ws）。
 * 本桥由 `tasks/llm-executor.ts` 在模块加载时注入查询实现，读侧只依赖本文件。
 */

import type { LlmSession } from '../llm/session-manager.js';

/** LLM 会话查询实现（由 llm-executor 注入） */
type LlmSessionLookup = (taskId: string) => LlmSession | undefined;

/** 当前注入的查询实现（未注入时返回 undefined，即「无会话」） */
let lookup: LlmSessionLookup | null = null;

/**
 * 注入 LLM 会话查询实现（仅 `tasks/llm-executor.ts` 调用一次）。
 *
 * @param fn 查询函数（taskId → 会话或 undefined）
 */
export function setLlmSessionLookup(fn: LlmSessionLookup): void {
  lookup = fn;
}

/**
 * 按 taskId 查询活跃 LLM 会话。
 *
 * @param taskId 会话/任务 id
 * @returns 会话或 undefined（不存在、已终态、或尚未注入实现）
 */
export function llmSessionLookup(taskId: string): LlmSession | undefined {
  return lookup ? lookup(taskId) : undefined;
}
