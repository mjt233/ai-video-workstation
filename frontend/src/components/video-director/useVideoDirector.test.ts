import { describe, expect, it } from 'vitest'
import { previewImageAt, computePasteOffset, frameCursors } from './useVideoDirector'

const clips = [
  { id: 'a', path: 'assert/1.jpg', startOffset: 0, duration: 2 },
  { id: 'b', path: 'assert/2.jpg', startOffset: 3, duration: 2 },
]

describe('previewImageAt', () => {
  it('无块或 t 之前无块 → null', () => {
    expect(previewImageAt([], 1)).toBeNull()
  })
  it('命中最后一个 startOffset <= t 的块', () => {
    expect(previewImageAt(clips, 1.5)).toBe('assert/1.jpg')
    expect(previewImageAt(clips, 3)).toBe('assert/2.jpg')
    expect(previewImageAt(clips, 3.5)).toBe('assert/2.jpg')
  })
})

describe('computePasteOffset', () => {
  it('粘贴到选中块 startOffset + 1', () => {
    expect(computePasteOffset({ startOffset: 4 } as never)).toBe(5)
  })
})

describe('frameCursors', () => {
  it('按 startOffset 排序映射 cursor', () => {
    expect(
      frameCursors(
        [
          { id: 'a', path: 'assert/a.jpg', startOffset: 3, duration: 1 },
          { id: 'b', path: 'assert/b.jpg', startOffset: 0, duration: 1 },
        ],
        10,
      ),
    ).toEqual([0, 0.3])
  })
})
