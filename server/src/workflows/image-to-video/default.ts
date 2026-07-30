import { register } from '../registry.js';
import { createComfyuiBridgeWorkflow, submitImageToVideo } from '../bridge-client.js';
import type { ImageToVideoVars } from '../types.js';

/**
 * 图生视频实现（通过 ComfyUI Bridge）。
 *
 * 根据分镜场景图数量自动选择工作流：
 * - 2 张 → FL2V（首尾帧插值）
 * - 3 张 → FML2V（首中尾帧插值，中间帧位置 0.5）
 * 自动生成音频。
 */
register(
  createComfyuiBridgeWorkflow<ImageToVideoVars>({
    baseDefinition: {
      id: 'image-to-video',
      name: 'LTX-2.3',
      impl: 'ltx',
      description: '使用 FL2V / FML2V 模型基于参考帧图生成视频',
    },

    async submit(params) {
      const prompt = await params.readFile(
        `prompt/scene/${params.vars.episode}/${params.vars.shot}/prompt.md`,
      );
      const durationSec = Number(params.vars.duration);
      const width = params.projectConfig.width;
      const height = params.projectConfig.height;
      const fps = params.projectConfig.fps ?? 24;

      let stageImagePaths: string[] = [];
      try {
        const parsed = JSON.parse(params.vars.stageImages ?? '[]') as unknown;
        if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) {
          throw new Error('stageImages 须为字符串数组');
        }
        stageImagePaths = parsed;
      } catch (e) {
        throw new Error(
          `image-to-video stageImages 无效: ${params.vars.stageImages}; ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      if (!Number.isInteger(durationSec) || durationSec <= 0) {
        throw new Error(`image-to-video 缺少有效 duration（秒）: ${params.vars.duration}`);
      }
      if (!width || !height) {
        throw new Error('image-to-video 需要 project.json 中的 width/height');
      }
      if (stageImagePaths.length < 1 || stageImagePaths.length > 3) {
        throw new Error('image-to-video 仅支持 1~3 帧参考图');
      }
      if (!prompt.trim()) {
        throw new Error('image-to-video prompt.md 为空');
      }

      const frames = await Promise.all(
        stageImagePaths.map((p) => params.readAssertFile(p)),
      );

      const result = await submitImageToVideo({
        prompt,
        width,
        height,
        duration: durationSec,
        fps,
        seed: params.vars.seed ? Number(params.vars.seed) : undefined,
        frames,
      });

      return { taskId: result.taskId };
    },
  }),
);
