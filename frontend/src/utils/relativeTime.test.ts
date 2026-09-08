import { describe, expect, it } from 'vitest'
import { formatDateTime, formatRelativeTime } from './relativeTime'

const NOW = new Date('2026-08-20T12:00:00.000Z').getTime()

describe('formatRelativeTime', () => {
  it('小于 1 分钟显示「刚刚」（含未来时间）', () => {
    expect(formatRelativeTime(NOW - 30 * 1000, NOW)).toBe('刚刚')
    expect(formatRelativeTime(NOW + 5000, NOW)).toBe('刚刚')
  })

  it('分钟 / 小时 / 天 / 月 / 年分级', () => {
    expect(formatRelativeTime(NOW - 5 * 60 * 1000, NOW)).toBe('5 分钟前')
    expect(formatRelativeTime(NOW - 3 * 3600 * 1000, NOW)).toBe('3 小时前')
    expect(formatRelativeTime(NOW - 7 * 86400 * 1000, NOW)).toBe('7 天前')
    expect(formatRelativeTime(NOW - 60 * 86400 * 1000, NOW)).toBe('2 个月前')
    expect(formatRelativeTime(NOW - 400 * 86400 * 1000, NOW)).toBe('1 年前')
  })

  it('支持 ISO 字符串、时间戳与 Date', () => {
    const iso = new Date(NOW - 2 * 86400 * 1000).toISOString()
    expect(formatRelativeTime(iso, NOW)).toBe('2 天前')
    expect(formatRelativeTime(new Date(NOW - 2 * 86400 * 1000), NOW)).toBe('2 天前')
  })

  it('非法时间返回占位符', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('—')
  })
})

describe('formatDateTime', () => {
  it('格式化为 YYYY-MM-DD HH:mm:ss', () => {
    const d = new Date(2026, 7, 20, 9, 5, 3)
    expect(formatDateTime(d)).toBe('2026-08-20 09:05:03')
  })

  it('非法时间返回占位符', () => {
    expect(formatDateTime('not-a-date')).toBe('—')
  })
})
