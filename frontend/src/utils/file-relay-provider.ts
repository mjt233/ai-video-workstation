/**
 * 文件中转（file-relay）服务商前端工具：脚本模板与 Monaco TypeScript 类型库。
 *
 * 类型库与服务端 `server/src/providers/file-relay/runtime.ts` 的运行时契约保持一致：
 * FileRelayContext / FileRelayFile / FileRelayRequestConfig / FileRelayRequestResult / FileRelayResult。
 * 编辑器据此提供字段提示与「必须返回 { url }」的类型校验；改动任何一侧时需同步另一侧。
 */

/**
 * 文件中转脚本默认模板：multipart 上传到自建中转服务的示例。
 *
 * 编辑器「插入模板」按钮把本模板插入脚本编辑器；用户按实际中转接口改 URL/字段即可。
 */
export const FILE_RELAY_CODE_TEMPLATE = [
  '// 文件中转脚本契约：export default 一个 async 函数，返回 { url: 公网可访问的 http(s) 地址 }',
  '// ctx.providerConfig 为服务商实例配置（baseUrl / apiKey / timeout 等，见「文件中转」表单）',
  '// ctx.file 为待上传的本地文件（已限定在项目目录内）；ctx.request 为 axios 风格请求',
  'export default async function (ctx: FileRelayContext): Promise<FileRelayResult> {',
  '  // 1) 用 FormData 组装 multipart 上传（文件名取原始文件名，MIME 由扩展名推断）',
  '  const fd = new FormData()',
  "  fd.append('file', await ctx.file.toFile(), ctx.file.name)",
  '',
  '  // 2) 调用自建中转服务的上传接口（baseUrl / apiKey 在服务商配置中填写）',
  '  const res = await ctx.request({',
  "    url: ctx.providerConfig.baseUrl + '/upload',",
  "    method: 'post',",
  "    header: { Authorization: 'Bearer ' + ctx.providerConfig.apiKey },",
  '    data: fd,',
  '  })',
  '',
  '  // 3) 校验 HTTP 状态：413（上传体积超限）/401/403 等会在这里给出可读原因',
  '  if (res.status < 200 || res.status >= 300) {',
  "    const detail = typeof res.data === 'string' ? res.data.slice(0, 200) : JSON.stringify(res.data).slice(0, 200)",
  "    throw new Error('上传失败：HTTP ' + res.status + ' ' + detail)",
  '  }',
  '',
  '  // 4) 从响应中取出公网 URL 并返回（服务端会校验必须是 http(s) 地址）',
  '  const url = (res.data as { url?: unknown }).url',
  "  if (typeof url !== 'string' || !url) throw new Error('中转服务未返回 url')",
  '  return { url }',
  '}',
].join('\n')

/** 文件中转脚本的上下文类型库（Monaco 直译的 d.ts，声明服务端运行时注入的全部能力） */
const FILE_RELAY_CONTEXT_LIB = [
  'declare interface FileRelayFile {',
  '  /** 项目内相对路径（如 assert/shot/xxx/video.mp4） */',
  '  path: string',
  '  /** 文件名（含扩展名，如 video.mp4） */',
  '  name: string',
  '  /** MIME 类型（按扩展名推断，如 video/mp4） */',
  '  mimeType: string',
  '  /** 文件字节数 */',
  '  size: number',
  '  /** 读取完整内容（Uint8Array，适合作为原始二进制请求体） */',
  '  read(): Promise<Uint8Array>',
  '  /** 读取为纯 Base64 字符串（不含 data: 前缀） */',
  '  base64(): Promise<string>',
  '  /** 读取为 Web File 对象（用于 FormData 上传） */',
  '  toFile(): Promise<File>',
  '}',
  '',
  'declare interface FileRelayProviderConfig {',
  '  /** 中转服务基础地址（服务商配置的「API 地址」） */',
  '  baseUrl?: string',
  '  /** 公网访问地址（可选）：用于拼接返回给模型的 URL；留空时使用 baseUrl（适用于上传走内网/非标准端口、公网走 443 反向代理） */',
  '  publicBaseUrl?: string',
  '  /** 中转服务密钥（服务商配置的「API Key」，保存后不回显） */',
  '  apiKey?: string',
  '  /** 单次中转总超时（秒） */',
  '  timeout?: number',
  '  /** 其他自定义配置字段 */',
  '  [key: string]: unknown',
  '}',
  '',
  'declare interface FileRelayRequestConfig {',
  '  /** 请求地址（必填） */',
  '  url: string',
  '  /** 请求方法，默认 post */',
  '  method?: string',
  '  /** 请求头（键值对） */',
  '  header?: Record<string, string>',
  '  /** 请求体：普通对象按 JSON 序列化；FormData（含 File）按 multipart 上传；Uint8Array/ArrayBuffer 按原始二进制发送 */',
  '  data?: unknown',
  '  /** URL 查询参数（自动拼接到 url） */',
  '  params?: Record<string, unknown>',
  '  /** 单次请求超时（毫秒），默认 120000 */',
  '  timeout?: number',
  '}',
  '',
  'declare interface FileRelayRequestResult {',
  '  /** 响应体：JSON 自动反序列化，否则为响应原文 */',
  '  data: any',
  '  /** HTTP 状态码 */',
  '  status: number',
  '  /** 响应头（键值对） */',
  '  headers: Record<string, string>',
  '}',
  '',
  'declare interface FileRelayContext {',
  '  /** 服务商已解析配置（baseUrl / apiKey / timeout 等） */',
  '  providerConfig: FileRelayProviderConfig',
  '  /** 待上传的本地文件（服务端已限定在项目目录内） */',
  '  file: FileRelayFile',
  '  /** axios 风格 HTTP 请求：JSON / FormData / 原始二进制；带单次请求超时与任务中止 */',
  '  request(conf: FileRelayRequestConfig): Promise<FileRelayRequestResult>',
  '  /** 任务级中止信号：用户中断任务时触发；自行 fetch 时可透传给 signal */',
  '  signal?: AbortSignal',
  '}',
  '',
  'declare interface FileRelayResult {',
  '  /** 公网可访问的 http(s) URL（必填，服务端会校验协议） */',
  '  url: string',
  '}',
].join('\n')

/**
 * 生成文件中转脚本编辑器的 Monaco TypeScript 类型库。
 *
 * 声明 FileRelayContext / FileRelayFile / FileRelayProviderConfig /
 * FileRelayRequestConfig / FileRelayRequestResult / FileRelayResult，
 * 编辑器中编写 `export default async function (ctx: FileRelayContext)` 时即可获得
 * ctx 字段提示、request 参数提示与返回值校验。
 *
 * @returns d.ts 库文本（供 MonacoEditor 的 extraLibs 使用）
 */
export function buildFileRelayContextLib(): string {
  return FILE_RELAY_CONTEXT_LIB
}
