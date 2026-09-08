import { describe, expect, it } from 'vitest'
import { formatBytes } from './formatBytes'

describe('formatBytes', () => {
  it('零值与非法值显示 0 B', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })

  it('小于 1 KB 显示整数 B', () => {
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('按 1024 进制换算并保留 1 位小数', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.5 MB')
    expect(formatBytes(1024 ** 3 * 2.25)).toBe('2.3 GB')
  })

  it('数值 >= 100 时取整', () => {
    expect(formatBytes(1024 * 100)).toBe('100 KB')
    expect(formatBytes(1024 * 1024 * 150.4)).toBe('150 MB')
  })

  it('超大值封顶到 TB', () => {
    expect(formatBytes(1024 ** 5)).toBe('1024 TB')
  })
})
