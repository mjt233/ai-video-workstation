import { register } from '../registry.js';
import {
  createComfyuiBridgeWorkflow,
  submitImageToVideo,
  submitComfyuiBridge,
  pollTask,
  buildDownloadRequest,
} from '../bridge-client.js';
import type { ImageToVideoVars } from '../types.js';

/**
 * 图生视频实现（通过 ComfyUI Bridge）。
 *
 * 根据分镜场景图数量自动选择工作流：
 * - 2 张 → FL2V（首尾帧插值）
 * - 3 张 → FML2V（首中尾帧插值，中间帧位置 0.5）
 *
 * 音频处理策略：
 * 1. 用户已进行【分镜音频编辑】并合并 → 使用 merged.flac
 * 2. 有台词但未编辑音频 → 拼接所有台词文本，调用 TTS 生成音频
 * 3. 无台词 → 不提交音频
 */
register(
  createComfyuiBridgeWorkflow<ImageToVideoVars>({
    baseDefinition: {
      id: 'image-to-video',
      name: 'LTX-2.3',
      impl: 'ltx',
      description: '使用 FL2V / FML2V 模型基于参考帧图生成视频',
    },

    async submit(ctx) {
      const episode = ctx.vars.episode;
      const shot = ctx.vars.shot;
      const prompt = await ctx.readFile(
        `prompt/scene/${episode}/${shot}/prompt.md`,
      );
      const durationSec = Number(ctx.vars.duration);
      const width = ctx.projectConfig.width;
      const height = ctx.projectConfig.height;
      const fps = ctx.projectConfig.fps ?? 24;

      let stageImagePaths: string[] = [];
      try {
        const parsed = JSON.parse(ctx.vars.stageImages ?? '[]') as unknown;
        if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) {
          throw new Error('stageImages 须为字符串数组');
        }
        stageImagePaths = parsed;
      } catch (e) {
        throw new Error(
          `image-to-video stageImages 无效: ${ctx.vars.stageImages}; ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      if (!Number.isInteger(durationSec) || durationSec <= 0) {
        throw new Error(`image-to-video 缺少有效 duration（秒）: ${ctx.vars.duration}`);
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
        stageImagePaths.map((p) => ctx.readAssertFile(p)),
      );

      // ── 处理音频 ──
      let audio: File | undefined;

      // 策略 1：优先使用用户编辑并合并的音频
      if (ctx.vars.audioPath) {
        audio = await ctx.readAssertFile(ctx.vars.audioPath);
      } else {
        // 策略 2：有台词但未编辑音频 → 拼接台词文本后调用 TTS 生成
        try {
          const scriptRaw = await ctx.readFile(
            `prompt/scene/${episode}/${shot}/script.json`,
          );
          const script = JSON.parse(scriptRaw) as Array<{
            角色名?: string;
            台词?: string;
          }>;
          if (Array.isArray(script) && script.length > 0) {
            const texts = script
              .map((l) => (l.台词 ?? '').trim())
              .filter(Boolean);
            if (texts.length > 0) {
              const combinedText = texts.join('。') + '。';

              // 尝试取第一个角色的声线描述，否则使用默认描述
              const firstChar = script.find(
                (l) => (l.角色名 ?? '').trim(),
              );
              let desc: string;
              if (firstChar?.角色名) {
                try {
                  const voiceMd = await ctx.readFile(
                    `prompt/character/${firstChar.角色名.trim()}/voice.md`,
                  );
                  desc =
                    voiceMd.trim() ||
                    '自然、清晰的中文女声，语速适中，情感平和。';
                } catch {
                  desc = '自然、清晰的中文女声，语速适中，情感平和。';
                }
              } else {
                desc = '自然、清晰的中文女声，语速适中，情感平和。';
              }

              // 调用桥接 TTS 生成音频
              const ttsResult = await submitComfyuiBridge({
                workflowId: 'tts_voice_design',
                params: { desc, text: combinedText },
              });

              // 轮询等待 TTS 完成
              let ttsOk = false;
              while (true) {
                await new Promise((r) => setTimeout(r, 1000));
                const ttsStatus = await pollTask(ttsResult.taskId);
                if (ttsStatus.status === 'completed') {
                  ttsOk = true;
                  break;
                }
                if (ttsStatus.status === 'failed') {
                  console.warn(
                    `TTS 生成失败，跳过音频: ${ttsStatus.errorMessage}`,
                  );
                  break;
                }
              }

              // 下载生成的音频
              if (ttsOk) {
                const download = await buildDownloadRequest(
                  ttsResult.taskId,
                );
                if (download) {
                  const resp = await fetch(download.url, {
                    headers: download.headers,
                  });
                  const blob = await resp.blob();
                  audio = new File(
                    [blob],
                    'voice-combined.flac',
                    { type: 'audio/flac' },
                  );
                }
              }
            }
          }
        } catch {
          // script.json 不存在或无效 → 没有台词，不生成音频
        }
      }

      const result = await submitImageToVideo({
        prompt,
        width,
        height,
        duration: durationSec,
        fps,
        seed: ctx.vars.seed ? Number(ctx.vars.seed) : undefined,
        frames,
        ...(audio ? { audio } : {}),
      });

      return { taskId: result.taskId };
    },
  }),
);
