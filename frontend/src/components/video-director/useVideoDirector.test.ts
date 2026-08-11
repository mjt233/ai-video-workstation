import { describe, expect, it, vi } from 'vitest'
import {
  previewImageAt,
  computePasteOffset,
  frameCursors,
  resolveImageStartOffset,
  useVideoDirector,
} from './useVideoDirector'
import type { DirectorProject } from './types'

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

describe('resolveImageStartOffset', () => {
  it('无其他块 → 返回 desired（钳制到轨道内可放置范围）', () => {
    expect(resolveImageStartOffset([], 10, 3, 2)).toBe(3)
    expect(resolveImageStartOffset([], 10, 9.5, 2)).toBe(8)
  })
  it('期望位置在空闲区间内 → 原样返回', () => {
    const others = [
      { startOffset: 0, duration: 2 },
      { startOffset: 4, duration: 2 },
    ]
    // 空闲区间 [2,4]，1s 块可从 3 开始
    expect(resolveImageStartOffset(others, 10, 3, 1)).toBe(3)
  })
  it('期望位置落在占用区间 → 钳到占用块之后', () => {
    const others = [{ startOffset: 0, duration: 2 }]
    expect(resolveImageStartOffset(others, 10, 1, 2)).toBe(2)
  })
  it('空闲区间恰好放下 → 放最后一个占用块末尾', () => {
    const others = [
      { startOffset: 0, duration: 4 },
      { startOffset: 4, duration: 4 },
    ]
    // 轨道 10s，两块占满 [0,8]，剩余 [8,10] 只够放 2s 块 → 8
    expect(resolveImageStartOffset(others, 10, 5, 2)).toBe(8)
  })
  it('轨道已满（无任何空闲区间）→ 返回 null', () => {
    const others = [
      { startOffset: 0, duration: 4 },
      { startOffset: 4, duration: 4 },
    ]
    // 轨道 8s，两块恰好占满 [0,8]，2s 块无处可放
    expect(resolveImageStartOffset(others, 8, 3, 2)).toBeNull()
  })
})

describe('correctAudioClipDuration', () => {
  /** 构造带指定音频块的导演台项目 */
  function projectWith(audioClips: Array<{ path: string; duration: number }>): DirectorProject {
    return {
      version: 1,
      duration: 10,
      width: 1080,
      height: 720,
      fps: 24,
      imageClips: [],
      audioClips: audioClips.map((c, i) => ({
        id: `a${i}`,
        path: c.path,
        startOffset: 0,
        duration: c.duration,
        trimStart: 0,
        trimEnd: 0,
      })),
    }
  }

  it('命中匹配 path 且时长不同 → 校正并触发 onChange 一次', () => {
    const onChange = vi.fn()
    const d = useVideoDirector({ onChange })
    d.syncFromProject(projectWith([{ path: 'assert/audio/1.flac', duration: 2 }]))
    d.correctAudioClipDuration('assert/audio/1.flac', 5)
    expect(d.toProject().audioClips[0].duration).toBe(5)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('时长已一致 → no-op（不触发 onChange）', () => {
    const onChange = vi.fn()
    const d = useVideoDirector({ onChange })
    d.syncFromProject(projectWith([{ path: 'assert/audio/1.flac', duration: 5 }]))
    d.correctAudioClipDuration('assert/audio/1.flac', 5)
    expect(d.toProject().audioClips[0].duration).toBe(5)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('不影响其它 path 的音频块', () => {
    const onChange = vi.fn()
    const d = useVideoDirector({ onChange })
    d.syncFromProject(
      projectWith([
        { path: 'assert/audio/1.flac', duration: 2 },
        { path: 'assert/audio/2.flac', duration: 5 },
      ]),
    )
    d.correctAudioClipDuration('assert/audio/1.flac', 5)
    const clips = d.toProject().audioClips
    expect(clips[0].duration).toBe(5)
    expect(clips[1].duration).toBe(5)
  })
})
