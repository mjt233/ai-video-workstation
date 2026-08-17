# 服务商多实例与工作流注册 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将服务商配置从「每类型单例」改造为「多实例」，支持连接测试、按实例查看/启用工作流、卡片网格 UI，并保持服务商类型可扩展。

**Architecture:** 引入「服务商实例」作为一等公民：`providers.json` 存实例数组；Provider 插件新增 `listWorkflows` / `testConnection` 能力；工作流注册表按实例注册（impl 带实例 id 前缀），引擎按 `providerInstanceId` 解析配置创建客户端；新增实例同步器驱动注册/注销。

**Tech Stack:** Express + TypeScript（后端）、Vue 3 + Vuetify 3 + TypeScript（前端）、vitest（测试）、`npm run typecheck` / `npm run lint` 验证。

**设计文档：** `docs/superpowers/specs/2026-08-17-provider-instances-design.md`

---

## 文件结构总览

**后端（server/src/）：**
- `providers/types.ts` — 修改：新增 `ProviderInstance`、`ProviderWorkflowEntry`，扩展 `ProviderDefinition`（`listWorkflows`/`testConnection`）
- `providers/config-store.ts` — 重构：实例数组 CRUD + 脱敏 + 迁移
- `providers/instance-sync.ts` — 新增：实例同步器（静态实例注册/注销）
- `providers/comfyui-bridge/index.ts` — 修改：实现 `listWorkflows`/`testConnection`
- `providers/volcengine-ark/index.ts` — 修改：实现 `listWorkflows`/`testConnection`
- `providers/minimax-h3/index.ts` — 修改：实现 `listWorkflows`/`testConnection`
- `workflows/registry.ts` — 修改：`providerInstanceId`/`providerName`、候选定义、按实例注销
- `workflows/bridge-sync.ts` — 重构：按实例同步
- `workflow-engine.ts` — 修改：按实例解析 provider
- `routes/workflow.ts` — 修改：新端点（实例 CRUD / test / workflows）

**前端（frontend/src/）：**
- `api/providers.ts` — 修改：新 API 方法
- `api/workflow.ts` — 修改：`WorkflowImplementation` 增加 `providerInstanceId`/`providerName`
- `components/ProviderSettingsDialog.vue` — 重构：卡片网格 + 新增/编辑对话框
- `components/ProviderInstanceDialog.vue` — 新增：新增/编辑实例对话框（含连接测试、工作流列表）
- `components/WorkflowParamsForm.vue` — 修改：Bridge 提供商按实例拉取
- `composables/useProviderNames.ts` — 修改：实例 id → 名称映射
- 各工作流下拉组件（`BatchGenerateDialog`/`ImageGenerateEditor`/`VideoGenerateEditor`）— 修改：v-chip 显示服务商名

---

## Phase 1：后端数据模型与存储

### Task 1: 扩展 Provider 类型定义

**Files:**
- Modify: `server/src/providers/types.ts`

- [ ] **Step 1: 写失败测试** — 新增 `server/src/providers/types.test.ts`，验证类型可被引用（编译期测试，用 `npm run typecheck` 验证）

- [ ] **Step 2: 运行验证失败**

Run: `npm run typecheck`
Expected: 失败（`ProviderInstance` / `ProviderWorkflowEntry` 未定义）

- [ ] **Step 3: 实现类型扩展**

在 `server/src/providers/types.ts` 末尾追加：

```ts
/** 服务商实例（多实例模型的核心抽象） */
export interface ProviderInstance {
  /** 自动生成的唯一 ID（uuid），用户不可改 */
  id: string;
  /** 服务商类型 id，如 volcengine-ark / comfyui-bridge / minimax-h3 */
  type: string;
  /** 用户手填的显示名，如「火山方舟-主账号」 */
  name: string;
  /** 该实例的配置参数（secret 字段保存时脱敏处理） */
  config: Record<string, string | number | boolean>;
  /** 启用的工作流键列表（默认全选）：静态为 `类型:实现`，Bridge 为 `ceb-{bridgeId}` */
  enabledWorkflows: string[];
}

/** 服务商实例可提供的工作流条目（listWorkflows 返回） */
export interface ProviderWorkflowEntry {
  /** 工作流键（不含实例 id）：静态为 `类型:实现`，Bridge 为 `ceb-{bridgeId}` */
  key: string;
  /** 显示名 */
  name: string;
  /** 工作流类型（text-to-image / image-edit / image-to-video / tts-*）；Bridge 可在同步时推导 */
  type?: string;
  /** 可选描述 */
  description?: string;
}
```

在 `ProviderDefinition` 接口中新增两个方法：

```ts
export interface ProviderDefinition {
  id: string;
  name: string;
  description?: string;
  configSchema: ProviderConfigField[];
  createClient(config: ResolvedProviderConfig): ProviderClient;
  /** 返回该实例可提供的工作流列表（Bridge 动态拉取 / 静态返回注册表候选） */
  listWorkflows(config: ResolvedProviderConfig): Promise<ProviderWorkflowEntry[]>;
  /** 连接测试：返回是否成功与提示信息（不抛 5xx，失败返回 ok:false） */
  testConnection(config: ResolvedProviderConfig): Promise<{ ok: boolean; message: string }>;
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm run typecheck`
Expected: 通过（此时插件实现尚未提供新方法，会报错 —— 若报错，先临时给三个插件加空实现占位，见 Task 3/4 前先加 `listWorkflows: async () => [], testConnection: async () => ({ ok: true, message: '' })` 占位）

- [ ] **Step 5: 提交**

```bash
git add server/src/providers/types.ts
git commit -m "feat: 扩展 Provider 类型定义支持多实例"
```

### Task 2: 重构 config-store 为实例数组

**Files:**
- Modify: `server/src/providers/config-store.ts`
- Test: `server/src/providers/config-store.test.ts`（重写）

- [ ] **Step 1: 写失败测试** — 重写 `config-store.test.ts`，覆盖：实例 CRUD、secret 脱敏、secret 空串保留原值、迁移旧格式、必填校验

```ts
import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createInstance, deleteInstance, getInstance, listInstances,
  migrateLegacyConfig, resolveInstanceConfig, updateInstance,
} from './config-store.js';
import { registerProvider } from './registry.js';
import type { ProviderDefinition } from './types.js';

const mkTestProvider = (id: string): ProviderDefinition => ({
  id,
  name: id,
  configSchema: [
    { key: 'url', label: '地址', type: 'string', required: true },
    { key: 'key', label: '密钥', type: 'password', secret: true },
    { key: 'timeout', label: '超时', type: 'number', defaultValue: 10 },
  ],
  createClient: () => ({ execute: async () => ({ taskId: 't' }), poll: async () => ({ status: 'done', done: true }), getOutput: async () => null, cancel: async () => {} }),
  listWorkflows: async () => [],
  testConnection: async () => ({ ok: true, message: 'ok' }),
});

let tmpDir: string;
let configPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'providers-'));
  configPath = path.join(tmpDir, 'providers.json');
  registerProvider(mkTestProvider('test-store'));
});

describe('config-store 实例 CRUD', () => {
  it('创建实例并读取', async () => {
    const inst = await createInstance({ type: 'test-store', name: '实例A', config: { url: 'http://a', key: 'secret' } }, configPath);
    expect(inst.id).toBeTruthy();
    expect(inst.enabledWorkflows).toEqual([]);
    const list = await listInstances(configPath);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('实例A');
  });

  it('secret 字段保存后读取脱敏为空串', async () => {
    const inst = await createInstance({ type: 'test-store', name: 'A', config: { url: 'http://a', key: 'secret' } }, configPath);
    const updated = await updateInstance(inst.id, { config: { url: 'http://b' } }, configPath);
    expect(updated.config.key).toBe(''); // secret 空串 = 保留原值
    const resolved = resolveInstanceConfig(updated);
    expect(resolved.key).toBe('secret'); // 解析时用原值
  });

  it('删除实例', async () => {
    const inst = await createInstance({ type: 'test-store', name: 'A', config: { url: 'http://a' } }, configPath);
    await deleteInstance(inst.id, configPath);
    expect(await getInstance(inst.id, configPath)).toBeUndefined();
  });

  it('必填字段缺失时报错', async () => {
    await expect(createInstance({ type: 'test-store', name: 'A', config: {} }, configPath)).rejects.toThrow('必填');
  });
});

describe('config-store 迁移', () => {
  it('旧格式（按类型一份）迁移为实例数组', async () => {
    const legacy = { 'test-store': { url: 'http://old', key: 'oldkey' } };
    await import('fs/promises').then((fs) => fs.writeFile(configPath, JSON.stringify(legacy), 'utf-8'));
    const migrated = await migrateLegacyConfig(configPath);
    expect(migrated).toBe(true);
    const list = await listInstances(configPath);
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('test-store');
    expect(list[0].name).toContain('默认');
    expect(list[0].config.url).toBe('http://old');
  });

  it('已是新格式则跳过', async () => {
    const inst = await createInstance({ type: 'test-store', name: 'A', config: { url: 'http://a' } }, configPath);
    const migrated = await migrateLegacyConfig(configPath);
    expect(migrated).toBe(false);
    expect(await listInstances(configPath)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run test -- --run server/src/providers/config-store.test.ts`
Expected: FAIL（函数不存在）

- [ ] **Step 3: 实现 config-store 重构**

重写 `server/src/providers/config-store.ts`：

```ts
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { getProvider } from './registry.js';
import type { ProviderConfigField, ProviderInstance, ResolvedProviderConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 配置文件路径：server/config/providers.json */
export const CONFIG_PATH = path.resolve(__dirname, '../../config/providers.json');

/** 敏感字段占位符（GET 脱敏返回，前端显示「已设置」） */
export const MASKED_SECRET = '__set__';

/** providers.json 文件结构：实例数组 */
interface ProvidersFile {
  instances: ProviderInstance[];
}

/** 判断是否为旧格式（按 provider 类型一份配置） */
function isLegacyFormat(parsed: unknown): parsed is Record<string, Record<string, string | number | boolean>> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return !('instances' in (parsed as object));
}

async function readConfigFile(configPath: string): Promise<ProvidersFile> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { instances: [] };
    throw e;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`配置文件解析失败（应为 JSON 对象）: ${configPath}`);
  }
  if (isLegacyFormat(parsed)) {
    // 旧格式：先迁移再返回（幂等）
    await migrateLegacyConfig(configPath);
    return readConfigFile(configPath);
  }
  const file = parsed as ProvidersFile;
  if (!Array.isArray(file.instances)) throw new Error(`配置文件缺少 instances 数组: ${configPath}`);
  return file;
}

async function writeConfigFile(configPath: string, file: ProvidersFile): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8');
  await fs.rename(tmp, configPath);
}

/** 取字段的环境变量兜底值 */
function envValue(field: ProviderConfigField): string | undefined {
  if (!field.envVar) return undefined;
  const v = process.env[field.envVar];
  return v !== undefined ? v : undefined;
}

/** 合并配置：文件值 > 环境变量 > 默认值 */
export function resolveProviderConfig(
  schema: ProviderConfigField[],
  fileValues: Record<string, string | number | boolean> | undefined,
): ResolvedProviderConfig {
  const out: ResolvedProviderConfig = {};
  for (const field of schema) {
    const fileVal = fileValues?.[field.key];
    const envVal = envValue(field);
    const val = fileVal ?? envVal ?? field.defaultValue;
    if (val === undefined) continue;
    out[field.key] = val;
  }
  return out;
}

/** 解析实例配置（文件值 > 环境变量 > 默认值） */
export function resolveInstanceConfig(instance: ProviderInstance): ResolvedProviderConfig {
  const provider = getProvider(instance.type);
  if (!provider) throw new Error(`Provider 未注册: ${instance.type}`);
  return resolveProviderConfig(provider.configSchema, instance.config);
}

/** 实例配置脱敏：secret 字段有值则置空串（不回显真实值） */
export function getInstanceConfigMasked(instance: ProviderInstance): ResolvedProviderConfig {
  const provider = getProvider(instance.type);
  if (!provider) throw new Error(`Provider 未注册: ${instance.type}`);
  const out: ResolvedProviderConfig = {};
  for (const field of provider.configSchema) {
    const val = instance.config[field.key];
    if (val === undefined) continue;
    out[field.key] = field.secret ? '' : val;
  }
  return out;
}

/** 校验并规范化配置值（类型强转 + secret 空串保留原值 + 必填校验） */
function normalizeConfig(
  providerId: string,
  values: Record<string, unknown>,
  current: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider 未注册: ${providerId}`);
  const out: Record<string, string | number | boolean> = { ...current };
  for (const field of provider.configSchema) {
    const raw = values[field.key];
    if (raw === undefined) continue;
    if (field.secret && (raw === '' || raw === MASKED_SECRET)) continue; // 保留原值
    if (raw === '') { delete out[field.key]; continue; }
    let parsed: string | number | boolean = String(raw);
    if (field.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`字段 ${field.label} 需要数字，收到: ${String(raw)}`);
      parsed = n;
    } else if (field.type === 'boolean') {
      parsed = raw === true || raw === 'true';
    }
    out[field.key] = parsed;
  }
  for (const field of provider.configSchema) {
    if (!field.required) continue;
    const has = out[field.key] !== undefined || envValue(field) !== undefined || field.defaultValue !== undefined;
    if (!has) throw new Error(`字段 ${field.label} 为必填项`);
  }
  return out;
}

/** 列出全部实例 */
export async function listInstances(configPath: string = CONFIG_PATH): Promise<ProviderInstance[]> {
  const file = await readConfigFile(configPath);
  return file.instances;
}

/** 按 id 获取实例 */
export async function getInstance(id: string, configPath: string = CONFIG_PATH): Promise<ProviderInstance | undefined> {
  const file = await readConfigFile(configPath);
  return file.instances.find((i) => i.id === id);
}

/** 创建实例（生成 uuid；enabledWorkflows 缺省为空数组，由调用方按「默认全选」填充） */
export async function createInstance(
  input: { type: string; name: string; config: Record<string, unknown>; enabledWorkflows?: string[] },
  configPath: string = CONFIG_PATH,
): Promise<ProviderInstance> {
  const provider = getProvider(input.type);
  if (!provider) throw new Error(`Provider 未注册: ${input.type}`);
  if (!input.name || !input.name.trim()) throw new Error('实例名称不能为空');
  const file = await readConfigFile(configPath);
  const instance: ProviderInstance = {
    id: randomUUID(),
    type: input.type,
    name: input.name.trim(),
    config: normalizeConfig(input.type, input.config, {}),
    enabledWorkflows: input.enabledWorkflows ?? [],
  };
  file.instances.push(instance);
  await writeConfigFile(configPath, file);
  return instance;
}

/** 更新实例（secret 空串 = 保留原值；name/config/enabledWorkflows 均可部分更新） */
export async function updateInstance(
  id: string,
  input: { name?: string; config?: Record<string, unknown>; enabledWorkflows?: string[] },
  configPath: string = CONFIG_PATH,
): Promise<ProviderInstance> {
  const file = await readConfigFile(configPath);
  const idx = file.instances.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error(`实例不存在: ${id}`);
  const inst = file.instances[idx];
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error('实例名称不能为空');
    inst.name = input.name.trim();
  }
  if (input.config !== undefined) {
    inst.config = normalizeConfig(inst.type, input.config, inst.config);
  }
  if (input.enabledWorkflows !== undefined) {
    inst.enabledWorkflows = input.enabledWorkflows;
  }
  file.instances[idx] = inst;
  await writeConfigFile(configPath, file);
  return inst;
}

/** 删除实例 */
export async function deleteInstance(id: string, configPath: string = CONFIG_PATH): Promise<void> {
  const file = await readConfigFile(configPath);
  const next = file.instances.filter((i) => i.id !== id);
  if (next.length === file.instances.length) throw new Error(`实例不存在: ${id}`);
  file.instances = next;
  await writeConfigFile(configPath, file);
}

/** 迁移旧格式（按类型一份配置）为实例数组；已是新格式返回 false */
export async function migrateLegacyConfig(configPath: string = CONFIG_PATH): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if ('instances' in (parsed as object)) return false; // 已是新格式
  const legacy = parsed as Record<string, Record<string, string | number | boolean>>;
  const instances: ProviderInstance[] = [];
  for (const [type, config] of Object.entries(legacy)) {
    const provider = getProvider(type);
    if (!provider) continue; // 未知类型跳过
    instances.push({
      id: randomUUID(),
      type,
      name: `${provider.name}-默认`,
      config,
      enabledWorkflows: [], // 默认全选由同步器按当前列表填充
    });
  }
  await writeConfigFile(configPath, { instances });
  return true;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm run test -- --run server/src/providers/config-store.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/providers/config-store.ts server/src/providers/config-store.test.ts
git commit -m "feat: 重构 config-store 支持服务商多实例"
```

---

## Phase 2：Provider 插件实现

### Task 3: comfyui-bridge 插件实现 listWorkflows / testConnection

**Files:**
- Modify: `server/src/providers/comfyui-bridge/index.ts`
- Modify: `server/src/providers/comfyui-bridge/client.ts`（如需新增 ping 方法）
- Test: `server/src/providers/comfyui-bridge/index.test.ts`（新增）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createComfyuiBridgeClient } from './client.js';

describe('comfyui-bridge 连接测试', () => {
  it('鉴权成功返回 ok:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 't' }) });
    vi.stubGlobal('fetch', fetchMock);
    const client = createComfyuiBridgeClient({ baseUrl: 'http://bridge', password: 'pwd' });
    const res = await client.testConnection();
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://bridge/api/auth/login', expect.anything());
    vi.unstubAllGlobals();
  });

  it('鉴权失败返回 ok:false 与错误信息', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad' });
    vi.stubGlobal('fetch', fetchMock);
    const client = createComfyuiBridgeClient({ baseUrl: 'http://bridge', password: 'pwd' });
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    expect(res.message).toContain('401');
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run test -- --run server/src/providers/comfyui-bridge/index.test.ts`
Expected: FAIL（`testConnection` 不存在）

- [ ] **Step 3: 实现**

在 `client.ts` 的 `ComfyuiBridgeClient` 接口与返回对象中新增 `testConnection`：

```ts
/** 连接测试：验证连通性 + 鉴权（登录成功即通过） */
async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    await ensureToken();
    return { ok: true, message: '连接成功，鉴权通过' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
```

在 `index.ts` 的 definition 中新增：

```ts
listWorkflows: async (config) => {
  const client = createComfyuiBridgeClient(config) as ComfyuiBridgeClient;
  const summaries = await client.listWorkflows();
  return summaries.map((s) => ({
    key: `ceb-${s.id}`,
    name: s.name || s.id,
    description: s.description,
  }));
},
testConnection: async (config) => {
  const client = createComfyuiBridgeClient(config) as ComfyuiBridgeClient;
  return client.testConnection();
},
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm run test -- --run server/src/providers/comfyui-bridge/index.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/providers/comfyui-bridge/
git commit -m "feat: comfyui-bridge 插件支持连接测试与工作流列表"
```

### Task 4: volcengine-ark / minimax-h3 插件实现 listWorkflows / testConnection

**Files:**
- Modify: `server/src/providers/volcengine-ark/index.ts`
- Modify: `server/src/providers/minimax-h3/index.ts`
- Test: `server/src/providers/volcengine-ark/index.test.ts`、`server/src/providers/minimax-h3/index.test.ts`（新增）

- [ ] **Step 1: 写失败测试**（以 volcengine-ark 为例）

```ts
import { describe, expect, it, vi } from 'vitest';
import { getCandidatesByProvider } from '../../workflows/registry.js';
import { createVolcengineArkClient } from './client.js';

vi.mock('../../workflows/registry.js', () => ({
  getCandidatesByProvider: vi.fn(() => [
    { type: 'text-to-image', impl: 'seedream', name: 'Seedream 文生图' },
    { type: 'image-edit', impl: 'seedream', name: 'Seedream 图片编辑' },
  ]),
}));

describe('volcengine-ark 连接测试', () => {
  it('地址可达返回 ok:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const client = createVolcengineArkClient({ baseUrl: 'http://ark' });
    const res = await client.testConnection();
    expect(res.ok).toBe(true);
    vi.unstubAllGlobals();
  });

  it('地址不可达返回 ok:false', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    const client = createVolcengineArkClient({ baseUrl: 'http://ark' });
    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run test -- --run server/src/providers/volcengine-ark/index.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

在 `client.ts` 中为 volcengine-ark / minimax-h3 各新增 `testConnection`（轻量 GET 基础地址，超时短）：

```ts
/** 连接测试：验证地址可达（暂不校验密钥，后续优化） */
async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(baseUrl, { method: 'GET', signal: ctrl.signal });
    clearTimeout(timer);
    return { ok: true, message: `地址可达（HTTP ${res.status}）` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
```

在 `index.ts` 的 definition 中新增：

```ts
listWorkflows: async () => {
  const candidates = getCandidatesByProvider('volcengine-ark');
  return candidates.map((c) => ({
    key: `${c.type}:${c.impl}`,
    name: c.name,
    type: c.type,
    description: c.description,
  }));
},
testConnection: async (config) => {
  const client = createVolcengineArkClient(config);
  return client.testConnection();
},
```

minimax-h3 同理（`getCandidatesByProvider('minimax-h3')`）。

- [ ] **Step 4: 运行测试验证通过**

Run: `npm run test -- --run server/src/providers/volcengine-ark/index.test.ts server/src/providers/minimax-h3/index.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/providers/volcengine-ark/ server/src/providers/minimax-h3/
git commit -m "feat: 静态服务商插件支持连接测试与工作流列表"
```

---

## Phase 3：工作流注册表与实例同步

### Task 5: 注册表改造（候选定义 + 实例字段 + 按实例注销）

**Files:**
- Modify: `server/src/workflows/registry.ts`
- Modify: `server/src/workflows/types.ts`
- Test: `server/src/workflows/registry.test.ts`（扩展）

- [ ] **Step 1: 写失败测试** — 扩展 `registry.test.ts`

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { getAllWorkflows, getCandidatesByProvider, getImplementations, register, registerOrReplace, unregisterByInstance } from './registry.js';
import type { WorkflowDefinition } from './types.js';

const mk = (type: string, impl: string, provider?: string, instanceId?: string): WorkflowDefinition =>
  ({ type, impl, name: impl, provider, providerInstanceId: instanceId, submit: async () => ({ taskId: 't' }) } as WorkflowDefinition);

beforeEach(() => {
  for (const t of ['test-reg', 'test-reg2']) {
    for (const w of getImplementations(t)) unregisterByInstance(w.providerInstanceId ?? '', new Set());
  }
});

describe('候选定义与实例定义', () => {
  it('无实例的注册为候选，不进入可执行列表', () => {
    register(mk('test-reg', 'seedream', 'volcengine-ark'));
    expect(getImplementations('test-reg')).toHaveLength(0);
    expect(getCandidatesByProvider('volcengine-ark')).toHaveLength(1);
  });

  it('带实例的注册进入可执行列表，impl 唯一', () => {
    register(mk('test-reg', 'seedream-inst-1', 'volcengine-ark', 'inst-1'));
    register(mk('test-reg', 'seedream-inst-2', 'volcengine-ark', 'inst-2'));
    const impls = getImplementations('test-reg');
    expect(impls).toHaveLength(2);
    expect(new Set(impls.map((i) => i.impl)).size).toBe(2);
  });

  it('registerOrReplace 替换同 impl 不重复', () => {
    registerOrReplace(mk('test-reg', 'seedream-inst-1', 'volcengine-ark', 'inst-1'));
    registerOrReplace(mk('test-reg', 'seedream-inst-1', 'volcengine-ark', 'inst-1'));
    expect(getImplementations('test-reg')).toHaveLength(1);
  });

  it('unregisterByInstance 注销该实例全部工作流', () => {
    register(mk('test-reg', 'seedream-inst-1', 'volcengine-ark', 'inst-1'));
    register(mk('test-reg2', 'other-inst-1', 'volcengine-ark', 'inst-1'));
    register(mk('test-reg', 'seedream-inst-2', 'volcengine-ark', 'inst-2'));
    unregisterByInstance('inst-1', new Set());
    expect(getImplementations('test-reg')).toHaveLength(1);
    expect(getImplementations('test-reg')[0].impl).toBe('seedream-inst-2');
  });

  it('getAllWorkflows 仅返回可执行定义并携带 providerName', () => {
    register(mk('test-reg', 'seedream-inst-1', 'volcengine-ark', 'inst-1'));
    register(mk('test-reg', 'seedream', 'volcengine-ark'));
    const all = getAllWorkflows();
    const impls = all.find((t) => t.type === 'test-reg')!.implementations;
    expect(impls).toHaveLength(1);
    expect(impls[0].providerInstanceId).toBe('inst-1');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run test -- --run server/src/workflows/registry.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

在 `types.ts` 的 `WorkflowBaseDefinition` 中新增字段：

```ts
  /** 该实现使用的 Provider 插件 ID（静态工作流声明类型，供 listWorkflows 枚举） */
  provider?: string;
  /** 服务商实例 ID（实例同步器注册可执行副本时填充；无此字段 = 候选定义，不可执行） */
  providerInstanceId?: string;
  /** 服务商实例显示名（实例同步器注册时填充，供前端下拉展示） */
  providerName?: string;
```

重写 `registry.ts`：

```ts
import type { WorkflowCapabilities, WorkflowDefinition, WorkflowUserParamDeclaration, WorkflowVarsBase } from './types.js';

/** 注册表：工作流类型 → 该类型下的实现列表 */
const registry = new Map<string, WorkflowDefinition[]>();

/** 判断是否为可执行定义（已绑定实例） */
function isRunnable(w: WorkflowDefinition): boolean {
  return !!w.providerInstanceId;
}

export function register<TVars extends WorkflowVarsBase>(w: WorkflowDefinition<TVars>): void {
  const list = registry.get(w.type) ?? [];
  list.push(w as WorkflowDefinition);
  registry.set(w.type, list);
}

/** 替换语义注册：同 (type, impl) 先注销再注册，保证不重复 */
export function registerOrReplace<TVars extends WorkflowVarsBase>(w: WorkflowDefinition<TVars>): void {
  unregister(w.type, w.impl);
  register(w);
}

/** 获取某类型下可执行实现（仅含已绑定实例的） */
export function getImplementations(type: string): WorkflowDefinition[] {
  return (registry.get(type) ?? []).filter(isRunnable);
}

/** 获取某类型下候选定义（未绑定实例，供 listWorkflows 枚举） */
export function getCandidatesByProvider(providerType: string): WorkflowDefinition[] {
  const out: WorkflowDefinition[] = [];
  for (const list of registry.values()) {
    for (const w of list) {
      if (!isRunnable(w) && w.provider === providerType) out.push(w);
    }
  }
  return out;
}

export function getImpl(type: string, impl: string): WorkflowDefinition | undefined {
  return (registry.get(type) ?? []).find((w) => w.impl === impl && isRunnable(w));
}

export function getAllWorkflowTypes(): string[] {
  return [...registry.keys()];
}

export function unregister(type: string, impl: string): void {
  const list = registry.get(type);
  if (!list) return;
  const next = list.filter((w) => w.impl !== impl);
  if (next.length === 0) registry.delete(type);
  else registry.set(type, next);
}

/** 注销某实例的全部可执行工作流（keepKeys 为需保留的工作流键集合，用于交集清理） */
export function unregisterByInstance(instanceId: string, keepKeys: Set<string>): void {
  for (const [type, list] of [...registry.entries()]) {
    const next = list.filter((w) => {
      if (w.providerInstanceId !== instanceId) return true;
      return keepKeys.has(w.workflowKey ?? '');
    });
    if (next.length === 0) registry.delete(type);
    else registry.set(type, next);
  }
}

export function getAllWorkflows(): {
  type: string;
  implementations: {
    impl: string;
    name: string;
    description?: string;
    provider?: string;
    providerInstanceId?: string;
    providerName?: string;
    params?: WorkflowUserParamDeclaration[];
    capabilities?: WorkflowCapabilities;
  }[];
}[] {
  return [...registry.entries()].map(([type, impls]) => ({
    type,
    implementations: impls.filter(isRunnable).map((w) => ({
      impl: w.impl,
      name: w.name,
      description: w.description,
      provider: w.provider,
      providerInstanceId: w.providerInstanceId,
      providerName: w.providerName,
      params: w.params,
      capabilities: w.capabilities,
    })),
  }));
}
```

> **设计决策：** `WorkflowBaseDefinition` 增加 `workflowKey?: string` 字段（实例同步器注册时写入，如 `text-to-image:seedream` 或 `ceb-{bridgeId}`）；`unregisterByInstance` 直接比对 `w.workflowKey`，避免从 impl 反推键的脆弱逻辑。

- [ ] **Step 4: 运行测试验证通过**

Run: `npm run test -- --run server/src/workflows/registry.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/workflows/registry.ts server/src/workflows/types.ts server/src/workflows/registry.test.ts
git commit -m "feat: 工作流注册表支持候选定义与实例绑定"
```

### Task 6: 实例同步器 instance-sync

**Files:**
- Create: `server/src/providers/instance-sync.ts`
- Test: `server/src/providers/instance-sync.test.ts`（新增）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { syncAllInstances, syncInstance } from './instance-sync.js';
import { getImplementations, getCandidatesByProvider, register, unregisterByInstance } from '../workflows/registry.js';
import type { WorkflowDefinition } from '../workflows/types.js';

vi.mock('./config-store.js', () => ({
  listInstances: vi.fn(async () => [
    { id: 'inst-1', type: 'volcengine-ark', name: '方舟A', config: {}, enabledWorkflows: ['text-to-image:seedream'] },
    { id: 'inst-2', type: 'volcengine-ark', name: '方舟B', config: {}, enabledWorkflows: [] },
  ]),
  resolveInstanceConfig: vi.fn(() => ({})),
}));

vi.mock('./registry.js', () => ({
  getProvider: vi.fn(() => ({ id: 'volcengine-ark', createClient: () => ({}), listWorkflows: async () => [], testConnection: async () => ({ ok: true, message: '' }) })),
}));

const mkCandidate = (type: string, impl: string): WorkflowDefinition =>
  ({ type, impl, name: impl, provider: 'volcengine-ark', submit: async () => ({ taskId: 't' }) } as WorkflowDefinition);

beforeEach(() => {
  register(mkCandidate('text-to-image', 'seedream'));
  register(mkCandidate('image-edit', 'seedream'));
});

describe('instance-sync', () => {
  it('按 enabledWorkflows 注册实例工作流，impl 带实例前缀', async () => {
    await syncAllInstances();
    const impls = getImplementations('text-to-image');
    expect(impls).toHaveLength(1);
    expect(impls[0].impl).toBe('seedream-inst-1');
    expect(impls[0].providerInstanceId).toBe('inst-1');
    expect(impls[0].providerName).toBe('方舟A');
  });

  it('未启用的工作流不注册', async () => {
    await syncAllInstances();
    expect(getImplementations('image-edit')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run test -- --run server/src/providers/instance-sync.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

创建 `server/src/providers/instance-sync.ts`：

```ts
import { listInstances, resolveInstanceConfig } from './config-store.js';
import { getProvider } from './registry.js';
import { getCandidatesByProvider, registerOrReplace, unregisterByInstance } from '../workflows/registry.js';
import type { ProviderInstance } from './types.js';

/** 并发同步串行化：重叠调用共享同一 promise */
let inflight: Promise<void> | null = null;

/** 同步单个静态实例的工作流（Bridge 实例由 bridge-sync 处理） */
export async function syncStaticInstance(instance: ProviderInstance): Promise<void> {
  const providerDef = getProvider(instance.type);
  if (!providerDef) return;
  const candidates = getCandidatesByProvider(instance.type);
  const enabled = new Set(instance.enabledWorkflows);
  const keepKeys = new Set<string>();
  for (const cand of candidates) {
    const key = `${cand.type}:${cand.impl}`;
    if (!enabled.has(key)) continue;
    const impl = `${cand.impl}-${instance.id}`;
    registerOrReplace({
      ...cand,
      impl,
      providerInstanceId: instance.id,
      providerName: instance.name,
      workflowKey: key,
    });
    keepKeys.add(key);
  }
  unregisterByInstance(instance.id, keepKeys);
}

/** 同步单个实例（按类型分发：Bridge 走 bridge-sync，其余走静态同步） */
export async function syncInstance(instance: ProviderInstance): Promise<void> {
  if (instance.type === 'comfyui-bridge') {
    const { syncBridgeInstance } = await import('../workflows/bridge-sync.js');
    await syncBridgeInstance(instance);
  } else {
    await syncStaticInstance(instance);
  }
}

/** 同步全部实例（启动时 + 实例增删改后调用；并发安全） */
export function syncAllInstances(): Promise<void> {
  if (!inflight) {
    inflight = (async () => {
      const instances = await listInstances();
      for (const inst of instances) {
        try {
          await syncInstance(inst);
        } catch (e) {
          console.error(`[instance-sync] 实例 ${inst.name} 同步失败: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    })().finally(() => { inflight = null; });
  }
  return inflight;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm run test -- --run server/src/providers/instance-sync.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/providers/instance-sync.ts server/src/providers/instance-sync.test.ts
git commit -m "feat: 新增实例同步器"
```

### Task 7: bridge-sync 改造为按实例

**Files:**
- Modify: `server/src/workflows/bridge-sync.ts`
- Test: `server/src/workflows/bridge-sync.test.ts`（重写）

- [ ] **Step 1: 写失败测试** — 重写 `bridge-sync.test.ts`，验证 `syncBridgeInstance(instance)` 按实例注册 `ceb-{instanceId}-{bridgeId}`、按 enabledWorkflows 过滤、清理陈旧

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run test -- --run server/src/workflows/bridge-sync.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

重构 `bridge-sync.ts`：

- 将 `syncBridgeWorkflows()` 改为 `syncBridgeInstance(instance: ProviderInstance)`，接收实例（含 config 已解析）。
- `doSync` 改为接收 `instance` + `config`，不再读全局 `getProviderConfig(PROVIDER_ID)`。
- `buildAndRegister` 增加 `instanceId`/`instanceName` 参数：`impl = ceb-{instanceId}-{bridgeId}`，`providerInstanceId = instanceId`，`providerName = instanceName`，`workflowKey = ceb-{bridgeId}`。
- 注册前检查 `instance.enabledWorkflows.includes(workflowKey)`，未启用则跳过。
- 清理：`unregisterByInstance(instance.id, keepKeys)`（keepKeys = 本次启用的 ceb- 键集合）。
- 保留容错：列表拉取失败保留既有注册。

- [ ] **Step 4: 运行测试验证通过**

Run: `npm run test -- --run server/src/workflows/bridge-sync.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/workflows/bridge-sync.ts server/src/workflows/bridge-sync.test.ts
git commit -m "refactor: bridge-sync 改为按实例同步"
```

### Task 8: 引擎按实例解析 provider

**Files:**
- Modify: `server/src/workflow-engine.ts`
- Test: `server/src/workflow-engine.test.ts`（如存在，扩展）

- [ ] **Step 1: 写失败测试** — 验证引擎按 `wf.providerInstanceId` 解析实例配置创建客户端；实例不存在时报错

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run test -- --run server/src/workflow-engine.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

在 `workflow-engine.ts` 的 provider 解析段（约 683 行）替换为：

```ts
// ── Provider 解析：工作流实例 → 实例配置 → client（按请求实时解析，配置热加载）──
const instanceId = wf.providerInstanceId;
if (!instanceId) {
  throw new Error(`工作流 ${task.workflow_id}/${task.impl} 未绑定服务商实例`);
}
const instance = await getInstance(instanceId);
if (!instance) {
  throw new Error(`工作流 ${task.workflow_id}/${task.impl} 绑定的服务商实例不存在: ${instanceId}`);
}
const providerDef = getProvider(instance.type);
if (!providerDef) {
  throw new Error(`服务商类型未注册: ${instance.type}`);
}
const provider = providerDef.createClient(resolveInstanceConfig(instance));
```

更新 import：`import { getInstance, resolveInstanceConfig } from './providers/config-store.js';`，移除 `getProviderConfig` 引用。

- [ ] **Step 4: 运行测试验证通过**

Run: `npm run test -- --run server/src/workflow-engine.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/workflow-engine.ts
git commit -m "feat: 引擎按服务商实例解析配置"
```

---

## Phase 4：API 端点

### Task 9: 实例 CRUD / test / workflows 路由

**Files:**
- Modify: `server/src/routes/workflow.ts`
- Test: `server/src/routes/workflow.test.ts`（扩展）

- [ ] **Step 1: 写失败测试** — 扩展 `workflow.test.ts`，覆盖：`GET /api/providers`（返回 types + instances）、`POST /api/providers/instances`、`PUT /api/providers/instances/:id`、`DELETE /api/providers/instances/:id`、`POST /api/providers/test`、`GET /api/providers/instances/:id/workflows`

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run test -- --run server/src/routes/workflow.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

替换 `routes/workflow.ts` 中旧的 `/providers` 相关端点：

```ts
// GET /api/providers — 服务商类型列表 + 实例列表（config 脱敏）
workflowRouter.get('/providers', async (_req, res) => {
  try {
    const types = getAllProviders().map((p) => ({
      id: p.id, name: p.name, description: p.description, configSchema: p.configSchema,
    }));
    const instances = await listInstances();
    const instanceInfos = await Promise.all(instances.map(async (inst) => ({
      id: inst.id, type: inst.type, name: inst.name,
      config: getInstanceConfigMasked(inst), enabledWorkflows: inst.enabledWorkflows,
    })));
    res.json({ types, instances: instanceInfos });
  } catch (e) {
    res.status(500).json({ error: `读取服务商配置失败: ${msg(e)}` });
  }
});

// POST /api/providers/instances — 新增实例
workflowRouter.post('/providers/instances', async (req, res) => {
  const { type, name, config, enabledWorkflows } = req.body as { type?: string; name?: string; config?: Record<string, unknown>; enabledWorkflows?: string[] };
  if (!type || !name || !config || typeof config !== 'object') {
    res.status(400).json({ error: 'Missing body: type/name/config' });
    return;
  }
  try {
    const instance = await createInstance({ type, name, config, enabledWorkflows });
    await syncInstance(instance);
    res.json({ instance: { ...instance, config: getInstanceConfigMasked(instance) } });
  } catch (e) {
    res.status(400).json({ error: msg(e) });
  }
});

// PUT /api/providers/instances/:id — 更新实例
workflowRouter.put('/providers/instances/:id', async (req, res) => {
  const id = req.params.id as string;
  const { name, config, enabledWorkflows } = req.body as { name?: string; config?: Record<string, unknown>; enabledWorkflows?: string[] };
  try {
    const instance = await updateInstance(id, { name, config, enabledWorkflows });
    await syncInstance(instance);
    res.json({ instance: { ...instance, config: getInstanceConfigMasked(instance) } });
  } catch (e) {
    res.status(400).json({ error: msg(e) });
  }
});

// DELETE /api/providers/instances/:id — 删除实例
workflowRouter.delete('/providers/instances/:id', async (req, res) => {
  const id = req.params.id as string;
  try {
    await deleteInstance(id);
    unregisterByInstance(id, new Set());
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: msg(e) });
  }
});

// POST /api/providers/test — 连接测试（用当前表单参数，不落盘）
workflowRouter.post('/providers/test', async (req, res) => {
  const { type, config } = req.body as { type?: string; config?: Record<string, unknown> };
  if (!type || !config || typeof config !== 'object') {
    res.status(400).json({ error: 'Missing body: type/config' });
    return;
  }
  try {
    const providerDef = getProvider(type);
    if (!providerDef) throw new Error(`服务商类型未注册: ${type}`);
    const resolved = resolveProviderConfig(providerDef.configSchema, config);
    const result = await providerDef.testConnection(resolved);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: msg(e) });
  }
});

// GET /api/providers/instances/:id/workflows — 该实例当前工作流列表
workflowRouter.get('/providers/instances/:id/workflows', async (req, res) => {
  const id = req.params.id as string;
  try {
    const instance = await getInstance(id);
    if (!instance) { res.status(404).json({ error: `实例不存在: ${id}` }); return; }
    const providerDef = getProvider(instance.type);
    if (!providerDef) throw new Error(`服务商类型未注册: ${instance.type}`);
    const workflows = await providerDef.listWorkflows(resolveInstanceConfig(instance));
    res.json({ workflows });
  } catch (e) {
    res.status(502).json({ error: `获取工作流列表失败: ${msg(e)}` });
  }
});
```

> 注：`GET /api/comfyui-bridge/providers` 端点需增加 `?instanceId=` 参数，按实例解析 Bridge 配置后拉取 Bridge 侧实例列表（供多 Bridge 实例场景使用）。

- [ ] **Step 4: 运行测试验证通过**

Run: `npm run test -- --run server/src/routes/workflow.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/routes/workflow.ts server/src/routes/workflow.test.ts
git commit -m "feat: 服务商实例 CRUD 与连接测试 API"
```

---

## Phase 5：前端

### Task 10: 前端 API 层

**Files:**
- Modify: `frontend/src/api/providers.ts`
- Modify: `frontend/src/api/workflow.ts`
- Modify: `frontend/src/composables/useProviderNames.ts`

- [ ] **Step 1: 更新 `api/providers.ts`**

```ts
/** 服务商类型信息（GET /api/providers 返回） */
export interface ProviderTypeInfo {
  id: string
  name: string
  description?: string
  configSchema: ProviderConfigField[]
}

/** 服务商实例信息（GET /api/providers 返回；config 已脱敏） */
export interface ProviderInstanceInfo {
  id: string
  type: string
  name: string
  config: Record<string, string | number | boolean>
  enabledWorkflows: string[]
}

/** GET /api/providers — 服务商类型 + 实例列表 */
export async function getProviders(): Promise<{ types: ProviderTypeInfo[]; instances: ProviderInstanceInfo[] }> {
  const { data } = await client.get<{ types: ProviderTypeInfo[]; instances: ProviderInstanceInfo[] }>('/providers')
  return data
}

/** POST /api/providers/instances — 新增实例 */
export async function createProviderInstance(input: {
  type: string; name: string; config: Record<string, unknown>; enabledWorkflows?: string[]
}): Promise<ProviderInstanceInfo> {
  const { data } = await client.post<{ instance: ProviderInstanceInfo }>('/providers/instances', input)
  return data.instance
}

/** PUT /api/providers/instances/:id — 更新实例 */
export async function updateProviderInstance(id: string, input: {
  name?: string; config?: Record<string, unknown>; enabledWorkflows?: string[]
}): Promise<ProviderInstanceInfo> {
  const { data } = await client.put<{ instance: ProviderInstanceInfo }>(`/providers/instances/${id}`, input)
  return data.instance
}

/** DELETE /api/providers/instances/:id — 删除实例 */
export async function deleteProviderInstance(id: string): Promise<{ success: boolean }> {
  const { data } = await client.delete<{ success: boolean }>(`/providers/instances/${id}`)
  return data
}

/** POST /api/providers/test — 连接测试（不落盘） */
export async function testProviderConnection(type: string, config: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  const { data } = await client.post<{ ok: boolean; message: string }>('/providers/test', { type, config })
  return data
}

/** GET /api/providers/instances/:id/workflows — 实例工作流列表 */
export async function getInstanceWorkflows(id: string): Promise<ProviderWorkflowEntry[]> {
  const { data } = await client.get<{ workflows: ProviderWorkflowEntry[] }>(`/providers/instances/${id}/workflows`)
  return data.workflows
}

/** 实例工作流条目 */
export interface ProviderWorkflowEntry {
  key: string
  name: string
  type?: string
  description?: string
}

/** GET /api/comfyui-bridge/providers?instanceId= — 按实例拉取 Bridge 侧提供商列表 */
export async function getComfyuiBridgeProviders(instanceId?: string): Promise<ComfyuiBridgeProviderInfo[]> {
  const { data } = await client.get<{ providers: ComfyuiBridgeProviderInfo[] }>('/comfyui-bridge/providers', {
    params: instanceId ? { instanceId } : undefined,
  })
  return data.providers
}
```

- [ ] **Step 2: 更新 `api/workflow.ts`** — `WorkflowImplementation` 增加字段：

```ts
export interface WorkflowImplementation {
  impl: string
  name: string
  description?: string
  /** 该实现使用的 Provider 插件 ID（如 comfyui-bridge） */
  provider?: string
  /** 服务商实例 ID（执行时引擎按此解析配置） */
  providerInstanceId?: string
  /** 服务商实例显示名（下拉 v-chip 展示） */
  providerName?: string
  params?: WorkflowUserParamDeclaration[]
  capabilities?: { ... }
}
```

- [ ] **Step 3: 更新 `useProviderNames.ts`** — 改为实例 id → 名称映射（从 `getProviders().instances` 构建）：

```ts
export function useProviderNames(): Ref<Map<string, string>> {
  if (!loaded) {
    loaded = true
    getProviders()
      .then(({ instances }) => {
        providerNameMap.value = new Map(instances.map((i) => [i.id, i.name]))
      })
      .catch(() => {})
  }
  return providerNameMap
}
```

- [ ] **Step 4: 运行验证**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/src/api/providers.ts frontend/src/api/workflow.ts frontend/src/composables/useProviderNames.ts
git commit -m "feat: 前端 API 层支持服务商实例"
```

### Task 11: 服务商配置页（卡片网格 + 新增/编辑对话框）

**Files:**
- Modify: `frontend/src/components/ProviderSettingsDialog.vue`
- Create: `frontend/src/components/ProviderInstanceDialog.vue`

- [ ] **Step 1: 重构 `ProviderSettingsDialog.vue`** — 布局改为：

```html
<v-card>
  <v-card-title class="d-flex align-center">
    <v-icon icon="mdi-cog" class="mr-2" /> 服务商配置
    <v-spacer />
    <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">新增服务商</v-btn>
    <v-btn icon="mdi-close" size="small" variant="text" @click="emit('update:modelValue', false)" />
  </v-card-title>
  <v-card-text>
    <v-alert v-if="error" type="error" class="mb-3" :text="error" closable @click:close="error=''" />
    <div v-if="loading" class="d-flex justify-center pa-6"><v-progress-circular indeterminate /></div>
    <v-row v-else>
      <v-col v-for="inst in instances" :key="inst.id" cols="12" sm="6" md="4">
        <v-card variant="outlined" class="h-100" @click="openEdit(inst)">
          <v-card-title class="text-subtitle-1 font-weight-bold">
            {{ inst.name }}
            <v-chip size="x-small" variant="tonal" class="ml-1">{{ typeName(inst.type) }}</v-chip>
          </v-card-title>
          <v-card-text class="text-caption text-medium-emphasis">
            {{ statusLabel(inst.id) }}
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click.stop="onDelete(inst)" />
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-card-text>
</v-card>
<ProviderInstanceDialog v-model="dialogOpen" :types="types" :instance="editing" @saved="load" />
```

- 删除用 `confirm` 工具函数（`../utils/confirm`），标题「删除服务商」、内容「确定删除服务商「{name}」？其提供的工作流将不可用。」、确认按钮「删除」、颜色 `error`。
- 状态徽标：内存态记录最近一次测试结果（`Map<instanceId, {ok, message}>`），未测试显示「未测试」。

- [ ] **Step 2: 创建 `ProviderInstanceDialog.vue`** — 新增/编辑共用：

```html
<v-dialog :model-value="modelValue" max-width="640" @update:model-value="emit('update:modelValue', $event)">
  <v-card>
    <v-card-title>{{ isEdit ? '编辑服务商' : '新增服务商' }}</v-card-title>
    <v-card-text>
      <!-- 新增时第一步：选类型 -->
      <v-select v-if="!isEdit" v-model="form.type" :items="types" item-title="name" item-value="id"
        label="服务商类型" variant="outlined" density="comfortable" @update:model-value="onTypeChange" />
      <!-- 参数表单（configSchema 驱动，复用现有渲染逻辑） -->
      <template v-for="f in schemaFields" :key="f.key">
        <v-switch v-if="f.type==='boolean'" v-model="form.config[f.key]" :label="f.label" :hint="f.description" persistent-hint color="primary" />
        <v-select v-else-if="f.type==='select'" v-model="form.config[f.key]" :items="f.options ?? []" item-title="label" item-value="value" :label="f.label" variant="outlined" density="comfortable" />
        <v-text-field v-else v-model="form.config[f.key]" :label="f.label" :type="f.type==='password' ? 'password' : f.type==='number' ? 'number' : 'text'"
          :hint="f.description" persistent-hint density="comfortable" variant="outlined" />
      </template>
      <!-- 连接测试 -->
      <v-btn color="secondary" variant="tonal" :loading="testing" @click="onTest">测试连接</v-btn>
      <v-alert v-if="testResult" :type="testResult.ok ? 'success' : 'error'" class="mt-2" :text="testResult.message" />
      <!-- 编辑时：工作流列表（默认全选） -->
      <template v-if="isEdit">
        <v-divider class="my-3" />
        <div class="text-body-medium mb-2 font-weight-medium">可用工作流</div>
        <v-checkbox v-for="wf in workflowEntries" :key="wf.key" v-model="form.enabledWorkflows" :value="wf.key"
          :label="wf.name" density="compact" hide-details />
      </template>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn variant="text" @click="emit('update:modelValue', false)">取消</v-btn>
      <v-btn color="primary" :loading="saving" @click="onSave">保存</v-btn>
    </v-card-actions>
  </v-card>
</v-dialog>
```

- 新增流程：选类型 → 渲染该类型 `configSchema` 表单 → 「测试连接」用当前表单值调 `testProviderConnection(type, config)` → 保存调 `createProviderInstance`（`enabledWorkflows` 缺省 = 全选，即保存后由后端同步器按当前列表填充）。
- 编辑流程：打开时拉 `getInstanceWorkflows(id)`（Bridge 实时 / 静态），与已保存 `enabledWorkflows` 合并：新增项默认勾选、消失项标记失效并从集合清理；保存调 `updateProviderInstance`。
- 表单初始值构建复用现有 `buildForm` 逻辑（secret 恒空串）。

- [ ] **Step 3: 运行验证**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/ProviderSettingsDialog.vue frontend/src/components/ProviderInstanceDialog.vue
git commit -m "feat: 服务商配置页卡片网格与新增/编辑对话框"
```

### Task 12: 工作流下拉 v-chip 服务商名 + Bridge 提供商按实例

**Files:**
- Modify: `frontend/src/components/BatchGenerateDialog.vue`
- Modify: `frontend/src/components/canvas/editors/ImageGenerateEditor.vue`
- Modify: `frontend/src/components/canvas/editors/VideoGenerateEditor.vue`
- Modify: `frontend/src/components/WorkflowParamsForm.vue`

- [ ] **Step 1: 更新各工作流下拉** — 将 `providerLabel(item)` 改为读取 `item.raw.providerName`（来自 `/api/workflows` 的 `providerInstanceId`/`providerName`），v-chip 展示 `providerName`：

```html
<template #item="{ item, props: itemProps }">
  <v-list-item v-bind="itemProps">
    <template #append>
      <v-chip v-if="item.raw.providerName" size="x-small" label variant="tonal" color="secondary" class="ml-1">
        {{ item.raw.providerName }}
      </v-chip>
    </template>
  </v-list-item>
</template>
```

- 移除对 `useProviderNames` 的依赖（下拉数据已含 `providerName`）。

- [ ] **Step 2: 更新 `WorkflowParamsForm.vue`** — `provider` prop 语义改为实例 id；`isBridgeProvider` 判断改为「该实例类型为 comfyui-bridge」；`loadComfyuiProviders` 调用 `getComfyuiBridgeProviders(instanceId)` 按实例拉取 Bridge 侧提供商。

- [ ] **Step 3: 运行验证**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/
git commit -m "feat: 工作流下拉展示服务商名并支持多 Bridge 实例"
```

---

## Phase 6：迁移与验证

### Task 13: 启动迁移接入

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: 实现** — 启动时调用迁移与同步：

```ts
import { migrateLegacyConfig } from './providers/config-store.js';
import { syncAllInstances } from './providers/instance-sync.js';

// 启动流程中（discoverProviders 之后）：
await migrateLegacyConfig();
await syncAllInstances();
```

- [ ] **Step 2: 运行验证**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add server/src/index.ts
git commit -m "feat: 启动时迁移旧配置并同步实例工作流"
```

### Task 14: 全量验证

- [ ] **Step 1: 运行全部测试**

Run: `npm run test`
Expected: 全部 PASS

- [ ] **Step 2: 类型检查与 lint**

Run: `npm run typecheck && npm run lint`
Expected: 无错误

- [ ] **Step 3: 手动冒烟** — 启动 `npm run dev`，验证：旧配置自动迁移为默认实例；新增两个火山方舟实例；连接测试；编辑对话框工作流列表默认全选；工作流下拉显示「工作流名 + 服务商名 v-chip」；执行任务按所选实例解析。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: 服务商多实例功能全量验证"
```

---

## 自检记录

- **Spec 覆盖**：多实例（Task 2/6/9）、连接测试（Task 3/4/9）、工作流列表与启用（Task 6/7/11）、卡片网格 UI（Task 11）、新增流程（Task 11）、类型可扩展（Task 1/3/4）、Bridge 动态工作流增减（Task 7/11）、迁移（Task 2/13）、v-chip 服务商名（Task 12）—— 全部有对应任务。
- **类型一致性**：`ProviderInstance`/`ProviderWorkflowEntry`/`providerInstanceId`/`providerName`/`workflowKey` 在各任务中命名一致。
- **占位符扫描**：无 TBD/TODO；前端组件给出结构代码与关键逻辑，完整实现按现有组件模式补齐。