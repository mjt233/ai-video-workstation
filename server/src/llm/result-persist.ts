/**
 * LLM 会话终态结果落盘（后端独占写）。
 *
 * 会话到达终态时由 session-manager.finish() 调用本模块，直接把
 * config.output（completed 时连同 outputHistory 历史条目）写入画布定义文件：
 * - 读画布定义文件（不存在 → 跳过）；
 * - 校验 nodeId 仍存在于 nodes（节点已删除 → 跳过写盘，仅移除会话）；
 * - completed：config.output = 会话正文；正文非空时追加一条历史版本
 *   （规则见 `canvas/text-history.ts`，与「文本生成」工作流节点共用同一组
 *   字段/上限规则：id / createdAt 生成、input = 快照 userInput（未拼入预设提示词的
 *   用户原始输入；未提供回退发送文本）、output = 正文、modelName/presetName/mediaLabels
 *   取快照、上限 50 裁剪最旧）；
 * - cancelled / failed：config.output = 已累计正文（保持「停止保留部分输出、不存档」
 *   语义；无任何累计正文时跳过写入）；
 * - 写入经共享的 `applyCanvasNodeConfigPatch`（CAS + withPathLock 路径锁 +
 *   VERSION_CONFLICT 重读重试 ≤3 次），最终失败抛出由调用方收敛为 failed
 *   并广播「结果写入画布失败」+ 控制台日志（不静默）。
 *
 * 历史由后端单写者追加：多页签同时打开同一画布也不会产生重复历史条目。
 * 双端历史规则（前端 aiTextHistory.ts / 后端 canvas/text-history.ts）由同组单测覆盖防漂移。
 */

import {
  applyCanvasNodeConfigPatch,
} from '../canvas/canvas-patch.js';
import {
  appendTextHistory,
  createTextHistoryId,
  readTextHistory,
  type TextHistoryEntry,
} from '../canvas/text-history.js';
import type { LlmSession } from './session-manager.js';

/** AI 文本生成节点最多保留的历史版本数（与前端 canvas/aiTextHistory.ts 保持一致，超出丢弃最旧） */
export const MAX_TEXT_HISTORY_VERSIONS = 50;

/** 历史版本条目（字段与前端 AiTextHistoryEntry 完全一致） */
export type LlmTextHistoryEntry = TextHistoryEntry;

/** 终态落盘结果（供会话管理器追加到 finished 广播载荷） */
export interface LlmPersistResult {
  /** 是否写入画布定义文件（false = 跳过：画布文件不存在 / 节点已删除 / 无累计文本可写） */
  wrote: boolean;
  /** 写入成功后的新版本号（rev；前端 adoptExternalChange 的 savedRev 对齐基准） */
  rev?: number;
  /** 写入成功前的画布版本号（rev；前端 savedRev === prevRev 时才采纳补丁的比对基准） */
  prevRev?: number;
  /** 实际写入的 config 补丁（output / outputHistory） */
  patch?: { output?: string; outputHistory?: LlmTextHistoryEntry[] };
}

/**
 * 由会话构造一条新的历史版本（id / createdAt 生成规则与前端 createTextHistoryEntry 一致）。
 * 「当时的输入」取会话快照 `userInput`（未拼入预设提示词的用户原始输入）；
 * 快照未提供时回退 `inputSent`（实际发送文本，兜底兼容旧客户端）。
 *
 * @param session 终态会话（inputSent 与 snapshot 供快照）
 * @param createdAt 生成时间（缺省为当前时间）
 * @returns 新历史版本条目
 */
function buildHistoryEntry(session: LlmSession, createdAt: Date): LlmTextHistoryEntry {
  const entry: LlmTextHistoryEntry = {
    id: createTextHistoryId(createdAt),
    createdAt: createdAt.toISOString(),
    input: session.snapshot.userInput ?? session.inputSent,
    output: session.text,
  };
  if (session.snapshot.modelName) entry.modelName = session.snapshot.modelName;
  if (session.snapshot.presetName) entry.presetName = session.snapshot.presetName;
  if (session.snapshot.mediaLabels && session.snapshot.mediaLabels.length > 0) {
    entry.mediaLabels = [...session.snapshot.mediaLabels];
  }
  return entry;
}

/**
 * 计算终态补丁（按节点 config 现状构造）。
 *
 * @param nodeConfig 读到的节点 config
 * @param session 终态会话
 * @returns 补丁；无法补丁（无累计文本可写）返回 null
 */
function buildPatch(
  nodeConfig: Record<string, unknown>,
  session: LlmSession,
): NonNullable<LlmPersistResult['patch']> | null {
  const text = typeof session.text === 'string' ? session.text : '';
  const patch: NonNullable<LlmPersistResult['patch']> = {};
  if (session.status === 'completed') {
    patch.output = text;
    if (text.trim().length > 0) {
      patch.outputHistory = appendTextHistory(
        readTextHistory(nodeConfig),
        buildHistoryEntry(session, new Date()),
      );
    }
  } else if (text.trim().length > 0) {
    // cancelled / failed：保留部分输出，**不追加历史**（与前端旧行为「停止不存档」语义一致）
    patch.output = text;
  } else {
    return null; // 无累计文本可写
  }
  return patch;
}

/**
 * 终态结果落盘（后端独占写画布定义文件；CAS + 路径锁 + 冲突重试）。
 *
 * @param session 终态会话（status 已由会话管理器置为终态）
 * @returns 落盘结果（wrote / rev / prevRev / patch）；跳过写盘时 wrote=false
 * @throws Error 画布文件损坏或重试 3 次仍冲突（由调用方收敛为 failed 并广播）
 */
export async function persistLlmResult(session: LlmSession): Promise<LlmPersistResult> {
  const result = await applyCanvasNodeConfigPatch<NonNullable<LlmPersistResult['patch']>>(
    session.project,
    session.canvas,
    session.nodeId,
    (_data, nodeConfig) => buildPatch(nodeConfig, session),
  );
  if (!result.wrote) return { wrote: false };
  return {
    wrote: true,
    ...(result.rev !== undefined ? { rev: result.rev } : {}),
    ...(result.prevRev !== undefined ? { prevRev: result.prevRev } : {}),
    ...(result.patch ? { patch: result.patch } : {}),
  };
}
