import { Router, Request, Response } from 'express';
import {
  extractVideoFrame,
  extractVideoFrameAtTime,
  FrameIndexError,
  readVideoInfo,
} from '../assets/extract-frame.js';
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
