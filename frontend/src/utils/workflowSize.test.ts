import { describe, expect, it } from 'vitest'
import {
  clampSizeConfigState,
  computePresetSize,
  findSizeParamKeys,
  formatSizeConfigText,
  inferSizeConfigFromWidthHeight,
  mergeSizeValues,
  normalizeSizeCapabilities,
  normalizeSizeConfig,
  ratioLabel,
  resolvePresetSize,
  resolveSizeMode,
  SIZE_RATIOS,
  SIZE_RESOLUTIONS,
  sizeLabel,
  toSizeConfig,
} from './workflowSize'
import type { WorkflowUserParamDeclaration } from '../api/workflow'

describe('computePresetSize', () => {
  it('P 档按高度为基准：16:9 + 1080P → 1920×1080', () => {
    expect(computePresetSize('16:9', '1080P')).toEqual({ width: 1920, height: 1080 })
  })

  it('1:1 + 1080P → 1080×1080', () => {
    expect(computePresetSize('1:1', '1080P')).toEqual({ width: 1080, height: 1080 })
  })

  it('9:16 + 1080P → 1080×1920', () => {
    expect(computePresetSize('9:16', '1080P')).toEqual({ width: 1080, height: 1920 })
  })

  it('4:3 + 720P → 960×720', () => {
    expect(computePresetSize('4:3', '720P')).toEqual({ width: 960, height: 720 })
  })

  it('K 档按宽度为基准：16:9 + 4K → 3840×2160', () => {
    expect(computePresetSize('16:9', '4K')).toEqual({ width: 3840, height: 2160 })
  })

  it('9:16 + 4K → 宽度 3840，高度按比例取整', () => {
    expect(computePresetSize('9:16', '4K')).toEqual({ width: 3840, height: 6827 })
  })

  it('1:1 + 8K → 7680×7680', () => {
    expect(computePresetSize('1:1', '8K')).toEqual({ width: 7680, height: 7680 })
  })

  it('扩展档位：1:1 + 1K → 1024×1024；3:2 + 768P → 1152×768', () => {
    expect(computePresetSize('1:1', '1K')).toEqual({ width: 1024, height: 1024 })
    expect(computePresetSize('3:2', '768P')).toEqual({ width: 1152, height: 768 })
  })
})

describe('SIZE_RATIOS / SIZE_RESOLUTIONS', () => {
  it('比例档包含 8 个预设（含 3:2 / 2:3 / 21:9）', () => {
    expect(SIZE_RATIOS.map((r) => r.key)).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'])
  })

  it('分辨率档包含 11 个预设，P 档基准为高度、K 档基准为宽度', () => {
    expect(SIZE_RESOLUTIONS.map((r) => r.key)).toEqual([
      '360P', '480P', '720P', '768P', '1080P', '1K', '1.5K', '2K', '3K', '4K', '8K',
    ])
    expect(SIZE_RESOLUTIONS.find((r) => r.key === '1080P')?.baseOn).toBe('height')
    expect(SIZE_RESOLUTIONS.find((r) => r.key === '768P')?.base).toBe(768)
    expect(SIZE_RESOLUTIONS.find((r) => r.key === '1K')?.base).toBe(1024)
    expect(SIZE_RESOLUTIONS.find((r) => r.key === '4K')?.baseOn).toBe('width')
  })
})

describe('resolveSizeMode', () => {
  it('未启用或无有效宽高 → none', () => {
    expect(resolveSizeMode({ enableSpecifiedSize: false, width: '', height: '' })).toBe('none')
    expect(resolveSizeMode({ enableSpecifiedSize: undefined })).toBe('none')
  })

  it('启用且宽高等于项目尺寸 → project', () => {
    expect(
      resolveSizeMode({ enableSpecifiedSize: true, width: 1080, height: 1920, projectSize: { width: 1080, height: 1920 } }),
    ).toBe('project')
  })

  it('未声明 enable_specified_size 但宽高有效 → 视为已启用（Bridge 工作流回显）', () => {
    expect(resolveSizeMode({ width: 1920, height: 1080 })).toBe('preset')
    expect(resolveSizeMode({ width: 720, height: 1280 })).toBe('preset')
    expect(resolveSizeMode({ width: 1234, height: 567 })).toBe('manual')
    expect(resolveSizeMode({ width: 720, height: 1280, projectSize: { width: 720, height: 1280 } })).toBe('project')
  })

  it('未声明 enable_specified_size 且宽高缺失/无效 → none', () => {
    expect(resolveSizeMode({ width: '', height: '' })).toBe('none')
    expect(resolveSizeMode({ width: 720 })).toBe('none')
    expect(resolveSizeMode({ width: 'abc', height: 'def' })).toBe('none')
  })

  it('启用且宽高匹配某预设 → preset', () => {
    expect(resolveSizeMode({ enableSpecifiedSize: true, width: 1920, height: 1080 })).toBe('preset')
  })

  it('启用且竖屏宽高匹配预设（9:16+1080P=1080×1920）→ preset', () => {
    expect(resolveSizeMode({ enableSpecifiedSize: true, width: 1080, height: 1920 })).toBe('preset')
  })

  it('启用且 K 档宽高匹配预设（16:9+4K=3840×2160）→ preset', () => {
    expect(resolveSizeMode({ enableSpecifiedSize: true, width: 3840, height: 2160 })).toBe('preset')
  })

  it('启用但不匹配任何预设 → manual', () => {
    expect(resolveSizeMode({ enableSpecifiedSize: true, width: 1234, height: 567 })).toBe('manual')
  })

  it('基准落在错误一侧（1080×810 无任何预设产出）→ manual', () => {
    expect(resolveSizeMode({ enableSpecifiedSize: true, width: 1080, height: 810 })).toBe('manual')
  })
})

describe('findSizeParamKeys', () => {
  const decls = (keys: string[]): WorkflowUserParamDeclaration[] =>
    keys.map((key) => ({ key, name: key, defaultValue: '', type: 'integer' }))

  it('同时存在 width 与 height → 返回三个 key', () => {
    expect(findSizeParamKeys(decls(['enable_specified_size', 'width', 'height']))).toEqual({
      widthKey: 'width',
      heightKey: 'height',
      enableKey: 'enable_specified_size',
    })
  })

  it('缺少 width 或 height → null', () => {
    expect(findSizeParamKeys(decls(['width']))).toBeNull()
    expect(findSizeParamKeys(decls(['height', 'enable_specified_size']))).toBeNull()
  })

  it('无 enable_specified_size 时 enableKey 为 undefined', () => {
    expect(findSizeParamKeys(decls(['width', 'height']))).toEqual({
      widthKey: 'width',
      heightKey: 'height',
      enableKey: undefined,
    })
  })
})

describe('mergeSizeValues', () => {
  const keys = { widthKey: 'width', heightKey: 'height', enableKey: 'enable_specified_size' }

  it('清除旧的尺寸值并并入新值，保留非尺寸参数', () => {
    const values = {
      enable_multiple_angles_lora: false,
      enable_specified_size: true,
      width: 1920,
      height: 1080,
    }
    expect(mergeSizeValues(values, keys, { enable_specified_size: false })).toEqual({
      enable_multiple_angles_lora: false,
      enable_specified_size: false,
    })
  })

  it('无 enable 声明时，组件输出的 enable_specified_size 不被并入', () => {
    const keysNoEnable = { widthKey: 'width', heightKey: 'height' }
    const values = { width: '', height: '' }
    expect(mergeSizeValues(values, keysNoEnable, { enable_specified_size: true, width: 100, height: 200 })).toEqual({
      width: 100,
      height: 200,
    })
  })

  it('不修改入参对象', () => {
    const values = { width: '', height: '' }
    mergeSizeValues(values, keys, { enable_specified_size: true, width: 100, height: 200 })
    expect(values).toEqual({ width: '', height: '' })
  })
})

describe('ratioLabel / sizeLabel', () => {
  it('auto / adaptive 归一为「自动」，其余原样', () => {
    expect(ratioLabel('auto')).toBe('自动')
    expect(ratioLabel('adaptive')).toBe('自动')
    expect(ratioLabel('16:9')).toBe('16:9')
    expect(sizeLabel('auto')).toBe('自动')
    expect(sizeLabel('2K')).toBe('2K')
  })
})

describe('normalizeSizeCapabilities', () => {
  it('未声明 → 默认全量', () => {
    expect(normalizeSizeCapabilities()).toEqual({
      ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', 'auto'],
      size: ['360P', '720P', '1080P', '2K', '4K', 'auto'],
      supportCustomSize: true,
    })
  })

  it('空数组回退默认，非空按声明，supportCustomSize 缺省 true', () => {
    expect(normalizeSizeCapabilities({ ratio: [], size: ['1K', '2K', 'auto'] })).toEqual({
      ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', 'auto'],
      size: ['1K', '2K', 'auto'],
      supportCustomSize: true,
    })
    expect(normalizeSizeCapabilities({ supportCustomSize: false }).supportCustomSize).toBe(false)
  })
})

describe('normalizeSizeConfig', () => {
  it('null / 部分字段 → 补默认（auto、无宽高）', () => {
    expect(normalizeSizeConfig(null)).toEqual({ ratio: 'auto', size: 'auto', width: null, height: null })
    expect(normalizeSizeConfig({ ratio: '16:9' })).toEqual({ ratio: '16:9', size: 'auto', width: null, height: null })
  })

  it('字符串数字宽高转为整数，非法置 null', () => {
    expect(normalizeSizeConfig({ ratio: '1:1', size: '2K', width: '1024', height: '1024.6' })).toEqual({
      ratio: '1:1', size: '2K', width: 1024, height: 1025,
    })
    expect(normalizeSizeConfig({ ratio: '1:1', size: '2K', width: 'abc', height: 0 })).toEqual({
      ratio: '1:1', size: '2K', width: null, height: null,
    })
  })
})

describe('resolvePresetSize', () => {
  it('已知档位换算宽高', () => {
    expect(resolvePresetSize('16:9', '1K')).toEqual({ width: 1024, height: 576 })
    expect(resolvePresetSize('1:1', '2K')).toEqual({ width: 2560, height: 2560 })
  })

  it('auto / 未注册档位返回 null', () => {
    expect(resolvePresetSize('auto', '1K')).toBeNull()
    expect(resolvePresetSize('16:9', 'auto')).toBeNull()
    expect(resolvePresetSize('bad', '1K')).toBeNull()
    expect(resolvePresetSize('16:9', 'bad')).toBeNull()
  })
})

describe('inferSizeConfigFromWidthHeight', () => {
  it('命中预设组合（16:9 + 1080P）→ 反推出比例与尺寸档', () => {
    expect(inferSizeConfigFromWidthHeight(1920, 1080)).toEqual({
      ratio: '16:9', size: '1080P', width: 1920, height: 1080,
    })
  })

  it('竖屏 K 档（1:1 + 1K）→ 反推 1:1 / 1K', () => {
    expect(inferSizeConfigFromWidthHeight(1024, 1024)).toEqual({
      ratio: '1:1', size: '1K', width: 1024, height: 1024,
    })
  })

  it('竖屏 P 档（9:16 + 720P = 720×1280）→ 反推', () => {
    expect(inferSizeConfigFromWidthHeight(720, 1280)).toEqual({
      ratio: '9:16', size: '720P', width: 720, height: 1280,
    })
  })

  it('非预设宽高 → ratio/size 回退 auto，宽高保留', () => {
    expect(inferSizeConfigFromWidthHeight(1234, 567)).toEqual({
      ratio: 'auto', size: 'auto', width: 1234, height: 567,
    })
  })

  it('无效宽高 → 全默认', () => {
    expect(inferSizeConfigFromWidthHeight('', '')).toEqual({
      ratio: 'auto', size: 'auto', width: null, height: null,
    })
  })
})

describe('toSizeConfig', () => {
  it('支持自定义时输出宽高，否则只输出比例/尺寸', () => {
    const state = { ratio: '1:1', size: '2K', width: 1024, height: 1024 }
    expect(toSizeConfig(state, true)).toEqual({ ratio: '1:1', size: '2K', width: 1024, height: 1024 })
    expect(toSizeConfig(state, false)).toEqual({ ratio: '1:1', size: '2K' })
  })

  it('无宽高时省略字段', () => {
    expect(toSizeConfig({ ratio: 'auto', size: 'auto', width: null, height: null }, true)).toEqual({
      ratio: 'auto', size: 'auto',
    })
  })
})

describe('formatSizeConfigText', () => {
  it('预设组合不追加自定义宽高：16:9 / 1K', () => {
    expect(formatSizeConfigText({ ratio: '16:9', size: '1K', width: 1024, height: 576 })).toBe('16:9 / 1K')
  })

  it('手动改过宽高追加后缀：1:1 / 2K / 1024x1024', () => {
    expect(formatSizeConfigText({ ratio: '1:1', size: '2K', width: 1024, height: 1024 })).toBe('1:1 / 2K / 1024x1024')
  })

  it('默认状态显示 自动 / 自动', () => {
    expect(formatSizeConfigText({ ratio: 'auto', size: 'auto', width: null, height: null })).toBe('自动 / 自动')
  })

  it('不支持自定义宽高时不显示后缀', () => {
    const caps = { ratio: ['16:9'], size: ['1K'], supportCustomSize: false }
    expect(formatSizeConfigText({ ratio: '16:9', size: '1K', width: 640, height: 360 }, caps)).toBe('16:9 / 1K')
  })

  it('adaptive 显示为 自动', () => {
    expect(formatSizeConfigText({ ratio: 'adaptive', size: '768P', width: null, height: null })).toBe('自动 / 768P')
  })
})

describe('clampSizeConfigState', () => {
  /** Seedream 文生图的真实声明（无 auto 档，尺寸只允许 1K/2K） */
  const seedream = normalizeSizeCapabilities({
    ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    size: ['1K', '2K'],
    supportCustomSize: true,
  })

  it('合法档位原样保留（含宽高）', () => {
    expect(clampSizeConfigState({ ratio: '3:2', size: '2K', width: 2560, height: 1707 }, seedream)).toEqual({
      ratio: '3:2', size: '2K', width: 2560, height: 1707,
    })
  })

  it('越界档位回退到声明清单首项', () => {
    expect(clampSizeConfigState({ ratio: '16:9', size: '360P', width: 640, height: 360 }, seedream)).toEqual({
      ratio: '16:9', size: '1K', width: 640, height: 360,
    })
    expect(clampSizeConfigState({ ratio: '5:4', size: '1K', width: null, height: null }, seedream)).toEqual({
      ratio: '1:1', size: '1K', width: null, height: null,
    })
  })

  it('auto / adaptive 视为未选择，不参与钳制（声明清单不含 auto 时也保持自动）', () => {
    expect(clampSizeConfigState({ ratio: 'auto', size: 'auto', width: null, height: null }, seedream)).toEqual({
      ratio: 'auto', size: 'auto', width: null, height: null,
    })
    expect(clampSizeConfigState({ ratio: 'adaptive', size: 'auto', width: null, height: null }, seedream)).toEqual({
      ratio: 'adaptive', size: 'auto', width: null, height: null,
    })
  })

  it('宽高不参与钳制（自定义宽高恒原样保留）', () => {
    const caps = normalizeSizeCapabilities({ ratio: ['16:9'], size: ['1K'], supportCustomSize: false })
    expect(clampSizeConfigState({ ratio: '21:9', size: '4K', width: 1234, height: 567 }, caps)).toEqual({
      ratio: '16:9', size: '1K', width: 1234, height: 567,
    })
  })

  it('不修改入参', () => {
    const state = { ratio: '21:9', size: '4K', width: null, height: null }
    clampSizeConfigState(state, seedream)
    expect(state).toEqual({ ratio: '21:9', size: '4K', width: null, height: null })
  })
})

describe('回归：能力声明异步到达前后的档位回显', () => {
  /** Seedream 文生图的真实声明（工作流列表拉取完成后才可得） */
  const seedream = normalizeSizeCapabilities({
    ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    size: ['1K', '2K'],
    supportCustomSize: true,
  })
  /** 已保存的节点配置（用户上次选择 3:2 / 2K） */
  const saved = { ratio: '3:2', size: '2K', width: 2560, height: 1707 }

  it('能力未知时不得钳制：默认全量清单会把 3:2 改成 16:9', () => {
    // 反证：用未加载完成时的默认清单钳制，正是「比例被改错、宽高仍正确」的根因
    const wrong = clampSizeConfigState(normalizeSizeConfig(saved), normalizeSizeCapabilities(undefined))
    expect(wrong.ratio).toBe('16:9')
    expect(wrong.width).toBe(2560)
  })

  it('始终以回显原值重新推导：能力到达后仍还原为 3:2 / 2K', () => {
    // 组件行为：echoState 保存未钳制原值，能力到达后据此重新推导（而非在钳制结果上二次钳制）
    const echo = normalizeSizeConfig(saved)
    expect(clampSizeConfigState(echo, seedream)).toEqual({
      ratio: '3:2', size: '2K', width: 2560, height: 1707,
    })
  })

  it('若在已钳制结果上二次钳制则错值被固化（旧实现缺陷）', () => {
    const once = clampSizeConfigState(normalizeSizeConfig(saved), normalizeSizeCapabilities(undefined))
    // 16:9 在 Seedream 清单内 → 二次钳制不会纠正，错误比例就此固化
    expect(clampSizeConfigState(once, seedream).ratio).toBe('16:9')
  })
})
