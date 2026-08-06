# 工作流 Provider 插件系统与参数配置 — 设计文档

日期：2026-08-06
分支：`feat-provider-config`（基于 `vuetify-upgrade`）

## 1. 背景与目标

当前系统所有工作流实现都通过 `comfyui-easy-bridge`（ComfyUI Easy Bridge）执行，`server/src/workflows/bridge-client.ts` 硬编码了 `BRIDGE_URL` / `BRIDGE_PASSWORD`（环境变量或默认值），并带模块级 token 缓存。

未来需要接入**其他在线工作流提供商**（如火山方舟引擎的图片编辑工作流，需要配置 API Key）。本次目标：

1. 引入 **Provider 插件系统**：工作流声明自己使用哪个 provider，provider 负责传输层（提交/轮询/取消/输出获取），并声明自己的配置 schema。
2. **配置可管理**：provider 配置（Bridge 地址/密码、API Key 等）通过设置界面动态配置，存储于服务端 JSON 文件（不入 git），配置改动无需重启服务端即生效。
3. **可扩展**：新增 provider 只需新增一个插件文件 + 注册，引擎/工作流层零改动；配置 schema 驱动前端设置表单，完全通用化。
4. 火山方舟等具体 provider **不在本次范围内**，但接入模式在文档中给出（见 §10）。

## 2. 决策记录

| 决策点 | 结论 |
|---|---|
| 配置作用域 | **全局**（服务端统一管理，与具体项目无关） |
| 配置存储位置 | **服务端 JSON 文件** `server/config/providers.json`，加入 `.gitignore` |
| 配置入口 UI | **设置对话框**（全局 `v-app-bar` 齿轮按钮，所有页面可进） |
| 生效方式 | **动态生效**：按请求实时读取配置 + 每次按当前配置创建 client，无需重启 |
| 环境变量兜底 | **保留**：文件值 > 环境变量（字段 `envVar`）> 默认值 |
| 敏感字段处理 | **掩码回显**：GET 时 secret 字段脱敏为 `'__set__'`；保存时空串 = 保留原值 |
| 抽象方案 | **完整插件系统**（方案三）：目录自动发现 + configSchema 驱动 UI |
| 本次范围 | **仅基础设施**：provider 抽象 + 配置体系 + ComfyUI Bridge 改造；火山方舟后续接入 |
| 热加载边界 | 配置热加载 ✅；provider 代码运行时热替换 ❌（启动时自动发现 + 开发模式 tsx watch 自动重启） |

## 3. 总体架构

新增独立的 **Provider 插件层**（`server/src/providers/`），与工作流层（`server/src/workflows/`）平行。工作流声明自己用哪个 provider；引擎按请求解析 provider 配置、创建 client、注入上下文驱动完整生命周期。

```mermaid
flowchart TB
    subgraph FE[前端]
        SD[ProviderSettingsDialog<br/>configSchema 驱动表单]
    end
    subgraph API[服务端路由 workflow.ts]
        PR[/GET /api/providers · PUT /api/providers/:id/]
        CR[/POST /api/workflow/tasks/:id/cancel/]
    end
    subgraph Engine[工作流引擎 runTask]
        R1[wf.provider → getProviderConfig]
        R2[provider.createClient(config)]
        R3[ctx.provider = client]
        R4[wf.submit ctx → client.execute]
        R5[client.poll 轮询]
        R6[client.getOutput → 写入 assert/]
    end
    subgraph Plugins[providers/ 插件目录 · 启动自动发现]
        CB[comfyui-bridge<br/>configSchema + createClient]
        VA[volcengine-ark<br/>未来同模式接入]
    end
    FE --> API
    API -->|providers.json| Engine
    Engine --> Plugins
```

数据流：

1. 前端设置对话框 `GET /api/providers` 拉取所有 provider 的 schema 与当前配置（secret 已脱敏），按 schema 渲染表单；保存时 `PUT /api/providers/:id`。
2. 引擎 `runTask` 按工作流声明的 `provider` 实时读取配置，`createClient(config)` 创建传输客户端并注入 `ctx.provider`。
3. 工作流 `submit(ctx)` 内调用 `ctx.provider.execute({ workflowId, params, files })` 提交任务。
4. 引擎用 `client.poll(remoteTaskId)` 轮询，完成后 `client.getOutput(remoteTaskId)` 得到输出下载请求（`WorkflowOutput`），沿用现有 download/fetch/body 三种写入逻辑落盘 `assert/`。

## 4. 核心类型（新增 `server/src/providers/types.ts`）

```ts
/** Provider 配置字段声明（驱动设置表单 + 校验 + 环境变量兜底） */
interface ProviderConfigField {
  key: string;                          // 配置键，如 baseUrl / password / apiKey
  label: string;                        // 中文标签
  type: 'string' | 'password' | 'number' | 'boolean' | 'select';
  required?: boolean;
  defaultValue?: string | number | boolean;
  placeholder?: string;
  secret?: boolean;                     // 敏感字段：GET 脱敏为 '__set__'，留空 = 不修改
  options?: { label: string; value: string }[];  // select 用
  description?: string;
  envVar?: string;                      // 环境变量兜底名，如 COMFYUI_BRIDGE_URL
}

/** 已解析的配置值（文件值 > envVar > defaultValue 合并后） */
type ResolvedProviderConfig = Record<string, string | number | boolean>;

/** Provider 插件定义：配置 schema + 客户端工厂 */
interface ProviderDefinition {
  id: string;                           // 'comfyui-bridge'
  name: string;                         // 中文显示名
  description?: string;
  configSchema: ProviderConfigField[];
  createClient(config: ResolvedProviderConfig): ProviderClient;
}

/** Provider 客户端：统一传输能力（工作流/引擎只依赖这 4 个方法） */
interface ProviderClient {
  execute(p: {
    workflowId: string;
    params?: Record<string, unknown>;
    files?: Record<string, File>;
  }): Promise<{ taskId: string }>;
  poll(taskId: string): Promise<{
    status: string;
    progress?: number;
    done: boolean;
    errorMessage?: string | null;
  }>;
  getOutput(taskId: string): Promise<WorkflowOutput | null>;
  cancel(taskId: string): Promise<void>;
}

/** 工作流输出规格（从 workflows/types 移入，由 provider 的 getOutput 返回） */
type WorkflowOutput =
  | { type: 'download'; url: string; filename: string }
  | { type: 'fetch'; request: { url: string; method: string; headers?: Record<string, string> }; filename: string }
  | { type: 'body'; contentType: string; data: string; filename: string };
```

关键点：

- `execute` 的 `{ workflowId, params, files }` 形状恰好对应当前 `ComfyuiBridgeExecuteParams`，证明通用传输抽象是自然的——每个 provider 自行解释这三者。
- **传输职责完全归 provider**：`WorkflowDefinition` 移除 `poll` / `parseOutput`（只保留 `submit(ctx)`）；`WorkflowRunContext` 新增 `provider: ProviderClient`（引擎注入）。
- `WorkflowOutput` 类型移到 provider 层（`workflows/types.ts` 再导出，避免 provider → workflow 依赖方向）。
- 现有 submit 辅助函数（`submitTextToImage` / `submitImageEdit` / `submitImageToVideo` / `submitLtxDirectorImageToVideo` / `submitReferenceVideo` / `submitMinimaxH3Fl2v`）保留，但改为**接收 client 作参数**（`submitXxx(client, params)`），工作流 submit 里传入 `ctx.provider`。

## 5. 配置存储（新增 `server/src/providers/config-store.ts`）

- **文件**：`server/config/providers.json`（加入 `.gitignore`，API Key 不入 git）。
- **结构**：按 provider id 分组：

  ```json
  {
    "comfyui-bridge": {
      "baseUrl": "http://localhost:10721",
      "password": "0d000721"
    }
  }
  ```

- **解析优先级**：文件值 > 环境变量（字段 `envVar`）> 字段 `defaultValue`。
- **读写**：
  - `getProviderConfig(id): Promise<ResolvedProviderConfig>` — 每次请求**实时读取文件**（不做进程级缓存，保证配置热加载），合并环境变量兜底后返回。
  - `setProviderConfig(id, values): Promise<void>` — 按 `configSchema` 校验（未知键丢弃、类型强转、必填检查）；**secret 字段传空串 = 保留原值**；原子写入（临时文件 + rename）。
- **脱敏**：`getProviderConfigMasked(id)` 返回给前端时，secret 字段有值 → 返回 `'__set__'` 占位符，前端显示「已设置」。

## 6. 后端 API（`server/src/routes/workflow.ts` 新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/providers` | 返回所有已注册 provider：`{ providers: [{ id, name, description, configSchema, config }] }`，config 已脱敏 |
| PUT | `/api/providers/:id` | 保存配置，body `{ config: { key: value } }`；校验 + 落盘；secret 空串保留原值 |

> 连接测试 `POST /api/providers/:id/test` 本期不做（后续可加）。

## 7. 前端设置对话框（新增 `frontend/src/components/ProviderSettingsDialog.vue`）

- **入口**：`App.vue` 全局 `v-app-bar` 右侧加**齿轮按钮**（`mdi-cog`）。全局配置放全局顶栏，项目选择页 / 项目视图均可进入。
- **表单完全由 configSchema 驱动**：
  - `string` → `v-text-field`
  - `password` → `v-text-field`（type=password + 显示/隐藏切换；占位符「已设置（留空保持不变）」）
  - `number` → `v-text-field`（type=number）
  - `boolean` → `v-switch`
  - `select` → `v-select`
- 每个 provider 一张卡片（标题 = provider 名 + 描述），底部「保存」按钮逐 provider 提交 `PUT /api/providers/:id`。
- 新增 `frontend/src/api/providers.ts`（axios 封装，对齐 `api/` 目录现有风格）。

## 8. 工作流层与引擎改造

### 8.1 工作流层

| 文件 | 改动 |
|---|---|
| `workflows/types.ts` | `WorkflowBaseDefinition` 加 `provider?: string`（默认 `'comfyui-bridge'`）；`WorkflowRunContext` 加 `provider: ProviderClient`；`WorkflowDefinition` 移除 `poll` / `parseOutput`；`WorkflowOutput` 改为从 `providers/types` re-export |
| `workflows/registry.ts` | `getAllWorkflows` 暴露 `provider` 字段 |
| `workflows/bridge-client.ts` | 传输函数（execute/poll/cancel/getOutput + token）迁往 `providers/comfyui-bridge/client.ts`；本文件保留工作流层内容：工厂改为通用 `createProviderWorkflow(providerId, { baseDefinition, submit })`（内部设置 `provider` 字段，不再预绑 poll/parseOutput）；submit 辅助函数（`submitTextToImage` 等）保留在本文件，改 `(client, params)` 签名 |
| 5 个工作流实现文件（text-to-image / image-edit / image-to-video ×2 / tts-voice-design） | `baseDefinition` 声明 `provider: 'comfyui-bridge'`；submit 内改用 `ctx.provider` |

### 8.2 引擎（`server/src/workflow-engine.ts`）

`runTask` 生命周期改为 provider 驱动：

1. **解析 provider**：`const providerId = wf.provider ?? 'comfyui-bridge'` → `getProvider(providerId)`（未注册则任务 failed）。
2. **解析配置 + 创建 client**：`getProviderConfig(providerId)` → `provider.createClient(config)`，注入 `ctx.provider`。
3. **submit**：`wf.submit(ctx)`（工作流内部用 `ctx.provider.execute(...)` 提交）。
4. **轮询**：`client.poll(remoteTaskId)` 循环（沿用现有无限轮询 + 中断兜底策略，不设轮询超时上限）。
5. **输出**：`client.getOutput(remoteTaskId)` 返回 `WorkflowOutput` → 引擎沿用现有 `download` / `fetch` / `body` 三种写入逻辑落盘 `assert/`。

其他改造点：

- **`generateVoice`（TTS 内联调用）**：`sceneDeps` 里目前直接 `submitComfyuiBridge` + `pollTask`，改为接收并调用 `ctx.provider`。
- **cancel 路由**（`routes/workflow.ts`）：`cancelBridgeTask` 直调 → `getProvider(providerId).createClient(config).cancel(remoteTaskId)`。provider 由任务记录反查：`getImpl(task.workflow_id, task.impl)?.provider ?? 'comfyui-bridge'`（任务表已存 workflow_id + impl，无需额外持久化 provider）。
- **`discoverWorkflows` 同款自动发现**：新增 `providers/index.ts` 的 `discoverProviders()`，扫描 `server/src/providers/*/index.ts`（跳过 test 文件），`server/src/index.ts` 启动时**先 discoverProviders 再 discoverWorkflows**。

## 9. 热加载边界

- **配置热加载 ✅**：按请求实时读文件 + 每次按当前配置 `createClient`，改配置（API 或手工编辑文件）无需重启，下个任务即生效。
- **Provider 代码热加载 ⚠️**：启动时目录自动发现保证「新增 provider 文件」在下次启动（开发模式 `tsx watch` 已自动重启，体验≈热加载）自动加载；运行中热替换 ESM 模块（清缓存 + 动态 import）技术可行但脆弱，**本期不做**。

## 10. 未来扩展：接入新 provider（如火山方舟）

新增 provider 的标准流程（本期基础设施就位后即满足）：

1. 新建 `server/src/providers/volcengine-ark/index.ts`（可含 `client.ts`），实现 `ProviderDefinition`：
   - `id: 'volcengine-ark'`、中文 `name`、`description`
   - `configSchema`：如 `{ key: 'apiKey', label: 'API Key', type: 'password', secret: true, required: true }`、`{ key: 'endpoint', ... }`、`{ key: 'model', type: 'select', options: [...] }`
   - `createClient(config)` 实现 `execute` / `poll` / `getOutput` / `cancel`（调用方舟 API，用 `config.apiKey` 做 Bearer 认证）
2. 无需修改引擎 / registry / 前端——`discoverProviders()` 自动加载，设置对话框自动按 schema 渲染表单。
3. 新增对应工作流实现（如 `workflows/image-edit/volcengine-ark.ts`），`baseDefinition` 声明 `provider: 'volcengine-ark'`，`submit(ctx)` 内调用 `ctx.provider.execute(...)`。

## 11. 测试策略

| 模块 | 用例 |
|---|---|
| `providers/config-store.test.ts` | 读写、校验（未知键 / 类型 / 必填）、secret 脱敏、secret 空串保留、环境变量兜底、原子写 |
| `providers/registry.test.ts` | register / get / getAllProviders / discover（跳过 test 文件） |
| `providers/comfyui-bridge/client.test.ts` | 迁移现有 `bridge-client.test.ts`（mock fetch，token 缓存按实例，配置注入生效） |
| 引擎 | provider 解析 + 生命周期（mock client） |
| 前端 | ProviderSettingsDialog 按 schema 渲染 + 保存（最小化） |

## 12. 文件清单

**新增：**

```
server/src/providers/
  types.ts                    # ProviderDefinition / ProviderClient / WorkflowOutput / ProviderConfigField
  registry.ts                 # registerProvider / getProvider / getAllProviders
  config-store.ts             # providers.json 读写 / 校验 / 脱敏 / 环境变量兜底
  index.ts                    # discoverProviders() 目录扫描
  comfyui-bridge/
    index.ts                  # registerProvider：configSchema（baseUrl + password，envVar 兜底）+ createClient
    client.ts                 # 从 bridge-client.ts 迁移：execute / poll / getOutput / cancel + 按实例 token 缓存
    client.test.ts            # 改造自 bridge-client.test.ts
  config-store.test.ts
  registry.test.ts
frontend/src/api/providers.ts
frontend/src/components/ProviderSettingsDialog.vue
```

**修改：**

```
server/src/workflows/types.ts
server/src/workflows/registry.ts
server/src/workflows/bridge-client.ts
server/src/workflows/text-to-image/default.ts
server/src/workflows/image-edit/default.ts
server/src/workflows/image-to-video/default.ts
server/src/workflows/image-to-video/minimax-h3-r2v.ts
server/src/workflows/tts-voice-design/default.ts
server/src/workflow-engine.ts
server/src/routes/workflow.ts
server/src/index.ts
frontend/src/App.vue
.gitignore                     # 追加 server/config/providers.json
```

## 13. 风险与注意

- **ESM/tsx 下目录扫描 import**：沿用 `discoverWorkflows` 的 `pathToFileURL` + 动态 `import()` 模式，跳过 `*.test.ts` / `*.spec.ts`。
- **token 缓存按 client 实例**：现有模块级 `authToken` 缓存改为 client 实例字段，避免配置变更后仍用旧 token；`ensureToken` 逻辑迁移到 client 内部。
- **`WorkflowDefinition` 接口变更影响面**：`poll` / `parseOutput` 删除会影响 `image-to-video/default.test.ts`（其 `vi.mock` 断言工厂形状）与 `bridge-client.test.ts`，需同步更新。
- **AGENTS.md 约束**：修改后必须 `npm run typecheck` + `npm run lint`；删除类操作需 `confirm` 弹窗。
