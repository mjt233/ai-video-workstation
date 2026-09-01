import fs from 'fs/promises';
import path from 'path';
import { copyExistingAssetToHistory } from './history.js';
import { resolveProjectPath } from './paths.js';

/**
 * 画布节点固定产物路径（生成图片 output.jpg / 生成视频 output.mp4）：
 * - 分镜画布：assert/scene/{集数}/{分镜}/canvas/{nodeId}/output.{ext}
 * - 场景画布：assert/stage/{场景名}/canvas/{子场景标签}/{nodeId}/output.{ext}
 */
const CANVAS_OUTPUT_PATH =
  /^assert\/(?:scene\/[1-9]\d*\/[1-9]\d*\/canvas\/[^/]+|stage\/[^/]+\/canvas\/[^/]+\/[^/]+)\/output\.(jpg|mp4)$/u;

/** 允许上传到图片产物（output.jpg）的 MIME（与 /assets/upload 一致） */
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * 从上传文件名提取小写扩展名（无点号）；无扩展名返回空串。
 *
 * @param originalName 上传文件的原始文件名（可能含浏览器路径前缀）
 * @returns 小写扩展名（如 jpg / mp4），无扩展名时为空串
 */
function extOf(originalName: string): string {
  const name = originalName.replace(/\\/g, '/').split('/').pop() ?? originalName;
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

/**
 * 校验目标路径为画布节点固定产物路径（output.jpg / output.mp4）并返回规范化路径。
 * 分镜/场景两种画布均可；路径含 .. 或不符合固定产物模式时抛 INVALID。
 *
 * @param relPath 项目内相对路径
 * @returns 规范化后的 assert 相对路径
 */
export function assertCanvasNodeOutputPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || !CANVAS_OUTPUT_PATH.test(normalized)) {
    throw Object.assign(
      new Error('仅支持上传到画布节点的固定产物路径（output.jpg / output.mp4）'),
      { code: 'INVALID' },
    );
  }
  return normalized;
}

/**
 * 校验上传文件与目标产物类型匹配：
 * - output.jpg：MIME 须为 image/jpeg / image/png / image/webp（统一落盘 jpg，与 /assets/upload 一致）；
 * - output.mp4：文件扩展名为 mp4 或 MIME 为 video/mp4（部分浏览器对 mp4 报 application/octet-stream，
 *   因此扩展名与 MIME 满足其一即可），其余格式提示先转码。
 *
 * @param targetExt 目标产物扩展名（jpg / mp4）
 * @param mime 上传文件 MIME
 * @param originalName 上传文件原始文件名
 */
export function assertCanvasUploadFile(targetExt: string, mime: string, originalName: string): void {
  if (targetExt === 'jpg') {
    if (!IMAGE_MIME.has(mime)) {
      throw Object.assign(new Error('仅支持上传 jpg / png / webp 格式图片'), { code: 'INVALID' });
    }
    return;
  }
  if (mime !== 'video/mp4' && extOf(originalName) !== 'mp4') {
    throw Object.assign(new Error('仅支持上传 mp4 格式视频，请先转码为 mp4 再上传'), { code: 'INVALID' });
  }
}

/**
 * 将上传内容写入画布节点固定产物路径。
 * 若已有当前产物，先复制归档进 history/{stem}/{时间戳}{ext}（copy 而非 rename：
 * 归档期间旧文件仍留在原位，覆盖前预览不断链），再写入新文件；
 * 归档失败抛错中断上传——本接口的语义是「旧产物必须保留为历史版本」，不允许静默丢历史。
 *
 * @param project 项目名
 * @param assetRelPath 目标产物相对路径（须匹配画布节点固定产物路径）
 * @param data 上传文件内容
 * @param meta 上传文件元信息（MIME 与原始文件名，用于类型校验）
 * @returns 写入的产物相对路径与归档历史相对路径（无旧产物时为 null）
 */
export async function saveCanvasNodeUpload(
  project: string,
  assetRelPath: string,
  data: Buffer,
  meta: { mime: string; originalName: string },
): Promise<{ path: string; archived: string | null }> {
  const rel = assertCanvasNodeOutputPath(assetRelPath);
  const targetExt = rel.endsWith('.jpg') ? 'jpg' : 'mp4';
  assertCanvasUploadFile(targetExt, meta.mime, meta.originalName);
  const archived = await copyExistingAssetToHistory(project, rel);
  const full = resolveProjectPath(project, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return { path: rel, archived };
}
