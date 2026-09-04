import { describe, expect, it } from 'vitest'
import { getPrototype, NODE_PROTOTYPES } from './registry'

describe('NODE_PROTOTYPES', () => {
  it('包含十一个内置节点', () => {
    expect(NODE_PROTOTYPES.map((p) => p.id).sort()).toEqual([
      'audio-loader',
      'audio-trim',
      'image-generate',
      'image-loader',
      'text',
      'tts-generate',
      'video-concat',
      'video-frame-extract',
      'video-generate',
      'video-loader',
      'video-trim',
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

  it('裁剪视频节点：video 输入、video 输出、默认配置与 current.path 解析', () => {
    const p = getPrototype('video-trim')!
    expect(p.name).toBe('裁剪视频')
    expect(p.inputPorts[0]?.type).toBe('video')
    expect(p.outputPorts[0]?.type).toBe('video')
    expect(p.defaultConfig).toMatchObject({ startMode: 'time', startValue: 0, duration: 1 })
    expect(p.getOutputAssetPath?.({ current: { path: 'assert/scene/1/1/canvas/vt/output.mp4' } })).toBe('assert/scene/1/1/canvas/vt/output.mp4')
    expect(p.getOutputAssetPath?.({})).toBeUndefined()
  })

  it('裁剪音频节点：audio 输入、audio 输出、默认配置与 current.path 解析', () => {
    const p = getPrototype('audio-trim')!
    expect(p.name).toBe('裁剪音频')
    expect(p.inputPorts[0]?.type).toBe('audio')
    expect(p.outputPorts[0]?.type).toBe('audio')
    expect(p.defaultConfig).toMatchObject({ startValue: 0, duration: 1 })
    expect(p.getOutputAssetPath?.({ current: { path: 'assert/scene/1/1/canvas/at/output.flac' } })).toBe('assert/scene/1/1/canvas/at/output.flac')
    expect(p.getOutputAssetPath?.({})).toBeUndefined()
  })
})

describe('outputExt（生成类节点产物扩展名）', () => {
  it('生成类节点声明固定产物扩展名，加载/文本节点不声明', () => {
    expect(getPrototype('image-generate')?.outputExt).toBe('jpg')
    expect(getPrototype('video-generate')?.outputExt).toBe('mp4')
    expect(getPrototype('tts-generate')?.outputExt).toBe('flac')
    expect(getPrototype('video-frame-extract')?.outputExt).toBe('png')
    expect(getPrototype('video-concat')?.outputExt).toBe('mp4')
    expect(getPrototype('video-trim')?.outputExt).toBe('mp4')
    expect(getPrototype('audio-trim')?.outputExt).toBe('flac')
    expect(getPrototype('image-loader')?.outputExt).toBeUndefined()
    expect(getPrototype('audio-loader')?.outputExt).toBeUndefined()
    expect(getPrototype('video-loader')?.outputExt).toBeUndefined()
    expect(getPrototype('text')?.outputExt).toBeUndefined()
  })
})

describe('canGenerate / hasHistory 能力标志', () => {
  it('生成类节点支持重新生成', () => {
    const ids = ['image-generate', 'video-generate', 'tts-generate', 'video-frame-extract', 'video-concat', 'video-trim', 'audio-trim']
    for (const id of ids) {
      expect(getPrototype(id)?.canGenerate, `${id} 应支持重新生成`).toBe(true)
    }
  })

  it('加载类与文本节点不支持重新生成', () => {
    const ids = ['image-loader', 'audio-loader', 'video-loader', 'text']
    for (const id of ids) {
      expect(getPrototype(id)?.canGenerate ?? false, `${id} 不应支持重新生成`).toBe(false)
    }
  })

  it('有版本历史的节点：生成图片/视频/TTS；获取视频帧已移除历史', () => {
    expect(getPrototype('image-generate')?.hasHistory).toBe(true)
    expect(getPrototype('video-generate')?.hasHistory).toBe(true)
    expect(getPrototype('tts-generate')?.hasHistory).toBe(true)
    expect(getPrototype('video-frame-extract')?.hasHistory ?? false).toBe(false)
    expect(getPrototype('video-concat')?.hasHistory ?? false).toBe(false)
    expect(getPrototype('video-trim')?.hasHistory ?? false).toBe(false)
    expect(getPrototype('audio-trim')?.hasHistory ?? false).toBe(false)
    expect(getPrototype('image-loader')?.hasHistory ?? false).toBe(false)
  })
})
