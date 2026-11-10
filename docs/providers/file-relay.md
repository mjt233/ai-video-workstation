# 文件中转（File Relay）

> 返回 [文档索引](../README.md)。相关：[AI 文本节点媒体能力](../canvas/node-types.md)、[LLM 会话](../canvas/llm-session.md)、[实施计划](../plans/2026-11-10-ai-text-media-input.md)。

## 定位

「文件中转」是**系统设置 → 服务商配置**中的一个独立服务商分类（分类 id `file-relay`），用于把**本地文件上传到公网可访问的存储**并拿到 URL。

它只服务于「需要公网 URL 才能发送的媒体输入」：目前唯一使用方是 **AI文本生成节点的视频输入**——智谱 BigModel 等视觉模型的 `video_url` 只接受公网 URL（本地画布产物没有公网地址），因此 LLM 请求前由后台自动调用文件中转服务商上传文件、换取 URL。

- 分类页签：**文件中转**；提供商类型当前固定一个：**自定义脚本**（类型 id `file-relay-script`）。
- 不参与工作流执行：该服务商不注册任何工作流，也不出现在工作流实现下拉中。
- 多个实例时，取**第一个 `enabled !== false` 的实例**；未配置时含视频输入的 LLM 请求会直接报错（见下）。

## 配置字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 启用 | boolean（默认 true） | 否 | 关闭后不再作为中转实例被选用 |
| API 地址 `baseUrl` | string | 否 | 中转服务基础地址，脚本中通过 `ctx.providerConfig.baseUrl` 读取（上传请求走这里） |
| 公网访问地址 `publicBaseUrl` | string | 否 | 可选：用于拼接返回给模型的 URL；留空时使用 `baseUrl`。适用于「上传走内网/非标准端口、公网走 443 反向代理」的场景（见下节） |
| API Key `apiKey` | password（secret） | 否 | 脚本中通过 `ctx.providerConfig.apiKey` 读取；保存后不回显 |
| 超时 `timeout` | number（秒，默认 120） | 否 | 单次中转（脚本执行 + 上传）总超时 |
| 脚本 `script` | TypeScript 代码 | 是 | `export default async function(ctx: FileRelayContext): Promise<FileRelayResult>` |

## 脚本契约

脚本在服务端 `node:vm` 沙箱中执行（与「自定义服务商」同一套运行时：白名单全局、无 `require`、可用 `fetch`/`FormData`/`File`/`Blob`）。**沙箱不是安全边界**，本工具为本地工作站场景。

```ts
interface FileRelayContext {
  /** 服务商已解析配置（baseUrl / apiKey / timeout 等） */
  providerConfig: Record<string, unknown>
  /** 待上传的本地文件（已限定在项目目录内） */
  file: {
    /** 项目内相对路径 */
    path: string
    /** 文件名 */
    name: string
    /** MIME（按扩展名推断） */
    mimeType: string
    /** 字节数 */
    size: number
    /** 读取完整内容 */
    read(): Promise<Uint8Array>
    /** 读取为 base64（无 data: 前缀） */
    base64(): Promise<string>
    /** 读取为 Web File（用于 FormData 上传） */
    toFile(): Promise<File>
  }
  /** axios 风格 HTTP 请求：JSON / FormData / 原始二进制；带超时与任务中止 */
  request(conf: {
    url: string
    method?: string
    header?: Record<string, string>
    data?: unknown
    params?: Record<string, unknown>
    timeout?: number
  }): Promise<{ data: unknown; status: number; headers: Record<string, string> }>
  /** 任务级中止信号：用户中断 LLM 任务时触发 */
  signal?: AbortSignal
}

interface FileRelayResult {
  /** 公网可访问的 http(s) URL（必填） */
  url: string
}
```

### 示例一：multipart 上传到自建中转服务

```ts
export default async function (ctx: FileRelayContext): Promise<FileRelayResult> {
  const fd = new FormData()
  fd.append('file', await ctx.file.toFile(), ctx.file.name)
  const res = await ctx.request({
    url: ctx.providerConfig.baseUrl + '/upload',
    method: 'post',
    header: { Authorization: 'Bearer ' + ctx.providerConfig.apiKey },
    data: fd,
  })
  // 校验 HTTP 状态：413（上传体积超限）/401/403 等在这里给出可读原因
  if (res.status < 200 || res.status >= 300) {
    const detail = typeof res.data === 'string' ? res.data.slice(0, 200) : JSON.stringify(res.data).slice(0, 200)
    throw new Error('上传失败：HTTP ' + res.status + ' ' + detail)
  }
  const url = (res.data as { url?: unknown }).url
  if (typeof url !== 'string' || !url) throw new Error('中转服务未返回 url')
  return { url }
}
```

### 示例二：对象存储预签名 PUT

```ts
export default async function (ctx: FileRelayContext): Promise<FileRelayResult> {
  // 1) 向自己的签名服务换取上传地址
  const sign = await ctx.request({
    url: ctx.providerConfig.baseUrl + '/sign',
    method: 'post',
    data: { name: ctx.file.name, size: ctx.file.size, contentType: ctx.file.mimeType },
  })
  const { uploadUrl, publicUrl } = sign.data as { uploadUrl: string; publicUrl: string }
  // 2) 直传对象存储（原始二进制 body）
  const res = await ctx.request({
    url: uploadUrl,
    method: 'put',
    header: { 'Content-Type': ctx.file.mimeType },
    data: await ctx.file.read(),
  })
  if (res.status < 200 || res.status >= 300) throw new Error('上传失败：HTTP ' + res.status)
  return { url: publicUrl }
}
```

## 内置服务商类型：咸鱼云网盘（`xianyu-disk`）

除「自定义脚本」外，文件中转分类内置了 **咸鱼云网盘** 类型：使用网盘「快速分享」接口完成上传，**只需填写网盘地址**，无需编写脚本。

- **前置**：先在咸鱼云网盘开启「**快速分享**」功能（配置页有提示）；否则上传接口不可用。
- **配置字段**：只有「网盘地址 `baseUrl`」（必填，http(s) 地址）。
- **上传流程**（内置脚本，与网盘 Web 端一致）：
  1. `POST {baseUrl}/api/quickShare/upload?code=<随机码>&message=`（multipart，字段名 `file`）→ 文件码；
  2. `GET {baseUrl}/api/quickShare/getByCode?code=<文件码>` → 文件信息（含 id）；
  3. 返回 `{baseUrl}/api/quickShare/getShareFile?id=<id>` 作为公网 URL。
- **注意**：该类型用**同一个地址**完成上传与对外访问，因此网盘地址应使用**公网标准端口 80/443**（视频输入要求，否则智谱等模型报 1210），且该地址的 nginx 上传体积上限要足够大（如 `client_max_body_size 200m;`，默认 1MB 会 413）。
- **需要「上传地址 / 公网地址分离」时**（如上传走 `:344`、公网走 443 反代），请使用「自定义脚本」类型并配置 `publicBaseUrl`。
- 连接测试：真实上传一个 1KB 测试文件并校验返回 URL（含非标准端口提示）。

## 连接测试

「测试连接」会用**内置约 1KB 的测试文件**真实执行一次脚本（因此会产生一次真实上传），并校验返回值是否为 `http(s)` URL；若返回 URL 使用了非标准端口（非 80/443），测试结果会附带提示。测试结果只代表脚本可用，**不代表目标模型可访问该 URL**（例如内网地址、非标准端口、防盗链、带时效签名的 URL 都可能被模型侧拒绝）。

## 公网 URL 可达性要求（重要）

模型服务（如智谱 BigModel）会由**服务端**去抓取该 URL，因此必须满足：

- 公网可访问、无需登录/鉴权、无防盗链；
- **建议使用标准端口 80/443**：实测智谱 GLM-5.3-Flash 的**视频输入**抓取器会拒绝非标准端口（如 `:344`），返回业务错误 `[1210] 视频输入格式/解析错误`；同一 URL 作为**图片输入**则正常（图片与视频的抓取/解析链路不同）；
- 视频文件需为模型支持的格式（mp4/mkv/mov，≤200MB），且 URL 在生成期间保持有效。

排查口诀：**「测试连接成功、但 LLM 报 1210 视频输入格式/解析错误」→ 先检查中转 URL 的端口/域名/防盗链/有效期**，而不是文件格式。

### 上传地址与公网地址分离（推荐用于自建服务）

如果中转服务「上传接口只在内网/非标准端口可用，公网只有 443 反向代理」，可这样配置：

- **API 地址**填实际可上传的地址（如 `https://upload.internal:344`）；
- **公网访问地址**填模型可抓取的标准端口地址（如 `https://cdn.example.com`）；
- 脚本里上传请求用 `ctx.providerConfig.baseUrl`，返回 URL 用 `ctx.providerConfig.publicBaseUrl || ctx.providerConfig.baseUrl`。

这样既不受公网 443 反代的请求体大小限制（如 nginx 默认 `client_max_body_size 1m` 会导致大视频 413），返回给模型的又是标准端口 URL。

## 使用方式（AI 文本节点的视频输入）

1. 在「文件中转」页签新增「自定义脚本」实例并保存脚本；
2. AI 文本生成节点连接视频来源（加载视频 / 生成视频 / 裁剪视频等）；
3. 生成时后台自动：读取视频 → 调文件中转脚本上传 → 得到公网 URL → 以 `video_url` 内容块随 LLM 请求发送。

未配置文件中转时，含视频的生成请求会在创建会话前直接 400 失败，节点红字显示：

> 未配置文件中转服务商：请先在 系统设置 → 服务商配置 → 文件中转 配置上传脚本

中转脚本执行失败时任务按 failed 收敛，错误文案为「文件中转失败：<原因>」。

## 限制与约定

- **不做 URL 缓存**：每次生成前重新上传（中转 URL 可能带有效期）；同一任务内同一文件只上传一次。
- 视频大小受目标协议限制（如智谱 `video_url` ≤200MB，mp4/mkv/mov）；大文件会读入内存，建议中转前自行压缩。
- **中转服务自身的上传体积限制**需要调大（如 nginx `client_max_body_size 200m;`；默认常见 1MB 会导致大视频上传返回 413）；「测试连接」只用 1KB 测试文件，覆盖不到该限制。
- 脚本日志只记录文件名、大小与 URL host；**不要**在脚本中打印 API Key、文件 Base64 或完整 URL。
- 中转失败按任务失败处理（错误透传到 AI 文本节点红字与任务管理器），不会静默降级为「忽略视频」。
- 该服务商不注册工作流；不要把它当作媒体生成服务商使用。
