import { describe, expect, it, vi, type Mock } from 'vitest'
import { canvasRelPath, loadCanvas, saveCanvas, CanvasVersionError } from './api'

vi.mock('../api/client', () => ({
  readFs: vi.fn(),
  default: { post: vi.fn(), put: vi.fn() },
}))

import client, { readFs } from '../api/client'

const validRaw = JSON.stringify({
  version: 1,
  rev: 5,
  kind: 'scene',
  nodes: [],
  connections: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('canvasRelPath', () => {
  it('场景画布路径（含子场景标签）', () => {
    expect(canvasRelPath({ kind: 'stage', stage: '街角', label: '白天' })).toBe('prompt/stage/街角/canvas/白天.json')
  })

  it('分镜画布路径', () => {
    expect(canvasRelPath({ kind: 'scene', episode: '2', shot: '5' })).toBe('prompt/scene/2/5/canvas.json')
  })

  it('缺少 stage 抛错', () => {
    expect(() => canvasRelPath({ kind: 'stage' })).toThrow()
  })

  it('场景画布缺少 label 抛错', () => {
    expect(() => canvasRelPath({ kind: 'stage', stage: '街角' })).toThrow()
  })

  it('缺少 episode/shot 抛错', () => {
    expect(() => canvasRelPath({ kind: 'scene', episode: '1' })).toThrow()
  })
})

describe('loadCanvas', () => {
  it('读取并解析合法 JSON，返回版本号', async () => {
    (readFs as Mock).mockResolvedValue(validRaw)
    const result = await loadCanvas('p', { kind: 'scene', episode: '1', shot: '1' })
    expect(result?.canvas.kind).toBe('scene')
    expect(result?.canvas.nodes).toEqual([])
    expect(result?.rev).toBe(5)
  })

  it('文件不存在返回 null', async () => {
    (readFs as Mock).mockRejectedValue(new Error('ENOENT'))
    const result = await loadCanvas('p', { kind: 'scene', episode: '1', shot: '1' })
    expect(result).toBeNull()
  })

  it('非法 JSON 返回 null', async () => {
    (readFs as Mock).mockResolvedValue('not json{{{')
    const result = await loadCanvas('p', { kind: 'scene', episode: '1', shot: '1' })
    expect(result).toBeNull()
  })

  it('readFs 返回已解析对象时直接使用（axios 自动 JSON.parse 的真实行为）', async () => {
    (readFs as Mock).mockResolvedValue(JSON.parse(validRaw))
    const result = await loadCanvas('p', { kind: 'scene', episode: '1', shot: '1' })
    expect(result?.canvas.kind).toBe('scene')
    expect(result?.rev).toBe(5)
  })

  it('无 rev 字段的旧文件按 0 处理', async () => {
    (readFs as Mock).mockResolvedValue(JSON.parse(JSON.stringify({ ...JSON.parse(validRaw), rev: undefined })))
    const result = await loadCanvas('p', { kind: 'scene', episode: '1', shot: '1' })
    expect(result?.rev).toBe(0)
  })
})

describe('saveCanvas（CAS）', () => {
  const data = { kind: 'scene' as const, nodes: [], connections: [] }

  it('提交 expectedRev / force / 目标参数，返回新版本号', async () => {
    (client.put as Mock).mockResolvedValue({ data: { success: true, rev: 6, updatedAt: '2026-01-02T00:00:00.000Z' } })
    const result = await saveCanvas('p', { kind: 'scene', episode: '1', shot: '1' }, data as never, { expectedRev: 5 })
    expect(client.put).toHaveBeenCalledWith('/canvas/def', expect.objectContaining({
      project: 'p',
      kind: 'scene',
      episode: '1',
      shot: '1',
      expectedRev: 5,
      force: false,
      data,
    }))
    expect(result).toEqual({ rev: 6, updatedAt: '2026-01-02T00:00:00.000Z' })
  })

  it('force 模式透传 force=true', async () => {
    (client.put as Mock).mockResolvedValue({ data: { success: true, rev: 7, updatedAt: 'x' } })
    await saveCanvas('p', { kind: 'stage', stage: '街角', label: '白天' }, data as never, { expectedRev: 6, force: true })
    expect(client.put).toHaveBeenCalledWith('/canvas/def', expect.objectContaining({ force: true, stage: '街角', label: '白天' }))
  })

  it('409 VERSION_CONFLICT 抛 CanvasVersionError（含当前版本）', async () => {
    const err = new Error('冲突')
    ;(err as { response?: unknown }).response = {
      status: 409,
      data: { code: 'VERSION_CONFLICT', error: '画布保存冲突', currentRev: 9, expectedRev: 5 },
    }
    ;(client.put as Mock).mockRejectedValue(err)
    await expect(saveCanvas('p', { kind: 'scene', episode: '1', shot: '1' }, data as never, { expectedRev: 5 }))
      .rejects.toBeInstanceOf(CanvasVersionError)
    await expect(saveCanvas('p', { kind: 'scene', episode: '1', shot: '1' }, data as never, { expectedRev: 5 }))
      .rejects.toMatchObject({ currentRev: 9, expectedRev: 5 })
  })
})
