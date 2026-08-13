# TTS 音色克隆（tts-voice-clone）与画布 TTS 节点设计（2026-08-13）

## 1. 背景与目标

系统已有 TTS 音色设计（`tts-voice-design`，参数 `prompt` 声线描述 + `text` 朗读文本），由 ComfyUI Easy Bridge 动态注册。现需新增**音色克隆**能力：

1. 新增工作流类型 `tts-voice-clone`，参数：
   - `text` —— 待生成音频的文字
   - `ref_audio` —— 参考音频文件
   - `ref_text` —— 参考音频文件的语音内容文字
2. ComfyUI Easy Bridge 自动注册：标签判断新增 `tts-voice-clone`，Bridge 工作流打了该标签即自动注册。
3. 资产画布新增节点 `TTS声音生成`：配置组件可选择「音色克隆」或「音色设计」，接收音频输入、输出音频；输入的音频作为音色克隆的参考音色。

**范围外（本次不做）**：
- 不把 `tts-voice-clone` 接入角色声音 / 分镜台词 / 批量生成（BatchGenerateDialog）——它们继续走 `tts-voice-design`。
- 不做 `ref_text` 自动转写（无 STT）。

## 2. 现有架构（已核实）

- `server/src/workflows/types.ts`：`WorkflowTypeId = 'text-to-image' | 'image-edit' | 'tts-voice-design' | 'image-to-video'`。
- `server/src/workflows/vars.ts`：`TtsVoiceDesignVars { prompt, text }`；`types.ts` re-export 各 vars。
- `server/src/workflows/bridge-derive.ts`：
  - `BridgeDerivedType`（可映射类型子集）；
  - `TYPE_TAGS: { tag, type }[]` 按优先级映射 Bridge 标签 → 系统类型；
  - `deriveWorkflowType(tags)` 遍历 TYPE_TAGS 匹配；
  - `deriveCapabilities`（非 image-to-video 恒 `{ cancelable: true }`）；
  - `deriveParams`（expose_field 驱动用户参数声明）。
- `server/src/workflows/bridge-sync.ts`：
  - `doSync()` 读 provider 配置 `autoRegisterTag` → `listWorkflows(tag)` → 逐个 `getWorkflowDetail` → `buildAndRegister`（impl = `ceb-{id}`，替换语义 unregister+register）→ `cleanupStale`。
  - `buildSubmit` switch：text-to-image / image-edit / tts-voice-design / image-to-video。
  - `ttsSubmit`：读 `vars.prompt` + `vars.text`，非空校验，`buildTtsPayload`。
  - `passthroughParams(ctx, TTS_STRUCTURAL_KEYS)`（TTS 结构性键 = `{seed}`）。
- `server/src/workflows/bridge-client.ts`：
  - `BridgeExecutePayload { workflowId, params, files? }`；
  - `buildTtsPayload`：params `{ prompt, text, seed? }`，无文件。
- 前端 `frontend/src/canvas/registry.ts`：`NODE_PROTOTYPES`（image-loader / audio-loader / video-loader / image-generate / text / video-generate / video-frame-extract / video-concat）。
- `frontend/src/canvas/useCanvasGeneration.ts`：`generate()` 按 prototypeId 分支（video-generate 走自包含参数；其余图片节点走 prompt/inputPaths），`computeOutputPath` 按原型替换扩展名（video → `.mp4`、frame-extract → `.png`），`poll` 轮询回写 `current/history`。
- `frontend/src/canvas/generate.ts`：`collectInputPaths` 通用收集连线来源资产路径（audio 类型来源节点同样适用）。
- `frontend/src/canvas/connection.ts`：`canConnect` 同类型即通（`audio → audio` 已支持）。
- 文件 key 约定（`docs/bridge-workflow-fields.md`）：单音频用 `audio`；本设计确认参考音频文件 key 为 `audio_0`（用户确认）。

## 3. 方案选择

**方案 A（采纳）：独立工作流类型 + 画布节点双模式。**
- 服务端新增独立类型 `tts-voice-clone`，与 `tts-voice-design` 平级；自动注册按 tag→type 推导天然支持。
- 画布新增单个 `TTS声音生成` 节点，编辑器内做「音色克隆 / 音色设计」模式切换，按模式决定工作流类型。

弃选方案：
- **方案 B**：克隆并入 `tts-voice-design` 类型。与「新增工作流类型」需求冲突；破坏 tag→type 逐类型映射；两套参数差异大。
- **方案 C**：仅服务端注册不做画布节点。不完整。

## 4. 服务端设计

### 4.1 `server/src/workflows/types.ts`

`WorkflowTypeId` 增加 `'tts-voice-clone'`；re-export 区补充 `TtsVoiceCloneVars`。

### 4.2 `server/src/workflows/vars.ts` — 新增 `TtsVoiceCloneVars`

```ts
export interface TtsVoiceCloneVars extends WorkflowVarsBase {
  /** 待合成的朗读文本 */
  text: string;
  /** 参考音频的语音内容文字 */
  refText: string;
  /** 参考音频文件相对路径（JSON 字符串数组，与 imagePaths 同约定） */
  refAudioPath: string;
}
```

### 4.3 `server/src/workflows/bridge-derive.ts` — 标签自动注册

- `BridgeDerivedType` 增加 `'tts-voice-clone'`。
- `TYPE_TAGS` 增加 `{ tag: 'tts-voice-clone', type: 'tts-voice-clone' }`（与 tts-voice-design 平级）。`deriveWorkflowType` 即自动把打了该标签的 Bridge 工作流映射为 `tts-voice-clone` 类型 → `buildAndRegister` 注册 `ceb-{id}` 实现。这就是「标签判断存在则自动注册」。
- `deriveCapabilities` 无需改动（非 image-to-video 恒 `{ cancelable: true }`）。

### 4.4 `server/src/workflows/bridge-client.ts` — 新增 `buildTtsClonePayload`

```ts
export function buildTtsClonePayload(args: {
  workflowId: string;
  text: string;
  refText: string;
  refAudio: File;
  seed?: string;
  extraParams?: Record<string, unknown>;
}): BridgeExecutePayload {
  const params: Record<string, unknown> = { ...(args.extraParams ?? {}), text: args.text, ref_text: args.refText };
  if (args.seed != null) params.seed = args.seed;
  return { workflowId: args.workflowId, params, files: { audio_0: args.refAudio } };
}
```

params 传 `text` + `ref_text`；参考音频以 multipart 文件 key `audio_0` 上传（用户确认）。

### 4.5 `server/src/workflows/bridge-sync.ts` — 新增 `ttsCloneSubmit`

仿 `imageEditSubmit` 结构：
1. 校验 `vars.text`、`vars.refText` 非空。
2. 解析 `vars.refAudioPath`（JSON 数组，`imagePaths` 同款解析），要求恰好 1 个音频路径。
3. `ctx.readAssertFile` 读取为 File → `buildTtsClonePayload`。
4. 透传参数走 `passthroughParams(ctx, TTS_STRUCTURAL_KEYS)`（含 `seed`）。
5. `buildSubmit` switch 增加 `case 'tts-voice-clone': return ttsCloneSubmit(workflowId)`。

### 4.6 `docs/bridge-workflow-fields.md` — 补充章节

| 项 | 字段 |
|---|---|
| params | `text`（朗读文本）、`ref_text`（参考音频文字内容）、`seed?` |
| 文件 | `audio_0`（参考音频） |

## 5. 前端画布设计

### 5.1 `frontend/src/canvas/registry.ts` — 新增原型 `tts-generate`

| 项 | 值 |
|---|---|
| id | `tts-generate` |
| name | `TTS声音生成` |
| icon | `mdi-voice` |
| 输入端口 | `in: audio`（音频，可选） |
| 输出端口 | `out: audio`（音频） |
| resizeable | `true` |
| bodyComponent | `nodes/TtsGenerateNode.vue` |
| editorComponent | `editors/TtsGenerateEditor.vue` |
| getOutputAssetPath | `generateOutput`（读 `config.current.path`） |

`defaultConfig`：

```ts
{
  mode: 'design',          // 'clone' | 'design'，编辑器切换
  workflowImpl: undefined, // 所选实现（自动注册的 ceb-*）
  workflowParams: {},      // 用户参数
  text: '',                // 朗读文本（两种模式都要）
  refText: '',             // 参考音频文字内容（仅 clone）
  prompt: '',              // 声线描述（仅 design）
  current: {}, history: [],
}
```

### 5.2 编辑器 `editors/TtsGenerateEditor.vue`

- 模式切换：`v-radio-group`（音色克隆 / 音色设计）。
- 工作流实现下拉：列出当前模式下工作流类型（`tts-voice-clone` / `tts-voice-design`）的全部已注册实现（复用 `getWorkflows`），写入 `workflowImpl`。
- 克隆模式：`text`（朗读文本）、`refText`（参考音频文字内容）两个文本框。
- 设计模式：`prompt`（声线描述）、`text`（朗读文本）两个文本框。
- 克隆模式校验提示：未连接音频输入时禁用「生成」并提示「需先连接音频输入作为参考音色」。
- 每次生成按 `config.mode` 决定 `workflowId`（clone → `tts-voice-clone`，design → `tts-voice-design`）。

### 5.3 `frontend/src/canvas/useCanvasGeneration.ts`

`generate()` 增加 `tts-generate` 分支（video-generate 分支之后）：

```ts
if (node.prototypeId === 'tts-generate') {
  const mode = node.config.mode
  const text = String(node.config.text ?? '')
  const inputPaths = inputPathsRef.value[nodeId] ?? []
  if (mode === 'clone' && inputPaths.length < 1) {
    statusByNode.value[nodeId] = { status: 'error', errorMsg: '音色克隆需先连接音频输入作为参考音色' }
    return
  }
  const workflowId = mode === 'clone' ? 'tts-voice-clone' : 'tts-voice-design'
  const vars = mode === 'clone'
    ? { text, refText: String(node.config.refText ?? ''), refAudioPath: JSON.stringify(inputPaths) }
    : { text, prompt: String(node.config.prompt ?? '') }
  // runWorkflow({ project, workflowId, impl, params: { vars, outputPath, userParams } }) + poll（与图片节点同款）
}
```

`computeOutputPath` 增加 `tts-generate` → 扩展名替换为 `.flac`（与现有 `voice.flac` / `voice-variants/{id}.flac` 资产一致）。

### 5.4 节点卡片 `nodes/TtsGenerateNode.vue`

仿 `ImageGenerateNode` / `VideoGenerateNode`：当前产物音频播放器（`<audio controls>`）+ 模式标签 + 无产物空状态；运行中状态遮罩。

### 5.5 连线与输入

- `audio → audio` 同类型连线由现有 `connection.ts` 支持，无需改动。
- `collectInputPaths` 直接收集音频输入路径，无需改动。

### 5.6 测试

- `frontend/src/canvas/registry.test.ts`：新增 `tts-generate` 原型断言（端口、defaultConfig、`getOutputAssetPath`）。
- 画布生成相关测试：克隆/设计两种模式的 vars 组装与产物扩展名（.flac）。

## 6. 服务端测试

- `server/src/workflows/bridge-derive.test.ts`：`deriveWorkflowType` 对 `tts-voice-clone` 标签映射。
- `server/src/workflows/bridge-sync.test.ts`：`buildSubmit('tts-voice-clone')` 的 submit 校验（缺 text/refText/refAudioPath 报错；单音频路径读 assert 上传 audio_0）。
- `server/src/workflows/bridge-client.test.ts`：`buildTtsClonePayload` 的 params 与 files 结构。
- `server/src/workflows/types.ts` / `vars.ts`：类型导出。

## 7. 验证与约束

- 修改后必须执行 `npm run typecheck`、`npm run lint`（AGENTS.md 约束），0 错误。
- 服务端单测 `npm test --workspace server`（或对应测试命令）；前端 `vitest`。
- 浏览器全流程实测：Bridge 打 `tts-voice-clone` 标签 → 自动注册 → 画布新增节点 → 克隆模式连音频 → 生成 .flac 回写 current/history。
