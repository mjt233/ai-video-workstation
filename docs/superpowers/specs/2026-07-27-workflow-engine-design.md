# AI 资产工作流引擎 - 设计文档

## 概述

为视频项目管理器增加 AI 资产生成能力。用户可以在资产浏览器中，对缺失或不满意资产（角色外观图片、角色语音、场景图片、分镜语音、分镜场景图、视频）提交生成任务，由服务端工作流引擎调度 AI API 完成生成并写入 `assert/` 目录。

## 决策记录

| 决策 | 选择 |
|------|------|
| 工作流定义方式 | TypeScript 脚本（非 JSON 配置） |
| 异步机制 | 服务端轮询（非 Webhook） |
| 结果输出方式 | download / fetch / body 三种模式 |
| 任务存储 | 服务端 SQLite |
| 架构模式 | 服务端 Workflow Engine |
| 多实现切换 | 脚本注册表 + 项目配置 + UI 选择 |

## 资产类型 ↔ 工作流映射

| 资源类型 | 工作流 ID | 工作流类型 | 触发条件 | 输出路径 |
|---------|-----------|-----------|---------|---------|
| 角色外观 | `character-appearance` | 文生图 | assert 无图 / 用户不满意 | `assert/character/{name}/appearance.jpg` |
| 角色声音 | `character-voice` | TTS 音色设计 | assert 无音频 / 用户不满意 | `assert/character/{name}/voice.flac` |
| 场景图片 | `stage-image` | 文生图 | assert 无图 / 用户不满意 | `assert/stage/{parent}/{subscene}.jpg` |
| 分镜台词 TTS | `scene-tts` | TTS | 手动触发 | `assert/scene/{ep}/{shot}/voice/{char}.flac` |
| 分镜场景图 | `scene-stage-image` | 图片编辑 | 分镜有 stage.json | `assert/scene/{ep}/{shot}/stage/{n}.jpg` |
| 视频 | `video-generate` | 图生视频 | 分镜图片已就绪 | `assert/scene/{ep}/{shot}/video/{n}.mp4` |

## 架构

```
┌──────────────────────────────────────────────────────┐
│                    前端 (Vue 3)                       │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐   │
│  │AssetTree │  │CharPanel │  │ ScenePanel        │   │
│  │          │  │ [生成] btn│  │ [生成] btn        │   │
│  └──────────┘  └──────────┘  └───────────────────┘   │
│         │             │               │              │
│         ▼             ▼               ▼              │
│  ┌──────────────────────────────────────────────┐   │
│  │         api/client.ts (axios)                 │   │
│  │  POST /api/workflow/run  GET /api/workflow/*  │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────┬───────────────────────────────┘
                       │ HTTP
┌──────────────────────▼───────────────────────────────┐
│               服务端 (Express)                         │
│  ┌─────────────────┐  ┌──────────────────────────┐   │
│  │  routes/fs.ts    │  │  routes/workflow.ts      │   │
│  │  (已有)           │  │  POST /run, GET /tasks   │   │
│  └─────────────────┘  │  GET /tasks/:id/log       │   │
│                        └───────────┬──────────────┘   │
│                                    │                  │
│  ┌─────────────────────────────────▼──────────────┐   │
│  │           workflow-engine.ts                    │   │
│  │  • 注册 & 发现工作流脚本                        │   │
│  │  • 调度 submit → poll → parseOutput            │   │
│  │  • 重试 & 超时控制                              │   │
│  │  • 日志记录                                     │   │
│  └───────────────────────┬────────────────────────┘   │
│                          │                            │
│  ┌───────────────────────▼────────────────────────┐   │
│  │          workflows/ 目录                        │   │
│  │  character-appearance/ (default.ts, flux.ts)   │   │
│  │  character-voice/     (default.ts)             │   │
│  │  stage-image/         (default.ts)             │   │
│  │  scene-tts/           (default.ts)             │   │
│  │  scene-stage-image/   (default.ts)             │   │
│  │  video-generate/      (default.ts, ltx.ts)     │   │
│  └────────────────────────────────────────────────┘   │
│                                                       │
│  ┌────────────────────────────────────────────────┐   │
│  │  data/workflow.db (SQLite)                      │   │
│  │  tasks + task_logs 表                           │   │
│  └────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────┘
```

## 目录结构变化

在现有 `server/` 基础上新增：

```
server/
├── src/
│   ├── workflow-engine.ts      # 工作流引擎核心
│   ├── routes/
│   │   └── workflow.ts         # 工作流 API 路由
│   └── workflows/              # 工作流脚本
│       ├── registry.ts         # 注册表
│       ├── types.ts            # WorkflowDefinition 接口定义
│       ├── character-appearance/
│       │   ├── default.ts
│       │   └── flux.ts
│       ├── character-voice/
│       │   └── default.ts
│       ├── stage-image/
│       │   └── default.ts
│       ├── scene-tts/
│       │   └── default.ts
│       ├── scene-stage-image/
│       │   └── default.ts
│       └── video-generate/
│           ├── default.ts
│           └── ltx.ts
└── data/
    └── workflow.db             # SQLite 数据库（自动创建）
```

## 类型定义 (types.ts)

```typescript
// 工作流执行参数
interface WorkflowParams {
  project: string
  /** 从 prompt 资产路径读取文件内容 */
  readFile(relPath: string): Promise<string>
  /** 变量替换，如 { name } → "小霓" */
  vars: Record<string, string>
}

// 工作流定义接口
interface WorkflowDefinition {
  id: string                // 如 "character-appearance"
  name: string              // 如 "角色外观生成"
  impl: string              // 如 "default" | "flux"
  description?: string

  /** 提交任务到 AI API → 返回远程 taskId */
  submit(params: WorkflowParams): Promise<{ taskId: string }>

  /** 可选：轮询任务状态。不实现则视为同步任务 */
  poll?(taskId: string): Promise<{ status: string; done: boolean }>

  /** 从已完成的任务获取输出方式 */
  parseOutput(taskId: string, response?: any): Promise<WorkflowOutput>
}

// 输出方式 — 引擎根据类型执行对应操作
type WorkflowOutput =
  | { type: 'download'; url: string; filename: string }
  | { type: 'fetch'; request: { url: string; method: string; headers?: Record<string, string> }; filename: string }
  | { type: 'body'; contentType: string; data: string; filename: string }

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'
```

## 注册表与多实现切换 (registry.ts)

### 三层切换机制

1. **脚本层** — 同一工作流 ID 可注册多个实现（如 `default.ts`、`flux.ts`）
2. **项目配置层** — `design/{project}/workflow.config.json` 指定各类型默认实现
3. **UI 层** — 生成时用户可临时选择其他实现

```typescript
const registry = new Map<string, WorkflowDefinition[]>()

export function register(w: WorkflowDefinition) {
  const list = registry.get(w.id) ?? []
  list.push(w)
  registry.set(w.id, list)
}

export function getImplementations(id: string): WorkflowDefinition[] {
  return registry.get(id) ?? []
}

export function getImpl(id: string, impl: string): WorkflowDefinition | undefined {
  return registry.get(id)?.find(w => w.impl === impl)
}
```

### 自动发现

引擎启动时自动扫描 `workflows/` 目录，动态 import 所有 `.ts` 文件。用户新增一个 `.ts` 文件到对应子目录，重启即可注册新实现，无需修改其他代码。

### 项目配置示例

```json
// design/{project}/workflow.config.json
{
  "defaults": {
    "character-appearance": "flux",
    "character-voice": "default",
    "stage-image": "default",
    "scene-tts": "default",
    "scene-stage-image": "default",
    "video-generate": "ltx"
  }
}
```

## API 设计

### GET /api/workflows

列出可用的工作流类型及其实现列表。

**Response:**
```json
{
  "workflows": [
    {
      "id": "character-appearance",
      "name": "角色外观生成",
      "implementations": [
        { "impl": "default", "name": "Qwen", "description": "使用 Qwen 文生图模型" },
        { "impl": "flux", "name": "Flux", "description": "使用 Flux 模型" }
      ]
    }
  ]
}
```

### POST /api/workflow/run

提交一个生成任务。

**Body:**
```json
{
  "project": "AI的第一天",
  "workflowId": "character-appearance",
  "impl": "default",
  "params": {
    "vars": { "name": "小霓" },
    "promptPaths": ["prompt/character/小霓/appearance.md"],
    "outputPath": "assert/character/小霓/appearance.jpg"
  }
}
```

**Response:** `{ "taskId": "uuid", "status": "pending" }`

### GET /api/workflow/tasks/:taskId

查询单个任务状态。

**Response:**
```json
{
  "taskId": "uuid",
  "workflowId": "character-appearance",
  "impl": "default",
  "status": "running",
  "params": { ... },
  "result": { "path": "assert/character/小霓/appearance.jpg" },
  "createdAt": "2026-07-27T10:00:00Z",
  "updatedAt": "2026-07-27T10:01:00Z"
}
```

### GET /api/workflow/tasks

按项目/状态过滤任务列表。

**Query params:** `project`, `status`

**Response:** `{ "tasks": [...] }`

### GET /api/workflow/tasks/:taskId/log

获取任务运行日志。

**Response:** `{ "logs": [{ "level": "info", "message": "...", "time": "..." }] }`

### POST /api/workflow/retry/:taskId

基于已有任务重新生成（创建新任务，复用参数）。

**Response:** `{ "taskId": "new-uuid", "status": "pending" }`

## 数据库 Schema (SQLite)

```sql
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  project      TEXT NOT NULL,
  workflow_id  TEXT NOT NULL,
  impl         TEXT NOT NULL DEFAULT 'default',
  status       TEXT NOT NULL DEFAULT 'pending',
  params       TEXT NOT NULL,              -- JSON
  result       TEXT,                       -- JSON
  error_msg    TEXT,
  retry_count  INTEGER DEFAULT 0,
  max_retries  INTEGER DEFAULT 3,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE task_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  level      TEXT NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL,
  metadata   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tasks_project ON tasks(project);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_task_logs_task ON task_logs(task_id);
```

## 引擎工作流程 (workflow-engine.ts)

```
submit → 创建任务 (pending)
   ↓
更新状态为 running
   ↓
调用 workflow.submit(params) → 获得远程 taskId
   ↓
[如果定义了 poll] 循环轮询：
  → 每 2s 调用 workflow.poll(remoteTaskId)
  → 直到 done === true
   ↓
调用 workflow.parseOutput(remoteTaskId) → WorkflowOutput
   ↓
根据 output.type 执行：
  download → fetch URL → 写入 assert/
  fetch    → 发自定义 HTTP 请求 → 写入 assert/
  body     → 解码 base64 → 写入 assert/
   ↓
更新状态为 completed + 记录输出路径
   ↓
[失败时] 重试 (最多 3 次) → 仍失败则 status = failed + 记录 error_msg
```

引擎启动后以后台循环扫描 pending 任务并调度执行。

## 前端集成

### 新增文件

- `frontend/src/components/GenerateDialog.vue` — 通用生成对话框组件
- `frontend/src/composables/useWorkflowTask.ts` — 任务轮询 composable
- `frontend/src/api/workflow.ts` — 工作流 API 封装

### GenerateDialog.vue

可复用对话框，功能：
- 显示工作流名称
- 多实现时提供 `<v-select>` 选择
- 显示生成进度条
- 实时显示日志
- 完成/失败状态展示
- 「开始生成」/「重新生成」按钮

### 各 Panel 改动

**CharacterPanel.vue:**
- 外观 tab：右侧图片区增加「生成」按钮（workflowId: `character-appearance`）
- 声音 tab：右侧音频区增加「生成」按钮（workflowId: `character-voice`）

**StagePanel.vue:**
- 图片 tab：增加「生成」按钮（workflowId: `stage-image`）

**ScenePanel.vue:**
- 场景图片 tab：每个场景增加「生成」按钮（workflowId: `scene-stage-image`）
- 台词 tab：增加「生成语音」按钮（workflowId: `scene-tts`）
- prompt tab：增加「生成视频」按钮（workflowId: `video-generate`）

### 状态轮询

`useWorkflowTask` composable 在对话框打开后以 2s 间隔轮询任务状态，完成/失败时自动停止轮询并触发资产刷新。

### 用户操作流程

```
浏览资产 → 资产不存在/不满意 → 点击「生成」按钮
  → 弹出生成对话框
  → (可选) 选择实现
  → 点击「开始生成」
  → 实时展示进度 + 日志
  → 完成 → 自动刷新显示资产
  → 失败 → 显示错误 → 可重新生成
```

## 错误处理

- 任务提交失败 → status = failed + error_msg
- 轮询超时（可配置，默认 5 分钟）→ 标记失败
- 网络错误自动重试（最多 3 次）
- API 认证错误不重试，直接标记失败
- 写入 assert/ 失败 → 标记失败 + 保留日志

## 安全考虑

- API Key 等敏感信息存储在服务端环境变量中，不传入前端
- 工作流脚本在服务端执行，不会暴露给前端
- assert/ 写入路径由引擎根据 outputPath 参数控制，防止路径穿越
- SQLite 仅服务端本地访问
