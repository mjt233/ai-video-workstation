import { describe, expect, it } from 'vitest'
import {
  allowCustomInput,
  candidateSubmitValue,
  cleanCandidateSavedValue,
  hasCandidates,
  joinMultiValue,
  normalizeCandidates,
  splitMultiValue,
} from './userParamOptions'

describe('normalizeCandidates', () => {
  it('非数组 / 缺省回退空数组', () => {
    expect(normalizeCandidates(undefined)).toEqual([])
    expect(normalizeCandidates('oops')).toEqual([])
    expect(normalizeCandidates([])).toEqual([])
  })

  it('过滤非法项（非对象 / value 空串），label 缺省回退 value，去首尾空白', () => {
    expect(normalizeCandidates([
      { label: '写实风格', value: 'realism' },
      { value: 'anime' },
      { label: ' X ', value: ' x ' },
      { label: '无值' },
      { label: '空值', value: '  ' },
      'fast',
      null,
    ])).toEqual([
      { label: '写实风格', value: 'realism' },
      { label: 'anime', value: 'anime' },
      { label: 'X', value: 'x' },
    ])
  })
})

describe('hasCandidates / allowCustomInput', () => {
  it('仅 string 类型且存在有效候选项时按下拉渲染', () => {
    expect(hasCandidates({ type: 'string', candidates: [{ label: 'a', value: 'a' }] })).toBe(true)
    expect(hasCandidates({ type: 'string', candidates: [] })).toBe(false)
    expect(hasCandidates({ type: 'string', candidates: [{ label: '空', value: '' }] })).toBe(false)
    expect(hasCandidates({ type: 'string' })).toBe(false)
    expect(hasCandidates({ type: 'integer', candidates: [{ label: '1', value: '1' }] })).toBe(false)
  })

  it('allowCustom 未声明 / true 允许自由输入，显式 false 严格下拉', () => {
    expect(allowCustomInput({})).toBe(true)
    expect(allowCustomInput({ allowCustom: true })).toBe(true)
    expect(allowCustomInput({ allowCustom: false })).toBe(false)
  })
})

describe('splitMultiValue', () => {
  it('按英文逗号拆分，去首尾空白并过滤空段', () => {
    expect(splitMultiValue('realism,anime')).toEqual(['realism', 'anime'])
    expect(splitMultiValue(' realism , anime , ')).toEqual(['realism', 'anime'])
    expect(splitMultiValue('a,,b')).toEqual(['a', 'b'])
  })

  it('null / undefined / 空串 → 空数组', () => {
    expect(splitMultiValue(null)).toEqual([])
    expect(splitMultiValue(undefined)).toEqual([])
    expect(splitMultiValue('')).toEqual([])
  })
})

describe('joinMultiValue', () => {
  it('用英文逗号拼接为提交串，去空白、过滤空值并去重', () => {
    expect(joinMultiValue(['realism', 'anime'])).toBe('realism,anime')
    expect(joinMultiValue([' realism ', '', 'anime', 'realism'])).toBe('realism,anime')
    expect(joinMultiValue([1, 2])).toBe('1,2')
  })

  it('全空值 → 空串（不提交）', () => {
    expect(joinMultiValue([])).toBe('')
    expect(joinMultiValue(['', '  '])).toBe('')
  })
})

describe('candidateSubmitValue', () => {
  it('候选对象取 value（combobox returnObject 选中项）', () => {
    expect(candidateSubmitValue({ label: '写实风格', value: 'realism' })).toBe('realism')
  })

  it('对象缺 value 时回退 label', () => {
    expect(candidateSubmitValue({ label: '写实风格' })).toBe('写实风格')
  })

  it('字符串原样返回（自由输入）', () => {
    expect(candidateSubmitValue('myspace')).toBe('myspace')
    expect(candidateSubmitValue('')).toBe('')
  })

  it('{ raw } 包装结构解包后取值', () => {
    expect(candidateSubmitValue({ raw: { label: '写实风格', value: 'realism' } })).toBe('realism')
    expect(candidateSubmitValue({ raw: 'typed' })).toBe('typed')
  })

  it('null / undefined 清空返回空串（不提交）', () => {
    expect(candidateSubmitValue(null)).toBe('')
    expect(candidateSubmitValue(undefined)).toBe('')
  })
})

describe('cleanCandidateSavedValue', () => {
  it('单选："[object Object]" 脏值返回 null（回退默认值），正常值原样', () => {
    expect(cleanCandidateSavedValue('[object Object]')).toBeNull()
    expect(cleanCandidateSavedValue('realism')).toBe('realism')
    expect(cleanCandidateSavedValue('')).toBe('')
  })

  it('对象值（早期持久化的候选对象）返回 null', () => {
    expect(cleanCandidateSavedValue({ label: '写实风格', value: 'realism' })).toBeNull()
    expect(cleanCandidateSavedValue(null)).toBeNull()
    expect(cleanCandidateSavedValue(undefined)).toBeNull()
  })

  it('多选：逐段清洗后重新拼接，全脏返回 null', () => {
    expect(cleanCandidateSavedValue('[object Object],[object Object]', true)).toBeNull()
    expect(cleanCandidateSavedValue('realism,[object Object]', true)).toBe('realism')
    expect(cleanCandidateSavedValue('realism,anime', true)).toBe('realism,anime')
    expect(cleanCandidateSavedValue('', true)).toBeNull()
  })
})
