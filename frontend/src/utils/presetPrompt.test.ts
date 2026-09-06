import { describe, expect, it } from 'vitest'
import { composePresetPrompt } from './presetPrompt'

describe('composePresetPrompt 预设提示词组装', () => {
  it('含占位符时替换为用户输入', () => {
    expect(composePresetPrompt('请翻译：{user_prompt}', '你好世界')).toBe('请翻译：你好世界')
  })

  it('含多个占位符时全部替换', () => {
    expect(composePresetPrompt('{user_prompt} → {user_prompt}', 'x')).toBe('x → x')
  })

  it('占位符可出现在任意位置（前后均有内容）', () => {
    expect(composePresetPrompt('开始\n{user_prompt}\n结束', '中间')).toBe('开始\n中间\n结束')
  })

  it('无占位符时用户输入追加到末尾（换行分隔），并去除内容尾部空白', () => {
    expect(composePresetPrompt('你是专业编辑。', '帮我润色这段文字')).toBe('你是专业编辑。\n帮我润色这段文字')
    expect(composePresetPrompt('你是专业编辑。\n', '帮我润色这段文字')).toBe('你是专业编辑。\n帮我润色这段文字')
  })

  it('无占位符且内容尾部有多余空白时仅保留一个换行', () => {
    expect(composePresetPrompt('规则一\n   \n\t', '输入A')).toBe('规则一\n输入A')
  })

  it('预设内容为空时直接返回用户输入', () => {
    expect(composePresetPrompt('', '仅输入')).toBe('仅输入')
  })

  it('用户输入为空时替换为空串（占位符场景）', () => {
    expect(composePresetPrompt('前缀 {user_prompt} 后缀', '')).toBe('前缀  后缀')
  })

  it('用户输入保留首尾空白，不被 trim', () => {
    expect(composePresetPrompt('P:{user_prompt}', '  缩进内容  ')).toBe('P:  缩进内容  ')
  })
})
