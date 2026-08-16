import fs from 'fs/promises';
import { resolveProjectPath } from '../assets/paths.js';

/**
 * 画布节点产物信息。
 *
 * 画布节点产物改为固定路径（output.{ext}）后，"当前结果"为文件系统事实；
 * 前端通过本信息判断产物存在性、mtime（预览缓存/上游更新角标）与大小。
 */
export interface CanvasNodeInfo {
  /** 产物文件是否存在 */
  exists: boolean
  /** 文件 mtime（毫秒时间戳）；不存在时为 null */
  mtime: number | null
  /** 文件大小（字节）；不存在时为 null */
  size: number | null
}

/**
 * 读取画布节点产物文件信息（fs.stat）。
 *
 * @param project 项目名
 * @param relPath assert 相对路径（须在 assert/ 下，越界由 resolveProjectPath 抛错）
 * @returns 产物信息；文件不存在时 exists=false 且 mtime/size 为 null，不抛错
 */
export async function readCanvasNodeInfo(
  project: string,
  relPath: string,
): Promise<CanvasNodeInfo> {
  try {
    const full = resolveProjectPath(project, relPath);
    const stat = await fs.stat(full);
    if (stat.isFile()) {
      return { exists: true, mtime: stat.mtimeMs, size: stat.size };
    }
    return { exists: false, mtime: null, size: null };
  } catch {
    // ENOENT 等读取失败统一视为不存在，不抛错（"文件系统即数据库"：无文件即无结果）
    return { exists: false, mtime: null, size: null };
  }
}