import { describe, expect, it } from 'vitest'
import {
  AUDIO_TRIM_FORMAT_ORIG,
  AUDIO_TRIM_MP3_BITRATE_DEFAULT,
  audioTrimBitrateOf,
  audioTrimFormatOf,
  audioTrimOutputExt,
  audioTrimTargetsMp3,
  extOfAudioPath,
  isAudioTrimOutputExt,
} from './audioTrim'

describe('audioTrimFormatOf（config.format 读取与净化）', () => {
  it('缺省/空/非法值一律视作「原格式」（哨兵 ---）', () => {
    expect(audioTrimFormatOf()).toBe(AUDIO_TRIM_FORMAT_ORIG)
    expect(audioTrimFormatOf(null)).toBe(AUDIO_TRIM_FORMAT_ORIG)
    expect(audioTrimFormatOf({})).toBe(AUDIO_TRIM_FORMAT_ORIG)
    expect(audioTrimFormatOf({ format: 'flac2' })).toBe(AUDIO_TRIM_FORMAT_ORIG)
    expect(audioTrimFormatOf({ format: 5 })).toBe(AUDIO_TRIM_FORMAT_ORIG)
  })

  it('读取三个显式格式与「原格式」哨兵', () => {
    expect(audioTrimFormatOf({ format: AUDIO_TRIM_FORMAT_ORIG })).toBe('---')
    expect(audioTrimFormatOf({ format: 'wav' })).toBe('wav')
    expect(audioTrimFormatOf({ format: 'flac' })).toBe('flac')
    expect(audioTrimFormatOf({ format: 'mp3' })).toBe('mp3')
  })
})

describe('audioTrimBitrateOf（config.mp3Bitrate 读取与净化）', () => {
  it('缺省/非法值回退 192', () => {
    expect(audioTrimBitrateOf()).toBe(AUDIO_TRIM_MP3_BITRATE_DEFAULT)
    expect(audioTrimBitrateOf({ mp3Bitrate: 64 })).toBe(192)
    expect(audioTrimBitrateOf({ mp3Bitrate: '192' })).toBe(192)
  })

  it('读取白名单码率', () => {
    expect(audioTrimBitrateOf({ mp3Bitrate: 128 })).toBe(128)
    expect(audioTrimBitrateOf({ mp3Bitrate: 192 })).toBe(192)
    expect(audioTrimBitrateOf({ mp3Bitrate: 320 })).toBe(320)
  })
})

describe('extOfAudioPath（输入路径扩展名解析）', () => {
  it('取小写扩展名（含大小写与反斜杠路径）', () => {
    expect(extOfAudioPath('assert/a.flac')).toBe('flac')
    expect(extOfAudioPath('assert/scene/1/1/canvas/n1/output.WAV')).toBe('wav')
    expect(extOfAudioPath('assert\\custom\\bgm.Mp3')).toBe('mp3')
    expect(extOfAudioPath('assert/custom/voice.ogg')).toBe('ogg')
    expect(extOfAudioPath('assert/custom/voice.m4a')).toBe('m4a')
  })

  it('空值/无扩展名/白名单外扩展名返回 null', () => {
    expect(extOfAudioPath()).toBeNull()
    expect(extOfAudioPath('')).toBeNull()
    expect(extOfAudioPath('assert/noext')).toBeNull()
    expect(extOfAudioPath('assert/audio.xyz')).toBeNull()
    expect(extOfAudioPath('assert/audio.mp4')).toBeNull()
  })
})

describe('isAudioTrimOutputExt（白名单校验）', () => {
  it('白名单内为真，其余为假', () => {
    expect(isAudioTrimOutputExt('flac')).toBe(true)
    expect(isAudioTrimOutputExt('WAV')).toBe(true)
    expect(isAudioTrimOutputExt('m4a')).toBe(true)
    expect(isAudioTrimOutputExt('xyz')).toBe(false)
    expect(isAudioTrimOutputExt(5)).toBe(false)
    expect(isAudioTrimOutputExt(undefined)).toBe(false)
  })
})

describe('audioTrimOutputExt（产物扩展名解析）', () => {
  it('显式格式优先于一切', () => {
    expect(audioTrimOutputExt({ format: 'wav' }, 'assert/a.flac')).toBe('wav')
    expect(audioTrimOutputExt({ format: 'mp3', outputExt: 'wav' }, 'assert/a.flac')).toBe('mp3')
  })

  it('「原格式」有输入路径时跟随输入扩展名', () => {
    expect(audioTrimOutputExt(undefined, 'assert/a.mp3')).toBe('mp3')
    expect(audioTrimOutputExt({}, 'assert/a.flac')).toBe('flac')
    expect(audioTrimOutputExt({ format: '---' }, 'assert/custom/bgm.ogg')).toBe('ogg')
  })

  it('「原格式」输入扩展名不在白名单时忽略输入', () => {
    expect(audioTrimOutputExt({ format: '---' }, 'assert/a.xyz')).toBe('flac')
  })

  it('「原格式」无输入路径时使用 outputExt 镜像', () => {
    expect(audioTrimOutputExt({ outputExt: 'mp3' })).toBe('mp3')
    expect(audioTrimOutputExt({ format: '---', outputExt: 'ogg' })).toBe('ogg')
    expect(audioTrimOutputExt({ outputExt: 'bad' })).toBe('flac')
  })

  it('全部不可得时兜底 flac', () => {
    expect(audioTrimOutputExt()).toBe('flac')
    expect(audioTrimOutputExt({})).toBe('flac')
  })
})

describe('audioTrimTargetsMp3（实际是否输出 mp3）', () => {
  it('显式 mp3 恒为真', () => {
    expect(audioTrimTargetsMp3({ format: 'mp3' })).toBe(true)
    expect(audioTrimTargetsMp3({ format: 'mp3' }, 'assert/a.wav')).toBe(true)
  })

  it('「原格式」仅输入为 mp3 时为真', () => {
    expect(audioTrimTargetsMp3({}, 'assert/a.mp3')).toBe(true)
    expect(audioTrimTargetsMp3({}, 'assert/a.flac')).toBe(false)
    expect(audioTrimTargetsMp3({}, 'assert/a.xyz')).toBe(false)
    expect(audioTrimTargetsMp3({})).toBe(false)
  })

  it('wav/flac 恒为假', () => {
    expect(audioTrimTargetsMp3({ format: 'wav' })).toBe(false)
    expect(audioTrimTargetsMp3({ format: 'flac' }, 'assert/a.mp3')).toBe(false)
  })
})
