import { describe, expect, it } from 'vitest'
import {
  MAX_TEXT_HISTORY_VERSIONS,
  appendTextHistory,
  createTextHistoryEntry,
  readTextHistory,
  removeTextHistory,
  type AiTextHistoryEntry,
} from './aiTextHistory'

describe('aiTextHistory', () => {
  /** 构造一条测试版本（id 可指定，便于断言） */
  function entry(partial: Partial<AiTextHistoryEntry> & { id: string }): AiTextHistoryEntry {
    return {
      createdAt: '2026-01-01T00:00:00.000Z',
      input: '输入',
      output: '输出',
      ...partial,
    }
  }

  it('readTextHistory：无字段/非数组/空数组均回退为空', () => {
    expect(readTextHistory(undefined)).toEqual([])
    expect(readTextHistory(null)).toEqual([])
    expect(readTextHistory({})).toEqual([])
    expect(readTextHistory({ outputHistory: 'oops' })).toEqual([])
    expect(readTextHistory({ outputHistory: [] })).toEqual([])
  })

  it('readTextHistory：过滤结构非法的条目，可选元信息类型非法时丢弃', () => {
    const config = {
      outputHistory: [
        entry({ id: 'a', input: 'A', output: '答A' }),
        { id: 1, createdAt: '2026-01-01T00:00:00.000Z', input: 'x', output: 'y' }, // id 非法
        { id: 'b', createdAt: '2026-01-01T00:00:00.000Z' }, // 缺 input/output
        entry({ id: 'c', input: 'C', output: '答C', modelName: 'm1', presetName: 'p1' }),
        // mediaLabels 元素非法（含数字）→ 丢弃该元信息，条目保留（绕过类型检查模拟脏数据）
        ({ id: 'd', createdAt: '2026-01-01T00:00:00.000Z', input: 'D', output: '答D', mediaLabels: ['a.jpg', 3] }) as unknown,
      ],
    }
    expect(readTextHistory(config)).toEqual([
      expect.objectContaining({ id: 'a' }),
      expect.objectContaining({ id: 'c', modelName: 'm1', presetName: 'p1' }),
      expect.objectContaining({ id: 'd' }),
    ])
    expect(readTextHistory(config)[2].mediaLabels).toBeUndefined()
  })

  it('createTextHistoryEntry：生成 id/createdAt 与可选元信息', () => {
    const a = createTextHistoryEntry('输入', '输出')
    expect(typeof a.id).toBe('string')
    expect(a.id.length).toBeGreaterThan(0)
    expect(a.createdAt).toBeTruthy()
    expect(() => new Date(a.createdAt).toISOString()).not.toThrow()
    expect(a.input).toBe('输入')
    expect(a.output).toBe('输出')
    expect(a.modelName).toBeUndefined()

    const b = createTextHistoryEntry('输入', '输出', { modelName: 'gemini', presetName: '改写', mediaLabels: ['图1.jpg'] })
    expect(b.modelName).toBe('gemini')
    expect(b.presetName).toBe('改写')
    expect(b.mediaLabels).toEqual(['图1.jpg'])

    const c = createTextHistoryEntry('输入', '输出', { mediaLabels: [] })
    expect(c.mediaLabels).toBeUndefined()
  })

  it('appendTextHistory：新版本追加到末尾', () => {
    const base = [entry({ id: 'a' })]
    const next = appendTextHistory(base, entry({ id: 'b' }))
    expect(next.map((e) => e.id)).toEqual(['a', 'b'])
    expect(base).toHaveLength(1) // 不改动入参数组
  })

  it('appendTextHistory：超出上限时丢弃最旧', () => {
    const base = Array.from({ length: MAX_TEXT_HISTORY_VERSIONS }, (_, i) => entry({ id: `v${i}` }))
    const next = appendTextHistory(base, entry({ id: 'new' }))
    expect(next).toHaveLength(MAX_TEXT_HISTORY_VERSIONS)
    expect(next[0].id).toBe('v1') // v0 被丢弃
    expect(next[next.length - 1].id).toBe('new')
  })

  it('removeTextHistory：删除指定 id', () => {
    const list = [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' })]
    expect(removeTextHistory(list, 'b').map((e) => e.id)).toEqual(['a', 'c'])
    expect(removeTextHistory(list, 'c').map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('removeTextHistory：id 不存在时返回原数组引用', () => {
    const list = [entry({ id: 'a' })]
    expect(removeTextHistory(list, 'zzz')).toBe(list)
  })
})
