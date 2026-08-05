import { register } from '../registry.js';
import {
  createComfyuiBridgeWorkflow,
  submitImageToVideo,
  submitLtxDirectorImageToVideo,
} from '../bridge-client.js';
import type { ImageToVideoVars } from '../types.js';

/**
 * 图生视频实现（通过 ComfyUI Bridge，ltx）。
 *
 * 本实现只消费引擎注入的自包含提交数据（ctx.video），不再读取任何分镜文件：
 * - mode=director → submitLtxDirectorImageToVideo（ltx-2.3-director，关键帧 + 混音音频）
 * - mode=first-last-frame → submitImageToVideo（I2V / FL2V / FML2V，按帧数自动选择）
 *
 * 分镜/批量路径的数据读取由引擎的场景适配层（scene-adapter.ts）完成。
 */
register(
  createComfyuiBridgeWorkflow<ImageToVideoVars>({
    baseDefinition: {
      id: 'image-to-video',
      name: 'LTX-2.3',
      impl: 'ltx',
      description: '使用 FL2V / FML2V 模型基于参考帧图生成视频',
      capabilities: { video: { modes: ['director', 'first-last-frame'], audio: true, maxDuration: 15 }, cancelable: true },
    },

    async submit(ctx) {
      const video = ctx.video;
      if (!video) {
        throw new Error('image-to-video 需要引擎注入 ctx.video（自包含提交数据）');
      }

      const seed = video.seed != null ? Number(video.seed) : undefined;

      // ── 导演台模式 ──
      if (video.mode === 'director') {
        if (!video.director || video.director.frames.length < 1) {
          throw new Error('image-to-video 导演台模式需要 director.frames');
        }
        const result = await submitLtxDirectorImageToVideo({
          prompt: video.prompt,
          width: video.resolution.width,
          height: video.resolution.height,
          duration: video.duration,
          fps: video.fps ?? 24,
          seed,
          frames: video.director.frames.map((f) => ({ file: f.file, cursor: f.cursor })),
          ...(video.director.audio ? { audio: video.director.audio } : {}),
        });
        return { taskId: result.taskId };
      }

      // ── 首尾帧模式 ──
      if (video.mode === 'first-last-frame') {
        if (!video.director || video.director.frames.length < 1 || video.director.frames.length > 3) {
          throw new Error('image-to-video 首尾帧模式需要 1~3 帧参考图');
        }
        const result = await submitImageToVideo({
          prompt: video.prompt,
          width: video.resolution.width,
          height: video.resolution.height,
          duration: video.duration,
          fps: video.fps ?? 24,
          seed,
          frames: video.director.frames.map((f) => f.file),
          ...(video.director.audio ? { audio: video.director.audio } : {}),
        });
        return { taskId: result.taskId };
      }

      throw new Error(`image-to-video/ltx 不支持生成模式: ${video.mode}`);
    },
  }),
);
