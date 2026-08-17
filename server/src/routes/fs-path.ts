import path from 'path';

/**
 * fs 路由的路径校验工具与通用业务错误。
 *
 * 画布资产区（assert/{scope}/canvas/ 等）与自定义资产区（assert/custom/）
 * 均位于 assert/ 前缀下，共用同一套路径校验规则。
 */

/** assert/ 前缀：画布资产区与自定义资产区均在此前缀下 */
export const ASSERT_PREFIX = 'assert/';

/** fs 路由业务错误：携带 HTTP 状态码，供路由处理器直接映射响应 */
export class FsRouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * 规范化相对路径为统一正斜杠（Windows 反斜杠转正斜杠）。
 *
 * @param relPath 原始相对路径
 * @returns 正斜杠形式的相对路径
 */
export function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

/**
 * 判断 zip 条目路径是否危险（zip-slip 防护）：
 * 拒绝绝对路径（/ 开头或盘符开头）、以及含 . 或 .. 路径段的条目，
 * 防止解压逃逸目标目录。
 *
 * @param entryName zip 内的条目路径
 * @returns 危险返回 true，安全返回 false
 */
export function isUnsafeZipEntry(entryName: string): boolean {
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return true;
  if (/^[a-zA-Z]:/.test(normalized)) return true;
  const segments = normalized.split('/');
  return segments.some((seg) => seg === '..' || seg === '.');
}

/**
 * 判断相对路径是否位于 assert/ 前缀下。
 *
 * @param relPath 已规范化的相对路径
 * @returns 位于 assert/ 前缀下返回 true
 */
export function isUnderAssert(relPath: string): boolean {
  return relPath.startsWith(ASSERT_PREFIX);
}

/**
 * 在项目根目录下解析相对路径，并校验不逃逸项目根。
 *
 * @param projectRoot 项目根目录绝对路径
 * @param relPath 项目内相对路径（允许正/反斜杠）
 * @returns 解析后的绝对路径
 * @throws FsRouteError(403) 当路径逃逸项目根时
 */
export function resolveProjectPath(projectRoot: string, relPath: string): string {
  const rootAbs = path.resolve(projectRoot);
  const full = path.resolve(rootAbs, relPath);
  if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) {
    throw new FsRouteError(403, 'Path traversal denied');
  }
  return full;
}

/** 复制请求校验结果 */
export interface CopyPaths {
  fromNorm: string;
  toNorm: string;
  fromFull: string;
  toFull: string;
}

/**
 * 校验并规范化「复制」请求参数：from/to 均须位于 assert/ 前缀下，且不逃逸项目根。
 *
 * @param projectRoot 项目根目录绝对路径
 * @param from 源相对路径
 * @param to 目标相对路径
 * @returns 规范化后的源/目标相对路径与绝对路径
 * @throws FsRouteError(400) 参数缺失；FsRouteError(403) 越权或逃逸
 */
export function validateCopyRequest(projectRoot: string, from: string, to: string): CopyPaths {
  if (!from || !to) {
    throw new FsRouteError(400, 'from 与 to 必填');
  }
  const fromNorm = normalizeRelPath(from);
  const toNorm = normalizeRelPath(to);
  if (!isUnderAssert(fromNorm) || !isUnderAssert(toNorm)) {
    throw new FsRouteError(403, '仅支持复制 assert/ 下的内容');
  }
  return {
    fromNorm,
    toNorm,
    fromFull: resolveProjectPath(projectRoot, fromNorm),
    toFull: resolveProjectPath(projectRoot, toNorm),
  };
}
