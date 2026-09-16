import { describe, expect, it } from 'vitest'
import { readVideoSpec } from './videoSpec'

describe('readVideoSpec', () => {
  it('config.* 为唯一权威：同时存在时优先于 config.director.*', () => {
    const spec = readVideoSpec({
      duration: 8,
      fps: 30,
      resolution: { width: 1280, height: 720 },
      director: { duration: 10, width: 1080, height: 1920, fps: 24, imageClips: [], audioClips: [] },
    })
    expect(spec).toEqual({ duration: 8, width: 1280, height: 720, fps: 30 })
  })

  it('旧画布回退：仅有 config.director.* 时读到导演台规格', () => {
    const spec = readVideoSpec({
      mode: 'director',
      director: { duration: 10, width: 1080, height: 1920, fps: 24, imageClips: [], audioClips: [] },
    })
    expect(spec).toEqual({ duration: 10, width: 1080, height: 1920, fps: 24 })
  })

  it('尺寸回退链：resolution → sizeConfig → director 宽高', () => {
    // resolution 只有单维有效 → 落到 sizeConfig
    expect(
      readVideoSpec({
        resolution: { width: 1280 },
        sizeConfig: { ratio: '16:9', size: '1K', width: 1920, height: 1080 },
        director: { width: 720, height: 1280, duration: 0, fps: 0, imageClips: [], audioClips: [] },
      }),
    ).toEqual({ duration: 0, width: 1920, height: 1080, fps: 0 })

    // resolution/sizeConfig 均无效 → 落回 director 宽高
    expect(
      readVideoSpec({
        resolution: {},
        sizeConfig: { ratio: '自动', size: '自动' },
        director: { width: 720, height: 1280, duration: 5, fps: 0, imageClips: [], audioClips: [] },
      }),
    ).toEqual({ duration: 5, width: 720, height: 1280, fps: 0 })
  })

  it('字段非法（字符串非数字/负数/0/NaN）时按未设置处理', () => {
    const spec = readVideoSpec({
      duration: 'abc',
      fps: -1,
      resolution: { width: 0, height: 720 },
      sizeConfig: { width: 'x', height: 'y' },
      director: { duration: 0, width: 0, height: 0, fps: 0, imageClips: [], audioClips: [] },
    })
    expect(spec).toEqual({ duration: 0, width: 0, height: 0, fps: 0 })
  })

  it('空配置/缺失 director 时返回全 0', () => {
    expect(readVideoSpec(undefined)).toEqual({ duration: 0, width: 0, height: 0, fps: 0 })
    expect(readVideoSpec({})).toEqual({ duration: 0, width: 0, height: 0, fps: 0 })
    // director 非对象（脏数据）时不抛错
    expect(readVideoSpec({ director: 'oops' })).toEqual({ duration: 0, width: 0, height: 0, fps: 0 })
  })
})
