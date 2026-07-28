# AI 工作流适配指南

## 概述

工作流引擎是连接视频项目管理器与 AI API 的桥梁。系统已预置 6 类共 8 个工作流脚本（位于 `server/src/workflows/`），但均为 Mock 实现，你需要将它们适配到你实际使用的 AI 服务。

**核心概念：** 每个工作流是一个独立的 TypeScript 文件，导出 `WorkflowDefinition` 接口。系统启动时自动发现并注册这些文件。

---

## 工作流生命周期

```
提交任务 (POST /api/workflow/run)
  ↓
submit() ──── 调用 AI API 提交任务，返回远端 taskId
  ↓
[如果定义 poll()]
  poll() ──── 循环轮询任务状态，直到 done=true
  ↓
parseOutput() ──── 从完成任务提取输出方式
  ↓
引擎自动执行 (根据 output.type)：
  download → 从 URL 下载并写入 assert/
  fetch    → 发送 HTTP 请求获取结果并写入 assert/
  body     → 解码 base64 并写入 assert/
  ↓
任务完成
```

---

## WorkflowDefinition 接口

```typescript
interface WorkflowDefinition<TPollResult = Record<string, unknown>> {
  id: string            // 工作流类型标识，如 "character-appearance"
  name: string          // 显示名称
  impl: string          // 实现标识，如 "default"、"flux"
  description?: string

  submit(params: WorkflowParams): Promise<{ taskId: string }>
  poll?(taskId: string): Promise<{ status: string; done: boolean } & TPollResult>
  parseOutput(taskId: string, response?: TPollResult): Promise<WorkflowOutput>
}
```

### WorkflowParams

```typescript
interface WorkflowParams {
  project: string                          // 项目名称
  readFile(relPath: string): Promise<string>  // 读取 prompt/ 下的文件内容
  vars: Record<string, string>             // 变量，如 { name, episode, shot, label }
  projectConfig: ProjectConfig             // 项目配置（自动从 project.json 注入）
}

interface ProjectConfig {
  width: number;                           // 画面宽度（像素），如 1080
  height: number;                          // 画面高度（像素），如 1920
  aspectRatio?: string;                    // 画面比例，如 "9:16"
}
```

> `projectConfig` 由引擎自动从 `design/{项目}/project.json` 读取并注入。`vars` 中也会同步注入 `width`、`height`、`aspectRatio` 的字符串版本（兼容已有工作流）。

### WorkflowOutput（三种输出方式）

```typescript
// 方式 A：从 URL 下载（最常用）
{ type: 'download'; url: string; filename: string }

// 方式 B：再发一个 HTTP 请求获取结果
{ type: 'fetch'; request: { url: string; method: string; headers?: Record<string, string> }; filename: string }

// 方式 C：响应体本身就是 base64 编码的结果
{ type: 'body'; contentType: string; data: string; filename: string }
```

---

## 快速开始：适配一个工作流

以 `character-appearance/default.ts`（角色外观生成）为例，展示如何从 Mock 替换为真实 API 调用。

### 原始 Mock 代码

```typescript
import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

register({
  id: 'character-appearance',
  name: '角色外观生成 (Qwen)',
  impl: 'default',
  description: '使用 Qwen 文生图模型生成角色外观图片',

  async submit(params) {
    const prompt = await params.readFile(`prompt/character/${params.vars.name}/appearance.md`);
    return { taskId: 'mock-' + Date.now() };           // ← Mock
  },

  async poll(taskId) {
    return { status: 'completed', done: true };         // ← Mock
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: 'https://via.placeholder.com/1024',          // ← Mock
      filename: 'appearance.jpg',
    };
  }
} satisfies WorkflowDefinition);
```

### 适配后代码

```typescript
import { register } from '../registry.js';
import type { WorkflowDefinition } from '../types.js';

// 定义 poll 返回的额外字段类型（可选，用于 parseOutput 类型安全）
interface PollExtra {
  imageUrl: string;
}

register({
  id: 'character-appearance',
  name: '角色外观生成 (Qwen)',
  impl: 'default',
  description: '使用 Qwen 文生图模型生成角色外观图片',

  async submit(params) {
    const prompt = await params.readFile(`prompt/character/${params.vars.name}/appearance.md`);
    const response = await fetch('https://api.qwen.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.QWEN_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'qwen-vl-plus',
        prompt,
        n: 1,
        size: '1024x1024',
      }),
    });
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    return { taskId: data.id };
  },

  async poll(taskId) {
    const response = await fetch(`https://api.qwen.ai/v1/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${process.env.QWEN_API_KEY}` },
    });
    const data = await response.json();
    return {
      status: data.status,
      done: data.status === 'succeeded' || data.status === 'failed',
      imageUrl: data.output?.image_url,  // 额外字段，传入 parseOutput
    };
  },

  async parseOutput(taskId, response) {
    return {
      type: 'download',
      url: response.imageUrl,   // 类型安全！response 包含 imageUrl
      filename: 'appearance.jpg',
    };
  }
} satisfies WorkflowDefinition<PollExtra>);
```

### 使用 `projectConfig` 获取分辨率

在适配视频生成工作流时，通常需要传入画面分辨率：

```typescript
async submit(params) {
  const prompt = await params.readFile(`prompt/scene/${params.vars.episode}/${params.vars.shot}/prompt.md`);

  // 从 projectConfig 获取项目分辨率（类型安全！）
  const { width, height } = params.projectConfig;

  const response = await fetch('https://api.example.com/generate', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.API_KEY}` },
    body: JSON.stringify({
      prompt,
      width,        // number: 1080
      height,       // number: 1920
    }),
  });
  // ...
}
```

如果项目暂无 `project.json`，`width` 和 `height` 会返回 `0`。建议在 `design/{项目}/` 下创建：

```bash
python .claude/skills/create-video-script/scripts/set_project_property.py --project "项目名" width 1080
python .claude/skills/create-video-script/scripts/set_project_property.py --project "项目名" height 1920
```

---

## 资产输出路径约定

每种工作流类型输出到固定的资产路径，适配时必须保持一致：

| 工作流 ID | 输出路径 | 说明 |
|-----------|---------|------|
| `character-appearance` | `assert/character/{name}/appearance.jpg` | 角色外观图 |
| `character-voice` | `assert/character/{name}/voice.flac` | 角色语音 |
| `stage-image` | `assert/stage/{name}/{label}.jpg` | 场景图 |
| `scene-tts` | `assert/scene/{ep}/{shot}/voice/{character}.flac` | 分镜台词 |
| `scene-stage-image` | `assert/scene/{ep}/{shot}/stage/{index}.jpg` | 分镜场景图 |
| `video-generate` | `assert/scene/{ep}/{shot}/video/{index}.mp4` | 视频 |

输出路径由前端在提交任务时指定（`outputPath` 参数），工作流脚本只需要在 `parseOutput` 中返回正确的输出方式（URL / 请求 / body），引擎负责写入。

**`scene-stage-image` 直接引用：** 当对应 `stage.json` 条目的 `登场角色` 与 `prompt` 同时为空时，调度引擎会短路处理——将 `assert/stage/{场景}/{标签}.jpg` 复制为上述分镜场景图输出路径，不调用 AI 图像编辑工作流。直接引用结果仍是独立的分镜资产文件。

---

## 工作流实现注册与多实现切换

### 注册机制

每个工作流文件在 `import` 时自动调用 `register()` 注册到引擎。注册表以 `(id, impl)` 为键，同一 `id` 可注册多个 `impl`：

```
server/src/workflows/
├── character-appearance/
│   ├── default.ts    ← 注册 (character-appearance, default)
│   └── flux.ts       ← 注册 (character-appearance, flux)
├── character-voice/
│   └── default.ts    ← 注册 (character-voice, default)
...
```

### 选择生效的实现

**方式一：项目配置（推荐）** — 在 `design/{项目}/workflow.config.json` 中指定默认实现：

```json
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

**方式二：UI 临时切换** — 生成对话框中显示可选实现列表，用户可临时选择其他实现。

**方式三：新增实现** — 在对应类别目录下新建 `.ts` 文件（如 `character-appearance/dalle3.ts`），在文件内调用 `register()` 注册新的 `impl` 名称，重启服务端即可。

---

## 各 AI 服务适配示例

### 1. 同步 API（无需轮询）

如果 AI 服务在 HTTP 响应中直接返回结果，则不需要定义 `poll()`：

```typescript
register({
  id: 'stage-image',
  name: '场景图片生成',
  impl: 'default',

  async submit(params) {
    const prompt = await params.readFile(`prompt/stage/${params.vars.name}/${params.vars.label}.md`);
    const response = await fetch('https://api.example.com/generate', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.API_KEY}` },
      body: JSON.stringify({ prompt, size: '1024x1024' }),
    });
    const data = await response.json();
    // 直接返回结果，不经过 poll
    const imageUrl = data.data[0].url;
    return {
      taskId: 'sync-task',
      _output: { type: 'download', url: imageUrl, filename: 'scene.jpg' }
    };
  },
  // 没有 poll() — 引擎会认为任务是同步的

  async parseOutput(taskId, response) {
    // 对于同步 API，直接从 submit 返回结果
    // 可结合自定义逻辑使用
    return {
      type: 'download',
      url: 'https://...',
      filename: 'scene.jpg',
    };
  }
} satisfies WorkflowDefinition);
```

### 2. 需要额外 Fetch 的结果

如果 API 返回的不是直接下载 URL，而是需要再从另一个地址获取：

```typescript
async parseOutput(taskId, response) {
  return {
    type: 'fetch',
    request: {
      url: `https://api.example.com/files/${taskId}/download`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${process.env.API_KEY}` },
    },
    filename: 'voice.flac',
  };
}
```

### 3. Base64 编码的结果

如果 API 直接返回 Base64 编码的文件内容：

```typescript
async parseOutput(taskId, response) {
  return {
    type: 'body',
    contentType: 'image/jpeg',
    data: response.imageBase64,  // base64 字符串
    filename: 'appearance.jpg',
  };
}
```

---

## 环境变量

敏感信息（API Key 等）通过环境变量传入，不硬编码在脚本中。创建 `server/.env` 文件：

```env
QWEN_API_KEY=sk-your-key-here
FLUX_API_KEY=another-key
OPENAI_API_KEY=sk-...
```

在脚本中通过 `process.env.QWEN_API_KEY` 读取。

---

## 添加全新的工作流类型

如果需要支持新的资产类型（如「角色全身图」），按以下步骤操作：

### 1. 创建工作流脚本

```typescript
// server/src/workflows/character-fullbody/default.ts
import { register } from '../registry.js';

register({
  id: 'character-fullbody',    // 新的工作流 ID
  name: '角色全身图生成',
  impl: 'default',
  description: '生成角色全身立绘',

  async submit(params) {
    const prompt = await params.readFile(`prompt/character/${params.vars.name}/appearance.md`);
    const response = await fetch('https://api.example.com/generate', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.API_KEY}` },
      body: JSON.stringify({ prompt, size: '768x1024' }),
    });
    const data = await response.json();
    return { taskId: data.id };
  },

  async poll(taskId) {
    const res = await fetch(`https://api.example.com/tasks/${taskId}`);
    const data = await res.json();
    return { status: data.status, done: data.status === 'completed' };
  },

  async parseOutput(taskId) {
    return {
      type: 'download',
      url: `https://api.example.com/tasks/${taskId}/output`,
      filename: 'fullbody.jpg',
    };
  }
} satisfies WorkflowDefinition);
```

### 2. 重启服务端

引擎启动时自动扫描 `workflows/` 目录，新脚本会被自动发现并注册。

### 3. 在前端使用

在对应 Panel 组件中，用新的 `workflowId` 和 `outputPath` 调用 `GenerateDialog`：

```vue
<GenerateDialog
  v-model="dialog.show"
  :project="project"
  workflow-id="character-fullbody"
  workflow-name="角色全身图生成"
  :vars="{ name }"
  output-path="assert/character/{name}/fullbody.jpg"
  @refresh="load"
/>
```

---

## 调试与测试

### 查看任务日志

```
GET /api/workflow/tasks/{taskId}/log
```

返回任务完整执行日志，包括 HTTP 请求 URL、响应状态码、错误信息。

### 手动提交测试

```bash
curl -X POST http://localhost:3001/api/workflow/run \
  -H "Content-Type: application/json" \
  -d '{
    "project": "AI的第一天",
    "workflowId": "character-appearance",
    "impl": "default",
    "params": {
      "vars": { "name": "小霓" },
      "outputPath": "assert/character/小霓/appearance.jpg"
    }
  }'
```

### 重新生成

```bash
curl -X POST http://localhost:3001/api/workflow/retry/{taskId}
```

---

## 目录结构参考

```
server/src/workflows/
├── registry.ts                     # 注册表（不需修改）
├── types.ts                        # 类型定义（不需修改）
├── character-appearance/
│   ├── default.ts                  # ← 你的适配入口
│   └── flux.ts                     # 可选：另一套实现
├── character-voice/
│   └── default.ts                  # ← 你的适配入口
├── stage-image/
│   └── default.ts                  # ← 你的适配入口
├── scene-tts/
│   └── default.ts                  # ← 你的适配入口
├── scene-stage-image/
│   └── default.ts                  # ← 你的适配入口
└── video-generate/
    ├── default.ts                  # ← 你的适配入口
    └── ltx.ts                      # 可选：LTX 模型实现
```
