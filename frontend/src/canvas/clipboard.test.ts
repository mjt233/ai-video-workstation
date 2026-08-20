import { describe, expect, it } from 'vitest'
import { buildClipboardAssetDest, buildLoaderUploadDest, classifyPastedFile, collectPastedMedia } from './clipboard'

/** 构造带指定 MIME 与文件名的 File 对象 */
function makeFile(name: string, type = ''): File {
  return new File(['x'], name, { type })
}

/** 构造与 DataTransfer.items 结构兼容的假剪贴板数据（node 环境无 DataTransfer） */
function fakeTransfer(items: { kind: string; getAsFile: () => File | null }[]): DataTransfer {
  return { items } as unknown as DataTransfer
}

/** 文件项 */
function fileItem(file: File) {
  return { kind: 'file', getAsFile: () => file }
}

/** 非文件项（纯文本） */
function textItem() {
  return { kind: 'string', getAsFile: () => null }
}

describe('classifyPastedFile', () => {
  it('按 MIME 类型识别图片/视频/音频', () => {
    expect(classifyPastedFile(makeFile('a.png', 'image/png'))).toBe('image-loader')
    expect(classifyPastedFile(makeFile('a.mp4', 'video/mp4'))).toBe('video-loader')
    expect(classifyPastedFile(makeFile('a.flac', 'audio/flac'))).toBe('audio-loader')
  })

  it('MIME 为空时按扩展名兜底识别', () => {
    expect(classifyPastedFile(makeFile('a.JPG'))).toBe('image-loader')
    expect(classifyPastedFile(makeFile('a.webm'))).toBe('video-loader')
    expect(classifyPastedFile(makeFile('a.ogg'))).toBe('audio-loader')
  })

  it('无法识别的文件返回 undefined', () => {
    expect(classifyPastedFile(makeFile('a.txt', 'text/plain'))).toBeUndefined()
    expect(classifyPastedFile(makeFile('a.xyz'))).toBeUndefined()
  })
})

describe('collectPastedMedia', () => {
  it('收集可识别文件并忽略非文件项', () => {
    const dt = fakeTransfer([fileItem(makeFile('a.png', 'image/png')), fileItem(makeFile('b.mp4', 'video/mp4')), textItem()])
    const { media, unsupported } = collectPastedMedia(dt)
    expect(media.map((m) => m.prototypeId)).toEqual(['image-loader', 'video-loader'])
    expect(unsupported).toEqual([])
  })

  it('不支持的文件记录文件名', () => {
    const dt = fakeTransfer([fileItem(makeFile('a.exe', 'application/octet-stream'))])
    const { media, unsupported } = collectPastedMedia(dt)
    expect(media).toEqual([])
    expect(unsupported).toEqual(['a.exe'])
  })

  it('null 剪贴板返回空结果', () => {
    expect(collectPastedMedia(null)).toEqual({ media: [], unsupported: [] })
  })
})

describe('buildClipboardAssetDest', () => {
  it('生成自定义资产目录路径（时间戳 + 序号 + 原文件名）', () => {
    const file = makeFile('a.png', 'image/png')
    expect(buildClipboardAssetDest(file, 2, 12345)).toBe('assert/custom/canvas/12345-2-a.png')
  })
})

describe('buildLoaderUploadDest', () => {
  it('生成加载节点上传目标路径（时间戳 + 原文件名）', () => {
    const file = makeFile('a.png', 'image/png')
    expect(buildLoaderUploadDest(file, 12345)).toBe('assert/custom/canvas/12345-a.png')
  })
})
