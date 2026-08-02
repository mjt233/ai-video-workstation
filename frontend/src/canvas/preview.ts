/**
 * 画布资产预览 URL 工具。
 * 沿用全项目约定：/api/fs/{project}/{relPath}?t=... 防缓存。
 */

/**
 * 构建资产预览 URL。
 *
 * @param project 项目名
 * @param relPath 项目内相对路径（assert/ 下）
 * @param version 可选版本号；提供时作为缓存键（版本变化即刷新缓存）
 * @returns 预览 URL
 */
export function buildPreviewUrl(project: string, relPath: string, version?: number): string {
  const base = `/api/fs/${project}/${relPath}`
  if (version != null) {
    return `${base}?t=v${version}`
  }
  return `${base}?t=${Date.now()}`
}
