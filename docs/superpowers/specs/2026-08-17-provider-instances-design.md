# 服务商多实例与工作流注册设计（2026-08-17）

## 1. 背景与目标

目前服务商配置是「每个类型一份配置」的单例模型：`providers.json` 以 provider id 为键，每个类型（comfyui-bridge / minimax-h3 / volcengine-ark）只能配置一份。工作流通过 `provider` 类型字段声明使用哪个服务商，引擎按类型读取单例配置创建客户端。

目标：

1. **多实例**：允许添加多个同类型服务商实例（如多个火山方舟配置，各自独立 API Key）。
2. **实例级能力**：配置服务商时支持连接测试、查看其提供的工作流列表、单独选择启用哪些工作流（默认全选）。
3. **UI 改造**：服务商配置页左上角「新增服务商」按钮，已添加服务商以卡片网格展示，点击卡片打开编辑对话框。
4. **新增流程**：新增时先选类型、按类型输入参数、支持以当前参数测试连接。
5. **可扩展**：服务商类型可后期灵活扩展（新增类型 = 新增插件目录，无需改动注册表/引擎/前端表单渲染）。

## 2. 已确认的关键决策

- **工作流↔实例**：多实例可同时启用；全局工作流列表 = 所有实例启用工作流的并集，每条标注所属服务商名；执行时用户手动选「哪个服务商的哪个工作流」。
- **工作流列表来源**：按类型区分 —— comfyui-bridge 动态从 Bridge 拉取；volcengine-ark / minimax-h3 静态列出代码注册的工作流。
- **迁移**：现有单例配置自动迁移为默认实例（`{类型名}-默认`，工作流全选）。
- **连接测试**：comfyui-bridge 验证连通性 + 鉴权；volcengine-ark / minimax-h3 暂时只验证地址可达（后续再优化）。
- **Bridge 动态工作流**：工作流列表可能随远程配置变动，编辑表单需处理新增/消失的工作流（新增默认勾选、消失清理并注销）。

## 3. 现有架构

- `server/src/providers/`：Provider 插件系统。`types.ts` 定义 `ProviderDefinition`（id/name/description/configSchema/createClient）与 `ProviderClient`（execute/poll/getOutput/cancel）；`registry.ts` 为 `Map<providerId, ProviderDefinition>`；`config-store.ts` 读写 `server/config/providers.json`（provider id → 配置键值，单例）；`index.ts` 自动发现子目录插件。
- `server/src/workflows/registry.ts`：`Map<workflowType, WorkflowDefinition[]>`；`WorkflowDefinition` 含 `provider` 类型字段；`bridge-sync.ts` 从 Bridge 动态注册 `ceb-{bridgeId}` 工作流。
- `workflow-engine.ts`：`wf.provider ?? 'comfyui-bridge'` → `getProvider` → `createClient(getProviderConfig(id))`。
- 前端 `ProviderSettingsDialog.vue`：垂直卡片内联表单，每类型一个保存按钮；`api/providers.ts` 提供 `getProviders` / `saveProviderConfig`。
- 现有端点：`GET /api/providers`、`PUT /api/providers/:id`、`GET /api/comfyui-bridge/providers`（Bridge 侧实例列表，保留）。

## 4. 设计

### 4.1 数据模型与存储

核心抽象：**服务商实例（Provider Instance）**。

```ts
interface ProviderInstance {
  id: string              // 自动生成的唯一 ID（uuid），用户不可改
  type: string            // 服务商类型 id，如 volcengine-ark / comfyui-bridge / minimax-h3
  name: string            // 用户手填的显示名，如「火山方舟-主账号」
  config: Record<string, string | number | boolean>  // 该实例的配置参数
  enabledWorkflows: string[]  // 启用的工作流键列表（默认全选）
}
```

存储结构（`server/config/providers.json` 从「按类型一份」改为「实例数组」）：

```json
{
  "instances": [
    {
      "id": "inst-abc123",
      "type": "volcengine-ark",
      "name": "火山方舟-主账号",
      "config": { "baseUrl": "...", "apiKey": "..." },
      "enabledWorkflows": ["text-to-image:seedream", "image-edit:seedream"]
    },
    {
      "id": "inst-def456",
      "type": "comfyui-bridge",
      "name": "本地Bridge",
      "config": { "baseUrl": "http://localhost:10721", "password": "..." },
      "enabledWorkflows": ["ceb-文生图工作流", "ceb-图生视频工作流"]
    }
  ]
}
```

要点：

- `enabledWorkflows` 存**工作流键**（不含实例 id 的基键）：静态服务商为 `类型:实现`（如 `text-to-image:seedream`），Bridge 为 `ceb-{bridge工作流id}`。注册时再拼上实例 id 生成唯一 impl。
- 敏感字段（apiKey/password）沿用现有脱敏规则：GET 回显空串，保存空串 = 保留原值。

### 4.2 Provider 插件扩展

在现有 `ProviderDefinition` 基础上新增两个能力，作为服务商类型的扩展点：

```ts
/** 服务商实例可提供的工作流条目 */
interface ProviderWorkflowEntry {
  key: string      // 工作流键（不含实例 id）：静态为 `类型:实现`，Bridge 为 `ceb-{bridgeId}`
  name: string     // 显示名
  type: string     // 工作流类型（text-to-image / image-edit / image-to-video / tts-*）
  description?: string
}

interface ProviderDefinition {
  id: string
  name: string
  description?: string
  configSchema: ProviderConfigField[]
  createClient(config: ResolvedProviderConfig): ProviderClient

  /** 返回该实例可提供的工作流列表 */
  listWorkflows(config: ResolvedProviderConfig): Promise<ProviderWorkflowEntry[]>

  /** 连接测试：返回是否成功与提示信息 */
  testConnection(config: ResolvedProviderConfig): Promise<{ ok: boolean; message: string }>
}
```

各类型实现：

| 类型 | `listWorkflows` | `testConnection` |
|------|----------------|------------------|
| `comfyui-bridge` | 实时从 Bridge 拉取工作流列表，映射为条目 | 验证连通性 + 鉴权（token 获取成功） |
| `volcengine-ark` | 查工作流注册表，返回 `provider === volcengine-ark` 的静态工作流 | 验证地址可达（暂不校验密钥） |
| `minimax-h3` | 同上，返回 `provider === minimax-h3` 的静态工作流 | 验证地址可达 |

扩展性：新增服务商类型 = 新建 `providers/{type}/` 目录，实现 `configSchema + createClient + listWorkflows + testConnection`，并在 `workflows/` 注册使用该类型的静态工作流。无需改动注册表、引擎或前端表单渲染逻辑（表单由 `configSchema` 驱动）。

### 4.3 工作流注册表与引擎解析

**注册表改造**（`server/src/workflows/registry.ts`）：

- `WorkflowDefinition` 新增字段 `providerInstanceId: string`（替代原 `provider` 类型字段的解析用途）。
- 静态工作流定义（seedream / minimax-h3）**保留** `provider` 类型字段，供 `listWorkflows` 按类型枚举；实例注册时再补充 `providerInstanceId`。
- 注册键 impl 需全局唯一，按实例生成：
  - 静态工作流：`{baseImpl}-{instanceId}`（如 `seedream-inst-abc123`）
  - Bridge 工作流：`ceb-{instanceId}-{bridgeId}`（如 `ceb-inst-abc123-文生图`）
- 注册/注销由「实例同步器」驱动：每个实例根据 `enabledWorkflows ∩ 当前列表` 注册其工作流，实例删除或工作流被禁用时注销。

**引擎解析**（`workflow-engine.ts`）：

```
工作流定义.providerInstanceId → 查实例 → 实例.type → ProviderDefinition → createClient(实例.config)
```

- 不再按 provider 类型读单例配置，改为按实例读配置。
- Bridge 的 `comfyuiProviderId`（Bridge 侧实例选择）保留，仍透传给 Bridge 执行接口。

**全局工作流列表**（`GET /api/workflows`）：

- 返回所有已注册工作流，每条携带 `providerInstanceId` + `providerName`（实例名）。
- 前端下拉据此渲染「工作流名 [服务商名]」。

**实例同步器**（新增 `server/src/providers/instance-sync.ts`）：

- 启动时 + 实例增删改后触发。
- 对每个实例：拉取 `listWorkflows` → 与 `enabledWorkflows` 求交集 → 注册/更新/注销对应工作流。
- Bridge 实例：拉取失败时保留既有注册不清空（沿用现有容错）。

**Bridge 动态工作流处理**：

- 编辑对话框打开时实时从 Bridge 拉取当前工作流列表，与已保存的 `enabledWorkflows` 合并展示：
  - 列表新增的工作流（不在 `enabledWorkflows`）→ 默认勾选（沿用「默认全选」），保存后自动加入启用集合。
  - 列表已消失的工作流（在 `enabledWorkflows` 但 Bridge 已不提供）→ 标记「已失效」并从启用集合清理，同时注销其注册。
- 后台同步（配置变更/启动）逻辑与编辑对话框一致：新增自动注册、消失自动注销、用户禁用的不注册。
- 静态服务商不受影响：工作流列表固定，无动态增减。

### 4.4 API 端点

**服务商实例 CRUD**（`server/src/routes/workflow.ts` 或拆分新路由）：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/providers` | 返回服务商类型列表（含 `configSchema`）+ 所有实例（config 脱敏、含 `enabledWorkflows`） |
| `POST` | `/api/providers/instances` | 新增实例（body: `{ type, name, config, enabledWorkflows }`），创建后触发同步 |
| `PUT` | `/api/providers/instances/:id` | 更新实例（secret 空串 = 保留原值），更新后触发同步 |
| `DELETE` | `/api/providers/instances/:id` | 删除实例，注销其全部工作流 |
| `POST` | `/api/providers/test` | 连接测试（body: `{ type, config }`，用当前表单参数，不落盘） |
| `GET` | `/api/providers/instances/:id/workflows` | 拉取该实例当前工作流列表（Bridge 实时 / 静态返回） |

**兼容性：**

- 旧 `PUT /api/providers/:id`（按类型保存单例配置）移除，前端同步改造。
- `GET /api/comfyui-bridge/providers`（Bridge 侧实例列表）保留，供 Bridge 工作流执行时选择 Bridge 侧实例。

**错误处理：**

- 实例不存在 → 404；参数校验失败 → 400（沿用现有错误码风格）。
- 连接测试失败 → 返回 `{ ok: false, message }`（HTTP 200，前端展示结果），不抛 5xx。
- Bridge 工作流列表拉取失败 → 502 + 错误信息（前端提示）。

### 4.5 前端 UI

**服务商配置页**（改造现有 `ProviderSettingsDialog.vue`，从齿轮图标打开）：

- **布局**：左上角「新增服务商」按钮；下方为卡片网格（`v-row`/`v-col` 响应式）。
- **卡片**：每张卡片显示实例名 + 类型名 + 连接状态徽标（基于最近一次连接测试结果，内存态不持久化，未测试过显示「未测试」）；点击卡片打开编辑对话框；卡片上提供删除按钮（删除需弹窗确认，沿用 `confirm` 工具函数，颜色 `error`）。
- **新增对话框**：第一步选服务商类型（下拉，展示类型名+描述）→ 第二步按 `configSchema` 渲染参数表单 → 底部「测试连接」按钮（用当前表单参数调用 `/api/providers/test`，展示结果）→ 保存。
- **编辑对话框**：参数表单 + 「测试连接」+ 工作流列表（复选框，默认全选；Bridge 实时拉取，新增项默认勾选、消失项标记失效并清理）。
- 表单渲染逻辑复用现有 `configSchema` 驱动方式（string/password/number/boolean/select）。

**工作流下拉（执行时选择）：**

- 现有各工作流下拉（`ImageGenerateEditor`、`VideoGenerateEditor`、`BatchGenerateDialog` 等）改为展示「工作流名 + 服务商名」，数据来自 `GET /api/workflows`（含 `providerName`）。
- 服务商名沿用现有 `v-chip` 组件展示在下拉选项右侧（复用 `BatchGenerateDialog` / `ImageGenerateEditor` 已有的 `v-slot:item` + `v-chip` 模式，`v-bind="itemProps"` 保留 title 与选中态）。
- 选中某条后，执行时携带该条对应的 `providerInstanceId`，引擎按实例解析。

### 4.6 迁移、错误处理与测试

**配置迁移**（启动时检测 `providers.json`）：

- 旧格式（按 provider 类型一份配置）→ 自动迁移为实例数组：每个有配置的类型生成一个默认实例（`name = {类型名}-默认`，`enabledWorkflows = 全选`），迁移后写回新格式。
- 迁移幂等：已是新格式则跳过。

**错误处理汇总：**

- 实例增删改：404（不存在）/ 400（校验失败）。
- 连接测试：`{ ok, message }` 返回，不抛 5xx。
- Bridge 工作流拉取失败：502 + 提示；同步失败保留既有注册不清空。
- 删除实例：弹窗确认（`confirm` 工具，`error` 色），确认后注销其全部工作流。

**测试：**

- 后端单测：`config-store`（实例 CRUD + 迁移 + 脱敏）、`instance-sync`（注册/注销/交集逻辑）、`registry`（impl 唯一性）、`workflow` 路由（新端点）。
- 前端单测：`api/providers` 新方法、卡片网格/对话框组件、工作流下拉渲染「工作流名 + 服务商名 v-chip」。
- 沿用现有 vitest 结构（`*.test.ts` 与被测文件同目录）。

**验证：** 修改后执行 `npm run typecheck` 和 `npm run lint`（项目 AGENTS.md 约束）。

## 5. 影响范围

- 服务端：`providers/types.ts`、`providers/config-store.ts`、`providers/registry.ts`、`providers/instance-sync.ts`（新增）、三个 provider 插件目录、`workflows/registry.ts`、`workflows/bridge-sync.ts`、`workflow-engine.ts`、`routes/workflow.ts`。
- 前端：`api/providers.ts`、`api/workflow.ts`、`ProviderSettingsDialog.vue`（改造）、新增/编辑对话框组件、各工作流下拉组件、`useProviderNames`、`comfyuiProviderOptions`。
- 配置：`server/config/providers.json` 结构变更（自动迁移）。