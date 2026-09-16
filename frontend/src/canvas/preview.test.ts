import { describe, expect, it } from 'vitest'
import { buildPreviewUrl, mediaKindOfPath } from './preview'

describe('buildPreviewUrl', () => {
  it('无版本时以时间戳防缓存', () => {
    const url = buildPreviewUrl('AI的第一天', 'assert/scene/1/1/canvas/a.jpg')
    expect(url.startsWith('/api/fs/AI的第一天/assert/scene/1/1/canvas/a.jpg?t=')).toBe(true)
  })

  it('带版本时以版本作缓存键', () => {
    expect(buildPreviewUrl('p', 'assert/a/b.jpg', 3)).toBe('/api/fs/p/assert/a/b.jpg?t=v3')
  })
})

describe('mediaKindOfPath', () => {
  it('按扩展名识别图片 / 视频 / 音频', () => {
    expect(mediaKindOfPath('assert/scene/1/1/canvas/n1/output.jpg')).toBe('image')
    expect(mediaKindOfPath('assert/scene/1/1/canvas/n1/output.PNG')).toBe('image')
    expect(mediaKindOfPath('assert/scene/1/1/canvas/n1/output.mp4')).toBe('video')
    expect(mediaKindOfPath('assert/scene/1/1/canvas/n1/output.flac')).toBe('audio')
    expect(mediaKindOfPath('assert\\scene\\1\\1\\canvas\\n1\\output.webp')).toBe('image')
  })

  it('空路径或未知扩展名 → none（失败任务无产物、非媒体产物）', () => {
    expect(mediaKindOfPath('')).toBe('none')
    expect(mediaKindOfPath(null)).toBe('none')
    expect(mediaKindOfPath(undefined)).toBe('none')
    expect(mediaKindOfPath('assert/x/output')).toBe('none')
    expect(mediaKindOfPath('assert/x/output.json')).toBe('none')
  })
})

