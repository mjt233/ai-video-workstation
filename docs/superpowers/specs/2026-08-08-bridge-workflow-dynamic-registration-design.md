# Bridge 工作流动态注册设计（2026-08-08）

## 1. 背景与目标

目前 ComfyUI Easy Bridge 的 5 个工作流实现是硬编码注册的（workflow id、提交字段、参数声明都写死在 TS 文件里）：

- `text-to-image/default.ts` → `text_to_image`
- `image-edit/default.ts` → `qwen-edit-2509`
- `tts-voice-design/default.ts` → `tts_voice_design`
- `image-to-video/default.ts` → `I2V` / `FL2V` / `FML2V` / `ltx-2.3-director`
- `image-to-video/minimax-h3-r2v.ts` → `minimax-h3-r2v` / `minimax-h3-fl2v`

Bridge 端工作流新增/修改后，本系统必须改代码才能同步。目标：

1. **完全替换**为动态注册：从 Bridge 服务拉取工作流列表，按标签筛选并注册为系统可调用工作流；删除上述 5 个硬编码文件（火山方舟 seedream 实现保持硬编码，非 Bridge）。
2. **提交逻辑同样动态化**：消灭所有「硬编码 Bridge workflow id」的提交函数，改为以 workflowId 为入参的 payload 构建器（纯函数）。
3. **`bridge-client` 专属 Bridge**：重构后只被动态同步模块使用，不被其他 provider 的工作流实现调用（已核实 seedream 不引用，无需解耦）。
4. **配置驱动**：ComfyUI Easy Bridge provider 配置新增「工作流自动注册标签 id」字段，Bridge 工作流带该标签时自动注册；`expose_field` 元数据决定暴露哪些用户可配置参数字段。

字段参数约定见 [bridge-workflow-fields.md](../bridge-workflow-fields.md)。

## 2. 现有架构

- `discoverWorkflows()`（workflow-engine.ts）启动时扫描 `server/src/workflows/*/` 目录，动态 import 各文件，文件内调用 `register()`。
- `register`/`getImpl`/`getImplementations`/`getAllWorkflows`（registry.ts）按类型分组存 `WorkflowDefinition`。
- 引擎 `runTask`：`getImpl(workflow_id, impl)` → `wf.provider ?? 'comfyui-bridge'` → `getProvider` → `createClient(getProviderConfig(id))` → `wf.submit(ctx)`。
- Provider 配置：`configSchema`（comfyui-bridge/index.ts 现含 baseUrl/password），经 config-store 持久化。
- `discovery.ts` 批量发现多处硬编码 `impl: 'default'`。
- 前端 `VideoGenerateEditor` 按「模型实现」自动选帧工作流（隐式 I2V/FL2V/FML2V 选择）。

## 3. Bridge 相关 API（已核实）

- `GET /api/workflows?tags=X`（列表，需 token）：元素含 `id/name/description/declaredParams(JSON字符串)/tags(嵌套分组)`。
- `GET /api/workflows/:id`（详情，需 token）：`declaredParams` 为**解析数组** `{alias,label,paramType(text|number|boolean|image|video|audio),defaultValue}`；另含 `params`、`tags`。
- `POST /api/workflows/:id/execute`（公开）：方式 A 纯 JSON；方式 B multipart（`params` JSON 字符串 + 文件 key 按 alias）。
- 预设标签：`text-to-image`、`image-edit`、`text-to-video`、`image-to-video`（子：`reference`/`first-frame`/`first-last-frame`/`director`/`audio-input`/`audio-output`）、`tts-voice-design`。
- 子标签元数据：`reference` 含 `maxImageCount/maxAudioCount/maxVideoCount/maxTotalCount`；自动注册标签含 `expose_field`（逗号分隔的用户可配置参数字段别名）。

## 4. 设计

### 4.1 模块：`server/src/workflows/bridge-sync.ts`（新增）

```
syncBridgeWorkflows()
├─ 读 comfyui-bridge provider 配置（baseUrl/password/autoRegisterTag）
├─ createComfyuiBridgeClient(config) 建客户端
├─ autoRegisterTag 非空 → listWorkflows(autoRegisterTag)  # 按标签筛选
├─ autoRegisterTag 为空 → listWorkflows()                 # 拉取全部工作流
├─ 逐个 getWorkflowDetail(id)              # GET /api/workflows/:id
├─ deriveType() / deriveCapabilities() / deriveParams()
├─ 未知类型 → console.warn + 跳过
├─ 构建 WorkflowDefinition（impl=`ceb-{id}`，submit=闭包）
└─ unregister 陈旧 ceb-* → register 新列表
```

**client 扩展**（comfyui-bridge/client.ts）：新增 `listWorkflows(tag?)`、`getWorkflowDetail(id)`，复用内部 token 缓存与登录逻辑；不污染通用 `ProviderClient` 接口。

**registry 扩展**：新增 `unregister(type, impl)`。

**同步失败策略**：Bridge 不可达 / 鉴权失败 → error 日志，**保留当前已注册工作流**（不清空），避免抖动清空能力。bridge-sync 模块维护已注册的 `{type, impl}` 键集合，重同步时按新集合清理陈旧项。

### 4.2 类型 / 能力 / 参数推导（纯函数，可单测）

**类型**（按工作流 tags 父标签，优先级 text-to-image → image-edit → tts-voice-design → image-to-video）：未知（如 text-to-video）→ 跳过 + warn。

**能力**（image-to-video 子标签 → `VideoCapabilities`）：
- `reference` → modes 含 `reference`；metadata（maxImageCount 等）→ `VideoReferenceCapability`
- `director` → modes 含 `director`
- `first-frame` → modes 含 `first-last-frame`，`firstLastFrame.maxFrames=1`
- `first-last-frame` → modes 含 `first-last-frame`，`firstLastFrame.maxFrames=2`
- `audio-input` / `audio-output` → `audio: true`
- `cancelable: true`

**用户参数**（`expose_field` + 详情 `params`，`declaredParams` 兜底）：
- 取自动注册标签元数据 `expose_field`（逗号分隔别名）；为空 → 无额外用户参数。
- 字段信息按别名匹配：**`params` 优先**（工作流本身固定参数字段），同一别名以 `params` 为准；
  仅存在于 `declaredParams`（额外声明的动态构建字段）的别名兜底使用。
- 过滤 `alias ∈ expose_field` 的项，映射 `WorkflowUserParamDeclaration`：
  - `key = alias`，`name = label ?? alias`
  - `text → string`、`number → integer`、`boolean → boolean`
  - `image/video/audio` 类型跳过（文件由 payload 构建器处理，不作为用户参数）。
- **默认值**：`defaultValue` 非 null 时优先使用；为 null 时取 `nodeRawValue`；两者均缺省回退类型缺省值（布尔 `false`，其余空串表示“不传”）。原始值均为字符串，`number → Number()`（非法回退 0）、`boolean → 'true'/'1' 为 true`、`text` 原样。

### 4.3 payload 构建器（`bridge-client.ts` 重构，纯函数）

`workflowId` 作为入参，返回 `{ workflowId, params, files? }`，**不再硬编码任何 workflow id**：

| 构建器 | 字段（遵循 bridge-workflow-fields.md） |
|---|---|
| `buildTextToImagePayload` | promptPath→prompt；params: prompt/width/height/seed?/enhance_prompt? |
| `buildImageEditPayload` | imagePaths→image_{n} 文件；params: prompt/seed?；尺寸按 enable_specified_size 门控 |
| `buildTtsPayload` | params: prompt/text/seed? |
| `buildFirstLastFramePayload` | frames→image_{0..n-1} + audio?；params: prompt/width/height/duration/fps/seed?/auto_generate_audio；**3 帧时 params.mid_frame_cursor=0.5** |
| `buildDirectorPayload` | frame_define(JSON) + image_{frameSeq} + audio?；params: prompt/width/height/duration/fps/seed?/auto_generate_audio |
| `buildReferencePayload` | image_{n}/video_{n}/audio_{n}；params: prompt/width/height/duration/seed? |

保留纯辅助 `resolveImageEditSizeParams`。删除现有工厂与提交辅助：`createProviderWorkflow`、`createTextToImageWorkflow`、`createImageEditWorkflow`、`createTtsDesignWorkflow`、`submitTextToImage`、`submitImageEdit`、`submitImageToVideo`、`submitLtxDirectorImageToVideo`、`submitReferenceVideo`、`submitMinimaxH3Fl2v`。

**动态 submit 闭包**（bridge-sync 构建，workflowId 来自注册的工作流）：
- 非视频类型：取对应构建器结果 → `ctx.provider.execute(payload)`。
- image-to-video：按 `ctx.video.mode` 分发给该工作流 capabilities 支持的模式（director → buildDirectorPayload；first-last-frame → buildFirstLastFramePayload；reference → buildReferencePayload）；mode 不在能力内 → 抛错。
- **帧数自动选择被消灭**：`I2V`/`FL2V`/`FML2V` 是独立 Bridge 工作流，动态注册后为独立 impl（`ceb-I2V`/`ceb-FL2V`/`ceb-FML2V`），各自声明 `firstLastFrame.maxFrames`（1/2/3），不再由后端按帧数暗选。

### 4.4 配置与触发

**comfyui-bridge configSchema 新增**：
```
key: autoRegisterTag | label: 工作流自动注册标签id | type: string
defaultValue: '' | description: Bridge 工作流带该标签时自动注册为系统可调用工作流；留空则尝试注册所有获取到的工作流
```

**触发**：
1. 服务启动：`index.ts` 在 `discoverWorkflows()` 之后调用 `syncBridgeWorkflows()`。
2. `PUT /api/providers/:id` 保存 comfyui-bridge 配置成功后自动重同步。

### 4.5 删除的硬编码文件

- `text-to-image/default.ts`、`text-to-image/default.test.ts`
- `image-edit/default.ts`
- `tts-voice-design/default.ts`
- `image-to-video/default.ts`、`image-to-video/default.test.ts`
- `image-to-video/minimax-h3-r2v.ts`、`image-to-video/minimax.test.ts`

（seedream 火山方舟实现保留；`bridge-client.test.ts` 重写为 payload 构建器测试。）

### 4.6 discovery.ts 与批量任务 impl 解析

- `discoverTasks` 去掉硬编码 `impl: 'default'`，任务不设 impl。
- 批量任务创建走现有 `resolveImpl(workflowId, impl)`（`implByAssetType` 覆盖 ?? 该类型第一个实现）兜底，保证动态 impl（无 `default`）可用。

### 4.7 前端改动

- `VideoGenerateEditor.vue`：工作流选择改为**直接选择 image-to-video impl**（每个 impl 自带 capabilities.modes），按所选 impl 能力渲染对应模式表单；提交 `workflowImpl` 即所选 impl。
- `useCanvasGeneration.ts` 视频分支：去掉 `impl ?? 'default'` 归一化，使用所选 impl（非法时由 resolveImpl 兜底或前端回退第一个实现）。
- 其余生成入口（GenerateDialog/BatchGenerateDialog）默认取 `implementations[0]` 的行为不变。

### 4.8 错误处理

- Bridge 拉取失败：error 日志，保留现有注册。
- 单个工作流详情失败：warn + 跳过该工作流。
- 未知类型：warn + 跳过。
- mode 不在能力内（视频）：submit 抛错，任务 failed。

## 5. 测试策略

- `bridge-sync.test.ts`：mock client，覆盖类型/能力/参数推导、未知类型跳过+warn、空标签注册全部、带标签筛选、陈旧 unregister、同步失败保留现有。
- `bridge-client` payload 构建器单测：各构建器 params/files 符合字段约定（含 mid_frame_cursor、frame_define、尺寸门控、文件 key 0-based）。
- `registry`：unregister 用例。
- config-store：`autoRegisterTag` 字段保存/脱敏/回显往返。
- 前端：VideoGenerateEditor 按 impl 能力渲染（如有既有测试）。

## 6. 验证

- `npm run typecheck`、`npm run lint` 0 错。
- server / frontend 全量测试通过。
- 手动：配置 autoRegisterTag → 重启 → `GET /api/workflows` 出现 `ceb-*` 实现且能力/参数正确；Bridge 不可达时保留既有注册。
