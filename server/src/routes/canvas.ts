import { Router, Request, Response } from 'express';
import { extractVideoFrame, FrameIndexError } from '../assets/extract-frame.js';
import { isUnderAssert } from './fs-path.js';

/**
 * 画布专属路由：本地媒体处理操作（不走工作流队列）。
 * 当前提供「获取视频帧」节点所需的 ffmpeg 帧提取接口。
 */
export const canvasRouter = Router();

/**
 * 提取视频帧：POST /api/canvas/extract-frame
 *
 * body: { project, videoPath, frameIndex, outputPath }
 * 帧索引语义：0=首帧、1=第二帧、-1=尾帧、-2=倒数第二帧，以此类推（越界返回 400）。
 * videoPath / outputPath 均须位于 assert/ 前缀下（与其它画布资产读写约束一致）。
 */
canvasRouter.post('/canvas/extract-frame', async (req: Request, res: Response) => {
  try {
    const project = String(req.body?.project ?? '');
    const videoPath = String(req.body?.videoPath ?? '');
    const outputPath = String(req.body?.outputPath ?? '');
    const frameIndex = Number(req.body?.frameIndex);
    if (!project || !videoPath || !outputPath) {
      res.status(400).json({ error: 'project / videoPath / outputPath 必填' });
      return;
    }
    if (!Number.isInteger(frameIndex)) {
      res.status(400).json({ error: 'frameIndex 必须是整数' });
      return;
    }
    const videoNorm = videoPath.replace(/\\/g, '/');
    const outputNorm = outputPath.replace(/\\/g, '/');
    if (!isUnderAssert(videoNorm) || !isUnderAssert(outputNorm)) {
      res.status(403).json({ error: '仅支持 assert/ 下的视频与输出路径' });
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
