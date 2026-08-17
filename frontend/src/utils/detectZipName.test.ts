import { describe, expect, it } from 'vitest'
import {
  detectZipProjectName,
  detectZipWrapperName,
  isValidProjectName,
} from './detectZipName'

/** 拼接多个 Uint8Array */
function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/**
 * 构造仅含中央目录 + EOCD 的 zip 字节。
 * 探测逻辑只读中央目录元数据（不解压、不校验 CRC），
 * 因此测试包无需本地文件头与真实压缩数据。
 * @param names 中央目录条目名（含路径分隔符）
 */
function buildZipBytes(names: string[]): Uint8Array {
  const encoder = new TextEncoder()
  const cdParts: Uint8Array[] = []
  for (const name of names) {
    const nameBytes = encoder.encode(name)
    const entry = new Uint8Array(46 + nameBytes.length)
    const dv = new DataView(entry.buffer)
    dv.setUint32(0, 0x02014b50, true) // PK\x01\x02
    dv.setUint16(28, nameBytes.length, true) // 文件名长度
    entry.set(nameBytes, 46)
    cdParts.push(entry)
  }
  const cd = concatBytes(cdParts)
  const eocd = new Uint8Array(22)
  const dv = new DataView(eocd.buffer)
  dv.setUint32(0, 0x06054b50, true) // PK\x05\x06
  dv.setUint16(8, names.length, true) // 本盘条目数
  dv.setUint16(10, names.length, true) // 总条目数
  dv.setUint32(12, cd.length, true) // 中央目录大小
  dv.setUint32(16, 0, true) // 中央目录偏移
  return concatBytes([cd, eocd])
}

describe('isValidProjectName', () => {
  it('合法名称通过校验', () => {
    expect(isValidProjectName('古人在现代')).toBe(true)
    expect(isValidProjectName('  AI的第一天  ')).toBe(true)
  })

  it('空名称、点号、含斜杠、超长名称校验失败', () => {
    expect(isValidProjectName('')).toBe(false)
    expect(isValidProjectName('   ')).toBe(false)
    expect(isValidProjectName('.')).toBe(false)
    expect(isValidProjectName('..')).toBe(false)
    expect(isValidProjectName('a/b')).toBe(false)
    expect(isValidProjectName('a\\b')).toBe(false)
    expect(isValidProjectName('x'.repeat(65))).toBe(false)
    expect(isValidProjectName('x'.repeat(64))).toBe(true)
  })
})

describe('detectZipWrapperName', () => {
  it('全部条目共享同一顶层段时返回该段（含目录与文件）', () => {
    const bytes = buildZipBytes(['p/', 'p/assert/x.png', 'p/overview.md', 'p/prompt/character/a.md'])
    expect(detectZipWrapperName(bytes, 4)).toBe('p')
  })

  it('中文项目名正常识别', () => {
    const bytes = buildZipBytes(['南柯一梦/', '南柯一梦/prompt/scene/1/1/overview.json'])
    expect(detectZipWrapperName(bytes, 2)).toBe('南柯一梦')
  })

  it('扁平结构（多个顶层条目）返回 null', () => {
    const bytes = buildZipBytes(['prompt/a.md', 'assert/b.png', 'overview.md'])
    expect(detectZipWrapperName(bytes, 3)).toBeNull()
  })

  it('空包（0 条目）返回 null', () => {
    expect(detectZipWrapperName(buildZipBytes([]), 0)).toBeNull()
  })

  it('单个文件（无目录外壳）视为单一顶层段', () => {
    expect(detectZipWrapperName(buildZipBytes(['foo.txt']), 1)).toBe('foo.txt')
  })

  it('忽略 __MACOSX 杂项段', () => {
    const bytes = buildZipBytes(['__MACOSX/._p', 'p/assert/x.png', 'p/overview.md'])
    expect(detectZipWrapperName(bytes, 3)).toBe('p')
  })

  it('反斜杠路径规范化后识别', () => {
    const bytes = buildZipBytes(['proj\\assert\\x.png'])
    expect(detectZipWrapperName(bytes, 1)).toBe('proj')
  })
})

describe('detectZipProjectName', () => {
  it('有外壳目录时返回压缩包内原始项目名', async () => {
    const zip = buildZipBytes(['古人在现代/', '古人在现代/prompt/character/张三/overview.md'])
    const file = new File([zip], '随便改名的包.zip')
    await expect(detectZipProjectName(file)).resolves.toBe('古人在现代')
  })

  it('扁平结构时回退为文件名去 .zip 后缀', async () => {
    const zip = buildZipBytes(['prompt/a.md', 'assert/b.png'])
    const file = new File([zip], '我的备份.ZIP')
    await expect(detectZipProjectName(file)).resolves.toBe('我的备份')
  })

  it('非 zip 文件（无 EOCD）回退为文件名', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5])
    const file = new File([garbage], 'test.zip')
    await expect(detectZipProjectName(file)).resolves.toBe('test')
  })

  it('空文件返回空字符串', async () => {
    const file = new File([], 'empty.zip')
    await expect(detectZipProjectName(file)).resolves.toBe('')
  })

  it('文件名含路径时仅取 basename', async () => {
    const zip = buildZipBytes(['prompt/a.md', 'assert/b.png'])
    const file = new File([zip], 'C:\\fakepath\\demo.zip')
    await expect(detectZipProjectName(file)).resolves.toBe('demo')
  })
})
