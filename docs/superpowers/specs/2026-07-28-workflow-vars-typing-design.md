# 工作流 Vars 泛型类型化 - 设计文档

## 概述

将 `WorkflowParams.vars` 从 `Record<string, string>` 改为按工作流声明的泛型 `WorkflowParams<TVars>`，使各工作流脚本在编译期获得字段补全与约束。

## 决策记录

| 决策 | 选择 |
|------|------|
| 目标 | 优先编译期类型提示（不做运行时 Zod 校验） |
| 建模方式 | 按工作流泛型 `WorkflowParams<TVars>` / `WorkflowDefinition<TVars>` |
| 公共字段 | `WorkflowVarsBase` 含可选 `seed` |
| 项目尺寸 | `width`/`height`/`aspectRatio` 仅走 `projectConfig`，不再混入 `vars` |
| 字段值类型 | 保持 `string`（含 `index`），兼容现有 API/DB 序列化 |
| 注册表 | 异构实现擦除为基类 `WorkflowDefinition` |
| 前端 | 本阶段不改，HTTP 边界保持 `Record<string, string>` |

## 问题

当前全链路 `vars: Record<string, string>`：

- 工作流内访问 `params.vars.name` / `episode` 等无补全、无约束
- 引擎把 `projectConfig` 与 `seed` 一并 spread 进 `vars`，职责混杂
- 工厂函数 `createTextToImageWorkflow` 等同样无法约束调用方字段

## 类型设计

### 公共基类与各工作流 Vars

```typescript
export interface WorkflowVarsBase {
  seed?: string;
}

export interface CharacterAppearanceVars extends WorkflowVarsBase {
  name: string;
}

export interface CharacterVoiceVars extends WorkflowVarsBase {
  name: string;
}

export interface StageImageVars extends WorkflowVarsBase {
  name: string;
  label: string;
}

export interface SceneStageImageVars extends WorkflowVarsBase {
  episode: string;
  shot: string;
  index: string;
}

export interface SceneTtsVars extends WorkflowVarsBase {
  episode: string;
  shot: string;
  character: string;
}

export interface VideoGenerateVars extends WorkflowVarsBase {
  episode: string;
  shot: string;
}
```

### 泛型参数

```typescript
export interface WorkflowParams<TVars extends WorkflowVarsBase = WorkflowVarsBase> {
  project: string;
  readFile(relPath: string): Promise<string>;
  vars: TVars;
  projectConfig: ProjectConfig;
}

export interface WorkflowDefinition<
  TVars extends WorkflowVarsBase = WorkflowVarsBase,
  TPollResult = Record<string, unknown>,
> extends WorkflowBaseDefinition {
  submit(params: WorkflowParams<TVars>): Promise<{ taskId: string }>;
  poll?(taskId: string): Promise<{ status: string; done: boolean } & TPollResult>;
  parseOutput(taskId: string, response?: TPollResult): Promise<WorkflowOutput>;
}
```

### 工厂函数

`createComfyuiBridgeWorkflow` / `createTextToImageWorkflow` / `createImageEditWorkflow` / `createTtsDesignWorkflow` 均接受 `TVars`，config 中的 `getPrompt` / `getParams` 等使用 `WorkflowParams<TVars>`。

### 注册表与引擎边界

- `register(w: WorkflowDefinition)`：具体 `TVars` 在定义处保留，注册后擦除
- `runTask`：仅注入 `seed`，不再 `...projectConfig` 进 `vars`
- `loadProjectConfig` 直接返回 `ProjectConfig`（number 字段）
- `discovery` / routes / 前端：序列化边界可继续 `Record<string, string>`；可选 `satisfies XxxVars`

## 各工作流 vars 对照

| workflowId | 业务字段 | 公共 |
|---|---|---|
| character-appearance | name | seed? |
| character-voice | name | seed? |
| stage-image | name, label | seed? |
| scene-stage-image | episode, shot, index | seed? |
| scene-tts | episode, shot, character | seed? |
| video-generate | episode, shot | seed? |

## 非目标

- 运行时 schema 校验
- 前端 TypeScript 类型同步
- 改变 API 请求/响应 JSON 形状（字段仍为 string）

## 验证

1. `npm run typecheck` / `npm run lint` 全绿
2. 工作流脚本内 `params.vars.` 可补全业务字段；非法字段编译报错
3. 无代码依赖 `params.vars.width` / `params.vars.height`
