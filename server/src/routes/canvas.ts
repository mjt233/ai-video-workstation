import { Router, Request, Response } from 'express';
import {
  extractVideoFrame,
  extractVideoFrameAtTime,
  FrameIndexError,
  readAudioInfo,
  readVideoInfo,
} from '../assets/extract-frame.js';
import { concatVideos, ConcatError } from '../assets/concat-video.js';
import { trimVideo, TrimError } from '../assets/trim-video.js';
import { isUnderAssert } from './fs-path.js';

/**
 * 画布专属路由：本地媒体处理操作（不走工作流队列）。
 * 当前提供「获取视频帧」节点所需的 ffmpeg 帧提取接口。
 */
export const canvasRouter = Router();

/**
 * 提取视频帧：POST /api/canvas/extract-frame
 *
 * body: { project, videoPath, outputPath, frameIndex?, time? }
 * - frameIndex：帧索引（0=首帧、1=第二帧、-1=尾帧、-2=倒数第二帧，越界返回 400）；
 * - time（可选）：时间点（秒，[0, 时长] 内），提供时按时间精确选帧（ffmpeg -ss，与预览画面一致）。
 * videoPath / outputPath 均须位于 assert/ 前缀下（与其它画布资产读写约束一致）。
 */
canvasRouter.post('/canvas/extract-frame', async (req: Request, res: Response) => {
  try {
    const project = String(req.body?.project ?? '');
    const videoPath = String(req.body?.videoPath ?? '');
    const outputPath = String(req.body?.outputPath ?? '');
    const videoNorm = videoPath.replace(/\\/g, '/');
    const outputNorm = outputPath.replace(/\\/g, '/');
    if (!project || !videoPath || !outputPath) {
      res.status(400).json({ error: 'project / videoPath / outputPath 必填' });
      return;
    }
    if (!isUnderAssert(videoNorm) || !isUnderAssert(outputNorm)) {
      res.status(403).json({ error: '仅支持 assert/ 下的视频与输出路径' });
      return;
    }
    // 可选 time（秒）：优先按时间点精确提取（「提取当前帧」），否则按帧索引提取
    const timeRaw = req.body?.time;
    if (timeRaw !== undefined && timeRaw !== null && timeRaw !== '') {
      const time = Number(timeRaw);
      if (!Number.isFinite(time) || time < 0) {
        res.status(400).json({ error: 'time 必须是大于等于 0 的数字（秒）' });
        return;
      }
      const result = await extractVideoFrameAtTime(project, videoNorm, time, outputNorm);
      res.json({ success: true, path: result });
      return;
    }
    const frameIndex = Number(req.body?.frameIndex);
    if (!Number.isInteger(frameIndex)) {
      res.status(400).json({ error: 'frameIndex 必须是整数' });
      return;
    }
    const result = await extractVideoFrame(project, videoNorm, frameIndex, outputNorm);
    res.json({ success: true, path: result });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e instanceof FrameIndexError || e?.code === 'FRAME_INDEX_OUT_OF_RANGE') {
      res.status(400).json({ error: e.message, code: e.code ?? 'FRAME_INDEX_OUT_OF_RANGE' });
      return;
    }
    if (e?.code === 'NOT_FOUND') {
      res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
      return;
    }
    if (e?.code === 'INVALID') {
      res.status(400).json({ error: e.message, code: 'INVALID' });
      return;
    }
    console.error('Failed to extract video frame:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 获取视频信息：GET /api/canvas/video-info
 *
 * query: { project, path }
 * 返回 { success, duration, fps, width, height }，供「提取当前帧」把预览播放时间换算为帧索引。
 * path 须位于 assert/ 前缀下。
 */
canvasRouter.get('/canvas/video-info', async (req: Request, res: Response) => {
  try {
    const project = String(req.query.project ?? '');
    const videoPath = String(req.query.path ?? '');
    if (!project || !videoPath) {
      res.status(400).json({ error: 'project / path 必填' });
      return;
    }
    const videoNorm = videoPath.replace(/\\/g, '/');
    if (!isUnderAssert(videoNorm)) {
      res.status(403).json({ error: '仅支持 assert/ 下的视频路径' });
      return;
    }
    const info = await readVideoInfo(project, videoNorm);
    res.json({ success: true, ...info });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'NOT_FOUND') {
      res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
      return;
    }
    console.error('Failed to get video info:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 获取音频信息：GET /api/canvas/audio-info
 *
 * query: { project, path }
 * 返回 { success, duration }，供画布连线音频时按真实时长回填素材块。
 * path 须位于 assert/ 前缀下。
 */
canvasRouter.get('/canvas/audio-info', async (req: Request, res: Response) => {
  try {
    const project = String(req.query.project ?? '');
    const audioPath = String(req.query.path ?? '');
    if (!project || !audioPath) {
      res.status(400).json({ error: 'project / path 必填' });
      return;
    }
    const audioNorm = audioPath.replace(/\\/g, '/');
    if (!isUnderAssert(audioNorm)) {
      res.status(403).json({ error: '仅支持 assert/ 下的音频路径' });
      return;
    }
    const info = await readAudioInfo(project, audioNorm);
    res.json({ success: true, ...info });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'NOT_FOUND') {
      res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
      return;
    }
    console.error('Failed to get audio info:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 拼接视频：POST /api/canvas/concat-video
 *
 * body: { project, videoPaths: string[], outputPath }
 * 按 videoPaths 顺序用 ffmpeg 无损拼接（concat demuxer + `-c copy`，各段规格须一致），
 * 产物写入 outputPath。videoPaths 与 outputPath 均须位于 assert/ 前缀下。
 */
canvasRouter.post('/canvas/concat-video', async (req: Request, res: Response) => {
  try {
    const project = String(req.body?.project ?? '');
    const rawPaths = Array.isArray(req.body?.videoPaths) ? req.body.videoPaths : [];
    const outputPath = String(req.body?.outputPath ?? '');
    const videoPaths = rawPaths.map((p: unknown) => String(p).replace(/\\/g, '/'));
    const outputNorm = outputPath.replace(/\\/g, '/');
    if (!project || videoPaths.length === 0 || !outputNorm) {
      res.status(400).json({ error: 'project / videoPaths / outputPath 必填' });
      return;
    }
    if (!isUnderAssert(outputNorm) || videoPaths.some((p: string) => !isUnderAssert(p))) {
      res.status(403).json({ error: '仅支持 assert/ 下的视频路径' });
      return;
    }
    const result = await concatVideos(project, videoPaths, outputNorm);
    res.json({ success: true, path: result });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'NOT_FOUND') {
      res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
      return;
    }
    if (e instanceof ConcatError || e?.code === 'INVALID') {
      res.status(400).json({ error: e.message, code: e.code ?? 'INVALID' });
      return;
    }
    console.error('Failed to concat videos:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 裁剪视频：POST /api/canvas/trim-video
 *
 * body: { project, videoPath, outputPath, duration, startTime? | startFrame? }
 * - startTime：起始时间（秒，可小数），提供时按呈现时间裁剪；
 * - startFrame：起始帧索引（整数 ≥ 0），无 startTime 时按 帧 / fps 换算为秒；
 * - duration：持续时长（秒，> 0，可小数；超出片尾截到剩余时长）。
 * 重编码输出（不用 -c copy），保证帧索引 / 小数秒切口准确。
 * videoPath / outputPath 均须位于 assert/ 前缀下。
 */
canvasRouter.post('/canvas/trim-video', async (req: Request, res: Response) => {
  try {
    const project = String(req.body?.project ?? '');
    const videoPath = String(req.body?.videoPath ?? '');
    const outputPath = String(req.body?.outputPath ?? '');
    const videoNorm = videoPath.replace(/\\/g, '/');
    const outputNorm = outputPath.replace(/\\/g, '/');
    if (!project || !videoPath || !outputPath) {
      res.status(400).json({ error: 'project / videoPath / outputPath 必填' });
      return;
    }
    if (!isUnderAssert(videoNorm) || !isUnderAssert(outputNorm)) {
      res.status(403).json({ error: '仅支持 assert/ 下的视频与输出路径' });
      return;
    }
    const duration = Number(req.body?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      res.status(400).json({ error: 'duration 必须是大于 0 的数字（秒）' });
      return;
    }
    const startTimeRaw = req.body?.startTime;
    const startFrameRaw = req.body?.startFrame;
    const hasStartTime = startTimeRaw !== undefined && startTimeRaw !== null && startTimeRaw !== '';
    const hasStartFrame = startFrameRaw !== undefined && startFrameRaw !== null && startFrameRaw !== '';
    if (!hasStartTime && !hasStartFrame) {
      res.status(400).json({ error: 'startTime 或 startFrame 必填其一' });
      return;
    }
    const params: { duration: number; startTime?: number; startFrame?: number } = { duration };
    if (hasStartTime) {
      const startTime = Number(startTimeRaw);
      if (!Number.isFinite(startTime) || startTime < 0) {
        res.status(400).json({ error: 'startTime 必须是大于等于 0 的数字（秒）' });
        return;
      }
      params.startTime = startTime;
    } else {
      const startFrame = Number(startFrameRaw);
      if (!Number.isInteger(startFrame) || startFrame < 0) {
        res.status(400).json({ error: 'startFrame 必须是大于等于 0 的整数' });
        return;
      }
      params.startFrame = startFrame;
    }
    const result = await trimVideo(project, videoNorm, params, outputNorm);
    res.json({ success: true, path: result });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'NOT_FOUND') {
      res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
      return;
    }
    if (e instanceof TrimError || e?.code === 'INVALID') {
      res.status(400).json({ error: e.message, code: e.code ?? 'INVALID' });
      return;
    }
    console.error('Failed to trim video:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
