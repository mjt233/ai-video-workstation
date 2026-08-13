# TTS 音色克隆（tts-voice-clone）与画布 TTS 节点实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `tts-voice-clone` 工作流类型（ComfyUI Easy Bridge 标签自动注册），并在资产画布新增「TTS声音生成」节点（音色克隆 / 音色设计双模式，音频入、音频出）。

**Architecture:** 服务端把 `tts-voice-clone` 作为与 `tts-voice-design` 平级的独立工作流类型：`bridge-derive.ts` 的 `TYPE_TAGS` 增加标签映射（自动注册），`bridge-client.ts` 新增 `buildTtsClonePayload`（params `text`/`ref_text` + 文件 `audio_0`），`bridge-sync.ts` 新增 `ttsCloneSubmit` 并接入 `buildSubmit`。前端画布新增 `tts-generate` 节点原型（audio 输入口 → audio 输出口），编辑器按 `config.mode` 切换克隆/设计，生成流程按模式组装 vars，产物为 `.flac`。

**Tech Stack:** TypeScript（服务端 Express + vitest）、Vue 3 + Vuetify 3 + Vue Flow（前端 vitest）、ComfyUI Easy Bridge 动态工作流注册。

**规格:** `docs/superpowers/specs/2026-08-13-tts-voice-clone-design.md`

---

## 文件结构

**服务端（server/src/workflows/）**
- Modify `vars.ts` — 新增 `TtsVoiceCloneVars`
- Modify `types.ts` — `WorkflowTypeId` 增加 `'tts-voice-clone'` + re-export
- Modify `bridge-derive.ts` — `BridgeDerivedType` + `TYPE_TAGS` 增加克隆标签映射
- Modify `bridge-client.ts` — 新增 `buildTtsClonePayload`
- Modify `bridge-sync.ts` — 新增 `ttsCloneSubmit` + `buildSubmit` case
- Test: `bridge-derive.test.ts` / `bridge-client.test.ts` / `bridge-sync.test.ts`

**文档**
- Modify `docs/bridge-workflow-fields.md` — 补充 tts-voice-clone 字段约定

**前端（frontend/src/）**
- Modify `canvas/registry.ts` — 新增 `tts-generate` 节点原型
- Create `components/canvas/nodes/TtsGenerateNode.vue` — 节点卡片（音频预览）
- Create `components/canvas/editors/TtsGenerateEditor.vue` — 配置面板（模式切换）
- Modify `canvas/useCanvasGeneration.ts` — `tts-generate` 生成分支 + `.flac` 产物
- Modify `components/canvas/AssetCanvas.vue` — `generateNode` 增加 `tts-generate` 分支
- Test: `canvas/registry.test.ts` / `canvas/useCanvasGeneration.test.ts`

---

## 提交约定（本计划所有 Commit 步骤统一使用）

因 Windows 控制台会把中文提交信息双重编码成乱码，**每个提交步骤固定为**：
1. 用 **create_file 工具**写入 `c:\Users\xiaotao\code\ai-video-workstation\.git\COMMIT_MSG_TMP.md`（UTF-8，内容为提交信息）
2. Run（sync）：`git -C "c:\Users\xiaotao\code\ai-video-workstation" add <文件...>; git -C "c:\Users\xiaotao\code\ai-video-workstation" commit -F "c:\Users\xiaotao\code\ai-video-workstation\.git\COMMIT_MSG_TMP.md"`
3. Run（sync）：`Remove-Item "c:\Users\xiaotao\code\ai-video-workstation\.git\COMMIT_MSG_TMP.md"`

各任务 Commit 步骤中只给出「提交信息内容」与「git add 的文件」，不再重复完整命令。

---

### Task 1: 服务端类型与 vars

**Files:**
- Modify: `server/src/workflows/vars.ts`
- Modify: `server/src/workflows/types.ts`

- [ ] **Step 1: 在 `vars.ts` 的 `TtsVoiceDesignVars` 块之后（`// ── 图生视频 image-to-video ──` 之前）插入音色克隆类型**

```ts
// ── 音色克隆 tts-voice-clone ────────────────────────────────────────

/**
 * 音色克隆 / TTS 工作流变量。
 *
 * 用于资产画布「TTS声音生成」节点音色克隆模式。
 * 调用方提供 text（朗读文本）、refText（参考音频文字内容）与 refAudioPath（参考音频路径）。
 */
export interface TtsVoiceCloneVars extends WorkflowVarsBase {
  /** 待合成的朗读文本 */
  text: string;
  /** 参考音频的语音内容文字 */
  refText: string;
  /** 参考音频文件相对路径（JSON 数组字符串，与 imagePaths 同约定） */
  refAudioPath: string;
  /** 可选：资产用途标签，如 `canvas-tts` */
  purpose?: string;
}
```

- [ ] **Step 2: 修改 `types.ts` 的 `WorkflowTypeId` 联合类型，增加 `'tts-voice-clone'`**

原：
```ts
export type WorkflowTypeId =
  | 'text-to-image'
  | 'image-edit'
  | 'tts-voice-design'
  | 'image-to-video';
```
改：
```ts
export type WorkflowTypeId =
  | 'text-to-image'
  | 'image-edit'
  | 'tts-voice-design'
  | 'tts-voice-clone'
  | 'image-to-video';
```

- [ ] **Step 3: 修改 `types.ts` 顶部的 re-export 区，增加 `TtsVoiceCloneVars`**

原：
```ts
export type {
  WorkflowVarsBase,
  TextToImageVars,
  ImageEditVars,
  TtsVoiceDesignVars,
  ImageToVideoVars,
```
改：
```ts
export type {
  WorkflowVarsBase,
  TextToImageVars,
  ImageEditVars,
  TtsVoiceDesignVars,
  TtsVoiceCloneVars,
  ImageToVideoVars,
```

- [ ] **Step 4: 类型检查**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation" ; npm run typecheck:server`
Expected: 无错误，退出码 0

- [ ] **Step 5: Commit**

提交信息内容：
```
feat: 新增 tts-voice-clone 工作流类型与 TtsVoiceCloneVars
```
git add：`server/src/workflows/vars.ts server/src/workflows/types.ts`

---

### Task 2: bridge-derive 标签映射（TDD）

**Files:**
- Test: `server/src/workflows/bridge-derive.test.ts`
- Modify: `server/src/workflows/bridge-derive.ts`

- [ ] **Step 1: 写失败测试 —— 在 `bridge-derive.test.ts` 的 `describe('deriveWorkflowType')` 中 `image-to-video` 用例之后追加**

```ts
  it('tts-voice-clone 父标签 → tts-voice-clone', () => {
    expect(deriveWorkflowType([group('tts-voice-clone')])).toBe('tts-voice-clone');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation\server" ; npx vitest run src/workflows/bridge-derive.test.ts`
Expected: FAIL —— `expect(received).toBe(expected)`，received 为 null

- [ ] **Step 3: 实现 —— 修改 `bridge-derive.ts`**

① `BridgeDerivedType` 增加克隆类型：
原：
```ts
export type BridgeDerivedType = 'text-to-image' | 'image-edit' | 'tts-voice-design' | 'image-to-video';
```
改：
```ts
export type BridgeDerivedType = 'text-to-image' | 'image-edit' | 'tts-voice-design' | 'tts-voice-clone' | 'image-to-video';
```

② `TYPE_TAGS` 在 `tts-voice-design` 之后增加映射（这就是「标签存在则自动注册」的实现）：
原：
```ts
const TYPE_TAGS: Array<{ tag: string; type: BridgeDerivedType }> = [
  { tag: 'text-to-image', type: 'text-to-image' },
  { tag: 'image-edit', type: 'image-edit' },
  { tag: 'tts-voice-design', type: 'tts-voice-design' },
  { tag: 'image-to-video', type: 'image-to-video' },
];
```
改：
```ts
const TYPE_TAGS: Array<{ tag: string; type: BridgeDerivedType }> = [
  { tag: 'text-to-image', type: 'text-to-image' },
  { tag: 'image-edit', type: 'image-edit' },
  { tag: 'tts-voice-design', type: 'tts-voice-design' },
  { tag: 'tts-voice-clone', type: 'tts-voice-clone' },
  { tag: 'image-to-video', type: 'image-to-video' },
];
```

- [ ] **Step 4: 运行测试确认通过**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation\server" ; npx vitest run src/workflows/bridge-derive.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

提交信息内容：
```
feat: bridge-derive 增加 tts-voice-clone 标签映射
```
git add：`server/src/workflows/bridge-derive.ts server/src/workflows/bridge-derive.test.ts`

---

### Task 3: bridge-client buildTtsClonePayload（TDD）

**Files:**
- Test: `server/src/workflows/bridge-client.test.ts`
- Modify: `server/src/workflows/bridge-client.ts`

- [ ] **Step 1: 写失败测试 —— 修改 `bridge-client.test.ts`**

① 顶部 import 增加 `buildTtsClonePayload`：
原：
```ts
import {
  buildTextToImagePayload,
  buildTtsPayload,
```
改：
```ts
import {
  buildTextToImagePayload,
  buildTtsPayload,
  buildTtsClonePayload,
```

② 在 `describe('buildTtsPayload')` 块之后追加：
```ts
describe('buildTtsClonePayload', () => {
  it('params text/ref_text + 文件 audio_0', () => {
    const p = buildTtsClonePayload({ workflowId: 'tts_voice_clone', text: '你好', refText: '参考文本', refAudio: aud, seed: '1' });
    expect(p).toEqual({
      workflowId: 'tts_voice_clone',
      params: { text: '你好', ref_text: '参考文本', seed: '1' },
      files: { audio_0: aud },
    });
  });
  it('省略 seed 不上送', () => {
    const p = buildTtsClonePayload({ workflowId: 'tts_voice_clone', text: '你好', refText: '参考文本', refAudio: aud });
    expect(p.params).toEqual({ text: '你好', ref_text: '参考文本' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation\server" ; npx vitest run src/workflows/bridge-client.test.ts`
Expected: FAIL —— `buildTtsClonePayload is not a function`

- [ ] **Step 3: 实现 —— 在 `bridge-client.ts` 的 `buildTtsPayload` 函数之后追加**

```ts
/**
 * TTS 音色克隆提交载荷。
 * @param args.workflowId Bridge 工作流 id
 * @param args.text 朗读文本
 * @param args.refText 参考音频的语音内容文字
 * @param args.refAudio 参考音频文件（multipart 文件 key audio_0）
 * @param args.seed 随机种子（可选）
 */
export function buildTtsClonePayload(args: {
  workflowId: string;
  text: string;
  refText: string;
  refAudio: File;
  seed?: string;
  extraParams?: Record<string, unknown>;
}): BridgeExecutePayload {
  const params: Record<string, unknown> = { ...(args.extraParams ?? {}), text: args.text, ref_text: args.refText };
  if (args.seed != null) params.seed = args.seed;
  return { workflowId: args.workflowId, params, files: { audio_0: args.refAudio } };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation\server" ; npx vitest run src/workflows/bridge-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

提交信息内容：
```
feat: bridge-client 新增 buildTtsClonePayload（文件 key audio_0）
```
git add：`server/src/workflows/bridge-client.ts server/src/workflows/bridge-client.test.ts`

---

### Task 4: bridge-sync ttsCloneSubmit（TDD）

**Files:**
- Test: `server/src/workflows/bridge-sync.test.ts`
- Modify: `server/src/workflows/bridge-sync.ts`

- [ ] **Step 1: 写失败测试 —— 在 `bridge-sync.test.ts` 文件末尾追加 describe 块**

```ts
describe('buildSubmit（tts-voice-clone）', () => {
  it('读取 text/refText/refAudioPath 并执行 execute（文件 audio_0）', async () => {
    const execute = vi.fn(async () => ({ taskId: 't' }));
    const submit = buildSubmit('tts_voice_clone', 'tts-voice-clone', { cancelable: true });
    const refAudio = new File([], 'ref.flac');
    const ctx = {
      vars: { text: '你好', refText: '参考文本', refAudioPath: '["assert/custom/ref.flac"]' },
      projectConfig: { width: 1080, height: 1920 },
      readAssertFile: async () => refAudio,
      provider: { execute },
    } as never;
    await submit(ctx as never);
    expect(execute).toHaveBeenCalledWith({
      workflowId: 'tts_voice_clone',
      params: expect.objectContaining({ text: '你好', ref_text: '参考文本' }),
      files: { audio_0: refAudio },
    });
  });

  it('缺少 text/refText/refAudioPath 报错', async () => {
    const execute = vi.fn(async () => ({ taskId: 't' }));
    const submit = buildSubmit('tts_voice_clone', 'tts-voice-clone', { cancelable: true });
    const mk = (vars: Record<string, string | undefined>) => ({
      vars, projectConfig: { width: 1080, height: 1920 }, readAssertFile: async () => new File([], 'a.flac'), provider: { execute },
    } as never);
    await expect(submit(mk({ text: '', refText: 'r', refAudioPath: '["a.flac"]' }) as never)).rejects.toThrow(/需要 vars.text/);
    await expect(submit(mk({ text: 't', refText: '', refAudioPath: '["a.flac"]' }) as never)).rejects.toThrow(/需要 vars.refText/);
    await expect(submit(mk({ text: 't', refText: 'r', refAudioPath: '["a.flac","b.flac"]' }) as never)).rejects.toThrow(/恰好 1 个参考音频/);
    await expect(submit(mk({ text: 't', refText: 'r', refAudioPath: '[]' }) as never)).rejects.toThrow(/恰好 1 个参考音频/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation\server" ; npx vitest run src/workflows/bridge-sync.test.ts`
Expected: FAIL —— `submit is not a function`（buildSubmit 的 switch 尚无 tts-voice-clone case，返回 undefined）

- [ ] **Step 3: 实现 —— 修改 `bridge-sync.ts`**

① import 增加 `buildTtsClonePayload`：
原：
```ts
import {
  buildDirectorPayload,
  buildFirstLastFramePayload,
  buildImageEditPayload,
  buildReferencePayload,
  buildTextToImagePayload,
  buildTtsPayload,
  resolveImageEditSizeParams,
} from './bridge-client.js';
```
改：
```ts
import {
  buildDirectorPayload,
  buildFirstLastFramePayload,
  buildImageEditPayload,
  buildReferencePayload,
  buildTextToImagePayload,
  buildTtsPayload,
  buildTtsClonePayload,
  resolveImageEditSizeParams,
} from './bridge-client.js';
```

② 在 `ttsSubmit` 函数之后追加 `ttsCloneSubmit`：
```ts
/**
 * TTS 音色克隆提交实现。
 *
 * text（朗读文本）与 refText（参考音频文字内容）来自 vars；refAudioPath 为 JSON 数组
 * 字符串（与 imagePaths 同约定），须恰好 1 个音频路径，经 ctx.readAssertFile 读取后
 * 以文件 key audio_0 上传。
 *
 * @param workflowId Bridge 工作流 id（原始 id，不含 ceb- 前缀），透传给 Bridge execute
 * @returns 动态工作流 submit 函数
 */
function ttsCloneSubmit(workflowId: string): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<WorkflowVarsBase>) => {
    const vars = ctx.vars as Record<string, string | undefined>;
    const text = (vars.text ?? '').trim();
    const refText = (vars.refText ?? '').trim();
    if (!text) throw new Error('tts-voice-clone 需要 vars.text（朗读文本）');
    if (!refText) throw new Error('tts-voice-clone 需要 vars.refText（参考音频文字内容）');
    let paths: string[] = [];
    try {
      const parsed = JSON.parse(vars.refAudioPath ?? '[]') as unknown;
      if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) throw new Error('refAudioPath 须为字符串数组');
      paths = parsed.map((p) => p.trim()).filter(Boolean);
    } catch (e) {
      throw new Error(`tts-voice-clone refAudioPath 无效: ${vars.refAudioPath}; ${e instanceof Error ? e.message : String(e)}`);
    }
    if (paths.length !== 1) throw new Error('tts-voice-clone 需要恰好 1 个参考音频（vars.refAudioPath）');
    const refAudio = await ctx.readAssertFile(paths[0]);
    const extraParams = passthroughParams(ctx, TTS_STRUCTURAL_KEYS);
    return ctx.provider.execute(buildTtsClonePayload({ workflowId, text, refText, refAudio, seed: vars.seed, extraParams }));
  };
}
```

③ `buildSubmit` 的 switch 增加 case：
原：
```ts
  switch (type) {
    case 'text-to-image': return textToImageSubmit(workflowId);
    case 'image-edit': return imageEditSubmit(workflowId);
    case 'tts-voice-design': return ttsSubmit(workflowId);
    case 'image-to-video': return videoSubmit(workflowId, caps);
  }
```
改：
```ts
  switch (type) {
    case 'text-to-image': return textToImageSubmit(workflowId);
    case 'image-edit': return imageEditSubmit(workflowId);
    case 'tts-voice-design': return ttsSubmit(workflowId);
    case 'tts-voice-clone': return ttsCloneSubmit(workflowId);
    case 'image-to-video': return videoSubmit(workflowId, caps);
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation\server" ; npx vitest run src/workflows/bridge-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

提交信息内容：
```
feat: bridge-sync 新增 tts-voice-clone 提交实现
```
git add：`server/src/workflows/bridge-sync.ts server/src/workflows/bridge-sync.test.ts`

---

### Task 5: 文档更新

**Files:**
- Modify: `docs/bridge-workflow-fields.md`

- [ ] **Step 1: 在「三、TTS 音色设计 tts-voice-design」章节之后插入新章节**

```markdown
---

## 三·B、TTS 音色克隆 tts-voice-clone

| 项 | 字段 |
|---|---|
| params | `text`（朗读文本）、`ref_text`（参考音频文字内容）、`seed?` |
| 文件 | `audio_0`（参考音频） |

- 画布「TTS声音生成」节点音色克隆模式使用；参考音频以文件 key `audio_0` 上传。
```

- [ ] **Step 2: Commit**

提交信息内容：
```
docs: 补充 tts-voice-clone 字段约定
```
git add：`docs/bridge-workflow-fields.md`

---

### Task 6: 前端 registry 新增 tts-generate 原型（TDD）

**Files:**
- Test: `frontend/src/canvas/registry.test.ts`
- Modify: `frontend/src/canvas/registry.ts`

- [ ] **Step 1: 写失败测试 —— 修改 `frontend/src/canvas/registry.test.ts`**

① 更新「包含八个内置节点」用例为九个（id 排序插入 `'tts-generate'`）：
原：
```ts
  it('包含八个内置节点', () => {
    expect(NODE_PROTOTYPES.map((p) => p.id).sort()).toEqual([
      'audio-loader',
      'image-generate',
      'image-loader',
      'text',
      'video-concat',
      'video-frame-extract',
      'video-generate',
      'video-loader',
    ])
  })
```
改：
```ts
  it('包含九个内置节点', () => {
    expect(NODE_PROTOTYPES.map((p) => p.id).sort()).toEqual([
      'audio-loader',
      'image-generate',
      'image-loader',
      'text',
      'tts-generate',
      'video-concat',
      'video-frame-extract',
      'video-generate',
      'video-loader',
    ])
  })
```

② 在 `describe('音频/视频加载节点原型')` 块之后追加：
```ts
describe('TTS 声音生成节点原型', () => {
  it('audio 输入、audio 输出、默认配置与 current.path 解析', () => {
    const p = getPrototype('tts-generate')!
    expect(p.name).toBe('TTS声音生成')
    expect(p.inputPorts[0]?.type).toBe('audio')
    expect(p.outputPorts[0]?.type).toBe('audio')
    expect(p.defaultConfig).toMatchObject({ mode: 'design', text: '', refText: '', prompt: '' })
    expect(p.getOutputAssetPath?.({ current: { path: 'assert/scene/1/1/canvas/tts/v1.flac' } })).toBe('assert/scene/1/1/canvas/tts/v1.flac')
    expect(p.getOutputAssetPath?.({})).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation\frontend" ; npx vitest run src/canvas/registry.test.ts`
Expected: FAIL —— 节点数不匹配 / `getPrototype('tts-generate')` 为 undefined

- [ ] **Step 3: 实现 —— 修改 `frontend/src/canvas/registry.ts`**

① import 增加两个新组件：
原：
```ts
import ConcatVideoNode from '../components/canvas/nodes/ConcatVideoNode.vue'
```
改：
```ts
import ConcatVideoNode from '../components/canvas/nodes/ConcatVideoNode.vue'
import TtsGenerateNode from '../components/canvas/nodes/TtsGenerateNode.vue'
```
原：
```ts
import ConcatVideoEditor from '../components/canvas/editors/ConcatVideoEditor.vue'
```
改：
```ts
import ConcatVideoEditor from '../components/canvas/editors/ConcatVideoEditor.vue'
import TtsGenerateEditor from '../components/canvas/editors/TtsGenerateEditor.vue'
```

② 在 `video-generate` 原型之后插入 `tts-generate` 原型：
```ts
  {
    id: 'tts-generate',
    name: 'TTS声音生成',
    icon: 'mdi-voice',
    // 音频输入（可选）：音色克隆模式下作为参考音色；音色设计模式无需输入
    inputPorts: [{ id: 'in', type: 'audio', label: '参考音频' }],
    outputPorts: [{ id: 'out', type: 'audio', label: '音频' }],
    resizeable: true,
    bodyComponent: TtsGenerateNode,
    editorComponent: TtsGenerateEditor,
    getOutputAssetPath: generateOutput,
    defaultConfig: {
      mode: 'design', // 'clone' | 'design'，编辑器切换
      workflowImpl: undefined,
      workflowParams: {},
      text: '',
      refText: '',
      prompt: '',
    },
  },
```

- [ ] **Step 4: 运行测试确认通过**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation\frontend" ; npx vitest run src/canvas/registry.test.ts`
Expected: PASS

- [ ] **Step 5: 类型检查**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation" ; npm run typecheck:frontend`
Expected: 无错误（TtsGenerateNode.vue / TtsGenerateEditor.vue 尚未创建，此时应出现找不到模块错误 → **先执行 Task 8 与 Task 9 创建组件后**再回到本步骤验证；或将本步骤推迟到 Task 9 之后统一验证）

> 说明：Step 3 引用了尚未创建的两个 .vue 组件，类型检查会报找不到模块。可先创建占位组件（Task 8/9 的完整内容）再验证；若按顺序执行，把本步骤的验证合并到 Task 9 的 Step 2 一起做。

- [ ] **Step 6: Commit**

提交信息内容：
```
feat: 画布新增 TTS声音生成节点原型
```
git add：`frontend/src/canvas/registry.ts frontend/src/canvas/registry.test.ts`

---

### Task 7: useCanvasGeneration 生成分支（TDD）

**Files:**
- Test: `frontend/src/canvas/useCanvasGeneration.test.ts`
- Modify: `frontend/src/canvas/useCanvasGeneration.ts`

- [ ] **Step 1: 写失败测试 —— 在 `frontend/src/canvas/useCanvasGeneration.test.ts` 的「视频节点」测试块之后追加**

```ts
  it('TTS 声音生成（设计模式）：tts-voice-design + prompt/text + .flac 产物', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'tg', prototypeId: 'tts-generate', name: 'TTS声音生成', x: 0, y: 0, width: 240, height: 160,
      config: { mode: 'design', text: '你好', prompt: '温柔女声', workflowImpl: 'ceb-tts_voice_design' },
    }
    await gen.generate(node, () => {})
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'tts-voice-design',
        impl: 'ceb-tts_voice_design',
        params: expect.objectContaining({
          vars: expect.objectContaining({ text: '你好', prompt: '温柔女声' }),
          outputPath: 'assert/scene/1/1/canvas/tg/v1.flac',
        }),
      }),
    )
  })

  it('TTS 声音生成（克隆模式）：tts-voice-clone + refAudioPath + .flac 产物', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'tg', prototypeId: 'tts-generate', name: 'TTS声音生成', x: 0, y: 0, width: 240, height: 160,
      config: { mode: 'clone', text: '你好', refText: '参考文本', workflowImpl: 'ceb-tts_voice_clone' },
    }
    gen.setInputPaths('tg', ['assert/custom/ref.flac'])
    await gen.generate(node, () => {})
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'tts-voice-clone',
        impl: 'ceb-tts_voice_clone',
        params: expect.objectContaining({
          vars: expect.objectContaining({ text: '你好', refText: '参考文本', refAudioPath: '["assert/custom/ref.flac"]' }),
          outputPath: 'assert/scene/1/1/canvas/tg/v1.flac',
        }),
      }),
    )
  })

  it('TTS 声音生成（克隆模式）无音频输入：error 且不调用 runWorkflow', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'tg', prototypeId: 'tts-generate', name: 'TTS声音生成', x: 0, y: 0, width: 240, height: 160,
      config: { mode: 'clone', text: '你好', refText: '参考文本' },
    }
    await gen.generate(node, () => {})
    expect(runWorkflow).not.toHaveBeenCalled()
    expect(gen.statusByNode.value.tg?.status).toBe('error')
    expect(gen.statusByNode.value.tg?.errorMsg).toContain('需先连接音频输入')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation\frontend" ; npx vitest run src/canvas/useCanvasGeneration.test.ts`
Expected: FAIL —— tts-generate 分支未实现，落入默认图片逻辑（workflowId 为 text-to-image）

- [ ] **Step 3: 实现 —— 修改 `frontend/src/canvas/useCanvasGeneration.ts`**

① `computeOutputPath` 中 `video-concat` 分支之后追加 `.flac` 替换：
原：
```ts
    if (node.prototypeId === 'video-concat') {
      // 拼接视频产物扩展名替换为 .mp4（图片路径助手默认 .jpg）
      return base.replace(/\.jpg$/, '.mp4')
    }
    return base
```
改：
```ts
    if (node.prototypeId === 'video-concat') {
      // 拼接视频产物扩展名替换为 .mp4（图片路径助手默认 .jpg）
      return base.replace(/\.jpg$/, '.mp4')
    }
    if (node.prototypeId === 'tts-generate') {
      // TTS 产物扩展名替换为 .flac（音频）
      return base.replace(/\.jpg$/, '.flac')
    }
    return base
```

② `generate()` 中 video-generate 分支之后追加 tts-generate 分支（在 `const config = node.config` 之前）：
```ts
    // ── TTS 声音生成节点：按模式组装 vars ──
    if (node.prototypeId === 'tts-generate') {
      const mode = node.config.mode === 'clone' ? 'clone' : 'design'
      const text = String(node.config.text ?? '')
      const inputPaths = inputPathsRef.value[nodeId] ?? []
      if (mode === 'clone' && inputPaths.length < 1) {
        statusByNode.value[nodeId] = { status: 'error', errorMsg: '音色克隆需先连接音频输入作为参考音色' }
        return
      }
      const workflowId = mode === 'clone' ? 'tts-voice-clone' : 'tts-voice-design'
      const vars: Record<string, string> =
        mode === 'clone'
          ? { text, refText: String(node.config.refText ?? ''), refAudioPath: JSON.stringify(inputPaths) }
          : { text, prompt: String(node.config.prompt ?? '') }
      const impl = String(node.config.workflowImpl ?? '')
      const outputPath = computeOutputPath(node)
      const userParams = (node.config.workflowParams as Record<string, WorkflowUserParamValue> | undefined) ?? {}
      statusByNode.value[nodeId] = { status: 'running' }
      try {
        const { taskId } = await runWorkflow({
          project,
          workflowId,
          impl,
          params: { vars, outputPath, userParams },
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

    const config = node.config
```

- [ ] **Step 4: 运行测试确认通过**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation\frontend" ; npx vitest run src/canvas/useCanvasGeneration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

提交信息内容：
```
feat: 画布 TTS 节点生成流程（克隆/设计模式、.flac 产物）
```
git add：`frontend/src/canvas/useCanvasGeneration.ts frontend/src/canvas/useCanvasGeneration.test.ts`

---

### Task 8: 节点卡片 TtsGenerateNode.vue

**Files:**
- Create: `frontend/src/components/canvas/nodes/TtsGenerateNode.vue`

- [ ] **Step 1: 创建组件文件（仿 `VideoGenerateNode.vue`，音频预览）**

```vue
<template>
  <div class="tts-generate-node">
    <template v-if="audioUrl">
      <audio
        :src="audioUrl"
        controls
        class="tts-generate-node__audio"
      />
    </template>
    <template v-else>
      <div class="tts-generate-node__empty">
        <v-icon
          icon="mdi-voice"
          size="large"
        />
        <div class="text-body-small text-medium-emphasis">
          未生成音频
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'

/** TTS 声音生成节点 body：音频预览 + 未生成占位（状态角标由 AssetCanvas 统一渲染） */
const props = defineProps<{
  project: string
  node: CanvasNodeData
}>()

const audioUrl = ref('')
const current = computed(() => props.node.config.current as { path?: string } | undefined)

watch(
  current,
  (c) => {
    audioUrl.value = c?.path ? buildPreviewUrl(props.project, c.path) : ''
  },
  { immediate: true },
)
</script>

<style scoped>
.tts-generate-node__audio {
  width: 100%;
  max-height: 200px;
}

.tts-generate-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
}
</style>
```

- [ ] **Step 2: Commit**

提交信息内容：
```
feat: 新增 TTS声音生成节点卡片组件
```
git add：`frontend/src/components/canvas/nodes/TtsGenerateNode.vue`

---

### Task 9: 配置面板 TtsGenerateEditor.vue

**Files:**
- Create: `frontend/src/components/canvas/editors/TtsGenerateEditor.vue`

- [ ] **Step 1: 创建组件文件（仿 `ImageGenerateEditor.vue`，双模式）**

```vue
<template>
  <div class="tts-generate-editor">
    <v-radio-group
      :model-value="mode"
      inline
      density="compact"
      hide-details
      class="mb-1"
      @update:model-value="onModeChange"
    >
      <v-radio
        label="音色克隆"
        value="clone"
      />
      <v-radio
        label="音色设计"
        value="design"
      />
    </v-radio-group>

    <div class="text-body-small text-medium-emphasis mb-2">
      <template v-if="mode === 'clone'">
        参考音频（{{ inputs.length }}）：
        <span v-if="inputs.length">已连接，将作为克隆音色参考</span>
        <span
          v-else
          class="text-error"
        >需先连接「加载音频」节点</span>
      </template>
      <template v-else>
        音色设计无需参考音频
      </template>
    </div>

    <template v-if="mode === 'clone'">
      <v-textarea
        :model-value="text"
        label="朗读文本 Text"
        rows="3"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => emit('update:config', { text: v })"
      />
      <v-textarea
        :model-value="refText"
        label="参考音频文字内容 RefText"
        rows="2"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => emit('update:config', { refText: v })"
      />
    </template>
    <template v-else>
      <v-textarea
        :model-value="prompt"
        label="声线描述 Prompt"
        rows="2"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => emit('update:config', { prompt: v })"
      />
      <v-textarea
        :model-value="text"
        label="朗读文本 Text"
        rows="3"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => emit('update:config', { text: v })"
      />
    </template>

    <v-select
      :model-value="currentImplId"
      :items="implItems"
      item-title="label"
      item-value="value"
      :label="mode === 'clone' ? '克隆工作流实现' : '设计工作流实现'"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="onImplChange"
    />

    <WorkflowParamsForm
      v-model="workflowParams"
      :declarations="currentDeclarations"
      :project="props.project"
    />

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
        历史 ({{ history.length }})
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getWorkflows, type WorkflowInfo, type WorkflowUserParamValue } from '../../../api/workflow'
import type { CanvasNodeData } from '../../../canvas/types'
import { getHistory, type CanvasInputInfo } from '../../../canvas/generate'
import WorkflowParamsForm from '../../WorkflowParamsForm.vue'

const props = defineProps<{
  project: string
  node: CanvasNodeData
  inputs: CanvasInputInfo[]
  isRunning: boolean
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'open-history', nodeId: string): void
}>()

const workflows = ref<WorkflowInfo[]>([])

const mode = computed(() => (props.node.config.mode === 'clone' ? 'clone' : 'design'))
const text = computed(() => (typeof props.node.config.text === 'string' ? props.node.config.text : ''))
const refText = computed(() => (typeof props.node.config.refText === 'string' ? props.node.config.refText : ''))
const prompt = computed(() => (typeof props.node.config.prompt === 'string' ? props.node.config.prompt : ''))
const history = computed(() => getHistory(props.node.config))
const workflowParams = ref<Record<string, WorkflowUserParamValue>>({})

const workflowId = computed(() => (mode.value === 'clone' ? 'tts-voice-clone' : 'tts-voice-design'))

const currentWorkflow = computed(() => workflows.value.find((w) => w.type === workflowId.value))

const implItems = computed(() =>
  (currentWorkflow.value?.implementations ?? []).map((i) => ({ value: i.impl, label: i.name })),
)

const currentImplId = computed(() => {
  const impl = props.node.config.workflowImpl
  if (typeof impl === 'string' && implItems.value.some((i) => i.value === impl)) return impl
  return implItems.value[0]?.value ?? ''
})

/** 克隆模式未连接音频输入时禁用生成 */
const canGenerate = computed(() => !(mode.value === 'clone' && props.inputs.length < 1))

const currentDeclarations = computed(() => {
  const impl = (currentWorkflow.value?.implementations ?? []).find((i) => i.impl === currentImplId.value)
  return impl?.params ?? []
})

function onModeChange(v: string) {
  emit('update:config', { mode: v, workflowImpl: undefined, workflowParams: {} })
}

function onImplChange(v: string) {
  emit('update:config', { workflowImpl: v, workflowParams: {} })
}

watch(
  () => props.node.config.workflowParams,
  (v) => {
    if (v && typeof v === 'object') workflowParams.value = { ...(v as Record<string, WorkflowUserParamValue>) }
  },
  { immediate: true, deep: true },
)

watch(
  workflowParams,
  (v) => {
    const cur = props.node.config.workflowParams
    const same = cur != null && typeof cur === 'object' && JSON.stringify(cur) === JSON.stringify(v)
    if (!same) emit('update:config', { workflowParams: v })
  },
)

getWorkflows()
</script>
```

- [ ] **Step 2: 类型检查（同时覆盖 Task 6 引用的组件）**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation" ; npm run typecheck:frontend`
Expected: 无错误，退出码 0

- [ ] **Step 3: Commit**

提交信息内容：
```
feat: 新增 TTS声音生成节点配置面板（克隆/设计双模式）
```
git add：`frontend/src/components/canvas/editors/TtsGenerateEditor.vue`

---

### Task 10: AssetCanvas generateNode 分支

**Files:**
- Modify: `frontend/src/components/canvas/AssetCanvas.vue`

- [ ] **Step 1: 在 `generateNode` 的 video-generate 分支之后、`if (node.prototypeId !== 'image-generate') return` 之前插入 tts-generate 分支**

原：
```ts
  if (node.prototypeId === 'video-generate') {
    const videoParams = buildVideoSubmitParams(node, {
      images: videoInputsOf(nodeId, 'image'),
      videos: videoInputsOf(nodeId, 'video'),
      audios: videoInputsOf(nodeId, 'audio'),
    })
    await gen.generate(
      node,
      (config) => {
        store.updateNode(nodeId, { config })
      },
      videoParams,
    )
    return
  }
  if (node.prototypeId !== 'image-generate') return
```
改：
```ts
  if (node.prototypeId === 'video-generate') {
    const videoParams = buildVideoSubmitParams(node, {
      images: videoInputsOf(nodeId, 'image'),
      videos: videoInputsOf(nodeId, 'video'),
      audios: videoInputsOf(nodeId, 'audio'),
    })
    await gen.generate(
      node,
      (config) => {
        store.updateNode(nodeId, { config })
      },
      videoParams,
    )
    return
  }
  if (node.prototypeId === 'tts-generate') {
    // TTS 声音生成：收集音频输入路径（克隆模式参考音色）后走通用生成流程
    const paths = collectInputPaths(nodeId, store.connections.value, store.nodes.value, node.config)
    gen.setInputPaths(nodeId, paths)
    await gen.generate(node, (config) => {
      store.updateNode(nodeId, { config })
    })
    return
  }
  if (node.prototypeId !== 'image-generate') return
```

- [ ] **Step 2: 类型检查**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation" ; npm run typecheck:frontend`
Expected: 无错误，退出码 0

- [ ] **Step 3: Commit**

提交信息内容：
```
feat: AssetCanvas 接入 TTS声音生成节点生成
```
git add：`frontend/src/components/canvas/AssetCanvas.vue`

---

### Task 11: 整体验证与收尾

**Files:**
- 无（仅验证 + 文档）

- [ ] **Step 1: 全局类型检查**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation" ; npm run typecheck`
Expected: 无错误，退出码 0

- [ ] **Step 2: ESLint**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation" ; npm run lint`
Expected: 无错误（如有既有 warning 可忽略，无新增 error）

- [ ] **Step 3: 服务端全部单测**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation\server" ; npx vitest run`
Expected: 全部 PASS（含新增的 derive/client/sync 用例）

- [ ] **Step 4: 前端全部单测**

Run（sync）：`cd "c:\Users\xiaotao\code\ai-video-workstation\frontend" ; npx vitest run`
Expected: 全部 PASS（含 registry / useCanvasGeneration 新增用例）

- [ ] **Step 5: 浏览器手工验证（可选但推荐）**

1. 启动 `npm run dev`，确认 Bridge 工作流列表中带 `tts-voice-clone` 标签的工作流被自动注册（`GET /api/workflows` 中出现 `type: tts-voice-clone`）。
2. 打开分镜/场景详情页「资产画布」Tab，双击空白添加「TTS声音生成」节点。
3. 设计模式：填声线描述 + 朗读文本 → 生成 → 产物 `.flac` 回写 current/history，卡片出现音频播放器。
4. 克隆模式：连一个「加载音频」节点 → 填朗读文本 + 参考音频文字内容 → 生成 → 产物 `.flac`；断开音频连线时「生成」按钮禁用。

- [ ] **Step 6: Commit**

提交信息内容：
```
docs: 新增 TTS 音色克隆与画布 TTS 节点实施计划
```
git add：`docs/superpowers/plans/2026-08-13-tts-voice-clone.md`

---

## 自审记录（写入时执行）

- **规格覆盖**：规格 §4.1/4.2 → Task 1；§4.3 → Task 2；§4.4 → Task 3；§4.5 → Task 4；§4.6 → Task 5；§5.1/5.2 → Task 6/9；§5.3 → Task 7；§5.4 → Task 8；§5.5 → Task 10；§5.6/§6/§7 → Task 11。无遗漏。
- **占位符扫描**：所有步骤含完整代码或明确命令，无 TBD/TODO。
- **类型一致性**：服务端统一用 `TtsVoiceCloneVars`（text/refText/refAudioPath）、`buildTtsClonePayload`、`ttsCloneSubmit`；前端统一用 `tts-generate` 原型 id、`mode: 'clone'|'design'`、字段 `text/refText/prompt/workflowImpl/workflowParams`，与规格一致。
