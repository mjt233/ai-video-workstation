# 工作流 Vars 泛型类型化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为各工作流的 `params.vars` 提供编译期类型补全与约束，替代 `Record<string, string>`。

**Architecture:** 引入 `WorkflowVarsBase` 与按工作流划分的 Vars 接口；`WorkflowParams<TVars>` / `WorkflowDefinition<TVars>` 贯穿定义与工厂；注册表与引擎边界类型擦除；引擎仅注入 `seed`，尺寸只走 `projectConfig`。

**Tech Stack:** TypeScript、Express 服务端工作流引擎

---

### Task 1: 核心类型

**Files:**
- Create: `server/src/workflows/vars.ts`
- Modify: `server/src/workflows/types.ts`

- [x] **Step 1: 新增 `vars.ts`**

定义 `WorkflowVarsBase` 与 6 个工作流 Vars 接口（字段均为 string，`seed?` 在基类）。

- [x] **Step 2: 泛型化 `types.ts`**

- 从 `./vars.js` re-export Vars 类型
- `WorkflowParams<TVars extends WorkflowVarsBase = WorkflowVarsBase>`
- `WorkflowDefinition<TVars, TPollResult>` 的 `submit` 使用 `WorkflowParams<TVars>`

- [x] **Step 3: typecheck 片段**

Run: `npm run typecheck`（允许后续文件仍有错误，本任务以类型文件本身无语法错误为准）

---

### Task 2: 工厂与注册表

**Files:**
- Modify: `server/src/workflows/bridge-client.ts`
- Modify: `server/src/workflows/registry.ts`

- [x] **Step 1: 工厂泛型**

`createComfyuiBridgeWorkflow` / `createTextToImageWorkflow` / `createImageEditWorkflow` / `createTtsDesignWorkflow` 及 config 接口增加 `TVars extends WorkflowVarsBase`。

- [x] **Step 2: registry**

`register(w: WorkflowDefinition)` 保持基类擦除存储（默认 `TVars = WorkflowVarsBase` 即可接受具体实现）。

---

### Task 3: 工作流脚本标注 TVars

**Files:**
- Modify: `server/src/workflows/character-appearance/default.ts`
- Modify: `server/src/workflows/character-appearance/flux.ts`
- Modify: `server/src/workflows/character-voice/default.ts`
- Modify: `server/src/workflows/stage-image/default.ts`
- Modify: `server/src/workflows/scene-stage-image/default.ts`
- Modify: `server/src/workflows/scene-tts/default.ts`
- Modify: `server/src/workflows/video-generate/default.ts`
- Modify: `server/src/workflows/video-generate/ltx.ts`

- [x] **Step 1: 各脚本使用对应 Vars**

工厂调用显式泛参或 `satisfies WorkflowDefinition<XxxVars>`；`getPrompt`/`getParams`/`submit` 内依赖类型访问字段。

---

### Task 4: 引擎注入清理

**Files:**
- Modify: `server/src/workflow-engine.ts`

- [x] **Step 1: `loadProjectConfig` 返回 `ProjectConfig`**

不再返回 string map。

- [x] **Step 2: `runTask` 组装 `WorkflowParams`**

- `vars` 仅 merge 任务 params + `seed`
- 不再 `...projectConfig` 进 vars
- `projectConfig` 直接使用 `loadProjectConfig` 结果（缺省 width/height 为 0）

---

### Task 5: 可选 discovery 收紧 + 验证

**Files:**
- Modify: `server/src/workflows/discovery.ts`（可选 satisfies）

- [x] **Step 1: discovery 构造 vars 时 `satisfies XxxVars`（可选）**
- [x] **Step 2: `npm run typecheck`**
- [x] **Step 3: `npm run lint`**
- [x] **Step 4: grep 确认无 `params.vars.width|height`**
