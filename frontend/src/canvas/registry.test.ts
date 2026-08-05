import { describe, expect, it } from 'vitest'
import { getPrototype, NODE_PROTOTYPES } from './registry'

describe('NODE_PROTOTYPES', () => {
  it('包含五个内置节点', () => {
    expect(NODE_PROTOTYPES.map((p) => p.id).sort()).toEqual([
      'audio-loader',
      'image-generate',
      'image-loader',
      'text',
      'video-loader',
    ])
  })

  it('生成图片只接受 image 输入，输出 image', () => {
    const p = getPrototype('image-generate')!
    expect(p.inputPorts.every((port) => port.type === 'image')).toBe(true)
    expect(p.outputPorts[0].type).toBe('image')
  })

  it('文本输出 text 类型', () => {
    expect(getPrototype('text')!.outputPorts[0].type).toBe('text')
  })
})

describe('getPrototype', () => {
  it('未知原型返回 undefined', () => {
    expect(getPrototype('unknown')).toBeUndefined()
  })
})

describe('音频/视频加载节点原型', () => {
  it('注册 audio-loader 与 video-loader', () => {
    const audio = getPrototype('audio-loader')
    const video = getPrototype('video-loader')
    expect(audio?.name).toBe('加载音频')
    expect(audio?.outputPorts[0]?.type).toBe('audio')
    expect(video?.name).toBe('加载视频')
    expect(video?.outputPorts[0]?.type).toBe('video')
  })
})
