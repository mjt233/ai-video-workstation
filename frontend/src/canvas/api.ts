import client, { readFs, writeFs } from '../api/client'
import { migrateCanvasData, type CanvasData, type CanvasKind } from './types'
import { sceneCanvasRelPath, stageCanvasRelPath } from './paths'

/** 画布目标：定位某张画布 */
export interface CanvasTarget {
  kind: CanvasKind
  /** stage 画布时的场景名 */
  stage?: string
  /** stage 画布时的子场景标签 */
  label?: string
  /** scene 画布时的集数 */
  episode?: string
  /** scene 画布时的分镜号 */
  shot?: string
}

/**
 * 计算画布定义文件的相对路径。
 *
 * @param target 画布目标
 * @returns 项目内相对路径
 * @throws Error 目标参数不完整时
 */
export function canvasRelPath(target: CanvasTarget): string {
  if (target.kind === 'stage') {
    if (!target.stage) throw new Error('场景画布需要 stage')
    if (!target.label) throw new Error('场景画布需要 label')
    return stageCanvasRelPath(target.stage, target.label)
  }
  if (!target.episode || !target.shot) throw new Error('分镜画布需要 episode 与 shot')
  return sceneCanvasRelPath(target.episode, target.shot)
}

/**
 * 加载画布定义；文件不存在或解析失败时返回 null。
 *
 * @param project 项目名
 * @param target 画布目标
 * @returns 画布定义或 null
 */
export async function loadCanvas(project: string, target: CanvasTarget): Promise<CanvasData | null> {
  try {
    const rel = canvasRelPath(target)
    const raw = await readFs(project, rel)
    if (raw == null) return null
    // axios 会尝试对字符串响应做 JSON.parse，因此 .json 文件可能直接返回对象；
    // 同时兼容仍为字符串的情况（如空文件或代理差异）
    if (typeof raw === 'string') {
      if (raw.trim() === '') return null
      return migrateCanvasData(JSON.parse(raw) as unknown)
    }
    return migrateCanvasData(raw)
  } catch {
    return null
  }
}

/**
 * 保存画布定义（写入 canvas.json）。
 *
 * @param project 项目名
 * @param target 画布目标
 * @param data 画布定义
 */
export async function saveCanvas(project: string, target: CanvasTarget, data: CanvasData): Promise<void> {
  const rel = canvasRelPath(target)
  await writeFs(project, rel, JSON.stringify(data, null, 2))
}

/**
 * 提取视频帧：调用服务端 ffmpeg 接口，把输入视频的指定帧输出为图片（png）。
 *
 * 帧索引语义：0=首帧、1=第二帧、-1=尾帧、-2=倒数第二帧，以此类推（越界服务端返回错误）。
 *
 * @param project 项目名
 * @param videoPath 输入视频相对路径（assert/ 下）
 * @param frameIndex 帧索引（整数，可负）
 * @param outputPath 输出图片相对路径（assert/ 下，.png）
 * @returns 服务端执行结果（含输出相对路径）
 */
export async function extractVideoFrame(
  project: string,
  videoPath: string,
  frameIndex: number,
  outputPath: string,
): Promise<{ success: boolean; path: string }> {
  const { data } = await client.post<{ success: boolean; path: string }>('/canvas/extract-frame', {
    project,
    videoPath,
    frameIndex,
    outputPath,
  })
  return data
}

/**
 * 按时间点提取视频帧：调用服务端 ffmpeg 接口，把输入视频 time 秒处的帧输出为图片（png）。
 *
 * 服务端按呈现时间精确选帧（ffmpeg -ss），与浏览器预览画面一致；
 * 「提取当前帧」用它避免帧索引换算误差（尤其拖拽进度条后）。
 *
 * @param project 项目名
 * @param videoPath 输入视频相对路径（assert/ 下）
 * @param time 时间点（秒，须在 [0, 时长] 内）
 * @param outputPath 输出图片相对路径（assert/ 下，.png）
 * @returns 服务端执行结果（含输出相对路径）
 */
export async function extractVideoFrameAtTime(
  project: string,
  videoPath: string,
  time: number,
  outputPath: string,
): Promise<{ success: boolean; path: string }> {
  const { data } = await client.post<{ success: boolean; path: string }>('/canvas/extract-frame', {
    project,
    videoPath,
    time,
    outputPath,
  })
  return data
}

/** 画布节点产物信息（服务端 fs.stat；产物为固定 output.{ext}，"当前结果"即文件系统事实） */
export interface CanvasNodeInfo {
  /** 产物文件是否存在 */
  exists: boolean
  /** 文件 mtime（毫秒时间戳；预览防缓存/上游更新角标用）；不存在时为 null */
  mtime: number | null
  /** 文件大小（字节）；不存在时为 null */
  size: number | null
}

/**
 * 获取画布节点产物信息：存在性 / mtime / 大小。
 *
 * @param project 项目名
 * @param relPath 产物相对路径（assert/ 下）
 * @returns 产物信息（文件不存在时 exists=false，正常返回）
 */
export async function getCanvasNodeInfo(project: string, relPath: string): Promise<CanvasNodeInfo> {
  const { data } = await client.get<{ success: boolean } & CanvasNodeInfo>('/canvas/node-info', {
    params: { project, path: relPath },
  })
  return { exists: data.exists, mtime: data.mtime, size: data.size }
}

/** 视频基础信息（服务端 ffprobe，供「提取当前帧」把播放时间换算为帧索引） */
export interface VideoInfo {
  /** 时长（秒） */
  duration: number
  /** 帧率（每秒帧数） */
  fps: number
  /** 视频宽度（像素） */
  width: number
  /** 视频高度（像素） */
  height: number
}

/**
 * 获取视频基础信息：时长 / 帧率 / 分辨率。
 *
 * 供「提取当前帧」：无 requestVideoFrameCallback 环境按 播放时间 × 帧率 换算当前帧索引。
 *
 * @param project 项目名
 * @param videoPath 视频相对路径（assert/ 下）
 * @returns 视频信息
 */
export async function getVideoInfo(project: string, videoPath: string): Promise<VideoInfo> {
  const { data } = await client.get<{ success: boolean } & VideoInfo>('/canvas/video-info', {
    params: { project, path: videoPath },
  })
  return { duration: data.duration, fps: data.fps, width: data.width, height: data.height }
}

/** 音频基础信息（服务端 ffprobe，供连线音频时按真实时长回填素材块） */
export interface AudioInfo {
  /** 时长（秒） */
  duration: number
}

/**
 * 获取音频基础信息：时长。
 *
 * 画布连线音频到生成视频节点后，用真实时长回填导演台音频素材块，
 * 避免占位时长（2s）截断音频。
 *
 * @param project 项目名
 * @param audioPath 音频相对路径（assert/ 下）
 * @returns 音频信息
 */
export async function getAudioInfo(project: string, audioPath: string): Promise<AudioInfo> {
  const { data } = await client.get<{ success: boolean } & AudioInfo>('/canvas/audio-info', {
    params: { project, path: audioPath },
  })
  return { duration: data.duration }
}

/**
 * 拼接视频：调用服务端 ffmpeg 接口，把多段视频按顺序无损拼接为单个视频。
 *
 * 服务端用 concat demuxer + `-c copy`（各段编码/分辨率/帧率/音轨结构须一致，否则报错）。
 *
 * @param project 项目名
 * @param videoPaths 视频相对路径数组（assert/ 下，按拼接顺序，至少 2 段）
 * @param outputPath 输出视频相对路径（assert/ 下，.mp4）
 * @returns 服务端执行结果（含输出相对路径）
 */
export async function concatVideo(
  project: string,
  videoPaths: string[],
  outputPath: string,
): Promise<{ success: boolean; path: string }> {
  const { data } = await client.post<{ success: boolean; path: string }>('/canvas/concat-video', {
    project,
    videoPaths,
    outputPath,
  })
  return data
}

/** 裁剪视频请求参数（起点二选一：startTime 或 startFrame） */
export interface TrimVideoParams {
  /** 起始时间（秒，可小数）；与 startFrame 互斥，优先本字段 */
  startTime?: number
  /** 起始帧索引（整数 ≥ 0）；无 startTime 时由服务端按 帧 / fps 换算 */
  startFrame?: number
  /** 持续时长（秒，> 0，可小数） */
  duration: number
}

/**
 * 裁剪视频：调用服务端 ffmpeg 接口，把输入视频按起点与持续时长剪切为单个视频。
 *
 * 服务端重编码输出（不用 -c copy），保证帧索引 / 小数秒切口准确。
 *
 * @param project 项目名
 * @param videoPath 输入视频相对路径（assert/ 下）
 * @param params 裁剪参数（startTime 或 startFrame + duration）
 * @param outputPath 输出视频相对路径（assert/ 下，.mp4）
 * @returns 服务端执行结果（含输出相对路径）
 */
export async function trimVideo(
  project: string,
  videoPath: string,
  params: TrimVideoParams,
  outputPath: string,
): Promise<{ success: boolean; path: string }> {
  const { data } = await client.post<{ success: boolean; path: string }>('/canvas/trim-video', {
    project,
    videoPath,
    outputPath,
    duration: params.duration,
    startTime: params.startTime,
    startFrame: params.startFrame,
  })
  return data
}

/** 音频裁剪请求参数（起始位置与持续时长均使用秒） */
export interface TrimAudioParams {
  /** 起始位置（秒，可小数，须 ≥ 0） */
  startTime: number
  /** 裁剪时长（秒，> 0，可小数） */
  duration: number
}

/** 音频裁剪执行结果（服务端返回，含输出相对路径） */
export interface TrimAudioResult {
  /** 裁剪产物相对路径（assert/ 下，output.flac） */
  path: string
  /** 实际裁剪时长（秒；超出片尾时短于请求值） */
  duration: number
}

/**
 * 裁剪音频：调用服务端 ffmpeg 接口，把输入音频按起点与持续时长剪切为单个 FLAC。
 *
 * 服务端重编码输出（不用 -c copy），保证小数秒切口准确；产物固定为 output.flac。
 *
 * @param project 项目名
 * @param audioPath 输入音频相对路径（assert/ 下）
 * @param params 裁剪参数（startTime + duration）
 * @param outputPath 输出音频相对路径（assert/ 下，画布节点固定 output.flac）
 * @returns 服务端执行结果（含输出相对路径与实际时长）
 */
export async function trimAudio(
  project: string,
  audioPath: string,
  params: TrimAudioParams,
  outputPath: string,
): Promise<TrimAudioResult> {
  const { data } = await client.post<TrimAudioResult>('/canvas/trim-audio', {
    project,
    audioPath,
    outputPath,
    startTime: params.startTime,
    duration: params.duration,
  })
  return data
}
