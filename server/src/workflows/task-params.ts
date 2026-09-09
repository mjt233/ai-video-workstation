/**
 * 工作流任务参数解析（纯函数，独立模块）。
 *
 * 从 `routes/workflow.ts` 抽出：`tasks/workflow-executor.ts` 需要读取远端任务 id，
 * 若直接 import 路由模块会形成 `routes/workflow → tasks/workflow-executor → routes/workflow` 模块环。
 */

import type { TaskRecord } from '../db.js';
import type { CanvasDefTarget } from '../assets/canvas-def.js';
import type { VideoWorkflowSubmitParams, WorkflowSizeConfig } from './types.js';

/** 工作流任务 params 解析结果 */
export interface ParsedTaskParams {
  /** 业务变量（key → 值） */
  vars: Record<string, string>;
  /** 提示词文件路径列表 */
  promptPaths: string[];
  /** 产物相对路径 */
  outputPath: string;
  /** 视频自包含提交参数（画布【生成视频】节点） */
  video?: VideoWorkflowSubmitParams;
  /** 统一尺寸配置（用户选择的原始完整尺寸，可选） */
  sizeConfig?: WorkflowSizeConfig;
  /** 本次执行的 Easy Bridge 提供商实例 ID（可选，仅 comfyui-bridge 工作流） */
  comfyuiProviderId?: string;
  /** 提交成功后持久化的远端（Bridge）任务 ID，供中断使用 */
  remoteTaskId?: string;
  /** 发起节点 id（画布节点提交时持久化；画布恢复 Loading 用） */
  nodeId?: string;
  /** 画布定位（画布节点提交时持久化；画布恢复 Loading 用） */
  canvas?: CanvasDefTarget;
}

/**
 * 解析任务 params（JSON 字符串）为结构化对象。
 *
 * @param paramsJson 任务 params 的 JSON 字符串
 * @returns 结构化参数；非法 JSON 时回退空结构（任务详情展示容错，不阻断接口）
 */
export function parseTaskParams(paramsJson: string): ParsedTaskParams {
  try {
    const parsed = JSON.parse(paramsJson) as {
      vars?: Record<string, string>;
      promptPaths?: string[];
      outputPath?: string;
      video?: VideoWorkflowSubmitParams;
      sizeConfig?: WorkflowSizeConfig;
      comfyuiProviderId?: string;
      remoteTaskId?: string;
      nodeId?: string;
      canvas?: CanvasDefTarget;
    };
    return {
      vars: parsed.vars ?? {},
      promptPaths: parsed.promptPaths ?? [],
      outputPath: parsed.outputPath ?? '',
      video: parsed.video,
      sizeConfig: parsed.sizeConfig,
      comfyuiProviderId: parsed.comfyuiProviderId,
      remoteTaskId: parsed.remoteTaskId,
      nodeId: parsed.nodeId,
      canvas: parsed.canvas,
    };
  } catch {
    // 任务 params 非法 JSON 时回退空结构（任务详情展示容错，不阻断接口）
    return { vars: {}, promptPaths: [], outputPath: '' };
  }
}

/**
 * 从任务记录解析远端（Bridge）任务 ID。
 *
 * @param task 任务记录
 * @returns 远端任务 id；未提交时返回 undefined
 */
export function getRemoteTaskId(task: TaskRecord): string | undefined {
  return parseTaskParams(task.params).remoteTaskId;
}
