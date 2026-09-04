import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import os from 'os';
import multer from 'multer';
import {
  extractVideoFrame,
  extractVideoFrameAtTime,
  FrameIndexError,
  readAudioInfo,
  readVideoInfo,
} from '../assets/extract-frame.js';
import { concatVideos, ConcatError } from '../assets/concat-video.js';
import { trimVideo, TrimError } from '../assets/trim-video.js';
import { assertAudioTrimOutputPath, trimAudio, TrimAudioError } from '../assets/trim-audio.js';
import { isUnderAssert } from './fs-path.js';
import { copyExistingAssetToHistory } from '../assets/history.js';
import { saveCanvasNodeUpload } from '../assets/canvas-upload.js';
import { readCanvasNodeInfo } from '../canvas/node-info.js';

/**
 * 画布专属路由：本地媒体处理操作（不走工作流队列）。
 * 当前提供「获取视频帧」节点所需的 ffmpeg 帧提取接口。
 */
export const canvasRouter = Router();

/**
 * 画布产物上传 multer（diskStorage 临时落盘，避免大视频占用内存；上限 8GB）。
 * 与 /fs/upload 的 customUpload 同一模式；产物最终由 saveCanvasNodeUpload 写入固定路径。
 */
const canvasOutputUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => {
      cb(null, `dsh-canvas-upload-${Date.now()}-${Math.round(Math.random() * 1e9)}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 * 1024 }, // 8GB
});

/**
 * 写固定路径产物前归档旧版本。
 * 画布节点产物统一为固定路径 output.{ext}，重复生成时旧产物先复制归档到
 * history/ 目录（copy 而非 rename：新文件覆盖前旧文件仍留在原位，预览不断链）。
 * 归档失败不阻断本次写入（仅丢历史，不丢结果）。
 *
 * @param project 项目名
 * @param outputPath 产物相对路径（assert/ 下，已规范化）
 */
async function archiveCanvasOutput(project: string, outputPath: string): Promise<void> {
  try {
    await copyExistingAssetToHistory(project, outputPath);
  } catch (e) {
    console.warn(`归档画布节点旧产物失败（不影响本次写入）: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * 上传产物到生成节点固定路径：POST /api/canvas/upload
 *
 * multipart：project + path + file
 * - path：画布节点固定产物路径（assert/{scope}/canvas/{nodeId}/output.jpg | output.mp4），
 *   分镜画布与场景画布均可；路径不匹配返回 400。
 * - 图片（output.jpg）接受 jpg/png/webp；视频（output.mp4）仅接受 mp4（扩展名或 MIME 任一匹配即可）。
 * - 目标已有产物时，先把旧产物复制归档进 history 目录（copyExistingAssetToHistory，
 *   归档失败抛错中断上传——历史必须保留），再覆盖写入固定路径。
 * 返回 { success, path, archived }（archived 为归档历史相对路径，无旧产物时为 null）。
 */
canvasRouter.post(
  '/canvas/upload',
  (req: Request, res: Response, next) => {
    canvasOutputUpload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const e = err as { code?: string; message?: string };
        if (e?.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ error: '文件大小超过 8GB 限制' });
          return;
        }
        if (e?.code === 'Unexpected field') {
          // 打日志便于排查上传异常（multipart 流错位/字段不匹配）
          console.error('[canvas-upload] 上传失败:', err);
          res.status(400).json({ error: '上传请求格式错误（multipart 字段不匹配），请重试' });
          return;
        }
        res.status(500).json({ error: e?.message || '上传失败' });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    try {
      const project = String(req.body?.project ?? '');
      const assetPath = String(req.body?.path ?? '');
      if (!project || !assetPath) {
        throw Object.assign(new Error('project 与 path 必填'), { code: 'INVALID' });
      }
      if (!file?.size) {
        throw Object.assign(new Error('请选择要上传的文件'), { code: 'INVALID' });
      }
      const data = await fs.readFile(file.path);
      const result = await saveCanvasNodeUpload(project, assetPath, data, {
        mime: file.mimetype,
        originalName: file.originalname,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code === 'INVALID') {
        res.status(400).json({ error: e.message, code: 'INVALID' });
        return;
      }
      console.error('Failed to upload canvas output:', err);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      // 清理临时文件（磁盘落盘模式；无论成功失败都不残留）
      if (file?.path) await fs.unlink(file.path).catch(() => {});
    }
  },
);

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
      await archiveCanvasOutput(project, outputNorm);
      const result = await extractVideoFrameAtTime(project, videoNorm, time, outputNorm);
      res.json({ success: true, path: result });
      return;
    }
    const frameIndex = Number(req.body?.frameIndex);
    if (!Number.isInteger(frameIndex)) {
      res.status(400).json({ error: 'frameIndex 必须是整数' });
      return;
    }
    await archiveCanvasOutput(project, outputNorm);
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
 * 获取节点产物信息：GET /api/canvas/node-info
 *
 * query: { project, path }
 * 返回 { success, exists, mtime, size }（fs.stat）。
 * 画布节点产物固定为 output.{ext}，"当前结果"即文件系统事实：
 * 前端用它判断产物存在性（按钮文案）、mtime（预览防缓存/上游更新角标）。
 * path 须位于 assert/ 前缀下；文件不存在时 exists=false（200，不报错）。
 */
canvasRouter.get('/canvas/node-info', async (req: Request, res: Response) => {
  try {
    const project = String(req.query.project ?? '');
    const path = String(req.query.path ?? '');
    if (!project || !path) {
      res.status(400).json({ error: 'project / path 必填' });
      return;
    }
    const norm = path.replace(/\\/g, '/');
    if (!isUnderAssert(norm)) {
      res.status(403).json({ error: '仅支持 assert/ 下的路径' });
      return;
    }
    const info = await readCanvasNodeInfo(project, norm);
    res.json({ success: true, ...info });
  } catch (err) {
    console.error('Failed to read node info:', err);
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
    await archiveCanvasOutput(project, outputNorm);
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
    await archiveCanvasOutput(project, outputNorm);
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

/**
 * 裁剪音频：POST /api/canvas/trim-audio
 *
 * body: { project, audioPath, outputPath, startTime, duration }
 * - startTime：起始位置（秒，可小数，必须 ≥ 0）；
 * - duration：持续时长（秒，> 0，可小数；超出片尾截到剩余时长）。
 * 重编码为 FLAC 输出（不用 -c copy），保证小数秒切口准确。
 * audioPath 须位于 assert/ 前缀下；outputPath 必须是画布节点固定产物 output.flac。
 */
canvasRouter.post('/canvas/trim-audio', async (req: Request, res: Response) => {
  try {
    const project = String(req.body?.project ?? '');
    const audioPath = String(req.body?.audioPath ?? '');
    const outputPath = String(req.body?.outputPath ?? '');
    const audioNorm = audioPath.replace(/\\/g, '/');
    const outputNorm = outputPath.replace(/\\/g, '/');
    if (!project || !audioPath || !outputPath) {
      res.status(400).json({ error: 'project / audioPath / outputPath 必填' });
      return;
    }
    if (!isUnderAssert(audioNorm)) {
      res.status(403).json({ error: '仅支持 assert/ 下的音频路径' });
      return;
    }
    let outputRel: string;
    try {
      outputRel = assertAudioTrimOutputPath(outputNorm);
    } catch (err) {
      const e = err as { message?: string };
      res.status(400).json({ error: e.message ?? '输出路径不是合法的画布节点产物', code: 'INVALID' });
      return;
    }
    const startTime = Number(req.body?.startTime);
    if (!Number.isFinite(startTime) || startTime < 0) {
      res.status(400).json({ error: 'startTime 必须是大于等于 0 的数字（秒）' });
      return;
    }
    const duration = Number(req.body?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      res.status(400).json({ error: 'duration 必须是大于 0 的数字（秒）' });
      return;
    }
    await archiveCanvasOutput(project, outputRel);
    const result = await trimAudio(project, audioNorm, { startTime, duration }, outputRel);
    res.json({ success: true, path: result.path, duration: result.duration });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e instanceof TrimAudioError || e?.code === 'INVALID') {
      res.status(400).json({ error: e.message, code: e.code ?? 'INVALID' });
      return;
    }
    if (e?.code === 'NOT_FOUND') {
      res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
      return;
    }
    console.error('Failed to trim audio:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
