# 工作流 Provider 插件系统与参数配置 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 Provider 插件系统（`server/src/providers/`），工作流声明 provider、引擎按请求解析配置驱动传输层；新增 `server/config/providers.json` 配置存储与 `/api/providers` 接口，前端提供 configSchema 驱动的设置对话框。

**Architecture:** 新增 Provider 插件层（`ProviderDefinition` = configSchema + createClient → `ProviderClient` 提供 execute/poll/getOutput/cancel 四能力）。工作流 `WorkflowBaseDefinition` 增加 `provider` 字段、`WorkflowRunContext` 增加 `provider` 客户端；引擎 `runTask` 按请求读配置创建 client 并驱动完整生命周期（`WorkflowDefinition` 移除 poll/parseOutput）。配置存 `server/config/providers.json`（gitignored），文件值 > envVar > defaultValue，secret 字段脱敏为 `'__set__'`。前端 `ProviderSettingsDialog` 按 configSchema 渲染表单。

**Tech Stack:** Express + TypeScript（tsx）、Vue 3 + Vuetify 3、vitest（服务端 + 前端）、jsdom。

**工作区:** 本计划在 git worktree `c:\Users\xiaotao\code\ai-video-workstation\.worktrees\feat-provider-config`（分支 `feat-provider-config`，基于 `vuetify-upgrade`）中执行。**所有终端命令都从该目录运行**；当前主工作区有另一个 Agent 在修改，勿触碰。

**设计文档:** `docs/superpowers/specs/2026-08-06-provider-config-design.md`

---

## 文件结构

**新增（server）：**
- `server/src/providers/types.ts` — Provider 插件类型（ProviderConfigField / ProviderDefinition / ProviderClient / WorkflowOutput 等）
- `server/src/providers/registry.ts` — 注册表（registerProvider / getProvider / getAllProviders）
- `server/src/providers/config-store.ts` — providers.json 读写 / 校验 / 脱敏 / 环境变量兜底
- `server/src/providers/index.ts` — discoverProviders() 目录扫描
- `server/src/providers/comfyui-bridge/client.ts` — ComfyUI Bridge 传输客户端（从 bridge-client.ts 迁移）
- `server/src/providers/comfyui-bridge/index.ts` — provider 插件注册（configSchema + createClient）
- `server/src/providers/registry.test.ts`
- `server/src/providers/config-store.test.ts`
- `server/src/providers/discovery.test.ts`
- `server/src/providers/comfyui-bridge/client.test.ts`

**新增（frontend）：**
- `frontend/src/api/providers.ts`
- `frontend/src/components/ProviderSettingsDialog.vue`

**修改（server）：**
- `server/src/workflows/types.ts` — base 加 provider、ctx 加 provider、Definition 移除 poll/parseOutput、re-export WorkflowOutput
- `server/src/workflows/registry.ts` — getAllWorkflows 暴露 provider
- `server/src/workflows/bridge-client.ts` — 移除传输层；工厂改 createProviderWorkflow；submit 辅助函数首参为 client
- `server/src/workflows/image-to-video/default.ts`、`minimax-h3-r2v.ts` — 使用 createProviderWorkflow + ctx.provider
- `server/src/workflows/image-to-video/default.test.ts`、`minimax.test.ts`、`server/src/workflows/bridge-client.test.ts`
- `server/src/workflow-engine.ts` — runTask provider 驱动 + generateVoice 改 provider
- `server/src/routes/workflow.ts` — cancel 改 provider + 新增 /api/providers
- `server/src/index.ts` — 启动时 discoverProviders
- `.gitignore` — 追加 `server/config/providers.json*`

**修改（frontend）：**
- `frontend/src/App.vue` — 顶栏齿轮入口
- `frontend/src/api/workflow.ts` — WorkflowImplementation 加 provider 字段

**约定：** 提交信息用中文（PowerShell 用 UTF-8 临时文件 `[System.IO.File]::WriteAllText($f, msg, [System.Text.UTF8Encoding]::new($false))` 再 `git commit -F $f`）；`cd server && npx vitest run <file>` 跑单个测试文件；`npm run typecheck:server` / `npm run typecheck:frontend` / `npm run lint` 全量校验。

---

## Task 1: Provider 插件类型定义

**Files:**
- Create: `server/src/providers/types.ts`

- [ ] **Step 1: 创建 `server/src/providers/types.ts`**

```ts
/**
 * Provider 插件系统类型定义。
 *
 * Provider 是工作流的「传输层插件」：负责提交任务、轮询状态、获取输出、中断任务，
 * 并声明自己的配置 schema（configSchema）供设置界面渲染表单。
 * 工作流通过 baseDefinition.provider 声明使用哪个 provider；引擎按请求读取配置、
 * 创建 ProviderClient 并注入 WorkflowRunContext。
 */

/**
 * Provider 配置字段声明（驱动设置表单 + 校验 + 环境变量兜底）。
 */
export interface ProviderConfigField {
  /** 配置键，如 baseUrl / password / apiKey */
  key: string;
  /** 中文标签 */
  label: string;
  /** 字段类型（决定前端表单控件与后端类型强转） */
  type: 'string' | 'password' | 'number' | 'boolean' | 'select';
  /** 是否必填（文件值 / 环境变量 / 默认值均缺失时报错） */
  required?: boolean;
  /** 默认值（表单初始值；文件与环境变量均未提供时使用） */
  defaultValue?: string | number | boolean;
  /** 输入框占位文案 */
  placeholder?: string;
  /** 敏感字段：GET 返回时脱敏为 '__set__'；保存时空串 = 保留原值 */
  secret?: boolean;
  /** select 类型可选项 */
  options?: { label: string; value: string }[];
  /** 字段说明（表单 hint） */
  description?: string;
  /** 环境变量兜底名，如 COMFYUI_BRIDGE_URL；文件值优先 */
  envVar?: string;
}

/** 已解析的 Provider 配置值（文件值 > envVar > defaultValue 合并后） */
export type ResolvedProviderConfig = Record<string, string | number | boolean>;

/**
 * Provider 插件定义：配置 schema + 客户端工厂。
 */
export interface ProviderDefinition {
  /** Provider 唯一 ID，如 comfyui-bridge */
  id: string;
  /** 中文显示名 */
  name: string;
  /** 可选描述 */
  description?: string;
  /** 配置字段声明（设置界面据此渲染表单） */
  configSchema: ProviderConfigField[];
  /** 按已解析配置创建传输客户端（每次调用返回独立实例，token 缓存等按实例持有） */
  createClient(config: ResolvedProviderConfig): ProviderClient;
}

/**
 * Provider 客户端：统一传输能力（工作流/引擎只依赖这四个方法）。
 */
export interface ProviderClient {
  /**
   * 提交一个工作流执行。
   * @param p.workflowId 提供商侧的工作流标识（如 ComfyUI Bridge 的 workflowId）
   * @param p.params 工作流参数（键值对）
   * @param p.files 需要上传的文件（键为工作流参数的文件字段别名）
   * @returns 远端任务 ID
   */
  execute(p: {
    workflowId: string;
    params?: Record<string, unknown>;
    files?: Record<string, File>;
  }): Promise<{ taskId: string }>;

  /**
   * 轮询任务状态。
   * @param taskId 远端任务 ID
   * @returns 状态、进度与是否结束（completed / failed 视为 done）
   */
  poll(taskId: string): Promise<{
    status: string;
    progress?: number;
    done: boolean;
    errorMessage?: string | null;
  }>;

  /**
   * 获取任务输出规格（下载请求或 base64）。
   * @param taskId 远端任务 ID
   * @returns 输出规格；无输出文件时返回 null（引擎将报错）
   */
  getOutput(taskId: string): Promise<WorkflowOutput | null>;

  /** 中断任务（幂等即可；取消失败抛错由调用方处理） */
  cancel(taskId: string): Promise<void>;
}

/**
 * 工作流输出规格（由 provider 的 getOutput 返回）。
 *
 * 从 workflows/types.ts 移入本文件（传输职责归 provider）；workflows/types.ts 再导出。
 */
export type WorkflowOutput =
  | { type: 'download'; url: string; filename: string }
  | { type: 'fetch'; request: { url: string; method: string; headers?: Record<string, string> }; filename: string }
  | { type: 'body'; contentType: string; data: string; filename: string };
```

- [ ] **Step 2: 验证类型检查通过（纯新增，不改动现有代码）**

Run: `cd server && npx tsc --noEmit`
Expected: 0 错误（现有代码不受影响）

- [ ] **Step 3: 提交**

```bash
git add server/src/providers/types.ts
git commit -m "feat: Provider 插件系统类型定义（ProviderDefinition / ProviderClient / WorkflowOutput）"
```

---

## Task 2: Provider 注册表

**Files:**
- Create: `server/src/providers/registry.ts`
- Test: `server/src/providers/registry.test.ts`

- [ ] **Step 1: 先写失败测试 `server/src/providers/registry.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { getAllProviders, getProvider, registerProvider } from './registry.js';
import type { ProviderDefinition } from './types.js';

/** 构造测试用 provider 定义（configSchema 为空、createClient 抛错不会被调用） */
const mkProvider = (id: string): ProviderDefinition => ({
  id,
  name: `provider-${id}`,
  configSchema: [],
  createClient: () => {
    throw new Error('not used in registry test');
  },
});

describe('provider registry', () => {
  it('registerProvider 后 getProvider 可查到', () => {
    registerProvider(mkProvider('test-reg-a'));
    expect(getProvider('test-reg-a')).toBeDefined();
  });

  it('getAllProviders 返回全部已注册 provider', () => {
    registerProvider(mkProvider('test-reg-b'));
    const ids = getAllProviders().map((p) => p.id);
    expect(ids).toContain('test-reg-b');
    expect(ids).toContain('test-reg-a');
  });

  it('未注册的 provider 返回 undefined', () => {
    expect(getProvider('no-such-provider')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/providers/registry.test.ts`
Expected: FAIL（`./registry.js` 模块不存在 / 导出未定义）

- [ ] **Step 3: 实现 `server/src/providers/registry.ts`**

```ts
import type { ProviderDefinition } from './types.js';

/** 注册表：provider id → 插件定义 */
const registry = new Map<string, ProviderDefinition>();

/**
 * 注册一个 Provider 插件。
 * @param p Provider 插件定义
 */
export function registerProvider(p: ProviderDefinition): void {
  registry.set(p.id, p);
}

/**
 * 按 ID 获取 Provider 插件。
 * @param id provider id，如 comfyui-bridge
 * @returns 插件定义或 undefined
 */
export function getProvider(id: string): ProviderDefinition | undefined {
  return registry.get(id);
}

/** 获取全部已注册的 Provider 插件 */
export function getAllProviders(): ProviderDefinition[] {
  return [...registry.values()];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/providers/registry.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add server/src/providers/registry.ts server/src/providers/registry.test.ts
git commit -m "feat: Provider 注册表（registerProvider / getProvider / getAllProviders）"
```

---

## Task 3: Provider 配置存储

**Files:**
- Create: `server/src/providers/config-store.ts`
- Test: `server/src/providers/config-store.test.ts`

- [ ] **Step 1: 先写失败测试 `server/src/providers/config-store.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  MASKED_SECRET,
  getProviderConfig,
  getProviderConfigMasked,
  resolveProviderConfig,
  setProviderConfig,
} from './config-store.js';
import { getProvider, registerProvider } from './registry.js';
import type { ProviderDefinition } from './types.js';

/**
 * 测试用 provider：覆盖 string（envVar 兜底）/ password(secret) / number / boolean 四类字段。
 */
const mkTestProvider = (id: string): ProviderDefinition => ({
  id,
  name: `test-${id}`,
  configSchema: [
    { key: 'baseUrl', label: '服务地址', type: 'string', defaultValue: 'http://default:1', envVar: 'TEST_BRIDGE_URL' },
    { key: 'apiKey', label: 'API Key', type: 'password', secret: true },
    { key: 'retries', label: '重试次数', type: 'number', defaultValue: 3 },
    { key: 'flag', label: '开关', type: 'boolean', defaultValue: false },
  ],
  createClient: () => {
    throw new Error('not used in config-store test');
  },
});

describe('config-store', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'providers-'));
    configPath = path.join(tmpDir, 'providers.json');
    registerProvider(mkTestProvider('test-store'));
    delete process.env.TEST_BRIDGE_URL;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    delete process.env.TEST_BRIDGE_URL;
  });

  it('resolveProviderConfig 无文件无环境变量时合并 defaultValue', () => {
    const p = getProvider('test-store')!;
    expect(resolveProviderConfig(p.configSchema, undefined)).toEqual({
      baseUrl: 'http://default:1',
      retries: 3,
      flag: false,
    });
  });

  it('环境变量优先于 defaultValue', () => {
    process.env.TEST_BRIDGE_URL = 'http://env:2';
    const p = getProvider('test-store')!;
    expect(resolveProviderConfig(p.configSchema, undefined).baseUrl).toBe('http://env:2');
  });

  it('文件值优先于环境变量', () => {
    process.env.TEST_BRIDGE_URL = 'http://env:2';
    const p = getProvider('test-store')!;
    expect(resolveProviderConfig(p.configSchema, { baseUrl: 'http://file:3' }).baseUrl).toBe('http://file:3');
  });

  it('setProviderConfig 落盘并可读取（数字/布尔字符串强转）', async () => {
    await setProviderConfig('test-store', { baseUrl: 'http://file:3', retries: '5', flag: 'true' }, configPath);
    const config = await getProviderConfig('test-store', configPath);
    expect(config.baseUrl).toBe('http://file:3');
    expect(config.retries).toBe(5);
    expect(config.flag).toBe(true);
  });

  it('secret 字段在 getProviderConfigMasked 中脱敏为 MASKED_SECRET', async () => {
    await setProviderConfig('test-store', { apiKey: 'sk-secret' }, configPath);
    const masked = await getProviderConfigMasked('test-store', configPath);
    expect(masked.apiKey).toBe(MASKED_SECRET);
  });

  it('secret 传空串时保留原值', async () => {
    await setProviderConfig('test-store', { apiKey: 'sk-original' }, configPath);
    await setProviderConfig('test-store', { apiKey: '' }, configPath);
    const masked = await getProviderConfigMasked('test-store', configPath);
    expect(masked.apiKey).toBe(MASKED_SECRET);
  });

  it('未知键被忽略', async () => {
    await setProviderConfig('test-store', { unknownKey: 1, baseUrl: 'http://file:3' }, configPath);
    const config = await getProviderConfig('test-store', configPath);
    expect(config).not.toHaveProperty('unknownKey');
    expect(config.baseUrl).toBe('http://file:3');
  });

  it('number 字段非法值抛错', async () => {
    await expect(setProviderConfig('test-store', { retries: 'abc' }, configPath)).rejects.toThrow('需要数字');
  });

  it('必填字段缺失且无任何兜底时报错', async () => {
    // apiKey 无 defaultValue/envVar，标记为 required 后必须显式提供
    registerProvider({
      ...mkTestProvider('test-store-required'),
      configSchema: [
        { key: 'apiKey', label: 'API Key', type: 'password', secret: true, required: true },
      ],
    });
    await expect(
      setProviderConfig('test-store-required', { baseUrl: 'http://x' }, configPath),
    ).rejects.toThrow('必填');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/providers/config-store.test.ts`
Expected: FAIL（`./config-store.js` 模块不存在）

- [ ] **Step 3: 实现 `server/src/providers/config-store.ts`**

```ts
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getProvider } from './registry.js';
import type { ProviderConfigField, ResolvedProviderConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 配置文件路径：server/config/providers.json */
export const CONFIG_PATH = path.resolve(__dirname, '../../config/providers.json');

/** 敏感字段占位符（GET 脱敏返回，前端显示「已设置」） */
export const MASKED_SECRET = '__set__';

/** providers.json 文件结构：provider id → 配置键值 */
interface ProvidersFile {
  [providerId: string]: Record<string, string | number | boolean>;
}

/**
 * 读取配置文件；不存在/非法时返回空对象（不抛错）。
 * @param configPath 配置文件路径（测试可注入临时路径）
 */
async function readConfigFile(configPath: string): Promise<ProvidersFile> {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as ProvidersFile) : {};
  } catch {
    return {};
  }
}

/** 取字段的环境变量兜底值 */
function envValue(field: ProviderConfigField): string | undefined {
  if (!field.envVar) return undefined;
  const v = process.env[field.envVar];
  return v !== undefined ? v : undefined;
}

/**
 * 合并配置：文件值 > 环境变量 > 默认值。
 * @param schema provider 配置字段声明
 * @param fileValues 文件中的配置值（可为 undefined）
 * @returns 合并后的已解析配置
 */
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

/**
 * 读取 provider 的已解析配置（供引擎 createClient 使用）。
 * @param providerId provider id
 * @param configPath 配置文件路径（默认 CONFIG_PATH；测试可注入）
 */
export async function getProviderConfig(
  providerId: string,
  configPath: string = CONFIG_PATH,
): Promise<ResolvedProviderConfig> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider 未注册: ${providerId}`);
  const file = await readConfigFile(configPath);
  return resolveProviderConfig(provider.configSchema, file[providerId]);
}

/**
 * 读取 provider 配置用于前端展示：secret 字段有值则脱敏为 MASKED_SECRET；
 * 未在文件中配置的字段不返回（前端回退到 defaultValue 展示）。
 * @param providerId provider id
 * @param configPath 配置文件路径（默认 CONFIG_PATH；测试可注入）
 */
export async function getProviderConfigMasked(
  providerId: string,
  configPath: string = CONFIG_PATH,
): Promise<ResolvedProviderConfig> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider 未注册: ${providerId}`);
  const file = await readConfigFile(configPath);
  const fileValues = file[providerId] ?? {};
  const out: ResolvedProviderConfig = {};
  for (const field of provider.configSchema) {
    const val = fileValues[field.key];
    if (val === undefined) continue;
    out[field.key] = field.secret ? MASKED_SECRET : val;
  }
  return out;
}

/**
 * 校验并保存 provider 配置。
 * - 未知键忽略；类型强转（number/boolean）；
 * - secret 字段传空串 = 保留原值；非 secret 空串 = 删除该键；
 * - 必填字段在文件值 + 环境变量 + 默认值均缺失时报错；
 * - 原子写入（临时文件 + rename）。
 * @param providerId provider id
 * @param values 要保存的配置键值（只处理 configSchema 中声明的键）
 * @param configPath 配置文件路径（默认 CONFIG_PATH；测试可注入）
 */
export async function setProviderConfig(
  providerId: string,
  values: Record<string, unknown>,
  configPath: string = CONFIG_PATH,
): Promise<void> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider 未注册: ${providerId}`);

  const file = await readConfigFile(configPath);
  const current: Record<string, string | number | boolean> = { ...(file[providerId] ?? {}) };

  for (const field of provider.configSchema) {
    const raw = values[field.key];
    if (raw === undefined) continue;
    // secret 空串 = 保留原值
    if (field.secret && raw === '') continue;
    if (raw === '') {
      delete current[field.key];
      continue;
    }
    let parsed: string | number | boolean = String(raw);
    if (field.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new Error(`字段 ${field.label} 需要数字，收到: ${String(raw)}`);
      }
      parsed = n;
    } else if (field.type === 'boolean') {
      parsed = raw === true || raw === 'true';
    }
    current[field.key] = parsed;
  }

  // 必填校验
  for (const field of provider.configSchema) {
    if (!field.required) continue;
    const has = current[field.key] !== undefined || envValue(field) !== undefined || field.defaultValue !== undefined;
    if (!has) {
      throw new Error(`字段 ${field.label} 为必填项`);
    }
  }

  file[providerId] = current;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8');
  await fs.rename(tmp, configPath);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/providers/config-store.test.ts`
Expected: PASS（11 个用例）

- [ ] **Step 5: 验证服务端类型检查**

Run: `cd server && npx tsc --noEmit`
Expected: 0 错误

- [ ] **Step 6: 提交**

```bash
git add server/src/providers/config-store.ts server/src/providers/config-store.test.ts
git commit -m "feat: Provider 配置存储（providers.json 读写/校验/脱敏/环境变量兜底）"
```

---

## Task 4: ComfyUI Bridge 传输客户端

**Files:**
- Create: `server/src/providers/comfyui-bridge/client.ts`
- Test: `server/src/providers/comfyui-bridge/client.test.ts`

- [ ] **Step 1: 先写失败测试 `server/src/providers/comfyui-bridge/client.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComfyuiBridgeClient } from './client.js';

describe('createComfyuiBridgeClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('execute 使用配置中的 baseUrl 构造 URL（JSON 提交，无文件）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 't1', status: 'accepted', comfyui_response: {} }),
    } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://my-bridge:9999/', password: 'pw' });
    const result = await client.execute({
      workflowId: 'text_to_image',
      params: { imd_desc: '描述', width: 1080, height: 1920 },
    });

    expect(result.taskId).toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://my-bridge:9999/api/workflows/text_to_image/execute');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('execute 带文件时走 multipart，params 为 JSON 字符串，文件键保留', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 't2', status: 'accepted', comfyui_response: {} }),
    } as unknown as Response);

    const file = new File(['dummy'], 'a.png', { type: 'image/png' });
    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    await client.execute({ workflowId: 'qwen-edit-2509', params: { desc: '编辑' }, files: { img1: file } });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(JSON.parse(form.get('params') as string)).toEqual({ desc: '编辑' });
    expect(form.get('img1')).toBe(file);
  });

  it('poll 自动登录获取 token，completed 视为 done，请求带 Bearer', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'abc' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed', progress: 100 }) } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    const result = await client.poll('task-1');

    expect(result.status).toBe('completed');
    expect(result.done).toBe(true);
    expect(result.progress).toBe(100);
    expect(fetchMock.mock.calls[0][0]).toBe('http://b/api/auth/login');
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toContain('pw');
    expect(fetchMock.mock.calls[1][0]).toBe('http://b/api/tasks/task-1');
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toEqual({ Authorization: 'Bearer abc' });
  });

  it('failed 状态视为 done', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'abc' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'failed', errorMessage: 'boom' }) } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    const result = await client.poll('task-1');
    expect(result.done).toBe(true);
    expect(result.errorMessage).toBe('boom');
  });

  it('token 缓存按 client 实例持有：同一实例多次 poll 只登录一次', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'abc' }) } as unknown as Response)
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'running', progress: 10 }) } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    await client.poll('task-1');
    await client.poll('task-1');
    // 1 次 login + 2 次 poll
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('getOutput 返回 fetch 类型输出（相对 url 拼接 baseUrl，含认证 header）', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'abc' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [{ url: '/api/tasks/task-1/outputs/a.png' }] }) } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    const out = await client.getOutput('task-1');

    expect(out).not.toBeNull();
    expect(out!.type).toBe('fetch');
    const fetchOut = out as { type: 'fetch'; request: { url: string; headers: Record<string, string> }; filename: string };
    expect(fetchOut.request.url).toBe('http://b/api/tasks/task-1/outputs/a.png');
    expect(fetchOut.request.headers.Authorization).toBe('Bearer abc');
    expect(fetchOut.filename).toBe('a.png');
  });

  it('getOutput 无输出文件时返回 null', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'abc' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [] }) } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    expect(await client.getOutput('task-1')).toBeNull();
  });

  it('cancel 调用 /api/tasks/:id/cancel', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ task_id: 'task-1', status: 'failed' }) } as unknown as Response);

    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    await client.cancel('task-1');

    expect(fetchMock.mock.calls[0][0]).toBe('http://b/api/tasks/task-1/cancel');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/providers/comfyui-bridge/client.test.ts`
Expected: FAIL（`./client.js` 模块不存在）

- [ ] **Step 3: 实现 `server/src/providers/comfyui-bridge/client.ts`**

```ts
import type { ProviderClient, ResolvedProviderConfig, WorkflowOutput } from '../types.js';

/**
 * 创建 ComfyUI Easy Bridge 传输客户端。
 *
 * - baseUrl / password 来自已解析配置（文件值 > COMFYUI_BRIDGE_URL/COMFYUI_BRIDGE_PASSWORD > 默认值）；
 * - token 缓存按客户端实例持有：配置变更后引擎重新 createClient，即用新配置（含新 token）；
 * - 提交无需认证；poll / getOutput 首次调用时自动登录获取 token。
 *
 * @param config 已解析的 provider 配置（含 baseUrl / password）
 * @returns ProviderClient
 */
export function createComfyuiBridgeClient(config: ResolvedProviderConfig): ProviderClient {
  const baseUrl = String(config.baseUrl ?? 'http://localhost:10721').replace(/\/+$/, '');
  const password = String(config.password ?? '0d000721');

  let authToken: string | null = null;
  let tokenExpiry = 0;

  /** 获取认证 token（缓存 30 分钟；过期或缺失时登录） */
  async function ensureToken(): Promise<string> {
    if (authToken && Date.now() < tokenExpiry) {
      return authToken;
    }
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bridge auth failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as { token: string };
    authToken = data.token;
    // Token 有效期未知，保守缓存 30 分钟
    tokenExpiry = Date.now() + 30 * 60 * 1000;
    return authToken;
  }

  return {
    async execute(p) {
      const url = `${baseUrl}/api/workflows/${p.workflowId}/execute`;
      const fileEntries = Object.entries(p.files ?? {});
      const hasFiles = fileEntries.length > 0;

      let res: Response;
      if (hasFiles) {
        const form = new FormData();
        form.append('params', JSON.stringify(p.params ?? {}));
        for (const [alias, file] of fileEntries) {
          form.append(alias, file);
        }
        // 不手动设置 Content-Type，由 fetch 自动带 multipart boundary
        res = await fetch(url, { method: 'POST', body: form });
      } else {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p.params ?? {}),
        });
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge submit failed (${res.status}): ${text}`);
      }

      const data = (await res.json()) as {
        task_id: string;
        status: string;
        comfyui_response: unknown;
      };
      return { taskId: data.task_id };
    },

    async poll(taskId) {
      const token = await ensureToken();
      const res = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge poll failed (${res.status}): ${text}`);
      }
      const data = (await res.json()) as {
        status: string;
        progress?: number;
        errorMessage?: string | null;
      };
      const done = data.status === 'completed' || data.status === 'failed';
      return {
        status: data.status,
        progress: data.progress ?? 0,
        done,
        errorMessage: data.errorMessage ?? null,
      };
    },

    async getOutput(taskId): Promise<WorkflowOutput | null> {
      const token = await ensureToken();
      const res = await fetch(`${baseUrl}/api/tasks/${taskId}/output-files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge output-files failed (${res.status}): ${text}`);
      }
      const data = (await res.json()) as { files?: Array<{ url: string }> };
      const files = data.files ?? [];
      if (files.length === 0) return null;

      const url = files[0].url.startsWith('http') ? files[0].url : `${baseUrl}${files[0].url}`;
      const filename = url.split('/').pop()?.split('?')[0] ?? 'output.png';
      return {
        type: 'fetch',
        request: { url, method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        filename,
      };
    },

    async cancel(taskId) {
      const res = await fetch(`${baseUrl}/api/tasks/${taskId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge cancel failed (${res.status}): ${text}`);
      }
      await res.json();
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/providers/comfyui-bridge/client.test.ts`
Expected: PASS（9 个用例）

- [ ] **Step 5: 提交**

```bash
git add server/src/providers/comfyui-bridge/client.ts server/src/providers/comfyui-bridge/client.test.ts
git commit -m "feat: ComfyUI Bridge Provider 传输客户端（execute/poll/getOutput/cancel + 实例级 token 缓存）"
```

---

## Task 5: ComfyUI Bridge Provider 插件注册

**Files:**
- Create: `server/src/providers/comfyui-bridge/index.ts`

- [ ] **Step 1: 实现插件注册 `server/src/providers/comfyui-bridge/index.ts`**

```ts
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { createComfyuiBridgeClient } from './client.js';

/**
 * ComfyUI Easy Bridge Provider 插件。
 *
 * 配置字段：
 * - baseUrl：服务地址（COMFYUI_BRIDGE_URL 环境变量兜底，默认 http://localhost:10721）
 * - password：访问密码（COMFYUI_BRIDGE_PASSWORD 环境变量兜底，默认 0d000721；secret 脱敏）
 */
const definition: ProviderDefinition = {
  id: 'comfyui-bridge',
  name: 'ComfyUI Easy Bridge',
  description: '本地 ComfyUI Easy Bridge 服务，支持文生图 / 图片编辑 / 图生视频 / TTS 等 ComfyUI 工作流',
  configSchema: [
    {
      key: 'baseUrl',
      label: '服务地址',
      type: 'string',
      required: false,
      defaultValue: 'http://localhost:10721',
      placeholder: 'http://localhost:10721',
      description: 'ComfyUI Easy Bridge 服务地址',
      envVar: 'COMFYUI_BRIDGE_URL',
    },
    {
      key: 'password',
      label: '访问密码',
      type: 'password',
      required: false,
      defaultValue: '0d000721',
      placeholder: '••••••••',
      secret: true,
      description: 'Bridge 登录密码（用于自动获取 token）',
      envVar: 'COMFYUI_BRIDGE_PASSWORD',
    },
  ],
  createClient: (config) => createComfyuiBridgeClient(config),
};

registerProvider(definition);
```

- [ ] **Step 2: 验证注册生效（临时脚本，用后删除）**

创建 `server/tmp-provider-check.ts`：

```ts
import './src/providers/comfyui-bridge/index.js';
import { getProvider } from './src/providers/registry.js';

const p = getProvider('comfyui-bridge');
if (!p) throw new Error('comfyui-bridge 未注册');
console.log('provider registered:', p.id, p.name, 'fields:', p.configSchema.map((f) => f.key).join(','));
```

Run: `cd server && npx tsx tmp-provider-check.ts`
Expected: 输出 `provider registered: comfyui-bridge ComfyUI Easy Bridge fields: baseUrl,password`
然后删除：`Remove-Item server/tmp-provider-check.ts`

- [ ] **Step 3: 提交**

```bash
git add server/src/providers/comfyui-bridge/index.ts
git commit -m "feat: 注册 comfyui-bridge Provider 插件（configSchema + createClient）"
```

---

## Task 6: Provider 目录自动发现 + 启动接线

**Files:**
- Create: `server/src/providers/index.ts`
- Create: `server/src/providers/discovery.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: 先写失败测试 `server/src/providers/discovery.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { discoverProviders } from './index.js';
import { getProvider } from './registry.js';

describe('discoverProviders', () => {
  it('扫描 providers/ 目录并注册 comfyui-bridge 插件', async () => {
    await discoverProviders();
    expect(getProvider('comfyui-bridge')).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/providers/discovery.test.ts`
Expected: FAIL（`./index.js` 不存在）

- [ ] **Step 3: 实现 `server/src/providers/index.ts`**

```ts
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = __dirname;

/**
 * 自动发现并注册所有 Provider 插件。
 *
 * 扫描 providers/ 下各子目录，import 其 index.ts（模块顶层调用 registerProvider）。
 * 新增 provider = 新建子目录 + index.ts，无需改动本文件。
 */
export async function discoverProviders(): Promise<void> {
  const entries = await fs.readdir(PROVIDERS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(PROVIDERS_DIR, entry.name, 'index.ts');
    try {
      await fs.access(indexPath);
    } catch {
      continue;
    }
    await import(pathToFileURL(indexPath).href);
  }
}
```

- [ ] **Step 4: 接线到启动入口 `server/src/index.ts`**

把：

```ts
import { discoverWorkflows, startEngine } from './workflow-engine.js';
```

改为：

```ts
import { discoverProviders } from './providers/index.js';
import { discoverWorkflows, startEngine } from './workflow-engine.js';
```

把：

```ts
discoverWorkflows().then(() => {
  startEngine();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
```

改为：

```ts
discoverProviders().then(() =>
  discoverWorkflows().then(() => {
    startEngine();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }),
);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd server && npx vitest run src/providers/discovery.test.ts`
Expected: PASS（1 个用例；comfyui-bridge 已注册）

- [ ] **Step 6: 验证服务端类型检查 + 全量 server 测试**

Run: `cd server && npx tsc --noEmit`
Expected: 0 错误
Run: `cd server && npm test`
Expected: 全部通过（此前 74 + 新增 24 个 provider 用例）

- [ ] **Step 7: 提交**

```bash
git add server/src/providers/index.ts server/src/providers/discovery.test.ts server/src/index.ts
git commit -m "feat: Provider 目录自动发现并接入服务启动（先 discoverProviders 再 discoverWorkflows）"
```

---

## Task 7: /api/providers 接口

**Files:**
- Modify: `server/src/routes/workflow.ts`

- [ ] **Step 1: 修改导入**

把：

```ts
import { cancelBridgeTask } from '../workflows/bridge-client.js';
```

改为：

```ts
import { getProviderConfig, getProviderConfigMasked, setProviderConfig } from '../providers/config-store.js';
import { getAllProviders, getProvider } from '../providers/registry.js';
```

（`cancelBridgeTask` 的调用在 Task 8 处理，此处先移除导入会导致编译错误——**本任务先不改 cancel 逻辑**，仅新增接口。为避免编译中断，Task 8 再移除该导入。所以本任务 Step 1 改为：在现有导入后追加两行 provider 导入，保留 `cancelBridgeTask` 导入不变，直到 Task 8 移除。）

> 说明：为保持每次提交可编译，本任务只**追加** provider 导入并新增路由；`cancelBridgeTask` 导入保留到 Task 8 一并替换。

在 `import { cancelBridgeTask } from '../workflows/bridge-client.js';` 之后追加：

```ts
import { getProviderConfig, getProviderConfigMasked, setProviderConfig } from '../providers/config-store.js';
import { getAllProviders, getProvider } from '../providers/registry.js';
```

- [ ] **Step 2: 在 `// GET /api/workflows` 之前新增两个路由**

在 `workflowRouter.get('/workflows', ...)` 之前插入：

```ts
// GET /api/providers — 列出所有 Provider 插件及其配置（secret 字段脱敏为 '__set__'）
workflowRouter.get('/providers', async (_req: Request, res: Response) => {
  const providers = await Promise.all(
    getAllProviders().map(async (p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      configSchema: p.configSchema,
      config: await getProviderConfigMasked(p.id),
    })),
  );
  res.json({ providers });
});

// PUT /api/providers/:id — 保存 Provider 配置（按 schema 校验；secret 空串保留原值）
workflowRouter.put('/providers/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { config } = req.body as { config?: Record<string, unknown> };
  if (!config || typeof config !== 'object') {
    res.status(400).json({ error: 'Missing body: config' });
    return;
  }
  try {
    await setProviderConfig(id, config);
    res.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});
```

- [ ] **Step 3: 验证类型检查 + 全量 server 测试**

Run: `cd server && npx tsc --noEmit` → Expected: 0 错误
Run: `cd server && npm test` → Expected: 全部通过

- [ ] **Step 4: 提交**

```bash
git add server/src/routes/workflow.ts
git commit -m "feat: 新增 /api/providers 接口（GET 列表脱敏 / PUT 保存校验）"
```

---

## Task 8: 类型与引擎集成（provider 驱动，保留旧传输层）

本任务让引擎改为 provider 驱动，但**暂不移除**旧传输层（bridge-client 的 submitComfyuiBridge/pollTask 等仍保留），保证每个提交可编译可测试。Task 9 再移除旧传输层。

**Files:**
- Modify: `server/src/workflows/types.ts`
- Modify: `server/src/workflows/registry.ts`
- Modify: `server/src/workflow-engine.ts`
- Modify: `server/src/routes/workflow.ts`
- Modify: `server/src/workflows/image-to-video/default.test.ts`
- Modify: `server/src/workflows/image-to-video/minimax.test.ts`

- [ ] **Step 1: `workflows/types.ts` 增加 provider 字段**

在文件顶部 import 区，把：

```ts
import type { WorkflowVarsBase } from './vars.js';
```

改为：

```ts
import type { ProviderClient } from '../providers/types.js';
import type { WorkflowVarsBase } from './vars.js';
```

在 re-export 块（`export type { WorkflowVarsBase, ... } from './vars.js';`）之后追加：

```ts
/** Provider 输出规格（传输层由 provider 提供，WorkflowOutput 定义已移入 providers/types） */
export type { WorkflowOutput } from '../providers/types.js';
```

在 `WorkflowBaseDefinition` 的 `description?: string;` 之后、`params?:` 之前加：

```ts
  /** 该实现使用的 Provider 插件 ID（引擎据此解析配置并创建传输客户端；默认 comfyui-bridge） */
  provider?: string;
```

在 `WorkflowRunContext` 的 `userParams?: ...;` 之后、`video?: ...;` 之前加：

```ts
  /** Provider 客户端（引擎按工作流声明的 provider 解析配置后注入；工作流用它提交任务） */
  provider: ProviderClient;
```

- [ ] **Step 2: `workflows/registry.ts` 的 getAllWorkflows 暴露 provider**

把：

```ts
    implementations: impls.map(w => ({
      impl: w.impl,
      name: w.name,
      description: w.description,
      params: w.params,
      capabilities: w.capabilities,
    }))
```

改为：

```ts
    implementations: impls.map(w => ({
      impl: w.impl,
      name: w.name,
      description: w.description,
      provider: w.provider,
      params: w.params,
      capabilities: w.capabilities,
    }))
```

- [ ] **Step 3: `workflow-engine.ts` 引擎 provider 驱动**

Step 3.1 — 替换导入。把：

```ts
import { submitComfyuiBridge, pollTask, buildDownloadRequest } from './workflows/bridge-client.js';
```

改为：

```ts
import { getProviderConfig } from './providers/config-store.js';
import { getProvider } from './providers/registry.js';
```

Step 3.2 — 在 runTask 的 try 块开头解析 provider。把：

```ts
  try {
    db.addLog(taskId, 'info', `Starting workflow: ${wf.name} (impl: ${wf.impl})`);
    db.updateTaskStatus(taskId, 'running');

    // ── 视频自包含提交数据 ──
```

改为：

```ts
  try {
    db.addLog(taskId, 'info', `Starting workflow: ${wf.name} (impl: ${wf.impl})`);
    db.updateTaskStatus(taskId, 'running');

    // ── Provider 解析：工作流声明 → 插件 → 配置 → client（按请求实时解析，配置热加载）──
    const providerId = wf.provider ?? 'comfyui-bridge';
    const providerDef = getProvider(providerId);
    if (!providerDef) {
      throw new Error(`工作流 ${task.workflow_id}/${task.impl} 声明的 provider 未注册: ${providerId}`);
    }
    const provider = providerDef.createClient(await getProviderConfig(providerId));

    // ── 视频自包含提交数据 ──
```

Step 3.3 — generateVoice 改用 provider。把 sceneDeps 中的：

```ts
          generateVoice: async (text, voiceDesc) => {
            // 拼接台词 → TTS 生成配音（失败降级返回 null，不注入音频）
            try {
              const ttsResult = await submitComfyuiBridge({
                workflowId: 'tts_voice_design',
                params: { desc: voiceDesc, text },
              });
              let ttsOk = false;
              while (true) {
                await new Promise((r) => setTimeout(r, 1000));
                const ttsStatus = await pollTask(ttsResult.taskId);
                if (ttsStatus.status === 'completed') { ttsOk = true; break; }
                if (ttsStatus.status === 'failed') {
                  console.warn(`TTS 生成失败，跳过音频: ${ttsStatus.errorMessage}`);
                  break;
                }
              }
              if (ttsOk) {
                const download = await buildDownloadRequest(ttsResult.taskId);
                if (download) {
                  const resp = await fetch(download.url, { headers: download.headers });
                  const blob = await resp.blob();
                  return new File([blob], 'voice-combined.flac', { type: 'audio/flac' });
                }
              }
              return null;
            } catch {
              return null;
            }
          },
```

改为：

```ts
          generateVoice: async (text, voiceDesc) => {
            // 拼接台词 → TTS 生成配音（失败降级返回 null，不注入音频）
            try {
              const ttsResult = await provider.execute({
                workflowId: 'tts_voice_design',
                params: { desc: voiceDesc, text },
              });
              let ttsOk = false;
              while (true) {
                await new Promise((r) => setTimeout(r, 1000));
                const ttsStatus = await provider.poll(ttsResult.taskId);
                if (ttsStatus.status === 'completed') { ttsOk = true; break; }
                if (ttsStatus.status === 'failed') {
                  console.warn(`TTS 生成失败，跳过音频: ${ttsStatus.errorMessage}`);
                  break;
                }
              }
              if (ttsOk) {
                const output = await provider.getOutput(ttsResult.taskId);
                if (output && output.type === 'fetch') {
                  const resp = await fetch(output.request.url, { headers: output.request.headers });
                  const blob = await resp.blob();
                  return new File([blob], 'voice-combined.flac', { type: 'audio/flac' });
                }
              }
              return null;
            } catch {
              return null;
            }
          },
```

Step 3.4 — runContext 注入 provider。把：

```ts
    const runContext: WorkflowRunContext = {
      project: task.project,
      projectConfig,
      vars,
      ...(video ? { video } : {}),
      userParams,
      readFile,
      readAssertFile,
    };
```

改为：

```ts
    const runContext: WorkflowRunContext = {
      project: task.project,
      projectConfig,
      vars,
      provider,
      ...(video ? { video } : {}),
      userParams,
      readFile,
      readAssertFile,
    };
```

Step 3.5 — 提交/轮询/输出改 provider。把：

```ts
    // Step 1: Submit
    db.addLog(taskId, 'info', 'Submitting task to AI API...');
    const { taskId: remoteTaskId } = await wf.submit(runContext);
    // 持久化远端任务 ID，供中断端点（/workflow/tasks/:id/cancel）使用
    const taskParams = JSON.parse(task.params) as Record<string, unknown>;
    db.updateTaskParams(taskId, { ...taskParams, remoteTaskId });
    db.addLog(taskId, 'info', `Submitted, remote task ID: ${remoteTaskId}`);

    let pollResponse: Record<string, unknown> | undefined;

    // Step 2: Poll if defined
    // 不设轮询时间上限：视频等生成任务可能远超 5 分钟，轮询直到远端返回 done（completed/failed）。
    // 远端任务悬挂时用户可通过中断（cancel）兜底；Bridge 不可达时 wf.poll 抛错 → 任务直接 failed。
    if (wf.poll) {
      db.addLog(taskId, 'info', 'Polling task status...');
      const POLL_INTERVAL = 2000;

      while (true) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        const result = await wf.poll(remoteTaskId);
        pollResponse = result;

        db.addLog(taskId, 'debug', `Poll result: ${Object.keys(result).map(k => k + '=' + result[k]).join(',')}`);

        if (result.done) {
          db.addLog(taskId, 'info', `Task completed with status: ${result.status}`);
          break;
        }
      }
    }

    // Step 3: Parse output
    db.addLog(taskId, 'info', 'Parsing output...');
    const output = await wf.parseOutput(remoteTaskId, pollResponse);
```

改为：

```ts
    // Step 1: Submit
    db.addLog(taskId, 'info', `Submitting task to AI API (provider: ${providerId})...`);
    const { taskId: remoteTaskId } = await wf.submit(runContext);
    // 持久化远端任务 ID，供中断端点（/workflow/tasks/:id/cancel）使用
    const taskParams = JSON.parse(task.params) as Record<string, unknown>;
    db.updateTaskParams(taskId, { ...taskParams, remoteTaskId });
    db.addLog(taskId, 'info', `Submitted, remote task ID: ${remoteTaskId}`);

    // Step 2: Poll
    // 不设轮询时间上限：视频等生成任务可能远超 5 分钟，轮询直到远端返回 done（completed/failed）。
    // 远端任务悬挂时用户可通过中断（cancel）兜底；provider 不可达时 poll 抛错 → 任务直接 failed。
    db.addLog(taskId, 'info', 'Polling task status...');
    const POLL_INTERVAL = 2000;
    while (true) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      const result = await provider.poll(remoteTaskId);
      db.addLog(taskId, 'debug', `Poll result: status=${result.status} progress=${result.progress}`);

      if (result.done) {
        db.addLog(taskId, 'info', `Task completed with status: ${result.status}`);
        break;
      }
    }

    // Step 3: Parse output
    db.addLog(taskId, 'info', 'Parsing output...');
    const output = await provider.getOutput(remoteTaskId);
    if (!output) {
      throw new Error('No output files found from provider task');
    }
```

- [ ] **Step 4: `routes/workflow.ts` 的 cancel 改用 provider**

把 cancel 路由中的：

```ts
    if (task.status === 'running') {
      await cancelBridgeTask(getRemoteTaskId(task)!);
    }
```

改为：

```ts
    if (task.status === 'running') {
      const providerId = wf?.provider ?? 'comfyui-bridge';
      const providerDef = getProvider(providerId);
      if (!providerDef) {
        throw new Error(`provider 未注册: ${providerId}`);
      }
      await providerDef
        .createClient(await getProviderConfig(providerId))
        .cancel(getRemoteTaskId(task)!);
    }
```

然后移除 `import { cancelBridgeTask } from '../workflows/bridge-client.js';`（该导出保留到 Task 9，但本文件不再使用）。

- [ ] **Step 5: 更新两个测试文件的 mkContext（加 provider 占位 stub）**

`server/src/workflows/image-to-video/default.test.ts` — 在 `mkContext` 中加 provider（该文件整体 mock 了 bridge-client，submit 不会真正调用 provider，stub 即可）。把：

```ts
const mkContext = (video: unknown): WorkflowRunContext =>
  ({
    project: 'p',
    projectConfig: { width: 1080, height: 1920, fps: 24 },
    vars: {},
    video: video as never,
    readFile: async () => '',
    readAssertFile: async () => new File(['x'], 'x.png', { type: 'image/png' }),
  }) as WorkflowRunContext;
```

改为：

```ts
/** provider stub：default.test 整体 mock 了 bridge-client，submit 不会真正调用 provider */
const stubProvider = {
  execute: async () => ({ taskId: 'mock' }),
  poll: async () => ({ status: 'completed', progress: 100, done: true, errorMessage: null }),
  getOutput: async () => null,
  cancel: async () => {},
} as WorkflowRunContext['provider'];

const mkContext = (video: unknown): WorkflowRunContext =>
  ({
    project: 'p',
    projectConfig: { width: 1080, height: 1920, fps: 24 },
    vars: {},
    provider: stubProvider,
    video: video as never,
    readFile: async () => '',
    readAssertFile: async () => new File(['x'], 'x.png', { type: 'image/png' }),
  }) as WorkflowRunContext;
```

`server/src/workflows/image-to-video/minimax.test.ts` — 同样加 stub（本任务阶段 impl 仍调用旧签名 submitReferenceVideo，provider 未被使用；Task 9 再换成真实 client）。把其 `mkContext` 同样改为：

```ts
/** provider stub：Task 9 将换成真实 comfyui-bridge client 以保留全链路 fetch 覆盖 */
const stubProvider = {
  execute: async () => ({ taskId: 'mock' }),
  poll: async () => ({ status: 'completed', progress: 100, done: true, errorMessage: null }),
  getOutput: async () => null,
  cancel: async () => {},
} as WorkflowRunContext['provider'];

const mkContext = (video: unknown): WorkflowRunContext =>
  ({
    project: 'p',
    projectConfig: { width: 1080, height: 1920, fps: 24 },
    vars: {},
    provider: stubProvider,
    video: video as never,
    readFile: async () => '',
    readAssertFile: async () => new File(['x'], 'x.png', { type: 'image/png' }),
  }) as WorkflowRunContext;
```

- [ ] **Step 6: 验证类型检查 + 全量 server 测试**

Run: `cd server && npx tsc --noEmit` → Expected: 0 错误
Run: `cd server && npm test` → Expected: 全部通过

- [ ] **Step 7: 提交**

```bash
git add server/src/workflows/types.ts server/src/workflows/registry.ts server/src/workflow-engine.ts server/src/routes/workflow.ts server/src/workflows/image-to-video/default.test.ts server/src/workflows/image-to-video/minimax.test.ts
git commit -m "refactor: 引擎改为 Provider 驱动（按请求解析配置创建 client；runTask/cancel/generateVoice 走 provider）"
```

---

## Task 9: 移除旧传输层 + 工厂重构

**Files:**
- Modify: `server/src/workflows/types.ts`（移除 poll/parseOutput）
- Modify: `server/src/workflows/bridge-client.ts`（重写）
- Modify: `server/src/workflows/image-to-video/default.ts`
- Modify: `server/src/workflows/image-to-video/minimax-h3-r2v.ts`
- Modify: `server/src/workflows/bridge-client.test.ts`
- Modify: `server/src/workflows/image-to-video/default.test.ts`
- Modify: `server/src/workflows/image-to-video/minimax.test.ts`

- [ ] **Step 1: `workflows/types.ts` 移除 poll/parseOutput**

把：

```ts
/**
 * 工作流完整定义。
 *
 * @typeParam TVars - 业务变量类型
 * @typeParam TPollResult - poll 返回的额外字段类型
 */
export interface WorkflowDefinition<
  TVars extends WorkflowVarsBase = WorkflowVarsBase,
  TPollResult = Record<string, unknown>,
> extends WorkflowBaseDefinition {
  /** 工作流能力声明（注册时声明，前端据此展示导演台等能力入口） */
  capabilities?: WorkflowCapabilities;

  /** Submit task to AI API, return remote task ID */
  submit(ctx: WorkflowRunContext<TVars>): Promise<{ taskId: string }>;

  /** Optional: poll task status. Not implementing = synchronous task */
  poll?(taskId: string): Promise<{ status: string; done: boolean } & TPollResult>;

  /** Extract output spec from completed task. response is the extra fields from poll's return (excluding status/done) */
  parseOutput(taskId: string, response?: TPollResult): Promise<WorkflowOutput>;
}
```

改为：

```ts
/**
 * 工作流完整定义。
 *
 * 传输职责归 Provider：引擎在运行任务时按 provider 解析配置创建 ProviderClient 并
 * 注入 ctx.provider，submit 内通过 ctx.provider 提交；轮询与输出获取由引擎直接驱动
 * provider client（因此本定义不再有 poll / parseOutput）。
 *
 * @typeParam TVars - 业务变量类型
 */
export interface WorkflowDefinition<TVars extends WorkflowVarsBase = WorkflowVarsBase> extends WorkflowBaseDefinition {
  /** 工作流能力声明（注册时声明，前端据此展示导演台等能力入口） */
  capabilities?: WorkflowCapabilities;

  /** Submit task to AI API, return remote task ID */
  submit(ctx: WorkflowRunContext<TVars>): Promise<{ taskId: string }>;
}
```

- [ ] **Step 2: 重写 `workflows/bridge-client.ts`（删除并重建整个文件）**

删除 `server/src/workflows/bridge-client.ts`，创建以下新内容：

```ts
/**
 * ComfyUI Bridge 工作流层封装。
 *
 * 传输层（execute/poll/getOutput/cancel + token 认证）已迁移到
 * providers/comfyui-bridge/（Provider 插件）。本文件只保留「工作流层」内容：
 * - createProviderWorkflow — 通用工作流工厂（声明 provider + submit）
 * - createTextToImageWorkflow / createImageEditWorkflow / createTtsDesignWorkflow — 快捷工厂
 * - submitTextToImage / submitImageEdit / submitImageToVideo / submitLtxDirectorImageToVideo /
 *   submitReferenceVideo / submitMinimaxH3Fl2v — 提交辅助函数（首参为 ProviderClient）
 * - resolveImageEditSizeParams — 图片编辑尺寸解析（纯函数）
 */

import type { ProviderClient } from '../providers/types.js';
import type {
  WorkflowBaseDefinition,
  WorkflowCapabilities,
  WorkflowDefinition,
  WorkflowRunContext,
  WorkflowUserParamDeclaration,
  WorkflowVarsBase,
} from './types.js';

// ── 通用工作流工厂 ───────────────────────────────────────────────────

/**
 * 创建通用工作流定义。
 *
 * 工作流声明自己使用的 provider（默认 comfyui-bridge）；引擎在运行任务时按 provider
 * 解析配置并创建 ProviderClient 注入 ctx.provider，submit 内通过 ctx.provider 提交任务。
 * 轮询与输出获取由引擎直接驱动 provider client，因此本工厂不再预绑 poll/parseOutput。
 *
 * @param args.provider provider 插件 ID（默认 comfyui-bridge）
 * @param args.baseDefinition 工作流基础元信息（type / name / impl / description / params / capabilities）
 * @param args.submit 提交函数，接收 WorkflowRunContext，返回远端任务 ID
 * @returns 完整的工作流定义（WorkflowDefinition<TVars>）
 */
export function createProviderWorkflow<TVars extends WorkflowVarsBase = WorkflowVarsBase>({
  provider = 'comfyui-bridge',
  baseDefinition,
  submit,
}: {
  provider?: string;
  baseDefinition: WorkflowBaseDefinition & { capabilities?: WorkflowCapabilities };
  submit: (ctx: WorkflowRunContext<TVars>) => Promise<{ taskId: string }>;
}): WorkflowDefinition<TVars> {
  return {
    ...baseDefinition,
    provider,
    submit,
  };
}

// ── 文生图提交辅助函数 ───────────────────────────────────────────────

export interface SubmitTextToImageParams {
  /** 图片描述提示词 */
  imd_desc: string;
  /** 图片宽度（像素） */
  width: number;
  /** 图片高度（像素） */
  height: number;
  /** 随机种子（可选） */
  seed?: number;
  /** 提示词强化开关（布尔值，直接提交给 ComfyUI 工作流；可选） */
  enhance_prompt?: boolean;
}

/**
 * 提交文生图任务（ComfyUI text_to_image 工作流）。
 * @param client Provider 客户端
 * @param params 文生图参数
 * @returns 远端任务 ID
 */
export async function submitTextToImage(
  client: ProviderClient,
  params: SubmitTextToImageParams,
): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    imd_desc: params.imd_desc,
    width: params.width,
    height: params.height,
  };
  if (params.seed != null) {
    body.seed = params.seed;
  }
  if (params.enhance_prompt !== undefined) {
    body.enhance_prompt = params.enhance_prompt;
  }
  return client.execute({ workflowId: 'text_to_image', params: body });
}

// ── 图片编辑提交辅助函数 ─────────────────────────────────────────────

interface SubmitImageEditParams {
  imgs: File[];
  desc: string;
  seed?: string | number;
  /** 启用多机位旋转 LoRA */
  enable_multiple_angles_lora?: boolean;
  /** 启用指定输出图片尺寸 */
  enable_specified_size?: boolean;
  /** 输出图片宽度（enable_specified_size 为 true 时生效） */
  width?: number;
  /** 输出图片高度（enable_specified_size 为 true 时生效） */
  height?: number;
}

export interface ImageEditSizeParams {
  /** 是否启用指定输出尺寸 */
  enable_specified_size?: boolean;
  /** 输出宽度（像素） */
  width?: number;
  /** 输出高度（像素） */
  height?: number;
}

/**
 * 从工作流 vars 解析图片编辑尺寸参数。
 *
 * 仅当 vars.enable_specified_size === 'true' 时返回启用标记与宽高（数字，取整），
 * 否则返回空对象（对应「不指定」模式，不向 Bridge 传任何尺寸参数）。
 *
 * @param vars 工作流 vars（key → 字符串值）
 * @returns 可透传给 Bridge 的尺寸参数
 */
export function resolveImageEditSizeParams(
  vars: Record<string, string | undefined>,
): ImageEditSizeParams {
  if (vars.enable_specified_size !== 'true') return {};
  const out: ImageEditSizeParams = { enable_specified_size: true };
  const width = vars.width ? Number(vars.width) : NaN;
  const height = vars.height ? Number(vars.height) : NaN;
  if (Number.isFinite(width)) out.width = Math.round(width);
  if (Number.isFinite(height)) out.height = Math.round(height);
  return out;
}

/**
 * 提交图片编辑任务（qwen-edit-2509 工作流，多图动态键 img1/img2/...）。
 * @param client Provider 客户端
 * @param params 图片编辑参数
 * @returns 远端任务 ID
 */
export async function submitImageEdit(
  client: ProviderClient,
  params: SubmitImageEditParams,
): Promise<{ taskId: string }> {
  const files: Record<string, File> = {};
  // 多个图片时，直接以 img${图片序号} 命名，触发动态构建工作流实现多图参考编辑
  params.imgs.forEach((f, idx) => {
    files[`img${idx + 1}`] = f;
  });
  const textParams: Record<string, unknown> = {
    desc: params.desc,
    enable_multiple_angles_lora: params.enable_multiple_angles_lora ?? true,
  };
  if (params.seed != null) {
    textParams.seed = params.seed;
  }
  if (params.enable_specified_size != null) {
    textParams.enable_specified_size = params.enable_specified_size;
  }
  if (params.width != null) {
    textParams.width = params.width;
  }
  if (params.height != null) {
    textParams.height = params.height;
  }
  return client.execute({ workflowId: 'qwen-edit-2509', params: textParams, files });
}

// ── 图生视频提交辅助函数 ─────────────────────────────────────────────

export interface ImageToVideoSubmitParams {
  /** 视频描述提示词 */
  prompt: string;
  /** 视频宽度（像素） */
  width: number;
  /** 视频高度（像素） */
  height: number;
  /** 视频时长（秒） */
  duration: number;
  /** 帧率 */
  fps: number;
  /** 随机种子（可选） */
  seed?: number;
  /** 背景音频文件（可选） */
  audio?: File;
  /**
   * 参考帧图片，按时间顺序排列。
   * - 1 张：仅首帧 → 调用 I2V
   * - 2 张：首帧 + 尾帧 → 调用 FL2V
   * - 3 张：首帧 + 中间帧 + 尾帧 → 调用 FML2V（mid_frame_cursor=0.5）
   */
  frames: File[];
}

/**
 * 根据 frames 数量自动选择合适的图生视频工作流。
 *
 * - 1 帧 → I2V（单帧生成）
 * - 2 帧 → FL2V（首尾帧插值）
 * - 3 帧 → FML2V（首中尾帧插值，中间帧位置固定 0.5）
 *
 * @param client Provider 客户端
 * @param params 图生视频参数
 * @returns 远端任务 ID
 */
export async function submitImageToVideo(
  client: ProviderClient,
  params: ImageToVideoSubmitParams,
): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    width: params.width,
    height: params.height,
    duration: params.duration,
    fps: params.fps,
    auto_generate_audio: true,
  };
  if (params.seed != null) {
    body.seed = params.seed;
  }

  const files: Record<string, File> = {};
  if (params.audio) {
    files.audio = params.audio;
    body.auto_generate_audio = false;
  }

  const frameCount = params.frames.length;

  if (frameCount === 1) {
    files.first_frame = params.frames[0];
    return client.execute({ workflowId: 'I2V', params: body, files });
  }

  if (frameCount === 2) {
    files.first_frame = params.frames[0];
    files.last_frame = params.frames[1];
    return client.execute({ workflowId: 'FL2V', params: body, files });
  }

  if (frameCount === 3) {
    body.mid_frame_cursor = 0.5;
    files.first_frame = params.frames[0];
    files.mid_frame = params.frames[1];
    files.last_frame = params.frames[2];
    return client.execute({ workflowId: 'FML2V', params: body, files });
  }

  throw new Error(
    `image-to-video 仅支持 1~3 帧参考图，当前 ${frameCount} 帧`,
  );
}

// ── 导演模式图生视频提交辅助函数（ltx-2.3-director）──────────────────

/**
 * 关键帧定义。
 *
 * 描述一张参考帧图像在目标视频中的出现位置与顺序，
 * 与上传的 `frame_{frameSeq}` 文件一一对应。
 */
export interface FrameDefine {
  /**
   * 关键帧图像序号，对应上传文件的动态键 `frame_{frameSeq}`（如 frame_0、frame_1）。
   */
  frameSeq: number;
  /**
   * 该帧图像在视频长度中的出现位置游标比值，取值范围 0~1。
   * 0 表示首帧，1 表示尾帧（视频开头/结尾瞬间帧），0.5 表示视频中间。
   */
  cursor: number;
}

/**
 * ltx-2.3-director 导演模式图生视频的提交参数。
 */
export interface LtxDirectorImageToVideoSubmitParams {
  /** 视频描述提示词 */
  prompt: string;
  /** 视频宽度（像素） */
  width: number;
  /** 视频高度（像素） */
  height: number;
  /** 视频时长（秒） */
  duration: number;
  /** 帧率 */
  fps: number;
  /** 随机种子（可选） */
  seed?: number;
  /** 背景音频文件（可选），存在时自动生成音频关闭 */
  audio?: File;
  /**
   * 关键帧列表，按时间顺序排列。每帧携带文件与游标位置，
   * 关键帧序号由提交函数按数组顺序自动生成（0、1、2…）。
   */
  frames: Array<{
    /** 关键帧图像文件 */
    file: File;
    /** 该帧在视频长度中的出现位置游标比值（0~1） */
    cursor: number;
  }>;
}

/**
 * 提交导演模式图生视频任务（ltx-2.3-director 工作流）。
 *
 * - 关键帧序号由内部按数组顺序自动生成（0、1、2…）；
 * - body 中 `frame_define` 为 JSON.stringify(FrameDefine[]) 字符串；
 * - 文件以动态键 `frame_{frameSeq}` 上传，走 multipart/form-data；
 * - 提供 `params.audio` 时以 `audio` 键上传背景音频并将 auto_generate_audio 置 false。
 *
 * @param client Provider 客户端
 * @param params 导演模式图生视频提交参数
 * @returns 远端任务 ID
 */
export async function submitLtxDirectorImageToVideo(
  client: ProviderClient,
  params: LtxDirectorImageToVideoSubmitParams,
): Promise<{ taskId: string }> {
  // 关键帧序号按数组顺序自动生成：0、1、2…
  const frameDefines: FrameDefine[] = params.frames.map((f, idx) => ({
    frameSeq: idx,
    cursor: f.cursor,
  }));

  const body: Record<string, unknown> = {
    prompt: params.prompt,
    width: params.width,
    height: params.height,
    duration: params.duration,
    fps: params.fps,
    auto_generate_audio: true,
    frame_define: JSON.stringify(frameDefines),
  };
  if (params.seed != null) {
    body.seed = params.seed;
  }

  const files: Record<string, File> = {};
  params.frames.forEach((f, idx) => {
    files[`frame_${idx}`] = f.file;
  });
  if (params.audio) {
    files.audio = params.audio;
    body.auto_generate_audio = false;
  }

  return client.execute({ workflowId: 'ltx-2.3-director', params: body, files });
}

// ── 参考模式图生视频提交辅助函数（minimax-h3-r2v）────────────────────

/**
 * 参考模式图生视频的提交参数。
 */
export interface ReferenceVideoSubmitParams {
  /** 视频描述提示词 */
  prompt: string;
  /** 视频宽度（像素） */
  width: number;
  /** 视频高度（像素） */
  height: number;
  /** 视频时长（秒） */
  duration: number;
  /** 随机种子（可选） */
  seed?: number;
  /** 有序图片参考（键 image_0, image_1, …，独立从 0 计数） */
  imageRefs?: File[];
  /** 有序视频参考（键 video_0, video_1, …） */
  videoRefs?: File[];
  /** 有序音频参考（键 audio_0, audio_1, …） */
  audioRefs?: File[];
}

/**
 * 提交参考模式图生视频任务（minimax-h3-r2v 工作流）。
 *
 * - 动态文件键：`image_{n}` / `video_{n}` / `audio_{n}`，各类型序号从 0 开始独立递增；
 * - 走 multipart/form-data，params 为 JSON 字符串；
 * - 参考素材的文件与数量由调用方（工作流实现）负责校验。
 *
 * @param client Provider 客户端
 * @param params 参考模式图生视频提交参数
 * @returns 远端任务 ID
 */
export async function submitReferenceVideo(
  client: ProviderClient,
  params: ReferenceVideoSubmitParams,
): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    width: params.width,
    height: params.height,
    duration: params.duration,
  };
  if (params.seed != null) {
    body.seed = params.seed;
  }

  const files: Record<string, File> = {};
  (params.imageRefs ?? []).forEach((f, idx) => { files[`image_${idx}`] = f; });
  (params.videoRefs ?? []).forEach((f, idx) => { files[`video_${idx}`] = f; });
  (params.audioRefs ?? []).forEach((f, idx) => { files[`audio_${idx}`] = f; });

  return client.execute({ workflowId: 'minimax-h3-r2v', params: body, files });
}

// ── 首尾帧模式图生视频提交辅助函数（minimax-h3-fl2v）─────────────────

/**
 * minimax-h3-fl2v 首尾帧模式图生视频的提交参数。
 */
export interface MinimaxH3Fl2vSubmitParams {
  /** 视频描述提示词 */
  prompt: string;
  /** 视频宽度（像素） */
  width: number;
  /** 视频高度（像素） */
  height: number;
  /** 视频时长（秒） */
  duration: number;
  /** 随机种子（可选） */
  seed?: number;
  /** 首帧图片（必填，文件键 image_0） */
  firstFrame: File;
  /** 尾帧图片（可选，文件键 image_1；存在时表示首尾帧插值） */
  lastFrame?: File;
}

/**
 * 提交首尾帧模式图生视频任务（minimax-h3-fl2v 工作流）。
 *
 * - params（prompt/width/height/duration/seed）以 JSON 字符串上传（multipart 方式 B）；
 * - 首帧以文件键 `image_0` 上传；存在尾帧时以 `image_1` 上传。
 *
 * @param client Provider 客户端
 * @param params 首尾帧模式图生视频提交参数
 * @returns 远端任务 ID
 */
export async function submitMinimaxH3Fl2v(
  client: ProviderClient,
  params: MinimaxH3Fl2vSubmitParams,
): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    width: params.width,
    height: params.height,
    duration: params.duration,
  };
  if (params.seed != null) {
    body.seed = params.seed;
  }

  const files: Record<string, File> = { image_0: params.firstFrame };
  if (params.lastFrame) {
    files.image_1 = params.lastFrame;
  }

  return client.execute({ workflowId: 'minimax-h3-fl2v', params: body, files });
}

// ── 文生图工作流快捷工厂 ─────────────────────────────────────────────

export interface TextToImageWorkflowConfig<TVars extends WorkflowVarsBase = WorkflowVarsBase> {
  /** 工作流类型，如 text-to-image */
  type: string;
  name: string;
  impl: string;
  description?: string;
  /** 可由用户手动传入的参数声明（可选，前端据此渲染输入表单） */
  params?: WorkflowUserParamDeclaration[];
  /** 返回文生图的提示词（imd_desc） */
  getPrompt(ctx: WorkflowRunContext<TVars>): Promise<string> | string;
  /** 返回图片宽度，默认 1080 */
  getWidth?(ctx: WorkflowRunContext<TVars>): number;
  /** 返回图片高度，默认 1920 */
  getHeight?(ctx: WorkflowRunContext<TVars>): number;
}

/**
 * 创建文生图工作流的快捷工厂。
 *
 * 调用方只需提供 getPrompt / getWidth / getHeight；
 * submit 通过 ctx.provider 提交（传输层由 provider 提供）。
 */
export function createTextToImageWorkflow<TVars extends WorkflowVarsBase = WorkflowVarsBase>(
  config: TextToImageWorkflowConfig<TVars>,
): WorkflowDefinition<TVars> {
  const WIDTH_DEFAULT = 1080;
  const HEIGHT_DEFAULT = 1920;

  return createProviderWorkflow<TVars>({
    baseDefinition: {
      type: config.type,
      name: config.name,
      impl: config.impl,
      description: config.description,
      params: config.params,
    },
    async submit(ctx) {
      const prompt = await config.getPrompt(ctx);
      const width = config.getWidth ? config.getWidth(ctx) : WIDTH_DEFAULT;
      const height = config.getHeight ? config.getHeight(ctx) : HEIGHT_DEFAULT;
      const seed = ctx.vars.seed ? Number(ctx.vars.seed) : undefined;
      // enhance_prompt 仅作为布尔值提交给 ComfyUI 工作流，不修改提示词内容
      const enhancePrompt = (ctx.vars as Record<string, unknown>).enhance_prompt === 'true';
      const result = await submitTextToImage(ctx.provider, {
        imd_desc: prompt,
        width,
        height,
        seed,
        enhance_prompt: enhancePrompt,
      });
      return { taskId: result.taskId };
    },
  });
}

// ── 图片编辑工作流快捷工厂 ───────────────────────────────────────────

export interface ImageEditWorkflowConfig<TVars extends WorkflowVarsBase = WorkflowVarsBase> {
  /** 工作流类型，如 image-edit */
  type: string;
  name: string;
  impl: string;
  description?: string;
  /** 可由用户手动传入的参数声明（可选，前端据此渲染输入表单） */
  params?: WorkflowUserParamDeclaration[];
  getParams(ctx: WorkflowRunContext<TVars>): Promise<{
    desc: string;
    imgs: File[];
    seed?: string | number;
  }>;
}

/**
 * 创建图片编辑工作流的快捷工厂。
 *
 * 调用方只需提供 getParams（返回 desc / imgs / seed）；
 * 内部通过 ctx.provider 以 multipart 提交到 qwen-edit-2509 工作流。
 */
export function createImageEditWorkflow<TVars extends WorkflowVarsBase = WorkflowVarsBase>(
  config: ImageEditWorkflowConfig<TVars>,
): WorkflowDefinition<TVars> {
  return createProviderWorkflow<TVars>({
    baseDefinition: {
      type: config.type,
      name: config.name,
      impl: config.impl,
      description: config.description,
      params: config.params,
    },
    async submit(ctx) {
      const { desc, imgs, seed } = await config.getParams(ctx);
      if (!imgs.length) {
        throw new Error('Image edit workflow requires at least one input image');
      }
      const size = resolveImageEditSizeParams(ctx.vars as unknown as Record<string, string | undefined>);
      const result = await submitImageEdit(ctx.provider, { imgs, desc, seed, ...size });
      return { taskId: result.taskId };
    },
  });
}

// ── TTS 音色设计工作流快捷工厂 ───────────────────────────────────────

export interface TtsWorkflowParam {
  desc: string;
  text: string;
  seed?: string;
}

/**
 * 创建 TTS 音色设计工作流的快捷工厂。
 *
 * 调用方只需提供 getTtsWorkflowParams（返回 desc / text / seed）；
 * submit 通过 ctx.provider 提交到 tts_voice_design 工作流。
 */
export function createTtsDesignWorkflow<TVars extends WorkflowVarsBase = WorkflowVarsBase>(
  baseDefinition: WorkflowBaseDefinition,
  getTtsWorkflowParams: (ctx: WorkflowRunContext<TVars>) => Promise<TtsWorkflowParam> | TtsWorkflowParam,
): WorkflowDefinition<TVars> {
  return createProviderWorkflow<TVars>({
    baseDefinition,
    async submit(ctx) {
      return ctx.provider.execute({
        workflowId: 'tts_voice_design',
        params: {
          ...(await getTtsWorkflowParams(ctx)),
        },
      });
    },
  });
}
```

> 注意：删除文件用 `Remove-Item server/src/workflows/bridge-client.ts`，再用 create 工具重建。

- [ ] **Step 3: 更新 `image-to-video/default.ts`**

把导入：

```ts
import {
  createComfyuiBridgeWorkflow,
  submitImageToVideo,
  submitLtxDirectorImageToVideo,
} from '../bridge-client.js';
```

改为：

```ts
import {
  createProviderWorkflow,
  submitImageToVideo,
  submitLtxDirectorImageToVideo,
} from '../bridge-client.js';
```

把 `createComfyuiBridgeWorkflow<ImageToVideoVars>({` 改为 `createProviderWorkflow<ImageToVideoVars>({`。

把两处调用（director 与 first-last-frame）的第一个参数改为 `ctx.provider`：
- `await submitLtxDirectorImageToVideo({` → `await submitLtxDirectorImageToVideo(ctx.provider, {`
- `await submitImageToVideo({` → `await submitImageToVideo(ctx.provider, {`

- [ ] **Step 4: 更新 `image-to-video/minimax-h3-r2v.ts`**

把导入：

```ts
import { register } from '../registry.js';
import { createComfyuiBridgeWorkflow, submitReferenceVideo, submitMinimaxH3Fl2v } from '../bridge-client.js';
```

改为：

```ts
import { register } from '../registry.js';
import { createProviderWorkflow, submitReferenceVideo, submitMinimaxH3Fl2v } from '../bridge-client.js';
```

把 `createComfyuiBridgeWorkflow<ImageToVideoVars>({` 改为 `createProviderWorkflow<ImageToVideoVars>({`。

把两处调用：
- `await submitMinimaxH3Fl2v({` → `await submitMinimaxH3Fl2v(ctx.provider, {`
- `const result = await submitReferenceVideo({` → `const result = await submitReferenceVideo(ctx.provider, {`

- [ ] **Step 5: 重写 `workflows/bridge-client.test.ts`**

删除并重建（保留 resolveImageEditSizeParams 纯函数用例；submitLtxDirectorImageToVideo 改为用 mock client 验证参数组装）：

```ts
import { describe, expect, it, vi } from 'vitest';
import { resolveImageEditSizeParams, submitLtxDirectorImageToVideo } from './bridge-client.js';
import type { ProviderClient } from '../providers/types.js';

describe('resolveImageEditSizeParams', () => {
  it('enable_specified_size=true 时解析出启用的宽高（数字）', () => {
    expect(
      resolveImageEditSizeParams({
        enable_specified_size: 'true',
        width: '1920',
        height: '1080',
      }),
    ).toEqual({ enable_specified_size: true, width: 1920, height: 1080 });
  });

  it('enable_specified_size=false 时不返回任何尺寸参数', () => {
    expect(
      resolveImageEditSizeParams({ enable_specified_size: 'false', width: '1920', height: '1080' }),
    ).toEqual({});
  });

  it('未声明 enable_specified_size 时不返回任何尺寸参数', () => {
    expect(resolveImageEditSizeParams({ width: '1920', height: '1080' })).toEqual({});
  });

  it('启用但未提供宽高时只返回启用标记', () => {
    expect(resolveImageEditSizeParams({ enable_specified_size: 'true' })).toEqual({
      enable_specified_size: true,
    });
  });

  it('非法宽高值被忽略', () => {
    expect(
      resolveImageEditSizeParams({ enable_specified_size: 'true', width: 'abc', height: '' }),
    ).toEqual({ enable_specified_size: true });
  });

  it('小数宽高取整', () => {
    expect(
      resolveImageEditSizeParams({ enable_specified_size: 'true', width: '1920.5', height: '1080.5' }),
    ).toEqual({ enable_specified_size: true, width: 1921, height: 1081 });
  });
});

describe('submitLtxDirectorImageToVideo', () => {
  it('构造 ltx-2.3-director 提交参数与动态文件键，调用 client.execute', async () => {
    const execute = vi.fn(async () => ({ taskId: 'task-123' }));
    const client = { execute } as unknown as ProviderClient;
    const file0 = new File(['f0'], 'f0.png', { type: 'image/png' });
    const file1 = new File(['f1'], 'f1.png', { type: 'image/png' });

    const result = await submitLtxDirectorImageToVideo(client, {
      prompt: '镜头推进',
      width: 1920,
      height: 1080,
      duration: 5,
      fps: 24,
      seed: 42,
      frames: [
        { file: file0, cursor: 0 },
        { file: file1, cursor: 0.5 },
      ],
    });

    expect(result.taskId).toBe('task-123');
    expect(execute).toHaveBeenCalledTimes(1);
    const arg = execute.mock.calls[0][0] as {
      workflowId: string;
      params: Record<string, unknown>;
      files: Record<string, File>;
    };
    expect(arg.workflowId).toBe('ltx-2.3-director');
    expect(arg.params).toMatchObject({
      prompt: '镜头推进',
      width: 1920,
      height: 1080,
      duration: 5,
      fps: 24,
      seed: 42,
      auto_generate_audio: true,
    });
    expect(arg.params.frame_define).toBe(
      JSON.stringify([
        { frameSeq: 0, cursor: 0 },
        { frameSeq: 1, cursor: 0.5 },
      ]),
    );
    expect(Object.keys(arg.files)).toEqual(['frame_0', 'frame_1']);
    expect(arg.files.frame_0).toBe(file0);
    expect(arg.files.frame_1).toBe(file1);
  });
});
```

- [ ] **Step 6: 更新 `image-to-video/default.test.ts` 的 vi.mock**

把：

```ts
vi.mock('../bridge-client.js', () => ({
  submitLtxDirectorImageToVideo,
  submitImageToVideo,
  submitComfyuiBridge: vi.fn(),
  pollTask: vi.fn(),
  buildDownloadRequest: vi.fn(),
  // 与真实工厂一致：把 baseDefinition 拍平到定义顶层（register 需要顶层 type/impl）
  createComfyuiBridgeWorkflow: (def: { baseDefinition: Record<string, unknown>; submit: unknown }) => ({
    ...def.baseDefinition,
    submit: def.submit,
  }),
}));
```

改为：

```ts
vi.mock('../bridge-client.js', () => ({
  submitLtxDirectorImageToVideo,
  submitImageToVideo,
  // 与真实工厂一致：把 baseDefinition 拍平到定义顶层并带上 provider（register 需要顶层 type/impl）
  createProviderWorkflow: (def: {
    provider?: string;
    baseDefinition: Record<string, unknown>;
    submit: unknown;
  }) => ({
    ...def.baseDefinition,
    provider: def.provider ?? 'comfyui-bridge',
    submit: def.submit,
  }),
}));
```

- [ ] **Step 7: 更新 `image-to-video/minimax.test.ts` 的 mkContext（换真实 client 保全链路）**

把：

```ts
/** provider stub：Task 9 将换成真实 comfyui-bridge client 以保留全链路 fetch 覆盖 */
const stubProvider = {
  execute: async () => ({ taskId: 'mock' }),
  poll: async () => ({ status: 'completed', progress: 100, done: true, errorMessage: null }),
  getOutput: async () => null,
  cancel: async () => {},
} as WorkflowRunContext['provider'];
```

改为（使用真实 client，网络边界仍是全局 fetch mock）：

```ts
import { createComfyuiBridgeClient } from '../../providers/comfyui-bridge/client.js';
```

（放在文件顶部 import 区，`import './minimax-h3-r2v.js';` 之后）

```ts
/** 真实 comfyui-bridge client：submitReferenceVideo → client.execute → fetch 全链路（网络边界由全局 fetch mock 覆盖） */
const stubProvider = createComfyuiBridgeClient({
  baseUrl: 'http://localhost:10721',
  password: '0d000721',
});
```

- [ ] **Step 8: 验证**

Run: `cd server && npx tsc --noEmit` → Expected: 0 错误
Run: `cd server && npm test` → Expected: 全部通过

> 若报错 `submitComfyuiBridge` 等未导出，说明还有文件引用旧导出——用 `grep -rn "submitComfyuiBridge\|pollTask\|buildDownloadRequest\|cancelBridgeTask\|createComfyuiBridgeWorkflow" server/src` 排查并清理。

- [ ] **Step 9: 提交**

```bash
git add -A server/src/workflows
git commit -m "refactor: 工作流层改 Provider 驱动（移除 poll/parseOutput；工厂改 createProviderWorkflow；submit 辅助函数首参为 client）"
```

---

## Task 10: 前端 API 封装

**Files:**
- Create: `frontend/src/api/providers.ts`

- [ ] **Step 1: 创建 `frontend/src/api/providers.ts`**

```ts
import client from './client'

/** Provider 配置字段类型 */
export type ProviderConfigFieldType = 'string' | 'password' | 'number' | 'boolean' | 'select'

/** Provider 配置字段声明（服务端 configSchema 透传，驱动设置表单） */
export interface ProviderConfigField {
  /** 配置键，如 baseUrl / password / apiKey */
  key: string
  /** 中文标签 */
  label: string
  /** 字段类型 */
  type: ProviderConfigFieldType
  /** 是否必填 */
  required?: boolean
  /** 默认值 */
  defaultValue?: string | number | boolean
  /** 输入框占位文案 */
  placeholder?: string
  /** 敏感字段：已保存时服务端返回 '__set__' 占位 */
  secret?: boolean
  /** select 类型可选项 */
  options?: { label: string; value: string }[]
  /** 字段说明（表单 hint） */
  description?: string
  /** 环境变量兜底名 */
  envVar?: string
}

/** Provider 信息（GET /api/providers 返回） */
export interface ProviderInfo {
  id: string
  name: string
  description?: string
  configSchema: ProviderConfigField[]
  /** 当前已保存配置；secret 字段有值时为 '__set__' 占位 */
  config: Record<string, string | number | boolean>
}

/** 敏感字段占位符（与服务端 MASKED_SECRET 对齐） */
export const MASKED_SECRET = '__set__'

/** GET /api/providers — 列出所有 provider 及其配置（secret 脱敏） */
export async function getProviders(): Promise<ProviderInfo[]> {
  const { data } = await client.get<{ providers: ProviderInfo[] }>('/providers')
  return data.providers
}

/**
 * PUT /api/providers/:id — 保存 provider 配置。
 * @param id provider id
 * @param config 配置键值；secret 字段传空串或不传 = 服务端保留原值
 */
export async function saveProviderConfig(
  id: string,
  config: Record<string, unknown>,
): Promise<{ success: boolean }> {
  const { data } = await client.put<{ success: boolean }>(`/providers/${id}`, { config })
  return data
}
```

- [ ] **Step 2: 验证前端类型检查**

Run: `cd frontend && npx vue-tsc --noEmit --skipLibCheck`
Expected: 0 错误

- [ ] **Step 3: 提交**

```bash
git add frontend/src/api/providers.ts
git commit -m "feat: 前端 Provider API 封装（getProviders / saveProviderConfig）"
```

---

## Task 11: 前端设置对话框 + 入口

**Files:**
- Create: `frontend/src/components/ProviderSettingsDialog.vue`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/api/workflow.ts`

- [ ] **Step 1: 创建 `frontend/src/components/ProviderSettingsDialog.vue`**

```vue
<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon icon="mdi-cog" class="mr-2" />
        服务商配置
        <v-spacer />
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text>
        <v-alert
          v-if="error"
          type="error"
          class="mb-3"
          :text="error"
          closable
          @click:close="error = ''"
        />
        <div v-if="loading" class="d-flex justify-center pa-6">
          <v-progress-circular indeterminate />
        </div>
        <template v-else>
          <v-card
            v-for="p in providers"
            :key="p.id"
            variant="outlined"
            class="mb-4"
          >
            <v-card-title class="text-subtitle-1 font-weight-bold">
              {{ p.name }}
              <span class="text-caption text-medium-emphasis ml-2">{{ p.id }}</span>
            </v-card-title>
            <v-card-text>
              <p v-if="p.description" class="text-body-2 text-medium-emphasis mb-3">
                {{ p.description }}
              </p>

              <!-- boolean 字段 -->
              <v-switch
                v-for="f in booleanFields(p)"
                :key="f.key"
                v-model="forms[p.id][f.key]"
                :label="f.label"
                :hint="f.description"
                persistent-hint
                color="primary"
                class="mt-0"
              />

              <!-- select 字段 -->
              <v-select
                v-for="f in selectFields(p)"
                :key="f.key"
                v-model="forms[p.id][f.key]"
                :label="f.label"
                :items="f.options ?? []"
                item-title="label"
                item-value="value"
                :hint="f.description"
                persistent-hint
                density="comfortable"
                class="mt-2"
              />

              <!-- string / password / number 字段 -->
              <v-text-field
                v-for="f in textFields(p)"
                :key="f.key"
                v-model="forms[p.id][f.key]"
                :label="f.label"
                :type="fieldInputType(p, f)"
                :append-inner-icon="f.type === 'password' ? (showSecret[p.id + '/' + f.key] ? 'mdi-eye-off' : 'mdi-eye') : undefined"
                :placeholder="f.type === 'password' && forms[p.id][f.key] === MASKED_SECRET ? '已设置（留空保持不变）' : f.placeholder"
                :hint="f.description"
                persistent-hint
                density="comfortable"
                class="mt-2"
                @click:append-inner="toggleSecret(p, f)"
              />

              <div class="d-flex justify-end">
                <v-btn
                  color="primary"
                  variant="tonal"
                  size="small"
                  :loading="saving[p.id]"
                  @click="save(p)"
                >
                  保存
                </v-btn>
              </div>
            </v-card-text>
          </v-card>
        </template>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  MASKED_SECRET,
  getProviders,
  saveProviderConfig,
  type ProviderConfigField,
  type ProviderInfo,
} from '../api/providers'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const providers = ref<ProviderInfo[]>([])
const loading = ref(false)
const saving = ref<Record<string, boolean>>({})
const error = ref('')
const showSecret = ref<Record<string, boolean>>({})
const forms = ref<Record<string, Record<string, string | number | boolean>>>({})

/** 构建表单初始值：已保存值（secret 为 '__set__' 时保持占位），否则 defaultValue */
function buildForm(p: ProviderInfo): Record<string, string | number | boolean> {
  const form: Record<string, string | number | boolean> = {}
  for (const f of p.configSchema) {
    if (p.config[f.key] !== undefined) {
      form[f.key] = p.config[f.key]
    } else if (f.defaultValue !== undefined) {
      form[f.key] = f.defaultValue
    } else {
      form[f.key] = f.type === 'boolean' ? false : ''
    }
  }
  return form
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const list = await getProviders()
    providers.value = list
    forms.value = {}
    for (const p of list) {
      forms.value[p.id] = buildForm(p)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) load()
  },
)

function toggleSecret(p: ProviderInfo, f: ProviderConfigField) {
  const key = p.id + '/' + f.key
  showSecret.value[key] = !showSecret.value[key]
}

function fieldInputType(p: ProviderInfo, f: ProviderConfigField): string {
  if (f.type === 'number') return 'number'
  if (f.type === 'password') {
    return showSecret.value[p.id + '/' + f.key] ? 'text' : 'password'
  }
  return 'text'
}

const booleanFields = (p: ProviderInfo) => p.configSchema.filter((f) => f.type === 'boolean')
const selectFields = (p: ProviderInfo) => p.configSchema.filter((f) => f.type === 'select')
const textFields = (p: ProviderInfo) =>
  p.configSchema.filter((f) => f.type === 'string' || f.type === 'password' || f.type === 'number')

async function save(p: ProviderInfo) {
  saving.value[p.id] = true
  error.value = ''
  try {
    const payload: Record<string, unknown> = { ...forms.value[p.id] }
    // secret 占位符不上送（服务端空串 = 保留原值）
    for (const f of p.configSchema) {
      if (f.secret && payload[f.key] === MASKED_SECRET) {
        delete payload[f.key]
      }
    }
    await saveProviderConfig(p.id, payload)
    // 保存成功后重新加载，刷新 '__set__' 占位
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value[p.id] = false
  }
}
</script>
```

> 说明：模板中 `:model-value="modelValue"` / `@update:model-value` 已用 props.modelValue / emit 绑定；模板可直接引用 `modelValue`（defineProps 解构到模板作用域），无需在脚本中解构。若 vue-tsc 报模板无法识别 `modelValue`，改用 `props.modelValue` 或保留 `const { modelValue } = defineProps(...)` 并确认 lint 规则允许（vue/no-setup-props-destructure 默认 warn，不阻断）。

- [ ] **Step 2: 修改 `frontend/src/App.vue`**

模板改为：

```vue
<template>
  <v-app>
    <v-app-bar
      color="primary"
      elevation="2"
    >
      <v-btn
        v-if="$route.path !== '/'"
        icon="mdi-arrow-left"
        variant="text"
        color="white"
        @click="$router.push('/')"
      />
      <v-toolbar-title class="text-white">
        视频项目管理器
      </v-toolbar-title>
      <v-spacer />
      <v-btn
        icon="mdi-cog"
        variant="text"
        color="white"
        aria-label="服务商配置"
        @click="showProviderSettings = true"
      />
    </v-app-bar>
    <v-main>
      <router-view />
    </v-main>
    <ProviderSettingsDialog v-model="showProviderSettings" />
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ProviderSettingsDialog from './components/ProviderSettingsDialog.vue'

const showProviderSettings = ref(false)
</script>
```

- [ ] **Step 3: `frontend/src/api/workflow.ts` 的 WorkflowImplementation 加 provider 字段**

在 `description?: string` 之后加：

```ts
  /** 该实现使用的 Provider 插件 ID（如 comfyui-bridge） */
  provider?: string
```

- [ ] **Step 4: 验证前端类型检查 + lint**

Run: `cd frontend && npx vue-tsc --noEmit --skipLibCheck` → Expected: 0 错误
Run: `cd .. && npm run lint` → Expected: 无新增错误（仅 refs.ts 既有 2 个 warning）

> 若 `vue/no-setup-props-destructure` 等 lint 规则报错，按提示调整（ProviderSettingsDialog 使用单次 defineProps + watch props）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/ProviderSettingsDialog.vue frontend/src/App.vue frontend/src/api/workflow.ts
git commit -m "feat: 服务商配置设置对话框（configSchema 驱动表单 + 顶栏齿轮入口）"
```

---

## Task 12: gitignore + 全量验证 + API 冒烟

**Files:**
- Modify: `.gitignore`
- Modify: `docs/superpowers/plans/2026-08-07-provider-config.md`（本计划，最后标记完成）

- [ ] **Step 1: `.gitignore` 追加配置路径**

在 `.gitignore` 末尾追加：

```
server/config/providers.json*
```

（`*` 覆盖原子写产生的 `providers.json.tmp`）

- [ ] **Step 2: 全量验证**

Run: `npm run typecheck` → Expected: 0 错误（server + frontend）
Run: `npm run lint` → Expected: 仅 refs.ts 既有 warning
Run: `cd server && npm test` → Expected: 全部通过（原 74 + provider 层新增用例）
Run: `cd frontend && npm test` → Expected: 全部通过（原 167）

- [ ] **Step 3: API 冒烟（避开主工作区占用端口，用 3101）**

启动：`cd server && $env:PORT='3101'; npx tsx src/index.ts`（async 模式后台运行）

验证 GET：
```powershell
Invoke-RestMethod -Uri 'http://localhost:3101/api/providers' | ConvertTo-Json -Depth 6
```
Expected: `providers` 数组含 `comfyui-bridge`，configSchema 含 baseUrl/password，password 未在文件中配置所以 config 里没有它。

验证 PUT（保存后 GET 应显示 password 为 `__set__`）：
```powershell
Invoke-RestMethod -Method Put -Uri 'http://localhost:3101/api/providers/comfyui-bridge' -ContentType 'application/json' -Body '{"config":{"baseUrl":"http://localhost:10721","password":"mypw"}}'
Invoke-RestMethod -Uri 'http://localhost:3101/api/providers' | ConvertTo-Json -Depth 6
```
Expected: 第二个 GET 中 comfyui-bridge.config.password === '__set__'；且 `server/config/providers.json` 文件已生成（内容含明文密码——本地工具可接受）。

验证 PUT 校验：
```powershell
Invoke-RestMethod -Method Put -Uri 'http://localhost:3101/api/providers/no-such' -ContentType 'application/json' -Body '{"config":{}}'
```
Expected: 400（`Provider 未注册: no-such`）

验证后删除测试写入的配置，恢复干净状态：
```powershell
Invoke-RestMethod -Method Put -Uri 'http://localhost:3101/api/providers/comfyui-bridge' -ContentType 'application/json' -Body '{"config":{"baseUrl":"http://localhost:10721"}}'
```
（password 不传 = 保留，但文件里已无明文测试值；随后停掉后台服务并删除 `server/config/providers.json` 即可彻底清空）

停止后台服务（kill 对应终端），并确认 `git status` 不包含 `server/config/providers.json`（已被 gitignore）。

- [ ] **Step 4: 全量测试复跑 + 提交**

Run: `cd server && npm test` → Expected: 全部通过
Run: `cd frontend && npm test` → Expected: 全部通过

```bash
git add .gitignore
git commit -m "chore: 忽略 server/config/providers.json（Provider 配置含密钥不入 git）"
```

- [ ] **Step 5: 收尾**

- 可选浏览器验证（若 3001/5233 端口空闲）：`npm run dev` 后打开 `http://localhost:5233`，点顶栏齿轮，确认弹出「服务商配置」对话框、显示 ComfyUI Easy Bridge 卡片与 baseUrl/password 字段，修改后保存无报错。**若端口被主工作区占用，跳过浏览器验证，以 Step 3 的 API 冒烟为准。**
- 更新设计文档/仓库记忆（如需）：本功能核心事实（providers/ 目录、config-store、createProviderWorkflow、ctx.provider）可追加到 `/memories/repo/ai-video-workstation.md`。

---

## 自审记录（执行前已检查）

- **Spec 覆盖**：Provider 类型/注册表/配置存储（Task 1-3）、comfyui-bridge 插件（Task 4-5）、目录自动发现 + 启动接线（Task 6）、/api/providers（Task 7）、引擎 provider 驱动 + 移除 poll/parseOutput（Task 8-9）、前端 API + 设置对话框 + 齿轮入口（Task 10-11）、gitignore + 验证（Task 12）。全部 spec §4-§12 均有对应任务。
- **占位符扫描**：所有步骤含完整代码与期望输出；无 TBD/TODO。
- **类型一致性**：`ProviderClient.execute/poll/getOutput/cancel` 全计划一致；`createProviderWorkflow`（对象参数，provider 默认 comfyui-bridge）在所有引用处一致；`submitXxx(client, params)` 签名在 Task 9 实现与 Task 9 测试中一致；`MASKED_SECRET`/`__set__` 服务端与前端一致。
