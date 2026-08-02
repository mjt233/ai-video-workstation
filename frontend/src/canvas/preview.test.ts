import { describe, expect, it } from 'vitest'
import { buildPreviewUrl } from './preview'

describe('buildPreviewUrl', () => {
  it('无版本时以时间戳防缓存', () => {
    const url = buildPreviewUrl('AI的第一天', 'assert/scene/1/1/canvas/a.jpg')
    expect(url.startsWith('/api/fs/AI的第一天/assert/scene/1/1/canvas/a.jpg?t=')).toBe(true)
  })

  it('带版本时以版本作缓存键', () => {
    expect(buildPreviewUrl('p', 'assert/a/b.jpg', 3)).toBe('/api/fs/p/assert/a/b.jpg?t=v3')
  })
})
