/**
 * 时间展示工具（存储清理 / 回收站界面共用）。
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 把时间格式化为「距今多久」的简短文本。
 *
 * 规则：< 1 分钟 → 刚刚；< 1 小时 → N 分钟前；< 1 天 → N 小时前；
 * < 30 天 → N 天前；< 365 天 → N 个月前；否则 N 年前。
 * 未来时间（时钟偏差）统一显示「刚刚」。
 *
 * @param value 时间（ISO 字符串 / 毫秒时间戳 / Date）
 * @param now 参考时间（默认当前时间，测试可注入）
 * @returns 相对时间文本；时间非法时返回 '—'
 *
 * @example
 * formatRelativeTime('2026-08-13T00:00:00.000Z', new Date('2026-08-20T00:00:00.000Z')) // '7 天前'
 */
export function formatRelativeTime(value: string | number | Date, now: number = Date.now()): string {
  const ms = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : Date.parse(value)
  if (!Number.isFinite(ms)) return '—'

  const diff = now - ms
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  const days = Math.floor(diff / DAY)
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

/**
 * 把时间格式化为绝对时间文本（用于悬浮提示）。
 *
 * @param value 时间（ISO 字符串 / 毫秒时间戳 / Date）
 * @returns `YYYY-MM-DD HH:mm:ss`；时间非法时返回 '—'
 */
export function formatDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  const ms = date.getTime()
  if (!Number.isFinite(ms)) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}
