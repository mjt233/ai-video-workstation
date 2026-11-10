# AI 文本生成节点支持音频/视频输入（实施计划）

> 状态：已确认，已实施（2026-11-10）。本文是本次改动的设计事实源与实施记录，供后续维护与评审共用。
> 关联文档：[canvas/node-types.md](../canvas/node-types.md)、[canvas/llm-session.md](../canvas/llm-session.md)、[plans/custom-provider.md](./custom-provider.md)。

## 1. 需求与已确认范围

让资产画布的「AI文本生成」节点（原型 `text-ai`）在连接音频/视频后，能把它们真正作为多模态输入发给 LLM。

用户已确认的范围（不要再扩大或缩小）：

| 维度 | 结论 |
|------|------|
| 音频 | **仅原生音频模型**：按协议原生格式发送（OpenAI 兼容 `input_audio`、Gemini `inlineData`）；模型/协议不支持时告警忽略；**不做 ASR、不做 ffmpeg 转码** |
| 视频 | **仅原生 `video_url`**：本地文件先经新增「文件中转」服务商上传获得公网 URL，再随 LLM 请求发送；**不做抽帧降级** |
| 交互 | **最小交互**：不改节点生成流程（仍需输入文本、不展示上传/处理进度），只打通发送链路；告警沿用节点现有 warnings 展示 |

## 2. 现状与关键结论

1. 节点侧已具备媒体输入能力（连线/预览/排序/断开/提交 `media` 列表），**不改节点 UI**：
   - `frontend/src/components/canvas/nodes/AiTextGenerateNode.vue`
   - `frontend/src/components/canvas/composables/useCanvasNodeOps.ts`（`llmMediaInputsOf`）
2. 真正堵点在服务端：`server/src/llm/client.ts` 的 `supportsInput()` 对 `openai-chat` 只放行图片，音频/视频在 `server/src/routes/llm.ts` 的 `resolveMediaInputs()` 被过滤并告警。
3. 传输层：Vercel AI SDK v7 的 OpenAI 兼容 provider 只支持图片与 **wav/mp3 音频**（映射 `input_audio`）；**视频 file part 会抛 `UnsupportedFunctionalityError`**，视频必须用原生 `video_url` 内容块（需单独构造请求）。
4. 智谱 BigModel 官方约束（外部参考，2026-11 核对）：
   - [GLM-5.3-Flash 模型页](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)：输入 text / image / video / file，**不含 audio**；图片 ≤5MB/张、≤6000×6000、≤50 张；视频 `video_url` **只接受公网 URL**（mp4/mkv/mov，≤200MB）。
   - [对话补全 API](https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8)：`image_url` 支持 URL 或 Base64 Data URL；`video_url` 为 URL；音频模型（`glm-4-voice`）的 `input_audio` 为 base64 + wav/mp3，≤10 分钟。
   - [GLM-ASR-2512](https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-asr-2512)：语音转文本（本次**不使用**，范围明确不做 ASR）。
5. 音频使用前提：在服务商模型列表中新增原生音频模型（如 `glm-4-voice`）并勾选 audio 模态；GLM-5.3-Flash 元信息中的 audio 是 OpenRouter 元数据带来的，需校正（否则会被误判为支持）。

## 3. 总体架构

```
画布节点（不改）── POST /api/llm/chat { media:[{path,type}] }
        │
        ▼
服务端媒体解析（协议规则 × 模型 inputModalities）
   ├─ 图片 → 内联 base64（各协议规则）
   ├─ 音频 → 原生内联（openai-chat: input_audio wav/mp3；gemini: inlineData）
   └─ 视频 → 需要公网 URL → 文件中转服务商（自定义 TS 脚本）→ 得到 URL → video_url
        │
        ▼
流式传输
   ├─ 不含视频：保持 Vercel AI SDK（现状，回归面最小）
   └─ 含视频（openai-chat）：新增原生 SSE 客户端，构造 video_url/image_url/input_audio 内容块
```

## 4. 详细设计

### 4.1 文件中转（新服务商分类，`file-relay`）

- 系统设置 → 服务商配置 新增页签 **「文件中转」**（分类 id `file-relay`，图标 `mdi-cloud-upload-outline`）。
- 提供商类型固定一个：**「自定义脚本」**（类型 id `file-relay-script`）。
- 配置字段（`configSchema`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean（默认 true） | 多个实例时取第一个启用实例 |
| `baseUrl` | string（可选） | 脚本中 `ctx.providerConfig.baseUrl` 读取 |
| `apiKey` | password（可选、secret） | 脚本中 `ctx.providerConfig.apiKey` 读取 |
| `timeout` | number（秒，默认 120） | 单次中转总超时 |
| `script` | component `FileRelayCodeEditorField` | TypeScript 脚本（见下） |

- **脚本契约**（后台注入，Monaco 提供类型提示）：

```ts
interface FileRelayContext {
  providerConfig: Record<string, unknown>
  file: {
    path: string
    name: string
    mimeType: string
    size: number
    read(): Promise<Uint8Array>
    base64(): Promise<string>
    toFile(): Promise<File>
  }
  /** axios 风格请求：JSON / FormData / 原始二进制；带超时与任务中止 */
  request(conf: {
    url: string
    method?: string
    header?: Record<string, string>
    data?: unknown
    params?: Record<string, unknown>
    timeout?: number
  }): Promise<{ data: unknown; status: number; headers: Record<string, string> }>
  signal?: AbortSignal
}

interface FileRelayResult {
  /** 必须是 http(s) 公网地址 */
  url: string
}
```

示例（multipart 上传到自建中转服务）：

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
  return { url: res.data.url }
}
```

- **运行时复用**：`server/src/providers/custom/runtime.ts` 的 `transpileCustomCode` / `compileCustomCodeModule`（node:vm 沙箱、白名单全局、FormData/File）与 `performCustomRequest`（超时 + 中止）。新增 `providers/file-relay/runtime.ts` 只做 relay 专用 ctx 组装与结果校验。
- **中转服务** `relayProjectFile(project, relPath, { signal })`（`providers/file-relay/service.ts`）：
  - 路径限定项目目录内（`resolveProjectPath`，防路径穿越）；MIME 按扩展名推断（可复用 `server/src/llm/runtime.ts` 的 `detectMimeType`，只读引用）；
  - 取第一个 `enabled !== false` 的 file-relay 实例；未配置 → 抛明确中文错误；
  - 执行脚本，校验返回 URL 为 `http(s)://`；失败透传脚本错误；
  - **不做 URL 缓存**（可能过期），每次生成前重新上传；
  - 日志只记文件名、大小、URL host（不输出 API Key/Base64/完整 URL）。
- **保存校验与同步**：
  - `validateFileRelayConfig(config)`：保存前编译脚本（语法 + `export default` 函数）；
  - `server/src/routes/workflow.ts` 的 `POST/PUT /api/providers/instances` 对 file-relay 类型执行校验（400 返回错误）；
  - `server/src/providers/instance-sync.ts` 对 file-relay 实例**跳过工作流同步**。
- **连接测试**：用内置约 1KB 测试文件真实执行脚本并校验返回 URL；前端对话框提示「测试连接会真实上传一个测试文件」。
- **前端**：
  - `ProviderSettingsPanel.vue` 增加第三个页签；
  - `ProviderInstanceDialog.vue` 分类适配（file-relay 不显示「工作流预览」；显示测试上传提示）；
  - 新增 `provider-fields/FileRelayCodeEditorField.vue` + `utils/file-relay-provider.ts`（Monaco 类型库 + 模板）；
  - `api/providers.ts` 的 `category` 联合类型扩展为 `'media' | 'llm' | 'file-relay'`。

### 4.2 LLM 媒体能力矩阵（`server/src/llm/`）

| 协议 | 图片 | 音频 | 视频 |
|------|------|------|------|
| `openai-chat` | 内联 data URL（jpg/jpeg/png/webp，≤5MB） | 内联 `input_audio`（wav/mp3，≤20MB） | **公网 URL**（mp4/mkv/mov，≤200MB，最多 1 个） |
| `gemini` | inlineData（现有） | inlineData（≤20MB） | inlineData（≤20MB） |
| `openai-responses` / `anthropic` / `grok` | 图片内联（现有） | 不支持 | 不支持 |

- 新增 `getProtocolMediaRule(protocol, type)`，替换 `supportsInput()` 粗粒度白名单；
- **模型元信息 `inputModalities` 作为主闸门**：声明了该模态才发送；未声明 → 告警忽略（沿用现有 warnings 展示）；
- 能力 = 协议规则 ∩ 模型元信息；MIME/大小不符 → 告警忽略（与现状一致）。

### 4.3 音频原生发送

- `openai-chat`：AI SDK 已原生支持 wav/mp3 → `input_audio`，能力矩阵放开即可；
- 仅 wav/mp3（官方限制）；flac/m4a/ogg 等**不转码**，告警忽略并提示格式要求；
- `gemini`：inlineData 原样发送（现有）。

### 4.4 视频公网 URL + 自定义 SSE 传输

- 新增 `server/src/llm/openai-chat-stream.ts`（fetch + SSE 解析），**仅在请求含视频时启用**；其余场景保持 AI SDK：
  - 请求体：`{ model, stream: true, messages: [{ role:'user', content: [video_url…, image_url…, input_audio…, text] }], reasoning_effort? }`；
  - 事件：`delta.reasoning_content` → thinking、`delta.content` → text、`[DONE]` → done；空 `choices`/空块容错；
  - HTTP 非 2xx → 解析 `{error:{code,message}}` 抛错；Abort → AbortError（路由映射 cancelled）；
  - 单测覆盖 SSE 分片、空块、错误与中止。
- `LlmMediaInput` 改为携带传输方式：
  ```ts
  { type, mimeType, filename, source: { kind: 'inline', base64 } | { kind: 'url', url } }
  ```
- 取消/中断：中转脚本请求与 LLM 请求都挂在会话 `abortController` 上；取消优先于失败。

### 4.5 后端路由改造（`server/src/routes/llm.ts` 两阶段）

- **阶段 1（响应前）**：解析媒体能力、校验大小/格式、生成 warnings；若存在「需要公网 URL」的媒体但**未配置文件中转实例** → 直接 400 返回明确错误（不创建会话）；
- **阶段 2（后台 `runLlmTask`）**：URL 传输项调用 `relayProjectFile()`（同一文件在一次请求内去重），内联项读取 base64；随后建流；中转失败 → 会话 failed，错误透传到节点红字；
- 内联大小上限保留 20MB 安全阀，并按协议追加更严格上限（图片 5MB、视频走中转不读入内存）。

### 4.6 前端（最小交互）

- 节点、输入预览、生成入口均**不改**；仍需输入文本；
- 顺手修正现有小不一致：`canGenerate` 允许「只有媒体无文本」时按钮可点，但 `onGenerate` 会报「请输入内容」——改为按钮置灰（与最小交互一致，改 `AiTextGenerateNode.vue` 的 `canGenerate`）；
- 告警展示沿用节点 AI 响应标题栏的 warnings。

### 4.7 错误与提示

| 场景 | 表现 |
|------|------|
| 有视频输入但未配置文件中转 | 请求 400（不创建会话），文案复用 `FILE_RELAY_NOT_CONFIGURED_MESSAGE`：「未配置文件中转服务商：请先在 系统设置 → 服务商配置 → 文件中转 配置上传脚本」；节点红字直接显示该中文 |
| 中转脚本执行失败 | 任务 failed：「文件中转失败：<原因>」（节点红字 + 任务管理器） |
| 模型/协议不支持该模态 | warning，忽略该媒体，其余照常生成 |
| 格式/大小不符 | warning，忽略该媒体 |

### 4.8 安全与边界

- 中转脚本运行在 Node 进程内 `node:vm` 沙箱（与自定义服务商同一约定：**非安全边界**，本地工作站场景），白名单全局、无 `require`；
- 文件路径限定项目目录内、防穿越；日志不输出敏感内容；
- 中转脚本总超时（`timeout`）+ 请求级超时 + 任务中止信号；
- 视频 ≤200MB（协议上限）；大文件会占内存，文档注明。

## 5. 文件清单

**新增**
- `server/src/providers/file-relay/index.ts`（Provider 注册 + 保存校验 + 测试连接）
- `server/src/providers/file-relay/runtime.ts`（ctx 组装、结果校验）
- `server/src/providers/file-relay/service.ts`（`relayProjectFile`）
- `server/src/llm/openai-chat-stream.ts`（含视频的 openai-chat SSE 客户端）
- `server/src/llm/media.ts`（能力矩阵纯函数；也可并入 protocol.ts）
- 对应 `*.test.ts`
- `frontend/src/components/provider-fields/FileRelayCodeEditorField.vue`
- `frontend/src/utils/file-relay-provider.ts`
- `docs/providers/file-relay.md`

**修改**
- `server/src/providers/types.ts`（category 扩展）
- `server/src/providers/instance-sync.ts`（跳过 file-relay）
- `server/src/routes/workflow.ts`（保存校验）
- `server/src/llm/protocol.ts`、`client.ts`、`runtime.ts`、`routes/llm.ts`
- `frontend/src/api/providers.ts`、`ProviderSettingsPanel.vue`、`ProviderInstanceDialog.vue`、`provider-fields/index.ts`、`AiTextGenerateNode.vue`（canGenerate 修正）
- `docs/canvas/node-types.md`、`docs/canvas/llm-session.md`、`docs/README.md`

## 6. 分工与写作用域（团队任务板为准）

| 任务 | 负责人 | 写作用域 |
|------|--------|----------|
| T1 文件中转后端 | relay-backend | `server/src/providers/file-relay/`、`server/src/providers/types.ts`、`server/src/providers/instance-sync.ts`、`server/src/routes/workflow.ts` |
| T2 文件中转前端 | relay-frontend | `frontend/src/api/providers.ts`、`frontend/src/components/provider-settings/`、`frontend/src/components/ProviderInstanceDialog.vue`、`frontend/src/components/provider-fields/`、`frontend/src/utils/file-relay-provider.ts` |
| T3 LLM 媒体能力与传输 | llm-media | `server/src/llm/`、`server/src/routes/llm.ts` |
| T4 浏览器实测文件中转配置 | browser-tester | 不改仓库代码（临时脚本放系统临时目录；临时服务商实例用后删除） |
| T5 全链路 mock 验证（视频/音频） | browser-tester | 同上 |
| T6 文档与索引 | lead | `docs/` |

约定：
- 只改自己写作用域内的文件；跨作用域需求先发消息给 Lead 协调。
- 不执行 `git commit`/`git push`；不删除用户已有数据/画布/服务商实例。
- 每完成一项必须跑：服务端 `cd server && npx tsc --noEmit`；前端 `cd frontend && npx vue-tsc --noEmit --skipLibCheck`；根目录 `npm run lint`（允许 `server/src/assets/refs.ts` 既有 warning）；新增/改动服务端逻辑跑 `cd server && npx vitest run <相关目录>`。
- 所有 UI 文字、注释、文档用中文；新增函数/类型必须写 JsDoc（AGENTS.md 约束）。

## 7. 测试与验收

- **单测**：能力矩阵、媒体两阶段解析、中转 runtime/service（成功/未配置/超时/中止/非法 URL）、SSE 解析（分片/空块/错误/中止）、路由保存校验。
- **浏览器实测（T4）**：系统配置 → 服务商配置 →「文件中转」页签；新增/编辑/测试连接/删除临时实例，页面无报错、刷新后配置持久、敏感字段不回显；用本地 mock 上传服务验证脚本真实执行；测后清理临时实例与 mock 服务。
- **全链路 mock（T5）**：临时 mock 上传服务 + mock OpenAI 兼容 LLM 服务 + 临时项目/画布（AGENTS 约束 4）：连接视频/音频 → 生成；验证请求体含 `video_url`/`input_audio`；未配置中转时任务失败且提示正确；测后删除临时画布/项目。
- **最终门禁（Lead）**：全量 `npm run typecheck`、`npm run lint`、服务端 `npx vitest run`；`git diff` 评审；确认无临时文件/实例残留。

## 8. 风险与取舍

- 视频公网 URL 完全依赖用户自建中转服务：未配置即不可用（明确报错，不静默降级）；
- 音频不做转码：flac 等格式不可用，仅 wav/mp3；
- 自定义 SSE 客户端只覆盖「含视频的 openai-chat 请求」，其余仍走 AI SDK，回归面小；
- 模型元信息可能不准确（OpenRouter 数据），能力以用户配置的 `inputModalities` 为准；文档提示校正 GLM-5.3-Flash 的 audio 标记。
