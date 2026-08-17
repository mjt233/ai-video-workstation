import { describe, expect, it } from 'vitest'
import { buildComfyuiProviderOptions, DEFAULT_COMFYUI_PROVIDER_OPTION } from './comfyuiProviderOptions'
import type { ComfyuiBridgeProviderInfo } from '../api/providers'

/** 构造一个提供商实例摘要（缺省启用、comfyui 类型） */
function mk(over: Partial<ComfyuiBridgeProviderInfo> = {}): ComfyuiBridgeProviderInfo {
  return { id: 'p', name: '实例', type: 'comfyui', enabled: true, ...over }
}

describe('buildComfyuiProviderOptions', () => {
  it('默认项恒在首位（空串 = 不指定）', () => {
    const opts = buildComfyuiProviderOptions([])
    expect(opts).toHaveLength(1)
    expect(opts[0]).toEqual(DEFAULT_COMFYUI_PROVIDER_OPTION)
    expect(opts[0].value).toBe('')
  })

  it('仅纳入启用实例，RunningHub 类型带后缀', () => {
    const opts = buildComfyuiProviderOptions([
      mk({ id: 'a', name: '本地', type: 'comfyui', enabled: true }),
      mk({ id: 'b', name: '云端', type: 'runninghub', enabled: true }),
      mk({ id: 'c', name: '停用', enabled: false }),
    ])
    expect(opts.map((o) => o.value)).toEqual(['', 'a', 'b'])
    expect(opts.find((o) => o.value === 'b')!.label).toBe('云端（RunningHub）')
  })

  it('currentId 为已禁用/不存在实例时追加为禁用项回显', () => {
    const opts = buildComfyuiProviderOptions([mk({ id: 'a', name: '本地' })], 'gone')
    expect(opts.map((o) => o.value)).toEqual(['', 'a', 'gone'])
    expect(opts[2].disabled).toBe(true)
  })

  it('currentId 在启用列表中时不追加回退项', () => {
    const opts = buildComfyuiProviderOptions([mk({ id: 'a', name: '本地' })], 'a')
    expect(opts.map((o) => o.value)).toEqual(['', 'a'])
    expect(opts[1].disabled).toBe(false)
  })

  it('currentId 为空串时不追加回退项', () => {
    const opts = buildComfyuiProviderOptions([], '')
    expect(opts).toHaveLength(1)
  })
})
