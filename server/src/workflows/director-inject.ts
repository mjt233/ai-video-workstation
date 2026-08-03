import os from 'os';
import path from 'path';
import { parseDirectorJson, computeFrameDefines } from '../assets/director.js';
import type { MixTrack } from '../assets/audio-mix.js';
import type { DirectorPayload } from './types.js';

/**
 * 导演台注入依赖集合。
 *
 * 由工作流引擎（workflow-engine.ts）在运行任务时注入，`buildDirectorPayload`
 * 通过本接口读取导演台配置、关键帧图片并混音音频，不直接触碰文件系统，
 * 便于单元测试使用 mock 依赖（避免真实文件读写与 ffmpeg 调用）。
 */
export interface DirectorInjectDeps {
  /** 读取项目内文本文件（UTF-8），路径相对 design/{project}/，如 prompt/scene/1/1/director.json */
  readFile(rel: string): Promise<string>;
  /** 读取项目 assert/ 下的二进制文件为 File 对象；路径须以 assert/ 开头，相对 design/{project}/ */
  readAssertFile(rel: string): Promise<File>;
  /**
   * 将多条音频轨道混音为单个音频文件。
   *
   * 轨道（MixTrack）的 filePath 为 director.json 中填写的项目相对路径
   * （相对 design/{project}/），由注入方（引擎）负责解析为绝对路径后再交给
   * ffmpeg 执行，本模块不做文件系统解析。
   *
   * @param tracks 待混音的轨道列表（filePath 为项目相对路径）
   * @param out 混音结果输出文件路径（绝对路径，位于 os.tmpdir()）
   */
  mixAudioTracks(tracks: MixTrack[], out: string): Promise<void>;
  /** 读取混音产物临时文件为二进制内容（Uint8Array） */
  readTempAudio(p: string): Promise<Uint8Array>;
}

/**
 * 构建导演台执行负载（DirectorPayload）。
 *
 * 由引擎在图像生成视频（image-to-video）任务中调用：当所选实现声明
 * `capabilities.director` 且分镜目录存在 `prompt/scene/{ep}/{shot}/director.json`
 * 时，将导演台配置解析为视频生成所需的关键帧序列（frames）与混音音频（audio）。
 *
 * 处理流程：
 * 1. 读取 `prompt/scene/{ep}/{shot}/director.json`；读取失败（文件不存在等）
 *    时 `console.warn` 提示并返回 null，交由普通图生视频路径兜底；
 * 2. 用 `parseDirectorJson` 防御性解析；`imageClips` 为空（无关键帧）时返回 null；
 * 3. 用 `computeFrameDefines` 按 startOffset 升序生成关键帧定义，逐个
 *    `readAssertFile` 读取图片得到 `frames`（frameSeq 从 0 递增，cursor 钳制 0~1）；
 * 4. `audioClips` 非空时：在 `os.tmpdir()` 生成临时输出路径 → 组装 MixTrack
 *    列表（filePath 为项目相对路径）→ `mixAudioTracks` 混音 → `readTempAudio`
 *    读取产物 → 包装为 `File('director-audio.flac')` 注入 `audio`；
 * 5. 返回 `{ duration, width, height, fps, frames, audio? }`，其中
 *    duration/width/height/fps 以 director.json 为准（覆盖 overview.json / projectConfig）。
 *
 * @param project 项目名（design 下子目录）
 * @param episode 集数
 * @param shot 分镜编号
 * @param deps 依赖集合（见 {@link DirectorInjectDeps}）
 * @returns 导演台执行负载；导演台配置缺失或无效时返回 null
 */
export async function buildDirectorPayload(
  project: string,
  episode: string,
  shot: string,
  deps: DirectorInjectDeps,
): Promise<DirectorPayload | null> {
  const directorRel = `prompt/scene/${episode}/${shot}/director.json`;
  let raw: string;
  try {
    raw = await deps.readFile(directorRel);
  } catch {
    console.warn(
      `未找到导演台配置 ${directorRel}（${project}/${episode}/${shot}），跳过导演台注入`,
    );
    return null;
  }

  const config = parseDirectorJson(raw);
  if (config.imageClips.length < 1) {
    return null;
  }

  const frames = await Promise.all(
    computeFrameDefines(config.imageClips, config.duration).map(async (def) => ({
      file: await deps.readAssertFile(def.path),
      frameSeq: def.frameSeq,
      cursor: def.cursor,
    })),
  );

  let audio: File | undefined;
  if (config.audioClips.length >= 1) {
    const tmpOut = path.join(
      os.tmpdir(),
      `director-${project}-${episode}-${shot}-${Date.now()}.flac`,
    );
    const tracks: MixTrack[] = config.audioClips.map((clip) => ({
      filePath: clip.path,
      startOffset: clip.startOffset,
      trimStart: clip.trimStart,
      trimEnd: clip.trimEnd,
      duration: clip.duration,
    }));
    await deps.mixAudioTracks(tracks, tmpOut);
    const buf = await deps.readTempAudio(tmpOut);
    audio = new File([buf], 'director-audio.flac', { type: 'audio/flac' });
  }

  return {
    duration: config.duration,
    width: config.width,
    height: config.height,
    fps: config.fps,
    frames,
    ...(audio ? { audio } : {}),
  };
}
