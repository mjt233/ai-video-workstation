import { describe, expect, it } from 'vitest'
import type { CanvasConnection, CanvasNodeData } from './types'
import { canConnect, canConnectNodes, getNodeInputPortType, getNodeInputType, getNodeOutputType, wouldCreateCycle } from './connection'

const nodes: CanvasNodeData[] = [
  { id: 'loader', prototypeId: 'image-loader', name: '加载', x: 0, y: 0, width: 10, height: 10, config: {} },
  { id: 'gen', prototypeId: 'image-generate', name: '生成', x: 0, y: 0, width: 10, height: 10, config: {} },
  { id: 'text', prototypeId: 'text', name: '文本', x: 0, y: 0, width: 10, height: 10, config: {} },
]

describe('canConnect', () => {
  it('同类型兼容', () => {
    expect(canConnect('image', 'image')).toBe(true)
    expect(canConnect('text', 'text')).toBe(true)
  })

  it('不同类型不兼容', () => {
    expect(canConnect('image', 'text')).toBe(false)
  })

  it('media 输入口接受任意类型', () => {
    expect(canConnect('image', 'media')).toBe(true)
    expect(canConnect('video', 'media')).toBe(true)
    expect(canConnect('audio', 'media')).toBe(true)
    expect(canConnect('text', 'media')).toBe(true)
  })

  it('media 仅作输入口，不能作为来源连接到具体类型', () => {
    expect(canConnect('media', 'image')).toBe(false)
  })
})

describe('getNodeOutputType / getNodeInputType', () => {
  it('加载图片输出 image', () => {
    expect(getNodeOutputType('loader', nodes)).toBe('image')
  })

  it('生成图片输入 image', () => {
    expect(getNodeInputType('gen', nodes)).toBe('image')
  })

  it('文本输出 text', () => {
    expect(getNodeOutputType('text', nodes)).toBe('text')
  })

  it('未知节点返回 undefined', () => {
    expect(getNodeOutputType('nope', nodes)).toBeUndefined()
  })
})

describe('wouldCreateCycle', () => {
  it('自身连接成环', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true)
  })

  it('直接反向连接成环', () => {
    const conns: CanvasConnection[] = [{ id: 'c1', fromNodeId: 'a', fromPortId: 'o', toNodeId: 'b', toPortId: 'i' }]
    expect(wouldCreateCycle(conns, 'b', 'a')).toBe(true)
  })

  it('长链反向连接成环', () => {
    const conns: CanvasConnection[] = [
      { id: 'c1', fromNodeId: 'a', fromPortId: 'o', toNodeId: 'b', toPortId: 'i' },
      { id: 'c2', fromNodeId: 'b', fromPortId: 'o', toNodeId: 'c', toPortId: 'i' },
    ]
    expect(wouldCreateCycle(conns, 'c', 'a')).toBe(true)
  })

  it('无环路径返回 false', () => {
    const conns: CanvasConnection[] = [{ id: 'c1', fromNodeId: 'a', fromPortId: 'o', toNodeId: 'b', toPortId: 'i' }]
    expect(wouldCreateCycle(conns, 'a', 'b')).toBe(false)
  })
})

describe('canConnectNodes', () => {
  it('加载图片(image) → 生成图片(image) 可连接', () => {
    expect(canConnectNodes([], 'loader', 'gen', nodes)).toBe(true)
  })

  it('文本(text) → 生成图片(image) 类型不兼容', () => {
    expect(canConnectNodes([], 'text', 'gen', nodes)).toBe(false)
  })

  it('生成图片(image) → 加载图片(无输入) 不可连接', () => {
    expect(canConnectNodes([], 'gen', 'loader', nodes)).toBe(false)
  })

  it('成环时不可连接', () => {
    const conns: CanvasConnection[] = [{ id: 'c1', fromNodeId: 'gen', fromPortId: 'o', toNodeId: 'loader', toPortId: 'i' }]
    expect(canConnectNodes(conns, 'loader', 'gen', nodes)).toBe(false)
  })
})

describe('media 输入口连接校验', () => {
  // video-generate 使用单一 media 输入连接点，素材类型由来源节点类型决定
  const mediaNodes: CanvasNodeData[] = [
    { id: 'img', prototypeId: 'image-loader', name: 'img', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'aud', prototypeId: 'audio-loader', name: 'aud', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'vid', prototypeId: 'video-loader', name: 'vid', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'txt', prototypeId: 'text', name: 'txt', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'target', prototypeId: 'video-generate', name: 'target', x: 0, y: 0, width: 240, height: 160, config: {} },
  ]

  it('图片源可连接到 media 输入口', () => {
    expect(canConnectNodes([], 'img', 'target', mediaNodes, 'in')).toBe(true)
  })

  it('音频源可连接到 media 输入口', () => {
    expect(canConnectNodes([], 'aud', 'target', mediaNodes, 'in')).toBe(true)
  })

  it('视频源可连接到 media 输入口', () => {
    expect(canConnectNodes([], 'vid', 'target', mediaNodes, 'in')).toBe(true)
  })

  it('文本源可连接到 media 输入口（media 接受任意类型）', () => {
    expect(canConnectNodes([], 'txt', 'target', mediaNodes, 'in')).toBe(true)
  })

  it('getNodeInputPortType 返回 media', () => {
    expect(getNodeInputPortType('target', 'in', mediaNodes)).toBe('media')
  })
})
