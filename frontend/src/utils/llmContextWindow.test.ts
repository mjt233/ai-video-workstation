import { describe, expect, it } from 'vitest'
import { formatContextWindow, isValidContextWindow, parseContextWindow } from './llmContextWindow'

describe('parseContextWindow', () => {
  it('纯数字 / K / M（大小写不敏感，支持小数）', () => {
    expect(parseContextWindow('128000')).toBe(128000)
    expect(parseContextWindow('128K')).toBe(128000)
    expect(parseContextWindow('1m')).toBe(1000000)
    expect(parseContextWindow('1.5M')).toBe(1500000)
  })

  it('非法输入返回 null', () => {
    expect(parseContextWindow('')).toBeNull()
    expect(parseContextWindow('abc')).toBeNull()
    expect(parseContextWindow('-1K')).toBeNull()
  })
})

describe('formatContextWindow', () => {
  it('优先 K / M 展示', () => {
    expect(formatContextWindow('128000')).toBe('128K')
    expect(formatContextWindow('1000000')).toBe('1M')
    expect(formatContextWindow('1500000')).toBe('1.5M')
    expect(formatContextWindow(32768)).toBe('32.8K')
    expect(formatContextWindow(256)).toBe('256')
  })

  it('空/非法输入', () => {
    expect(formatContextWindow('')).toBe('')
    expect(formatContextWindow(undefined)).toBe('')
    expect(formatContextWindow('abc')).toBe('abc')
  })
})

describe('isValidContextWindow', () => {
  it('空串或合法格式为 true', () => {
    expect(isValidContextWindow('')).toBe(true)
    expect(isValidContextWindow('128K')).toBe(true)
    expect(isValidContextWindow('1.5M')).toBe(true)
    expect(isValidContextWindow('12.3.4')).toBe(false)
  })
})
