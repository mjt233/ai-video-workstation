import { describe, expect, it } from 'vitest'
import {
  computePresetSize,
  findSizeParamKeys,
  resolveSizeMode,
  SIZE_RATIOS,
  SIZE_RESOLUTIONS,
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
    expect(computePresetSize('9:16', '4K')).toEqual({ width: 3840, height: Math.round(3840 / (9 / 16)) })
  })

  it('1:1 + 8K → 7680×7680', () => {
    expect(computePresetSize('1:1', '8K')).toEqual({ width: 7680, height: 7680 })
  })
})

describe('SIZE_RATIOS / SIZE_RESOLUTIONS', () => {
  it('比例档包含 5 个预设', () => {
    expect(SIZE_RATIOS.map((r) => r.key)).toEqual(['1:1', '16:9', '9:16', '4:3', '3:4'])
  })

  it('分辨率档包含 6 个预设，P 档基准为高度、K 档基准为宽度', () => {
    expect(SIZE_RESOLUTIONS.map((r) => r.key)).toEqual(['360P', '720P', '1080P', '2K', '4K', '8K'])
    expect(SIZE_RESOLUTIONS.find((r) => r.key === '1080P')?.baseOn).toBe('height')
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

  it('启用且宽高匹配某预设 → preset', () => {
    expect(resolveSizeMode({ enableSpecifiedSize: true, width: 1920, height: 1080 })).toBe('preset')
  })

  it('启用但不匹配任何预设 → manual', () => {
    expect(resolveSizeMode({ enableSpecifiedSize: true, width: 1234, height: 567 })).toBe('manual')
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
