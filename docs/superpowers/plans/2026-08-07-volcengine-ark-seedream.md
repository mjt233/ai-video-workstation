# 火山方舟（Seedream 5.0 pro/lite）提供商实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增火山方舟 Provider 插件与 4 个 Seedream 工作流实现（文生图 pro/lite + 图片编辑 pro/lite），并支持同步 API 的延迟生效取消。

**Architecture:** 遵循现有 Provider 插件架构（与 `comfyui-bridge` 对称）：新增 `providers/volcengine-ark/`（configSchema + 同步客户端，把同步 API 适配为任务式 ProviderClient），新增 `workflows/seedream.ts`（共享提交辅助），在 `text-to-image/` 与 `image-edit/` 各注册 2 个实现（声明 `deferredCancel`）。取消走「标记 + 引擎执行完成后检查」机制。前端零改动（configSchema 驱动设置表单、下拉自动列出实现）。

**Tech Stack:** TypeScript（ESM）、Express、vitest；火山方舟 OpenAI 兼容 `POST /images/generations`（同步 API，Bearer API Key）。

**规格文档：** `docs/superpowers/specs/2026-08-07-volcengine-ark-seedream-design.md`

**常量速查：**
- pro 模型 ID：`doubao-seedream-5-0-pro-260628`
- lite 模型 ID：`doubao-seedream-5-0-260128`
- 端点：`POST {baseUrl}/images/generations`，默认 baseUrl `https://ark.cn-beijing.volces.com/api/v3`
- 请求体：`{model, prompt, image?, size, output_format:'jpeg', watermark:false, response_format:'url', optimize_prompt_options?}`
- 响应：`{data:[{url}]}`；错误非 2xx 或 `data` 为空
- 显式尺寸约束：总像素 `[921600, 4624220]`、宽高比 `[1/16, 16]`；否则回退 `"2K"`
- 图片输入：base64 data URL，1 张=字符串、2~10 张=数组，单图 ≤30MB

---

## 文件结构

**新建：**
- `server/src/providers/volcengine-ark/client.ts` — 火山方舟传输客户端（同步 API 适配任务式接口）+ `fileToDataUrl`
- `server/src/providers/volcengine-ark/client.test.ts` — 客户端测试
- `server/src/providers/volcengine-ark/index.ts` — Provider 插件定义（configSchema + createClient）
- `server/src/workflows/cancel.ts` — 取消标记纯函数（mark/strip/isCancelRequested）
- `server/src/workflows/cancel.test.ts` — 取消标记测试
- `server/src/workflows/seedream.ts` — Seedream 共享提交辅助（resolveSeedreamSize / submitSeedreamTextToImage / submitSeedreamImageEdit）
- `server/src/workflows/seedream.test.ts` — 辅助函数测试
- `server/src/workflows/text-to-image/seedream.ts` — 文生图 2 个实现
- `server/src/workflows/text-to-image/seedream.test.ts` — 文生图实现测试
- `server/src/workflows/image-edit/seedream.ts` — 图片编辑 2 个实现
- `server/src/workflows/image-edit/seedream.test.ts` — 图片编辑实现测试

**修改：**
- `server/src/workflows/types.ts` — `WorkflowCapabilities` 增加 `deferredCancel`
- `server/src/routes/workflow.ts` — `canCancelTask` 放宽、取消路由 deferred 分支、retry 剥离标记
- `server/src/routes/workflow.test.ts` — 增加 canCancelTask deferredCancel 用例
- `server/src/workflow-engine.ts` — 写盘前取消标记检查

---

### Task 1: 中断基础设施 — deferredCancel 能力 + 取消标记纯函数

**Files:**
- Modify: `server/src/workflows/types.ts`（WorkflowCapabilities 增加 `deferredCancel`）
- Create: `server/src/workflows/cancel.ts`
- Create: `server/src/workflows/cancel.test.ts`
- Modify: `server/src/routes/workflow.ts`（`canCancelTask`）
- Modify: `server/src/routes/workflow.test.ts`

- [ ] **Step 1: 在 `WorkflowCapabilities` 增加 `deferredCancel`**

在 `server/src/workflows/types.ts` 的 `WorkflowCapabilities` 接口中，`cancelable` 字段之后追加：

```ts
  /** 是否支持中断（所有 Bridge 工作流声明 true） */
  cancelable?: boolean;
  /**
   * 取消是否延迟生效：该 provider 的执行是同步的（execute 阻塞到完成），无法中止在途请求；
   * 取消请求被接受并写入任务标记（params.cancelRequested），任务在执行完成后持久化为失败（用户中断）而非完成。
   */
  deferredCancel?: boolean;
```

- [ ] **Step 2: 创建 `server/src/workflows/cancel.ts`（取消标记纯函数）**

```ts
/**
 * 任务取消标记（同步执行 provider 的「延迟生效」取消）纯函数。
 *
 * 同步 provider（如火山方舟）无法中止在途请求：取消请求被接受后把
 * `cancelRequested: true` 写入任务 params，引擎在 execute 完成后检查并
 * 把任务持久化为失败（用户中断），而非完成。
 */

/** 标记任务为「已请求取消」（写入 params.cancelRequested）。 */
export function markCancelRequested(params: object): object {
  return { ...params, cancelRequested: true };
}

/** 剥离任务运行时取消标记（重试复制 params 时使用，避免旧标记影响新任务）。 */
export function stripCancelRequested(params: object): object {
  const out: Record<string, unknown> = { ...params };
  delete out.cancelRequested;
  return out;
}

/** 判断任务 params 是否含取消标记（cancelRequested === true）。 */
export function isCancelRequested(params: object): boolean {
  return (params as Record<string, unknown>).cancelRequested === true;
}
```

- [ ] **Step 3: 创建 `server/src/workflows/cancel.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { isCancelRequested, markCancelRequested, stripCancelRequested } from './cancel.js';

describe('任务取消标记纯函数', () => {
  it('markCancelRequested 写入取消标记且保留原字段', () => {
    expect(markCancelRequested({ vars: {}, outputPath: 'assert/x.jpg' })).toEqual({
      vars: {},
      outputPath: 'assert/x.jpg',
      cancelRequested: true,
    });
  });

  it('stripCancelRequested 剥离取消标记，无标记时原样返回', () => {
    expect(stripCancelRequested({ vars: {}, cancelRequested: true })).toEqual({ vars: {} });
    expect(stripCancelRequested({ vars: {} })).toEqual({ vars: {} });
  });

  it('isCancelRequested 检测取消标记', () => {
    expect(isCancelRequested({ cancelRequested: true })).toBe(true);
    expect(isCancelRequested({ cancelRequested: false })).toBe(false);
    expect(isCancelRequested({})).toBe(false);
    expect(isCancelRequested({ cancelRequested: 'true' })).toBe(false);
  });
});
```

- [ ] **Step 4: 运行 cancel 测试确认通过**

Run: `cd server && npx vitest run src/workflows/cancel.test.ts`
Expected: 3 个用例全过。

- [ ] **Step 5: 在 `server/src/routes/workflow.test.ts` 增加 deferredCancel 用例**

在 `describe('中断支持')` 中、`canCancelTask：running 但无远端任务 ID 拒绝` 用例之后追加：

```ts
  it('canCancelTask：running 无远端任务 ID + deferredCancel → ok（同步 provider 延迟生效）', () => {
    const result = canCancelTask(
      mkTask({ params: JSON.stringify({ vars: {} }) }),
      { capabilities: { cancelable: true, deferredCancel: true } },
    );
    expect(result.ok).toBe(true);
  });
```

- [ ] **Step 6: 运行该测试确认失败**

Run: `cd server && npx vitest run src/routes/workflow.test.ts`
Expected: 新增用例 FAIL（`canCancelTask` 尚未放宽）。

- [ ] **Step 7: 修改 `canCancelTask`（`server/src/routes/workflow.ts`）**

将（约 196-199 行）：

```ts
  if (!getRemoteTaskId(task)) {
    return { ok: false, status: 400, code: 'no_remote_task', message: '任务尚未提交到远端，无法中断' };
  }
  return { ok: true };
```

替换为：

```ts
  if (!getRemoteTaskId(task) && !wf?.capabilities?.deferredCancel) {
    return { ok: false, status: 400, code: 'no_remote_task', message: '任务尚未提交到远端，无法中断' };
  }
  return { ok: true };
```

- [ ] **Step 8: 运行 workflow 测试确认通过**

Run: `cd server && npx vitest run src/routes/workflow.test.ts`
Expected: 全部通过（含新增用例；既有 `no_remote_task` 用例对非 deferredCancel 仍通过）。

- [ ] **Step 9: typecheck + lint**

Run: `npm run typecheck`
Expected: 0 错误。
Run: `npm run lint`
Expected: 0 错误（仅 `refs.ts` 既有 warning）。

- [ ] **Step 10: 提交**

```bash
git add server/src/workflows/types.ts server/src/workflows/cancel.ts server/src/workflows/cancel.test.ts server/src/routes/workflow.ts server/src/routes/workflow.test.ts
# 提交信息写 UTF-8 无 BOM 临时文件（PowerShell -m 中文会乱码）：
# "feat: 同步 provider 延迟生效取消（deferredCancel 能力 + 取消标记纯函数）"
```

---

### Task 2: 取消路由 deferred 分支 + retry 剥离 + 引擎取消回调

**Files:**
- Modify: `server/src/routes/workflow.ts`（取消路由 + retry 路由 + import）
- Modify: `server/src/workflow-engine.ts`（写盘前取消标记检查）

- [ ] **Step 1: 在 `server/src/routes/workflow.ts` 顶部加 import**

在现有 import 区追加：

```ts
import { markCancelRequested, stripCancelRequested } from '../workflows/cancel.js';
```

- [ ] **Step 2: 修改取消路由（deferred 分支）**

将（约 277-287 行）的 try 块：

```ts
  try {
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
    db.updateTaskStatus(task.id, 'failed', { error_msg: '用户中断' });
    db.addLog(task.id, 'info', 'Task cancelled by user');
    res.json({ taskId: task.id, status: 'failed' });
  } catch (e) {
```

替换为：

```ts
  try {
    if (task.status === 'running') {
      // 同步执行 provider（deferredCancel）：无法中止在途请求 → 写取消标记，
      // 由引擎在 execute 完成后检查并持久化为失败（用户中断）；不立即标记 failed（避免引擎完成后覆盖）
      if (wf?.capabilities?.deferredCancel) {
        db.updateTaskParams(task.id, markCancelRequested(JSON.parse(task.params)));
        db.addLog(task.id, 'info', 'Cancellation requested; will take effect after execution completes');
        res.json({ taskId: task.id, status: 'cancelling' });
        return;
      }
      const providerId = wf?.provider ?? 'comfyui-bridge';
      const providerDef = getProvider(providerId);
      if (!providerDef) {
        throw new Error(`provider 未注册: ${providerId}`);
      }
      await providerDef
        .createClient(await getProviderConfig(providerId))
        .cancel(getRemoteTaskId(task)!);
    }
    db.updateTaskStatus(task.id, 'failed', { error_msg: '用户中断' });
    db.addLog(task.id, 'info', 'Task cancelled by user');
    res.json({ taskId: task.id, status: 'failed' });
  } catch (e) {
```

- [ ] **Step 3: 修改 retry 路由（剥离取消标记）**

将（约 243-252 行）：

```ts
  const newTaskId = uuidv4();
  db.createTask({
    id: newTaskId,
    project: existing.project,
    workflow_id: existing.workflow_id,
    impl: existing.impl,
    params: JSON.parse(existing.params),
    batch_id: existing.batch_id ?? undefined,
    phase: existing.phase,
  });
```

替换为：

```ts
  const newTaskId = uuidv4();
  db.createTask({
    id: newTaskId,
    project: existing.project,
    workflow_id: existing.workflow_id,
    impl: existing.impl,
    params: stripCancelRequested(JSON.parse(existing.params)),
    batch_id: existing.batch_id ?? undefined,
    phase: existing.phase,
  });
```

- [ ] **Step 4: 在 `server/src/workflow-engine.ts` 顶部加 import**

在现有 import 区追加：

```ts
import { isCancelRequested } from './workflows/cancel.js';
```

- [ ] **Step 5: 引擎写盘前检查取消标记**

在 `runTask` 的 Step 4 中，`const assertDir = path.dirname(assertFullPath);` 之后、`// 重复生成时，将已有资产归档到历史版本` 之前插入：

```ts
    // 同步 provider（deferredCancel）取消回调：execute 完成后检查取消标记，
    // 已请求取消 → 持久化失败（用户中断），不归档已有资产、不写产物
    const freshTask = db.getTask(taskId);
    if (freshTask && isCancelRequested(JSON.parse(freshTask.params))) {
      throw new Error('用户中断');
    }
```

- [ ] **Step 6: typecheck + lint + 全量 server 测试**

Run: `npm run typecheck`
Expected: 0 错误。
Run: `npm run lint`
Expected: 0 错误（仅 refs.ts 既有 warning）。
Run: `cd server && npm test`
Expected: 全部通过（回归）。

- [ ] **Step 7: 提交**

```bash
git add server/src/routes/workflow.ts server/src/workflow-engine.ts
# 提交信息（UTF-8 无 BOM 文件）：
# "feat: 同步 provider 取消走标记+引擎执行完成回调（cancel 路由 deferred 分支 / retry 剥离 / 引擎写盘前检查）"
```

---

### Task 3: 火山方舟 Provider 客户端（TDD）

**Files:**
- Create: `server/src/providers/volcengine-ark/client.test.ts`
- Create: `server/src/providers/volcengine-ark/client.ts`

- [ ] **Step 1: 创建 `server/src/providers/volcengine-ark/client.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVolcengineArkClient, fileToDataUrl } from './client.js';

describe('createVolcengineArkClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('execute 同步提交 images/generations，url 响应缓存为 download 输出', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://tos/out.jpg' }] }),
    } as unknown as Response);

    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark/', timeout: 900 });
    const { taskId } = await client.execute({
      workflowId: 'doubao-seedream-5-0-pro-260628',
      params: { prompt: '猫', size: '1080x1920', watermark: false, output_format: 'jpeg', response_format: 'url' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://ark/images/generations');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'Authorization': 'Bearer k' });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('doubao-seedream-5-0-pro-260628');
    expect(body.watermark).toBe(false);

    const out = await client.getOutput(taskId);
    expect(out).toEqual({ type: 'download', url: 'https://tos/out.jpg', filename: 'output.jpg' });
  });

  it('b64_json 响应缓存为 body 输出', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'QUJD' }] }),
    } as unknown as Response);

    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    const { taskId } = await client.execute({ workflowId: 'm', params: { prompt: 'x' } });
    const out = await client.getOutput(taskId);
    expect(out).toEqual({ type: 'body', contentType: 'image/jpeg', data: 'QUJD', filename: 'output.jpg' });
  });

  it('files 逐键转 data URL 合并进 body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://tos/out.jpg' }] }),
    } as unknown as Response);

    const file = new File(['hello'], 'a.png', { type: 'image/png' });
    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    await client.execute({ workflowId: 'm', params: { prompt: 'x' }, files: { image: file } });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.image).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('poll 直接返回 completed（同步 API）', async () => {
    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    const result = await client.poll('any');
    expect(result.status).toBe('completed');
    expect(result.done).toBe(true);
  });

  it('getOutput 无缓存返回 null', async () => {
    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    expect(await client.getOutput('nope')).toBeNull();
  });

  it('cancel 为 no-op（不抛错）', async () => {
    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    await expect(client.cancel('any')).resolves.toBeUndefined();
  });

  it('execute 非 2xx 抛带状态错误', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"bad key"}}',
    } as unknown as Response);

    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    await expect(client.execute({ workflowId: 'm', params: {} })).rejects.toThrow('火山方舟 API 错误 (401)');
  });

  it('execute 响应 data 为空数组抛错', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as unknown as Response);

    const client = createVolcengineArkClient({ apiKey: 'k', baseUrl: 'http://ark', timeout: 900 });
    await expect(client.execute({ workflowId: 'm', params: {} })).rejects.toThrow('火山方舟响应无图片数据');
  });

  it('fileToDataUrl 生成 data URL', async () => {
    const file = new File(['hello'], 'a.png', { type: 'image/png' });
    expect(await fileToDataUrl(file)).toBe('data:image/png;base64,aGVsbG8=');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/providers/volcengine-ark/client.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 创建 `server/src/providers/volcengine-ark/client.ts`**

```ts
import { randomUUID } from 'crypto';
import type { ProviderClient, ResolvedProviderConfig, WorkflowOutput } from '../types.js';

/** 方舟图片生成响应（OpenAI 兼容 images/generations） */
interface ArkImageData {
  url?: string;
  b64_json?: string;
}

/**
 * 创建火山方舟传输客户端。
 *
 * 方舟图片生成是「同步」API（一次请求直接返回结果），本客户端把其适配为任务式 ProviderClient：
 * - execute：POST {baseUrl}/images/generations，同步等待完成，把输出规格缓存到内存 Map；
 * - poll：直接返回 completed（execute 已同步完成）；
 * - getOutput：从缓存返回输出（download 或 body）；
 * - cancel：no-op（同步请求已结束，无法中止；中断走 deferredCancel 标记机制）。
 *
 * @param config 已解析配置（apiKey / baseUrl / timeout）
 * @returns ProviderClient
 */
export function createVolcengineArkClient(config: ResolvedProviderConfig): ProviderClient {
  const apiKey = String(config.apiKey ?? '');
  const baseUrl = String(config.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  const timeoutMs = Number(config.timeout ?? 900) * 1000;

  const outputs = new Map<string, WorkflowOutput>();

  return {
    async execute(p) {
      const body: Record<string, unknown> = { ...(p.params ?? {}) };
      // files 逐键转为 base64 data URL 合并进 body（如单图 files.image → body.image）
      for (const [key, file] of Object.entries(p.files ?? {})) {
        body[key] = await fileToDataUrl(file);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`火山方舟 API 错误 (${res.status}): ${text}`);
        }
        const data = (await res.json()) as { data?: ArkImageData[] };
        const images = data.data ?? [];
        if (images.length === 0) {
          throw new Error('火山方舟响应无图片数据');
        }
        const first = images[0];
        const taskId = randomUUID();
        if (first.url) {
          outputs.set(taskId, { type: 'download', url: first.url, filename: 'output.jpg' });
        } else if (first.b64_json) {
          outputs.set(taskId, { type: 'body', contentType: 'image/jpeg', data: first.b64_json, filename: 'output.jpg' });
        } else {
          throw new Error('火山方舟响应图片缺少 url/b64_json');
        }
        return { taskId };
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new Error(`火山方舟请求超时（${Math.round(timeoutMs / 1000)}s）`);
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },

    async poll() {
      // 同步 API：execute 已同步完成，直接视为 done
      return { status: 'completed', progress: 100, done: true, errorMessage: null };
    },

    async getOutput(taskId): Promise<WorkflowOutput | null> {
      return outputs.get(taskId) ?? null;
    },

    async cancel() {
      // 同步请求已在 execute 内完成，无法中止；幂等 no-op
    },
  };
}

/**
 * 把 File 转成 base64 data URL（供方舟 image 字段使用）。
 * @param file 图片文件
 * @returns data:image/...;base64,...
 */
export async function fileToDataUrl(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  return `data:${file.type || 'image/jpeg'};base64,${buf.toString('base64')}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/providers/volcengine-ark/client.test.ts`
Expected: 10 个用例全过。

- [ ] **Step 5: typecheck + lint + 提交**

Run: `npm run typecheck`（0 错）、`npm run lint`（0 错，仅 refs.ts 既有 warning）
```bash
git add server/src/providers/volcengine-ark/client.ts server/src/providers/volcengine-ark/client.test.ts
# 提交信息（UTF-8 无 BOM 文件）："feat: 火山方舟 Provider 客户端（同步 API 适配任务式接口）"
```

---

### Task 4: 火山方舟 Provider 注册

**Files:**
- Create: `server/src/providers/volcengine-ark/index.ts`

- [ ] **Step 1: 创建 `server/src/providers/volcengine-ark/index.ts`**

```ts
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { createVolcengineArkClient } from './client.js';

/**
 * 火山方舟 Provider 插件。
 *
 * 配置字段：
 * - apiKey：方舟 API Key（ARK_API_KEY 环境变量兜底；secret 脱敏）
 * - baseUrl：API 基础地址（ARK_BASE_URL 环境变量兜底，默认 https://ark.cn-beijing.volces.com/api/v3）
 * - timeout：单次生成请求超时（秒，默认 900）
 */
const definition: ProviderDefinition = {
  id: 'volcengine-ark',
  name: '火山方舟',
  description: '火山方舟图片生成 API，支持 Seedream 5.0 pro/lite 文生图与图片编辑',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'ARK_API_KEY',
      secret: true,
      description: '火山方舟 API Key（控制台创建）',
      envVar: 'ARK_API_KEY',
    },
    {
      key: 'baseUrl',
      label: 'API 地址',
      type: 'string',
      required: false,
      defaultValue: 'https://ark.cn-beijing.volces.com/api/v3',
      placeholder: 'https://ark.cn-beijing.volces.com/api/v3',
      description: '方舟 API 基础地址',
      envVar: 'ARK_BASE_URL',
    },
    {
      key: 'timeout',
      label: '请求超时（秒）',
      type: 'number',
      required: false,
      defaultValue: 900,
      description: '单次生成请求超时时间（秒）',
    },
  ],
  createClient: (config) => createVolcengineArkClient(config),
};

registerProvider(definition);
```

- [ ] **Step 2: 验证注册（跑 provider 相关测试确认无回归）**

Run: `cd server && npx vitest run src/providers`
Expected: 全部通过（registry/config-store/client）。

- [ ] **Step 3: typecheck + lint + 提交**

Run: `npm run typecheck`（0 错）、`npm run lint`（0 错，仅 refs.ts 既有 warning）
```bash
git add server/src/providers/volcengine-ark/index.ts
# 提交信息（UTF-8 无 BOM 文件）："feat: 注册火山方舟 Provider（configSchema 驱动设置表单）"
```

---

### Task 5: Seedream 共享提交辅助（TDD）

**Files:**
- Create: `server/src/workflows/seedream.test.ts`
- Create: `server/src/workflows/seedream.ts`

- [ ] **Step 1: 创建 `server/src/workflows/seedream.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ProviderClient } from '../providers/types.js';
import {
  fileToDataUrl,
  resolveSeedreamSize,
  submitSeedreamImageEdit,
  submitSeedreamTextToImage,
} from './seedream.js';

const executeMock = vi.fn();
const stubProvider = {
  execute: executeMock,
  poll: vi.fn(),
  getOutput: vi.fn(),
  cancel: vi.fn(),
} as unknown as ProviderClient;

describe('resolveSeedreamSize', () => {
  it('合法宽高返回 WxH', () => {
    expect(resolveSeedreamSize(1080, 1920)).toBe('1080x1920');
    expect(resolveSeedreamSize('1080', '1920')).toBe('1080x1920');
  });

  it('总像素低于下限回退 2K', () => {
    expect(resolveSeedreamSize(512, 512)).toBe('2K');
  });

  it('总像素高于上限回退 2K', () => {
    expect(resolveSeedreamSize(3000, 2000)).toBe('2K'); // 6,000,000 > 4,624,220
  });

  it('宽高比越界回退 2K', () => {
    expect(resolveSeedreamSize(2000, 100)).toBe('2K'); // 2000/100 = 20 > 16
  });

  it('缺省回退 2K', () => {
    expect(resolveSeedreamSize()).toBe('2K');
    expect(resolveSeedreamSize(1080)).toBe('2K');
    expect(resolveSeedreamSize(0, 1920)).toBe('2K');
  });
});

describe('submitSeedreamTextToImage', () => {
  beforeEach(() => executeMock.mockReset());

  it('提交 model/prompt/size/output_format/watermark/response_format', async () => {
    executeMock.mockResolvedValue({ taskId: 't' });
    await submitSeedreamTextToImage(stubProvider, { model: 'm1', prompt: '猫', size: '2K' });
    expect(executeMock).toHaveBeenCalledWith({
      workflowId: 'm1',
      params: { model: 'm1', prompt: '猫', size: '2K', output_format: 'jpeg', watermark: false, response_format: 'url' },
    });
  });

  it('optimizeMode=standard 时带 optimize_prompt_options', async () => {
    executeMock.mockResolvedValue({ taskId: 't' });
    await submitSeedreamTextToImage(stubProvider, { model: 'm', prompt: 'x', size: '2K', optimizeMode: 'standard' });
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.optimize_prompt_options).toEqual({ mode: 'standard' });
  });
});

describe('submitSeedreamImageEdit', () => {
  beforeEach(() => executeMock.mockReset());

  it('单图 image 为字符串', async () => {
    executeMock.mockResolvedValue({ taskId: 't' });
    await submitSeedreamImageEdit(stubProvider, {
      model: 'm', prompt: 'x', images: ['data:image/jpeg;base64,QQ=='], size: '2K',
    });
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.image).toBe('data:image/jpeg;base64,QQ==');
  });

  it('多图 image 为数组', async () => {
    executeMock.mockResolvedValue({ taskId: 't' });
    await submitSeedreamImageEdit(stubProvider, { model: 'm', prompt: 'x', images: ['a', 'b'], size: '2K' });
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.image).toEqual(['a', 'b']);
  });

  it('0 张或超过 10 张抛错', async () => {
    await expect(
      submitSeedreamImageEdit(stubProvider, { model: 'm', prompt: 'x', images: [], size: '2K' }),
    ).rejects.toThrow('1~10 张参考图');
    const many = Array.from({ length: 11 }, (_, i) => `data:${i}`);
    await expect(
      submitSeedreamImageEdit(stubProvider, { model: 'm', prompt: 'x', images: many, size: '2K' }),
    ).rejects.toThrow('1~10 张参考图');
  });
});

describe('fileToDataUrl', () => {
  it('生成 data URL', async () => {
    const file = new File(['hello'], 'a.png', { type: 'image/png' });
    expect(await fileToDataUrl(file)).toBe('data:image/png;base64,aGVsbG8=');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/workflows/seedream.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 创建 `server/src/workflows/seedream.ts`**

```ts
import { fileToDataUrl } from '../providers/volcengine-ark/client.js';
import type { ProviderClient } from '../providers/types.js';

export { fileToDataUrl };

/** 方舟显式尺寸的总像素范围（pro 的约束，作为两个模型共享安全边界） */
const ARK_MIN_TOTAL_PIXELS = 921600;
const ARK_MAX_TOTAL_PIXELS = 4624220;

/**
 * 把应用宽高映射为方舟 size。
 * - 宽高均有效且总像素在 [921600, 4624220]、宽高比在 [1/16, 16] → "{width}x{height}"
 * - 否则回退 "2K"（两个模型均接受）
 * @param width 可选宽度（像素，number 或数字字符串）
 * @param height 可选高度（像素，number 或数字字符串）
 * @returns 方舟 size 值
 */
export function resolveSeedreamSize(width?: string | number, height?: string | number): string {
  const w = typeof width === 'number' ? width : Number(width);
  const h = typeof height === 'number' ? height : Number(height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    const total = w * h;
    const ratio = w / h;
    if (total >= ARK_MIN_TOTAL_PIXELS && total <= ARK_MAX_TOTAL_PIXELS && ratio >= 1 / 16 && ratio <= 16) {
      return `${Math.round(w)}x${Math.round(h)}`;
    }
  }
  return '2K';
}

/** 文生图提交参数 */
export interface SeedreamTextToImageSubmitParams {
  /** 方舟模型 ID（如 doubao-seedream-5-0-pro-260628） */
  model: string;
  /** 图片描述提示词 */
  prompt: string;
  /** 方舟 size（档位或 WxH） */
  size: string;
  /** 提示词优化模式（可选：standard 质量更优耗时更长） */
  optimizeMode?: 'standard';
}

/**
 * 提交文生图任务（火山方舟 images/generations）。
 * @param client Provider 客户端
 * @param params 文生图参数
 * @returns 远端任务 ID
 */
export async function submitSeedreamTextToImage(
  client: ProviderClient,
  params: SeedreamTextToImageSubmitParams,
): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    size: params.size,
    output_format: 'jpeg',
    watermark: false,
    response_format: 'url',
  };
  if (params.optimizeMode) {
    body.optimize_prompt_options = { mode: params.optimizeMode };
  }
  return client.execute({ workflowId: params.model, params: body });
}

/** 图片编辑提交参数 */
export interface SeedreamImageEditSubmitParams {
  /** 方舟模型 ID */
  model: string;
  /** 编辑描述（作为 prompt） */
  prompt: string;
  /** 参考图 data URL（1 张为字符串，2~10 张为数组） */
  images: string[];
  /** 方舟 size（档位或 WxH） */
  size: string;
  /** 提示词优化模式（可选） */
  optimizeMode?: 'standard';
}

/**
 * 提交图片编辑任务（火山方舟 images/generations，多图参考生单图）。
 * @param client Provider 客户端
 * @param params 图片编辑参数
 * @returns 远端任务 ID
 */
export async function submitSeedreamImageEdit(
  client: ProviderClient,
  params: SeedreamImageEditSubmitParams,
): Promise<{ taskId: string }> {
  if (params.images.length === 0 || params.images.length > 10) {
    throw new Error(`火山方舟图片编辑需要 1~10 张参考图，当前 ${params.images.length} 张`);
  }
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    image: params.images.length === 1 ? params.images[0] : params.images,
    size: params.size,
    output_format: 'jpeg',
    watermark: false,
    response_format: 'url',
  };
  if (params.optimizeMode) {
    body.optimize_prompt_options = { mode: params.optimizeMode };
  }
  return client.execute({ workflowId: params.model, params: body });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/workflows/seedream.test.ts`
Expected: 全部通过。

- [ ] **Step 5: typecheck + lint + 提交**

Run: `npm run typecheck`（0 错）、`npm run lint`（0 错，仅 refs.ts 既有 warning）
```bash
git add server/src/workflows/seedream.ts server/src/workflows/seedream.test.ts
# 提交信息（UTF-8 无 BOM 文件）："feat: Seedream 共享提交辅助（resolveSeedreamSize / 文生图 / 图片编辑）"
```

---

### Task 6: 文生图实现（seedream-5-pro / seedream-5-lite）

**Files:**
- Create: `server/src/workflows/text-to-image/seedream.test.ts`
- Create: `server/src/workflows/text-to-image/seedream.ts`

- [ ] **Step 1: 创建 `server/src/workflows/text-to-image/seedream.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderClient } from '../../providers/types.js';
import { getImpl } from '../registry.js';
import type { TextToImageVars, WorkflowRunContext } from '../types.js';
import './seedream.js'; // 触发注册（模块顶层 register）

const executeMock = vi.fn();
const stubProvider = {
  execute: executeMock,
  poll: vi.fn(),
  getOutput: vi.fn(),
  cancel: vi.fn(),
} as unknown as ProviderClient;

const mkCtx = (overrides: Partial<WorkflowRunContext<TextToImageVars>> = {}): WorkflowRunContext<TextToImageVars> => ({
  project: 'p',
  projectConfig: { width: 1080, height: 1920 },
  vars: { promptPath: 'prompt/character/张三/appearance.md' },
  provider: stubProvider,
  userParams: {},
  readFile: async () => '一只猫',
  readAssertFile: async () => new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
  ...overrides,
});

describe('text-to-image/seedream', () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue({ taskId: 't1' });
  });

  it('注册 seedream-5-pro / seedream-5-lite，provider=volcengine-ark，能力含 deferredCancel', () => {
    const pro = getImpl('text-to-image', 'seedream-5-pro');
    expect(pro).toBeDefined();
    expect(pro!.provider).toBe('volcengine-ark');
    expect(pro!.capabilities).toMatchObject({ cancelable: true, deferredCancel: true });
    expect(getImpl('text-to-image', 'seedream-5-lite')).toBeDefined();
  });

  it('pro 实现：读 promptPath、映射尺寸、提交正确 body', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-pro')!;
    await impl.submit(mkCtx());

    expect(executeMock).toHaveBeenCalledTimes(1);
    const call = executeMock.mock.calls[0][0] as { workflowId: string; params: Record<string, unknown> };
    expect(call.workflowId).toBe('doubao-seedream-5-0-pro-260628');
    expect(call.params).toMatchObject({
      model: 'doubao-seedream-5-0-pro-260628',
      prompt: '一只猫',
      size: '1080x1920',
      output_format: 'jpeg',
      watermark: false,
      response_format: 'url',
    });
  });

  it('lite 实现使用 lite 模型 ID', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-lite')!;
    await impl.submit(mkCtx());
    const call = executeMock.mock.calls[0][0] as { workflowId: string };
    expect(call.workflowId).toBe('doubao-seedream-5-0-260128');
  });

  it('enhance_prompt=true 时提交 optimize_prompt_options.mode=standard', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-pro')!;
    await impl.submit(mkCtx({ userParams: { enhance_prompt: 'true' } }));
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.optimize_prompt_options).toEqual({ mode: 'standard' });
  });

  it('enhance_prompt 未开启时不带 optimize_prompt_options', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-pro')!;
    await impl.submit(mkCtx());
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.optimize_prompt_options).toBeUndefined();
  });

  it('vars.width/height 覆盖 projectConfig 尺寸', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-pro')!;
    await impl.submit(mkCtx({ vars: { promptPath: 'x.md', width: '720', height: '1280' } }));
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.size).toBe('720x1280');
  });

  it('promptPath 缺失抛错', async () => {
    const impl = getImpl('text-to-image', 'seedream-5-pro')!;
    await expect(impl.submit(mkCtx({ vars: { promptPath: '  ' } }))).rejects.toThrow('需要 vars.promptPath');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/workflows/text-to-image/seedream.test.ts`
Expected: FAIL（实现文件不存在）。

- [ ] **Step 3: 创建 `server/src/workflows/text-to-image/seedream.ts`**

```ts
import { register } from '../registry.js';
import type { TextToImageVars, WorkflowRunContext } from '../types.js';
import { resolveSeedreamSize, submitSeedreamTextToImage } from '../seedream.js';

/** Seedream 文生图模型定义（impl → 阅读名 → 方舟模型 ID） */
const SEEDREAM_MODELS = [
  { impl: 'seedream-5-pro', name: 'Seedream 5.0 Pro（火山方舟）', model: 'doubao-seedream-5-0-pro-260628' },
  { impl: 'seedream-5-lite', name: 'Seedream 5.0 Lite（火山方舟）', model: 'doubao-seedream-5-0-260128' },
] as const;

for (const def of SEEDREAM_MODELS) {
  register<TextToImageVars>({
    type: 'text-to-image',
    impl: def.impl,
    name: def.name,
    description: '使用火山方舟 Seedream 文生图模型，根据提示词生成图片（角色外观 / 场景图等）',
    provider: 'volcengine-ark',
    capabilities: { cancelable: true, deferredCancel: true },
    params: [
      {
        name: '提示词优化',
        key: 'enhance_prompt',
        type: 'boolean',
        defaultValue: false,
        description: '启用后使用方舟 standard 模式优化提示词（质量更优，耗时更长）',
      },
    ],
    async submit(ctx: WorkflowRunContext<TextToImageVars>) {
      const promptPath = ctx.vars.promptPath?.trim();
      if (!promptPath) {
        throw new Error('text-to-image 需要 vars.promptPath');
      }
      const prompt = await ctx.readFile(promptPath);
      // 尺寸：vars.width/height 优先，否则 projectConfig；经 resolveSeedreamSize 校验/回退
      const width = ctx.vars.width ?? ctx.projectConfig.width;
      const height = ctx.vars.height ?? ctx.projectConfig.height;
      const optimizeMode = ctx.userParams?.enhance_prompt === 'true' ? ('standard' as const) : undefined;
      return submitSeedreamTextToImage(ctx.provider, {
        model: def.model,
        prompt,
        size: resolveSeedreamSize(width, height),
        ...(optimizeMode ? { optimizeMode } : {}),
      });
    },
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/workflows/text-to-image/seedream.test.ts`
Expected: 7 个用例全过。

- [ ] **Step 5: typecheck + lint + 提交**

Run: `npm run typecheck`（0 错）、`npm run lint`（0 错，仅 refs.ts 既有 warning）
```bash
git add server/src/workflows/text-to-image/seedream.ts server/src/workflows/text-to-image/seedream.test.ts
# 提交信息（UTF-8 无 BOM 文件）："feat: Seedream 文生图实现（pro/lite）"
```

---

### Task 7: 图片编辑实现（seedream-5-pro / seedream-5-lite）

**Files:**
- Create: `server/src/workflows/image-edit/seedream.test.ts`
- Create: `server/src/workflows/image-edit/seedream.ts`

- [ ] **Step 1: 创建 `server/src/workflows/image-edit/seedream.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderClient } from '../../providers/types.js';
import { getImpl } from '../registry.js';
import type { ImageEditVars, WorkflowRunContext } from '../types.js';
import './seedream.js'; // 触发注册（模块顶层 register）

const executeMock = vi.fn();
const stubProvider = {
  execute: executeMock,
  poll: vi.fn(),
  getOutput: vi.fn(),
  cancel: vi.fn(),
} as unknown as ProviderClient;

const mkCtx = (overrides: Partial<WorkflowRunContext<ImageEditVars>> = {}): WorkflowRunContext<ImageEditVars> => ({
  project: 'p',
  projectConfig: { width: 1080, height: 1920 },
  vars: {
    desc: '把猫放进商场',
    imagePaths: JSON.stringify(['assert/stage/商场/白天.jpg', 'assert/character/张三/appearance.jpg']),
  },
  provider: stubProvider,
  userParams: {},
  readFile: async () => '',
  readAssertFile: async (rel) => new File([rel], 'a.jpg', { type: 'image/jpeg' }),
  ...overrides,
});

describe('image-edit/seedream', () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue({ taskId: 't1' });
  });

  it('注册 seedream-5-pro / seedream-5-lite，provider=volcengine-ark，能力含 deferredCancel', () => {
    const pro = getImpl('image-edit', 'seedream-5-pro');
    expect(pro).toBeDefined();
    expect(pro!.provider).toBe('volcengine-ark');
    expect(pro!.capabilities).toMatchObject({ cancelable: true, deferredCancel: true });
    expect(getImpl('image-edit', 'seedream-5-lite')).toBeDefined();
  });

  it('多图：image 为 data URL 数组、prompt=desc、尺寸回退 2K', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await impl.submit(mkCtx());

    const call = executeMock.mock.calls[0][0] as { workflowId: string; params: Record<string, unknown> };
    expect(call.workflowId).toBe('doubao-seedream-5-0-pro-260628');
    expect(call.params.prompt).toBe('把猫放进商场');
    const image = call.params.image as string[];
    expect(image).toHaveLength(2);
    expect(image[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(call.params.size).toBe('2K');
  });

  it('enable_specified_size=true 且宽高有效时显式 WxH', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await impl.submit(mkCtx({ userParams: { enable_specified_size: 'true', width: '720', height: '1280' } }));
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.size).toBe('720x1280');
  });

  it('enable_specified_size=true 但宽高无效时回退 2K', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await impl.submit(mkCtx({ userParams: { enable_specified_size: 'true', width: '', height: '' } }));
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.size).toBe('2K');
  });

  it('单图：image 为字符串', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await impl.submit(mkCtx({
      vars: { desc: 'x', imagePaths: JSON.stringify(['assert/stage/商场/白天.jpg']) },
    }));
    const call = executeMock.mock.calls[0][0] as { params: { image: string | string[] } };
    expect(typeof call.params.image).toBe('string');
  });

  it('超过 10 张参考图抛错', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    const many = Array.from({ length: 11 }, (_, i) => `assert/stage/商场/${i}.jpg`);
    await expect(
      impl.submit(mkCtx({ vars: { desc: 'x', imagePaths: JSON.stringify(many) } })),
    ).rejects.toThrow('最多支持 10 张参考图');
  });

  it('desc 缺失抛错', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await expect(
      impl.submit(mkCtx({ vars: { desc: '  ', imagePaths: '[]' } })),
    ).rejects.toThrow('需要 vars.desc');
  });

  it('无输入图抛错', async () => {
    const impl = getImpl('image-edit', 'seedream-5-pro')!;
    await expect(
      impl.submit(mkCtx({ vars: { desc: 'x', imagePaths: '[]' } })),
    ).rejects.toThrow('至少需要一张输入图片');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/workflows/image-edit/seedream.test.ts`
Expected: FAIL（实现文件不存在）。

- [ ] **Step 3: 创建 `server/src/workflows/image-edit/seedream.ts`**

```ts
import { register } from '../registry.js';
import type { ImageEditVars, WorkflowRunContext } from '../types.js';
import { fileToDataUrl, resolveSeedreamSize, submitSeedreamImageEdit } from '../seedream.js';

/** Seedream 图片编辑模型定义（impl → 阅读名 → 方舟模型 ID） */
const SEEDREAM_MODELS = [
  { impl: 'seedream-5-pro', name: 'Seedream 5.0 Pro（火山方舟）', model: 'doubao-seedream-5-0-pro-260628' },
  { impl: 'seedream-5-lite', name: 'Seedream 5.0 Lite（火山方舟）', model: 'doubao-seedream-5-0-260128' },
] as const;

for (const def of SEEDREAM_MODELS) {
  register<ImageEditVars>({
    type: 'image-edit',
    impl: def.impl,
    name: def.name,
    description: '使用火山方舟 Seedream 多图参考生单图，基于输入图片与编辑描述进行图像编辑/合成',
    provider: 'volcengine-ark',
    capabilities: { cancelable: true, deferredCancel: true },
    params: [
      {
        name: '指定输出尺寸',
        key: 'enable_specified_size',
        type: 'boolean',
        defaultValue: false,
        description: '启用后按下方选定的宽高输出图片',
      },
      {
        name: '输出宽度',
        key: 'width',
        type: 'integer',
        defaultValue: '',
        description: '输出图片宽度（像素）',
      },
      {
        name: '输出高度',
        key: 'height',
        type: 'integer',
        defaultValue: '',
        description: '输出图片高度（像素）',
      },
    ],
    async submit(ctx: WorkflowRunContext<ImageEditVars>) {
      const desc = (ctx.vars.desc ?? '').trim();
      if (!desc) {
        throw new Error('image-edit 需要 vars.desc（编辑描述）');
      }

      let paths: string[] = [];
      try {
        const parsed = JSON.parse(ctx.vars.imagePaths ?? '[]') as unknown;
        if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) {
          throw new Error('imagePaths 须为字符串数组');
        }
        paths = parsed.map((p) => p.trim()).filter(Boolean);
      } catch (e) {
        throw new Error(
          `image-edit imagePaths 无效: ${ctx.vars.imagePaths}; ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (paths.length === 0) {
        throw new Error('image-edit 至少需要一张输入图片（vars.imagePaths）');
      }
      if (paths.length > 10) {
        throw new Error('火山方舟图片编辑最多支持 10 张参考图');
      }

      // 逐张读取并转 base64 data URL；单图 ≤30MB（方舟限制）
      const dataUrls: string[] = [];
      for (const rel of paths) {
        const f = await ctx.readAssertFile(rel);
        if (f.size > 30 * 1024 * 1024) {
          throw new Error(`火山方舟输入图片超过 30MB: ${rel}`);
        }
        dataUrls.push(await fileToDataUrl(f));
      }

      // 尺寸：enable_specified_size=true 且宽高有效 → 显式 WxH；否则回退 2K
      // 注：userParams 值类型为 boolean|number|string，需 String() 强转后再解析
      const up = ctx.userParams ?? {};
      const size = up.enable_specified_size === 'true'
        ? resolveSeedreamSize(String(up.width ?? ''), String(up.height ?? ''))
        : resolveSeedreamSize();

      return submitSeedreamImageEdit(ctx.provider, {
        model: def.model,
        prompt: desc,
        images: dataUrls,
        size,
      });
    },
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/workflows/image-edit/seedream.test.ts`
Expected: 8 个用例全过。

- [ ] **Step 5: typecheck + lint + 提交**

Run: `npm run typecheck`（0 错）、`npm run lint`（0 错，仅 refs.ts 既有 warning）
```bash
git add server/src/workflows/image-edit/seedream.ts server/src/workflows/image-edit/seedream.test.ts
# 提交信息（UTF-8 无 BOM 文件）："feat: Seedream 图片编辑实现（pro/lite）"
```

---

### Task 8: 全量验证与收尾

- [ ] **Step 1: 全量类型检查**

Run: `npm run typecheck`
Expected: 0 错误（服务端 + 前端）。

- [ ] **Step 2: 全量 lint**

Run: `npm run lint`
Expected: 0 错误（仅 `refs.ts` 既有 2 个 warning，主工作区 + worktree 各一份属正常）。

- [ ] **Step 3: 全量 server 测试**

Run: `cd server && npm test`
Expected: 全部通过（原 ~96 + 新增 cancel 3 + seedream ~20 + client 10 等）。

- [ ] **Step 4: 前端 build 冒烟**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 5: 浏览器冒烟（服务端 3001 已在运行，tsx watch 自动重启）**

用浏览器打开 `http://localhost:5233`（或 `http://localhost:3001`）验证：
1. 顶栏齿轮 → 服务商配置：出现「火山方舟」卡片（apiKey 密码框必填、baseUrl、timeout）；保存空 apiKey 报错提示；填入后保存返回脱敏 `__set__`
2. 任一项目的角色外观/场景图生成对话框：工作流下拉出现「Seedream 5.0 Pro（火山方舟）」「Seedream 5.0 Lite（火山方舟）」，且默认选中仍是 ComfyUI 实现（`implementations[0]` 为 `default`）
3. 图片编辑（分镜场景图/衍生变体）对话框：同样出现 2 个 Seedream 实现
4. `GET /api/workflows` 响应中 `text-to-image` / `image-edit` 类型各含 4 个实现，Seedream 实现带 `provider: 'volcengine-ark'`、`capabilities: { cancelable: true, deferredCancel: true }`

（真实生成验证由用户在填入真实 API Key 后自行执行：文生图/图片编辑各跑一次 pro 和 lite。）

- [ ] **Step 6: 更新仓库记忆**

在 `/memories/repo/ai-video-workstation.md` 追加本次关键事实（Provider 插件、同步 API 适配、deferredCancel 机制、模型 ID、尺寸约束、fileToDataUrl 位置、踩坑）。

- [ ] **Step 7: 提交收尾**

```bash
git add -A
# 若仅记忆文件等无代码改动，可单独提交；提交信息（UTF-8 无 BOM 文件）：
# "chore: 火山方舟 Seedream 提供商集成收尾（验证与记忆）"
```

---

## 自审记录

- **规格覆盖**：§4 Provider（Task 3/4）、§4.3 中断（Task 1/2）、§5 共享辅助（Task 5）、§6.1 文生图（Task 6）、§6.2 图片编辑（Task 7）、§7 错误处理（各 Task 内）、§8 测试（各 Task TDD）、§9 验证（Task 8）。✅
- **占位符扫描**：无 TBD/TODO；每个代码步骤含完整代码与预期输出。✅
- **类型一致性**：`resolveSeedreamSize(width?: string|number, height?)`、`submitSeedreamTextToImage/ImageEdit` 签名在 Task 5 定义、Task 6/7 引用一致；`markCancelRequested/stripCancelRequested/isCancelRequested` 在 Task 1 定义、Task 2 引用一致；`deferredCancel` 在 types.ts 定义、canCancelTask/路由/实现声明引用一致。✅
