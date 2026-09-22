# 工作流类型与产物形态

本文说明系统**工作流类型（`WorkflowTypeId`）**的定义、两类产物形态（媒体 / 文本）的落地差异，以及「新增一个工作流类型」时必须同步修改的清单。

- 想**适配某个具体工作流的 AI 接口**（写 `submit`、读 prompt、注入分辨率）→ 见 [workflow-adaptation-guide.md](./workflow-adaptation-guide.md)
- 想**用 Python/TS 脚本接入自定义 HTTP 接口**（自定义服务商）→ 见 [plans/custom-provider.md](./plans/custom-provider.md)
- 想知道**任务怎么跑、日志在哪、中断怎么走** → 见 [task-manager.md](./task-manager.md)
- 想知道**产物落在哪个文件** → 见 [asset-layout.md](./asset-layout.md) 第 6 节

---

## 1. 工作流类型（`WorkflowTypeId`）

类型按 **AI 能力**分类（而非资产类型），系统唯一权威定义在 `server/src/workflows/types.ts` 的 `WorkflowTypeId`：

| 类型 id | 中文标签 | 产物形态 | 说明 |
|---------|----------|----------|------|
| `text-to-image` | 文生图 | 媒体 | 纯提示词出图（角色外观、场景图、道具图） |
| `image-edit` | 图片编辑 | 媒体 | 带输入图出图（分镜场景合成、角色/场景衍生变体、道具图） |
| `tts-voice-design` | TTS音色设计 | 媒体 | 按声线描述设计音色（角色声音、声音变体） |
| `tts-voice-clone` | TTS音色克隆 | 媒体 | 按参考音频克隆音色朗读 |
| `image-to-video` | 图生视频 | 媒体 | 导演台 / 首尾帧 / 参考模式三种生成模式 |
| `text-generation` | 文本生成 | **文本** | **不落 `assert/` 媒体文件**，见第 3 节 |

**类型（type）≠ 实现（impl）**：一个类型下可注册多个实现，注册表以 `(type, impl)` 为键。
例：`image-to-video` 下有 `ltx`、`minimax-h3-r2v` 等实现；每个实现由某个服务商实例注册（`WorkflowBaseDefinition` 的 `type` / `impl` / `provider` / `providerInstanceId` / `workflowKey`）。

历史遗留：`character-appearance` / `character-voice` / `stage-image` / `scene-tts` / `scene-stage-image` / `video-generate` 是**按资产类型命名的旧工作流 id**（仍用于分镜/角色的批量生成与输出路径约定，见 [asset-layout.md](./asset-layout.md) 第 6 节），与上表的「执行类型」是两套命名，不要混用。

---

## 2. 产物形态一：媒体类（走 `WorkflowOutput`）

媒体类产物由引擎负责落盘，工作流脚本只负责**返回输出方式**（`WorkflowOutput`，定义在 `server/src/providers/types.ts`）：

| 输出方式 | 字段 | 引擎行为 |
|----------|------|----------|
| `download` | `{ type:'download', url, filename }` | 从 URL 下载后写入 `assert/{outputPath}` |
| `fetch` | `{ type:'fetch', request, filename }` | 再发一次 HTTP 请求取结果并写入 |
| `body` | `{ type:'body', contentType, data, filename }` | 解码 base64 后写入 |

- 媒体类任务**必须提供 `params.outputPath`**，且必须落在 `assert/` 下（`POST /api/workflow/run` 校验）。
- 重复生成同一路径时，引擎先把旧产物归档进 `history/`，再写新文件（见 [asset-layout.md](./asset-layout.md) 第 3.0 节）。

---

## 3. 产物形态二：文本类（`text-generation`）

文本类产物**不落 `assert/`**，而是写回画布节点。链路与媒体类逐条不同：

| 环节 | 媒体类 | 文本类（`text-generation`） |
|------|--------|------------------------------|
| `outputPath` | **必填** | **放宽为非必填**（`server/src/routes/workflow.ts` 对该类型跳过校验） |
| 引擎落盘 | 写 `assert/{outputPath}` | **不写 `assert/`**（`workflow-engine.ts` 文本产物分支） |
| 资产历史 | 归档进 `history/` | **不归档**，改为追加 `config.outputHistory` |
| 产物去向 | 文件系统 | 写回画布节点 `config.output` + 追加 `config.outputHistory` |
| 尺寸概念 | 有（`WorkflowSizeConfig`） | 无（不声明 `capabilities.size`，前端不渲染输出尺寸组件） |
| 非画布调用 | — | 无 `nodeId` / `canvas` 定位时只落在任务 `result.text`，不写画布文件 |

### 3.1 脚本侧怎么返回文本

自定义服务商脚本**二选一**（同时存在时以 `text` 为准，被忽略的 `outputs` 打 warn）：

| 写法 | 服务端行为 |
|------|-----------|
| `return { isFinish: true, text: '正文' }` | 直接取文本作为产物（**推荐**：接口已把文本放在响应里时无需先上传成文件） |
| `return { isFinish: true, outputs: ['https://…/result.txt'] }` | 拉取该 URL，校验 `Content-Type` 为 `text/*` / JSON / XML 且不超过 2MB，UTF-8 解码后作为产物 |

- `text` 必须是字符串；空串/纯空白视为未返回，任务失败（「文本工作流未返回内容…」）。
- 在**未勾选「文本生成」类型**的工作流上返回 `text` 只**告警忽略**，不静默当成产物。
- ComfyUI Bridge 的文本产物按 `output-files` 的 `.txt` / `.md` / `.json` 扩展名识别后下载解码。

### 3.2 文本写回画布（服务端单写者）

写回逻辑在 `server/src/canvas/text-result.ts`（历史规则在 `server/src/canvas/text-history.ts`，与 LLM 会话落盘共用）：

- **CAS + 路径锁 + 版本冲突重试**，保证画布文件只有一个写者；
- 任务 `result` 携带 `{ text, patch, prevRev, rev }`，前端据此做**版本对齐采纳**：`AssetCanvas.adoptTextRunResult` 与 LLM 会话终态 `adoptLlmResult` 是同一套语义（入撤销栈、`savedRev` 对齐、不触发写盘）；
- 服务端写盘失败时降级为 `failed` 并广播原因，不静默。

---

## 4. 新增一个工作流类型：同步清单

新增类型时**必须同步以下位置**，否则会出现「后端支持但前端无标签」「编辑器无类型提示」等断裂：

| # | 位置 | 改什么 |
|---|------|--------|
| 1 | `server/src/workflows/types.ts` 的 `WorkflowTypeId` | 加类型 id（**唯一权威**） |
| 2 | `server/src/workflows/vars.ts` | 加该类型的 vars interface（脚本侧 `ctx.params` 字段） |
| 3 | `server/src/providers/custom/types.ts` 的 `CUSTOM_WORKFLOW_TYPES` | 加类型 id（自定义服务商下拉可选） |
| 4 | `frontend/src/utils/workflow-types.ts` | 加中文标签 / 颜色（`WORKFLOW_TYPE_META`）与兜底清单（`FALLBACK_WORKFLOW_TYPES`） |
| 5 | `frontend/src/utils/custom-provider.ts` | 脚本类型提示：`PARAM_INTERFACES` + `PARAM_INTERFACE_NAMES` + 插入模板 |
| 6 | `server/src/workflows/bridge-derive.ts` | Bridge 标签 → 类型的推导（如需，注意优先级：媒体类型优先、`text-generation` 最低） |

补充约定：

- **前端类型标签从接口拉取**（`GET /api/workflow-types`，服务端注册表键集合），`FALLBACK_WORKFLOW_TYPES` 只是拉取失败时的兜底——两处必须一致，`frontend/src/utils/workflow-types.test.ts` 会断言 `WORKFLOW_TYPE_META` 与兜底清单的键集合相同。
- 声明 `capabilities`（视频模式 / 尺寸 / 是否可中断）见 `WorkflowCapabilities`，前端据此展示导演台、统一尺寸组件等能力入口。
- **中断**：所有 Bridge 与自定义服务工作流恒声明 `cancelable: true`；同步执行类另声明 `deferredCancel: true`（取消先写 `cancelRequested` 标记，引擎写产物前检查 → **中断后绝不落产物**）。详见 [task-manager.md](./task-manager.md) 与 [plans/custom-provider.md](./plans/custom-provider.md)。

---

## 5. 相关文件

| 文件 | 职责 |
|------|------|
| `server/src/workflows/types.ts` | `WorkflowTypeId` / `WorkflowDefinition` / `WorkflowCapabilities` / `WorkflowSizeConfig` |
| `server/src/workflows/vars.ts` | 各类型的业务变量 interface（`ctx.params`） |
| `server/src/workflows/registry.ts` | `(type, impl)` 注册表 |
| `server/src/workflow-engine.ts` | 媒体落盘 / 文本写回的产物分支 |
| `server/src/routes/workflow.ts` | `POST /api/workflow/run` 入参校验（`outputPath` 必填规则在此放宽） |
| `server/src/canvas/text-result.ts`、`text-history.ts` | 文本产物写回画布（CAS + 路径锁 + 历史规则） |
| `server/src/providers/custom/types.ts`、`client.ts` | 自定义服务商的类型白名单与执行/中断 |
| `frontend/src/utils/workflow-types.ts` | 类型 → 中文标签 / 颜色 / 兜底清单 |
| `frontend/src/utils/custom-provider.ts` | 自定义脚本编辑器的类型提示与模板 |
