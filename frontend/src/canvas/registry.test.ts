import { describe, expect, it } from 'vitest'
import { getPrototype, NODE_PROTOTYPES } from './registry'

describe('NODE_PROTOTYPES', () => {
  it('包含九个内置节点', () => {
    expect(NODE_PROTOTYPES.map((p) => p.id).sort()).toEqual([
      'audio-loader',
      'image-generate',
      'image-loader',
      'text',
      'tts-generate',
      'video-concat',
      'video-frame-extract',
      'video-generate',
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

describe('TTS 声音生成节点原型', () => {
  it('audio 输入、audio 输出、默认配置与 current.path 解析', () => {
    const p = getPrototype('tts-generate')!
    expect(p.name).toBe('TTS声音生成')
    expect(p.inputPorts[0]?.type).toBe('audio')
    expect(p.outputPorts[0]?.type).toBe('audio')
    expect(p.defaultConfig).toMatchObject({ mode: 'design', text: '', refText: '', prompt: '' })
    expect(p.getOutputAssetPath?.({ current: { path: 'assert/scene/1/1/canvas/tts/v1.flac' } })).toBe('assert/scene/1/1/canvas/tts/v1.flac')
    expect(p.getOutputAssetPath?.({})).toBeUndefined()
  })
})

describe('getOutputAssetPath（各节点自实现输出资产解析）', () => {
  it('加载类节点解析 config.assetPath，空值返回 undefined', () => {
    expect(getPrototype('image-loader')!.getOutputAssetPath?.({ assetPath: 'assert/custom/foo.jpg' })).toBe('assert/custom/foo.jpg')
    expect(getPrototype('audio-loader')!.getOutputAssetPath?.({ assetPath: 'a.flac' })).toBe('a.flac')
    expect(getPrototype('video-loader')!.getOutputAssetPath?.({ assetPath: 'a.mp4' })).toBe('a.mp4')
    expect(getPrototype('image-loader')!.getOutputAssetPath?.({})).toBeUndefined()
  })

  it('生成类节点解析 config.current.path', () => {
    expect(getPrototype('image-generate')!.getOutputAssetPath?.({ current: { path: 'x.jpg' } })).toBe('x.jpg')
    expect(getPrototype('video-generate')!.getOutputAssetPath?.({ current: { path: 'x.mp4' } })).toBe('x.mp4')
  })

  it('文本节点不声明解析器（无文件输出）', () => {
    expect(getPrototype('text')!.getOutputAssetPath).toBeUndefined()
  })

  it('获取视频帧节点：video 输入、image 输出、解析 current.path', () => {
    const p = getPrototype('video-frame-extract')!
    expect(p.inputPorts[0]?.type).toBe('video')
    expect(p.outputPorts[0]?.type).toBe('image')
    expect(p.getOutputAssetPath?.({ current: { path: 'assert/scene/1/1/canvas/ef/v1.png' } })).toBe('assert/scene/1/1/canvas/ef/v1.png')
  })

  it('拼接视频节点：video 输入、video 输出、解析 current.path', () => {
    const p = getPrototype('video-concat')!
    expect(p.name).toBe('拼接视频')
    expect(p.inputPorts[0]?.type).toBe('video')
    expect(p.outputPorts[0]?.type).toBe('video')
    expect(p.defaultConfig).toMatchObject({ inputOrder: [], history: [] })
    expect(p.getOutputAssetPath?.({ current: { path: 'assert/scene/1/1/canvas/vc/v1.mp4' } })).toBe('assert/scene/1/1/canvas/vc/v1.mp4')
    expect(p.getOutputAssetPath?.({})).toBeUndefined()
  })
})
