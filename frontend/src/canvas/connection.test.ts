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

  it('media 为通配类型：作为来源也可连到任意具体类型的输入口', () => {
    // 「输入转发」节点未接输入时输出端口声明为 media（占位），此时允许先连下游任意输入口
    expect(canConnect('media', 'image')).toBe(true)
    expect(canConnect('media', 'video')).toBe(true)
    expect(canConnect('media', 'audio')).toBe(true)
    expect(canConnect('media', 'text')).toBe(true)
  })

  it('数组端口：任一类型匹配即可连接', () => {
    expect(canConnect('text', ['media', 'text'])).toBe(true)
    expect(canConnect('image', ['media', 'text'])).toBe(true)
    expect(canConnect('audio', ['media', 'text'])).toBe(true)
    expect(canConnect('video', ['media', 'text'])).toBe(true)
    expect(canConnect('text', ['text'])).toBe(true)
    expect(canConnect('image', ['text'])).toBe(false)
    expect(canConnect('audio', [])).toBe(false)
  })

  it('数组来源端口：任一类型匹配即可连接', () => {
    expect(canConnect(['image', 'text'], 'text')).toBe(true)
    expect(canConnect(['image', 'audio'], 'text')).toBe(false)
    expect(canConnect(['image', 'audio'], 'media')).toBe(true)
  })
})

describe('getNodeOutputType / getNodeInputType', () => {
  it('加载图片输出 image', () => {
    expect(getNodeOutputType('loader', nodes, [])).toBe('image')
  })

  it('生成图片输入 image + text（单一 in 端口接受多类型）', () => {
    expect(getNodeInputType('gen', nodes)).toEqual(['image', 'text'])
  })

  it('文本输出 text', () => {
    expect(getNodeOutputType('text', nodes, [])).toBe('text')
  })

  it('未知节点返回 undefined', () => {
    expect(getNodeOutputType('nope', nodes, [])).toBeUndefined()
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

  it('文本(text) → 生成图片(in 端口 type: [image,text]) 可连接（文本作为外部提示词）', () => {
    expect(canConnectNodes([], 'text', 'gen', nodes)).toBe(true)
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

describe('AI文本生成节点单一多类型输入口', () => {
  // text-ai 使用单一 in 输入口（type: ['media', 'text']），媒体/文本来源均可连接
  const aiNodes: CanvasNodeData[] = [
    { id: 'img', prototypeId: 'image-loader', name: 'img', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'aud', prototypeId: 'audio-loader', name: 'aud', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'vid', prototypeId: 'video-loader', name: 'vid', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'txt', prototypeId: 'text', name: 'txt', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'target', prototypeId: 'text-ai', name: 'target', x: 0, y: 0, width: 240, height: 160, config: {} },
  ]

  it('图片/音频/视频源可连接到 in 输入口', () => {
    expect(canConnectNodes([], 'img', 'target', aiNodes, 'in')).toBe(true)
    expect(canConnectNodes([], 'aud', 'target', aiNodes, 'in')).toBe(true)
    expect(canConnectNodes([], 'vid', 'target', aiNodes, 'in')).toBe(true)
  })

  it('文本源可连接到 in 输入口（数组端口任一匹配）', () => {
    expect(canConnectNodes([], 'txt', 'target', aiNodes, 'in')).toBe(true)
  })

  it('getNodeInputPortType 返回多类型数组', () => {
    expect(getNodeInputPortType('target', 'in', aiNodes)).toEqual(['media', 'text'])
  })
})

describe('输入转发节点（passThrough）：输出类型按上游来源实时解析', () => {
  /**
   * 画布：img/aud/vid/txt 四种来源 → 转发节点 fw → 转发节点 fw2 → 各类型专一下游。
   * 下游 target-video（裁剪视频）只接受 video，用来验证「实际类型」而非占位 'media'。
   */
  const fwNodes: CanvasNodeData[] = [
    { id: 'img', prototypeId: 'image-loader', name: 'img', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'aud', prototypeId: 'audio-loader', name: 'aud', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'vid', prototypeId: 'video-loader', name: 'vid', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'txt', prototypeId: 'text', name: 'txt', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'fw', prototypeId: 'forward-input', name: '转发', x: 0, y: 0, width: 320, height: 260, config: { inputOrder: [] } },
    { id: 'fw2', prototypeId: 'forward-input', name: '转发2', x: 0, y: 0, width: 320, height: 260, config: { inputOrder: [] } },
    { id: 'trim-video', prototypeId: 'video-trim', name: '裁剪视频', x: 0, y: 0, width: 240, height: 160, config: {} },
    { id: 'gen-video', prototypeId: 'video-generate', name: '生成视频', x: 0, y: 0, width: 240, height: 160, config: {} },
    { id: 'image-gen-target', prototypeId: 'image-generate', name: '生成图片', x: 0, y: 0, width: 240, height: 160, config: {} },
    { id: 'tts', prototypeId: 'tts-generate', name: 'TTS', x: 0, y: 0, width: 240, height: 160, config: {} },
  ]

  /** 连一条 src → to 的边（用于构造转发节点的上游） */
  const edge = (from: string, to: string): CanvasConnection => ({
    id: `${from}-${to}`, fromNodeId: from, fromPortId: 'out', toNodeId: to, toPortId: 'in',
  })

  it('未接输入：类型待定（空数组，放行任意下游）', () => {
    expect(getNodeOutputType('fw', fwNodes, [])).toEqual([])
  })

  it('单路来源：输出类型等于来源类型', () => {
    expect(getNodeOutputType('fw', fwNodes, [edge('img', 'fw')])).toBe('image')
    expect(getNodeOutputType('fw', fwNodes, [edge('aud', 'fw')])).toBe('audio')
    expect(getNodeOutputType('fw', fwNodes, [edge('vid', 'fw')])).toBe('video')
    expect(getNodeOutputType('fw', fwNodes, [edge('txt', 'fw')])).toBe('text')
  })

  it('多路同类型来源：仍为该类型', () => {
    const img2: CanvasNodeData = { id: 'img2', prototypeId: 'image-loader', name: 'img2', x: 0, y: 0, width: 10, height: 10, config: {} }
    const conns = [edge('img', 'fw'), edge('img2', 'fw')]
    expect(getNodeOutputType('fw', [...fwNodes, img2], conns)).toBe('image')
  })

  it('媒体与文本混合：实际类型为并集 [image, text]（不冒充单一类型）', () => {
    const conns = [edge('img', 'fw'), edge('txt', 'fw')]
    expect(getNodeOutputType('fw', fwNodes, conns)).toEqual(['image', 'text'])
    // 接受「图片+文本」的下游（生成图片）可用；只接受视频的下游被拒
    expect(canConnectNodes(conns, 'fw', 'image-gen-target', fwNodes, 'in')).toBe(true)
    expect(canConnectNodes(conns, 'fw', 'trim-video', fwNodes, 'in')).toBe(false)
  })

  it('多种媒体混合（视频 + 音频）：实际类型为媒体并集，徽标不再冒充单一类型', () => {
    const conns = [edge('vid', 'fw'), edge('aud', 'fw')]
    expect(getNodeOutputType('fw', fwNodes, conns)).toEqual(['video', 'audio'])
    // 并集来源取「任一成员兼容即可连」（乐观语义）：视频专一下游可用（确实有视频来源）
    expect(canConnectNodes(conns, 'fw', 'trim-video', fwNodes, 'in')).toBe(true)
    expect(canConnectNodes(conns, 'fw', 'tts', fwNodes, 'in')).toBe(true)
    // 与并集无交集的输入口仍被拒（转发视频+音频不能喂给只接受图片的下游）
    expect(canConnectNodes(conns, 'fw', 'image-gen-target', fwNodes, 'in')).toBe(false)
  })

  it('转发链：沿连线逐级解析到最终上游类型', () => {
    const conns = [edge('vid', 'fw'), edge('fw', 'fw2')]
    expect(getNodeOutputType('fw2', fwNodes, conns)).toBe('video')
  })

  it('成环数据防御：环形连线不导致递归不终止（环内节点类型待定）', () => {
    const conns = [edge('fw', 'fw2'), edge('fw2', 'fw')]
    expect(getNodeOutputType('fw', fwNodes, conns)).toEqual([])
    expect(getNodeOutputType('fw2', fwNodes, conns)).toEqual([])
  })

  it('菱形拓扑：同一上游经两条转发链汇入同一转发节点，类型仍正确解析', () => {
    const conns = [edge('vid', 'fw'), edge('vid', 'fw2'), edge('fw', 'fw3'), edge('fw2', 'fw3')]
    const fw3: CanvasNodeData = { id: 'fw3', prototypeId: 'forward-input', name: '转发3', x: 0, y: 0, width: 320, height: 260, config: { inputOrder: [] } }
    expect(getNodeOutputType('fw3', [...fwNodes, fw3], conns)).toBe('video')
  })

  it('类型专一下游：转发图片/音频/文本都不能连到「裁剪视频」', () => {
    const conns = [edge('img', 'fw')]
    expect(canConnectNodes(conns, 'fw', 'trim-video', fwNodes, 'in')).toBe(false)
    expect(canConnectNodes([edge('aud', 'fw')], 'fw', 'trim-video', fwNodes, 'in')).toBe(false)
    expect(canConnectNodes([edge('txt', 'fw')], 'fw', 'trim-video', fwNodes, 'in')).toBe(false)
  })

  it('类型专一下游：转发视频可连到「裁剪视频」', () => {
    expect(canConnectNodes([edge('vid', 'fw')], 'fw', 'trim-video', fwNodes, 'in')).toBe(true)
  })

  it('媒体输入口下游：转发媒体可连，转发文本同样放行（media 口接受任意来源）', () => {
    expect(canConnectNodes([edge('img', 'fw')], 'fw', 'gen-video', fwNodes, 'in')).toBe(true)
    expect(canConnectNodes([edge('txt', 'fw')], 'fw', 'gen-video', fwNodes, 'in')).toBe(true)
  })

  it('音频输入口下游：只有转发音频可连 TTS，转发图片不可', () => {
    expect(canConnectNodes([edge('aud', 'fw')], 'fw', 'tts', fwNodes, 'in')).toBe(true)
    expect(canConnectNodes([edge('img', 'fw')], 'fw', 'tts', fwNodes, 'in')).toBe(false)
  })

  it('未接输入的转发节点：按占位声明 media 放行任意下游（可先搭拓扑后接来源）', () => {
    expect(canConnectNodes([], 'fw', 'trim-video', fwNodes, 'in')).toBe(true)
    expect(canConnectNodes([], 'fw', 'tts', fwNodes, 'in')).toBe(true)
  })

  it('转发链仍受成环校验约束（转发 → 转发 → 转发 自我成环被拒）', () => {
    expect(canConnectNodes([edge('fw2', 'fw')], 'fw', 'fw2', fwNodes, 'in')).toBe(false)
  })

  it('转发节点可作为来源连接到任意输入口（输入口 type 为 [media,text]）', () => {
    expect(canConnectNodes([], 'img', 'fw', fwNodes, 'in')).toBe(true)
    expect(canConnectNodes([], 'txt', 'fw', fwNodes, 'in')).toBe(true)
    expect(canConnectNodes([], 'vid', 'fw', fwNodes, 'in')).toBe(true)
  })
})
