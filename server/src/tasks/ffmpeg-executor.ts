/**
 * ffmpeg 任务执行器（统一异步任务架构中唯一「完整实现」门面的执行器）。
 *
 * 三个本地 ffmpeg 操作（拼接视频 / 裁剪视频 / 获取视频帧）共享完全相同的生命周期：
 * 登记任务 → spawn 子进程 → 解析 `-progress` 上报进度 → 终态收敛（成功/失败/中断），
 * 因此统一由本执行器承载（见 `docs/plans/2026-09-09-unified-async-task-manager.md` §6.4）。
 *
 * 中断语义为**真中断**：kill 子进程 + 删除半截产物（保留上一次成功结果），
 * 避免白耗 CPU 与用破损文件覆盖既有产物。
 */

import fs from 'fs/promises';
import Ffmpeg from 'fluent-ffmpeg';
import { taskRegistry, type TaskRecord } from './registry.js';
import { createTaskHandle, type TaskExecutor, type TaskMeta } from './executor.js';

/** ffmpeg 任务执行参数 */
export interface FfmpegTaskParams {
  /** 产物绝对路径（固定产物 output.{ext} 的绝对路径；中断时用于删除半截产物） */
  outputAbs: string;
  /**
   * 命令构建器：接收 fluent-ffmpeg 命令实例，由调用方挂载输入/滤镜/输出选项。
   * 不在此处调用 `save()`（由执行器统一保存并接管事件）。
   *
   * @param cmd fluent-ffmpeg 命令实例
   */
  build: (cmd: Ffmpeg.FfmpegCommand) => void;
  /** 预期总时长（秒；> 0 时用于计算进度百分比，缺省则进度为不确定） */
  duration?: number;
  /** 中断时是否删除产物（缺省 true：删除半截文件，保留上一次成功结果） */
  removeOnCancel?: boolean;
}

/** ffmpeg 运行态句柄（按任务 id 索引） */
interface RunningFfmpeg {
  /** fluent-ffmpeg 命令实例（kill 用） */
  command: Ffmpeg.FfmpegCommand;
  /** 已请求中断（区分「中断导致的失败」与「真实编码错误」） */
  cancelRequested: boolean;
  /** 产物绝对路径（中断清理用） */
  outputAbs: string;
  /** 中断时是否删除产物 */
  removeOnCancel: boolean;
}

/**
 * 解析 ffmpeg 的 `timemark`（HH:MM:SS.xx）为秒数。
 *
 * @param timemark fluent-ffmpeg 进度事件的 timemark 字段
 * @returns 秒数；无法解析返回 null
 */
export function parseTimemarkSeconds(timemark: string | undefined): number | null {
  if (typeof timemark !== 'string' || timemark === '') return null;
  const m = timemark.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  return h * 3600 + min * 60 + sec;
}

/**
 * 计算进度百分比。
 *
 * @param currentSeconds 当前处理到的时间（秒）
 * @param totalSeconds 预期总时长（秒；<= 0 时无法计算）
 * @returns 0~100 的整数；无法计算返回 null（UI 显示不确定进度）
 */
export function computeProgressPercent(currentSeconds: number | null, totalSeconds: number | undefined): number | null {
  if (currentSeconds === null || typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return null;
  }
  const pct = Math.floor((currentSeconds / totalSeconds) * 100);
  return Math.max(0, Math.min(99, pct));
}

/** ffmpeg 任务执行器（进程注册表按任务 id 索引） */
class FfmpegExecutor implements TaskExecutor<FfmpegTaskParams> {
  /** 任务类型 */
  readonly type = 'ffmpeg' as const;
  /** 运行中的 ffmpeg 进程（taskId → 句柄） */
  private readonly running = new Map<string, RunningFfmpeg>();

  /**
   * 登记 ffmpeg 任务（中断句柄指向本执行器）。
   *
   * @param meta 登记元信息
   * @param _params 执行参数（登记阶段未使用；执行参数在 run() 时传入）
   * @returns 任务记录
   */
  create(meta: TaskMeta, _params: FfmpegTaskParams): TaskRecord {
    let taskId = '';
    const task = taskRegistry.register({
      ...meta,
      type: this.type,
      progress: 0,
      handle: createTaskHandle(() => {
        this.cancel(taskId);
      }),
    });
    taskId = task.id;
    return task;
  }

  /**
   * 启动 ffmpeg 执行：解析进度、收集错误输出、终态收敛（成功/失败/中断）。
   *
   * @param taskId 任务 id
   * @param params 执行参数
   */
  async run(taskId: string, params: FfmpegTaskParams): Promise<void> {
    if (!taskRegistry.get(taskId)) return;
    const cmd = Ffmpeg();
    params.build(cmd);

    const state: RunningFfmpeg = {
      command: cmd,
      cancelRequested: false,
      outputAbs: params.outputAbs,
      removeOnCancel: params.removeOnCancel !== false,
    };
    this.running.set(taskId, state);

    /** stderr 尾部（失败时提取错误信息） */
    let stderrTail = '';
    cmd.on('stderr', (line: string) => {
      stderrTail = `${stderrTail}\n${line}`.slice(-4000);
    });
    cmd.on('progress', (p: { timemark?: string; percent?: number }) => {
      const pct = computeProgressPercent(parseTimemarkSeconds(p.timemark), params.duration);
      if (pct !== null) taskRegistry.update(taskId, { progress: pct });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        cmd
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(err))
          .save(params.outputAbs);
      });
      this.running.delete(taskId);
      taskRegistry.finish(taskId, { status: 'completed' });
    } catch (e) {
      this.running.delete(taskId);
      if (state.cancelRequested) {
        // 中断路径：产物已在 cancel() 中清理，按 cancelled 收敛（不报错）
        taskRegistry.finish(taskId, { status: 'cancelled' });
        return;
      }
      const detail = extractFfmpegError(e, stderrTail);
      console.error(`[ffmpeg-task] 任务失败（${taskId}）: ${detail}`);
      taskRegistry.finish(taskId, { status: 'failed', error: detail });
    }
  }

  /**
   * 中断 ffmpeg 任务：标记取消 → kill 子进程 → 删除半截产物。
   *
   * @param taskId 任务 id
   * @returns 是否已受理（任务不在本执行器中返回 false）
   */
  cancel(taskId: string): boolean {
    const state = this.running.get(taskId);
    if (!state) return false;
    state.cancelRequested = true;
    try {
      state.command.kill('SIGKILL');
    } catch (e) {
      console.error(`[ffmpeg-task] kill 子进程失败（${taskId}）: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (state.removeOnCancel) {
      // 删除半截产物：失败仅告警（不阻断中断收敛；产物目录保留上一次成功结果）
      void fs.unlink(state.outputAbs).catch((e: unknown) => {
        console.warn(
          `[ffmpeg-task] 清理半截产物失败（${taskId}）: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }
    return true;
  }
}

/**
 * 提取 ffmpeg 失败信息（错误消息 + stderr 尾部最后一条有效行）。
 *
 * @param err 捕获的异常
 * @param stderrTail 已收集的 stderr 尾部文本
 * @returns 中文可读的错误说明
 */
export function extractFfmpegError(err: unknown, stderrTail: string): string {
  const lines = stderrTail
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const last = lines.length > 0 ? lines[lines.length - 1] : '';
  const base = err instanceof Error ? err.message : String(err);
  if (last && !base.includes(last)) return `${base}（${last}）`;
  return base;
}

/** 全局 ffmpeg 任务执行器单例 */
export const ffmpegExecutor = new FfmpegExecutor();
