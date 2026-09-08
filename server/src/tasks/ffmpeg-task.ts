/**
 * ffmpeg 任务统一入口（路由层调用）：登记任务 → 后台执行 → 立即返回 taskId。
 *
 * 由 `routes/canvas.ts` 的四个本地媒体接口（拼接 / 裁剪视频 / 裁剪音频 / 获取视频帧）共用，
 * 避免每个路由重复「登记 + 后台跑 + 错误收敛」逻辑。
 *
 * 注意：本模块**动态 import** `tasks/ffmpeg-executor.js`，避免
 * `tasks/ffmpeg-executor → assets/* → tasks/ffmpeg-executor` 的模块环。
 */

import type { CanvasDefTarget } from '../assets/canvas-def.js';
import type { FfmpegCommandSpec } from '../assets/ffmpeg-command.js';

/** ffmpeg 任务启动参数 */
export interface StartFfmpegTaskInput {
  /** 项目名 */
  project: string;
  /** 发起节点 id（画布恢复定位用；省略则不参与画布恢复） */
  nodeId?: string;
  /** 画布定位（省略则不参与画布 scope 过滤） */
  canvas?: CanvasDefTarget;
  /** 任务展示名（如「拼接视频」） */
  label: string;
  /** 命令构建结果（buildConcatCommand / buildTrimVideoCommand 等） */
  spec: FfmpegCommandSpec;
  /** 附加 payload（合并进 spec.info） */
  payload?: Record<string, unknown>;
}

/**
 * 启动一个 ffmpeg 异步任务。
 *
 * @param input 启动参数
 * @returns 任务 id（客户端用于订阅进度/终态与中断）
 * @throws TaskError 同节点已有活跃任务（NODE_BUSY）或全局上限（TASK_LIMIT）
 */
export async function startFfmpegTask(input: StartFfmpegTaskInput): Promise<string> {
  const { ffmpegExecutor } = await import('./ffmpeg-executor.js');
  const task = ffmpegExecutor.create(
    {
      label: input.label,
      project: input.project,
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(input.canvas ? { canvas: input.canvas } : {}),
      payload: { ...(input.spec.info ?? {}), ...(input.payload ?? {}) },
    },
    {
      outputAbs: input.spec.outputAbs,
      build: input.spec.build,
      ...(typeof input.spec.duration === 'number' ? { duration: input.spec.duration } : {}),
    },
  );
  // 后台执行：终态由执行器收敛并经 WS 广播（路由立即返回 taskId）
  void ffmpegExecutor.run(task.id, {
    outputAbs: input.spec.outputAbs,
    build: input.spec.build,
    ...(typeof input.spec.duration === 'number' ? { duration: input.spec.duration } : {}),
  });
  return task.id;
}
