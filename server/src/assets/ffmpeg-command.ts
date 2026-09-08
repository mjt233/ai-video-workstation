/**
 * ffmpeg 命令构建结果（各媒体处理模块的「探测 + 校验 + 参数装配」统一产物）。
 *
 * 拆出独立模块的原因：`assets/*.ts` 与 `tasks/ffmpeg-executor.ts` 都需要这个类型，
 * 放在任一侧都会造成不必要的依赖方向（assets → tasks 或反向）。
 */

import type Ffmpeg from 'fluent-ffmpeg';

/** ffmpeg 命令构建结果（与 `tasks/ffmpeg-executor.ts` 的 FfmpegTaskParams 对齐） */
export interface FfmpegCommandSpec {
  /** 产物绝对路径（中断时删除半截产物用） */
  outputAbs: string;
  /**
   * 命令构建器：给 fluent-ffmpeg 命令挂载输入/滤镜/输出选项（**不调用 save**，
   * 由执行方统一 save 并接管事件，保证进度与中断可用）。
   *
   * @param cmd fluent-ffmpeg 命令实例
   * @returns 同一命令实例（便于链式调用）
   */
  build: (cmd: Ffmpeg.FfmpegCommand) => Ffmpeg.FfmpegCommand;
  /** 预期总时长（秒；> 0 时用于计算进度百分比） */
  duration?: number;
  /** 附加信息（任务 payload 展示用，如拼接模式与输出尺寸） */
  info?: Record<string, unknown>;
}
