import { register } from '../registry.js';
import type { VideoGenerateVars, WorkflowDefinition } from '../types.js';

register({
  id: 'video-generate',
  name: '视频生成 (图生视频)',
  impl: 'default',
  description: '基于分镜图片和 prompt 生成视频',

  async submit(params) {
    // 读取 prompt，确保分镜提示词存在
    const prompt = await params.readFile(
      `prompt/scene/${params.vars.episode}/${params.vars.shot}/prompt.md`,
    );
    // 引擎注入：duration / stageImages 路径；分辨率/帧率来自 project.json
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
        `video-generate stageImages 无效: ${params.vars.stageImages}; ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!Number.isInteger(durationSec) || durationSec <= 0) {
      throw new Error(`video-generate 缺少有效 duration（秒）: ${params.vars.duration}`);
    }
    if (!width || !height) {
      throw new Error('video-generate 需要 project.json 中的 width/height');
    }
    if (stageImagePaths.length === 0) {
      throw new Error('video-generate 缺少分镜场景图 stageImages');
    }

    // 与 scene-stage-image 一致：将 assert 路径加载为 File 对象
    const stageImages: File[] = [];
    for (const rel of stageImagePaths) {
      stageImages.push(await params.readAssertFile(rel));
    }

    // Mock：真实适配时将 prompt / stageImages(File[]) / durationSec / width / height / fps 传给视频 API
    if (!prompt.trim()) {
      throw new Error('video-generate prompt.md 为空');
    }
    return {
      taskId: `video-mock-${Date.now()}-d${durationSec}-w${width}x${height}@${fps}-frames${stageImages.length}`,
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
  }
} satisfies WorkflowDefinition<VideoGenerateVars>);
