import { describe, expect, it } from 'vitest'
import type { VariantInfo, VoiceVariantInfo } from '../api/assets'
import {
  buildCharacterAudioItems,
  buildCharacterImageItems,
  buildPropItems,
  buildSubsceneImageItems,
  excludeHistoryPaths,
  orderVariants,
  stem,
  variantChainName,
} from './assetDrop'

/** 构造变体测试数据（必填字段齐全） */
function variant(partial: Partial<VariantInfo> & { id: string; imagePath: string; hasImage?: boolean }): VariantInfo {
  return {
    id: partial.id,
    desc: '',
    parentId: partial.parentId,
    refs: [],
    kind: 'character',
    owner: '',
    metaPath: '',
    imagePath: partial.imagePath,
    hasImage: partial.hasImage ?? true,
    ref: '',
  }
}

describe('stem', () => {
  it('去掉最后一个扩展名', () => {
    expect(stem('a.图片.png')).toBe('a.图片')
    expect(stem('tools/剑.jpg')).toBe('剑')
  })

  it('无扩展名时原样返回', () => {
    expect(stem('剑')).toBe('剑')
  })
})

describe('orderVariants', () => {
  it('深度优先：父变体在前、子变体紧随其后', () => {
    const v = [
      variant({ id: '少女', imagePath: 'x/少女.jpg' }),
      variant({ id: '战斗', parentId: '少女', imagePath: 'x/战斗.jpg' }),
      variant({ id: '日常', imagePath: 'x/日常.jpg' }),
    ]
    expect(orderVariants(v).map((x) => x.id)).toEqual(['少女', '战斗', '日常'])
  })

  it('孤儿变体（父链断裂）按原顺序追加在末尾', () => {
    const v = [
      variant({ id: '孤儿', parentId: '不存在', imagePath: 'x/孤儿.jpg' }),
      variant({ id: 'A', imagePath: 'x/A.jpg' }),
    ]
    expect(orderVariants(v).map((x) => x.id)).toEqual(['A', '孤儿'])
  })
})

describe('variantChainName', () => {
  it('单层变体返回自身 id', () => {
    const v = [variant({ id: '雨夜', imagePath: 'x/雨夜.jpg' })]
    expect(variantChainName(v, v[0])).toBe('雨夜')
  })

  it('多级变体返回父子链（父-子）', () => {
    const v = [
      variant({ id: '少女', imagePath: 'x/少女.jpg' }),
      variant({ id: '战斗', parentId: '少女', imagePath: 'x/战斗.jpg' }),
    ]
    expect(variantChainName(v, v[1])).toBe('少女-战斗')
  })

  it('父链断裂时返回自身 id', () => {
    const v = [variant({ id: '孤儿', parentId: '不存在', imagePath: 'x/孤儿.jpg' })]
    expect(variantChainName(v, v[0])).toBe('孤儿')
  })
})

describe('buildCharacterImageItems', () => {
  it('基础=实体名 + 变体链命名（基础节点名=实体名，变体节点名=实体名-链名），未生成的变体不列出', () => {
    const items = buildCharacterImageItems('陈书文', 'assert/character/陈书文/appearance.jpg', [
      variant({ id: '少女', imagePath: 'assert/character/陈书文/variants/少女.jpg' }),
      variant({ id: '战斗', parentId: '少女', imagePath: 'assert/character/陈书文/variants/战斗.jpg' }),
      variant({ id: '未生成', imagePath: 'assert/character/陈书文/variants/未生成.jpg', hasImage: false }),
    ])
    expect(items.map((i) => [i.label, i.nodeName, i.prototypeId])).toEqual([
      ['陈书文', '陈书文', 'image-loader'],
      ['少女', '陈书文-少女', 'image-loader'],
      ['少女-战斗', '陈书文-少女-战斗', 'image-loader'],
    ])
  })

  it('外观未生成时仅列出变体', () => {
    const items = buildCharacterImageItems('陈书文', null, [
      variant({ id: '雨夜', imagePath: 'assert/character/陈书文/variants/雨夜.jpg' }),
    ])
    expect(items.map((i) => i.label)).toEqual(['雨夜'])
  })
})

describe('buildCharacterAudioItems', () => {
  it('基础音色=实体名（菜单显示与节点名），声音变体=实体名-变体id；未生成的变体不列出', () => {
    const voiceVariants: VoiceVariantInfo[] = [
      {
        id: '温柔',
        prompt: '',
        promptMode: 'append',
        台词: '',
        kind: 'character',
        owner: '',
        metaPath: '',
        audioPath: 'assert/character/陈书文/voice-variants/温柔.flac',
        outputPath: 'assert/character/陈书文/voice-variants/温柔.flac',
        hasAudio: true,
      },
      {
        id: '未生成',
        prompt: '',
        promptMode: 'append',
        台词: '',
        kind: 'character',
        owner: '',
        metaPath: '',
        audioPath: null,
        outputPath: 'assert/character/陈书文/voice-variants/未生成.flac',
        hasAudio: false,
      },
    ]
    const items = buildCharacterAudioItems(
      '陈书文',
      'assert/character/陈书文/voice.flac',
      voiceVariants,
    )
    expect(items.map((i) => [i.label, i.nodeName, i.path, i.prototypeId])).toEqual([
      ['陈书文', '陈书文', 'assert/character/陈书文/voice.flac', 'audio-loader'],
      ['温柔', '陈书文-温柔', 'assert/character/陈书文/voice-variants/温柔.flac', 'audio-loader'],
    ])
  })

  it('无基础音色时仅列出声音变体', () => {
    const items = buildCharacterAudioItems('陈书文', null, [])
    expect(items).toEqual([])
  })
})

describe('buildSubsceneImageItems', () => {
  it('基础场景图=实体名，变体=实体名-链名', () => {
    const items = buildSubsceneImageItems('正门入口', 'assert/stage/现代商场/正门入口.jpg', [
      variant({ id: '夜晚', imagePath: 'assert/stage/现代商场/variants/正门入口/夜晚.jpg' }),
    ])
    expect(items.map((i) => [i.label, i.nodeName])).toEqual([
      ['正门入口', '正门入口'],
      ['夜晚', '正门入口-夜晚'],
    ])
  })
})

describe('excludeHistoryPaths', () => {
  it('过滤 history 归档目录中的路径，保留当前产物', () => {
    expect(excludeHistoryPaths([
      'assert/prop/其他/手机/image.jpg',
      'assert/prop/其他/手机/history/image/20260901-232719.jpg',
      'assert/prop/其他/手机/侧面.png',
    ])).toEqual([
      'assert/prop/其他/手机/image.jpg',
      'assert/prop/其他/手机/侧面.png',
    ])
  })
})

describe('buildPropItems', () => {
  it('固定产物优先且节点名=道具名（菜单显示实体名），其它文件按文件名排序且节点名=道具名-文件名主干', () => {
    const items = buildPropItems('宝剑', [
      'assert/prop/兵器/宝剑/剑身.png',
      'assert/prop/兵器/宝剑/image.jpg',
    ], 'image')
    expect(items.map((i) => [i.label, i.nodeName])).toEqual([
      ['宝剑', '宝剑'],
      ['剑身.png', '宝剑-剑身'],
    ])
  })

  it('音频固定产物用 audio.flac，其余按中文名排序', () => {
    const items = buildPropItems('宝剑', [
      'assert/prop/兵器/宝剑/拔剑.mp3',
      'assert/prop/兵器/宝剑/audio.flac',
    ], 'audio')
    expect(items.map((i) => [i.label, i.nodeName, i.prototypeId])).toEqual([
      ['宝剑', '宝剑', 'audio-loader'],
      ['拔剑.mp3', '宝剑-拔剑', 'audio-loader'],
    ])
  })

  it('视频固定产物用 video.mp4', () => {
    const items = buildPropItems('宝剑', ['assert/prop/兵器/宝剑/video.mp4'], 'video')
    expect(items.map((i) => [i.label, i.nodeName, i.prototypeId])).toEqual([
      ['宝剑', '宝剑', 'video-loader'],
    ])
  })
})
