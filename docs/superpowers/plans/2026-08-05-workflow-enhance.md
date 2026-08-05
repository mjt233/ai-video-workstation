# 创作工作流优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强视频工作流能力声明（首尾帧/参考模式/音频/最大时长）、执行接口与场景概念解耦、支持中断，并在资产画布新增【生成视频】节点（支持图片/音频/视频输入、嵌入导演台）。

**Architecture:** 后端新增 `VideoCapabilities` 能力声明与自包含 `VideoWorkflowSubmitData`（File 形态）提交数据；`/workflow/run` 的 `params` 增加 `video`（wire 形态，路径）；引擎按任务来源（画布节点透传 / 分镜批量走场景适配层）注入 `ctx.video`；工作流实现只消费 `ctx.video` 不再读分镜文件。前端扩展 `DataType` 与 `audio-loader`/`video-loader` 节点、多端口支持、`video-generate` 节点（导演台嵌入 + 参考模式），并用画布级内部事件机制在连线变化时同步导演台轨道。

**Tech Stack:** Express + TypeScript（服务端）、Vue 3 + Vuetify 3 + Vue Flow + vitest（前端）、ComfyUI Easy Bridge（bridge-client，已封装）。

**设计文档:** `docs/superpowers/specs/2026-08-05-workflow-enhance-design.md`

---

## 阶段一：后端

### Task 1: 工作流能力声明扩展

**Files:**
- Modify: `server/src/workflows/types.ts`（`WorkflowCapabilities` 增 `video`/`cancelable`、删 `director`；新增 `VideoGenerateMode`/`VideoReferenceCapability`/`VideoCapabilities`）
- Modify: `server/src/workflow-engine.ts`（导演台注入条件改用 `video.modes`）
- Modify: `server/src/workflows/image-to-video/default.ts`（ltx 能力声明）
- Test: `server/src/workflows/capabilities.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `server/src/workflows/capabilities.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { register, getAllWorkflows } from './registry.js';
import type { WorkflowDefinition } from './types.js';

describe('工作流能力声明透传', () => {
  it('video 能力与 cancelable 经 getAllWorkflows 透传前端', () => {
    const fake: WorkflowDefinition = {
      id: 'test-video-cap',
      name: '测试视频',
      impl: 'default',
      capabilities: {
        video: {
          modes: ['director', 'reference'],
          audio: true,
          maxDuration: 15,
          reference: {
            types: { image: { max: 9 }, video: { max: 3 }, audio: { max: 3 } },
            maxTotal: 12,
            audioRequiresVisual: true,
          },
        },
        cancelable: true,
      },
      submit: async () => ({ taskId: 't' }),
      parseOutput: async () => ({ type: 'body', contentType: 'video/mp4', data: '', filename: 'x.mp4' }),
    };
    register(fake);
    const found = getAllWorkflows().find((w) => w.id === 'test-video-cap');
    expect(found).toBeDefined();
    expect(found!.implementations[0].capabilities?.video?.modes).toEqual(['director', 'reference']);
    expect(found!.implementations[0].capabilities?.video?.maxDuration).toBe(15);
    expect(found!.implementations[0].capabilities?.video?.reference?.maxTotal).toBe(12);
    expect(found!.implementations[0].capabilities?.cancelable).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/workflows/capabilities.test.ts`
Expected: 编译失败——`WorkflowCapabilities` 尚无 `video`/`cancelable` 字段。

- [ ] **Step 3: 扩展 types.ts**

在 `server/src/workflows/types.ts` 的 `WorkflowCapabilities` 定义处，替换为：

```ts
/** 视频生成模式（可组合声明） */
export type VideoGenerateMode = 'director' | 'first-last-frame' | 'reference';

/** 参考模式能力声明 */
export interface VideoReferenceCapability {
  /** 各参考类型的最大数量（未声明=不支持该类型） */
  types: {
    image?: { max: number };
    video?: { max: number; minDuration?: number; maxDuration?: number };
    audio?: { max: number; minDuration?: number; maxDuration?: number };
  };
  /** 参考素材总数量上限 */
  maxTotal: number;
  /** 音频是否不能作为唯一输入（默认 false） */
  audioRequiresVisual?: boolean;
}

/** 视频工作流能力 */
export interface VideoCapabilities {
  /** 支持的生成模式（可组合，如 ['director', 'reference']） */
  modes: VideoGenerateMode[];
  /** 是否支持输入音频（供导演台/首尾帧模式使用） */
  audio?: boolean;
  /** 参考模式声明（modes 含 reference 时必须提供） */
  reference?: VideoReferenceCapability;
  /** 视频最大输出时长（秒，默认 15） */
  maxDuration?: number;
}

/**
 * 工作流能力声明（注册时声明，经 /api/workflows 透传前端）。
 *
 * 前端据此展示能力入口（导演台模式、外部音频导入、参考模式等），
 * 引擎据此决定是否注入对应负载（如 video 自包含提交数据）。
 */
export interface WorkflowCapabilities {
  /** 视频工作流能力（导演台/首尾帧/参考模式与限制） */
  video?: VideoCapabilities;
  /** 是否支持传入外部音频（如导演台混音产物） */
  audio?: boolean;
  /** 是否支持中断（所有 Bridge 工作流声明 true） */
  cancelable?: boolean;
}
```

注意：删除原 `director?: boolean` 字段。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/workflows/capabilities.test.ts`
Expected: PASS。

- [ ] **Step 5: 迁移引擎导演台判断**

在 `server/src/workflow-engine.ts` 中，将导演台注入条件（原 `capabilities?.director`）改为：

```ts
if (task.workflow_id === 'image-to-video' && capabilities?.video?.modes?.includes('director')) {
```

（保持该 if 块其余逻辑不变；该块会在 Task 5 被整体移除。）

- [ ] **Step 6: 更新 ltx 能力声明**

在 `server/src/workflows/image-to-video/default.ts` 中，把 `baseDefinition.capabilities` 从 `{ director: true, audio: true }` 改为：

```ts
capabilities: { video: { modes: ['director'], audio: true, maxDuration: 15 }, cancelable: true },
```

- [ ] **Step 7: 类型检查 + 跑测试 + 提交**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: 无类型错误，全部测试通过。

```bash
git add server/src/workflows/types.ts server/src/workflow-engine.ts server/src/workflows/image-to-video/default.ts server/src/workflows/capabilities.test.ts
git commit -m "feat: 工作流能力声明扩展（video/cancelable）"
```

### Task 2: 统一视频提交数据类型

**Files:**
- Modify: `server/src/workflows/types.ts`（新增 `Resolution`/`VideoReferenceWire`/`VideoDirectorWire`/`VideoWorkflowSubmitParams`/`VideoReference`/`VideoDirectorData`/`VideoWorkflowSubmitData`；`WorkflowRunContext` 增 `video?`）

- [ ] **Step 1: 在 types.ts 追加类型**

在 `server/src/workflows/types.ts` 中追加（放在 `WorkflowCapabilities` 之后）：

```ts
/** 资产分辨率 */
export interface Resolution {
  /** 宽度（像素） */
  width: number;
  /** 高度（像素） */
  height: number;
}

/** 参考素材（wire 形态：路径，画布节点提交用） */
export interface VideoReferenceWire {
  type: 'image' | 'video' | 'audio';
  /** 项目内相对路径（assert/ 下） */
  path: string;
}

/** 导演台/首尾帧数据（wire 形态：路径） */
export interface VideoDirectorWire {
  /** 关键帧（frameSeq 按数组顺序 0,1,2…，cursor 0~1） */
  frames: Array<{ path: string; cursor: number }>;
  /** 音频（可选） */
  audio?: { path: string };
}

/**
 * 统一视频工作流提交参数（API wire 形态）。
 * 画布节点直接组装并随 /workflow/run 的 params.video 提交，
 * 引擎用 readAssertFile 将 path 解析为 File 后注入 ctx.video。
 */
export interface VideoWorkflowSubmitParams<T = Record<string, unknown>> {
  /** 生成模式 */
  mode: VideoGenerateMode;
  /** 输出分辨率 */
  resolution: Resolution;
  /** 视频帧率（可选，缺省走项目配置） */
  fps?: number;
  /** 视频时长（秒） */
  duration: number;
  /** 视频生成提示词 */
  prompt: string;
  /** 随机种子（可选） */
  seed?: number;
  /** 导演台/首尾帧数据（mode 为 director / first-last-frame 时使用） */
  director?: VideoDirectorWire;
  /** 参考素材（mode=reference 时使用） */
  references?: VideoReferenceWire[];
  /** 传递给具体工作流实现的额外参数 */
  extraParams: T;
}

/** 参考素材（运行时形态：File 已解析） */
export interface VideoReference {
  type: 'image' | 'video' | 'audio';
  file: File;
}

/** 导演台/首尾帧数据（运行时形态：File 已解析） */
export interface VideoDirectorData {
  /** 关键帧（frameSeq 按数组顺序 0,1,2…，cursor 0~1） */
  frames: Array<{ file: File; cursor: number }>;
  /** 音频（可选） */
  audio?: File;
}

/**
 * 统一视频工作流提交数据（自包含，脱离"场景/分镜/集数"概念）。
 * 画布节点经引擎解析 wire 形态得到；分镜/批量路径由场景适配层组装。
 * 工作流实现（submit）只消费本结构，不再读取分镜文件。
 */
export interface VideoWorkflowSubmitData<T = Record<string, unknown>> {
  /** 生成模式 */
  mode: VideoGenerateMode;
  /** 输出分辨率 */
  resolution: Resolution;
  /** 视频帧率（可选，缺省走项目配置） */
  fps?: number;
  /** 视频时长（秒） */
  duration: number;
  /** 视频生成提示词 */
  prompt: string;
  /** 随机种子（可选） */
  seed?: number;
  /** 导演台/首尾帧数据（mode 为 director / first-last-frame 时使用） */
  director?: VideoDirectorData;
  /** 参考素材（mode=reference 时使用） */
  references?: VideoReference[];
  /** 传递给具体工作流实现的额外参数 */
  extraParams: T;
}
```

- [ ] **Step 2: WorkflowRunContext 增加 video**

在 `WorkflowRunContext` interface 中追加字段：

```ts
  /** 视频自包含提交数据：仅当工作流为视频类型且数据已组装时注入（画布节点透传 / 场景适配层生成） */
  video?: VideoWorkflowSubmitData;
```

- [ ] **Step 3: 类型检查 + 提交**

Run: `cd server && npx tsc --noEmit`
Expected: 无错误（本任务无运行时行为，类型由后续任务消费）。

```bash
git add server/src/workflows/types.ts
git commit -m "feat: 统一视频工作流提交数据类型"
```

### Task 3: 场景适配层 scene-adapter

**Files:**
- Create: `server/src/workflows/scene-adapter.ts`
- Test: `server/src/workflows/scene-adapter.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `server/src/workflows/scene-adapter.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildSceneVideoSubmitData, type SceneAdapterDeps } from './scene-adapter.js';
import type { VideoCapabilities } from './types.js';

function makeDeps(overrides: Partial<SceneAdapterDeps> = {}): SceneAdapterDeps {
  const mkFile = (name: string): File => new File(['x'], name, { type: 'image/png' });
  return {
    readFile: async (rel: string) => {
      if (rel.endsWith('overview.json')) return JSON.stringify({ duration: 5 });
      if (rel.endsWith('prompt.md')) return '一个测试分镜';
      if (rel.endsWith('script.json')) return JSON.stringify([{ 角色名: '小明', 台词: '你好' }]);
      if (rel.includes('character/小明/voice.md')) return '低沉男声';
      throw new Error(`unexpected readFile: ${rel}`);
    },
    readAssertFile: async (rel: string) => mkFile(rel.split('/').pop() ?? 'x'),
    fileExists: async () => false,
    mixAudioTracks: async () => {},
    readTempAudio: async () => new Uint8Array([1, 2]),
    removeTempAudio: async () => {},
    generateVoice: async (text, desc) => new File(['audio'], 'voice.flac', { type: 'audio/flac' }),
    ...overrides,
  };
}

const PROJECT_CONFIG = { width: 1080, height: 1920, fps: 24 };

describe('buildSceneVideoSubmitData', () => {
  it('导演台模式：有 director.json 且实现支持 director', async () => {
    const deps = makeDeps({
      readFile: async (rel: string) => {
        if (rel.endsWith('director.json')) {
          return JSON.stringify({
            version: 1, duration: 5, width: 720, height: 1280, fps: 30,
            imageClips: [{ path: 'assert/scene/1/1/stage/0.jpg', startOffset: 0, duration: 2 }],
            audioClips: [],
          });
        }
        if (rel.endsWith('prompt.md')) return '导演台提示词';
        throw new Error(`unexpected: ${rel}`);
      },
    });
    const caps: VideoCapabilities = { modes: ['director'], audio: true };
    const data = await buildSceneVideoSubmitData('p', '1', '1', caps, PROJECT_CONFIG, deps);
    expect(data.mode).toBe('director');
    expect(data.duration).toBe(5);
    expect(data.resolution).toEqual({ width: 720, height: 1280 });
    expect(data.director?.frames).toHaveLength(1);
    expect(data.director?.frames[0].cursor).toBe(0);
  });

  it('首尾帧模式：无 director.json 时按 stage.json 生成 frames，cursor 均匀分布', async () => {
    const deps = makeDeps({
      readFile: async (rel: string) => {
        if (rel.endsWith('overview.json')) return JSON.stringify({ duration: 6 });
        if (rel.endsWith('stage.json')) {
          return JSON.stringify([
            { 基础场景: 'a' },
            { 基础场景: 'b' },
            { 基础场景: 'c', disabled: true },
          ]);
        }
        if (rel.endsWith('prompt.md')) return '提示词';
        if (rel.endsWith('script.json')) return JSON.stringify([]);
        throw new Error(`unexpected: ${rel}`);
      },
    });
    const caps: VideoCapabilities = { modes: ['first-last-frame'] };
    const data = await buildSceneVideoSubmitData('p', '1', '1', caps, PROJECT_CONFIG, deps);
    expect(data.mode).toBe('first-last-frame');
    // disabled 的第三帧被跳过 → 只有 2 帧
    expect(data.director?.frames).toHaveLength(2);
    expect(data.director?.frames[0].cursor).toBe(0);
    expect(data.director?.frames[1].cursor).toBe(1);
  });

  it('首尾帧模式：台词生成 TTS 配音', async () => {
    const genVoice = vi.fn(async () => new File(['a'], 'v.flac', { type: 'audio/flac' }));
    const deps = makeDeps({
      readFile: async (rel: string) => {
        if (rel.endsWith('overview.json')) return JSON.stringify({ duration: 6 });
        if (rel.endsWith('stage.json')) return JSON.stringify([{ 基础场景: 'a' }, { 基础场景: 'b' }]);
        if (rel.endsWith('prompt.md')) return '提示词';
        if (rel.endsWith('script.json')) return JSON.stringify([{ 角色名: '小明', 台词: '你好' }]);
        if (rel.includes('character/小明/voice.md')) return '低沉男声';
        throw new Error(`unexpected: ${rel}`);
      },
      generateVoice: genVoice,
    });
    const caps: VideoCapabilities = { modes: ['first-last-frame'] };
    const data = await buildSceneVideoSubmitData('p', '1', '1', caps, PROJECT_CONFIG, deps);
    expect(genVoice).toHaveBeenCalledTimes(1);
    expect(genVoice).toHaveBeenCalledWith('你好。', '低沉男声');
    expect(data.director?.audio).toBeDefined();
  });

  it('实现不支持导演台时即使有 director.json 也走首尾帧模式', async () => {
    const deps = makeDeps({
      readFile: async (rel: string) => {
        if (rel.endsWith('director.json')) {
          return JSON.stringify({ version: 1, duration: 5, width: 720, height: 1280, fps: 30, imageClips: [], audioClips: [] });
        }
        if (rel.endsWith('overview.json')) return JSON.stringify({ duration: 5 });
        if (rel.endsWith('stage.json')) return JSON.stringify([{ 基础场景: 'a' }]);
        if (rel.endsWith('prompt.md')) return '提示词';
        if (rel.endsWith('script.json')) return JSON.stringify([]);
        throw new Error(`unexpected: ${rel}`);
      },
    });
    const caps: VideoCapabilities = { modes: ['reference'] };
    const data = await buildSceneVideoSubmitData('p', '1', '1', caps, PROJECT_CONFIG, deps);
    expect(data.mode).toBe('first-last-frame');
    expect(data.director?.frames).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/workflows/scene-adapter.test.ts`
Expected: FAIL——`Cannot find module './scene-adapter.js'`。

- [ ] **Step 3: 实现 scene-adapter.ts**

新建 `server/src/workflows/scene-adapter.ts`：

```ts
/**
 * 场景适配层：将"分镜/集数"维度的文件数据组装为自包含的视频提交数据
 * （VideoWorkflowSubmitData），供工作流实现直接消费。
 *
 * 这是执行解耦的核心：分镜/批量路径由引擎调用本模块读取
 * director.json / overview.json / stage.json / script.json / voice.md / prompt.md，
 * 组装成与画布节点一致的自包含数据；工作流实现内部不再读取任何分镜文件。
 */
import os from 'os';
import path from 'path';
import { parseDirectorJson, computeFrameDefines } from '../assets/director.js';
import { buildDirectorPayload, type DirectorInjectDeps } from './director-inject.js';
import type { ProjectConfig, VideoCapabilities, VideoWorkflowSubmitData } from './types.js';

/** 场景适配层依赖集合（由引擎注入，便于单测 mock） */
export interface SceneAdapterDeps extends DirectorInjectDeps {
  /** 判断项目内相对路径是否存在 */
  fileExists(rel: string): Promise<boolean>;
  /** 拼接台词生成配音；返回 null 表示无台词/生成失败降级（不注入音频） */
  generateVoice(text: string, voiceDesc: string): Promise<File | null>;
}

/** 场景帧定义（stage.json 元素的最小形态） */
interface SceneStageDef {
  基础场景?: string;
  登场角色?: string[];
  prompt?: string;
  /** 是否禁用该场景帧：true 时视频生成跳过此帧 */
  disabled?: boolean;
}

/** 台词行（script.json 元素） */
interface ScriptLine {
  角色名?: string;
  台词?: string;
}

/**
 * 读取分镜 prompt.md 并校验非空。
 *
 * @param deps 场景适配层依赖
 * @param episode 集数
 * @param shot 分镜编号
 * @returns 提示词文本
 * @throws {Error} prompt.md 不存在或为空时
 */
async function readScenePrompt(deps: SceneAdapterDeps, episode: string, shot: string): Promise<string> {
  const prompt = (await deps.readFile(`prompt/scene/${episode}/${shot}/prompt.md`)).trim();
  if (!prompt) {
    throw new Error('分镜 prompt.md 为空');
  }
  return prompt;
}

/**
 * 从 overview.json 读取分镜时长（正整数秒）。
 *
 * @param deps 场景适配层依赖
 * @param episode 集数
 * @param shot 分镜编号
 * @returns 时长（秒）
 */
async function readSceneDuration(deps: SceneAdapterDeps, episode: string, shot: string): Promise<number> {
  const raw = await deps.readFile(`prompt/scene/${episode}/${shot}/overview.json`);
  const overview = JSON.parse(raw) as { duration?: unknown };
  if (typeof overview.duration !== 'number' || !Number.isInteger(overview.duration) || overview.duration <= 0) {
    throw new Error(`分镜时长无效（overview.json.duration 须为正整数秒）: ${String(overview.duration)}`);
  }
  return overview.duration;
}

/**
 * 收集分镜启用（未禁用）的场景帧图片路径，并按 index 升序返回。
 * 缺失图片时抛错（与既有 enrichImageToVideoParams 行为一致）。
 *
 * @param deps 场景适配层依赖
 * @param episode 集数
 * @param shot 分镜编号
 * @returns assert/ 相对路径数组
 */
async function collectStageImages(deps: SceneAdapterDeps, episode: string, shot: string): Promise<string[]> {
  const raw = await deps.readFile(`prompt/scene/${episode}/${shot}/stage.json`);
  const stageDefs = JSON.parse(raw) as unknown;
  if (!Array.isArray(stageDefs) || stageDefs.length === 0) {
    throw new Error('stage.json 须为非空数组');
  }
  const images: string[] = [];
  for (let i = 0; i < stageDefs.length; i++) {
    const def = stageDefs[i] as SceneStageDef | undefined;
    if (def && def.disabled === true) continue;
    const rel = `assert/scene/${episode}/${shot}/stage/${i}.jpg`;
    if (await deps.fileExists(rel)) {
      images.push(rel);
    } else {
      throw new Error(`分镜场景图缺失（请先生成 scene-stage-image / image-edit）: ${rel}`);
    }
  }
  if (images.length < 1) {
    throw new Error('分镜没有可用的场景帧（stage.json 为空或全部禁用）');
  }
  return images;
}

/**
 * 计算首尾帧模式下第 i 帧的 cursor：首帧 0、尾帧 1、中间帧均匀分布。
 *
 * @param index 帧序号（0 起）
 * @param total 帧总数
 * @returns cursor 值（0~1）
 */
export function stageCursor(index: number, total: number): number {
  if (total <= 1) return 0;
  return index / (total - 1);
}

/**
 * 依据 script.json 拼接台词并调用 generateVoice 生成配音。
 * script.json 缺失/无台词/生成失败时返回 undefined（不注入音频）。
 *
 * @param deps 场景适配层依赖
 * @param episode 集数
 * @param shot 分镜编号
 * @returns 配音 File 或 undefined
 */
async function buildTtsAudio(deps: SceneAdapterDeps, episode: string, shot: string): Promise<File | undefined> {
  try {
    const scriptRaw = await deps.readFile(`prompt/scene/${episode}/${shot}/script.json`);
    const script = JSON.parse(scriptRaw) as unknown;
    if (!Array.isArray(script)) return undefined;
    const lines = script as ScriptLine[];
    const texts = lines.map((l) => (l.台词 ?? '').trim()).filter(Boolean);
    if (texts.length === 0) return undefined;
    const combined = texts.join('。') + '。';

    const firstChar = lines.find((l) => (l.角色名 ?? '').trim());
    let desc = '自然、清晰的中文女声，语速适中，情感平和。';
    if (firstChar?.角色名) {
      try {
        const voiceMd = await deps.readFile(`prompt/character/${firstChar.角色名.trim()}/voice.md`);
        if (voiceMd.trim()) desc = voiceMd.trim();
      } catch {
        // voice.md 缺失则保持默认声线描述
      }
    }
    return (await deps.generateVoice(combined, desc)) ?? undefined;
  } catch {
    // script.json 不存在或无效 → 没有台词，不生成音频
    return undefined;
  }
}

/**
 * 组装场景自包含视频提交数据。
 *
 * 模式优先级：
 * 1. 实现声明支持 director 且分镜存在 director.json（含有效 imageClips）→ 导演台模式，
 *    复用 buildDirectorPayload（含用户滑块 cursor 与混音音频）；
 * 2. 否则 → 首尾帧模式：stage.json 启用帧 + cursor 均匀分布 + 音频
 *    （优先 merged.flac，其次 script.json TTS）。
 *
 * @param project 项目名
 * @param episode 集数
 * @param shot 分镜编号
 * @param capabilities 所选实现的视频能力声明（可为空）
 * @param projectConfig 项目配置（分辨率/帧率兜底）
 * @param deps 场景适配层依赖
 * @returns 自包含视频提交数据
 */
export async function buildSceneVideoSubmitData(
  project: string,
  episode: string,
  shot: string,
  capabilities: VideoCapabilities | undefined,
  projectConfig: ProjectConfig,
  deps: SceneAdapterDeps,
): Promise<VideoWorkflowSubmitData> {
  const prompt = await readScenePrompt(deps, episode, shot);

  // ── 导演台模式 ──
  if (capabilities?.modes?.includes('director')) {
    const payload = await buildDirectorPayload(project, episode, shot, deps);
    if (payload) {
      return {
        mode: 'director',
        resolution: { width: payload.width, height: payload.height },
        fps: payload.fps,
        duration: payload.duration,
        prompt,
        director: {
          frames: payload.frames.map((f) => ({ file: f.file, cursor: f.cursor })),
          ...(payload.audio ? { audio: payload.audio } : {}),
        },
        extraParams: {},
      };
    }
  }

  // ── 首尾帧模式 ──
  const duration = await readSceneDuration(deps, episode, shot);
  const stageImages = await collectStageImages(deps, episode, shot);
  const files = await Promise.all(stageImages.map((p) => deps.readAssertFile(p)));
  const frames = files.map((file, i) => ({ file, cursor: stageCursor(i, files.length) }));

  let audio: File | undefined;
  const mergedRel = `assert/scene/${episode}/${shot}/audio/merged.flac`;
  if (await deps.fileExists(mergedRel)) {
    audio = await deps.readAssertFile(mergedRel);
  } else {
    audio = await buildTtsAudio(deps, episode, shot);
  }

  return {
    mode: 'first-last-frame',
    resolution: { width: projectConfig.width, height: projectConfig.height },
    fps: projectConfig.fps,
    duration,
    prompt,
    director: { frames, ...(audio ? { audio } : {}) },
    extraParams: {},
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/workflows/scene-adapter.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 类型检查 + 提交**

Run: `cd server && npx tsc --noEmit`
Expected: 无错误。

```bash
git add server/src/workflows/scene-adapter.ts server/src/workflows/scene-adapter.test.ts
git commit -m "feat: 场景适配层将分镜数据组装为自包含视频提交数据"
```

### Task 4: /workflow/run 支持 video 参数 + db 远程任务 ID

**Files:**
- Modify: `server/src/routes/workflow.ts`（`/workflow/run` 接受 `params.video`；`parseTaskParams`/`toTaskResponse` 含 `video` 与 `remoteTaskId`；导出 `parseTaskParams`）
- Modify: `server/src/db.ts`（新增 `updateTaskParams`）
- Test: `server/src/routes/workflow.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `server/src/routes/workflow.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { parseTaskParams } from './workflow.js';

describe('parseTaskParams', () => {
  it('包含 video 自包含提交参数（wire 形态）', () => {
    const parsed = parseTaskParams(JSON.stringify({
      vars: { episode: '1', shot: '1' },
      outputPath: 'assert/scene/1/1/video.mp4',
      video: {
        mode: 'reference',
        resolution: { width: 1080, height: 1920 },
        duration: 5,
        prompt: '测试',
        references: [
          { type: 'image', path: 'assert/scene/1/1/stage/0.jpg' },
          { type: 'audio', path: 'assert/scene/1/1/audio/merged.flac' },
        ],
        extraParams: {},
      },
    }));
    expect(parsed.video?.mode).toBe('reference');
    expect(parsed.video?.references).toHaveLength(2);
    expect(parsed.video?.references?.[0].path).toBe('assert/scene/1/1/stage/0.jpg');
  });

  it('远程任务 ID 透传', () => {
    const parsed = parseTaskParams(JSON.stringify({
      vars: {},
      outputPath: 'assert/x.mp4',
      remoteTaskId: 'bridge-task-1',
    }));
    expect(parsed.remoteTaskId).toBe('bridge-task-1');
  });

  it('无 video 时返回 undefined', () => {
    const parsed = parseTaskParams(JSON.stringify({ vars: {}, outputPath: 'assert/x.mp4' }));
    expect(parsed.video).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/routes/workflow.test.ts`
Expected: FAIL——`parseTaskParams` 未导出。

- [ ] **Step 3: 修改 routes/workflow.ts**

在 `server/src/routes/workflow.ts`：

1. 顶部 import 增加类型：

```ts
import type { VideoWorkflowSubmitParams } from '../workflows/types.js';
```

2. `POST /workflow/run` 的 body 类型与 createTask 参数：

```ts
workflowRouter.post('/workflow/run', (req: Request, res: Response) => {
  const { project, workflowId, impl, params } = req.body as {
    project: string;
    workflowId: string;
    impl?: string;
    params: {
      vars?: Record<string, string>;
      promptPaths?: string[];
      outputPath: string;
      /** 用户手动传入的工作流参数（key → 值，仅保留所选实现声明的 key） */
      userParams?: Record<string, unknown>;
      /** 视频自包含提交参数（wire 形态，画布【生成视频】节点提交） */
      video?: VideoWorkflowSubmitParams;
    };
  };

  if (!project || !workflowId || !params?.outputPath) {
    res.status(400).json({ error: 'Missing required fields: project, workflowId, params.outputPath' });
    return;
  }

  // 用户手动传入的参数：仅保留所选实现声明的 key，按类型规范化后合并进 vars
  const implDef = getImpl(workflowId, impl ?? 'default');
  const userVars = normalizeUserParams(implDef?.params, params.userParams);

  const taskId = uuidv4();
  db.createTask({
    id: taskId,
    project,
    workflow_id: workflowId,
    impl: impl ?? 'default',
    params: {
      vars: { ...(params.vars ?? {}), ...userVars },
      promptPaths: params.promptPaths ?? [],
      outputPath: params.outputPath,
      ...(params.video ? { video: params.video } : {}),
    },
  });

  db.addLog(taskId, 'info', `Task created: ${workflowId}/${impl ?? 'default'}`);

  res.json({ taskId, status: 'pending' });
});
```

3. `parseTaskParams` 扩展并导出：

```ts
export function parseTaskParams(paramsJson: string): {
  vars: Record<string, string>
  promptPaths: string[]
  outputPath: string
  video?: VideoWorkflowSubmitParams
  /** 提交成功后持久化的远端（Bridge）任务 ID，供中断使用 */
  remoteTaskId?: string
} {
  try {
    const parsed = JSON.parse(paramsJson) as {
      vars?: Record<string, string>
      promptPaths?: string[]
      outputPath?: string
      video?: VideoWorkflowSubmitParams
      remoteTaskId?: string
    };
    return {
      vars: parsed.vars ?? {},
      promptPaths: parsed.promptPaths ?? [],
      outputPath: parsed.outputPath ?? '',
      video: parsed.video,
      remoteTaskId: parsed.remoteTaskId,
    };
  } catch {
    return { vars: {}, promptPaths: [], outputPath: '' };
  }
}
```

4. `toTaskResponse` 的 params 已通过 `parseTaskParams` 返回 `video`/`remoteTaskId`，无需额外改动（其返回对象 `{ ..., params: parseTaskParams(task.params) }` 已包含）。

- [ ] **Step 4: db.ts 新增 updateTaskParams**

在 `server/src/db.ts` 的 `incrementRetry` 附近追加：

```ts
/** 更新任务 params（JSON），用于提交后持久化远端任务 ID 等运行时信息 */
export function updateTaskParams(id: string, params: object): void {
  db.prepare("UPDATE tasks SET params = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(params), id);
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd server && npx vitest run src/routes/workflow.test.ts && npx tsc --noEmit`
Expected: PASS + 无类型错误。

- [ ] **Step 6: 提交**

```bash
git add server/src/routes/workflow.ts server/src/db.ts server/src/routes/workflow.test.ts
git commit -m "feat: 视频自包含提交参数与远端任务 ID 持久化"
```

### Task 5: 引擎迁移（移除分镜读取，注入 ctx.video）

**Files:**
- Modify: `server/src/workflow-engine.ts`（删除 `enrichImageToVideoParams`/`SceneStageDefinition`/旧导演台注入块；`paramsObj` 解析增 `video`；新增 `resolveVideoSubmitData` 与视频数据组装；提交后持久化 `remoteTaskId`）

- [ ] **Step 1: 删除旧的分镜读取逻辑**

在 `server/src/workflow-engine.ts`：

1. 删除 `interface SceneStageDefinition` 定义（约第 60-70 行）。
2. 删除整个 `enrichImageToVideoParams` 函数（约第 78-215 行）及其上方的 JSDoc。
3. 删除 runTask 中这段：

```ts
  // image-to-video：引擎统一读取 overview.json / stage 图路径
  if (task.workflow_id === 'image-to-video') {
    const enriched = await enrichImageToVideoParams(task.project, paramsObj);
    paramsObj.vars = enriched.vars;
  }
```

4. 删除 runTask 中整个"导演台负载"注入块（`let director: DirectorPayload | undefined; if (... capabilities?.video?.modes?.includes('director')) { ... }`，含 `buildDirectorPayload` 调用与 `vars.duration = String(payload.duration)`）。
5. 删除 import：`import { buildDirectorPayload } from './workflows/director-inject.js';` 与 `import type { DirectorPayload, ... }` 中的 `DirectorPayload`。

- [ ] **Step 2: 扩展 paramsObj 解析**

将 runTask 开头的：

```ts
  const paramsObj = JSON.parse(task.params) as {
    vars?: Record<string, string>;
    promptPaths?: string[];
    outputPath?: string;
  };
```

改为：

```ts
  const paramsObj = JSON.parse(task.params) as {
    vars?: Record<string, string>;
    promptPaths?: string[];
    outputPath?: string;
    video?: VideoWorkflowSubmitParams;
  };
```

并在文件顶部 import 增加：

```ts
import type { VideoWorkflowSubmitData, VideoWorkflowSubmitParams } from './workflows/types.js';
import { buildSceneVideoSubmitData, type SceneAdapterDeps } from './workflows/scene-adapter.js';
import { submitComfyuiBridge, pollTask, buildDownloadRequest } from './workflows/bridge-client.js';
```

- [ ] **Step 3: 新增 resolveVideoSubmitData 辅助函数**

在 `loadProjectConfig` 之后追加：

```ts
/**
 * 将 wire 形态的视频提交参数（路径）解析为运行时形态（File）。
 * 画布节点提交的 params.video 走此转换，随后注入 ctx.video。
 *
 * @param project 项目名
 * @param wire wire 形态提交参数
 * @param readAssertFile 读取 assert/ 文件为 File 的回调
 * @returns 运行时形态视频提交数据
 */
async function resolveVideoSubmitData(
  project: string,
  wire: VideoWorkflowSubmitParams,
  readAssertFile: (relPath: string) => Promise<File>,
): Promise<VideoWorkflowSubmitData> {
  const director = wire.director
    ? {
        frames: await Promise.all(
          wire.director.frames.map(async (f) => ({ file: await readAssertFile(f.path), cursor: f.cursor })),
        ),
        ...(wire.director.audio ? { audio: await readAssertFile(wire.director.audio.path) } : {}),
      }
    : undefined;
  const references = wire.references
    ? await Promise.all(wire.references.map(async (r) => ({ type: r.type, file: await readAssertFile(r.path) })))
    : undefined;
  return {
    mode: wire.mode,
    resolution: wire.resolution,
    ...(wire.fps != null ? { fps: wire.fps } : {}),
    duration: wire.duration,
    prompt: wire.prompt,
    ...(wire.seed != null ? { seed: wire.seed } : {}),
    ...(director ? { director } : {}),
    ...(references ? { references } : {}),
    extraParams: wire.extraParams ?? {},
  };
}
```

- [ ] **Step 4: 组装视频数据并注入 runContext**

在 runTask 中、`readAssertFile` 定义之后、构建 `runContext` 之前，插入：

```ts
    // ── 视频自包含提交数据 ──
    // 画布节点任务：params.video（wire 形态）→ 解析为 File 形态；
    // 分镜/批量任务：由场景适配层读取分镜文件组装（工作流实现不再读分镜文件）。
    let video: VideoWorkflowSubmitData | undefined;
    if (task.workflow_id === 'image-to-video') {
      if (paramsObj.video) {
        video = await resolveVideoSubmitData(task.project, paramsObj.video, readAssertFile);
      } else {
        const episode = vars.episode?.trim();
        const shot = vars.shot?.trim();
        if (!episode || !shot) {
          throw new Error('image-to-video 需要 params.video 或 vars.episode/vars.shot');
        }
        const sceneDeps: SceneAdapterDeps = {
          readFile,
          readAssertFile,
          fileExists: async (rel: string) => {
            const full = path.resolve(DESIGN_DIR, task.project, rel);
            if (!full.startsWith(projectRoot)) throw new Error('Path traversal denied');
            try {
              await fs.access(full);
              return true;
            } catch {
              return false;
            }
          },
          mixAudioTracks: async (tracks, out) => {
            await mixAudioTracks(
              tracks.map((t) => ({ ...t, filePath: resolveProjectAssertPath(task.project, t.filePath) })),
              out,
            );
          },
          readTempAudio: async (p) => new Uint8Array(await fs.readFile(p)),
          removeTempAudio: async (p) => {
            try {
              await fs.unlink(p);
            } catch {
              /* 忽略清理失败 */
            }
          },
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
        };
        video = await buildSceneVideoSubmitData(
          task.project,
          episode,
          shot,
          capabilities?.video,
          projectConfig,
          sceneDeps,
        );
      }
    }
```

- [ ] **Step 5: runContext 注入 video + 持久化 remoteTaskId**

1. `runContext` 构建改为：

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

2. submit 之后持久化远端任务 ID：

```ts
    const { taskId: remoteTaskId } = await wf.submit(runContext);
    // 持久化远端任务 ID，供中断端点（/workflow/tasks/:id/cancel）使用
    const taskParams = JSON.parse(task.params) as Record<string, unknown>;
    db.updateTaskParams(taskId, { ...taskParams, remoteTaskId });
```

- [ ] **Step 6: 类型检查 + 全部后端测试**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: 无类型错误、全部通过（含既有 director-inject.test.ts）。

- [ ] **Step 7: 提交**

```bash
git add server/src/workflow-engine.ts
git commit -m "feat: 引擎注入视频自包含提交数据并持久化远端任务 ID"
```

### Task 6: ltx 实现重构（只消费 ctx.video）

**Files:**
- Modify: `server/src/workflows/image-to-video/default.ts`（删除 impl 内所有文件读取，只消费 `ctx.video`）

- [ ] **Step 1: 写失败测试**

新建 `server/src/workflows/image-to-video/default.test.ts`：

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const submitLtxDirectorImageToVideo = vi.fn(async () => ({ taskId: 'director-task' }));
const submitImageToVideo = vi.fn(async () => ({ taskId: 'frame-task' }));

vi.mock('../../bridge-client.js', () => ({
  submitLtxDirectorImageToVideo,
  submitImageToVideo,
  submitComfyuiBridge: vi.fn(),
  pollTask: vi.fn(),
  buildDownloadRequest: vi.fn(),
  createComfyuiBridgeWorkflow: (def: unknown) => def,
}));

import { getImpl } from '../registry.js';
import type { WorkflowRunContext } from '../types.js';

const mkContext = (video: unknown): WorkflowRunContext =>
  ({
    project: 'p',
    projectConfig: { width: 1080, height: 1920, fps: 24 },
    vars: {},
    video: video as never,
    readFile: async () => '',
    readAssertFile: async () => new File(['x'], 'x.png', { type: 'image/png' }),
  }) as WorkflowRunContext;

describe('image-to-video ltx impl', () => {
  beforeEach(() => {
    submitLtxDirectorImageToVideo.mockClear();
    submitImageToVideo.mockClear();
  });

  it('导演台模式调用 submitLtxDirectorImageToVideo', async () => {
    const impl = getImpl('image-to-video', 'ltx');
    expect(impl).toBeDefined();
    const file = new File(['f'], 'f.png', { type: 'image/png' });
    await impl!.submit(mkContext({
      mode: 'director',
      resolution: { width: 720, height: 1280 },
      fps: 30,
      duration: 5,
      prompt: '导演台',
      director: { frames: [{ file, cursor: 0 }], audio: file },
      extraParams: {},
    }));
    expect(submitLtxDirectorImageToVideo).toHaveBeenCalledTimes(1);
    const params = submitLtxDirectorImageToVideo.mock.calls[0][0];
    expect(params.duration).toBe(5);
    expect(params.frames).toHaveLength(1);
  });

  it('首尾帧模式调用 submitImageToVideo（frames 带 cursor 均匀分布）', async () => {
    const impl = getImpl('image-to-video', 'ltx');
    const f1 = new File(['a'], 'a.png', { type: 'image/png' });
    const f2 = new File(['b'], 'b.png', { type: 'image/png' });
    await impl!.submit(mkContext({
      mode: 'first-last-frame',
      resolution: { width: 1080, height: 1920 },
      duration: 4,
      prompt: '首尾帧',
      director: {
        frames: [
          { file: f1, cursor: 0 },
          { file: f2, cursor: 1 },
        ],
      },
      extraParams: {},
    }));
    expect(submitImageToVideo).toHaveBeenCalledTimes(1);
    const params = submitImageToVideo.mock.calls[0][0];
    expect(params.frames).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/workflows/image-to-video/default.test.ts`
Expected: FAIL——现有 impl 不消费 `ctx.video`（报错或调用与预期不符）。

- [ ] **Step 3: 重构 default.ts**

将 `server/src/workflows/image-to-video/default.ts` 整体替换为：

```ts
import { register } from '../registry.js';
import {
  createComfyuiBridgeWorkflow,
  submitImageToVideo,
  submitLtxDirectorImageToVideo,
} from '../bridge-client.js';
import type { ImageToVideoVars } from '../types.js';

/**
 * 图生视频实现（通过 ComfyUI Bridge，ltx）。
 *
 * 本实现只消费引擎注入的自包含提交数据（ctx.video），不再读取任何分镜文件：
 * - mode=director → submitLtxDirectorImageToVideo（ltx-2.3-director，关键帧 + 混音音频）
 * - mode=first-last-frame → submitImageToVideo（I2V / FL2V / FML2V，按帧数自动选择）
 *
 * 分镜/批量路径的数据读取由引擎的场景适配层（scene-adapter.ts）完成。
 */
register(
  createComfyuiBridgeWorkflow<ImageToVideoVars>({
    baseDefinition: {
      id: 'image-to-video',
      name: 'LTX-2.3',
      impl: 'ltx',
      description: '使用 FL2V / FML2V 模型基于参考帧图生成视频',
      capabilities: { video: { modes: ['director', 'first-last-frame'], audio: true, maxDuration: 15 }, cancelable: true },
    },

    async submit(ctx) {
      const video = ctx.video;
      if (!video) {
        throw new Error('image-to-video 需要引擎注入 ctx.video（自包含提交数据）');
      }

      const seed = video.seed != null ? Number(video.seed) : undefined;

      // ── 导演台模式 ──
      if (video.mode === 'director') {
        if (!video.director || video.director.frames.length < 1) {
          throw new Error('image-to-video 导演台模式需要 director.frames');
        }
        const result = await submitLtxDirectorImageToVideo({
          prompt: video.prompt,
          width: video.resolution.width,
          height: video.resolution.height,
          duration: video.duration,
          fps: video.fps ?? 24,
          seed,
          frames: video.director.frames.map((f) => ({ file: f.file, cursor: f.cursor })),
          ...(video.director.audio ? { audio: video.director.audio } : {}),
        });
        return { taskId: result.taskId };
      }

      // ── 首尾帧模式 ──
      if (video.mode === 'first-last-frame') {
        if (!video.director || video.director.frames.length < 1 || video.director.frames.length > 3) {
          throw new Error('image-to-video 首尾帧模式需要 1~3 帧参考图');
        }
        const result = await submitImageToVideo({
          prompt: video.prompt,
          width: video.resolution.width,
          height: video.resolution.height,
          duration: video.duration,
          fps: video.fps ?? 24,
          seed,
          frames: video.director.frames.map((f) => f.file),
          ...(video.director.audio ? { audio: video.director.audio } : {}),
        });
        return { taskId: result.taskId };
      }

      throw new Error(`image-to-video/ltx 不支持生成模式: ${video.mode}`);
    },
  }),
);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/workflows/image-to-video/default.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 类型检查 + 全部后端测试 + 提交**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: 无错误、全部通过。

```bash
git add server/src/workflows/image-to-video/default.ts server/src/workflows/image-to-video/default.test.ts
git commit -m "refactor: ltx 视频工作流只消费自包含提交数据"
```

### Task 7: submitReferenceVideo + minimax-h3-r2v 实现

**Files:**
- Modify: `server/src/workflows/bridge-client.ts`（新增 `submitReferenceVideo`）
- Create: `server/src/workflows/image-to-video/minimax-h3-r2v.ts`
- Test: `server/src/workflows/image-to-video/minimax.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `server/src/workflows/image-to-video/minimax.test.ts`：

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const submitComfyuiBridge = vi.fn(async () => ({ taskId: 'ref-task' }));

vi.mock('../../bridge-client.js', () => ({
  submitComfyuiBridge,
  createComfyuiBridgeWorkflow: (def: unknown) => def,
}));

import { getImpl } from '../registry.js';
import type { WorkflowRunContext } from '../types.js';

const mkContext = (video: unknown): WorkflowRunContext =>
  ({
    project: 'p',
    projectConfig: { width: 1080, height: 1920, fps: 24 },
    vars: {},
    video: video as never,
    readFile: async () => '',
    readAssertFile: async () => new File(['x'], 'x.png', { type: 'image/png' }),
  }) as WorkflowRunContext;

describe('minimax-h3-r2v 参考模式实现', () => {
  beforeEach(() => submitComfyuiBridge.mockClear());

  it('能力声明含 reference 模式与限制', () => {
    const impl = getImpl('image-to-video', 'minimax-h3-r2v');
    expect(impl).toBeDefined();
    expect(impl!.capabilities?.video?.modes).toEqual(['reference']);
    expect(impl!.capabilities?.video?.reference?.types.image?.max).toBe(9);
    expect(impl!.capabilities?.video?.reference?.maxTotal).toBe(12);
    expect(impl!.capabilities?.cancelable).toBe(true);
  });

  it('按类型序号独立映射动态文件键 image_n/video_n/audio_n', async () => {
    const impl = getImpl('image-to-video', 'minimax-h3-r2v')!;
    const mk = (n: string, type: string) => new File([n], n, { type });
    const video = {
      mode: 'reference',
      resolution: { width: 1080, height: 1920 },
      duration: 5,
      prompt: '参考模式',
      references: [
        { type: 'image', file: mk('i0', 'image/png') },
        { type: 'image', file: mk('i1', 'image/png') },
        { type: 'audio', file: mk('a0', 'audio/flac') },
        { type: 'video', file: mk('v0', 'video/mp4') },
        { type: 'image', file: mk('i2', 'image/png') },
      ],
      extraParams: {},
    };
    await impl.submit(mkContext(video));
    expect(submitComfyuiBridge).toHaveBeenCalledTimes(1);
    const { workflowId, params, files } = submitComfyuiBridge.mock.calls[0][0];
    expect(workflowId).toBe('minimax-h3-r2v');
    expect(params).toMatchObject({ prompt: '参考模式', width: 1080, height: 1920, duration: 5 });
    expect(Object.keys(files)).toEqual(['image_0', 'image_1', 'audio_0', 'video_0', 'image_2']);
    expect(files.image_0.name).toBe('i0');
    expect(files.audio_0.name).toBe('a0');
    expect(files.video_0.name).toBe('v0');
  });

  it('超过总上限抛错', async () => {
    const impl = getImpl('image-to-video', 'minimax-h3-r2v')!;
    const mk = () => new File(['x'], 'x.png', { type: 'image/png' });
    const references = Array.from({ length: 13 }, () => ({ type: 'image' as const, file: mk() }));
    await expect(impl.submit(mkContext({ mode: 'reference', resolution: { width: 1, height: 1 }, duration: 1, prompt: 'x', references, extraParams: {} }))).rejects.toThrow('参考素材总数量');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/workflows/image-to-video/minimax.test.ts`
Expected: FAIL——`getImpl('image-to-video', 'minimax-h3-r2v')` 为 undefined。

- [ ] **Step 3: bridge-client 新增 submitReferenceVideo**

在 `server/src/workflows/bridge-client.ts` 的导演模式封装之后追加：

```ts
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
 * 提交参考模式图生视频任务到 ComfyUI Bridge（如 minimax-h3-r2v 工作流）。
 *
 * - 动态文件键：`image_{n}` / `video_{n}` / `audio_{n}`，各类型序号从 0 开始独立递增；
 * - 走 multipart/form-data（方式 B），params 为 JSON 字符串；
 * - 参考素材的文件与数量由调用方（工作流实现）负责校验。
 *
 * @param params 参考模式图生视频提交参数
 * @returns Bridge 提交结果（含 taskId）
 */
export async function submitReferenceVideo(
  params: ReferenceVideoSubmitParams,
): Promise<BridgeSubmitResult> {
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

  return submitComfyuiBridge({
    workflowId: 'minimax-h3-r2v',
    params: body,
    files,
  });
}
```

- [ ] **Step 4: 新建 minimax-h3-r2v.ts**

新建 `server/src/workflows/image-to-video/minimax-h3-r2v.ts`：

```ts
import { register } from '../registry.js';
import { createComfyuiBridgeWorkflow, submitReferenceVideo } from '../bridge-client.js';
import type { ImageToVideoVars, VideoReferenceCapability } from '../types.js';

/** minimax-h3-r2v 参考模式限制 */
const REF_CAP: VideoReferenceCapability = {
  types: {
    image: { max: 9 },
    video: { max: 3, minDuration: 2, maxDuration: 15 },
    audio: { max: 3, minDuration: 2, maxDuration: 15 },
  },
  maxTotal: 12,
  audioRequiresVisual: true,
};

/**
 * 图生视频实现（ComfyUI Bridge，minimax-h3-r2v 参考模式）。
 *
 * 只消费引擎注入的自包含提交数据（ctx.video，mode=reference），
 * 将有序图片/视频/音频参考按类型序号映射为动态文件键提交。
 */
register(
  createComfyuiBridgeWorkflow<ImageToVideoVars>({
    baseDefinition: {
      id: 'image-to-video',
      name: 'MiniMax H2V',
      impl: 'minimax-h3-r2v',
      description: '参考模式：支持图片/视频/音频参考素材生成视频',
      capabilities: {
        video: { modes: ['reference'], maxDuration: 15, reference: REF_CAP },
        cancelable: true,
      },
    },

    async submit(ctx) {
      const video = ctx.video;
      if (!video) {
        throw new Error('image-to-video 需要引擎注入 ctx.video');
      }
      if (video.mode !== 'reference') {
        throw new Error(`minimax-h3-r2v 仅支持参考模式，当前: ${video.mode}`);
      }
      const refs = video.references ?? [];
      if (refs.length < 1) {
        throw new Error('minimax-h3-r2v 参考模式需要至少 1 个参考素材');
      }
      if (refs.length > REF_CAP.maxTotal) {
        throw new Error(`参考素材总数量超过上限（${REF_CAP.maxTotal}）`);
      }
      const imageRefs: File[] = [];
      const videoRefs: File[] = [];
      const audioRefs: File[] = [];
      for (const r of refs) {
        if (r.type === 'image') imageRefs.push(r.file);
        else if (r.type === 'video') videoRefs.push(r.file);
        else audioRefs.push(r.file);
      }
      if (imageRefs.length > (REF_CAP.types.image?.max ?? 0)) {
        throw new Error(`图片参考数量超过上限（${REF_CAP.types.image?.max}）`);
      }
      if (videoRefs.length > (REF_CAP.types.video?.max ?? 0)) {
        throw new Error(`视频参考数量超过上限（${REF_CAP.types.video?.max}）`);
      }
      if (audioRefs.length > (REF_CAP.types.audio?.max ?? 0)) {
        throw new Error(`音频参考数量超过上限（${REF_CAP.types.audio?.max}）`);
      }
      if (REF_CAP.audioRequiresVisual && audioRefs.length > 0 && imageRefs.length === 0 && videoRefs.length === 0) {
        throw new Error('音频参考必须与图片或视频参考一同输入，不能作为唯一输入');
      }

      const result = await submitReferenceVideo({
        prompt: video.prompt,
        width: video.resolution.width,
        height: video.resolution.height,
        duration: video.duration,
        seed: video.seed != null ? Number(video.seed) : undefined,
        imageRefs,
        videoRefs,
        audioRefs,
      });
      return { taskId: result.taskId };
    },
  }),
);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd server && npx vitest run src/workflows/image-to-video/minimax.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 6: 类型检查 + 全部后端测试 + 提交**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: 无错误、全部通过。

```bash
git add server/src/workflows/bridge-client.ts server/src/workflows/image-to-video/minimax-h3-r2v.ts server/src/workflows/image-to-video/minimax.test.ts
git commit -m "feat: 参考模式视频工作流（minimax-h3-r2v）与动态文件键提交"
```

### Task 8: 中断支持

**Files:**
- Modify: `server/src/workflows/bridge-client.ts`（新增 `cancelBridgeTask`）
- Modify: `server/src/routes/workflow.ts`（新增 `POST /workflow/tasks/:taskId/cancel`；导出 `canCancelTask`/`getRemoteTaskId`）
- Test: `server/src/routes/workflow.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `server/src/routes/workflow.test.ts` 追加：

```ts
import { describe, expect, it, vi } from 'vitest';
import { parseTaskParams, canCancelTask, getRemoteTaskId } from './workflow.js';
import type { TaskRecord } from '../db.js';

const mkTask = (overrides: Partial<TaskRecord> = {}): TaskRecord =>
  ({
    id: 't1',
    project: 'p',
    workflow_id: 'image-to-video',
    impl: 'ltx',
    status: 'running',
    params: JSON.stringify({ vars: {}, outputPath: 'assert/x.mp4', remoteTaskId: 'bridge-1' }),
    result: null,
    error_msg: null,
    retry_count: 0,
    max_retries: 2,
    created_at: '',
    updated_at: '',
    completed_at: null,
    batch_id: null,
    phase: 0,
    ...overrides,
  });

describe('中断支持', () => {
  it('getRemoteTaskId 从 params 解析远端任务 ID', () => {
    expect(getRemoteTaskId(mkTask())).toBe('bridge-1');
    expect(getRemoteTaskId(mkTask({ params: JSON.stringify({ vars: {} }) }))).toBeUndefined();
  });

  it('canCancelTask：running + cancelable → ok', () => {
    const result = canCancelTask(mkTask(), { capabilities: { cancelable: true } });
    expect(result.ok).toBe(true);
  });

  it('canCancelTask：已完成任务拒绝', () => {
    const result = canCancelTask(mkTask({ status: 'completed' }), { capabilities: { cancelable: true } });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('canCancelTask：实现未声明 cancelable 拒绝', () => {
    const result = canCancelTask(mkTask(), { capabilities: {} });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_cancelable');
  });

  it('canCancelTask：running 但无远端任务 ID 拒绝', () => {
    const result = canCancelTask(mkTask({ params: JSON.stringify({ vars: {} }) }), { capabilities: { cancelable: true } });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('no_remote_task');
  });

  it('canCancelTask：pending（本地排队）允许本地取消', () => {
    const result = canCancelTask(mkTask({ status: 'pending', params: JSON.stringify({ vars: {} }) }), { capabilities: { cancelable: true } });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/routes/workflow.test.ts`
Expected: FAIL——`canCancelTask`/`getRemoteTaskId` 未导出。

- [ ] **Step 3: bridge-client 新增 cancelBridgeTask**

在 `server/src/workflows/bridge-client.ts` 的 `pollTask` 之前追加：

```ts
export interface BridgeCancelResult {
  status: string;
}

/**
 * 中断 Bridge 任务。
 * POST /api/tasks/:taskId/cancel
 * - queued 任务：直接标记为失败（无需通知 ComfyUI）；
 * - pending 任务：向 ComfyUI 发送 /interrupt 后再标记为失败。
 *
 * @param taskId Bridge 远端任务 ID
 * @returns 取消结果（status 通常为 'failed'）
 */
export async function cancelBridgeTask(taskId: string): Promise<BridgeCancelResult> {
  const res = await fetch(`${BRIDGE_URL}/api/tasks/${taskId}/cancel`, {
    method: 'POST',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bridge cancel failed (${res.status}): ${text}`);
  }
  const data = await res.json() as { task_id: string; status: string };
  return { status: data.status };
}
```

- [ ] **Step 4: routes/workflow.ts 新增中断端点与辅助函数**

在 `server/src/routes/workflow.ts`：

1. import 增加：

```ts
import { cancelBridgeTask } from '../workflows/bridge-client.js';
import type { WorkflowCapabilities } from '../workflows/types.js';
import type { TaskRecord } from '../db.js';
```

2. 在 `toTaskResponse` 之后追加辅助函数：

```ts
/** 从任务 params 解析远端（Bridge）任务 ID */
export function getRemoteTaskId(task: TaskRecord): string | undefined {
  return parseTaskParams(task.params).remoteTaskId;
}

/**
 * 判断任务是否可中断，并返回拒绝原因。
 *
 * @param task 任务记录
 * @param wf 工作流实现（可为空）
 * @returns ok=true 可中断；否则携带 HTTP 状态码、错误码与消息
 */
export function canCancelTask(
  task: TaskRecord,
  wf: { capabilities?: WorkflowCapabilities } | undefined,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  if (!wf?.capabilities?.cancelable) {
    return { ok: false, status: 400, code: 'not_cancelable', message: '该工作流不支持中断' };
  }
  if (task.status === 'pending') {
    // 本地排队未提交远端 → 直接本地取消
    return { ok: true };
  }
  if (task.status !== 'running') {
    return { ok: false, status: 400, code: 'invalid_status', message: `任务状态不是 pending 或 running（当前 ${task.status}）` };
  }
  if (!getRemoteTaskId(task)) {
    return { ok: false, status: 400, code: 'no_remote_task', message: '任务尚未提交到远端，无法中断' };
  }
  return { ok: true };
}
```

3. 在 `POST /workflow/retry/:taskId` 之后追加端点：

```ts
// POST /api/workflow/tasks/:taskId/cancel — 中断任务（本地排队直接失败 / 运行中调 Bridge cancel）
workflowRouter.post('/workflow/tasks/:taskId/cancel', async (req: Request, res: Response) => {
  const task = db.getTask(req.params.taskId as string);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const wf = getImpl(task.workflow_id, task.impl);
  const decision = canCancelTask(task, wf);
  if (!decision.ok) {
    res.status(decision.status).json({ error: decision.code, message: decision.message });
    return;
  }

  try {
    if (task.status === 'running') {
      await cancelBridgeTask(getRemoteTaskId(task)!);
    }
    db.updateTaskStatus(task.id, 'failed', { error_msg: '用户中断' });
    db.addLog(task.id, 'info', 'Task cancelled by user');
    res.json({ taskId: task.id, status: 'failed' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: 'cancel_failed', message: msg });
  }
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd server && npx vitest run src/routes/workflow.test.ts && npx tsc --noEmit`
Expected: PASS + 无类型错误。

- [ ] **Step 6: 全部后端测试 + 提交**

Run: `cd server && npx vitest run`
Expected: 全部通过。

```bash
git add server/src/workflows/bridge-client.ts server/src/routes/workflow.ts server/src/routes/workflow.test.ts
git commit -m "feat: 工作流中断支持（Bridge cancel + 本地任务失败）"
```

---

## 阶段二：前端

### Task 9: 数据类型扩展 + audio-loader / video-loader

**Files:**
- Modify: `frontend/src/canvas/types.ts`（`DataType` 增 `'video' | 'audio'`）
- Modify: `frontend/src/canvas/registry.ts`（新增两个原型）
- Modify: `frontend/src/canvas/generate.ts`（`getNodeCurrentAssetPath` 支持新原型）
- Create: `frontend/src/components/canvas/nodes/AudioLoaderNode.vue`
- Create: `frontend/src/components/canvas/nodes/VideoLoaderNode.vue`
- Create: `frontend/src/components/canvas/editors/AudioLoaderEditor.vue`
- Create: `frontend/src/components/canvas/editors/VideoLoaderEditor.vue`
- Test: `frontend/src/canvas/registry.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `frontend/src/canvas/registry.test.ts` 末尾追加：

```ts
describe('音频/视频加载节点原型', () => {
  it('注册 audio-loader 与 video-loader', () => {
    const audio = getPrototype('audio-loader')
    const video = getPrototype('video-loader')
    expect(audio?.name).toBe('加载音频')
    expect(audio?.outputPorts[0]?.type).toBe('audio')
    expect(video?.name).toBe('加载视频')
    expect(video?.outputPorts[0]?.type).toBe('video')
  })
})
```

（若 `registry.test.ts` 不存在则新建，并把 `getPrototype` 加入 import。）

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/canvas/registry.test.ts`
Expected: FAIL——原型未注册。

- [ ] **Step 3: 扩展 DataType 与原型**

1. `frontend/src/canvas/types.ts`：

```ts
/** 数据流类型：连接是否允许由端口数据类型决定（ComfyUI 思路） */
export type DataType = 'image' | 'video' | 'audio' | 'text'
```

2. `frontend/src/canvas/registry.ts`：新增 import 与两个原型：

```ts
import AudioLoaderNode from '../components/canvas/nodes/AudioLoaderNode.vue'
import VideoLoaderNode from '../components/canvas/nodes/VideoLoaderNode.vue'
import AudioLoaderEditor from '../components/canvas/editors/AudioLoaderEditor.vue'
import VideoLoaderEditor from '../components/canvas/editors/VideoLoaderEditor.vue'
```

在 `NODE_PROTOTYPES` 数组（`image-loader` 之后）追加：

```ts
  {
    id: 'audio-loader',
    name: '加载音频',
    icon: 'mdi-music-note',
    inputPorts: [],
    outputPorts: [{ id: 'out', type: 'audio', label: '音频' }],
    resizeable: false,
    bodyComponent: AudioLoaderNode,
    editorComponent: AudioLoaderEditor,
  },
  {
    id: 'video-loader',
    name: '加载视频',
    icon: 'mdi-video-outline',
    inputPorts: [],
    outputPorts: [{ id: 'out', type: 'video', label: '视频' }],
    resizeable: false,
    bodyComponent: VideoLoaderNode,
    editorComponent: VideoLoaderEditor,
  },
```

3. `frontend/src/canvas/generate.ts` 的 `getNodeCurrentAssetPath` 追加分支：

```ts
  if (node.prototypeId === 'audio-loader' || node.prototypeId === 'video-loader') {
    const ap = node.config.assetPath
    return typeof ap === 'string' && ap ? ap : undefined
  }
```

- [ ] **Step 4: 新建节点组件**

新建 `frontend/src/components/canvas/nodes/AudioLoaderNode.vue`：

```vue
<template>
  <div class="audio-loader-node">
    <template v-if="assetUrl">
      <audio
        :src="assetUrl"
        controls
        class="audio-loader-node__audio"
      />
    </template>
    <template v-else>
      <div class="audio-loader-node__empty">
        <v-icon
          icon="mdi-music-note"
          size="large"
        />
        <div class="text-caption text-medium-emphasis">
          未选择音频
        </div>
        <div class="d-flex ga-1 mt-1">
          <v-btn
            size="x-small"
            variant="tonal"
            color="primary"
            @click.stop="openUpload"
          >
            上传音频
          </v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            @click.stop="openPicker"
          >
            选择资产
          </v-btn>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'
import { uploadFs } from '../../../api/client'

/** 加载音频节点 body：播放音频或提示未选择 */
const props = defineProps<{
  project: string
  node: CanvasNodeData
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'open-picker', nodeId: string): void
}>()

const assetUrl = ref('')
const assetPath = computed(() => (typeof props.node.config.assetPath === 'string' ? props.node.config.assetPath : ''))

watch(
  assetPath,
  (p) => {
    assetUrl.value = p ? buildPreviewUrl(props.project, p) : ''
  },
  { immediate: true },
)

/** 上传音频到自定义资产并写入 assetPath */
function openUpload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const dest = `assert/custom/canvas/${Date.now()}-${file.name}`
    const res = await uploadFs(props.project, dest, file)
    if (res.success) {
      emit('update:config', { assetPath: res.path })
    }
  }
  input.click()
}

function openPicker() {
  emit('open-picker', props.node.id)
}
</script>

<style scoped>
.audio-loader-node__audio {
  width: 100%;
  height: 48px;
}

.audio-loader-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
}
</style>
```

新建 `frontend/src/components/canvas/nodes/VideoLoaderNode.vue`（与 AudioLoaderNode 同构，`accept="video/*"`、`<video controls>`、图标 `mdi-video-outline`、文案"视频"）：

```vue
<template>
  <div class="video-loader-node">
    <template v-if="assetUrl">
      <video
        :src="assetUrl"
        controls
        class="video-loader-node__video"
      />
    </template>
    <template v-else>
      <div class="video-loader-node__empty">
        <v-icon
          icon="mdi-video-outline"
          size="large"
        />
        <div class="text-caption text-medium-emphasis">
          未选择视频
        </div>
        <div class="d-flex ga-1 mt-1">
          <v-btn
            size="x-small"
            variant="tonal"
            color="primary"
            @click.stop="openUpload"
          >
            上传视频
          </v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            @click.stop="openPicker"
          >
            选择资产
          </v-btn>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'
import { uploadFs } from '../../../api/client'

/** 加载视频节点 body：播放视频或提示未选择 */
const props = defineProps<{
  project: string
  node: CanvasNodeData
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'open-picker', nodeId: string): void
}>()

const assetUrl = ref('')
const assetPath = computed(() => (typeof props.node.config.assetPath === 'string' ? props.node.config.assetPath : ''))

watch(
  assetPath,
  (p) => {
    assetUrl.value = p ? buildPreviewUrl(props.project, p) : ''
  },
  { immediate: true },
)

function openUpload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'video/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const dest = `assert/custom/canvas/${Date.now()}-${file.name}`
    const res = await uploadFs(props.project, dest, file)
    if (res.success) {
      emit('update:config', { assetPath: res.path })
    }
  }
  input.click()
}

function openPicker() {
  emit('open-picker', props.node.id)
}
</script>

<style scoped>
.video-loader-node__video {
  width: 100%;
  max-height: 200px;
}

.video-loader-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
}
</style>
```

- [ ] **Step 5: 新建编辑器组件**

新建 `frontend/src/components/canvas/editors/AudioLoaderEditor.vue`：

```vue
<template>
  <div class="audio-loader-editor">
    <div class="text-caption text-medium-emphasis mb-1">
      当前音频
    </div>
    <div class="audio-loader-editor__preview mb-2">
      <audio
        v-if="assetUrl"
        :src="assetUrl"
        controls
        class="audio-loader-editor__audio"
      />
      <div
        v-else
        class="audio-loader-editor__empty"
      >
        <v-icon
          icon="mdi-music-note"
          size="large"
        />
        <span class="text-caption text-grey">
          未选择音频
        </span>
      </div>
    </div>

    <div class="d-flex align-center ga-2">
      <v-btn
        size="small"
        color="primary"
        variant="tonal"
        prepend-icon="mdi-upload"
        @click="openUpload"
      >
        上传音频
      </v-btn>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-folder-music"
        @click="openPicker"
      >
        选择资产
      </v-btn>
    </div>

    <div
      v-if="assetPath"
      class="text-caption text-grey mt-1 audio-loader-editor__path"
      :title="assetPath"
    >
      {{ assetPath }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'
import { uploadFs } from '../../../api/client'

/** 加载音频节点编辑器：上传音频 / 选择资产 */
const props = defineProps<{
  project: string
  node: CanvasNodeData
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'open-picker', nodeId: string): void
}>()

const assetUrl = ref('')
const assetPath = computed(() => (typeof props.node.config.assetPath === 'string' ? props.node.config.assetPath : ''))

watch(
  assetPath,
  (p) => {
    assetUrl.value = p ? buildPreviewUrl(props.project, p) : ''
  },
  { immediate: true },
)

function openUpload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const dest = `assert/custom/canvas/${Date.now()}-${file.name}`
    const res = await uploadFs(props.project, dest, file)
    if (res.success) {
      emit('update:config', { assetPath: res.path })
    }
  }
  input.click()
}

function openPicker() {
  emit('open-picker', props.node.id)
}
</script>

<style scoped>
.audio-loader-editor__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  border: 1px dashed rgba(0, 0, 0, 0.16);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.03);
}

.audio-loader-editor__audio {
  width: 100%;
  height: 44px;
}

.audio-loader-editor__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
}

.audio-loader-editor__path {
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
```

新建 `frontend/src/components/canvas/editors/VideoLoaderEditor.vue`（与 AudioLoaderEditor 同构：`accept="video/*"`、`<video controls>`、图标 `mdi-video-outline`、文案"视频"、按钮 `mdi-folder-video`）。关键差异点：

```vue
      <video
        v-if="assetUrl"
        :src="assetUrl"
        controls
        class="video-loader-editor__video"
      />
```
```css
.video-loader-editor__video {
  width: 100%;
  max-height: 180px;
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/canvas/registry.test.ts && npx vue-tsc --noEmit && npx eslint src/components/canvas src/canvas --ext .vue,.ts`
Expected: PASS + 无类型/ESLint 错误。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/canvas/types.ts frontend/src/canvas/registry.ts frontend/src/canvas/generate.ts frontend/src/components/canvas/nodes/AudioLoaderNode.vue frontend/src/components/canvas/nodes/VideoLoaderNode.vue frontend/src/components/canvas/editors/AudioLoaderEditor.vue frontend/src/components/canvas/editors/VideoLoaderEditor.vue frontend/src/canvas/registry.test.ts
git commit -m "feat: 画布新增音频/视频加载节点与数据类型"
```

### Task 10: 多端口支持

**Files:**
- Modify: `frontend/src/canvas/connection.ts`（`canConnectNodes` 增 `toPortId`；新增 `getNodeInputPortType`）
- Modify: `frontend/src/canvas/useCanvasStore.ts`（`connect` 增端口参数；新增 `onConnectionsChanged`/`emitConnectionsChanged`）
- Modify: `frontend/src/components/canvas/AssetCanvas.vue`（Handle v-for、`onConnect`/`isValidConnection` 传端口）
- Modify: `frontend/src/canvas/generate.ts`（`collectInputs`/`collectInputPaths` 增 `portId`）
- Test: `frontend/src/canvas/connection.test.ts`、`frontend/src/canvas/useCanvasStore.test.ts`、`frontend/src/canvas/generate.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `frontend/src/canvas/connection.test.ts` 追加：

```ts
import { canConnectNodes, getNodeInputPortType } from './connection'
import { NODE_PROTOTYPES } from './registry'

describe('多端口连接校验', () => {
  // 视频生成节点原型（images/videos/audios 三输入端口）
  const nodes = [
    { id: 'img', prototypeId: 'image-loader', name: 'img', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'aud', prototypeId: 'audio-loader', name: 'aud', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'vid', prototypeId: 'video-loader', name: 'vid', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'target', prototypeId: 'video-generate', name: 'target', x: 0, y: 0, width: 240, height: 160, config: {} },
  ]

  it('图片源可连接到 images 端口', () => {
    expect(canConnectNodes([], 'img', 'target', nodes, 'images')).toBe(true)
  })

  it('音频源可连接到 audios 端口', () => {
    expect(canConnectNodes([], 'aud', 'target', nodes, 'audios')).toBe(true)
  })

  it('图片源不能连接到 audios 端口（类型不符）', () => {
    expect(canConnectNodes([], 'img', 'target', nodes, 'audios')).toBe(false)
  })

  it('getNodeInputPortType 返回端口类型', () => {
    expect(getNodeInputPortType('target', 'images', nodes)).toBe('image')
    expect(getNodeInputPortType('target', 'videos', nodes)).toBe('video')
    expect(getNodeInputPortType('target', 'audios', nodes)).toBe('audio')
  })
})
```

> 说明：`video-generate` 原型会在 Task 11 注册；若 Task 10 先跑此测试失败，可把 `canConnectNodes` 的端口校验单测放到 Task 11 完成后统一跑。为保持 TDD 顺序，本任务先只改 `connection.ts` 支持 `toPortId` 参数（`getNodeInputPortType` 用输入端口 id 查找，不依赖 video-generate 是否存在），端口类型测试在 Task 11 注册原型后跑通。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/canvas/connection.test.ts`
Expected: FAIL——`canConnectNodes` 不支持 `toPortId` 参数。

- [ ] **Step 3: 修改 connection.ts**

`frontend/src/canvas/connection.ts`：

1. 新增：

```ts
/** 获取节点指定输入端口的类型 */
export function getNodeInputPortType(nodeId: string, portId: string, nodes: CanvasNodeData[]): DataType | undefined {
  const node = nodes.find((n) => n.id === nodeId)
  const proto = node ? getPrototype(node.prototypeId) : undefined
  return proto?.inputPorts.find((p) => p.id === portId)?.type
}
```

2. `canConnectNodes` 签名与实现改为：

```ts
/**
 * 校验一条连线是否可建立：两端节点存在、目标端口类型兼容、且不成环。
 *
 * @param connections 现有连线
 * @param fromNodeId 输出节点 id
 * @param toNodeId 输入节点 id
 * @param nodes 画布全部节点
 * @param toPortId 目标输入端口 id（缺省时用节点第一个输入端口）
 * @returns 可建立返回 true
 */
export function canConnectNodes(
  connections: CanvasConnection[],
  fromNodeId: string,
  toNodeId: string,
  nodes: CanvasNodeData[],
  toPortId?: string,
): boolean {
  const outType = getNodeOutputType(fromNodeId, nodes)
  if (!outType) return false
  if (toPortId) {
    const inType = getNodeInputPortType(toNodeId, toPortId, nodes)
    if (!inType || !canConnect(outType, inType)) return false
  } else {
    const inType = getNodeInputType(toNodeId, nodes)
    if (!inType || !canConnect(outType, inType)) return false
  }
  return !wouldCreateCycle(connections, fromNodeId, toNodeId)
}
```

- [ ] **Step 4: 修改 useCanvasStore.ts**

`frontend/src/canvas/useCanvasStore.ts`：

1. 顶部新增事件类型与订阅集合（放在 `const connections = computed(...)` 之后）：

```ts
  /** 连线变化事件：connect（建立）/ disconnect（断开） */
  type ConnectionsChangedEvent = { type: 'connect' | 'disconnect'; connection: CanvasConnection }
  const connectionListeners = new Set<(e: ConnectionsChangedEvent) => void>()

  /** 订阅连线变化事件，返回取消订阅函数 */
  function onConnectionsChanged(listener: (e: ConnectionsChangedEvent) => void): () => void {
    connectionListeners.add(listener)
    return () => { connectionListeners.delete(listener) }
  }

  /** 触发连线变化事件 */
  function emitConnectionsChanged(e: ConnectionsChangedEvent): void {
    for (const l of connectionListeners) l(e)
  }
```

2. `connect` 增加端口参数并触发事件：

```ts
  function connect(fromNodeId: string, toNodeId: string, fromPortId?: string, toPortId?: string): boolean {
    if (!canConnectNodes(data.value.connections, fromNodeId, toNodeId, data.value.nodes, toPortId)) {
      return false
    }
    const connection: CanvasConnection = {
      id: newId(),
      fromNodeId,
      fromPortId: fromPortId ?? getNodeOutputPortId(fromNodeId, data.value.nodes) ?? 'out',
      toNodeId,
      toPortId: toPortId ?? getNodeInputPortId(toNodeId, data.value.nodes) ?? 'in',
    }
    pushHistory()
    data.value.connections.push(connection)
    markDirty()
    emitConnectionsChanged({ type: 'connect', connection })
    return true
  }
```

3. `disconnect` 触发事件：

```ts
  function disconnect(connectionId: string): void {
    pushHistory()
    const removed = data.value.connections.find((c) => c.id === connectionId)
    data.value.connections = data.value.connections.filter((c) => c.id !== connectionId)
    markDirty()
    if (removed) {
      emitConnectionsChanged({ type: 'disconnect', connection: removed })
    }
  }
```

4. `removeNode` 也触发断开事件（先收集受影响的连线）：

```ts
  function removeNode(nodeId: string): void {
    pushHistory()
    const removed = data.value.connections.filter((c) => c.fromNodeId === nodeId || c.toNodeId === nodeId)
    data.value.nodes = data.value.nodes.filter((n) => n.id !== nodeId)
    data.value.connections = data.value.connections.filter((c) => c.fromNodeId !== nodeId && c.toNodeId !== nodeId)
    markDirty()
    for (const connection of removed) {
      emitConnectionsChanged({ type: 'disconnect', connection })
    }
  }
```

5. 返回值追加：`return { data, nodes, connections, loaded, dirty, saving, error, load, save, addNode, removeNode, updateNode, connect, disconnect, onConnectionsChanged, canUndo, canRedo, undo, redo, ... }`（在现有 return 中加入 `onConnectionsChanged`）。

- [ ] **Step 5: 修改 AssetCanvas.vue**

`frontend/src/components/canvas/AssetCanvas.vue`：

1. Handle 改为 v-for（节点模板内两个 Handle 块）：

```vue
              <template
                v-for="(port, idx) in (protoOf(id)?.inputPorts ?? [])"
                :key="port.id"
              >
                <Handle
                  :id="port.id"
                  type="target"
                  :position="Position.Left"
                  class="canvas-node__handle"
                  :style="handleStyle(protoOf(id)?.inputPorts.length ?? 1, idx)"
                />
              </template>
```

```vue
              <template
                v-for="(port, idx) in (protoOf(id)?.outputPorts ?? [])"
                :key="port.id"
              >
                <Handle
                  :id="port.id"
                  type="source"
                  :position="Position.Right"
                  class="canvas-node__handle"
                  :style="handleStyle(protoOf(id)?.outputPorts.length ?? 1, idx)"
                />
              </template>
```

2. script 新增 handle 定位辅助：

```ts
/** 多端口时按顺序垂直分布连接点；单端口保持默认 50% 位置 */
function handleStyle(count: number, index: number): Record<string, string> {
  if (count <= 1) return {}
  const top = ((index + 1) * 100) / (count + 1)
  return { top: `${top}%` }
}
```

3. 连接处理传端口：

```ts
function isValidConnection(conn: Connection): boolean {
  return canConnectNodes(
    store.connections.value,
    conn.source,
    conn.target,
    store.nodes.value,
    conn.targetHandle ?? undefined,
  )
}

function onConnect(conn: Connection) {
  store.connect(conn.source, conn.target, conn.sourceHandle ?? undefined, conn.targetHandle ?? undefined)
}
```

- [ ] **Step 6: 修改 generate.ts**

`frontend/src/canvas/generate.ts` 的 `collectInputs`/`collectInputPaths` 增加 `portId`：

```ts
export function collectInputs(
  nodeId: string,
  connections: CanvasConnection[],
  nodes: CanvasNodeData[],
  config?: NodeConfig,
  portId?: string,
): CanvasInputInfo[] {
  const order: string[] = Array.isArray(config?.inputOrder) ? (config.inputOrder as string[]) : []
  const list: CanvasInputInfo[] = []
  for (const c of connections) {
    if (c.toNodeId !== nodeId) continue
    if (portId && c.toPortId !== portId) continue
    const src = nodes.find((n) => n.id === c.fromNodeId)
    const p = getNodeCurrentAssetPath(src)
    if (!src || !p) continue
    list.push({ nodeId: src.id, path: p, label: p.split('/').pop() ?? p })
  }
  list.sort((a, b) => {
    const ia = order.indexOf(a.nodeId)
    const ib = order.indexOf(b.nodeId)
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
  })
  return list
}

export function collectInputPaths(
  nodeId: string,
  connections: CanvasConnection[],
  nodes: CanvasNodeData[],
  config?: NodeConfig,
  portId?: string,
): string[] {
  return collectInputs(nodeId, connections, nodes, config, portId).map((i) => i.path)
}
```

- [ ] **Step 7: 跑测试 + 类型检查 + ESLint**

Run: `cd frontend && npx vitest run src/canvas && npx vue-tsc --noEmit && npx eslint src/canvas src/components/canvas --ext .vue,.ts`
Expected: 既有测试全通过（多端口断言在 Task 11 注册原型后生效）；无类型/ESLint 错误。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/canvas/connection.ts frontend/src/canvas/useCanvasStore.ts frontend/src/components/canvas/AssetCanvas.vue frontend/src/canvas/generate.ts
git commit -m "feat: 画布多端口支持与连线变化事件机制"
```

### Task 11: video-generate 节点原型 + 配置 schema + 事件同步

**Files:**
- Create: `frontend/src/canvas/videoTypes.ts`
- Create: `frontend/src/canvas/connectionSync.ts`
- Create: `frontend/src/canvas/connectionSync.test.ts`
- Modify: `frontend/src/canvas/registry.ts`（`video-generate` 原型 + `defaultConfig` 支持）
- Modify: `frontend/src/canvas/types.ts`（`NodePrototype` 在 registry 中增 `defaultConfig`；实际在 registry.ts 中定义）
- Modify: `frontend/src/canvas/useCanvasStore.ts`（`addNode` 应用 `defaultConfig`；接线 `applyConnectionSync`）
- Create: `frontend/src/components/canvas/nodes/VideoGenerateNode.vue`（占位，Task 13 完善）
- Test: `frontend/src/canvas/connectionSync.test.ts`、`frontend/src/canvas/connection.test.ts`（多端口断言生效）

- [ ] **Step 1: 写失败测试（connectionSync）**

新建 `frontend/src/canvas/connectionSync.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { applyConnectionSync } from './connectionSync'
import { createCanvasData, type CanvasConnection, type CanvasData } from './types'

const imgConn: CanvasConnection = { id: 'c1', fromNodeId: 'img1', fromPortId: 'out', toNodeId: 'vg', toPortId: 'images' }
const audConn: CanvasConnection = { id: 'c2', fromNodeId: 'aud1', fromPortId: 'out', toNodeId: 'vg', toPortId: 'audios' }

function baseData(): CanvasData {
  const data = createCanvasData('scene')
  data.nodes = [
    { id: 'img1', prototypeId: 'image-loader', name: 'i', x: 0, y: 0, width: 200, height: 120, config: {} },
    { id: 'aud1', prototypeId: 'audio-loader', name: 'a', x: 0, y: 0, width: 200, height: 120, config: {} },
    {
      id: 'vg',
      prototypeId: 'video-generate',
      name: '生成视频',
      x: 0, y: 0, width: 240, height: 160,
      config: {
        mode: 'director',
        director: { duration: 10, width: 1080, height: 1920, fps: 24, imageClips: [], audioClips: [] },
      },
    },
  ]
  return data
}

describe('applyConnectionSync', () => {
  it('连接图片端口自动追加 imageClip（不重复）', () => {
    let data = baseData()
    data = applyConnectionSync(data, { type: 'connect', connection: imgConn })
    const d = data.nodes.find((n) => n.id === 'vg')!.config.director as { imageClips: Array<{ sourceNodeId: string; startOffset: number }> }
    expect(d.imageClips).toHaveLength(1)
    expect(d.imageClips[0].sourceNodeId).toBe('img1')
    // 幂等：再次连接不重复
    data = applyConnectionSync(data, { type: 'connect', connection: imgConn })
    expect((data.nodes.find((n) => n.id === 'vg')!.config.director as { imageClips: unknown[] }).imageClips).toHaveLength(1)
  })

  it('连接音频端口自动追加 audioClip', () => {
    let data = baseData()
    data = applyConnectionSync(data, { type: 'connect', connection: audConn })
    const d = data.nodes.find((n) => n.id === 'vg')!.config.director as { audioClips: Array<{ sourceNodeId: string }> }
    expect(d.audioClips).toHaveLength(1)
    expect(d.audioClips[0].sourceNodeId).toBe('aud1')
  })

  it('断开连线移除对应 clip，且保留用户已调位置的其他 clip', () => {
    let data = baseData()
    data = applyConnectionSync(data, { type: 'connect', connection: imgConn })
    data = applyConnectionSync(data, { type: 'connect', connection: audConn })
    // 用户拖动 audioClip 的 startOffset
    const vg = data.nodes.find((n) => n.id === 'vg')!
    const director = vg.config.director as { audioClips: Array<{ id: string; startOffset: number }> }
    director.audioClips[0].startOffset = 7.5
    data.nodes = data.nodes.map((n) => (n.id === 'vg' ? vg : n))

    data = applyConnectionSync(data, { type: 'disconnect', connection: audConn })
    const after = data.nodes.find((n) => n.id === 'vg')!.config.director as {
      imageClips: Array<{ sourceNodeId: string }>
      audioClips: unknown[]
    }
    expect(after.audioClips).toHaveLength(0)
    expect(after.imageClips).toHaveLength(1)
    expect(after.imageClips[0].sourceNodeId).toBe('img1')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/canvas/connectionSync.test.ts`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 新建 videoTypes.ts**

新建 `frontend/src/canvas/videoTypes.ts`：

```ts
/**
 * 【生成视频】节点的配置 schema 类型。
 * 与画布持久化（canvas.json）一一对应。
 */

/** 视频生成模式（与后端 VideoGenerateMode 对齐） */
export type VideoGenerateMode = 'director' | 'first-last-frame' | 'reference'

/** 导演台图片轨素材块（以 sourceNodeId 引用连线输入） */
export interface CanvasDirectorImageClip {
  /** 前端编辑状态唯一标识 */
  id: string
  /** 来源节点 id（连线输入） */
  sourceNodeId: string
  /** 起始偏移（秒） */
  startOffset: number
  /** 轨道占位时长（秒） */
  duration: number
}

/** 导演台音频轨素材块（以 sourceNodeId 引用连线输入） */
export interface CanvasDirectorAudioClip {
  id: string
  sourceNodeId: string
  startOffset: number
  trimStart: number
  trimEnd: number
  duration: number
}

/** 导演台配置（存于节点 config.director） */
export interface CanvasDirectorConfig {
  duration: number
  width: number
  height: number
  fps: number
  imageClips: CanvasDirectorImageClip[]
  audioClips: CanvasDirectorAudioClip[]
}

/** 参考模式输出规格（存于节点 config） */
export interface CanvasVideoSpec {
  /** 输出分辨率 */
  resolution?: { width: number; height: number }
  /** 帧率 */
  fps?: number
  /** 时长（秒） */
  duration?: number
}
```

- [ ] **Step 4: 新建 connectionSync.ts**

新建 `frontend/src/canvas/connectionSync.ts`：

```ts
import type { CanvasConnection, CanvasData } from './types'
import { newId } from './types'
import type { CanvasDirectorConfig, CanvasDirectorImageClip, CanvasDirectorAudioClip } from './videoTypes'

/** 自动追加图片块时的默认占位时长（秒） */
export const DEFAULT_IMAGE_CLIP_DURATION = 2

/** 连线变化事件 */
export interface ConnectionSyncEvent {
  type: 'connect' | 'disconnect'
  connection: CanvasConnection
}

/**
 * 画布节点级连接联动：连线建立/断开时按目标节点原型同步节点数据。
 *
 * 当前实现针对 video-generate 节点：
 * - connect → images：若 sourceNodeId 尚无 imageClip 则追加（startOffset 置于现有块末尾，duration=2s）；
 * - connect → audios：追加 audioClip；
 * - disconnect：删除 sourceNodeId 匹配的 clip。
 * 只增删、不重排——保留用户已拖好的滑块位置。
 *
 * @param data 画布数据
 * @param event 连线变化事件
 * @returns 更新后的画布数据（无变化时返回原引用）
 */
export function applyConnectionSync(data: CanvasData, event: ConnectionSyncEvent): CanvasData {
  const node = data.nodes.find((n) => n.id === event.connection.toNodeId)
  if (!node || node.prototypeId !== 'video-generate') return data

  const director = node.config.director
  if (!director || typeof director !== 'object') return data
  const d = director as Partial<CanvasDirectorConfig>

  if (event.type === 'disconnect') {
    const source = event.connection.fromNodeId
    const imageClips = (d.imageClips ?? []).filter((c) => c.sourceNodeId !== source)
    const audioClips = (d.audioClips ?? []).filter((c) => c.sourceNodeId !== source)
    if (imageClips.length === (d.imageClips?.length ?? 0) && audioClips.length === (d.audioClips?.length ?? 0)) {
      return data
    }
    return withDirector(data, node.id, { ...d, imageClips, audioClips })
  }

  // connect
  if (event.connection.toPortId === 'images') {
    const imageClips = d.imageClips ?? []
    if (imageClips.some((c) => c.sourceNodeId === event.connection.fromNodeId)) return data
    const maxStart = imageClips.reduce((m, c) => Math.max(m, c.startOffset + c.duration), 0)
    const total = typeof d.duration === 'number' && d.duration > 0 ? d.duration : maxStart + DEFAULT_IMAGE_CLIP_DURATION
    const clip: CanvasDirectorImageClip = {
      id: newId(),
      sourceNodeId: event.connection.fromNodeId,
      startOffset: Math.min(maxStart, Math.max(0, total - DEFAULT_IMAGE_CLIP_DURATION)),
      duration: DEFAULT_IMAGE_CLIP_DURATION,
    }
    return withDirector(data, node.id, { ...d, imageClips: [...imageClips, clip] })
  }

  if (event.connection.toPortId === 'audios') {
    const audioClips = d.audioClips ?? []
    if (audioClips.some((c) => c.sourceNodeId === event.connection.fromNodeId)) return data
    const maxStart = audioClips.reduce((m, c) => Math.max(m, c.startOffset + c.duration), 0)
    const clip: CanvasDirectorAudioClip = {
      id: newId(),
      sourceNodeId: event.connection.fromNodeId,
      startOffset: maxStart,
      trimStart: 0,
      trimEnd: 0,
      duration: 2,
    }
    return withDirector(data, node.id, { ...d, audioClips: [...audioClips, clip] })
  }

  return data
}

/** 以新 director 配置替换指定节点的 config.director（生成新节点数组） */
function withDirector(data: CanvasData, nodeId: string, director: Partial<CanvasDirectorConfig>): CanvasData {
  return {
    ...data,
    nodes: data.nodes.map((n) =>
      n.id === nodeId ? { ...n, config: { ...n.config, director } } : n,
    ),
  }
}
```

- [ ] **Step 5: registry.ts 注册 video-generate + defaultConfig 支持**

`frontend/src/canvas/registry.ts`：

1. `NodePrototype` 增加 `defaultConfig`：

```ts
  /** 创建节点时的默认配置（可选） */
  defaultConfig?: NodeConfig
```

2. 新增 import：

```ts
import VideoGenerateNode from '../components/canvas/nodes/VideoGenerateNode.vue'
import VideoGenerateEditor from '../components/canvas/editors/VideoGenerateEditor.vue'
```

3. 在 `NODE_PROTOTYPES` 数组末尾追加：

```ts
  {
    id: 'video-generate',
    name: '生成视频',
    icon: 'mdi-video-plus',
    inputPorts: [
      { id: 'images', type: 'image', label: '图片' },
      { id: 'videos', type: 'video', label: '视频' },
      { id: 'audios', type: 'audio', label: '音频' },
    ],
    outputPorts: [{ id: 'out', type: 'video', label: '视频' }],
    resizeable: true,
    bodyComponent: VideoGenerateNode,
    editorComponent: VideoGenerateEditor,
    defaultConfig: {
      workflowId: 'image-to-video',
      workflowImpl: undefined,
      workflowParams: {},
      mode: 'director',
      prompt: '',
      director: { duration: 0, width: 0, height: 0, fps: 0, imageClips: [], audioClips: [] },
      inputOrder: [],
    },
  },
```

- [ ] **Step 6: useCanvasStore.addNode 应用 defaultConfig + 接线同步**

`frontend/src/canvas/useCanvasStore.ts`：

1. `addNode` 的 config 初始化：

```ts
    const node: CanvasNodeData = {
      id: newId(),
      prototypeId,
      name: proto.name,
      x,
      y,
      width: 240,
      height: 160,
      config: proto.defaultConfig ? JSON.parse(JSON.stringify(proto.defaultConfig)) : {},
    }
```

2. import `applyConnectionSync`：

```ts
import { applyConnectionSync } from './connectionSync'
```

3. 在 `emitConnectionsChanged` 中接线（让事件机制驱动节点数据同步，先 pushHistory 再应用）：

```ts
  /** 触发连线变化事件 */
  function emitConnectionsChanged(e: ConnectionsChangedEvent): void {
    // 画布节点级联动：连线变化时同步目标节点数据（如 video-generate 的导演台轨道）
    // 不在此处 pushHistory：connect/disconnect 已在结构变更前快照，
    // 一次撤销即可同时回退「连线」与「轨道同步」两个变更。
    const synced = applyConnectionSync(data.value, e)
    if (synced !== data.value) {
      data.value = synced
      markDirty()
    }
    for (const l of connectionListeners) l(e)
  }
```

> 撤销语义：`connect` 在写入连线前 `pushHistory()`（快照不含连线与 clip），随后 `emitConnectionsChanged` 同步轨道（不再压快照）。撤销一次即回到"无连线、无 clip"的一致状态。

- [ ] **Step 7: 创建 VideoGenerateNode.vue 占位**

新建 `frontend/src/components/canvas/nodes/VideoGenerateNode.vue`：

```vue
<template>
  <div class="video-generate-node">
    <template v-if="videoUrl">
      <video
        :src="videoUrl"
        controls
        class="video-generate-node__video"
      />
    </template>
    <template v-else>
      <div class="video-generate-node__empty">
        <v-icon
          icon="mdi-video-plus"
          size="large"
        />
        <div class="text-caption text-medium-emphasis">
          未生成视频
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'

/** 生成视频节点 body：视频预览 + 未生成占位（状态角标由 AssetCanvas 统一渲染） */
const props = defineProps<{
  project: string
  node: CanvasNodeData
}>()

const videoUrl = ref('')
const current = computed(() => props.node.config.current as { path?: string } | undefined)

watch(
  current,
  (c) => {
    videoUrl.value = c?.path ? buildPreviewUrl(props.project, c.path) : ''
  },
  { immediate: true },
)
</script>

<style scoped>
.video-generate-node__video {
  width: 100%;
  max-height: 200px;
}

.video-generate-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
}
</style>
```

- [ ] **Step 8: 跑测试 + 类型检查**

Run: `cd frontend && npx vitest run src/canvas && npx vue-tsc --noEmit`
Expected: `connectionSync.test.ts` PASS；`connection.test.ts` 多端口断言 PASS（video-generate 已注册）；`VideoGenerateEditor.vue` 尚未创建会报 import 错误——**先创建空编辑器占位**：

新建 `frontend/src/components/canvas/editors/VideoGenerateEditor.vue`（占位，Task 13 完善）：

```vue
<template>
  <div class="video-generate-editor">
    <div class="text-caption text-medium-emphasis">
      生成视频节点配置（待完善）
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  project: string
  node: import('../../../canvas/types').CanvasNodeData
  inputs: import('../../../canvas/generate').CanvasInputInfo[]
  isRunning: boolean
  kind: import('../../../canvas/types').CanvasKind
}>()
</script>
```

Expected: `vue-tsc` 无错误。

- [ ] **Step 9: 提交**

```bash
git add frontend/src/canvas/videoTypes.ts frontend/src/canvas/connectionSync.ts frontend/src/canvas/connectionSync.test.ts frontend/src/canvas/registry.ts frontend/src/canvas/useCanvasStore.ts frontend/src/components/canvas/nodes/VideoGenerateNode.vue frontend/src/components/canvas/editors/VideoGenerateEditor.vue frontend/src/canvas/connection.test.ts
git commit -m "feat: 画布视频生成节点原型与连线轨道同步机制"
```

### Task 12: VideoDirector standalone 适配 + config↔DirectorProject 转换

**Files:**
- Modify: `frontend/src/components/video-director/VideoDirector.vue`（`standalone` prop 隐藏保存/生成按钮）
- Create: `frontend/src/canvas/videoDirectorBridge.ts`
- Test: `frontend/src/canvas/videoDirectorBridge.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/canvas/videoDirectorBridge.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { canvasDirectorToProject, projectToCanvasDirector } from './videoDirectorBridge'

const config = {
  duration: 10,
  width: 1080,
  height: 1920,
  fps: 24,
  imageClips: [
    { id: 'ic1', sourceNodeId: 'img1', startOffset: 0, duration: 2 },
    { id: 'ic2', sourceNodeId: 'img2', startOffset: 4, duration: 3 },
  ],
  audioClips: [
    { id: 'ac1', sourceNodeId: 'aud1', startOffset: 1, trimStart: 0.2, trimEnd: 0.3, duration: 5 },
  ],
}

describe('videoDirectorBridge', () => {
  it('config → DirectorProject：sourceNodeId 映射为资产路径', () => {
    const inputs = { img1: 'assert/x/a.png', img2: 'assert/x/b.png', aud1: 'assert/x/c.flac' }
    const project = canvasDirectorToProject(config, inputs)
    expect(project.imageClips[0].path).toBe('assert/x/a.png')
    expect(project.audioClips[0].path).toBe('assert/x/c.flac')
    expect(project.audioClips[0].trimStart).toBe(0.2)
    expect(project.duration).toBe(10)
  })

  it('DirectorProject → config：按 path 反查 sourceNodeId，保留 id 与滑块位置', () => {
    const inputs = { img1: 'assert/x/a.png', img2: 'assert/x/b.png', aud1: 'assert/x/c.flac' }
    const project = canvasDirectorToProject(config, inputs)
    // 用户拖动 imageClip[1] 的 startOffset
    project.imageClips[1].startOffset = 5.5
    const back = projectToCanvasDirector(project, {
      'assert/x/a.png': 'img1',
      'assert/x/b.png': 'img2',
      'assert/x/c.flac': 'aud1',
    })
    expect(back.imageClips[1].sourceNodeId).toBe('img2')
    expect(back.imageClips[1].startOffset).toBe(5.5)
    expect(back.imageClips[1].id).toBe('ic2')
    expect(back.audioClips[0].sourceNodeId).toBe('aud1')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/canvas/videoDirectorBridge.test.ts`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 新建 videoDirectorBridge.ts**

新建 `frontend/src/canvas/videoDirectorBridge.ts`：

```ts
import type { DirectorProject } from '../components/video-director/types'
import type { CanvasDirectorConfig } from './videoTypes'

/**
 * 画布导演台配置（sourceNodeId 引用）↔ VideoDirector 的 DirectorProject（path 引用）双向转换。
 *
 * 画布节点 config.director 以 sourceNodeId 引用连线输入；VideoDirector 组件以
 * 资产路径引用素材。转换在编辑器层完成：渲染前 inputs(sourceNodeId→path) 转成
 * DirectorProject，用户编辑回写时按 path 反查 sourceNodeId。
 */

/**
 * config.director → DirectorProject（供 VideoDirector 渲染）。
 *
 * @param config 画布导演台配置
 * @param inputs sourceNodeId → 资产相对路径
 * @returns DirectorProject（version=1，素材 path 由 inputs 解析，缺失时为空串）
 */
export function canvasDirectorToProject(
  config: CanvasDirectorConfig,
  inputs: Record<string, string>,
): DirectorProject {
  return {
    version: 1,
    duration: config.duration,
    width: config.width,
    height: config.height,
    fps: config.fps,
    imageClips: config.imageClips.map((c) => ({
      id: c.id,
      path: inputs[c.sourceNodeId] ?? '',
      startOffset: c.startOffset,
      duration: c.duration,
    })),
    audioClips: config.audioClips.map((c) => ({
      id: c.id,
      path: inputs[c.sourceNodeId] ?? '',
      startOffset: c.startOffset,
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
      duration: c.duration,
    })),
  }
}

/**
 * DirectorProject → config.director（用户编辑回写）。
 * 按 path 反查 sourceNodeId；path 不在映射中时以 path 兜底（保留数据不丢失）。
 *
 * @param project VideoDirector 编辑后的项目数据
 * @param pathToSource 资产路径 → sourceNodeId
 * @returns 画布导演台配置
 */
export function projectToCanvasDirector(
  project: DirectorProject,
  pathToSource: Record<string, string>,
): CanvasDirectorConfig {
  const resolveSource = (path: string): string => pathToSource[path] ?? path
  return {
    duration: project.duration,
    width: project.width,
    height: project.height,
    fps: project.fps,
    imageClips: project.imageClips.map((c) => ({
      id: c.id,
      sourceNodeId: resolveSource(c.path),
      startOffset: c.startOffset,
      duration: c.duration,
    })),
    audioClips: project.audioClips.map((c) => ({
      id: c.id,
      sourceNodeId: resolveSource(c.path),
      startOffset: c.startOffset,
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
      duration: c.duration,
    })),
  }
}
```

- [ ] **Step 4: VideoDirector 增加 standalone prop**

`frontend/src/components/video-director/VideoDirector.vue`：

1. props 增加：

```ts
  /** 独立模式（画布节点嵌入）：隐藏「保存/生成视频」按钮，数据实时写回外部 */
  standalone?: boolean
```

2. 保存按钮条件改为 `v-if="!readOnly && !standalone"`：

```vue
      <v-btn
        v-if="!readOnly && !standalone"
        color="primary"
        prepend-icon="mdi-content-save-check"
        size="small"
        :disabled="!dirty"
        @click="onSave"
      >
        保存
      </v-btn>
```

3. 生成按钮条件改为 `v-if="!standalone"`：

```vue
      <v-btn
        v-if="!standalone"
        color="success"
        prepend-icon="mdi-video-outline"
        size="small"
        @click="emit('generate', toProject())"
      >
        生成视频
      </v-btn>
```

- [ ] **Step 5: 跑测试 + 类型检查 + ESLint**

Run: `cd frontend && npx vitest run src/canvas/videoDirectorBridge.test.ts && npx vue-tsc --noEmit && npx eslint src/canvas src/components/video-director --ext .vue,.ts`
Expected: PASS + 无错误。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/canvas/videoDirectorBridge.ts frontend/src/canvas/videoDirectorBridge.test.ts frontend/src/components/video-director/VideoDirector.vue
git commit -m "feat: 视频导演台独立模式与画布配置双向转换"
```

### Task 13: VideoGenerateEditor 完整实现

**Files:**
- Modify: `frontend/src/components/canvas/editors/VideoGenerateEditor.vue`
- Create: `frontend/src/components/canvas/editors/VideoRefInputGroup.vue`（参考模式分组预览组件）

- [ ] **Step 1: 新建 VideoRefInputGroup.vue**

新建 `frontend/src/components/canvas/editors/VideoRefInputGroup.vue`（复用 ImageGenerateEditor 的拖拽排序模式，按组展示参考素材）：

```vue
<template>
  <div class="video-ref-group">
    <div class="text-caption text-medium-emphasis mb-1">
      {{ title }}（{{ inputs.length }}{{ max != null ? `/${max}` : '' }}）
    </div>
    <div
      v-if="inputs.length"
      ref="listEl"
      class="canvas-input-list mb-2"
      @dragover.prevent="onListDragOver"
      @drop.prevent="onDrop"
    >
      <v-tooltip
        v-for="(input, i) in inputs"
        :key="input.nodeId"
        location="top"
        open-delay="250"
      >
        <template #activator="{ props: tp }">
          <div
            class="canvas-input-item"
            :class="[
              draggingIndex === i ? 'canvas-input-item--dragging' : '',
              dropSide(i) === 'left' ? 'canvas-input-item--insert-left' : '',
              dropSide(i) === 'right' ? 'canvas-input-item--insert-right' : '',
            ]"
            v-bind="tp"
            draggable="true"
            @dragstart="onDragStart($event, i)"
            @dragend="onDragEnd"
          >
            <slot
              name="thumb"
              :input="input"
            />
            <span
              class="canvas-input-item__label"
              :title="input.label"
            >{{ labelOf(i) }}</span>
          </div>
        </template>
        <slot
          name="zoom"
          :input="input"
        />
      </v-tooltip>
    </div>
    <div
      v-else
      class="text-caption text-grey mb-2"
    >
      无{{ title }}输入
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { CanvasInputInfo } from '../../../canvas/generate'

/**
 * 参考模式输入分组：按类型展示参考素材并支持组内拖拽排序。
 * 排序结果通过 reorder 事件（新的 nodeId 顺序数组）上报。
 */
const props = defineProps<{
  /** 组标题（如"图片"） */
  title: string
  /** 该组输入（已按顺序排列） */
  inputs: CanvasInputInfo[]
  /** 该类型上限（无则不限） */
  max?: number
  /** 显示名前缀（如"图"） */
  prefix: string
}>()

const emit = defineEmits<{
  (e: 'reorder', nodeIds: string[]): void
}>()

const draggingIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)
const listEl = ref<HTMLElement | null>(null)

/** 显示名：前缀 + 组内序号（如 图1、图2） */
function labelOf(i: number): string {
  return `${props.prefix}${i + 1}`
}

function onDragStart(e: DragEvent, i: number) {
  draggingIndex.value = i
  dropIndex.value = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
  }
}

function onDragEnd() {
  draggingIndex.value = null
  dropIndex.value = null
}

function onListDragOver(e: DragEvent) {
  if (draggingIndex.value === null) return
  e.preventDefault()
  const items = Array.from(listEl.value?.querySelectorAll('.canvas-input-item') ?? [])
  let idx = items.length
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect()
    if (e.clientX < r.left + r.width / 2) {
      idx = i
      break
    }
  }
  dropIndex.value = idx
}

function dropSide(i: number): 'left' | 'right' | null {
  if (dropIndex.value === null) return null
  if (dropIndex.value === i) return 'left'
  if (dropIndex.value === i + 1) return 'right'
  return null
}

function onDrop() {
  const from = draggingIndex.value
  const to = dropIndex.value
  draggingIndex.value = null
  dropIndex.value = null
  if (from === null || to === null) return
  if (from === to || from === to - 1) return
  const arr = [...props.inputs]
  const [moved] = arr.splice(from, 1)
  const target = to > from ? to - 1 : to
  arr.splice(target, 0, moved)
  emit('reorder', arr.map((x) => x.nodeId))
}
</script>
```

> `.canvas-input-list` / `.canvas-input-item` 样式沿用 `ImageGenerateEditor.vue` 的 scoped 样式（在 VideoGenerateEditor 内提供全局或本组件内复制）。若直接复制，需要把 `ImageGenerateEditor.vue` 中对应 CSS（`.canvas-input-list`、`.canvas-input-item`、`.canvas-input-item__thumb`、`.canvas-input-item__label`、`.canvas-input-zoom` 及拖拽/插入高亮类）复制到本组件。

- [ ] **Step 2: 实现 VideoGenerateEditor.vue**

替换 `frontend/src/components/canvas/editors/VideoGenerateEditor.vue` 为完整实现：

```vue
<template>
  <div class="video-generate-editor">
    <!-- 工作流选择（仅视频类工作流） -->
    <v-select
      :model-value="workflowId"
      :items="workflowItems"
      item-title="label"
      item-value="id"
      label="工作流"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="onWorkflowChange"
    />

    <!-- 模式切换（所选实现声明多种模式时显示） -->
    <v-select
      v-if="currentModes.length > 1"
      :model-value="mode"
      :items="modeItems"
      item-title="label"
      item-value="value"
      label="生成模式"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="onModeChange"
    />

    <!-- 导演台 / 首尾帧模式：嵌入导演台 -->
    <template v-if="mode === 'director' || mode === 'first-last-frame'">
      <VideoDirector
        :project="props.project"
        :director="directorProject"
        :prompt="prompt"
        :read-only="false"
        :allow-add-asset="false"
        :standalone="true"
        @update:director="onDirectorUpdate"
        @update:prompt="onPromptUpdate"
      />
    </template>

    <!-- 参考模式：分组预览 + 提示词 + 规格 -->
    <template v-else>
      <VideoRefInputGroup
        title="图片"
        prefix="图"
        :inputs="imagesInputs"
        :max="refImageMax"
        @reorder="(ids) => emit('update:config', { inputOrder: mergeInputOrder('images', ids) })"
      >
        <template #thumb="{ input }">
          <img
            class="canvas-input-item__thumb"
            :src="previewUrls[input.nodeId]"
            :alt="input.label"
            draggable="false"
          >
        </template>
        <template #zoom="{ input }">
          <img
            class="canvas-input-zoom"
            :src="previewUrls[input.nodeId]"
            :alt="input.label"
          >
        </template>
      </VideoRefInputGroup>

      <VideoRefInputGroup
        title="视频"
        prefix="视"
        :inputs="videosInputs"
        :max="refVideoMax"
        @reorder="(ids) => emit('update:config', { inputOrder: mergeInputOrder('videos', ids) })"
      >
        <template #thumb="{ input }">
          <video
            class="canvas-input-item__thumb"
            :src="previewUrls[input.nodeId]"
            muted
            draggable="false"
          />
        </template>
        <template #zoom="{ input }">
          <video
            class="canvas-input-zoom"
            :src="previewUrls[input.nodeId]"
            controls
            muted
          />
        </template>
      </VideoRefInputGroup>

      <VideoRefInputGroup
        title="音频"
        prefix="音"
        :inputs="audiosInputs"
        :max="refAudioMax"
        @reorder="(ids) => emit('update:config', { inputOrder: mergeInputOrder('audios', ids) })"
      >
        <template #thumb="{ input }">
          <audio
            class="canvas-input-item__thumb"
            :src="previewUrls[input.nodeId]"
            controls
            draggable="false"
          />
        </template>
        <template #zoom="{ input }">
          <audio
            class="canvas-input-zoom"
            :src="previewUrls[input.nodeId]"
            controls
          />
        </template>
      </VideoRefInputGroup>

      <div
        v-if="refLimitHint"
        class="text-caption text-warning mb-2"
      >
        {{ refLimitHint }}
      </div>

      <!-- 参考模式输出规格 -->
      <div class="d-flex ga-2 mb-2">
        <v-text-field
          :model-value="String(specDuration)"
          label="时长(秒)"
          type="number"
          density="compact"
          variant="outlined"
          hide-details
          @update:model-value="(v) => emit('update:config', { duration: Number(v) || 0 })"
        />
        <v-text-field
          :model-value="String(specWidth)"
          label="宽"
          type="number"
          density="compact"
          variant="outlined"
          hide-details
          @update:model-value="(v) => emit('update:config', { resolution: { width: Number(v) || 0, height: specHeight } })"
        />
        <v-text-field
          :model-value="String(specHeight)"
          label="高"
          type="number"
          density="compact"
          variant="outlined"
          hide-details
          @update:model-value="(v) => emit('update:config', { resolution: { width: specWidth, height: Number(v) || 0 } })"
        />
      </div>
    </template>

    <!-- 提示词 -->
    <v-textarea
      :model-value="prompt"
      label="提示词 Prompt"
      rows="3"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="(v) => emit('update:config', { prompt: v })"
    />

    <!-- 生成 / 中断 / 历史 -->
    <div class="d-flex align-center ga-2">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
        :disabled="!canGenerate"
        @click="emit('generate', node.id)"
      >
        {{ node.config.current ? '重新生成' : '生成' }}
      </v-btn>
      <v-btn
        v-if="isRunning"
        size="small"
        variant="tonal"
        @click="emit('interrupt', node.id)"
      >
        中断
      </v-btn>
      <v-spacer />
      <v-btn
        v-if="node.config.current"
        size="small"
        variant="text"
        @click="emit('open-history', node.id)"
      >
        历史
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getWorkflows, type WorkflowInfo } from '../../../api/workflow'
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { buildPreviewUrl } from '../../../canvas/preview'
import { canvasDirectorToProject, projectToCanvasDirector } from '../../../canvas/videoDirectorBridge'
import type { CanvasDirectorConfig, VideoGenerateMode } from '../../../canvas/videoTypes'
import VideoDirector from '../../video-director/VideoDirector.vue'
import VideoRefInputGroup from './VideoRefInputGroup.vue'

const props = defineProps<{
  project: string
  node: CanvasNodeData
  /** 全部输入（预览 URL 构建用） */
  inputs: CanvasInputInfo[]
  /** 图片端口输入（已按 inputOrder 排序） */
  imagesInputs: CanvasInputInfo[]
  /** 视频端口输入 */
  videosInputs: CanvasInputInfo[]
  /** 音频端口输入 */
  audiosInputs: CanvasInputInfo[]
  isRunning: boolean
  kind: CanvasKind
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'open-history', nodeId: string): void
}>()

const workflows = ref<WorkflowInfo[]>([])

const workflowId = computed(() => {
  const explicit = props.node.config.workflowId
  return typeof explicit === 'string' && explicit ? explicit : 'image-to-video'
})
const prompt = computed(() => (typeof props.node.config.prompt === 'string' ? props.node.config.prompt : ''))
const mode = computed<VideoGenerateMode>(() => {
  const m = props.node.config.mode
  if (m === 'director' || m === 'first-last-frame' || m === 'reference') return m
  return 'director'
})
const directorConfig = computed<CanvasDirectorConfig>(() => {
  const d = props.node.config.director
  if (d && typeof d === 'object') return d as CanvasDirectorConfig
  return { duration: 0, width: 0, height: 0, fps: 0, imageClips: [], audioClips: [] }
})

const currentWorkflow = computed(() => workflows.value.find((w) => w.id === workflowId.value))
const currentImpl = computed(() => {
  const impl = (props.node.config.workflowImpl as string | undefined) || 'default'
  return currentWorkflow.value?.implementations.find((i) => i.impl === impl)
})
const currentModes = computed<VideoGenerateMode[]>(() => {
  const modes = currentImpl.value?.capabilities?.video?.modes
  if (Array.isArray(modes)) return modes as VideoGenerateMode[]
  return ['director']
})
const currentMaxDuration = computed(() => currentImpl.value?.capabilities?.video?.maxDuration ?? 15)
const refImageMax = computed(() => currentImpl.value?.capabilities?.video?.reference?.types.image?.max)
const refVideoMax = computed(() => currentImpl.value?.capabilities?.video?.reference?.types.video?.max)
const refAudioMax = computed(() => currentImpl.value?.capabilities?.video?.reference?.types.audio?.max)

const workflowItems = computed(() =>
  workflows.value
    .filter((w) => w.id === 'image-to-video')
    .map((w) => ({ id: w.id, label: w.name })),
)
const modeItems = computed(() =>
  currentModes.value.map((m) => ({
    value: m,
    label: m === 'director' ? '导演台' : m === 'first-last-frame' ? '首尾帧' : '参考',
  })),
)

/** 当前模式不在所选实现支持范围内时，回退到第一个支持的模式 */
watch(
  [currentModes, mode],
  ([modes, m]) => {
    if (modes.length > 0 && !modes.includes(m)) {
      emit('update:config', { mode: modes[0] })
    }
  },
)

function onWorkflowChange(v: string) {
  const wf = workflows.value.find((w) => w.id === v)
  const firstImpl = wf?.implementations[0]
  emit('update:config', {
    workflowId: v,
    workflowImpl: firstImpl?.impl,
    workflowParams: {},
  })
}

function onModeChange(v: VideoGenerateMode) {
  emit('update:config', { mode: v })
}

// ── 输入分组（由 AssetCanvas 按目标端口传入，此处直接消费） ─────────
const previewUrls = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.inputs) m[inp.nodeId] = buildPreviewUrl(props.project, inp.path)
  return m
})

const directorProject = computed(() =>
  canvasDirectorToProject(directorConfig.value, sourceToPath.value),
)
const sourceToPath = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.inputs) m[inp.nodeId] = inp.path
  return m
})
const pathToSource = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.inputs) m[inp.path] = inp.nodeId
  return m
})

/** 用户编辑导演台回写 config.director */
function onDirectorUpdate(project: ReturnType<typeof canvasDirectorToProject>) {
  emit('update:config', { director: projectToCanvasDirector(project, pathToSource.value) })
}

function onPromptUpdate(v: string) {
  emit('update:config', { prompt: v })
}

// ── 参考模式输入顺序（复用全局 inputOrder，按组过滤） ──
const inputOrder = computed<string[]>(() =>
  Array.isArray(props.node.config.inputOrder) ? (props.node.config.inputOrder as string[]) : [],
)

/** 组内重排后合并回全局 inputOrder：保持其他组相对顺序，仅调整本组顺序 */
function mergeInputOrder(port: 'images' | 'videos' | 'audios', orderedIds: string[]): string[] {
  const groupIds = new Set(orderedIds)
  const rest = inputOrder.value.filter((id) => !groupIds.has(id))
  return [...rest, ...orderedIds]
}

const specDuration = computed(() => Number(props.node.config.duration) || 5)
const specResolution = computed(() => {
  const r = props.node.config.resolution as { width?: number; height?: number } | undefined
  return { width: r?.width || 1280, height: r?.height || 720 }
})
const specWidth = computed(() => specResolution.value.width)
const specHeight = computed(() => specResolution.value.height)

/** 参考模式限制提示 */
const refLimitHint = computed(() => {
  if (mode.value !== 'reference') return ''
  const parts: string[] = []
  if (refImageMax != null && imagesInputs.value.length > refImageMax) {
    parts.push(`图片最多 ${refImageMax} 个`)
  }
  if (refVideoMax != null && videosInputs.value.length > refVideoMax) {
    parts.push(`视频最多 ${refVideoMax} 个`)
  }
  if (refAudioMax != null && audiosInputs.value.length > refAudioMax) {
    parts.push(`音频最多 ${refAudioMax} 个`)
  }
  return parts.join('；')
})

const canGenerate = computed(() => {
  if (mode.value === 'reference') {
    const total = imagesInputs.value.length + videosInputs.value.length + audiosInputs.value.length
    return total > 0 && !refLimitHint.value
  }
  return directorConfig.value.imageClips.length > 0
})

getWorkflows()
  .then((list) => { workflows.value = list })
  .catch(() => { workflows.value = [] })
</script>

<style scoped>
/* 参考素材缩略样式（复用 ImageGenerateEditor 的 .canvas-input-list/.canvas-input-item 布局） */
.canvas-input-list {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  padding: 4px;
  min-height: 58px;
  border: 1px dashed rgba(0, 0, 0, 0.16);
  border-radius: 6px;
}

.canvas-input-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 64px;
  cursor: grab;
  user-select: none;
}

.canvas-input-item__thumb {
  width: 64px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(0, 0, 0, 0.04);
}

.canvas-input-item__label {
  max-width: 64px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.canvas-input-item--dragging {
  opacity: 0.4;
}

.canvas-input-item--insert-left::before,
.canvas-input-item--insert-right::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgb(var(--v-theme-primary));
}

.canvas-input-item--insert-left::before {
  left: -5px;
}

.canvas-input-item--insert-right::before {
  right: -5px;
}

.canvas-input-zoom {
  max-width: 320px;
  max-height: 240px;
}
</style>
```

> **说明（视频导演台面板高度）**：导演台组件需要较大垂直空间（工具栏 + 预览 + 双轨时间轴 + prompt 文本域）。AssetCanvas 配置面板对生成节点宽度为 `EDITOR_PANEL_WIDTH_GENERATE=500`；导演台嵌入后需把该值加大（如 640）并允许面板纵向滚动（编辑器容器 `max-height` + `overflow:auto`）。在 Task 15 浏览器验证时确认布局，必要时调整 `AssetCanvas.vue` 的 `EDITOR_PANEL_WIDTH_GENERATE` 与面板样式。

> **说明**：`VideoGenerateEditor` 的 `imagesInputs`/`videosInputs`/`audiosInputs` 由 AssetCanvas 按目标端口（`videoInputsOf`，Task 14 Step 7）传入，编辑器不做内部分组。`inputs` 仅用于构建预览 URL。Task 14 Step 7 的 AssetCanvas 修改会为视频生成节点传入这三组 props。

- [ ] **Step 3: 类型检查 + ESLint**

Run: `cd frontend && npx vue-tsc --noEmit && npx eslint src/components/canvas --ext .vue,.ts`
Expected: 无错误（`imagesInputs`/`videosInputs`/`audiosInputs` 为 props 直接消费，无内部占位）。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/canvas/editors/VideoGenerateEditor.vue frontend/src/components/canvas/editors/VideoRefInputGroup.vue
git commit -m "feat: 视频生成节点配置组件（导演台嵌入 + 参考模式）"
```

### Task 14: 生成接线（videoSubmit + useCanvasGeneration + cancelWorkflow）

**Files:**
- Create: `frontend/src/canvas/videoSubmit.ts`
- Test: `frontend/src/canvas/videoSubmit.test.ts`
- Modify: `frontend/src/api/workflow.ts`（`WorkflowRunParams.params` 增 `video`；新增 `cancelWorkflow`；`WorkflowImplementation.capabilities` 增 `video`/`cancelable` 类型）
- Modify: `frontend/src/canvas/useCanvasGeneration.ts`（generate 增 video 分支；interrupt 调 cancel）
- Modify: `frontend/src/components/canvas/AssetCanvas.vue`（`generateNode` 组装 video 参数；`inputsOf` 端口分组）

- [ ] **Step 1: 写失败测试（videoSubmit）**

新建 `frontend/src/canvas/videoSubmit.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildVideoSubmitParams } from './videoSubmit'
import type { CanvasNodeData } from './types'
import type { CanvasInputInfo } from './generate'

const mkNode = (config: Record<string, unknown>): CanvasNodeData => ({
  id: 'vg',
  prototypeId: 'video-generate',
  name: '生成视频',
  x: 0, y: 0, width: 240, height: 160,
  config,
})

const mkInput = (nodeId: string, path: string): CanvasInputInfo => ({ nodeId, path, label: path })

describe('buildVideoSubmitParams', () => {
  it('导演台模式：imageClips 按 startOffset 生成 frames，含 audio', () => {
    const node = mkNode({
      mode: 'director',
      prompt: 'p',
      director: {
        duration: 10, width: 1080, height: 1920, fps: 24,
        imageClips: [
          { id: 'a', sourceNodeId: 'img1', startOffset: 4, duration: 2 },
          { id: 'b', sourceNodeId: 'img2', startOffset: 0, duration: 2 },
        ],
        audioClips: [{ id: 'c', sourceNodeId: 'aud1', startOffset: 0, trimStart: 0, trimEnd: 0, duration: 3 }],
      },
      workflowParams: { seed: '42' },
    })
    const inputs = {
      images: [mkInput('img1', 'assert/a.png'), mkInput('img2', 'assert/b.png')],
      videos: [],
      audios: [mkInput('aud1', 'assert/c.flac')],
    }
    const params = buildVideoSubmitParams(node, inputs)
    expect(params.mode).toBe('director')
    expect(params.duration).toBe(10)
    expect(params.resolution).toEqual({ width: 1080, height: 1920 })
    // frames 按 startOffset 升序：img2(0) 在前
    expect(params.director?.frames.map((f) => f.path)).toEqual(['assert/b.png', 'assert/a.png'])
    expect(params.director?.frames[0].cursor).toBe(0)
    expect(params.director?.frames[1].cursor).toBeCloseTo(0.4)
    expect(params.director?.audio?.path).toBe('assert/c.flac')
    expect(params.extraParams).toEqual({ seed: '42' })
  })

  it('首尾帧模式：cursor 自动均匀分布', () => {
    const node = mkNode({
      mode: 'first-last-frame',
      prompt: 'p',
      director: {
        duration: 6, width: 1080, height: 1920, fps: 24,
        imageClips: [
          { id: 'a', sourceNodeId: 'img1', startOffset: 0, duration: 2 },
          { id: 'b', sourceNodeId: 'img2', startOffset: 2, duration: 2 },
          { id: 'c', sourceNodeId: 'img3', startOffset: 4, duration: 2 },
        ],
        audioClips: [],
      },
      workflowParams: {},
    })
    const inputs = {
      images: [mkInput('img1', 'assert/1.png'), mkInput('img2', 'assert/2.png'), mkInput('img3', 'assert/3.png')],
      videos: [],
      audios: [],
    }
    const params = buildVideoSubmitParams(node, inputs)
    expect(params.mode).toBe('first-last-frame')
    const cursors = params.director?.frames.map((f) => f.cursor)
    expect(cursors).toEqual([0, 0.5, 1])
  })

  it('参考模式：按 inputOrder 过滤分组生成有序 references', () => {
    const node = mkNode({
      mode: 'reference',
      prompt: 'p',
      inputOrder: ['aud1', 'img2', 'img1', 'vid1'],
      duration: 5,
      resolution: { width: 720, height: 1280 },
      workflowParams: {},
    })
    const inputs = {
      images: [mkInput('img1', 'assert/1.png'), mkInput('img2', 'assert/2.png')],
      videos: [mkInput('vid1', 'assert/v.mp4')],
      audios: [mkInput('aud1', 'assert/a.flac')],
    }
    const params = buildVideoSubmitParams(node, inputs)
    expect(params.mode).toBe('reference')
    // 图片组顺序按 inputOrder 中 img2 在 img1 之前
    expect(params.references?.filter((r) => r.type === 'image').map((r) => r.path)).toEqual(['assert/2.png', 'assert/1.png'])
    expect(params.references?.filter((r) => r.type === 'video').map((r) => r.path)).toEqual(['assert/v.mp4'])
    expect(params.references?.filter((r) => r.type === 'audio').map((r) => r.path)).toEqual(['assert/a.flac'])
    expect(params.resolution).toEqual({ width: 720, height: 1280 })
    expect(params.duration).toBe(5)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/canvas/videoSubmit.test.ts`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 新建 videoSubmit.ts**

新建 `frontend/src/canvas/videoSubmit.ts`：

```ts
import type { CanvasNodeData } from './types'
import type { CanvasInputInfo } from './generate'
import type { CanvasDirectorConfig, VideoGenerateMode } from './videoTypes'

import type { VideoWorkflowSubmitParams } from '../api/workflow'

/** 提交参数类型复用 api/workflow.ts 的 VideoWorkflowSubmitParams（与后端 wire 形态一致） */
export type VideoSubmitParams = VideoWorkflowSubmitParams

/** 按端口分组的输入资产 */
export interface VideoNodeInputs {
  images: CanvasInputInfo[]
  videos: CanvasInputInfo[]
  audios: CanvasInputInfo[]
}

/** 首尾帧模式 cursor：首帧 0、尾帧 1、中间帧均匀分布 */
function frameCursor(index: number, total: number): number {
  if (total <= 1) return 0
  return index / (total - 1)
}

/**
 * 由节点配置 + 输入资产组装视频工作流提交参数（wire 形态）。
 * 画布【生成视频】节点提交前调用。
 *
 * @param node 视频生成节点
 * @param inputs 按端口分组的输入资产
 * @returns 视频提交参数
 */
export function buildVideoSubmitParams(node: CanvasNodeData, inputs: VideoNodeInputs): VideoSubmitParams {
  const config = node.config
  const mode = (config.mode === 'director' || config.mode === 'first-last-frame' || config.mode === 'reference')
    ? config.mode
    : 'director'
  const prompt = typeof config.prompt === 'string' ? config.prompt : ''
  const seedRaw = (config.workflowParams as Record<string, unknown> | undefined)?.seed
  const seed = typeof seedRaw === 'number' ? seedRaw : typeof seedRaw === 'string' && seedRaw !== '' ? Number(seedRaw) : undefined
  const extraParams = { ...((config.workflowParams as Record<string, unknown> | undefined) ?? {}) }
  delete extraParams.seed

  if (mode === 'reference') {
    const order: string[] = Array.isArray(config.inputOrder) ? (config.inputOrder as string[]) : []
    const sortByOrder = (list: CanvasInputInfo[]): CanvasInputInfo[] =>
      [...list].sort((a, b) => {
        const ia = order.indexOf(a.nodeId)
        const ib = order.indexOf(b.nodeId)
        return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
      })
    const refs = [
      ...sortByOrder(inputs.images).map((i) => ({ type: 'image' as const, path: i.path })),
      ...sortByOrder(inputs.videos).map((i) => ({ type: 'video' as const, path: i.path })),
      ...sortByOrder(inputs.audios).map((i) => ({ type: 'audio' as const, path: i.path })),
    ]
    const r = config.resolution as { width?: number; height?: number } | undefined
    const duration = Number(config.duration) || 5
    return {
      mode,
      resolution: { width: r?.width || 1280, height: r?.height || 720 },
      duration,
      prompt,
      ...(seed != null ? { seed } : {}),
      references: refs,
      extraParams,
    }
  }

  // director / first-last-frame
  const d = (config.director ?? {}) as Partial<CanvasDirectorConfig>
  const bySource = new Map(inputs.images.concat(inputs.videos).concat(inputs.audios).map((i) => [i.nodeId, i.path]))
  const imageClips = (d.imageClips ?? []).slice()
  const audioClips = d.audioClips ?? []

  let frames: Array<{ path: string; cursor: number }>
  if (mode === 'director') {
    frames = [...imageClips]
      .sort((a, b) => a.startOffset - b.startOffset)
      .map((c) => ({
        path: bySource.get(c.sourceNodeId) ?? '',
        cursor: d.duration && d.duration > 0 ? Math.min(Math.max(c.startOffset / d.duration, 0), 1) : 0,
      }))
      .filter((f) => f.path)
  } else {
    // first-last-frame：cursor 自动均匀分布
    frames = [...imageClips]
      .sort((a, b) => a.startOffset - b.startOffset)
      .map((c) => bySource.get(c.sourceNodeId) ?? '')
      .filter(Boolean)
      .map((path, i, arr) => ({ path, cursor: frameCursor(i, arr.length) }))
  }

  const audioPath = audioClips.length > 0 ? bySource.get(audioClips[0].sourceNodeId) : undefined

  return {
    mode,
    resolution: { width: d.width || 1280, height: d.height || 720 },
    ...(d.fps ? { fps: d.fps } : {}),
    duration: d.duration || 5,
    prompt,
    ...(seed != null ? { seed } : {}),
    director: {
      frames,
      ...(audioPath ? { audio: { path: audioPath } } : {}),
    },
    extraParams,
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/canvas/videoSubmit.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 扩展 api/workflow.ts**

`frontend/src/api/workflow.ts`：

1. capabilities 类型扩展：

```ts
  capabilities?: {
    director?: boolean
    audio?: boolean
    cancelable?: boolean
    video?: {
      modes?: Array<'director' | 'first-last-frame' | 'reference'>
      audio?: boolean
      maxDuration?: number
      reference?: {
        types?: {
          image?: { max?: number }
          video?: { max?: number; minDuration?: number; maxDuration?: number }
          audio?: { max?: number; minDuration?: number; maxDuration?: number }
        }
        maxTotal?: number
        audioRequiresVisual?: boolean
      }
    }
  }
```

2. `WorkflowRunParams.params` 增加 `video`：

```ts
export interface VideoWorkflowSubmitParams {
  mode: 'director' | 'first-last-frame' | 'reference'
  resolution: { width: number; height: number }
  fps?: number
  duration: number
  prompt: string
  seed?: number
  director?: { frames: Array<{ path: string; cursor: number }>; audio?: { path: string } }
  references?: Array<{ type: 'image' | 'video' | 'audio'; path: string }>
  extraParams: Record<string, unknown>
}
```

```ts
  params: {
    vars: Record<string, string>
    promptPaths?: string[]
    outputPath: string
    userParams?: Record<string, WorkflowUserParamValue>
    /** 视频自包含提交参数（画布【生成视频】节点提交） */
    video?: VideoWorkflowSubmitParams
  }
```

3. 新增 `cancelWorkflow`：

```ts
export interface CancelWorkflowResult {
  taskId: string
  status: string
}

/** 中断工作流任务 */
export async function cancelWorkflow(taskId: string): Promise<CancelWorkflowResult> {
  const { data } = await client.post<CancelWorkflowResult>(`/workflow/tasks/${taskId}/cancel`)
  return data
}
```

- [ ] **Step 6: 修改 useCanvasGeneration.ts**

`frontend/src/canvas/useCanvasGeneration.ts`：

1. import 增加：

```ts
import { runWorkflow, getTaskStatus, getTaskLogs, cancelWorkflow, type WorkflowUserParamValue } from '../api/workflow'
import type { VideoSubmitParams } from './videoSubmit'
```

2. `generate` 增加第三个可选参数 `videoParams`：

```ts
  async function generate(
    node: CanvasNodeData,
    updateConfig: (config: Record<string, unknown>) => void,
    videoParams?: VideoSubmitParams,
  ): Promise<void> {
```

3. 在函数体开头（`const nodeId = node.id` 之后）增加 video 分支：

```ts
    // ── 视频生成节点：走自包含提交参数 ──
    if (node.prototypeId === 'video-generate') {
      if (!videoParams) {
        statusByNode.value[nodeId] = { status: 'error', errorMsg: '缺少视频提交参数' }
        return
      }
      statusByNode.value[nodeId] = { status: 'running' }
      try {
        const outputPath = computeOutputPath(node)
        const { taskId } = await runWorkflow({
          project,
          workflowId: 'image-to-video',
          impl: String(node.config.workflowImpl ?? 'default'),
          params: {
            vars: {},
            outputPath,
            userParams: (node.config.workflowParams as Record<string, WorkflowUserParamValue> | undefined) ?? {},
            video: videoParams,
          },
        })
        taskIdByNode.value[nodeId] = taskId
        poll(taskId, node, outputPath, updateConfig)
      } catch (e) {
        statusByNode.value[nodeId] = {
          status: 'error',
          errorMsg: e instanceof Error ? e.message : String(e),
        }
      }
      return
    }
```

4. `interrupt` 改为调用 cancel：

```ts
  /** 中断生成：调用后端 cancel 端点 + 停轮询 + 状态置已中断 */
  async function interrupt(nodeId: string): Promise<void> {
    const taskId = taskIdByNode.value[nodeId]
    if (!taskId) return
    if (pollTimers[nodeId]) {
      clearInterval(pollTimers[nodeId])
      delete pollTimers[nodeId]
    }
    statusByNode.value[nodeId] = { status: 'error', errorMsg: '已中断', taskId }
    try {
      await cancelWorkflow(taskId)
    } catch {
      // cancel 失败不阻断状态展示（后端任务可能已结束）
    }
  }
```

5. `computeOutputPath` 视频产物扩展名：`canvasNodeAssetPath` 返回 `.jpg`；为视频节点生成 `.mp4`。在 `computeOutputPath` 中：

```ts
  function computeOutputPath(node: CanvasNodeData): string {
    const version = nextVersion(getHistory(node.config))
    const scope =
      targetRef.value.kind === 'stage'
        ? {
            kind: 'stage' as const,
            primary: targetRef.value.stage ?? '',
            label: targetRef.value.label,
          }
        : { kind: 'scene' as const, primary: targetRef.value.episode ?? '', secondary: targetRef.value.shot }
    const base = canvasNodeAssetPath(scope, node.id, version)
    if (node.prototypeId === 'video-generate') {
      return base.replace(/\.jpg$/, '.mp4')
    }
    return base
  }
```

- [ ] **Step 7: 修改 AssetCanvas.vue 接线**

`frontend/src/components/canvas/AssetCanvas.vue`：

1. import 增加：

```ts
import { buildVideoSubmitParams, type VideoNodeInputs } from '../../canvas/videoSubmit'
import { getNodeInputPortType } from '../../canvas/connection'
```

2. `inputsOf` 增加按端口分组版本：

```ts
/** 视频生成节点按端口分组的输入资产 */
function videoInputsOf(nodeId: string): VideoNodeInputs {
  const node = nodeMap.value[nodeId]
  const nodes = store.nodes.value
  const conns = store.connections.value
  const images: CanvasInputInfo[] = []
  const videos: CanvasInputInfo[] = []
  const audios: CanvasInputInfo[] = []
  for (const c of conns) {
    if (c.toNodeId !== nodeId) continue
    const src = nodes.find((n) => n.id === c.fromNodeId)
    const p = getNodeCurrentAssetPath(src)
    if (!src || !p) continue
    const item: CanvasInputInfo = { nodeId: src.id, path: p, label: p.split('/').pop() ?? p }
    const portType = getNodeInputPortType(nodeId, c.toPortId, nodes)
    if (portType === 'image') images.push(item)
    else if (portType === 'video') videos.push(item)
    else if (portType === 'audio') audios.push(item)
  }
  const order: string[] = Array.isArray(node?.config.inputOrder) ? (node.config.inputOrder as string[]) : []
  const sortByOrder = (list: CanvasInputInfo[]): CanvasInputInfo[] =>
    [...list].sort((a, b) => {
      const ia = order.indexOf(a.nodeId)
      const ib = order.indexOf(b.nodeId)
      return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
    })
  return { images: sortByOrder(images), videos: sortByOrder(videos), audios: sortByOrder(audios) }
}
```

3. `generateNode` 增加 video 分支：

```ts
async function generateNode(nodeId: string) {
  const node = nodeMap.value[nodeId]
  if (!node) return
  gen.clearStatus(nodeId)
  if (node.prototypeId === 'video-generate') {
    const videoParams = buildVideoSubmitParams(node, videoInputsOf(nodeId))
    await gen.generate(node, (config) => {
      store.updateNode(nodeId, { config })
    }, videoParams)
    return
  }
  if (node.prototypeId !== 'image-generate') return
  const paths = collectInputPaths(nodeId, store.connections.value, store.nodes.value, node.config)
  gen.setInputPaths(nodeId, paths)
  await gen.generate(node, (config) => {
    store.updateNode(nodeId, { config })
  })
}
```

4. 编辑器传分组输入：在配置面板的编辑器渲染分支中，为 `video-generate` 节点额外传入三组 props：

```vue
      <component
        :is="protoOf(id)?.editorComponent"
        :project="props.project"
        :node="nodeMap[id]"
        :inputs="inputsOf(id)"
        :images-inputs="videoInputsOf(id).images"
        :videos-inputs="videoInputsOf(id).videos"
        :audios-inputs="videoInputsOf(id).audios"
        :is-running="isNodeRunning(id)"
        :kind="target.kind"
        @update:config="(patch: Record<string, unknown>) => onUpdateConfig(id, patch)"
        @generate="(nid: string) => generateNode(nid)"
        @interrupt="(nid: string) => onInterrupt(nid)"
        @open-history="openHistory"
      />
```

> `openHistory` 为 AssetCanvas 既有打开历史对话框的处理函数（视频节点复用同一历史对话框，产物为 .mp4）。

- [ ] **Step 8: 跑测试 + 类型检查 + ESLint**

Run: `cd frontend && npx vitest run src/canvas && npx vue-tsc --noEmit && npx eslint src/canvas src/api src/components/canvas --ext .vue,.ts`
Expected: 全部通过、无错误。

- [ ] **Step 9: 提交**

```bash
git add frontend/src/canvas/videoSubmit.ts frontend/src/canvas/videoSubmit.test.ts frontend/src/api/workflow.ts frontend/src/canvas/useCanvasGeneration.ts frontend/src/components/canvas/AssetCanvas.vue
git commit -m "feat: 视频生成节点提交接线与工作流中断 API"
```

### Task 15: 全链路验证与收尾

**Files:**
- 按需修改：`frontend/src/components/canvas/AssetCanvas.vue`（面板宽度/滚动、`inputsOfPort` 落地）
- 按需修改：`frontend/src/components/canvas/editors/VideoGenerateEditor.vue`（参考模式分组输入接线）
- 浏览器验证（vitest browser mode + playwright）

- [ ] **Step 1: 分组接线核对**

分组已在 Task 13（编辑器接收 `imagesInputs`/`videosInputs`/`audiosInputs` 三组 props）与 Task 14（AssetCanvas `videoInputsOf` 按目标端口分组并传入）完成。此处核对：

1. `VideoGenerateEditor` 的模板引用 `imagesInputs`/`videosInputs`/`audiosInputs`（三组 props）且无残留 `inputPortOf` 占位。
2. AssetCanvas 配置面板对 `video-generate` 编辑器传入了三组 props 与 `inputs`（全量，用于预览 URL）。
3. `git grep inputPortOf` 无结果；`git grep VideoSubmitParams` 仅出现在 `videoSubmit.ts`（类型别名复用 `api/workflow.ts` 的 `VideoWorkflowSubmitParams`）。

- [ ] **Step 2: 面板布局验证与调整**

启动前后端，在浏览器中验证：

1. 打开一个分镜画布，添加 `video-generate` 节点 → 连接 `image-loader`（images 端口）与 `audio-loader`（audios 端口）。
2. 选中节点 → 配置面板出现导演台（standalone：无"保存/生成视频"按钮、无"添加图片/音频"按钮）。
3. 图片/音频连线自动进入导演台轨道；断开连线后对应素材块自动移除。
4. 拖动素材块调整位置 → 保存画布 → 刷新 → 滑块位置恢复（config.director 持久化）。
5. 工作流切换为 minimax-h3-r2v → 模式自动切为"参考"；三组输入预览 + 排序 + 上限提示。
6. 生成按钮在无输入/超限时禁用；点生成 → `POST /workflow/run` 载荷含 `params.video`（mock 或观察请求，禁止真实提交）。
7. 运行中点"中断" → `POST /workflow/tasks/:id/cancel` 被调用。

若导演台在 500px 面板内过窄/过高，调整 `AssetCanvas.vue` 的 `EDITOR_PANEL_WIDTH_GENERATE`（建议 640）与面板容器 `max-height` + `overflow-y:auto`。

- [ ] **Step 3: 浏览器自动化验证（vitest browser mode）**

在 `frontend/src/components/canvas/AssetCanvas.browser.test.ts` 中（vitest browser + playwright，mock `api/workflow.ts` 避免真实提交）：

```ts
import { describe, expect, it } from 'vitest'
import { page } from '@vitest/browser/context'
import { mount } from '@vue/test-utils'

// 使用 mock 的 api/workflow 避免真实提交
vi.mock('../../api/workflow', () => ({
  getWorkflows: async () => [{
    id: 'image-to-video',
    name: 'LTX-2.3',
    implementations: [
      { impl: 'ltx', name: 'LTX-2.3', capabilities: { video: { modes: ['director', 'first-last-frame'], audio: true, maxDuration: 15 }, cancelable: true } },
      { impl: 'minimax-h3-r2v', name: 'MiniMax H2V', capabilities: { video: { modes: ['reference'], maxDuration: 15, reference: { types: { image: { max: 9 }, video: { max: 3 }, audio: { max: 3 } }, maxTotal: 12 } }, cancelable: true } },
    ],
  }],
  runWorkflow: async () => ({ taskId: 'mock-task', status: 'pending' }),
  cancelWorkflow: async () => ({ taskId: 'mock-task', status: 'failed' }),
  getTaskStatus: async () => ({ taskId: 'mock-task', status: 'failed' }),
  getTaskLogs: async () => [],
}))

describe('资产画布视频生成节点（浏览器）', () => {
  it('配置面板渲染导演台且无保存/生成视频按钮', async () => {
    // 挂载 AssetCanvas（或最小宿主），添加 video-generate 节点并选中
    // 断言：配置面板内出现 VideoDirector 的时间轴；不存在文案为「保存」「生成视频」的按钮
    // （用 playwright 查询 getComputedStyle 或 accessibility snapshot 均可）
  })

  it('连线自动进轨道、断开自动移除', async () => {
    // 建立 image-loader → video-generate 连线后，断言 config.director.imageClips 长度 +1
    // 断开后断言归零
  })

  it('参考模式上限提示', async () => {
    // 切换到 minimax-h3-r2v 后，为 images 端口连接 10 个 image-loader
    // 断言出现「图片最多 9 个」提示且生成按钮禁用
  })
})
```

> 浏览器测试需遵循仓库既有浏览器验证约定（`@vitest/browser-playwright`）；若仓库尚未建立浏览器测试骨架，可在本次建立最小骨架（`frontend/vitest.config.ts` 增 browser 配置 + 一个 smoke 用例），并确保**不触发真实工作流提交**（全部 mock）。

- [ ] **Step 4: 全量验证 + 提交**

Run: `cd frontend && npx vitest run && npx vue-tsc --noEmit && npx eslint src --ext .vue,.ts`
Run: `cd server && npx vitest run && npx tsc --noEmit`
Expected: 全部通过、无类型/ESLint 错误。

```bash
git add -A
git commit -m "test: 画布视频节点全链路浏览器验证"
```

---

## 自审清单（写完后对照）

**Spec 覆盖：**
- [ ] 能力声明（video/cancelable）→ Task 1
- [ ] 统一提交数据（wire/runtime）→ Task 2
- [ ] 执行解耦（场景适配层）→ Task 3、Task 5
- [ ] /workflow/run video 参数 → Task 4
- [ ] ltx 重构（只消费 ctx.video）→ Task 6
- [ ] 参考模式 minimax + 动态文件键 → Task 7
- [ ] 中断（Bridge cancel + 端点 + 前端）→ Task 8、Task 14
- [ ] DataType + audio/video 加载节点 → Task 9
- [ ] 多端口支持 → Task 10
- [ ] video-generate 节点 + 事件同步 → Task 11
- [ ] VideoDirector standalone + 双向转换 → Task 12
- [ ] VideoGenerateEditor → Task 13
- [ ] 生成接线 + cancelWorkflow → Task 14
- [ ] 浏览器验证（禁止真实提交）→ Task 15
