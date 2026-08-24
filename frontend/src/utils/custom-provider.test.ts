import { describe, expect, it } from 'vitest'
import {
  buildCommonGlobalsLib,
  buildContextLib,
  buildSizeConfigLib,
  buildUserConfigLib,
  duplicateWorkflowEntry,
  insertCodeTemplate,
  nextDuplicatedWorkflowName,
  normalizeWorkflowEntries,
  normalizeWorkflowSizeConfig,
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

  it('ctx 含 readFileToBase64 与 userConfig（无字段时宽松索引签名）', () => {
    const lib = buildContextLib([])
    expect(lib).toContain('readFileToBase64?(relPath: string, withDataPrefix?: boolean): Promise<string>')
    expect(lib).toContain('workflowType?: CustomWorkflowTypeId')
    expect(lib).toContain('userConfig: CustomUserConfig')
    expect(lib).toContain('type CustomUserConfig = Record<string, boolean | number | string>')
  })

  it('workflowType 类型约束为系统支持的工作流类型联合', () => {
    const lib = buildContextLib([])
    expect(lib).toContain("type CustomWorkflowTypeId = 'text-to-image' | 'image-edit' | 'tts-voice-design' | 'tts-voice-clone' | 'image-to-video'")
  })

  it('用户配置字段生成 ctx.userConfig 类型提示（按类型映射）', () => {
    const lib = buildContextLib([], [
      { key: 'model', name: '模型', type: 'string', defaultValue: 'gpt-image-2' },
      { key: 'steps', name: '步数', type: 'integer', defaultValue: '20' },
      { key: 'rate', name: '比例', type: 'float', defaultValue: '1.5' },
      { key: 'enhance', name: '增强', type: 'boolean', defaultValue: 'false' },
    ])
    expect(lib).toContain("'model'?: string")
    expect(lib).toContain("'steps'?: number")
    expect(lib).toContain("'rate'?: number")
    expect(lib).toContain("'enhance'?: boolean")
  })

  it('buildUserConfigLib 空字段返回宽松索引签名', () => {
    expect(buildUserConfigLib([])).toContain('Record<string, boolean | number | string>')
    expect(buildUserConfigLib(undefined)).toContain('Record<string, boolean | number | string>')
  })

  it('生图/生视频 params 含 sizeConfig 字段（带类型提示）', () => {
    expect(buildContextLib(['text-to-image'])).toContain('sizeConfig?: CustomSizeConfig')
    expect(buildContextLib(['image-to-video'])).toContain('sizeConfig?: CustomSizeConfig')
    expect(buildContextLib(['tts-voice-design'])).not.toContain('sizeConfig?: CustomSizeConfig')
  })

  it('sizeConfig 按条目配置生成字面量联合类型提示', () => {
    const lib = buildContextLib(['text-to-image'], undefined, {
      ratio: ['16:9', '4:3', 'auto'],
      size: ['1K', '2K'],
      supportCustomSize: false,
    })
    expect(lib).toContain("ratio?: '16:9' | '4:3' | 'auto'")
    expect(lib).toContain("size?: '1K' | '2K'")
    expect(lib).toContain('width?: number')
    expect(lib).toContain('height?: number')
  })

  it('sizeConfig 未配置时回退全部候选全集（宽松提示）', () => {
    const lib = buildContextLib(['image-edit'])
    expect(lib).toContain('declare interface CustomSizeConfig')
    expect(lib).toContain("ratio?: '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3' | '21:9' | 'auto' | 'adaptive'")
    expect(lib).toContain("size?: '360P' | '480P' | '720P' | '768P' | '1080P' | '1K' | '1.5K' | '2K' | '3K' | '4K' | '8K' | 'auto'")
  })

  it('buildSizeConfigLib 空清单视为默认全量（回退全部候选全集）', () => {
    const lib = buildSizeConfigLib({ ratio: [], size: [], supportCustomSize: true })
    expect(lib).toContain("ratio?: '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3' | '21:9' | 'auto' | 'adaptive'")
    expect(lib).toContain("size?: '360P' | '480P' | '720P' | '768P' | '1080P' | '1K' | '1.5K' | '2K' | '3K' | '4K' | '8K' | 'auto'")
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
        userConfigFields: [],
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

  it('用户配置字段规范化：非法 type 回退 string、空 key 丢弃', () => {
    const rows = normalizeWorkflowEntries([
      {
        name: 'wf',
        types: ['text-to-image'],
        userConfigFields: [
          { key: 'model', name: '模型', type: 'integer', defaultValue: '20' },
          { key: '', name: 'x', type: 'string', defaultValue: '' },
          { key: 'broken', name: 'b', type: 'unknown-type', defaultValue: '' },
          'not-object',
        ],
      },
    ])
    expect(rows[0].userConfigFields).toEqual([
      { key: 'model', name: '模型', type: 'integer', defaultValue: '20' },
      { key: 'broken', name: 'b', type: 'string', defaultValue: '' },
    ])
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

describe('nextDuplicatedWorkflowName', () => {
  it('首次复制追加「副本」', () => {
    expect(nextDuplicatedWorkflowName('gpt-image-2', ['gpt-image-2'])).toBe('gpt-image-2 副本')
  })

  it('名称已被占用时追加序号', () => {
    expect(nextDuplicatedWorkflowName('gpt-image-2', ['gpt-image-2', 'gpt-image-2 副本'])).toBe('gpt-image-2 副本 2')
    expect(nextDuplicatedWorkflowName('gpt-image-2', ['gpt-image-2', 'gpt-image-2 副本', 'gpt-image-2 副本 2']))
      .toBe('gpt-image-2 副本 3')
  })

  it('空名称回退为「未命名 副本」', () => {
    expect(nextDuplicatedWorkflowName('  ', [])).toBe('未命名 副本')
  })
})

describe('duplicateWorkflowEntry', () => {
  it('深拷贝整行数据并换成不冲突名称', () => {
    const source = {
      name: 'gpt-image-2',
      types: ['text-to-image', 'image-edit'],
      async: true,
      cancelable: false,
      callCode: 'export default async function() {}',
      extractCode: 'return { isFinish: true }',
      cancelCode: '',
      userConfigFields: [
        { key: 'model', name: '模型', type: 'string' as const, defaultValue: 'gpt-image-2', description: '模型名' },
      ],
    }
    const cloned = duplicateWorkflowEntry(source, [source.name])
    expect(cloned).toEqual({
      ...source,
      name: 'gpt-image-2 副本',
    })
    expect(cloned.types).not.toBe(source.types)
    expect(cloned.userConfigFields).not.toBe(source.userConfigFields)
    expect(cloned.userConfigFields?.[0]).not.toBe(source.userConfigFields[0])
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

  it('用户配置字段：空 key 与重复 key 报错', () => {
    const errors = validateWorkflowEntry({
      ...base,
      userConfigFields: [
        { key: '', name: 'a', type: 'string', defaultValue: '' },
        { key: 'model', name: 'b', type: 'string', defaultValue: '' },
        { key: 'model', name: 'c', type: 'string', defaultValue: '' },
      ],
    })
    expect(errors.join('')).toContain('空的 key')
    expect(errors.join('')).toContain('不能重复')
  })
})

describe('normalizeWorkflowSizeConfig', () => {
  it('未配置/非对象返回 undefined（使用默认全量）', () => {
    expect(normalizeWorkflowSizeConfig(undefined)).toBeUndefined()
    expect(normalizeWorkflowSizeConfig(null)).toBeUndefined()
    expect(normalizeWorkflowSizeConfig('oops')).toBeUndefined()
  })

  it('对象但非数组字段回退空数组（空 = 使用默认全量）', () => {
    expect(normalizeWorkflowSizeConfig({ ratio: 'oops' })).toEqual({
      ratio: [],
      size: [],
      supportCustomSize: false,
    })
  })

  it('按候选全集过滤未知档位并去重，supportCustomSize 按 true 解析', () => {
    expect(normalizeWorkflowSizeConfig({
      ratio: ['16:9', '4:3', '4:3', '999P'],
      size: ['1K', '2K', 'bad'],
      supportCustomSize: true,
    })).toEqual({
      ratio: ['16:9', '4:3'],
      size: ['1K', '2K'],
      supportCustomSize: true,
    })
    expect(normalizeWorkflowSizeConfig({ ratio: [], size: [], supportCustomSize: false })?.supportCustomSize).toBe(false)
  })
})

describe('normalizeWorkflowEntries sizeConfig', () => {
  it('条目携带 sizeConfig 时规范化保留', () => {
    const rows = normalizeWorkflowEntries([
      {
        name: 'wf',
        types: ['text-to-image'],
        sizeConfig: { ratio: ['16:9', 'auto'], size: ['1K'], supportCustomSize: false },
      },
    ])
    expect(rows[0].sizeConfig).toEqual({ ratio: ['16:9', 'auto'], size: ['1K'], supportCustomSize: false })
  })

  it('duplicateWorkflowEntry 深拷贝 sizeConfig', () => {
    const source = {
      name: 'wf',
      types: ['text-to-image'],
      async: false,
      cancelable: false,
      callCode: 'x',
      extractCode: 'y',
      cancelCode: '',
      userConfigFields: [],
      sizeConfig: { ratio: ['16:9'], size: ['1K', '2K'], supportCustomSize: true },
    }
    const cloned = duplicateWorkflowEntry(source, [source.name])
    expect(cloned.sizeConfig).toEqual(source.sizeConfig)
    expect(cloned.sizeConfig).not.toBe(source.sizeConfig)
    expect(cloned.sizeConfig!.ratio).not.toBe(source.sizeConfig!.ratio)
  })
})
