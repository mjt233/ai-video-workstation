import { register } from '../registry.js';
import type { ImageToVideoVars, WorkflowDefinition } from '../types.js';

/**
 * 图生视频 LTX-2.3 实现（Mock）。
 */
register({
  id: 'image-to-video',
  name: '图生视频 (LTX-2.3)',
  impl: 'ltx',
  description: '使用 LTX-2.3 模型基于首帧图生成视频（Mock）',

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
    if (stageImagePaths.length === 0) {
      throw new Error('image-to-video 缺少分镜场景图 stageImages');
    }

    const stageImages: File[] = [];
    for (const rel of stageImagePaths) {
      stageImages.push(await params.readAssertFile(rel));
    }

    if (!prompt.trim()) {
      throw new Error('image-to-video prompt.md 为空');
    }
    return {
      taskId: `ltx-mock-${Date.now()}-d${durationSec}-w${width}x${height}@${fps}-frames${stageImages.length}`,
    };
  },

  async poll() {
    return { status: 'completed', done: true };
  },

  async parseOutput() {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/video',
      filename: 'video.mp4',
    };
  },
} satisfies WorkflowDefinition<ImageToVideoVars>);
