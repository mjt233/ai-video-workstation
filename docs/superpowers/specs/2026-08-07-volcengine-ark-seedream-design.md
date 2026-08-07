# 新增工作流提供商：火山方舟（Seedream 5.0 pro / lite）— 设计文档

日期：2026-08-07

## 1. 背景与目标

系统已建成 Provider 插件系统（`server/src/providers/`）：Provider 是工作流的「传输层插件」（提交/轮询/取输出/中断 + configSchema 配置表单），工作流通过 `baseDefinition.provider` 声明使用哪个 provider，引擎按请求实时解析配置并创建客户端注入 `ctx.provider`。

当前所有工作流实现均通过 `comfyui-bridge` 执行。本次目标：

1. 新增 **火山方舟（volcengine-ark）Provider 插件**：配置 API Key，走方舟 OpenAI 兼容的图片生成接口。
2. 新增 **4 个 Seedream 工作流实现**：
   - 文生图（`text-to-image`）：Seedream 5.0 pro、Seedream 5.0 lite
   - 图片编辑（`image-edit`）：Seedream 5.0 pro、Seedream 5.0 lite
3. 遵循现有架构（零前端改动）：设置表单由 configSchema 自动渲染；工作流下拉自动列出新实现。

## 2. 决策记录

| 决策点 | 结论 |
|---|---|
| 接入方案 | **方案 A：新增 Provider 插件 + 独立工作流文件**（与 comfyui-bridge 模式对称，隔离清晰，为将来方舟视频扩展铺路） |
| 交互编辑（`<point>`/`<bbox>` 坐标） | **暂不支持**（当前 vars 模型只有「多图 + 描述」，坐标标注需扩展 vars 与前端交互，YAGNI） |
| 默认实现 | **保持 ComfyUI 为默认**（`seedream.ts` 文件名按字母序排在 `default.ts` 之后，注册顺序保证 `implementations[0]` 仍是 comfyui 实现） |
| 验证方式 | **TDD 单元测试（mock fetch）+ 用户填入真实 API Key 自行端到端实测** |
| 请求超时 | **900 秒（15 分钟）**（用户指定），`AbortController` 实现 |
| 输出格式 | `output_format: 'jpeg'`（应用资产路径全部为 `.jpg`，字节与扩展名一致；仅 Seedream 5.0 支持该字段） |
| 水印 | `watermark: false`（方舟默认加水印，必须显式关闭） |
| 返回格式 | `response_format: 'url'`（引擎 download 分支即时下载，URL 24h 有效无风险；避免大图 base64 膨胀） |
| seed | **不传**（方舟文档未声明 seed 参数，引擎注入的 seed 被忽略） |
| 中断（cancel） | **支持（延迟生效）**：声明 `cancelable: true` + 新增 `deferredCancel` 能力；取消请求被接受并写入任务取消标记，因同步 API 无法中止在途请求，**执行完成后**引擎检查标记把任务持久化为失败（`用户中断`），不写产物 |
| 文生组图/多图生组图 | 不在本次范围（`sequential_image_generation` 未使用） |
| 方舟视频生成（Seedance） | 不在本次范围 |
| `output_format` 可配置 | 不在本次范围（固定 jpeg） |

## 3. 火山方舟 API 事实（已核实）

- **端点**：`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`
- **认证**：`Authorization: Bearer {ARK_API_KEY}`
- **同步 API**：一次请求直接返回结果（非任务式）
- **模型 ID**：
  - pro：`doubao-seedream-5-0-pro-260628`
  - lite：`doubao-seedream-5-0-260128`
- **请求体**：
  - `model`（必填）
  - `prompt`（必填）
  - `image`：单图=字符串，多图=数组（2~10 张）；URL 或 base64 data URL
  - `size`：档位（`1K`/`1.5K`/`2K`，lite 为 `2K`/`3K`/`4K`）或显式 `"{width}x{height}"`（pro 总像素 `[921600, 4624220]`，宽高比 `[1/16, 16]`）
  - `response_format`：`url`（默认，24h 过期）| `b64_json`
  - `output_format`：`png` | `jpeg`（仅 Seedream 5.0 支持，默认 jpeg）
  - `watermark`：默认 **true**（需显式 false）
  - `optimize_prompt_options`：`{ mode: 'standard' | 'fast' }`（提示词优化，standard 质量更优耗时更长）
- **响应**：`{ data: [{ url }] }` 或 `{ data: [{ b64_json }] }`；错误 `{ error: { code, message } }`
- **图片输入限制**：≤10 张参考图，单图 ≤30MB，格式 jpeg/png/webp/bmp/tiff/gif/heic/heif

## 4. Provider 插件：`server/src/providers/volcengine-ark/`

### 4.1 配置 Schema（`index.ts`）

| 字段 | 类型 | 必填 | 默认 | 环境变量 | 说明 |
|---|---|---|---|---|---|
| `apiKey` | password | ✅ | — | `ARK_API_KEY` | 火山方舟 API Key（secret 脱敏） |
| `baseUrl` | string | — | `https://ark.cn-beijing.volces.com/api/v3` | `ARK_BASE_URL` | 方舟 API 基础地址（客户端去尾斜杠） |
| `timeout` | number | — | `900` | — | 单次生成请求超时（秒） |

- `id: 'volcengine-ark'`，`name: '火山方舟'`，description 说明支持 Seedream 文生图/图片编辑。
- 模块顶层调用 `registerProvider(definition)`（`discoverProviders` 自动扫描 `providers/*/index.ts`，无需改注册代码）。
- 前端 `ProviderSettingsDialog` 按 configSchema 自动渲染表单，**零前端改动**。

### 4.2 客户端（`client.ts`）：同步 API 适配任务式接口

核心挑战：方舟图片生成是**同步** API，而 `ProviderClient` 是**任务式**接口（execute→poll→getOutput）。适配方案：

- **`execute({ workflowId, params, files })`**：
  - `workflowId` 即模型 ID（如 `doubao-seedream-5-0-pro-260628`）
  - 构造 body：`params` 为 JSON 主体；`files` 逐键转为 base64 data URL 合并进 body（`body[key] = dataUrl`），支持单图；**多图由工作流层在 `params.image` 传入 data URL 数组**（单图字符串、多图数组）
  - `POST {baseUrl}/images/generations`，`Authorization: Bearer {apiKey}`，`AbortController` 超时（默认 900s）
  - **同步等待**响应完成；非 2xx 抛带状态的错误；解析 `{data:[...]}`（空数组抛错），把输出规格缓存进内存 `Map<taskId, WorkflowOutput>`，返回 `{ taskId: 本地UUID }`
- **`poll(taskId)`**：直接返回 `{ status: 'completed', done: true }`（execute 已同步完成）
- **`getOutput(taskId)`**：从缓存返回输出；`response_format:'url'` → `{ type: 'download', url, filename }`；无缓存返回 `null`
- **`cancel(taskId)`**：no-op（幂等；同步请求已结束无法中断）

### 4.3 中断：延迟生效（deferredCancel）

同步 API 无法中止在途 HTTP 请求，中断采用「**接受请求 → 标记 → 执行完成后持久化失败**」机制（复用现有任务取消链路）：

1. **能力声明**：`WorkflowCapabilities` 新增 `deferredCancel?: boolean`（「取消延迟生效：执行是同步的，无法中止在途请求；取消请求被接受，任务在执行完成后标记为失败而非完成」）；Seedream 4 个实现声明 `capabilities: { cancelable: true, deferredCancel: true }`
2. **`canCancelTask` 放宽**：running 且无 `remoteTaskId` 时，若实现声明 `deferredCancel` → 返回 ok（不再 400 `no_remote_task`）；非 deferredCancel 的实现保持原行为不变
3. **取消端点**（running + deferredCancel）：不走 `provider.cancel`（同步请求无意义），改为把 `cancelRequested: true` 写入任务 params，返回 `{ taskId, status: 'cancelling' }`（任务状态仍为 running，不立即标记 failed——避免引擎完成后覆盖）
4. **引擎执行完成回调**：`execute` 返回、写盘前重新读取任务 params，检测到 `cancelRequested === true` → 抛 `用户中断` → 任务持久化为 failed（`用户中断`），**不归档已有资产、不写产物**（相当于「执行完成后触发取消回调并持久化」）
5. **重试清理**：`POST /workflow/retry/:taskId` 复制 params 时剥离 `cancelRequested`，避免重试任务被旧标记立即取消
6. **前端零改动**：`interrupt` 已停轮询 + 本地置「已中断」+ 忽略取消响应内容；`CancelWorkflowResult.status` 注释补充 `cancelling`

行为语义：取消请求被接受，但任务要等远端执行完成（通常 10~60s）后才变为失败，期间前端轮询仍显示 running。

**残余竞态（明示）**：取消恰好在写盘期间到达时任务仍会完成（写盘窗口秒级）；单次写盘前检查无法覆盖该窗口，属可接受限制。

其他限制：生成耗时即一次 HTTP 请求耗时（通常 10~60s），引擎轮询逻辑在同步请求期间不生效，任务完成后约 2s（POLL_INTERVAL）内收尾。

## 5. 共享提交辅助：`server/src/workflows/seedream.ts`

供两个实现文件复用，全部可单测：

- **`resolveSeedreamSize(limits, width?, height?)`** — 纯函数，映射应用宽高 → 方舟 `size`：
  - 宽高有效且在模型允许范围（总像素 + 宽高比）内 → 直接 `"{width}x{height}"`
  - 超出范围 → **自动匹配最接近的允许尺寸**（保持宽高比）：先钳制宽高比到 `[1/16, 16]`，再钳制总像素到允许范围（最接近用户目标），由 `W*H=target`、`W/H=ratio` 反解宽高并取整；取整越界时按比例微调到边界内
  - 无有效配置（缺省/非法）→ 回退模型默认档位 `"2K"`
- **约束按模型区分**（`SEEDREAM_SIZE_LIMITS`）：pro 总像素 `[921600, 4624220]`、档位 `1K/1.5K/2K`；lite 总像素 `[3686400, 16777216]`、档位 `2K/3K/4K`；宽高比均为 `[1/16, 16]`（`SEEDREAM_MODELS` 增加 `kind: 'pro'|'lite'`，实现按 `def.kind` 取约束）
- **`fileToDataUrl(file)`** — File → `data:image/...;base64,...`
- **`submitSeedreamTextToImage(client, { model, prompt, size, optimizeMode })`** — 文生图提交，返回 `client.execute({ workflowId: model, params: body })`
- **`submitSeedreamImageEdit(client, { model, prompt, imageDataUrls, size, optimizeMode })`** — 图片编辑提交（`image` 单图为字符串、多图为数组）

## 6. 工作流实现

### 6.1 文生图：`server/src/workflows/text-to-image/seedream.ts`

注册 2 个实现：

| impl | name | 模型 ID |
|---|---|---|
| `seedream-5-pro` | Seedream 5.0 Pro（火山方舟） | `doubao-seedream-5-0-pro-260628` |
| `seedream-5-lite` | Seedream 5.0 Lite（火山方舟） | `doubao-seedream-5-0-260128` |

- `provider: 'volcengine-ark'`
- `type: 'text-to-image'`
- **submit 逻辑**：
  - 读取 `vars.promptPath` → `ctx.readFile` 取提示词（缺失抛错，风格对齐现有 default）
  - 尺寸：`vars.width/height`（有效数字）优先，否则 `projectConfig.width/height`，再经 `resolveSeedreamSize`
  - 请求体：`{ model, prompt, size, output_format: 'jpeg', watermark: false, response_format: 'url' }` + 可选 `optimize_prompt_options`
- **参数声明**：`enhance_prompt`（boolean，默认 false）→ 映射 `optimize_prompt_options.mode`：true → `standard`（提示词优化，质量更优）；false → 不传该字段（保持原样）

### 6.2 图片编辑：`server/src/workflows/image-edit/seedream.ts`

注册相同的 2 个实现（pro/lite）。

- `provider: 'volcengine-ark'`，`type: 'image-edit'`
- **submit 逻辑**：
  - 解析 `vars.imagePaths`（JSON 数组，风格对齐现有 default：trim/filter/非空校验）
  - 校验：图片数量 ≤ 10（方舟多图上限）、单图 ≤ 30MB（方舟限制），超限抛错
  - 逐张 `ctx.readAssertFile` → `fileToDataUrl` → `image` 数组
  - `vars.desc` → `prompt`（缺失抛错）
  - 尺寸：`userParams` 中 `enable_specified_size === 'true'` 且 width/height 有效 → 显式 WxH；否则 `resolveSeedreamSize` 回退
  - 请求体：`{ model, prompt, image: [...], size, output_format: 'jpeg', watermark: false, response_format: 'url' }`
- **参数声明**：沿用 `enable_specified_size`（boolean，默认 false）/ `width`（integer，默认 ''）/ `height`（integer，默认 ''）；**不声明** `enable_multiple_angles_lora`（qwen-edit 专属）

### 6.3 默认顺序保证

`discoverWorkflows` 按目录遍历文件，注册顺序即 `implementations` 顺序。`default.ts` < `seedream.ts`（字母序），保证 comfyui 实现仍是 `implementations[0]`，前端默认选中不变。

注册时声明 `capabilities: { cancelable: true, deferredCancel: true }`（接受取消请求，执行完成后持久化失败，见 §4.3）。

## 7. 错误处理

- **API 非 2xx**：读取响应体（`{error:{code,message}}` 或纯文本），抛出带状态的错误（如 `火山方舟 API 错误 401: ...`）→ 引擎 catch → 任务 `failed`，错误信息透传前端
- **超时**：`AbortController` 900s → 抛错「火山方舟请求超时」→ 任务 failed
- **输入超限**：图片 >10 张或单图 >30MB，在工作流层抛错（请求发出前）
- **空响应**：`data` 数组为空在 execute 内抛错；`getOutput` 无缓存返回 null（引擎兜底报错）

## 8. 测试策略（TDD）

| 文件 | 覆盖 |
|---|---|
| `server/src/providers/volcengine-ark/client.test.ts` | execute 拼 body 正确（model/prompt/image/size/watermark/output_format）；files→data URL 合并；多图数组；url/b64_json 两种响应解析；非 2xx 抛错；超时；poll 返回 done；getOutput 缓存/缺失返回 null；cancel no-op |
| `server/src/workflows/seedream.test.ts` | `resolveSeedreamSize`（合法直接用/低于下限放大/lite 下限更大/高于上限缩小/宽高比钳制/缺省回退/边界值，按 pro/lite 约束）；`submitSeedreamTextToImage`/`submitSeedreamImageEdit` 提交参数正确 |
| `server/src/workflows/text-to-image/seedream.test.ts` | 文生图实现 submit：读 prompt、尺寸、enhance_prompt→optimize_prompt_options 映射 |
| `server/src/workflows/image-edit/seedream.test.ts` | 图片编辑实现 submit：多图 data URL、desc→prompt、尺寸参数、图片数量/大小超限校验 |
| `server/src/routes/workflow.test.ts` | `canCancelTask`：running 无远端任务 ID + `deferredCancel` → ok（原 `no_remote_task` 路径仅对非 deferredCancel 保留，既有用例不变）；取消路由 deferred 分支：写 `cancelRequested` 标记 + 返回 `cancelling`、不立即标记 failed；retry 剥离 `cancelRequested` |

## 8.1 中断机制验证

- `canCancelTask`：deferredCancel 实现 running 无远端 ID 可取消；非 deferredCancel 仍 400 `no_remote_task`
- 取消路由：deferred 分支写 `cancelRequested`、返回 `cancelling`、不标记 failed；pending/有远端 ID 的既有路径不变
- 引擎：写盘前检查 `cancelRequested` → 任务 failed `用户中断`、不写产物（浏览器实测：发起 Seedream 生成后立即点中断 → 任务稍后变 failed 而非 completed，`assert/` 无新产物）
- retry：取消后重试的新任务不带 `cancelRequested`

## 9. 验证清单

1. `npm run typecheck`（根，全局 0 错）
2. `npm run lint`（0 错，仅 refs.ts 既有 warning）
3. `npm test`（server 全部通过，新增约 20 用例）
4. 浏览器冒烟：设置界面出现「火山方舟」provider（apiKey 脱敏 `__set__` 往返）；工作流下拉列出 4 个新实现；ComfyUI 仍为默认
5. 用户填入真实 API Key 后实测：文生图（角色外观）、图片编辑（分镜场景图/衍生变体）各跑一次 pro 和 lite

## 10. 不在本次范围（YAGNI）

- 交互编辑（`<point>`/`<bbox>` 坐标定位）
- 文生组图/多图生组图（`sequential_image_generation`）
- 方舟视频生成（Seedance）
- `output_format`/`response_format` 可配置
