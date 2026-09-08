/**
 * 字节数格式化工具（存储清理、上传进度等界面共用）。
 */

/**
 * 把字节数格式化为人类可读文本（如 `12.3 MB`）。
 *
 * 规则：小于 1 KB 显示整数 B；其余单位保留 1 位小数，数值 ≥ 100 时取整。
 *
 * @param bytes 字节数（负数/NaN 视为 0）
 * @returns 格式化文本，如 `0 B`、`512 B`、`12.3 MB`
 *
 * @example
 * formatBytes(0)        // '0 B'
 * formatBytes(2048)     // '2.0 KB'
 * formatBytes(12_582_912) // '12 MB'
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1)
  const value = bytes / 2 ** (10 * i)
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}
