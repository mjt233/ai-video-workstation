import { describe, expect, it } from 'vitest'
import {
  buildCommonGlobalsLib,
  buildContextLib,
  insertCodeTemplate,
  normalizeWorkflowEntries,
  validateWorkflowEntry,
} from './custom-provider'

describe('buildContextLib', () => {
  it('未选类型时 params 回退 Record<string, any>', () => {
    const lib = buildContextLib([])
    expect(lib).toContain('type CustomParams = Record<string, any>')
    expect(lib).toContain('declare interface WorkflowCallContext')
    expect(lib).toContain('request(conf: WorkflowCallRequestConfig)')
  })

  it('按所选类型组合 params 交叉类型', () => {
    const lib = buildContextLib(['text-to-image', 'image-edit'])
    expect(lib).toContain('declare interface TextToImageParams')
    expect(lib).toContain('declare interface ImageEditParams')
    expect(lib).toContain('type CustomParams = TextToImageParams & ImageEditParams')
    expect(lib).not.toContain('TtsVoiceDesignParams')
  })
})

describe('buildCommonGlobalsLib', () => {
  it('把通用代码的导出函数转为全局声明（去函数体）', () => {
    const lib = buildCommonGlobalsLib(
      'export function getBaseCallConfig(ctx: WorkflowCallContext, model: string) { return { url: model } }',
    )
    expect(lib).toContain('declare function getBaseCallConfig(ctx: WorkflowCallContext, model: string): any')
    expect(lib).not.toContain('{ return')
  })

  it('export const 转为 any 声明', () => {
    const lib = buildCommonGlobalsLib('export const BASE = 1')
    expect(lib).toContain('declare const BASE: any')
  })

  it('空代码返回空串', () => {
    expect(buildCommonGlobalsLib('')).toBe('')
  })
})

describe('normalizeWorkflowEntries', () => {
  it('非法值回退空数组，缺失代码默认为空串（不注入模板）', () => {
    expect(normalizeWorkflowEntries(null)).toEqual([])
    expect(normalizeWorkflowEntries([{ name: 'wf', types: ['text-to-image'] }])).toEqual([
      {
        name: 'wf',
        types: ['text-to-image'],
        async: false,
        cancelable: false,
        callCode: '',
        extractCode: '',
        cancelCode: '',
      },
    ])
  })

  it('过滤非法类型与非法行', () => {
    const rows = normalizeWorkflowEntries([
      'not-object',
      { name: 'wf', types: ['text-to-image', 42, null], async: true, cancelable: true, callCode: 'a', extractCode: 'b', cancelCode: 'c' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].types).toEqual(['text-to-image'])
    expect(rows[0].cancelable).toBe(true)
  })
})

describe('insertCodeTemplate', () => {
  it('空编辑器直接填充模板', () => {
    expect(insertCodeTemplate('', 'export default async function() {}')).toBe('export default async function() {}')
  })

  it('已有代码时在末尾追加（不覆盖）', () => {
    const result = insertCodeTemplate('const a = 1', 'export default async function() {}')
    expect(result).toContain('const a = 1')
    expect(result).toContain('export default async function() {}')
  })
})

describe('validateWorkflowEntry', () => {
  const base = {
    name: 'wf',
    types: ['text-to-image'],
    async: false,
    cancelable: false,
    callCode: 'export default async function() {}',
    extractCode: 'export default async function() { return { isFinish: true } }',
    cancelCode: '',
  }

  it('合法条目无错误', () => {
    expect(validateWorkflowEntry(base)).toEqual([])
  })

  it('缺名称/类型/代码时报错', () => {
    const errors = validateWorkflowEntry({ ...base, name: '', types: [], callCode: '', extractCode: '' })
    expect(errors.join('')).toContain('工作流名称')
    expect(errors.join('')).toContain('工作流类型')
    expect(errors.join('')).toContain('调用发起')
    expect(errors.join('')).toContain('结果提取')
  })

  it('支持取消但未写取消代码时报错', () => {
    const errors = validateWorkflowEntry({ ...base, cancelable: true, cancelCode: '' })
    expect(errors.join('')).toContain('取消调用')
  })
})
