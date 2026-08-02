import { describe, expect, it, vi, type Mock } from 'vitest'
import { canvasRelPath, loadCanvas, saveCanvas } from './api'

vi.mock('../api/client', () => ({
  readFs: vi.fn(),
  writeFs: vi.fn(),
}))

import { readFs, writeFs } from '../api/client'

const validRaw = JSON.stringify({
  version: 1,
  kind: 'scene',
  nodes: [],
  connections: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('canvasRelPath', () => {
  it('场景画布路径', () => {
    expect(canvasRelPath({ kind: 'stage', stage: '街角' })).toBe('prompt/stage/街角/canvas.json')
  })

  it('分镜画布路径', () => {
    expect(canvasRelPath({ kind: 'scene', episode: '2', shot: '5' })).toBe('prompt/scene/2/5/canvas.json')
  })

  it('缺少 stage 抛错', () => {
    expect(() => canvasRelPath({ kind: 'stage' })).toThrow()
  })

  it('缺少 episode/shot 抛错', () => {
    expect(() => canvasRelPath({ kind: 'scene', episode: '1' })).toThrow()
  })
})

describe('loadCanvas', () => {
  it('读取并解析合法 JSON', async () => {
    (readFs as Mock).mockResolvedValue(validRaw)
    const data = await loadCanvas('p', { kind: 'scene', episode: '1', shot: '1' })
    expect(data?.kind).toBe('scene')
    expect(data?.nodes).toEqual([])
  })

  it('文件不存在返回 null', async () => {
    (readFs as Mock).mockRejectedValue(new Error('ENOENT'))
    const data = await loadCanvas('p', { kind: 'scene', episode: '1', shot: '1' })
    expect(data).toBeNull()
  })

  it('非法 JSON 返回 null', async () => {
    (readFs as Mock).mockResolvedValue('not json{{{')
    const data = await loadCanvas('p', { kind: 'scene', episode: '1', shot: '1' })
    expect(data).toBeNull()
  })
})

describe('saveCanvas', () => {
  it('序列化写入 canvas.json', async () => {
    (writeFs as Mock).mockResolvedValue({ success: true })
    const data = { ...(JSON.parse(validRaw) as object), nodes: [], connections: [] }
    await saveCanvas('p', { kind: 'scene', episode: '1', shot: '1' }, data as never)
    expect(writeFs).toHaveBeenCalledWith('p', 'prompt/scene/1/1/canvas.json', expect.stringContaining('"kind": "scene"'))
  })
})
