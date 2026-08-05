import { register } from '../registry.js';
import { createComfyuiBridgeWorkflow, submitReferenceVideo } from '../bridge-client.js';
import type { ImageToVideoVars, VideoReferenceCapability } from '../types.js';

/** minimax-h3-r2v 参考模式限制 */
const REF_CAP: VideoReferenceCapability = {
  types: {
    image: { max: 9 },
    video: { max: 3, minDuration: 2, maxDuration: 15 },
    audio: { max: 3, minDuration: 2, maxDuration: 15 },
  },
  maxTotal: 12,
  audioRequiresVisual: true,
};

/**
 * 图生视频实现（ComfyUI Bridge，minimax-h3-r2v 参考模式）。
 *
 * 只消费引擎注入的自包含提交数据（ctx.video，mode=reference），
 * 将有序图片/视频/音频参考按类型序号映射为动态文件键提交。
 */
register(
  createComfyuiBridgeWorkflow<ImageToVideoVars>({
    baseDefinition: {
      id: 'image-to-video',
      name: 'MiniMax H2V',
      impl: 'minimax-h3-r2v',
      description: '参考模式：支持图片/视频/音频参考素材生成视频',
      capabilities: {
        video: { modes: ['reference'], maxDuration: 15, reference: REF_CAP },
        cancelable: true,
      },
    },

    async submit(ctx) {
      const video = ctx.video;
      if (!video) {
        throw new Error('image-to-video 需要引擎注入 ctx.video');
      }
      if (video.mode !== 'reference') {
        throw new Error(`minimax-h3-r2v 仅支持参考模式，当前: ${video.mode}`);
      }
      const refs = video.references ?? [];
      if (refs.length < 1) {
        throw new Error('minimax-h3-r2v 参考模式需要至少 1 个参考素材');
      }
      if (refs.length > REF_CAP.maxTotal) {
        throw new Error(`参考素材总数量超过上限（${REF_CAP.maxTotal}）`);
      }
      const imageRefs: File[] = [];
      const videoRefs: File[] = [];
      const audioRefs: File[] = [];
      for (const r of refs) {
        if (r.type === 'image') imageRefs.push(r.file);
        else if (r.type === 'video') videoRefs.push(r.file);
        else audioRefs.push(r.file);
      }
      if (imageRefs.length > (REF_CAP.types.image?.max ?? 0)) {
        throw new Error(`图片参考数量超过上限（${REF_CAP.types.image?.max}）`);
      }
      if (videoRefs.length > (REF_CAP.types.video?.max ?? 0)) {
        throw new Error(`视频参考数量超过上限（${REF_CAP.types.video?.max}）`);
      }
      if (audioRefs.length > (REF_CAP.types.audio?.max ?? 0)) {
        throw new Error(`音频参考数量超过上限（${REF_CAP.types.audio?.max}）`);
      }
      if (REF_CAP.audioRequiresVisual && audioRefs.length > 0 && imageRefs.length === 0 && videoRefs.length === 0) {
        throw new Error('音频参考必须与图片或视频参考一同输入，不能作为唯一输入');
      }

      const result = await submitReferenceVideo({
        prompt: video.prompt,
        width: video.resolution.width,
        height: video.resolution.height,
        duration: video.duration,
        seed: video.seed != null ? Number(video.seed) : undefined,
        imageRefs,
        videoRefs,
        audioRefs,
      });
      return { taskId: result.taskId };
    },
  }),
);
