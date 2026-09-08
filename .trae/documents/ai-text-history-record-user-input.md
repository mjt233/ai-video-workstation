# 计划：AI 文本生成节点历史「当时的输入」不含预设提示词

## 概述

AI 文本生成节点生成完成后的历史版本（`config.outputHistory`）中，「当时的输入」当前记录的是**组装后实际发送给 LLM 的完整文本**（预设提示词 + 用户输入）。需求：历史只记录**用户的原始输入**，不包含预设提示词内容。预设提示词名称仍通过 `presetName` 快照展示。

## 现状分析

生成链路（数据流）：

1. **前端发起**：[AiTextGenerateNode.vue](file:///c:/Users/xiaotao/code/ai-video-workstation/frontend/src/components/canvas/nodes/AiTextGenerateNode.vue#L618-L664) `onGenerate()`：
   - `text` = 用户原始输入（输入框文本或文本连线内容，已 trim）；
   - `finalInput = composePresetPrompt(preset.content, text)`（有预设时拼入预设内容）；
   - `startLlmTask({ input: finalInput, snapshot: { modelName, presetName, mediaLabels } })` —— **用户原始输入 `text` 未传给服务端**。
2. **服务端登记**：[routes/llm.ts](file:///c:/Users/xiaotao/code/ai-video-workstation/server/src/routes/llm.ts#L166-L175) `sessionManager.begin({ input, snapshot })` → [session-manager.ts](file:///c:/Users/xiaotao/code/ai-video-workstation/server/src/llm/session-manager.ts#L188) `session.inputSent = input.input`（= finalInput）。
3. **终态落盘**：[result-persist.ts](file:///c:/Users/xiaotao/code/ai-video-workstation/server/src/llm/result-persist.ts#L121-L135) `buildHistoryEntry()` 取 `input: session.inputSent` → 历史条目 input = 拼入预设后的完整文本。**Bug 所在**。

前端历史模型 [aiTextHistory.ts](file:///c:/Users/xiaotao/code/ai-video-workstation/frontend/src/canvas/aiTextHistory.ts#L28-L31) 与文档 [asset-canvas.md](file:///c:/Users/xiaotao/code/ai-video-workstation/docs/asset-canvas.md#L263) 均已声明语义应为「不含预设提示词替换后的完整发送内容」，仅实现未跟上。

`snapshot`（`LlmSessionSnapshot`：modelName/presetName/mediaLabels）即「终态历史归档凭据」，用户原始输入属于同类归档数据，**放入 snapshot 传递**是最贴合现有结构的方案（不新增会话顶层字段、不改 `input` 的发送语义）。

## 修改方案

### 1. 前端：发起时携带用户原始输入

- **[AiTextGenerateNode.vue](file:///c:/Users/xiaotao/code/ai-video-workstation/frontend/src/components/canvas/nodes/AiTextGenerateNode.vue#L659-L663)** `onGenerate()` 的 `snapshot` 增加 `userInput: text`（组装前的用户原始输入；未用预设时与最终发送内容一致）。
- **[frontend/src/api/llm.ts](file:///c:/Users/xiaotao/code/ai-video-workstation/frontend/src/api/llm.ts#L56-L57)** `StartLlmTaskRequest.snapshot` 类型增加 `userInput?: string`，JsDoc 注明：生成时的用户原始输入（未拼入预设提示词，历史「当时的输入」归档用）。

### 2. 服务端：快照透传 + 历史取原始输入

- **[session-manager.ts](file:///c:/Users/xiaotao/code/ai-video-workstation/server/src/llm/session-manager.ts#L28-L36)** `LlmSessionSnapshot` 增加 `userInput?: string`（生成时的用户原始输入快照）；`begin()`（L189-195）拷贝进会话快照（非空才带）。
- **[routes/llm.ts](file:///c:/Users/xiaotao/code/ai-video-workstation/server/src/routes/llm.ts#L303-L313)** `normalizeSnapshot()` 增加 `userInput` 字符串校验透传。
- **[result-persist.ts](file:///c:/Users/xiaotao/code/ai-video-workstation/server/src/llm/result-persist.ts#L121-L135)** `buildHistoryEntry()`：`input: session.snapshot.userInput ?? session.inputSent`（快照未提供时回退实际发送文本，兜底兼容），并同步更新 JSDoc 注释。

### 3. 测试

- **[result-persist.test.ts](file:///c:/Users/xiaotao/code/ai-video-workstation/server/src/llm/result-persist.test.ts)**：
  - 现有主用例（makeSession 无 `userInput`）保持不变 —— 顺带覆盖「回退 inputSent」分支；
  - 新增用例：`snapshot.userInput = '用户输入'`（模拟拼入预设场景，`inputSent` 为组装后文本）→ 历史 `entry.input === '用户输入'`。
- **[session-manager.test.ts](file:///c:/Users/xiaotao/code/ai-video-workstation/server/src/llm/session-manager.test.ts)**：begin 快照透传断言补充 `userInput`。

### 4. 文档

- **[docs/asset-canvas.md](file:///c:/Users/xiaotao/code/ai-video-workstation/docs/asset-canvas.md#L263)**：L263 存档说明更新为「记录**当时的输入**（会话快照 `snapshot.userInput`：未拼入预设提示词的用户原始输入；未提供时回退 `inputSent`）」；L469-L470 中 `input = inputSent` 的描述同步修正。

## 决策与假设

- **传递通道**：用户原始输入经 `snapshot.userInput` 传递（snapshot 本就是「终态历史归档凭据」容器），不新增请求/会话顶层字段，`input`（实际发送文本）语义不变。
- **回退策略**：`snapshot.userInput` 缺失时回退 `inputSent`（防御旧客户端/异常数据，一行表达式）。
- 历史条目数据结构（`AiTextHistoryEntry`）不变，仅写入值修正；已存在的历史条目不迁移（旧数据保持原样，属历史快照）。
- 前端 `aiTextHistory.ts` 纯函数与历史对话框无需改动（展示语义本就正确）。

## 验证步骤

1. `npm run typecheck`（服务端 + 前端，无类型错误）
2. `npm run lint`（无 ESLint 错误）
3. `cd server && npm run test`（vitest：result-persist / session-manager 相关用例通过）
4. 手动验证（可选）：画布中 AI 文本生成节点选择预设提示词后生成 → 打开「文本历史版本」，最新版本「当时的输入」仅显示用户输入原文，元信息 chips 仍显示「预设：xxx」
