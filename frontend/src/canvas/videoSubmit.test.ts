import { describe, expect, it } from 'vitest'
import { buildVideoSubmitParams } from './videoSubmit'
import type { CanvasNodeData } from './types'
import type { CanvasInputInfo } from './generate'

const mkNode = (config: Record<string, unknown>): CanvasNodeData => ({
  id: 'vg',
  prototypeId: 'video-generate',
  name: '生成视频',
  x: 0,
  y: 0,
  width: 240,
  height: 160,
  config,
})

const mkInput = (nodeId: string, path: string): CanvasInputInfo => ({ nodeId, path, label: path })

describe('buildVideoSubmitParams', () => {
  it('导演台模式：imageClips 按 startOffset 生成 frames，含 audio', () => {
    const node = mkNode({
      mode: 'director',
      prompt: 'p',
      director: {
        duration: 10,
        width: 1080,
        height: 1920,
        fps: 24,
        imageClips: [
          { id: 'a', sourceNodeId: 'img1', startOffset: 4, duration: 2 },
          { id: 'b', sourceNodeId: 'img2', startOffset: 0, duration: 2 },
        ],
        audioClips: [{ id: 'c', sourceNodeId: 'aud1', startOffset: 0, trimStart: 0, trimEnd: 0, duration: 3 }],
      },
      workflowParams: { seed: '42' },
    })
    const inputs = {
      images: [mkInput('img1', 'assert/a.png'), mkInput('img2', 'assert/b.png')],
      videos: [],
      audios: [mkInput('aud1', 'assert/c.flac')],
    }
    const params = buildVideoSubmitParams(node, inputs)
    expect(params.mode).toBe('director')
    expect(params.duration).toBe(10)
    expect(params.resolution).toEqual({ width: 1080, height: 1920 })
    // frames 按 startOffset 升序：img2(0) 在前
    expect(params.director?.frames.map((f) => f.path)).toEqual(['assert/b.png', 'assert/a.png'])
    expect(params.director?.frames[0].cursor).toBe(0)
    expect(params.director?.frames[1].cursor).toBeCloseTo(0.4)
    expect(params.director?.audio?.path).toBe('assert/c.flac')
    // 字符串 seed 转数字并从 extraParams 剥离
    expect(params.seed).toBe(42)
    expect(params.extraParams).toEqual({})
  })

  it('首尾帧模式：cursor 自动均匀分布', () => {
    const node = mkNode({
      mode: 'first-last-frame',
      prompt: 'p',
      director: {
        duration: 6,
        width: 1080,
        height: 1920,
        fps: 24,
        imageClips: [
          { id: 'a', sourceNodeId: 'img1', startOffset: 0, duration: 2 },
          { id: 'b', sourceNodeId: 'img2', startOffset: 2, duration: 2 },
          { id: 'c', sourceNodeId: 'img3', startOffset: 4, duration: 2 },
        ],
        audioClips: [],
      },
      workflowParams: {},
    })
    const inputs = {
      images: [mkInput('img1', 'assert/1.png'), mkInput('img2', 'assert/2.png'), mkInput('img3', 'assert/3.png')],
      videos: [],
      audios: [],
    }
    const params = buildVideoSubmitParams(node, inputs)
    expect(params.mode).toBe('first-last-frame')
    const cursors = params.director?.frames.map((f) => f.cursor)
    expect(cursors).toEqual([0, 0.5, 1])
  })

  it('参考模式：按 inputOrder 过滤分组生成有序 references', () => {
    const node = mkNode({
      mode: 'reference',
      prompt: 'p',
      inputOrder: ['aud1', 'img2', 'img1', 'vid1'],
      duration: 5,
      resolution: { width: 720, height: 1280 },
      workflowParams: {},
    })
    const inputs = {
      images: [mkInput('img1', 'assert/1.png'), mkInput('img2', 'assert/2.png')],
      videos: [mkInput('vid1', 'assert/v.mp4')],
      audios: [mkInput('aud1', 'assert/a.flac')],
    }
    const params = buildVideoSubmitParams(node, inputs)
    expect(params.mode).toBe('reference')
    // 图片组顺序按 inputOrder 中 img2 在 img1 之前
    expect(params.references?.filter((r) => r.type === 'image').map((r) => r.path)).toEqual(['assert/2.png', 'assert/1.png'])
    expect(params.references?.filter((r) => r.type === 'video').map((r) => r.path)).toEqual(['assert/v.mp4'])
    expect(params.references?.filter((r) => r.type === 'audio').map((r) => r.path)).toEqual(['assert/a.flac'])
    expect(params.resolution).toEqual({ width: 720, height: 1280 })
    expect(params.duration).toBe(5)
  })
})
