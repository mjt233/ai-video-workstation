# Bridge 工作流动态注册 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将硬编码的 ComfyUI Easy Bridge 工作流注册（5 个文件）替换为按标签从 Bridge 动态拉取注册，消灭硬编码 workflow id 的提交函数，改为 payload 构建器。

**Architecture:** 新增 `bridge-sync.ts` 同步模块（读 `autoRegisterTag` 配置 → 拉列表/详情 → 推导类型/能力/参数 → 动态注册 impl=`ceb-{id}`）；`bridge-client.ts` 重构为以 workflowId 为入参的 payload 构建器（纯函数）；启动 + Provider 配置变更后重同步；删除硬编码 Bridge 工作流文件（seedream 火山方舟保留）。

**Tech Stack:** Express + TypeScript（服务端）、Vue 3 + Vuetify 3（前端）、vitest。字段约定见 `docs/bridge-workflow-fields.md`，设计见 `docs/superpowers/specs/2026-08-08-bridge-workflow-dynamic-registration-design.md`。

**通用约定（贯穿所有任务）**
- 提交命令、测试命令在 `server/` 目录执行（`cd C:\Users\xiaotao\code\ai-video-workstation\server`）。
- 中文 commit message 必须写 UTF-8 无 BOM 临时文件再用 `git commit -F`（PowerShell `-m` 会乱码）。
- 每任务完成后 `npm run typecheck`（在仓库根目录）+ 运行相关测试。

---

### Task 1: registry 增加 unregister

**Files:**
- Create: `server/src/workflows/registry.test.ts`
- Modify: `server/src/workflows/registry.ts`

- [ ] **Step 1: 写失败测试**

创建 `server/src/workflows/registry.test.ts`：

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { register, unregister, getImpl, getImplementations, getAllWorkflowTypes } from './registry.js';
import type { WorkflowDefinition } from './types.js';

const mk = (type: string, impl: string): WorkflowDefinition => ({
  type, impl, name: impl,
  provider: 'test-provider',
  submit: async () => ({ taskId: 't' }),
});

describe('registry unregister', () => {
  beforeEach(() => {
    // 清理测试类型（避免污染其它测试）
    for (const t of getAllWorkflowTypes()) {
      for (const w of getImplementations(t)) unregister(t, w.impl);
    }
  });

  it('unregister 删除指定实现', () => {
    register(mk('test-unreg', 'a'));
    register(mk('test-unreg', 'b'));
    unregister('test-unreg', 'a');
    expect(getImpl('test-unreg', 'a')).toBeUndefined();
    expect(getImpl('test-unreg', 'b')).toBeDefined();
  });

  it('删除最后一个实现后移除该类型', () => {
    register(mk('test-unreg', 'a'));
    unregister('test-unreg', 'a');
    expect(getAllWorkflowTypes()).not.toContain('test-unreg');
  });

  it('unregister 不存在的实现不抛错', () => {
    unregister('test-unreg', 'nope');
    expect(getAllWorkflowTypes()).not.toContain('test-unreg');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/workflows/registry.test.ts`
Expected: FAIL，`unregister is not a function`

- [ ] **Step 3: 实现 unregister**

在 `server/src/workflows/registry.ts` 的 `getAllWorkflowTypes` 后新增：

```ts
/**
 * 注销一个工作流实现（动态重同步时清理陈旧注册）。
 *
 * @param type 工作流类型
 * @param impl 实现标识；不存在时静默忽略
 */
export function unregister(type: string, impl: string): void {
  const list = registry.get(type);
  if (!list) return;
  const next = list.filter((w) => w.impl !== impl);
  if (next.length === 0) {
    registry.delete(type);
  } else {
    registry.set(type, next);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/workflows/registry.test.ts`
Expected: PASS（3 用例）

- [ ] **Step 5: 提交**

```bash
cd C:\Users\xiaotao\code\ai-video-workstation
git add server/src/workflows/registry.ts server/src/workflows/registry.test.ts
git commit -F <msg文件>   # msg: "feat: registry 支持 unregister（动态重同步清理）"
```

---

### Task 2: comfyui-bridge client 增加 listWorkflows / getWorkflowDetail

**Files:**
- Modify: `server/src/providers/comfyui-bridge/client.ts`
- Modify: `server/src/providers/comfyui-bridge/client.test.ts`

- [ ] **Step 1: 定义 Bridge 类型 + 扩展返回接口**

在 `client.ts` 顶部（import 之后）新增：

```ts
/** Bridge 列表接口返回的工作流摘要（declaredParams 为 JSON 字符串） */
export interface BridgeWorkflowSummary {
  id: string;
  name: string;
  description?: string;
  declaredParams: string;
  tags: BridgeTagGroup[];
}

/** Bridge 详情接口返回的工作流详情（declaredParams 为解析数组） */
export interface BridgeWorkflowDetail {
  id: string;
  name: string;
  description?: string;
  declaredParams: BridgeDeclaredParam[];
  tags: BridgeTagGroup[];
}

/** 详情接口 declaredParams 元素 */
export interface BridgeDeclaredParam {
  alias: string;
  label?: string | null;
  paramType: 'text' | 'number' | 'boolean' | 'image' | 'video' | 'audio';
  defaultValue?: string | null;
}

/** Bridge 标签分组（父/子嵌套；metadata 为合并默认值后的完整元数据） */
export interface BridgeTagGroup {
  id: string;
  name?: string;
  metadata?: Record<string, unknown>;
  configuredMetadata?: Record<string, unknown>;
  tags?: BridgeTagGroup[];
}

/** ComfyUI Bridge 客户端：传输能力 + 工作流列表/详情查询（后者供 bridge-sync 使用） */
export interface ComfyuiBridgeClient extends ProviderClient {
  /** 拉取工作流列表；tag 非空时按标签筛选（GET /api/workflows[?tags=]） */
  listWorkflows(tag?: string): Promise<BridgeWorkflowSummary[]>;
  /** 拉取单个工作流详情（GET /api/workflows/:id，declaredParams 为解析数组） */
  getWorkflowDetail(id: string): Promise<BridgeWorkflowDetail>;
}
```

把 `createComfyuiBridgeClient` 的返回类型从 `ProviderClient` 改为 `ComfyuiBridgeClient`（需 import `ProviderClient` 已是 type；直接改签名）。

- [ ] **Step 2: 实现两个方法**

在返回对象 `cancel` 之后、闭合括号前新增：

```ts
    async listWorkflows(tag?: string) {
      const token = await ensureToken();
      const url = `${baseUrl}/api/workflows${tag ? `?tags=${encodeURIComponent(tag)}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge list workflows failed (${res.status}): ${text}`);
      }
      return (await res.json()) as BridgeWorkflowSummary[];
    },

    async getWorkflowDetail(id) {
      const token = await ensureToken();
      const res = await fetch(`${baseUrl}/api/workflows/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bridge workflow detail failed (${res.status}): ${text}`);
      }
      return (await res.json()) as BridgeWorkflowDetail;
    },
```

- [ ] **Step 3: 写测试**

在 `client.test.ts` 末尾新增：

```ts
describe('listWorkflows / getWorkflowDetail', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'tok' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ id: 'text_to_image', name: '文生图', declaredParams: '[]', tags: [] }]) } as unknown as Response);
  });

  it('listWorkflows 带标签时拼 tags 查询参数', async () => {
    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    const list = await client.listWorkflows('auto');
    expect(list[0].id).toBe('text_to_image');
    const url = fetchMock.mock.calls[1][0] as string;
    expect(url).toContain('/api/workflows?tags=auto');
  });

  it('listWorkflows 不带标签时不带查询参数', async () => {
    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    await client.listWorkflows();
    const url = fetchMock.mock.calls[1][0] as string;
    expect(url).toBe('http://b/api/workflows');
  });

  it('getWorkflowDetail 返回解析数组并带 Bearer', async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'tok' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'qwen-edit-2509', name: '编辑', declaredParams: [{ alias: 'prompt', label: '提示词', paramType: 'text' }], tags: [] }) } as unknown as Response);
    const client = createComfyuiBridgeClient({ baseUrl: 'http://b', password: 'pw' });
    const detail = await client.getWorkflowDetail('qwen-edit-2509');
    expect(detail.declaredParams[0].alias).toBe('prompt');
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
});
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/providers/comfyui-bridge/client.test.ts`
Expected: PASS（原 8 用例 + 新 3 用例）

- [ ] **Step 5: 提交**

msg: "feat: comfyui-bridge client 支持工作流列表/详情查询（动态注册用）"

---

### Task 3: bridge-client 重构为 payload 构建器

**Files:**
- Modify: `server/src/workflows/bridge-client.ts`（删除工厂与 submit 辅助，新增 payload 构建器）
- Rewrite: `server/src/workflows/bridge-client.test.ts`

- [ ] **Step 1: 删除旧工厂与提交辅助，新增共享类型**

删除 `bridge-client.ts` 中以下导出：`createProviderWorkflow`、`SubmitTextToImageParams`、`submitTextToImage`、`SubmitImageEditParams`、`submitImageEdit`、`ImageToVideoSubmitParams`、`submitImageToVideo`、`FrameDefine`、`LtxDirectorImageToVideoSubmitParams`、`submitLtxDirectorImageToVideo`、`ReferenceVideoSubmitParams`、`submitReferenceVideo`、`MinimaxH3Fl2vSubmitParams`、`submitMinimaxH3Fl2v`、`TextToImageWorkflowConfig`、`createTextToImageWorkflow`、`ImageEditWorkflowConfig`、`createImageEditWorkflow`、`TtsWorkflowParam`、`createTtsDesignWorkflow`。**保留** `ImageEditSizeParams`、`resolveImageEditSizeParams`。

文件头注释改为：

```ts
/**
 * ComfyUI Bridge 工作流层封装（payload 构建器）。
 *
 * 传输层（execute/poll/getOutput/cancel + token 认证）在 providers/comfyui-bridge/。
 * 本文件只保留「提交载荷」纯函数构建器：workflowId 作为入参，返回 { workflowId, params, files? }，
 * 不再硬编码任何 Bridge workflow id。动态注册（bridge-sync）据此构建 submit。
 * - resolveImageEditSizeParams — 图片编辑尺寸解析（纯函数，保留）
 */

/** 提交载荷：Bridge execute 的入参 */
export interface BridgeExecutePayload {
  workflowId: string;
  params: Record<string, unknown>;
  files?: Record<string, File>;
}

/** 视频关键帧定义（导演台 mode 用） */
export interface FrameDefine {
  frameSeq: number;
  cursor: number;
}

/** 导演台关键帧（文件 + 游标） */
export interface DirectorFrame {
  file: File;
  cursor: number;
}
```

删除 import 中的 `ProviderClient`、`WorkflowRunContext`、`WorkflowBaseDefinition`、`WorkflowDefinition`、`WorkflowVarsBase`（如不再使用）；保留 `WorkflowCapabilities`（如不再使用则一并删除）。`resolveImageEditSizeParams` 原样保留。

- [ ] **Step 2: 实现文本类构建器**

```ts
/**
 * 文生图提交载荷。
 * @param args.workflowId Bridge 工作流 id
 * @param args.prompt 提示词
 * @param args.width 宽度（像素）
 * @param args.height 高度（像素）
 * @param args.seed 随机种子（可选）
 * @param args.enhance_prompt 提示词强化开关（可选）
 */
export function buildTextToImagePayload(args: {
  workflowId: string;
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  enhance_prompt?: boolean;
}): BridgeExecutePayload {
  const params: Record<string, unknown> = {
    prompt: args.prompt,
    width: args.width,
    height: args.height,
  };
  if (args.seed != null) params.seed = args.seed;
  if (args.enhance_prompt !== undefined) params.enhance_prompt = args.enhance_prompt;
  return { workflowId: args.workflowId, params };
}

/**
 * TTS 音色设计提交载荷。
 * @param args.workflowId Bridge 工作流 id
 * @param args.prompt 声线描述
 * @param args.text 朗读文本
 * @param args.seed 随机种子（可选）
 */
export function buildTtsPayload(args: {
  workflowId: string;
  prompt: string;
  text: string;
  seed?: string;
}): BridgeExecutePayload {
  const params: Record<string, unknown> = { prompt: args.prompt, text: args.text };
  if (args.seed != null) params.seed = args.seed;
  return { workflowId: args.workflowId, params };
}
```

- [ ] **Step 3: 实现图片编辑构建器**

```ts
/**
 * 图片编辑提交载荷（多图动态 key image_0/image_1/...，0-based）。
 * @param args.workflowId Bridge 工作流 id
 * @param args.prompt 编辑描述
 * @param args.imgs 输入图片（按数组顺序映射 image_{n}）
 * @param args.seed 随机种子（可选）
 * @param args.size 尺寸参数（仅 enable_specified_size 为 true 时透传，见 resolveImageEditSizeParams）
 */
export function buildImageEditPayload(args: {
  workflowId: string;
  prompt: string;
  imgs: File[];
  seed?: string | number;
  size?: ImageEditSizeParams;
}): BridgeExecutePayload {
  const files: Record<string, File> = {};
  args.imgs.forEach((f, idx) => { files[`image_${idx}`] = f; });
  const params: Record<string, unknown> = { prompt: args.prompt };
  if (args.seed != null) params.seed = args.seed;
  if (args.size?.enable_specified_size != null) params.enable_specified_size = args.size.enable_specified_size;
  if (args.size?.width != null) params.width = args.size.width;
  if (args.size?.height != null) params.height = args.size.height;
  return { workflowId: args.workflowId, params, files };
}
```

- [ ] **Step 4: 实现图生视频构建器（首尾帧/导演台/参考）**

```ts
/**
 * 首尾帧模式图生视频提交载荷（文件 key image_{0..n-1}）。
 * 3 帧时附带 params.mid_frame_cursor=0.5；提供 audio 时置 auto_generate_audio=false。
 */
export function buildFirstLastFramePayload(args: {
  workflowId: string;
  prompt: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  seed?: number;
  frames: File[];
  audio?: File;
}): BridgeExecutePayload {
  const params: Record<string, unknown> = {
    prompt: args.prompt,
    width: args.width,
    height: args.height,
    duration: args.duration,
    fps: args.fps,
    auto_generate_audio: true,
  };
  if (args.seed != null) params.seed = args.seed;
  if (args.frames.length === 3) params.mid_frame_cursor = 0.5;
  const files: Record<string, File> = {};
  args.frames.forEach((f, idx) => { files[`image_${idx}`] = f; });
  if (args.audio) {
    files.audio = args.audio;
    params.auto_generate_audio = false;
  }
  return { workflowId: args.workflowId, params, files };
}

/**
 * 导演台模式图生视频提交载荷。
 * frame_define 为 JSON 字符串；文件 key image_{frameSeq}；提供 audio 时置 auto_generate_audio=false。
 */
export function buildDirectorPayload(args: {
  workflowId: string;
  prompt: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  seed?: number;
  frameDefines: FrameDefine[];
  frameFiles: File[];
  audio?: File;
}): BridgeExecutePayload {
  const params: Record<string, unknown> = {
    prompt: args.prompt,
    width: args.width,
    height: args.height,
    duration: args.duration,
    fps: args.fps,
    auto_generate_audio: true,
    frame_define: JSON.stringify(args.frameDefines),
  };
  if (args.seed != null) params.seed = args.seed;
  const files: Record<string, File> = {};
  args.frameFiles.forEach((f, idx) => { files[`image_${idx}`] = f; });
  if (args.audio) {
    files.audio = args.audio;
    params.auto_generate_audio = false;
  }
  return { workflowId: args.workflowId, params, files };
}

/**
 * 参考模式图生视频提交载荷（文件 key image_{n}/video_{n}/audio_{n}，各类型独立 0-based）。
 */
export function buildReferencePayload(args: {
  workflowId: string;
  prompt: string;
  width: number;
  height: number;
  duration: number;
  seed?: number;
  imageRefs?: File[];
  videoRefs?: File[];
  audioRefs?: File[];
}): BridgeExecutePayload {
  const params: Record<string, unknown> = {
    prompt: args.prompt,
    width: args.width,
    height: args.height,
    duration: args.duration,
  };
  if (args.seed != null) params.seed = args.seed;
  const files: Record<string, File> = {};
  (args.imageRefs ?? []).forEach((f, idx) => { files[`image_${idx}`] = f; });
  (args.videoRefs ?? []).forEach((f, idx) => { files[`video_${idx}`] = f; });
  (args.audioRefs ?? []).forEach((f, idx) => { files[`audio_${idx}`] = f; });
  return { workflowId: args.workflowId, params, files };
}
```

- [ ] **Step 5: 重写 bridge-client.test.ts**

`server/src/workflows/bridge-client.test.ts` 全部重写为：

```ts
import { describe, expect, it } from 'vitest';
import {
  buildTextToImagePayload,
  buildTtsPayload,
  buildImageEditPayload,
  buildFirstLastFramePayload,
  buildDirectorPayload,
  buildReferencePayload,
  resolveImageEditSizeParams,
} from './bridge-client.js';

const img = (name: string) => new File(['x'], name, { type: 'image/png' });
const aud = new File(['a'], 'bg.flac', { type: 'audio/flac' });

describe('buildTextToImagePayload', () => {
  it('基础字段 + 可选 seed/enhance_prompt', () => {
    const p = buildTextToImagePayload({ workflowId: 'text_to_image', prompt: '猫', width: 1080, height: 1920, seed: 1, enhance_prompt: true });
    expect(p).toEqual({ workflowId: 'text_to_image', params: { prompt: '猫', width: 1080, height: 1920, seed: 1, enhance_prompt: true } });
  });
  it('省略可选字段不上送', () => {
    const p = buildTextToImagePayload({ workflowId: 'text_to_image', prompt: '猫', width: 1080, height: 1920 });
    expect(p.params).toEqual({ prompt: '猫', width: 1080, height: 1920 });
  });
});

describe('buildTtsPayload', () => {
  it('prompt/text/seed', () => {
    const p = buildTtsPayload({ workflowId: 'tts_voice_design', prompt: '温柔女声', text: '你好', seed: '1' });
    expect(p).toEqual({ workflowId: 'tts_voice_design', params: { prompt: '温柔女声', text: '你好', seed: '1' } });
  });
});

describe('buildImageEditPayload', () => {
  it('多图映射 image_0/image_1（0-based）', () => {
    const p = buildImageEditPayload({ workflowId: 'qwen-edit-2509', prompt: '改成夜景', imgs: [img('a.jpg'), img('b.jpg')] });
    expect(p.params.prompt).toBe('改成夜景');
    expect(Object.keys(p.files!)).toEqual(['image_0', 'image_1']);
  });
  it('尺寸仅在 enable_specified_size 时透传', () => {
    const p = buildImageEditPayload({ workflowId: 'qwen-edit-2509', prompt: 'x', imgs: [img('a.jpg')], size: { enable_specified_size: true, width: 720, height: 1280 } });
    expect(p.params).toMatchObject({ enable_specified_size: true, width: 720, height: 1280 });
    const p2 = buildImageEditPayload({ workflowId: 'qwen-edit-2509', prompt: 'x', imgs: [img('a.jpg')], size: {} });
    expect(p2.params).toEqual({ prompt: 'x' });
  });
});

describe('buildFirstLastFramePayload', () => {
  it('1 帧 image_0，auto_generate_audio=true', () => {
    const p = buildFirstLastFramePayload({ workflowId: 'I2V', prompt: 'p', width: 1280, height: 720, duration: 5, fps: 24, frames: [img('f0.png')] });
    expect(p.params).toMatchObject({ prompt: 'p', width: 1280, height: 720, duration: 5, fps: 24, auto_generate_audio: true });
    expect(Object.keys(p.files!)).toEqual(['image_0']);
    expect(p.params.mid_frame_cursor).toBeUndefined();
  });
  it('3 帧 image_0..2 + mid_frame_cursor=0.5', () => {
    const p = buildFirstLastFramePayload({ workflowId: 'FML2V', prompt: 'p', width: 1280, height: 720, duration: 5, fps: 24, frames: [img('a'), img('b'), img('c')] });
    expect(Object.keys(p.files!)).toEqual(['image_0', 'image_1', 'image_2']);
    expect(p.params.mid_frame_cursor).toBe(0.5);
  });
  it('提供 audio 时 audio 键 + auto_generate_audio=false', () => {
    const p = buildFirstLastFramePayload({ workflowId: 'FL2V', prompt: 'p', width: 1280, height: 720, duration: 5, fps: 24, frames: [img('a'), img('b')], audio: aud });
    expect(p.params.auto_generate_audio).toBe(false);
    expect(p.files!.audio).toBe(aud);
  });
});

describe('buildDirectorPayload', () => {
  it('frame_define JSON + image_{frameSeq} + audio', () => {
    const p = buildDirectorPayload({
      workflowId: 'ltx-2.3-director', prompt: 'p', width: 1920, height: 1080, duration: 5, fps: 24,
      frameDefines: [{ frameSeq: 0, cursor: 0 }, { frameSeq: 1, cursor: 0.5 }],
      frameFiles: [img('a'), img('b')], audio: aud,
    });
    expect(p.params.frame_define).toBe(JSON.stringify([{ frameSeq: 0, cursor: 0 }, { frameSeq: 1, cursor: 0.5 }]));
    expect(p.params.auto_generate_audio).toBe(false);
    expect(Object.keys(p.files!)).toEqual(['image_0', 'image_1', 'audio']);
  });
});

describe('buildReferencePayload', () => {
  it('image/video/audio 各自 0-based', () => {
    const p = buildReferencePayload({ workflowId: 'minimax-h3-r2v', prompt: 'p', width: 1280, height: 720, duration: 5, imageRefs: [img('a'), img('b')], videoRefs: [], audioRefs: [aud] });
    expect(Object.keys(p.files!)).toEqual(['image_0', 'image_1', 'audio_0']);
  });
});

describe('resolveImageEditSizeParams', () => {
  it('enable_specified_size=true 时返回宽高', () => {
    expect(resolveImageEditSizeParams({ enable_specified_size: 'true', width: '720', height: '1280' })).toEqual({ enable_specified_size: true, width: 720, height: 1280 });
  });
  it('否则返回空对象', () => {
    expect(resolveImageEditSizeParams({ width: '720' })).toEqual({});
  });
});
```

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run src/workflows/bridge-client.test.ts`
Expected: PASS

> 注意：删除 `createProviderWorkflow` 后，`image-to-video/*.test.ts` 与硬编码文件（Task 8 删除）会暂挂；本任务先跑 bridge-client.test.ts 即可，其余文件 Task 8 一并处理。

- [ ] **Step 7: 提交**

msg: "refactor: bridge-client 改为 payload 构建器（消灭硬编码 workflow id）"

---

### Task 4: 推导纯函数（类型/能力/参数）

**Files:**
- Create: `server/src/workflows/bridge-derive.ts`
- Create: `server/src/workflows/bridge-derive.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `server/src/workflows/bridge-derive.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { deriveWorkflowType, deriveCapabilities, deriveParams } from './bridge-derive.js';
import type { BridgeDeclaredParam, BridgeTagGroup } from '../providers/comfyui-bridge/client.js';

const group = (id: string, children: BridgeTagGroup[] = [], metadata: Record<string, unknown> = {}): BridgeTagGroup => ({ id, metadata, tags: children });

describe('deriveWorkflowType', () => {
  it('text-to-image 父标签 → text-to-image', () => {
    expect(deriveWorkflowType([group('text-to-image')])).toBe('text-to-image');
  });
  it('image-edit → image-edit', () => {
    expect(deriveWorkflowType([group('image-edit')])).toBe('image-edit');
  });
  it('tts-voice-design → tts-voice-design', () => {
    expect(deriveWorkflowType([group('tts-voice-design')])).toBe('tts-voice-design');
  });
  it('image-to-video → image-to-video', () => {
    expect(deriveWorkflowType([group('image-to-video')])).toBe('image-to-video');
  });
  it('未知类型 → null', () => {
    expect(deriveWorkflowType([group('text-to-video')])).toBeNull();
  });
  it('空标签 → null', () => {
    expect(deriveWorkflowType([])).toBeNull();
  });
});

describe('deriveCapabilities', () => {
  it('reference 子标签 → modes 含 reference + 参考上限元数据', () => {
    const caps = deriveCapabilities([group('image-to-video', [group('reference', [], { maxImageCount: 9, maxAudioCount: 3, maxVideoCount: 3, maxTotalCount: 12 })])], 'image-to-video');
    expect(caps.video?.modes).toContain('reference');
    expect(caps.video?.reference).toMatchObject({ maxTotal: 12 });
  });
  it('director 子标签 → modes 含 director + audio', () => {
    const caps = deriveCapabilities([group('image-to-video', [group('director'), group('audio-input')])], 'image-to-video');
    expect(caps.video?.modes).toContain('director');
    expect(caps.video?.audio).toBe(true);
  });
  it('first-last-frame 子标签 → maxFrames=2', () => {
    const caps = deriveCapabilities([group('image-to-video', [group('first-last-frame')])], 'image-to-video');
    expect(caps.video?.modes).toContain('first-last-frame');
    expect(caps.video?.firstLastFrame?.maxFrames).toBe(2);
  });
  it('first-frame 子标签 → maxFrames=1', () => {
    const caps = deriveCapabilities([group('image-to-video', [group('first-frame')])], 'image-to-video');
    expect(caps.video?.firstLastFrame?.maxFrames).toBe(1);
  });
  it('非视频类型 → 无 video 能力、cancelable=true', () => {
    const caps = deriveCapabilities([group('text-to-image')], 'text-to-image');
    expect(caps.video).toBeUndefined();
    expect(caps.cancelable).toBe(true);
  });
});

describe('deriveParams', () => {
  const declared: BridgeDeclaredParam[] = [
    { alias: 'prompt', label: '提示词', paramType: 'text' },
    { alias: 'steps', label: '步数', paramType: 'number' },
    { alias: 'enhance', label: '增强', paramType: 'boolean' },
    { alias: 'input_image', label: '输入图', paramType: 'image' },
  ];
  it('按 expose_field 过滤并映射', () => {
    const params = deriveParams('steps,enhance', declared);
    expect(params).toEqual([
      { key: 'steps', name: '步数', type: 'integer', defaultValue: '' },
      { key: 'enhance', name: '增强', type: 'boolean', defaultValue: false },
    ]);
  });
  it('expose_field 为空 → 空数组', () => {
    expect(deriveParams(undefined, declared)).toEqual([]);
    expect(deriveParams('', declared)).toEqual([]);
  });
  it('image/video/audio 类型跳过', () => {
    const params = deriveParams('prompt,input_image', declared);
    expect(params.map((p) => p.key)).toEqual(['prompt']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/workflows/bridge-derive.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 bridge-derive.ts**

创建 `server/src/workflows/bridge-derive.ts`：

```ts
import type { BridgeDeclaredParam, BridgeTagGroup } from '../providers/comfyui-bridge/client.js';
import type { WorkflowCapabilities, WorkflowUserParamDeclaration } from './types.js';

/** 动态注册可映射的工作流类型 */
export type BridgeDerivedType = 'text-to-image' | 'image-edit' | 'tts-voice-design' | 'image-to-video';

/** 预设类型标签 → 系统工作流类型（优先级即数组顺序） */
const TYPE_TAGS: Array<{ tag: string; type: BridgeDerivedType }> = [
  { tag: 'text-to-image', type: 'text-to-image' },
  { tag: 'image-edit', type: 'image-edit' },
  { tag: 'tts-voice-design', type: 'tts-voice-design' },
  { tag: 'image-to-video', type: 'image-to-video' },
];

/** 展平标签分组：返回工作流实际打上的全部标签 id（父+子） */
export function collectTagIds(tags: BridgeTagGroup[]): string[] {
  const out: string[] = [];
  for (const g of tags) {
    out.push(g.id);
    for (const c of g.tags ?? []) out.push(c.id);
  }
  return out;
}

/**
 * 从工作流标签推导系统工作流类型；未知（如 text-to-video）返回 null（调用方跳过+warn）。
 */
export function deriveWorkflowType(tags: BridgeTagGroup[]): BridgeDerivedType | null {
  const ids = new Set(collectTagIds(tags));
  for (const { tag, type } of TYPE_TAGS) {
    if (ids.has(tag)) return type;
  }
  return null;
}

/** 取某标签（父或子）的合并元数据 */
function tagMetadata(tags: BridgeTagGroup[], id: string): Record<string, unknown> {
  for (const g of tags) {
    if (g.id === id) return g.metadata ?? {};
    const child = (g.tags ?? []).find((c) => c.id === id);
    if (child) return child.metadata ?? {};
  }
  return {};
}

/**
 * 从工作流标签推导能力声明。
 * - image-to-video 子标签：reference → reference 能力（元数据上限）；director → director；
 *   first-frame/first-last-frame → first-last-frame（maxFrames 1/2）；audio-input/audio-output → audio
 * - cancelable 恒 true（Bridge 支持中断）
 */
export function deriveCapabilities(tags: BridgeTagGroup[], type: string): WorkflowCapabilities {
  const ids = new Set(collectTagIds(tags));
  const caps: WorkflowCapabilities = { cancelable: true };
  if (type !== 'image-to-video') return caps;
  const modes: string[] = [];
  const video: { modes: string[]; audio?: boolean; reference?: unknown; firstLastFrame?: { maxFrames: number } } = { modes };
  if (ids.has('reference')) {
    modes.push('reference');
    const m = tagMetadata(tags, 'reference');
    video.reference = {
      maxTotal: Number(m.maxTotalCount ?? 12),
      types: {
        image: { max: Number(m.maxImageCount ?? 9) },
        video: { max: Number(m.maxVideoCount ?? 3) },
        audio: { max: Number(m.maxAudioCount ?? 3) },
      },
    };
  }
  if (ids.has('director')) modes.push('director');
  if (ids.has('first-last-frame') || ids.has('first-frame')) {
    modes.push('first-last-frame');
    video.firstLastFrame = { maxFrames: ids.has('first-frame') ? 1 : 2 };
  }
  if (ids.has('audio-input') || ids.has('audio-output')) video.audio = true;
  caps.video = video;
  return caps;
}

/** Bridge paramType → 系统参数类型（text→string、number→integer、boolean→boolean；文件类型跳过） */
function mapParamType(t: BridgeDeclaredParam['paramType']): WorkflowUserParamDeclaration['type'] | null {
  switch (t) {
    case 'text': return 'string';
    case 'number': return 'integer';
    case 'boolean': return 'boolean';
    default: return null; // image / video / audio：文件字段，不作为用户参数
  }
}

/**
 * 按 expose_field（逗号分隔别名）过滤 declaredParams 映射为用户参数声明。
 * @param exposeField 自动注册标签元数据 expose_field（可为 undefined）
 * @param declaredParams 详情接口的解析数组
 */
export function deriveParams(
  exposeField: string | undefined,
  declaredParams: BridgeDeclaredParam[],
): WorkflowUserParamDeclaration[] {
  const names = new Set((exposeField ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  if (names.size === 0) return [];
  const out: WorkflowUserParamDeclaration[] = [];
  for (const p of declaredParams) {
    if (!names.has(p.alias)) continue;
    const type = mapParamType(p.paramType);
    if (!type) continue;
    out.push({
      key: p.alias,
      name: p.label ?? p.alias,
      type,
      defaultValue: type === 'boolean' ? false : (type === 'integer' ? '' : ''),
    });
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/workflows/bridge-derive.test.ts`
Expected: PASS（15 用例）

- [ ] **Step 5: 提交**

msg: "feat: Bridge 工作流类型/能力/参数推导纯函数"

---

### Task 5: bridge-sync 主同步模块

**Files:**
- Create: `server/src/workflows/bridge-sync.ts`
- Create: `server/src/workflows/bridge-sync.test.ts`

- [ ] **Step 1: 写失败测试（推导 + 同步主流程）**

创建 `server/src/workflows/bridge-sync.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getImpl, getImplementations, unregister, register } from './registry.js';
import { syncBridgeWorkflows, buildSubmit } from './bridge-sync.js';
import type { ComfyuiBridgeClient, BridgeWorkflowDetail } from '../providers/comfyui-bridge/client.js';
import type { WorkflowDefinition } from './types.js';

// ── mock getProviderConfig / getProvider（避免真实配置与网络） ──
// 注意：vi.mock 工厂被 hoist 到顶部，mock 客户端必须用 vi.hoisted 定义
const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    listWorkflows: vi.fn(),
    getWorkflowDetail: vi.fn(),
  },
}));

vi.mock('../providers/config-store.js', () => ({
  getProviderConfig: vi.fn(async () => ({ baseUrl: 'http://b', password: 'pw', autoRegisterTag: 'auto' })),
}));
vi.mock('../providers/registry.js', () => ({
  getProvider: vi.fn(() => ({ id: 'comfyui-bridge', createClient: () => mockClient })),
}));

const detail = (over: Partial<BridgeWorkflowDetail> = {}): BridgeWorkflowDetail => ({
  id: 'text_to_image', name: '文生图', description: '', declaredParams: [], tags: [{ id: 'text-to-image', metadata: {}, tags: [] }], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // 清空动态注册（测试隔离）
  for (const t of ['text-to-image', 'image-edit', 'tts-voice-design', 'image-to-video']) {
    for (const w of getImplementations(t)) unregister(t, w.impl);
  }
});

describe('syncBridgeWorkflows', () => {
  it('带标签时拉取列表并逐个拉详情注册（impl=ceb-{id}）', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'text_to_image', name: '文生图', declaredParams: '[]', tags: [{ id: 'text-to-image', metadata: {}, tags: [] }] }]);
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockResolvedValue(detail());
    await syncBridgeWorkflows();
    expect(mockClient.listWorkflows).toHaveBeenCalledWith('auto');
    const w = getImpl('text-to-image', 'ceb-text_to_image');
    expect(w).toBeDefined();
    expect(w!.name).toBe('文生图');
    expect(w!.provider).toBe('comfyui-bridge');
  });

  it('未知类型工作流跳过且不注册', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'tv', name: '文生视频', declaredParams: '[]', tags: [{ id: 'text-to-video', metadata: {}, tags: [] }] }]);
    await syncBridgeWorkflows();
    expect(getImpl('text-to-video', 'ceb-tv')).toBeUndefined();
  });

  it('拉取失败时保留既有注册', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unreachable'));
    register({ type: 'text-to-image', impl: 'ceb-keep', name: 'keep', provider: 'comfyui-bridge', submit: async () => ({ taskId: 't' }) } as WorkflowDefinition);
    await expect(syncBridgeWorkflows()).resolves.toBeUndefined();
    expect(getImpl('text-to-image', 'ceb-keep')).toBeDefined();
  });
});

describe('buildSubmit（text-to-image）', () => {
  it('读取 promptPath 并执行 execute（workflowId 透传）', async () => {
    const execute = vi.fn(async () => ({ taskId: 't1' }));
    const submit = buildSubmit('ceb-text_to_image', 'text-to-image', { cancelable: true });
    const ctx = {
      vars: { promptPath: 'p.md' },
      projectConfig: { width: 1080, height: 1920 },
      readFile: async () => '一只猫',
      provider: { execute },
    } as never;
    await submit(ctx as never);
    expect(execute).toHaveBeenCalledWith({
      workflowId: 'ceb-text_to_image',
      params: expect.objectContaining({ prompt: '一只猫', width: 1080, height: 1920 }),
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/workflows/bridge-sync.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 bridge-sync.ts**

创建 `server/src/workflows/bridge-sync.ts`：

```ts
import { getProviderConfig } from '../providers/config-store.js';
import { getProvider } from '../providers/registry.js';
import {
  createComfyuiBridgeClient,
  type BridgeTagGroup,
  type BridgeWorkflowDetail,
  type BridgeWorkflowSummary,
  type ComfyuiBridgeClient,
} from '../providers/comfyui-bridge/client.js';
import { register, unregister } from './registry.js';
import { deriveCapabilities, deriveParams, deriveWorkflowType, type BridgeDerivedType } from './bridge-derive.js';
import {
  buildDirectorPayload,
  buildFirstLastFramePayload,
  buildImageEditPayload,
  buildReferencePayload,
  buildTextToImagePayload,
  buildTtsPayload,
  resolveImageEditSizeParams,
} from './bridge-client.js';
import type { WorkflowCapabilities, WorkflowDefinition, WorkflowRunContext, WorkflowVarsBase } from './types.js';

const PROVIDER_ID = 'comfyui-bridge';
const IMPL_PREFIX = 'ceb-';

/** 已注册的动态实现键（{type,impl}），重同步时清理陈旧项 */
const registeredKeys = new Set<string>();

/** 从自动注册标签元数据取 expose_field */
function exposeFieldOf(tags: BridgeTagGroup[], tagId: string): string | undefined {
  for (const g of tags) {
    if (g.id === tagId) {
      const v = (g.metadata ?? {})['expose_field'];
      return v == null ? undefined : String(v);
    }
  }
  return undefined;
}

/** 文本类提交（text-to-image / tts-voice-design 共用资产读取差异，分开实现） */

function textToImageSubmit(workflowId: string): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<TextToImageVarsLike>) => {
    const promptPath = ctx.vars.promptPath?.trim();
    if (!promptPath) throw new Error('text-to-image 需要 vars.promptPath');
    const prompt = await ctx.readFile(promptPath);
    const specified = ctx.vars.enable_specified_size === 'true';
    const width = specified && ctx.vars.width && ctx.vars.width !== ''
      ? Number(ctx.vars.width)
      : (ctx.projectConfig.width || 1080);
    const height = specified && ctx.vars.height && ctx.vars.height !== ''
      ? Number(ctx.vars.height)
      : (ctx.projectConfig.height || 1920);
    const seed = ctx.vars.seed ? Number(ctx.vars.seed) : undefined;
    const enhance = ctx.vars.enhance_prompt === 'true';
    return ctx.provider.execute(buildTextToImagePayload({ workflowId, prompt, width, height, seed, enhance_prompt: enhance }));
  };
}

function ttsSubmit(workflowId: string): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<WorkflowVarsBase>) => {
    const vars = ctx.vars as Record<string, string | undefined>;
    const prompt = (vars.prompt ?? '').trim();
    const text = (vars.text ?? '').trim();
    if (!prompt) throw new Error('tts-voice-design 需要 vars.prompt（声线描述）');
    if (!text) throw new Error('tts-voice-design 需要 vars.text（朗读文本）');
    return ctx.provider.execute(buildTtsPayload({ workflowId, prompt, text, seed: vars.seed }));
  };
}

function imageEditSubmit(workflowId: string): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<WorkflowVarsBase>) => {
    const vars = ctx.vars as Record<string, string | undefined>;
    const prompt = (vars.prompt ?? '').trim();
    if (!prompt) throw new Error('image-edit 需要 vars.prompt（编辑描述）');
    let paths: string[] = [];
    try {
      const parsed = JSON.parse(vars.imagePaths ?? '[]') as unknown;
      if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) throw new Error('imagePaths 须为字符串数组');
      paths = parsed.map((p) => p.trim()).filter(Boolean);
    } catch (e) {
      throw new Error(`image-edit imagePaths 无效: ${vars.imagePaths}; ${e instanceof Error ? e.message : String(e)}`);
    }
    if (paths.length === 0) throw new Error('image-edit 至少需要一张输入图片（vars.imagePaths）');
    const imgs: File[] = [];
    for (const rel of paths) imgs.push(await ctx.readAssertFile(rel));
    const size = resolveImageEditSizeParams(vars);
    return ctx.provider.execute(buildImageEditPayload({ workflowId, prompt, imgs, seed: vars.seed, size }));
  };
}

/** 视频提交：按 ctx.video.mode 分发给该工作流支持的模式 */
function videoSubmit(workflowId: string, caps: WorkflowCapabilities): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<WorkflowVarsBase>) => {
    const video = (ctx as { video?: import('./types.js').VideoWorkflowSubmitData }).video;
    if (!video) throw new Error('image-to-video 需要引擎注入 ctx.video');
    const modes = caps.video?.modes ?? [];
    if (!modes.includes(video.mode)) throw new Error(`工作流 ${workflowId} 不支持生成模式: ${video.mode}`);
    const seed = video.seed != null ? Number(video.seed) : undefined;
    if (video.mode === 'director') {
      const frames = video.director?.frames ?? [];
      if (frames.length < 1) throw new Error('导演台模式需要 director.frames');
      const defines = frames.map((f, i) => ({ frameSeq: i, cursor: f.cursor }));
      const files = frames.map((f) => f.file);
      return ctx.provider.execute(buildDirectorPayload({
        workflowId, prompt: video.prompt, width: video.resolution.width, height: video.resolution.height,
        duration: video.duration, fps: video.fps ?? 24, seed, frameDefines: defines, frameFiles: files,
        ...(video.director?.audio ? { audio: video.director.audio } : {}),
      }));
    }
    if (video.mode === 'first-last-frame') {
      const frames = video.director?.frames ?? [];
      const maxFrames = caps.video?.firstLastFrame?.maxFrames ?? 3;
      if (frames.length < 1 || frames.length > maxFrames) throw new Error(`首尾帧模式需要 1~${maxFrames} 帧参考图`);
      return ctx.provider.execute(buildFirstLastFramePayload({
        workflowId, prompt: video.prompt, width: video.resolution.width, height: video.resolution.height,
        duration: video.duration, fps: video.fps ?? 24, seed,
        frames: frames.map((f) => f.file),
        ...(video.director?.audio ? { audio: video.director.audio } : {}),
      }));
    }
    if (video.mode === 'reference') {
      const refs = video.references ?? [];
      if (refs.length < 1) throw new Error('参考模式需要至少 1 个参考素材');
      const imageRefs: File[] = []; const videoRefs: File[] = []; const audioRefs: File[] = [];
      for (const r of refs) {
        if (r.type === 'image') imageRefs.push(r.file);
        else if (r.type === 'video') videoRefs.push(r.file);
        else audioRefs.push(r.file);
      }
      return ctx.provider.execute(buildReferencePayload({
        workflowId, prompt: video.prompt, width: video.resolution.width, height: video.resolution.height,
        duration: video.duration, seed, imageRefs, videoRefs, audioRefs,
      }));
    }
    throw new Error(`不支持生成模式: ${video.mode}`);
  };
}

/**
 * 构建动态工作流的 submit（供单测直接使用）。
 * @param workflowId 注册后的实现标识（ceb-{id}）
 * @param type 推导的工作流类型
 * @param caps 推导的能力
 */
export function buildSubmit(
  workflowId: string,
  type: BridgeDerivedType,
  caps: WorkflowCapabilities,
): WorkflowDefinition['submit'] {
  switch (type) {
    case 'text-to-image': return textToImageSubmit(workflowId);
    case 'image-edit': return imageEditSubmit(workflowId);
    case 'tts-voice-design': return ttsSubmit(workflowId);
    case 'image-to-video': return videoSubmit(workflowId, caps);
  }
}

/** 从详情构建并注册一个动态工作流定义；未知类型返回 false */
function buildAndRegister(
  summary: BridgeWorkflowSummary,
  detail: BridgeWorkflowDetail,
  tagId: string,
): boolean {
  const type = deriveWorkflowType(detail.tags);
  if (!type) {
    console.warn(`[bridge-sync] 跳过未知类型工作流: ${detail.id}（tags=${JSON.stringify(detail.tags)}）`);
    return false;
  }
  const caps = deriveCapabilities(detail.tags, type);
  const expose = exposeFieldOf(detail.tags, tagId);
  const params = deriveParams(expose, detail.declaredParams);
  const impl = `${IMPL_PREFIX}${detail.id}`;
  const def: WorkflowDefinition = {
    type, impl, name: detail.name || detail.id,
    description: detail.description || undefined,
    provider: PROVIDER_ID,
    params,
    capabilities: caps,
    submit: buildSubmit(impl, type, caps),
  };
  register(def);
  registeredKeys.add(`${type}:${impl}`);
  return true;
}

/**
 * 从 Bridge 同步并注册工作流。
 * - 读 comfyui-bridge 配置（autoRegisterTag）；非空按标签筛选，空则拉取全部
 * - 先注册新列表，再清理陈旧 ceb-* 注册
 * - 拉取失败：记 error，保留既有注册
 */
export async function syncBridgeWorkflows(): Promise<void> {
  const config = await getProviderConfig(PROVIDER_ID);
  const providerDef = getProvider(PROVIDER_ID);
  if (!providerDef) throw new Error(`Provider 未注册: ${PROVIDER_ID}`);
  const client = providerDef.createClient(config) as ComfyuiBridgeClient;
  const tagId = String(config.autoRegisterTag ?? '').trim();

  let summaries: BridgeWorkflowSummary[];
  try {
    summaries = tagId ? await client.listWorkflows(tagId) : await client.listWorkflows();
  } catch (e) {
    console.error(`[bridge-sync] 拉取工作流列表失败，保留既有注册: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  const nextKeys = new Set<string>();
  for (const s of summaries) {
    try {
      const detail = await client.getWorkflowDetail(s.id);
      if (buildAndRegister(s, detail, tagId)) nextKeys.add(`${deriveWorkflowType(detail.tags)}:${IMPL_PREFIX}${detail.id}`);
    } catch (e) {
      console.warn(`[bridge-sync] 工作流详情拉取失败，跳过: ${s.id}; ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 清理陈旧注册（本次未出现的历史 ceb-*）
  for (const key of registeredKeys) {
    if (nextKeys.has(key)) continue;
    const [type, impl] = key.split(':');
    unregister(type, impl);
    registeredKeys.delete(key);
  }
}

/** TextToImageVars 形状（避免与业务 vars 强耦合） */
interface TextToImageVarsLike extends WorkflowVarsBase {
  promptPath?: string;
  enable_specified_size?: string;
  width?: string;
  height?: string;
  enhance_prompt?: string;
  seed?: string;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/workflows/bridge-sync.test.ts`
Expected: PASS

> 若 mock 网络相关失败，把 `vi.mock` 顶部的 `mockClient` 定义为模块级并在 `getProvider` mock 中引用（如代码所示）。

- [ ] **Step 5: 提交**

msg: "feat: Bridge 工作流动态同步模块（bridge-sync）"

---

### Task 6: configSchema 新增 autoRegisterTag

**Files:**
- Modify: `server/src/providers/comfyui-bridge/index.ts`

- [ ] **Step 1: 新增配置字段**

在 `index.ts` 的 `password` 字段之后、`createClient` 之前追加：

```ts
    {
      key: 'autoRegisterTag',
      label: '工作流自动注册标签id',
      type: 'string',
      required: false,
      defaultValue: '',
      placeholder: '如 auto',
      description: 'Bridge 工作流带该标签时自动注册为系统可调用工作流；留空则尝试注册所有获取到的工作流',
    },
```

- [ ] **Step 2: 验证**

Run: `cd C:\Users\xiaotao\code\ai-video-workstation && npm run typecheck`
Expected: 0 错误

- [ ] **Step 3: 提交**

msg: "feat: comfyui-bridge 配置新增工作流自动注册标签 id 字段"

---

### Task 7: 触发接线（启动 + 配置变更重同步）

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/src/routes/workflow.ts`

- [ ] **Step 1: 启动接线**

`server/src/index.ts` 中，`discoverWorkflows()` 调用处改为：

```ts
import { discoverWorkflows, startEngine } from './workflow-engine.js';
import { syncBridgeWorkflows } from './workflows/bridge-sync.js';
...
  discoverWorkflows().then(() => {
    // Bridge 工作流动态注册（失败不阻塞服务启动）
    syncBridgeWorkflows().catch((e) => {
      console.error(`[bridge-sync] 启动同步失败: ${e instanceof Error ? e.message : String(e)}`);
    });
  });
```

- [ ] **Step 2: 配置保存后重同步**

`server/src/routes/workflow.ts` 的 `PUT /api/providers/:id` handler 中，`await setProviderConfig(id, config);` 之后追加：

```ts
    // Bridge 工作流动态重同步（仅 comfyui-bridge 配置变化触发；失败不阻塞响应）
    if (id === 'comfyui-bridge') {
      const { syncBridgeWorkflows } = await import('../workflows/bridge-sync.js');
      syncBridgeWorkflows().catch((e) => {
        console.error(`[bridge-sync] 配置变更重同步失败: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
```

（使用动态 import 避免桥接模块在路由加载期初始化。）

- [ ] **Step 3: 验证 + 提交**

Run: `npm run typecheck`
Expected: 0 错误

msg: "feat: 启动与 Provider 配置变更后触发 Bridge 工作流重同步"

---

### Task 8: 删除硬编码文件 + discovery impl 解析

**Files:**
- Delete: `server/src/workflows/text-to-image/default.ts`、`text-to-image/default.test.ts`
- Delete: `server/src/workflows/image-edit/default.ts`
- Delete: `server/src/workflows/tts-voice-design/default.ts`
- Delete: `server/src/workflows/image-to-video/default.ts`、`image-to-video/default.test.ts`
- Delete: `server/src/workflows/image-to-video/minimax-h3-r2v.ts`、`image-to-video/minimax.test.ts`
- Modify: `server/src/workflows/discovery.ts`

- [ ] **Step 1: 删除文件**

用 `git rm` 删除上述 8 个文件。

- [ ] **Step 2: discovery.ts 去掉硬编码 impl**

在 `server/src/workflows/discovery.ts` 中，删除所有任务 `vars` 前的 `impl: 'default',` 行（character-appearance / character-voice / stage-image / scene-tts / scene-stage-image / video-generate 各处）。任务不再携带 impl，由批量创建端 `resolveImpl(workflowId, implByAssetType[assetType])` 解析（routes/workflow.ts 已有该函数，检查 batch-run 路由确认调用）。

- [ ] **Step 3: 检查引用**

Run: `cd C:\Users\xiaotao\code\ai-video-workstation\server && npx tsc --noEmit`
Expected: 0 错误。若 `registry.test.ts`/`bridge-sync.test.ts` 之外的测试引用了被删实现（如 `getImpl('image-to-video','ltx')`），同步更新/删除这些用例。

- [ ] **Step 4: 运行全量 server 测试**

Run: `npx vitest run src`
Expected: 全过（删除的用例已移除，其余保留）

- [ ] **Step 5: 提交**

msg: "refactor: 删除硬编码 Bridge 工作流实现（改由动态注册）"

---

### Task 9: 前端去掉 'default' impl 兜底（VideoGenerateEditor 已能力驱动）

**Files:**
- Modify: `frontend/src/canvas/useCanvasGeneration.ts`（第 117、141 行）
- Modify: `frontend/src/canvas/useCanvasGeneration.test.ts`

> 说明：`VideoGenerateEditor.vue` 早前已重写为「直接选择 image-to-video 实现 + 按 capabilities 渲染」（`workflowImpl`/`currentModes`/`flfMaxFrames` 等均已存在），无需改动。动态注册后 impl 为 `ceb-{id}`，无 `'default'`，因此只需去掉 `useCanvasGeneration` 的 `'default'` 兜底，让服务端 `resolveImpl` 兜底到第一个实现。

- [ ] **Step 1: 去掉两处 'default' 兜底**

`frontend/src/canvas/useCanvasGeneration.ts`：

第 117 行（视频分支）：
```ts
          impl: String(node.config.workflowImpl ?? 'default'),
```
改为：
```ts
          impl: String(node.config.workflowImpl ?? ''),
```

第 141 行（图片分支）：
```ts
    const impl = String(config.workflowImpl ?? 'default')
```
改为：
```ts
    const impl = String(config.workflowImpl ?? '')
```
（空串由服务端 `resolveImpl(workflowId, impl)` 兜底到该类型第一个实现。）

- [ ] **Step 2: 更新测试断言**

`frontend/src/canvas/useCanvasGeneration.test.ts` 中「视频节点：走自包含提交参数并生成 .mp4 产物路径」用例：

```ts
      config: { workflowImpl: 'default', workflowParams: { seed: '1' } },
```
改为：
```ts
      config: { workflowImpl: 'ceb-ltx-2.3-director', workflowParams: { seed: '1' } },
```
断言 `impl: 'default'` 改为 `impl: 'ceb-ltx-2.3-director'`。

- [ ] **Step 3: 运行前端测试**

Run: `cd C:\Users\xiaotao\code\ai-video-workstation\frontend && npx vitest run src/canvas/useCanvasGeneration.test.ts`
Expected: PASS

- [ ] **Step 4: 验证 + 提交**

Run: `cd C:\Users\xiaotao\code\ai-video-workstation && npm run typecheck`
Expected: 0 错误

msg: "refactor: 前端去掉 'default' impl 兜底（动态注册无 default）"

---

### Task 10: 全量验证

- [ ] **Step 1: 类型 + lint**

Run: `cd C:\Users\xiaotao\code\ai-video-workstation && npm run typecheck && npm run lint`
Expected: 0 error（lint 仅 refs.ts 既有 warning）

- [ ] **Step 2: 全量测试**

Run: `cd server && npx vitest run`；`cd frontend && npx vitest run`
Expected: 全部通过

- [ ] **Step 3: 构建**

Run: `cd C:\Users\xiaotao\code\ai-video-workstation && npm run build`
Expected: 成功

- [ ] **Step 4: 手动冒烟**

配置 comfyui-bridge `autoRegisterTag` → 重启 → `GET /api/workflows` 应出现 `ceb-*` 实现且能力/参数正确；留空 autoRegisterTag → 重启 → 注册全部可获取工作流；Bridge 不可达 → 保留既有注册。

- [ ] **Step 5: 提交（如有遗漏改动）**

msg: "chore: Bridge 工作流动态注册全量验证"
