# 视频导演台（Video Director）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现工作流引擎统一执行上下文（功能0）、视频导演台组件（功能1）、分镜视频生成页签集成（功能2），使存在导演台配置且图生视频实现支持导演台时自动使用导演台参数生成。

**Architecture:** 服务端引入统一执行上下文 `WorkflowRunContext`（引擎取数、工作流消费）；`WorkflowDefinition` 增加 `capabilities` 声明；引擎检测 `director.json` 组装 `DirectorPayload`（含 ffmpeg 混音音频），工作流内部按 `ctx.director` 分流到 `submitLtxDirectorImageToVideo`。前端新增 `video-director/` 组件族（双轨时间轴 + 预览），内嵌于 `ScenePanel` 视频生成页签。

**Tech Stack:** Express + TypeScript（服务端，vitest）、Vue 3 + Vuetify 3 + TypeScript（前端，vitest）、fluent-ffmpeg、ComfyUI Bridge（ltx-2.3-director 工作流）。

**设计文档：** `docs/superpowers/specs/2026-08-04-video-director-design.md`（实现前必读）

**通用约定（所有任务遵守）：**
- **每笔 commit 后必须 typecheck 通过**：服务端 `cd server && npx tsc --noEmit`、前端 `cd frontend && npx vue-tsc --noEmit --skipLibCheck`；根目录 `npm run lint`（0 error）
- 中文 git commit message 必须写进 UTF-8 无 BOM 临时文件再 `git commit -F`（PowerShell `-m` 会乱码）：
  ```powershell
  $f = "$env:TEMP\cm.txt"; [System.IO.File]::WriteAllText($f, "feat: 消息", [System.Text.UTF8Encoding]::new($false)); git add ...; git commit -F $f; Remove-Item $f
  ```
- 服务端测试：`cd server && npm test`；前端单测：`cd frontend && npx vitest run <文件>`
- 所有类/方法带详细中文 JsDoc（AGENTS.md）
- 当前分支 `feat-video-director`；工作区已有上次提交 `d49a57b`（设计文档）

---

## P1 · 功能0：统一执行上下文（服务端）

### Task 1: `submitLtxDirectorImageToVideo` 支持音频

**Files:**
- Modify: `server/src/workflows/bridge-client.ts`
- Test: `server/src/workflows/bridge-client.test.ts`

- [ ] **Step 1: `LtxDirectorImageToVideoSubmitParams` 增加 `audio?: File`**（JsDoc：「背景音频文件（可选），存在时自动生成音频关闭」）

- [ ] **Step 2: 修改 `submitLtxDirectorImageToVideo`**：当前 body 初始化含 `auto_generate_audio: true`、`frame_define: JSON.stringify(frameDefines)`；在构造 `files`（`frame_{idx}` 映射）之后追加：
  ```typescript
  if (params.audio) {
    files.audio = params.audio;
    body.auto_generate_audio = false;
  }
  ```

- [ ] **Step 3: 新增 2 个测试用例**（复用现有 `fetchMock`/`lastForm`/`makeFile` 辅助）：
  1. 「提供音频时 auto_generate_audio=false 且上传 audio 文件」：`frames` 1 张 + `audio: makeFile('bg.flac')`；断言 `JSON.parse(form.get('params')).auto_generate_audio === false`、`form.get('audio') === audio`、`form.get('frame_0') === file`
  2. 「未提供音频时 auto_generate_audio=true 且无 audio 字段」：断言 `params.auto_generate_audio === true`、`form.get('audio') === null`

- [ ] **Step 4: `cd server && npx vitest run src/workflows/bridge-client.test.ts`** 全绿

- [ ] **Step 5: typecheck + lint**

- [ ] **Step 6: Commit**：`feat: bridge-client 导演台工作流支持音频输入`

### Task 2: 音频混音助手 `audio-mix.ts`

**Files:**
- Create: `server/src/assets/audio-mix.ts`
- Test: `server/src/assets/audio-mix.test.ts`

- [ ] **Step 1: 写失败测试**（`buildMixFilter` 纯函数，覆盖：单段无裁剪直通、atrim+asetpts、adelay 毫秒双声道、多段 amix inputs=N:duration=longest）：
  ```typescript
  import { describe, expect, it } from 'vitest';
  import { buildMixFilter } from './audio-mix.js';
  describe('buildMixFilter', () => {
    it('单段无裁剪无偏移直接用原输入', () => {
      expect(buildMixFilter([{ startOffset: 0, trimStart: 0, trimEnd: 0, duration: 3 }]))
        .toBe('[0:a]amix=inputs=1:duration=longest:dropout_transition=0[mix]');
    });
    it('trimStart/trimEnd 生成 atrim+asetpts', () => {
      const f = buildMixFilter([{ startOffset: 0, trimStart: 1, trimEnd: 0.5, duration: 4 }]);
      expect(f).toContain('atrim=start=1:end=3.5');
      expect(f).toContain('asetpts=PTS-STARTPTS');
    });
    it('startOffset 生成 adelay（毫秒，双声道）', () => {
      const f = buildMixFilter([{ startOffset: 1.5, trimStart: 0, trimEnd: 0, duration: 2 }]);
      expect(f).toContain('adelay=1500|1500');
    });
    it('多段：先各自裁剪定位，再 amix inputs=N:duration=longest', () => {
      const f = buildMixFilter([
        { startOffset: 0, trimStart: 0, trimEnd: 0, duration: 3 },
        { startOffset: 2, trimStart: 0.5, trimEnd: 0, duration: 4 },
      ]);
      expect(f).toContain('amix=inputs=2:duration=longest:dropout_transition=0[mix]');
    });
  });
  ```
  运行确认失败：`cd server && npx vitest run src/assets/audio-mix.test.ts`

- [ ] **Step 2: 实现 `audio-mix.ts`**（参考 `server/src/assets/audio-merge.ts` 的 filter_complex 模式）：
  - `export interface AudioMixInput { startOffset: number; trimStart: number; trimEnd: number; duration: number }`
  - `export function buildMixFilter(inputs: AudioMixInput[]): string` —— 每段：`atrim`（trimStart/trimEnd，end=duration-trimEnd）→ `asetpts=PTS-STARTPTS` → `adelay=ms|ms`（startOffset*1000 取整）；最后 `amix=inputs=N:duration=longest:dropout_transition=0[mix]`。**必须 `duration=longest`**（否则靠后轨道被截断）
  - `export async function getAudioDuration(filePath: string): Promise<number>`（ffprobe，参考 audio-merge.ts 私有实现）
  - `export interface MixTrack { filePath: string; startOffset: number; trimStart: number; trimEnd: number; duration?: number }`
  - `export async function mixAudioTracks(tracks: MixTrack[], outputPath: string): Promise<void>` —— 逐轨道 ffprobe 取时长（缺省时），跳过不可用文件；`Ffmpeg()` 多输入 + `complexFilter(buildMixFilter(...))` + 输出 `outputPath`（扩展名推断格式，本计划输出 `.flac`）；无可用轨道抛 `Error`。全部中文 JsDoc

- [ ] **Step 3: 测试通过 + typecheck + lint**

- [ ] **Step 4: Commit**：`feat: 新增音频混音助手 audio-mix（供导演台合成音频）`

### Task 3: 导演台配置解析助手 `director.ts`

**Files:**
- Create: `server/src/assets/director.ts`
- Test: `server/src/assets/director.test.ts`

- [ ] **Step 1: 写失败测试**：
  ```typescript
  import { describe, expect, it } from 'vitest';
  import { parseDirectorJson, computeFrameDefines } from './director.js';
  describe('parseDirectorJson', () => {
    it('解析合法配置', () => {
      const c = parseDirectorJson(JSON.stringify({
        version: 1, duration: 10, width: 1080, height: 1920, fps: 24,
        imageClips: [{ path: 'assert/scene/1/1/stage/0.jpg', startOffset: 0, duration: 2 }],
        audioClips: [],
      }));
      expect(c.duration).toBe(10);
      expect(c.imageClips).toHaveLength(1);
    });
    it('非法 JSON 抛错', () => { expect(() => parseDirectorJson('not-json')).toThrow(); });
    it('duration 非正整数抛错', () => {
      expect(() => parseDirectorJson(JSON.stringify({ version: 1, duration: -1, imageClips: [], audioClips: [] }))).toThrow();
    });
  });
  describe('computeFrameDefines', () => {
    it('按 startOffset 升序生成 frameSeq 与 cursor', () => {
      const defs = computeFrameDefines([
        { path: 'b', startOffset: 6, duration: 2 },
        { path: 'a', startOffset: 0, duration: 2 },
        { path: 'c', startOffset: 3, duration: 2 },
      ], 10);
      expect(defs.map(d => d.path)).toEqual(['a', 'c', 'b']);
      expect(defs[0].frameSeq).toBe(0);
      expect(defs[0].cursor).toBe(0);
      expect(defs[1].cursor).toBe(0.3);
      expect(defs[2].frameSeq).toBe(2);
      expect(defs[2].cursor).toBe(0.6);
    });
    it('startOffset 接近时长时 cursor 正确钳制', () => {
      const defs = computeFrameDefines([{ path: 'a', startOffset: 9, duration: 2 }], 10);
      expect(defs[0].cursor).toBe(0.9);
    });
  });
  ```
  运行确认失败。

- [ ] **Step 2: 实现 `director.ts`**：
  - `export interface DirectorImageClipFile { path: string; startOffset: number; duration: number }`
  - `export interface DirectorAudioClipFile { path: string; startOffset: number; duration: number; trimStart: number; trimEnd: number }`
  - `export interface DirectorConfigFile { version: number; duration: number; width: number; height: number; fps: number; imageClips: DirectorImageClipFile[]; audioClips: DirectorAudioClipFile[] }`
  - `export function parseDirectorJson(raw: string): DirectorConfigFile` —— JSON.parse + 校验（duration 正整数、width/height/fps 为数字、imageClips/audioClips 为数组；非法抛中文 `Error`）
  - `export function computeFrameDefines(imageClips: DirectorImageClipFile[], duration: number): Array<{ path: string; frameSeq: number; cursor: number }>` —— 按 `startOffset` 升序；`frameSeq = index`；`cursor = clamp(startOffset / duration, 0, 1)`

- [ ] **Step 3: 测试通过 + typecheck + lint**

- [ ] **Step 4: Commit**：`feat: 导演台配置解析与关键帧定义计算`

### Task 4: 工作流类型层（capabilities / DirectorPayload / WorkflowRunContext，增量）

**Files:**
- Modify: `server/src/workflows/types.ts`

- [ ] **Step 1: 在 `types.ts` 增加（导出）**：
  ```typescript
  /** 工作流能力声明（注册时声明，经 /api/workflows 透传前端） */
  export interface WorkflowCapabilities {
    /** 是否支持导演台模式 */
    director?: boolean;
    /** 是否支持传入外部音频 */
    audio?: boolean;
  }

  /** 导演台执行负载（引擎从 director.json 解析并注入） */
  export interface DirectorPayload {
    duration: number;
    width: number;
    height: number;
    fps: number;
    /** 关键帧：按 startOffset 升序，frameSeq=0..n，cursor=startOffset/duration（钳制 0~1） */
    frames: Array<{ file: File; frameSeq: number; cursor: number }>;
    /** 混音后的音频文件（可选） */
    audio?: File;
  }

  /** 统一执行上下文（submit 的入参，替代 WorkflowParams） */
  export interface WorkflowRunContext<TVars extends WorkflowVarsBase = WorkflowVarsBase> {
    project: string;
    projectConfig: ProjectConfig;
    /** 业务变量（引擎已注入 enrich 结果） */
    vars: TVars;
    /** 引擎按需解析的资产文件（预留，P1 可不使用） */
    assets?: Record<string, File>;
    /** 导演台负载：仅当 director.json 存在且所选实现声明 capabilities.director 时注入 */
    director?: DirectorPayload;
    /** 用户手动传入的工作流参数（按实现声明 key） */
    userParams?: Record<string, boolean | number | string>;
    readFile(relPath: string): Promise<string>;
    readAssertFile(relPath: string): Promise<File>;
  }
  ```

- [ ] **Step 2: `WorkflowDefinition` 增加 `capabilities?: WorkflowCapabilities`**（**此任务不改 `submit` 签名**，仍为 `WorkflowParams`，保证本 commit typecheck 通过）

- [ ] **Step 3: typecheck + lint**

- [ ] **Step 4: Commit**：`refactor: 工作流类型层引入能力声明与统一上下文（增量）`

### Task 5: 迁移全部工作流与工厂到 `WorkflowRunContext`

**Files:**
- Modify: `server/src/workflows/bridge-client.ts`（工厂函数签名）
- Modify: `server/src/workflows/image-to-video/default.ts`
- Modify: `server/src/workflows/text-to-image/default.ts`
- Modify: `server/src/workflows/image-edit/default.ts`
- Modify: `server/src/workflows/tts-voice-design/default.ts`

- [ ] **Step 1: `bridge-client.ts` 工厂签名迁移**：`createComfyuiBridgeWorkflow`、`createTextToImageWorkflow`、`createImageEditWorkflow`、`createTtsDesignWorkflow` 及各自 config 接口中所有 `WorkflowParams<TVars>` → `WorkflowRunContext<TVars>`；`WorkflowDefinition` 的 submit 签名同步（import 更新；`WorkflowParams` 保留导出避免破坏外部 import）

- [ ] **Step 2: 4 个工作流实现文件**：submit 入参名改 `ctx`（或保留 `params` 名，类型推断自动更新），函数体 `params.readFile`→`ctx.readFile`、`params.readAssertFile`→`ctx.readAssertFile`、`params.vars`→`ctx.vars`、`params.projectConfig`→`ctx.projectConfig`。**行为不变**（image-to-video 的导演台分流在 Task 7）

- [ ] **Step 3: `cd server && npx tsc --noEmit` 通过**；`cd server && npm test` 全绿

- [ ] **Step 4: lint**

- [ ] **Step 5: Commit**：`refactor: 全部工作流迁移至 WorkflowRunContext`

### Task 6: 引擎构建上下文 + 导演台检测注入（`director-inject.ts`）

**Files:**
- Create: `server/src/workflows/director-inject.ts`
- Test: `server/src/workflows/director-inject.test.ts`
- Modify: `server/src/workflow-engine.ts`

- [ ] **Step 1: 写失败测试**（`buildDirectorPayload`，用 mock deps 避免真实文件/ffmpeg）：
  ```typescript
  import { describe, expect, it } from 'vitest';
  import { buildDirectorPayload } from './director-inject.js';
  const baseConfig = { version: 1, duration: 10, width: 1080, height: 1920, fps: 24 };
  function deps(overrides = {}) {
    return {
      readFile: async () => JSON.stringify({ ...baseConfig, imageClips: [
        { path: 'assert/2.jpg', startOffset: 6, duration: 2 },
        { path: 'assert/1.jpg', startOffset: 0, duration: 2 },
      ], audioClips: [] }),
      readAssertFile: async (p: string) => ({ name: p.split('/').pop() }) as unknown as File,
      mixAudioTracks: async () => {},
      readTempAudio: async () => new Uint8Array([1, 2, 3]),
      ...overrides,
    };
  }
  describe('buildDirectorPayload', () => {
    it('返回按 startOffset 排序的 frames 与 cursor', async () => {
      const p = await buildDirectorPayload('AI的第一天', '1', '1', deps());
      expect(p).not.toBeNull();
      expect(p!.frames.map(f => f.frameSeq)).toEqual([0, 1]);
      expect(p!.frames[0].cursor).toBe(0);
      expect(p!.frames[1].cursor).toBe(0.6);
      expect(p!.duration).toBe(10);
    });
    it('readFile 抛错（无 director.json）时返回 null', async () => {
      const p = await buildDirectorPayload('p', '1', '1', deps({
        readFile: async () => { throw new Error('ENOENT'); },
      }));
      expect(p).toBeNull();
    });
    it('imageClips 为空时返回 null', async () => {
      const p = await buildDirectorPayload('p', '1', '1', deps({
        readFile: async () => JSON.stringify({ ...baseConfig, imageClips: [], audioClips: [] }),
      }));
      expect(p).toBeNull();
    });
    it('audioClips 非空时调用混音并注入 audio', async () => {
      const d = deps({ readFile: async () => JSON.stringify({ ...baseConfig, imageClips: [
        { path: 'assert/1.jpg', startOffset: 0, duration: 2 },
      ], audioClips: [{ path: 'assert/bg.flac', startOffset: 0, duration: 3, trimStart: 0, trimEnd: 0 }] }) });
      const p = await buildDirectorPayload('p', '1', '1', d);
      expect(p!.audio).toBeTruthy();
    });
  });
  ```
  运行确认失败：`cd server && npx vitest run src/workflows/director-inject.test.ts`

- [ ] **Step 2: 实现 `server/src/workflows/director-inject.ts`**：
  - `export interface DirectorInjectDeps { readFile(rel: string): Promise<string>; readAssertFile(rel: string): Promise<File>; mixAudioTracks(tracks: MixTrack[], out: string): Promise<void>; readTempAudio(path: string): Promise<Uint8Array> }`
  - `export async function buildDirectorPayload(project, episode, shot, deps): Promise<DirectorPayload | null>`：
    1. `readFile('prompt/scene/{ep}/{shot}/director.json')`；抛错 → `console.warn` + 返回 null
    2. `parseDirectorJson`；`imageClips.length < 1` → null
    3. `computeFrameDefines(config.imageClips, config.duration)` → 逐个 `readAssertFile(path)` 得 File → frames
    4. `config.audioClips.length >= 1` → `os.tmpdir()` 临时文件 → `mixAudioTracks` → `readTempAudio` → `new File([buf], 'director-audio.flac', { type: 'audio/flac' })` → audio
    5. 返回 `{ duration, width, height, fps, frames, ...(audio ? { audio } : {}) }`

- [ ] **Step 3: 引擎接线（`workflow-engine.ts`）**：
  - `runTask` 中解析出实现后记 `capabilities = impl?.capabilities`
  - 对 image-to-video：在 enrich vars 之后，若 `capabilities?.director` 为真，调 `buildDirectorPayload(project, episode, shot, { readFile, readAssertFile, mixAudioTracks, readTempAudio })`；得到 payload 后：`ctx.director = payload`，且 `vars.duration = String(payload.duration)`（导演台为准）
  - 将 submit 入参改为组装 `WorkflowRunContext<TVars>`：`{ project, projectConfig, vars, director?, userParams?, readFile, readAssertFile }`（userParams 仍按现状合并进 vars，同时透传）
  - 非 image-to-video 工作流保持现状（仅入参对象形态变化）

- [ ] **Step 4: `cd server && npm test` 全绿 + typecheck + lint**

- [ ] **Step 5: Commit**：`feat: 引擎注入导演台 DirectorPayload（含音频混音）`

### Task 7: image-to-video 导演台分流 + 能力声明

**Files:**
- Modify: `server/src/workflows/image-to-video/default.ts`

- [ ] **Step 1: 注册时声明能力**：`createComfyuiBridgeWorkflow<ImageToVideoVars>` 的 `baseDefinition` 增加 `capabilities: { director: true, audio: true }`。注意：若 `WorkflowBaseDefinition` 未含 `capabilities` 字段且 factory 不合并它，则在 `createComfyuiBridgeWorkflow` 返回值处把 baseDefinition 额外字段一并展开（如 `...baseDefinition` 已存在则自然带上）。**选择改动最小**的方式，并保证 `registry` 能读到 `capabilities`（用 `npx tsx` 临时脚本或单测验证 `getImpl('image-to-video','ltx')?.capabilities` 为 `{ director: true, audio: true }`）

- [ ] **Step 2: `submit` 开头加导演台分流**：
  ```typescript
  async submit(ctx) {
    const episode = ctx.vars.episode;
    const shot = ctx.vars.shot;
    if (ctx.director) {
      const prompt = await ctx.readFile(`prompt/scene/${episode}/${shot}/prompt.md`);
      const { duration, width, height, fps, frames, audio } = ctx.director;
      if (!prompt.trim()) throw new Error('image-to-video 导演台模式 prompt.md 为空');
      const result = await submitLtxDirectorImageToVideo({
        prompt, width, height, duration, fps,
        seed: ctx.vars.seed ? Number(ctx.vars.seed) : undefined,
        frames,
        ...(audio ? { audio } : {}),
      });
      return { taskId: result.taskId };
    }
    // 普通模式：现有逻辑（duration 从 ctx.vars.duration、stageImages 从 ctx.vars.stageImages、音频策略不变）
  }
  ```

- [ ] **Step 3: `cd server && npm test` + typecheck + lint**

- [ ] **Step 4: Commit**：`feat: image-to-video 支持导演台模式分流（ltx-2.3-director）`

### Task 8: registry / API 能力透传

**Files:**
- Modify: `server/src/workflows/registry.ts`
- Modify: `server/src/routes/workflow.ts`（如需要）
- Modify: `frontend/src/api/workflow.ts`

- [ ] **Step 1: `registry.ts` 的 `getAllWorkflows`**：实现条目增加 `capabilities`（`w.capabilities`）
- [ ] **Step 2: 确认 `routes/workflow.ts` 的 `/api/workflows`** 返回结构包含 capabilities（透传 registry 结果；若手工重组则补字段）
- [ ] **Step 3: `frontend/src/api/workflow.ts`**：`WorkflowImplementation` 增加 `capabilities?: { director?: boolean; audio?: boolean }`
- [ ] **Step 4: `npm run typecheck`（根）+ `npm run lint`**
- [ ] **Step 5: Commit**：`feat: 工作流能力声明透传至前端 API`

---

## P2 · 功能1：视频导演台组件（前端）

### Task 9: 导演台数据模型 `types.ts`

**Files:**
- Create: `frontend/src/components/video-director/types.ts`

- [ ] **Step 1: 创建**（中文 JsDoc，字段含义见设计文档 4.2）：
  ```typescript
  export interface DirectorImageClip {
    id: string
    path: string
    startOffset: number
    duration: number
  }
  export interface DirectorAudioClip {
    id: string
    path: string
    startOffset: number
    duration: number
    trimStart: number
    trimEnd: number
  }
  export interface DirectorProject {
    version: number
    duration: number
    width: number
    height: number
    fps: number
    imageClips: DirectorImageClip[]
    audioClips: DirectorAudioClip[]
  }
  export const DIRECTOR_VERSION = 1
  /** 图片块默认占位长度（秒） */
  export const DEFAULT_IMAGE_CLIP_DURATION = 2
  /** 生成空白导演台项目（duration 默认 0，由调用方填充） */
  export function createDirectorProject(): DirectorProject
  ```

- [ ] **Step 2: typecheck**：`cd frontend && npx vue-tsc --noEmit --skipLibCheck`

- [ ] **Step 3: Commit**：`feat: 导演台前端数据模型`

### Task 10: `useVideoDirector` composable

**Files:**
- Create: `frontend/src/components/video-director/useVideoDirector.ts`
- Test: `frontend/src/components/video-director/useVideoDirector.test.ts`

- [ ] **Step 1: 写失败测试**（纯函数部分）：
  ```typescript
  import { describe, expect, it } from 'vitest';
  import { previewImageAt, computePasteOffset, frameCursors } from './useVideoDirector';
  const clips = [
    { id: 'a', path: 'assert/1.jpg', startOffset: 0, duration: 2 },
    { id: 'b', path: 'assert/2.jpg', startOffset: 3, duration: 2 },
  ];
  describe('previewImageAt', () => {
    it('无块或 t 之前无块 → null', () => { expect(previewImageAt([], 1)).toBeNull(); });
    it('命中最后一个 startOffset <= t 的块', () => {
      expect(previewImageAt(clips, 1.5)).toBe('assert/1.jpg');
      expect(previewImageAt(clips, 3)).toBe('assert/2.jpg');
      expect(previewImageAt(clips, 3.5)).toBe('assert/2.jpg');
    });
  });
  describe('computePasteOffset', () => {
    it('粘贴到选中块 startOffset + 1', () => { expect(computePasteOffset({ startOffset: 4 } as never)).toBe(5); });
  });
  describe('frameCursors', () => {
    it('按 startOffset 排序映射 cursor', () => {
      expect(frameCursors([{ startOffset: 3, duration: 1 }, { startOffset: 0, duration: 1 }], 10)).toEqual([0, 0.3]);
    });
  });
  ```
  运行确认失败：`cd frontend && npx vitest run src/components/video-director/useVideoDirector.test.ts`

- [ ] **Step 2: 实现 `useVideoDirector.ts`**：
  - 纯函数：`previewImageAt(imageClips, t): string | null`、`computePasteOffset(clip): number`、`frameCursors(imageClips, duration): number[]`
  - `useVideoDirector(opts: { onChange?: (p: DirectorProject) => void })` 返回：`project`(ref)、`imageClips`、`audioClips`、`duration`、`currentTime`、`playState`、`zoom`(px/s 默认 80)、`selectedId`、`clipboard`
  - 方法：`syncFromProject(p)`、`toProject()`、`addImage(path)`（默认 duration=DEFAULT_IMAGE_CLIP_DURATION，落在 `max(0, currentTime)`）、`addAudio(path, duration)`、`moveClip(kind,id,startOffset)`（钳制 0~duration-显示长度）、`resizeClip(id,duration)`、`trimClip(id,trimStart,trimEnd)`、`select(id)`、`copySelected()`、`paste()`（同轨道，startOffset=选中+1s，新 id=`crypto.randomUUID()`）、`removeSelected()`、`setCurrentTime(t)`、`setZoom(z)`、`togglePlay()`/`stopPlay()`（状态机，实际音频播放由组件接 PlaybackEngine）
  - 所有变更方法内部调用 `commit()` → `onChange?.(toProject())`；`id` 用 `crypto.randomUUID()`

- [ ] **Step 3: 测试通过 + typecheck + lint**

- [ ] **Step 4: Commit**：`feat: useVideoDirector 状态管理与纯逻辑测试`

### Task 11: 时间轴与素材块组件

**Files:**
- Create: `frontend/src/components/video-director/DirectorTimeline.vue`
- Create: `frontend/src/components/video-director/DirectorImageClip.vue`
- Create: `frontend/src/components/video-director/DirectorAudioClip.vue`

- [ ] **Step 1: `DirectorImageClip.vue`**
  - props：`clip: DirectorImageClip`、`imageUrl: string`、`pxPerSec: number`、`selected: boolean`、`readOnly: boolean`、`trackDuration: number`
  - emits：`select`、`move(id, startOffset)`、`resize(id, duration)`
  - 绝对定位块：`left = clip.startOffset * pxPerSec`px、`width = clip.duration * pxPerSec`px；缩略图 `object-fit: cover`；选中高亮边框；`@mousedown.stop`
  - 拖动主体 → move（startOffset 钳制 `[0, trackDuration - duration]`，步进 0.1s）；左右边缘把手（`cursor: ew-resize`）→ resize（最小 0.5s）；`readOnly` 禁用

- [ ] **Step 2: `DirectorAudioClip.vue`**
  - props：`clip: DirectorAudioClip`、`waveform: number[]`、`pxPerSec: number`、`selected`、`readOnly`、`trackDuration`
  - emits：`select`、`move(id, startOffset)`、`trim(id, trimStart, trimEnd)`
  - 显示宽度 = `(clip.duration - clip.trimStart - clip.trimEnd) * pxPerSec`；波形等宽柱状（复用 audio-editor 波形渲染思路）
  - 拖动主体 → move（钳制 `[0, trackDuration - 显示长度]`）；左右把手 → trim（调整 `trimStart`/`trimEnd`，保持显示长度 ≥ 0.5s 且 ≤ duration）

- [ ] **Step 3: `DirectorTimeline.vue`**
  - props：`imageClips`、`audioClips`、`imageUrls: Record<string,string>`、`waveforms: Record<string, number[]>`、`duration`、`currentTime`、`zoom`、`selectedId`、`readOnly`
  - emits：透传 `select`/`move`/`resize`/`trim`、`seek(t)`
  - 顶部刻度尺（整秒格 + 标签）；图片轨道（上）+ 音频轨道（下）；播放头竖线（`currentTime * zoom`）；点击空白 → `seek(round(x / zoom * 10) / 10)`；容器 `overflow-x: auto`，内容宽 `max(duration * zoom, 容器宽)`

- [ ] **Step 4: typecheck + lint**

- [ ] **Step 5: Commit**：`feat: 导演台时间轴与图片/音频素材块组件`

### Task 12: `VideoDirector.vue` 主组件

**Files:**
- Create: `frontend/src/components/video-director/VideoDirector.vue`

- [ ] **Step 1: 模板（布局 A）**：工具栏（播放/暂停/停止、缩放滑块、当前/总时长、添加图片、添加音频、复制、粘贴、保存、生成视频）→ 预览窗口（当前帧图片，无图占位）→ `DirectorTimeline`；底部挂 2 个 `AssetPickerDialog`

- [ ] **Step 2: props/emits**
  ```typescript
  props: { project: string; director: DirectorProject; readOnly?: boolean; allowAddAsset?: boolean }
  emits: { 'update:director': [p: DirectorProject]; save: [p: DirectorProject]; generate: [p: DirectorProject] }
  ```

- [ ] **Step 3: 逻辑**
  - `watch(() => props.director)` → `syncFromProject`；内部变更 `commit()` → emit `update:director`；回传 prop 变化用 **JSON 相等守卫**防死循环（repo memory：双 watch 无守卫会死循环）
  - 播放：复用 `audio-editor/PlaybackEngine.ts` —— 把每个音频块解码为 `AudioBuffer`（`decodeAudioData`），构造 `PlaybackClip[]` 传入 `engine.play`；`onStateChange`→playState、`onTimeUpdate`→currentTime（驱动播放头 + 预览）；`togglePlay`/`stopPlay`/`seek` 对接
  - 波形：每音频块 `audio-editor/waveform.ts` 提取峰值 → `waveforms: Record<id, number[]>`；图片 URL 用 `fileUrl` 类工具（`assert/` 前缀路径 → 可访问 URL）
  - 添加：按钮 → `AssetPickerDialog`（图片用 `tabs=['stage','character','custom']`；音频用 `tabs=['audio']`，若 AssetTab 无 'audio' 则查 `frontend/src/api/assets.ts` 的 AssetTab 定义取实际值）→ `update:selected` → `addImage/addAudio`（音频 duration 由解码 AudioBuffer 得到）
  - 键盘：`@keydown` `Ctrl+C`/`Ctrl+V`/`Delete`（`readOnly` 忽略；注意 input/textarea 聚焦时不拦截）
  - 保存/生成：`emit('save', toProject())` / `emit('generate', toProject())`
  - `readOnly` → 全部禁用；`allowAddAsset=false && !readOnly` → 隐藏添加按钮，其余可编辑

- [ ] **Step 4: typecheck + lint**

- [ ] **Step 5: Commit**：`feat: VideoDirector 主组件（预览+双轨+播放+资产添加+复制粘贴）`

---

## P3 · 功能2：视频生成页签集成

### Task 13: `ScenePanel.vue` 集成导演台

**Files:**
- Create: `frontend/src/api/director.ts`
- Modify: `frontend/src/components/ScenePanel.vue`
- Modify: `frontend/src/components/GenerateDialog.vue`（可选提示）

- [ ] **Step 1: `frontend/src/api/director.ts`**
  - `readDirectorConfig(project, episode, shot): Promise<DirectorProject | null>` —— `readFs(project, 'prompt/scene/{ep}/{shot}/director.json')`；不存在/解析失败 → null；兼容 string 与 object 形态（repo memory：readFs 对 .json 可能返回反序列化对象）
  - `writeDirectorConfig(project, episode, shot, p: DirectorProject): Promise<void>` —— `writeFs` 写 `JSON.stringify(p, null, 2)`
  - `emptyDirectorProject(duration, width, height, fps): DirectorProject`

- [ ] **Step 2: `ScenePanel.vue`**
  - 视频生成 Tab 内嵌 `<VideoDirector :project :director :allow-add-asset @save @generate @update:director>`
  - 加载：`load()` 中（含切分镜 watch）`readDirectorConfig` → `director` ref；为空时用 `overview.json.duration` + `projectConfig.width/height/fps` 构造空项目
  - `@update:director` → 更新 ref（不落盘）；`@save` → `writeDirectorConfig`；`@generate` → 先保存再打开 `genVideoDialog`（现有 GenerateDialog，`workflow-id="image-to-video"`，`vars={episode, shot}` 不变）
  - 切分镜时 `director` 重置并重新加载（复用现有 shot watch 逻辑）

- [ ] **Step 3: `GenerateDialog.vue` 可选提示**：新增可选 prop `hint?: string`，非空时在对话框内 `text-caption` 展示一行；ScenePanel 在 `director.imageClips.length >= 1` 时传「检测到导演台配置，将使用导演台参数生成」；不改变提交逻辑

- [ ] **Step 4: `cd frontend && npx vue-tsc --noEmit --skipLibCheck` + lint + 浏览器 E2E**（编辑→保存→打开生成→确认提示→生成，服务端日志验证走 ltx-2.3-director 或至少无错误）

- [ ] **Step 5: Commit**：`feat: 分镜视频生成页签集成导演台`

---

## P4 · 收尾

### Task 14: 全量验证与文档更新

**Files:**
- Modify: `docs/plans/video-director.md`

- [ ] **Step 1: 全量测试**：`cd server && npm test`；`cd frontend && npx vitest run`
- [ ] **Step 2: typecheck + lint**：根目录 `npm run typecheck`、`npm run lint`（0 error）
- [ ] **Step 3: 浏览器冒烟**：打开一个分镜视频生成页签 → 添加图片/音频 → 保存 → 生成（确认无错误）
- [ ] **Step 4: 更新 `docs/plans/video-director.md`**：标注三项功能完成状态与关键约定
- [ ] **Step 5: Commit**：`docs: 视频导演台实现完成，更新规划文档`

---

## 自查结论

- **Spec 覆盖**：功能0（Task1-8）、功能1（Task9-12）、功能2（Task13）、P4（Task14）、额外目标音频（Task1/6/7）—— 全覆盖
- **占位符**：无 TBD/TODO；所有代码步骤含实际代码或精确引用
- **类型一致性**：`WorkflowRunContext`/`DirectorPayload`/`DirectorProject`/`DirectorImageClip`/`DirectorAudioClip`/`buildMixFilter`/`mixAudioTracks`/`parseDirectorJson`/`computeFrameDefines`/`buildDirectorPayload` 名称跨任务一致
- **提交健康**：每笔 commit 后 typecheck 通过（Task4 增量不改 submit 签名；Task5 一次性迁移全部消费者）
