/**
 * 「文本生成」节点纯函数工具单测（`canvas/textGenerate.ts`）。
 *
 * 这些规则被节点主体与配置面板共用，且直接决定提交给工作流的 vars
 * （图片进 imagePaths、其余媒体进 mediaPaths），故单独固化。
 */
import { describe, expect, it } from 'vitest'
import {
  IMPL_NOT_SELECTED_LABEL,
  hasTextGenerationImpl,
  splitTextGenerationInputs,
  textGenerationImplLabel,
  type TextGenerationMediaInput,
} from './textGenerate'

/** 构造媒体输入条目 */
function input(
  nodeId: string,
  path: string,
  type: 'image' | 'video' | 'audio',
): TextGenerationMediaInput {
  return { nodeId, path, label: path.split('/').pop() ?? path, type, version: 1 }
}

describe('textGenerationImplLabel / hasTextGenerationImpl', () => {
  it('未选择（缺失/空串/非字符串）时给出统一提示文案', () => {
    expect(textGenerationImplLabel(undefined)).toBe(IMPL_NOT_SELECTED_LABEL)
    expect(textGenerationImplLabel('')).toBe(IMPL_NOT_SELECTED_LABEL)
    expect(textGenerationImplLabel('   ')).toBe(IMPL_NOT_SELECTED_LABEL)
    expect(textGenerationImplLabel(123)).toBe(IMPL_NOT_SELECTED_LABEL)
    expect(hasTextGenerationImpl(undefined)).toBe(false)
    expect(hasTextGenerationImpl('  ')).toBe(false)
  })

  it('已选择时原样展示（去除首尾空白）', () => {
    expect(textGenerationImplLabel(' custom-wf-text-inst ')).toBe('custom-wf-text-inst')
    expect(hasTextGenerationImpl('custom-wf-text-inst')).toBe(true)
  })
})

describe('splitTextGenerationInputs', () => {
  it('图片进 imagePaths，视频/音频进 mediaPaths（保持原顺序）', () => {
    const result = splitTextGenerationInputs([
      input('a', 'assert/a.jpg', 'image'),
      input('b', 'assert/b.mp4', 'video'),
      input('c', 'assert/c.flac', 'audio'),
      input('d', 'assert/d.png', 'image'),
    ])
    expect(result).toEqual({
      imagePaths: ['assert/a.jpg', 'assert/d.png'],
      mediaPaths: ['assert/b.mp4', 'assert/c.flac'],
    })
  })

  it('未传/空数组时两组都是空数组', () => {
    expect(splitTextGenerationInputs(undefined)).toEqual({ imagePaths: [], mediaPaths: [] })
    expect(splitTextGenerationInputs([])).toEqual({ imagePaths: [], mediaPaths: [] })
  })

  it('缺少 path 的条目被跳过（防御旧数据）', () => {
    const broken = { nodeId: 'x', path: '', label: 'x', type: 'image' } as TextGenerationMediaInput
    expect(splitTextGenerationInputs([broken])).toEqual({ imagePaths: [], mediaPaths: [] })
  })
})
