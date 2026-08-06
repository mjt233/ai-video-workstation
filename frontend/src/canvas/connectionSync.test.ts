import { describe, expect, it } from 'vitest'
import { applyConnectionSync } from './connectionSync'
import { createCanvasData, type CanvasConnection, type CanvasData } from './types'

const imgConn: CanvasConnection = { id: 'c1', fromNodeId: 'img1', fromPortId: 'out', toNodeId: 'vg', toPortId: 'in' }
const audConn: CanvasConnection = { id: 'c2', fromNodeId: 'aud1', fromPortId: 'out', toNodeId: 'vg', toPortId: 'in' }

function baseData(): CanvasData {
  const data = createCanvasData('scene')
  data.nodes = [
    { id: 'img1', prototypeId: 'image-loader', name: 'i', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'aud1', prototypeId: 'audio-loader', name: 'a', x: 0, y: 0, width: 200, height: 120, config: {} },
    {
      id: 'vg',
      prototypeId: 'video-generate',
      name: '生成视频',
      x: 0, y: 0, width: 240, height: 160,
      config: {
        mode: 'director',
        director: { duration: 10, width: 1080, height: 1920, fps: 24, imageClips: [], audioClips: [] },
      },
    },
  ]
  return data
}

describe('applyConnectionSync', () => {
  it('连接图片来源节点自动追加 imageClip（不重复）', () => {
    let data = baseData()
    data = applyConnectionSync(data, { type: 'connect', connection: imgConn })
    const d = data.nodes.find((n) => n.id === 'vg')!.config.director as { imageClips: Array<{ sourceNodeId: string; startOffset: number }> }
    expect(d.imageClips).toHaveLength(1)
    expect(d.imageClips[0].sourceNodeId).toBe('img1')
    // 幂等：再次连接不重复
    data = applyConnectionSync(data, { type: 'connect', connection: imgConn })
    expect((data.nodes.find((n) => n.id === 'vg')!.config.director as { imageClips: unknown[] }).imageClips).toHaveLength(1)
  })

  it('连接音频来源节点自动追加 audioClip', () => {
    let data = baseData()
    data = applyConnectionSync(data, { type: 'connect', connection: audConn })
    const d = data.nodes.find((n) => n.id === 'vg')!.config.director as { audioClips: Array<{ sourceNodeId: string }> }
    expect(d.audioClips).toHaveLength(1)
    expect(d.audioClips[0].sourceNodeId).toBe('aud1')
  })

  it('断开连线移除对应 clip，且保留用户已调位置的其他 clip', () => {
    let data = baseData()
    data = applyConnectionSync(data, { type: 'connect', connection: imgConn })
    data = applyConnectionSync(data, { type: 'connect', connection: audConn })
    // 用户拖动 audioClip 的 startOffset
    const vg = data.nodes.find((n) => n.id === 'vg')!
    const director = vg.config.director as { audioClips: Array<{ id: string; startOffset: number }> }
    director.audioClips[0].startOffset = 7.5
    data.nodes = data.nodes.map((n) => (n.id === 'vg' ? vg : n))

    data = applyConnectionSync(data, { type: 'disconnect', connection: audConn })
    const after = data.nodes.find((n) => n.id === 'vg')!.config.director as {
      imageClips: Array<{ sourceNodeId: string }>
      audioClips: unknown[]
    }
    expect(after.audioClips).toHaveLength(0)
    expect(after.imageClips).toHaveLength(1)
    expect(after.imageClips[0].sourceNodeId).toBe('img1')
  })
})
