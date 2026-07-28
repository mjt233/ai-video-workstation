# 一键生成资产 — 设计文档

## 概述

在项目管理页面中，提供"一键生成资产"功能，允许用户批量生成项目的各类 AI 资产（角色外观图、角色声音、场景图、分镜场景图、分镜语音、视频），并支持多选资产类型、配置并发数、选择是否覆盖已有资产，以及实时查看生成进度。

## 架构

采用 **方案 B（后端批量 API）**：

- **后端**负责资产发现、任务创建、并发控制、状态管理
- **前端**负责 UI 展示和轮询状态
- 通过 `batch_id` 字段将多个单任务归组为一"批次"

```
┌──────────────┐    POST /api/workflow/batch-run    ┌──────────────────┐
│              │  ────────────────────────────────→  │                  │
│  前端        │                                     │  后端 Express    │
│  (Vue 3)     │  ←────────────────────────────────  │                  │
│              │    { batchId, totalTasks }          │  · 任务发现       │
│              │                                     │  · 批量创建任务   │
│              │    GET /api/workflow/batch/:id      │  · 并发控制引擎   │
│              │  ────────────────────────────────→  │  · 文件写入       │
│              │  ←────────────────────────────────  │                  │
│              │    { total, completed, failed, .. } │                  │
└──────────────┘                                     └──────────────────┘
```

## 数据库改动

在 `tasks` 表新增字段：

```sql
ALTER TABLE tasks ADD COLUMN batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_batch ON tasks(batch_id);
```

## 后端 API

### `POST /api/workflow/batch-run`

**请求体：**

```ts
{
  project: string        // 项目名称
  assetTypes: string[]   // 选中的资产类型 ID，如 ["character-appearance", "character-voice"]
  concurrency: number    // 并发数，默认 1
  overwrite: boolean     // 是否覆盖已有资产
}
```

**处理流程：**

1. 生成 `batchId`（UUID）
2. 调用资产发现逻辑，根据 `assetTypes` 和 `overwrite` 计算出任务清单
3. 批量创建任务写入 DB，每项标记 `batch_id`
4. 返回 `{ batchId, totalTasks, project }`

### `GET /api/workflow/batch/:batchId`

**响应：**

```ts
{
  batchId: string
  project: string
  total: number        // 总任务数
  completed: number    // 已完成
  failed: number       // 失败
  running: number      // 运行中
  pending: number      // 排队中
}
```

### `GET /api/workflow/tasks?batchId=xxx`

复用现有端点，按 `batchId` 过滤返回任务详情列表（含状态和日志）。

## 资产发现（新模块）

新建 `server/src/workflows/discovery.ts`，根据选中的资产类型和项目结构计算任务清单：

| 资产类型 | 发现逻辑 | 输出路径 |
|---------|---------|---------|
| `character-appearance` | 遍历 `prompt/character/{name}/appearance.md` | `assert/character/{name}/appearance.jpg` |
| `character-voice` | 遍历 `prompt/character/{name}/voice.md` | `assert/character/{name}/voice.flac` |
| `stage-image` | 遍历 `prompt/stage/{name}/` 下的 `.md` 文件 | `assert/stage/{name}/{label}.jpg` |
| `scene-stage-image` | 遍历 `prompt/scene/{episode}/{shot}/` | `assert/scene/{episode}/{shot}/stage.jpg` |
| `scene-tts` | 遍历 `prompt/scene/{episode}/{shot}/script.json` 解析台词 | `assert/scene/{episode}/{shot}/voice_{char}.flac` |
| `video-generate` | 遍历 `prompt/scene/{episode}/{shot}/` | `assert/scene/{episode}/{shot}/video.mp4` |

如果 `overwrite=false`，对于每个待生成任务检查 `assert/` 下目标文件是否已存在，已存在则跳过创建。

## 后端引擎并发控制

修改 `workflow-engine.ts` 的 `startEngine()` 逻辑：

```
每 2 秒 tick：

1. 查询所有 pending 和 running 的任务
2. 按 batch_id 分组统计每组 running 任务数
3. 对有 batch_id 的任务：
   - 如果该批 running 数 < concurrency，从 pending 中取出一个启动
4. 对无 batch_id 的任务（向后兼容单任务）：
   - 不受并发限制，按原有逻辑处理
```

每个任务启动后仍是独立的异步执行，互不阻塞。`concurrency` 只是在启动阶段做上限控制。

## 前端改动

### 新组件 `BatchGenerateDialog.vue`

使用 Vuetify 3 构建，包含两种视图模式：

**配置视图：**
- `v-card` 对话框，标题"⚡ 一键生成资产"
- `v-checkbox` 网格（2 列）展示 6 种资产类型，默认全选
- `v-slider` 并发数选择（1-10），默认 1
- `v-switch` 重复生成（覆盖）开关
- 统计摘要行（"将生成 N 个资产，其中 M 个已有，K 个待生成"）
- "取消"和"开始生成"按钮

**进度视图（点击开始生成后切换）：**
- 顶部总进度条（`v-progress-linear`）和摘要（已完成/总数）
- `v-list` 渲染任务列表，每项显示：
  - 状态图标（✅/🔄/⏳/❌）
  - 资产名称（如"🧑 角色外观 - 小霓"）
  - 状态文字（已完成/生成中/排队中/失败）
- 失败任务点击可单独重试
- 底部"后台运行"和"关闭"按钮

### 新 Composable `useBatchTask.ts`

```ts
function useBatchTask(batchId: Ref<string | null>) {
  const summary = reactive({ total: 0, completed: 0, failed: 0, running: 0, pending: 0 })
  const tasks = ref<TaskResponse[]>([])
  // 每 2 秒轮询 GET /api/workflow/batch/:batchId 和 GET /api/workflow/tasks?batchId=xxx
  // 自动在 completed 时停止轮询
  // onUnmounted 清理定时器
}
```

### `ProjectView.vue` 集成

- 在左侧"资产浏览器"标题旁添加"⚡ 一键生成"按钮（`v-btn size="small"`）
- 点击打开 `BatchGenerateDialog`
- 关闭对话框后自动触发资产树刷新

## 错误处理

- 单任务失败按现有重试逻辑（最多 3 次），不影响同批次其他任务
- 批次中部分失败不影响其他任务
- 用户在进度视图中可点击失败任务重试（复用 `POST /api/workflow/retry`）
- 网络中断/页面刷新：前端重新打开对话框时列出最近未完成的批次

## 向后兼容

- 无 `batch_id` 的旧任务不受影响，按原有逻辑执行
- 现有 `GenerateDialog.vue` 和单任务生成流程保留不变
- 新的 `BatchGenerateDialog.vue` 是独立组件，不修改现有组件逻辑
