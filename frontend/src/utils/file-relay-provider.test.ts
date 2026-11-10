import { describe, expect, it } from 'vitest'
import { FILE_RELAY_CODE_TEMPLATE, buildFileRelayContextLib } from './file-relay-provider'
import { insertCodeTemplate } from './custom-provider'

describe('FILE_RELAY_CODE_TEMPLATE', () => {
  it('是可直接执行的 export default 异步函数示例（multipart 上传）', () => {
    expect(FILE_RELAY_CODE_TEMPLATE).toContain(
      'export default async function (ctx: FileRelayContext): Promise<FileRelayResult>',
    )
    expect(FILE_RELAY_CODE_TEMPLATE).toContain('new FormData()')
    expect(FILE_RELAY_CODE_TEMPLATE).toContain('ctx.file.toFile()')
    expect(FILE_RELAY_CODE_TEMPLATE).toContain('ctx.providerConfig.baseUrl')
    expect(FILE_RELAY_CODE_TEMPLATE).toContain('return { url }')
  })
})

describe('buildFileRelayContextLib', () => {
  it('声明脚本契约的上下文、请求与返回类型', () => {
    const lib = buildFileRelayContextLib()
    for (const name of [
      'FileRelayContext',
      'FileRelayFile',
      'FileRelayProviderConfig',
      'FileRelayRequestConfig',
      'FileRelayRequestResult',
      'FileRelayResult',
    ]) {
      expect(lib).toContain('declare interface ' + name)
    }
    expect(lib).toContain('file: FileRelayFile')
    expect(lib).toContain('request(conf: FileRelayRequestConfig): Promise<FileRelayRequestResult>')
    expect(lib).toContain('signal?: AbortSignal')
    expect(lib).toContain('read(): Promise<Uint8Array>')
    expect(lib).toContain('base64(): Promise<string>')
    expect(lib).toContain('toFile(): Promise<File>')
    expect(lib).toContain('url: string')
  })

  it('插入模板到已有代码时追加而非覆盖', () => {
    const merged = insertCodeTemplate('// 旧代码', FILE_RELAY_CODE_TEMPLATE)
    expect(merged.startsWith('// 旧代码')).toBe(true)
    expect(merged).toContain('export default async function')
  })
})
