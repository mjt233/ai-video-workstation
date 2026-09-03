import { describe, expect, it } from 'vitest'
import type { CanvasNodeData } from './types'
import {
  GROUP_DOT_ID,
  GROUP_FRAME_ID,
  computeGroupRect,
  dataTypeLabel,
  findNodeAt,
  groupConnectOptions,
  groupDotPosition,
  groupOutputTypes,
  isSyntheticNodeId,
  remapNodeConfig,
} from './groupSelection'

/** 构造最小节点数据（按原型默认 240×160） */
function makeNode(id: string, x: number, y: number, prototypeId = 'text', width = 240, height = 160): CanvasNodeData {
  return { id, prototypeId, name: id, x, y, width, height, config: {} }
}

describe('isSyntheticNodeId', () => {
  it('识别群组框/输出点合成 id，真实节点 id 不算', () => {
    expect(isSyntheticNodeId(GROUP_FRAME_ID)).toBe(true)
    expect(isSyntheticNodeId(GROUP_DOT_ID)).toBe(true)
    expect(isSyntheticNodeId('n1')).toBe(false)
  })
})

describe('computeGroupRect', () => {
  it('空列表返回 null', () => {
    expect(computeGroupRect([])).toBeNull()
  })

  it('计算多个节点的包围盒（取 min 左上角与 max 右下角）', () => {
    const rect = computeGroupRect([
      makeNode('a', 10, 20, 'text', 240, 160),
      makeNode('b', 100, 50, 'text', 200, 100),
      makeNode('c', -5, 30, 'text', 50, 50),
    ])
    expect(rect).toEqual({ x: -5, y: 20, width: 305, height: 160 })
  })

  it('单节点时包围盒即节点本身', () => {
    const rect = computeGroupRect([makeNode('a', 100, 200, 'text', 240, 160)])
    expect(rect).toEqual({ x: 100, y: 200, width: 240, height: 160 })
  })

  it('padding：包围盒四周外扩指定留白', () => {
    const rect = computeGroupRect([makeNode('a', 100, 200, 'text', 240, 160)], 12)
    expect(rect).toEqual({ x: 88, y: 188, width: 264, height: 184 })
  })
})

describe('groupDotPosition', () => {
  it('输出点位于包围盒右边缘垂直居中', () => {
    const pos = groupDotPosition({ x: 0, y: 0, width: 300, height: 200 }, 16)
    expect(pos).toEqual({ x: 292, y: 92 })
  })
})

describe('findNodeAt', () => {
  const nodes = [
    makeNode('a', 0, 0, 'text', 240, 160),
    makeNode('b', 300, 0, 'text', 240, 160),
  ]

  it('命中包含该点的节点', () => {
    expect(findNodeAt({ x: 100, y: 80 }, nodes, new Set())?.id).toBe('a')
    expect(findNodeAt({ x: 400, y: 10 }, nodes, new Set())?.id).toBe('b')
  })

  it('排除集合内的节点不命中', () => {
    expect(findNodeAt({ x: 100, y: 80 }, nodes, new Set(['a']))).toBeUndefined()
  })

  it('点在全部节点之外返回 undefined', () => {
    expect(findNodeAt({ x: 1000, y: 1000 }, nodes, new Set())).toBeUndefined()
  })
})

describe('groupOutputTypes', () => {
  it('按原型输出端口去重收集', () => {
    const types = groupOutputTypes([
      makeNode('img', 0, 0, 'image-loader'),
      makeNode('gen', 0, 0, 'image-generate'),
      makeNode('vid', 0, 0, 'video-loader'),
      makeNode('aud', 0, 0, 'audio-loader'),
    ])
    expect(types).toEqual(['image', 'video', 'audio'])
  })
})

describe('groupConnectOptions', () => {
  it('列出全部有输入端口的原型，兼容性按输出类型判定', () => {
    const options = groupConnectOptions(['image'])
    const map = Object.fromEntries(options.map((o) => [o.prototypeId, o]))
    // image 输出可连 生成图片（image）、生成视频（media）、获取视频帧？——帧节点输入为 video，不兼容
    expect(map['image-generate'].compatible).toBe(true)
    expect(map['video-generate'].compatible).toBe(true)
    expect(map['tts-generate'].compatible).toBe(false)
    expect(map['video-frame-extract'].compatible).toBe(false)
    expect(map['video-concat'].compatible).toBe(false)
    expect(map['video-trim'].compatible).toBe(false)
    // 不兼容项含原因说明
    expect(map['tts-generate'].reason).toContain('音频')
  })

  it('media 输入口（生成视频）兼容任意输出类型', () => {
    const options = groupConnectOptions(['audio', 'video', 'text'])
    expect(options.find((o) => o.prototypeId === 'video-generate')!.compatible).toBe(true)
  })

  it('audio 输出可连 TTS 与生成视频', () => {
    const options = groupConnectOptions(['audio'])
    const map = Object.fromEntries(options.map((o) => [o.prototypeId, o]))
    expect(map['tts-generate'].compatible).toBe(true)
    expect(map['video-generate'].compatible).toBe(true)
    expect(map['image-generate'].compatible).toBe(false)
  })

  it('不包含无输入口的原型（加载类/文本）', () => {
    const options = groupConnectOptions(['image'])
    expect(options.some((o) => o.prototypeId === 'image-loader')).toBe(false)
    expect(options.some((o) => o.prototypeId === 'text')).toBe(false)
  })
})

describe('dataTypeLabel', () => {
  it('返回中文类型名', () => {
    expect(dataTypeLabel('image')).toBe('图片')
    expect(dataTypeLabel('video')).toBe('视频')
    expect(dataTypeLabel('audio')).toBe('音频')
    expect(dataTypeLabel('text')).toBe('文本')
    expect(dataTypeLabel('media')).toBe('媒体')
  })
})

describe('remapNodeConfig', () => {
  it('重映射 inputOrder 中的旧节点 id', () => {
    const config = remapNodeConfig(
      { inputOrder: ['a', 'b', 'external'] },
      new Map([['a', 'a2'], ['b', 'b2']]),
    )
    expect(config.inputOrder).toEqual(['a2', 'b2', 'external'])
  })

  it('重映射导演台素材块 sourceNodeId', () => {
    const config = remapNodeConfig(
      {
        inputOrder: [],
        director: {
          imageClips: [{ id: 'ic1', sourceNodeId: 'a', startOffset: 0, duration: 2 }],
          audioClips: [{ id: 'ac1', sourceNodeId: 'b', startOffset: 0, trimStart: 0, trimEnd: 0, duration: 3 }],
        },
      },
      new Map([['a', 'a2'], ['b', 'b2']]),
    )
    const director = config.director as { imageClips: Array<{ sourceNodeId: string }>; audioClips: Array<{ sourceNodeId: string }> }
    expect(director.imageClips[0].sourceNodeId).toBe('a2')
    expect(director.audioClips[0].sourceNodeId).toBe('b2')
  })

  it('无引用字段时原样保留（含未命中 id）', () => {
    const config = remapNodeConfig(
      { prompt: '你好', inputOrder: ['keep'] },
      new Map([['other', 'new']]),
    )
    expect(config.prompt).toBe('你好')
    expect(config.inputOrder).toEqual(['keep'])
  })
})
