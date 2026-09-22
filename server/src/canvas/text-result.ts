/**
 * 工作流「文本生成」结果的画布落盘。
 *
 * 文本生成工作流的产物是**纯文本**（无 assert/ 媒体文件）：
 * - 任务成功提交请求时画布节点提交了 `params.nodeId` + `params.canvas`（画布定位），
 *   引擎在产物阶段调用本模块把文本写回节点 `config.output`；
 * - 同时追加一条 `config.outputHistory` 文本历史版本（规则见 `canvas/text-history.ts`），
 *   与 AI 文本生成节点的历史**共用同一组上限/字段规则**（前端同一对话框展示）；
 * - 并发正确性（CAS + 路径锁 + 版本冲突重试）复用 `canvas/canvas-patch.ts`，
 *   与 LLM 会话落盘完全一致。
 *
 * **跳过语义不是错误**：画布文件不存在 / 节点已删除（< > 用户关掉了画布或删了节点）时
 * 返回 `wrote=false`，文本仍会写进任务 `result`，由前端自行决定是否提示。
 */

import {
  applyCanvasNodeConfigPatch,
  type CanvasNodePatchResult,
} from './canvas-patch.js';
import type { CanvasDefTarget } from '../assets/canvas-def.js';
import {
  appendTextHistory,
  createTextHistoryId,
  readTextHistory,
  type TextHistoryEntry,
} from './text-history.js';

/** 文本结果落盘结果（patch 恒定携带 output 与 outputHistory） */
export type TextResultPersistResult = CanvasNodePatchResult<TextResultPatch> & {
  /** 写入成功时的 config 补丁 */
  patch?: TextResultPatch;
};

/** 写入节点 config 的补丁（output = 当前文本；outputHistory = 追加后的历史） */
export interface TextResultPatch {
  /** 本次生成的文本（节点当前结果） */
  output: string;
  /** 追加后的文本历史版本（末尾为最新） */
  outputHistory: TextHistoryEntry[];
}

/** 文本产物落盘入参 */
export interface PersistTextResultOptions {
  /** 项目名 */
  project: string;
  /** 画布定位（任务 params.canvas；缺省时跳过写盘） */
  canvas?: CanvasDefTarget;
  /** 发起节点 id（任务 params.nodeId；缺省时跳过写盘） */
  nodeId?: string;
  /** 生成的文本内容（非空；调用方已保证） */
  text: string;
  /** 该次生成的输入快照（画布节点 = 提示词） */
  input: string;
  /** 生成时连接的媒体输入展示名列表（进历史条目展示） */
  mediaLabels?: string[];
  /** 生成时使用的工作流展示名（进历史条目展示） */
  modelName?: string;
  /** 生成时间（缺省为当前时间；测试可注入） */
  createdAt?: Date;
}

/**
 * 把文本生成结果写入画布节点（`config.output` + `config.outputHistory`）。
 *
 * @param opts 落盘入参
 * @returns 写入结果（`wrote=false` 表示跳过：无画布定位/节点 id、画布不存在或节点已删除）
 * @throws Error 画布文件损坏或版本冲突重试耗尽（调用方收敛为任务失败并广播原因）
 */
export async function persistTextResult(
  opts: PersistTextResultOptions,
): Promise<TextResultPersistResult> {
  const { project, canvas, nodeId } = opts;
  if (!canvas || !nodeId) return { wrote: false };
  const now = opts.createdAt ?? new Date();
  return applyCanvasNodeConfigPatch<TextResultPatch>(project, canvas, nodeId, (_data, nodeConfig) => {
    const entry: TextHistoryEntry = {
      id: createTextHistoryId(now),
      createdAt: now.toISOString(),
      input: opts.input,
      output: opts.text,
      ...(opts.modelName ? { modelName: opts.modelName } : {}),
      ...(opts.mediaLabels && opts.mediaLabels.length > 0
        ? { mediaLabels: [...opts.mediaLabels] }
        : {}),
    };
    return {
      output: opts.text,
      outputHistory: appendTextHistory(readTextHistory(nodeConfig), entry),
    };
  });
}
