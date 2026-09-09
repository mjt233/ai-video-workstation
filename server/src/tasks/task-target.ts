/**
 * 任务画布定位解析（请求体 → `{ nodeId, canvas }`）。
 *
 * 异步任务（ffmpeg / 工作流）随提交请求携带「发起节点 + 画布定位」，登记进统一任务注册表后
 * 供两处消费：
 * 1. 任务管理器展示任务来自哪个项目/画布/节点；
 * 2. 画布加载 / 切换目标后按「项目 + 画布 scope + 节点仍在画布上」恢复节点 Loading。
 *
 * 定位信息是**辅助元数据**（缺失只影响恢复，不影响任务本身），因此本模块只做宽松解析：
 * 结构不合法（kind 未知、必填字段缺失/非字符串）时丢弃该字段而不是抛错，避免因元数据
 * 问题拒绝一次真实生成请求。
 */

import type { CanvasDefTarget } from '../assets/canvas-def.js';

/** 任务画布定位（两者均可缺省；缺省字段不参与画布恢复过滤） */
export interface TaskCanvasTarget {
  /** 发起节点 id（画布恢复时按节点定位） */
  nodeId?: string;
  /** 画布定位（分镜画布 episode/shot、场景画布 stage/label） */
  canvas?: CanvasDefTarget;
}

/**
 * 从请求体（或任务 params）提取任务画布定位。
 *
 * @param raw 待解析对象（请求体 / 已入库的任务 params；可为 undefined）
 * @returns 含 nodeId/canvas 的定位（字段缺失或非法时省略该字段）
 */
export function parseTaskTarget(raw: unknown): TaskCanvasTarget {
  const b = (raw ?? {}) as { nodeId?: unknown; canvas?: unknown };
  const out: TaskCanvasTarget = {};
  if (typeof b.nodeId === 'string' && b.nodeId) out.nodeId = b.nodeId;
  const c = b.canvas;
  if (c && typeof c === 'object') {
    const canvas = c as Record<string, unknown>;
    const kind = canvas.kind === 'scene' || canvas.kind === 'stage' ? canvas.kind : '';
    if (kind === 'scene' && typeof canvas.episode === 'string' && typeof canvas.shot === 'string') {
      out.canvas = { kind, episode: canvas.episode, shot: canvas.shot };
    } else if (kind === 'stage' && typeof canvas.stage === 'string' && typeof canvas.label === 'string') {
      out.canvas = { kind, stage: canvas.stage, label: canvas.label };
    }
  }
  return out;
}
