# 资产画布 · 衍生变体自动搭画布 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复分镜画布对衍生变体引用的路径解析，并让场景画布按「一个子场景一个画布」自动搭建包含全部衍生变体的节点结构，同时让资产选择器支持选择指定集数分镜的场景图。

**Architecture:** 纯逻辑集中在 `frontend/src/canvas/`（`autobuild.ts` 引用解析与子场景搭画布、`paths.ts`/`api.ts` 增加子场景 label 维度），UI 胶水在 `AssetCanvas.vue`（label 入口、空状态、prev 解析、变体收集）与 `AssetPickerDialog.vue`（分镜场景图集数/分镜下拉）。

**Tech Stack:** Vue 3 + Vuetify 3 + TypeScript + Vitest；服务端无改动（路径解析逻辑对齐 `server/src/workflow-engine.ts` 的既有规范实现）。

**Spec:** `docs/superpowers/specs/2026-08-04-asset-canvas-variant-autobuild-design.md`

**提交规范（AGENTS.md）：** 提交信息用中文；PowerShell 下用 UTF-8 临时文件 `-F` 方式提交：
```powershell
$f = "$env:TEMP\cm.txt"; [System.IO.File]::WriteAllText($f, "<提交信息>", [System.Text.UTF8Encoding]::new($false)); git add <files>; git commit -F $f; Remove-Item $f; cmd /c "git log -1 --format=%B"
```

**测试命令：** `cd frontend && npm test`（单测）；`npm run typecheck`；`npm run lint`（在仓库根目录）。

---

### Task 1: `paths.ts` / `api.ts` / `useCanvasGeneration.ts` 增加子场景 label 维度

**Files:**
- Modify: `frontend/src/canvas/paths.ts`
- Modify: `frontend/src/canvas/api.ts`
- Modify: `frontend/src/canvas/useCanvasGeneration.ts`
- Test: `frontend/src/canvas/paths.test.ts`
- Test: `frontend/src/canvas/api.test.ts`

**Context:** 场景画布从现在「一个场景一个 `canvas.json`」改为「一个子场景一个 `canvas.json`」。需要给路径计算增加 label 维度。这是纯数据链路改动，后续 UI 任务依赖它。

- [ ] **Step 1: 更新 `paths.test.ts`，加入 label 维度的失败测试**

把 `paths.test.ts` 中场景相关断言改为带 label，并新增用例：

```ts
import { describe, expect, it } from 'vitest'
import { canvasAssetDir, canvasNodeAssetPath, sceneCanvasRelPath, stageCanvasRelPath } from './paths'

describe('stageCanvasRelPath', () => {
  it('返回场景画布定义路径（含子场景标签）', () => {
    expect(stageCanvasRelPath('便利店内部', '便利店内部-白天-平视-晴-收银台')).toBe(
      'prompt/stage/便利店内部/canvas/便利店内部-白天-平视-晴-收银台.json',
    )
  })
})

describe('sceneCanvasRelPath', () => {
  it('返回分镜画布定义路径', () => {
    expect(sceneCanvasRelPath('1', '3')).toBe('prompt/scene/1/3/canvas.json')
  })
})

describe('canvasAssetDir', () => {
  it('场景画布产物目录（含子场景标签）', () => {
    expect(canvasAssetDir({ kind: 'stage', primary: '便利店内部', label: '白天' })).toBe(
      'assert/stage/便利店内部/canvas/白天',
    )
  })

  it('分镜画布产物目录', () => {
    expect(canvasAssetDir({ kind: 'scene', primary: '1', secondary: '3' })).toBe('assert/scene/1/3/canvas')
  })
})

describe('canvasNodeAssetPath', () => {
  it('节点产物带版本号', () => {
    expect(canvasNodeAssetPath({ kind: 'scene', primary: '1', secondary: '3' }, 'node-a', 2)).toBe(
      'assert/scene/1/3/canvas/node-a/v2.jpg',
    )
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/canvas/paths.test.ts`
Expected: FAIL（`stageCanvasRelPath` 参数数量不符 / 路径断言不匹配）

- [ ] **Step 3: 修改 `paths.ts`**

`frontend/src/canvas/paths.ts` 全文替换为：

```ts
/**
 * 画布相关路径计算。
 * 画布定义文件存 prompt/ 下；生成产物存 assert/ 的画布子目录。
 */

/** 画布作用域：用于定位画布定义与产物目录 */
export interface CanvasScope {
  kind: 'stage' | 'scene'
  /** stage 时为场景名；scene 时为集数 */
  primary: string
  /** scene 时为分镜号 */
  secondary?: string
  /** stage 时为子场景标签（场景画布按子场景拆分） */
  label?: string
}

/** 场景画布定义文件：prompt/stage/{场景名}/canvas/{子场景标签}.json */
export function stageCanvasRelPath(stage: string, label: string): string {
  return `prompt/stage/${stage}/canvas/${label}.json`
}

/** 分镜画布定义文件：prompt/scene/{集数}/{分镜}/canvas.json */
export function sceneCanvasRelPath(episode: string, shot: string): string {
  return `prompt/scene/${episode}/${shot}/canvas.json`
}

/** 画布生成产物目录：assert/{scope}/canvas/ */
export function canvasAssetDir(scope: CanvasScope): string {
  if (scope.kind === 'stage') {
    return `assert/stage/${scope.primary}/canvas${scope.label ? `/${scope.label}` : ''}`
  }
  return `assert/scene/${scope.primary}/${scope.secondary ?? ''}/canvas`
}

/** 节点产物路径：assert/{scope}/canvas/{nodeId}/v{n}.jpg */
export function canvasNodeAssetPath(scope: CanvasScope, nodeId: string, version: number): string {
  return `${canvasAssetDir(scope)}/${nodeId}/v${version}.jpg`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/canvas/paths.test.ts`
Expected: PASS（6 个用例全过）

- [ ] **Step 5: 更新 `api.test.ts`，加入 label 失败测试**

`api.test.ts` 中 `canvasRelPath` 描述块改为：

```ts
describe('canvasRelPath', () => {
  it('场景画布路径（含子场景标签）', () => {
    expect(canvasRelPath({ kind: 'stage', stage: '街角', label: '白天' })).toBe('prompt/stage/街角/canvas/白天.json')
  })

  it('分镜画布路径', () => {
    expect(canvasRelPath({ kind: 'scene', episode: '2', shot: '5' })).toBe('prompt/scene/2/5/canvas.json')
  })

  it('缺少 stage 抛错', () => {
    expect(() => canvasRelPath({ kind: 'stage' })).toThrow()
  })

  it('场景画布缺少 label 抛错', () => {
    expect(() => canvasRelPath({ kind: 'stage', stage: '街角' })).toThrow()
  })

  it('缺少 episode/shot 抛错', () => {
    expect(() => canvasRelPath({ kind: 'scene', episode: '1' })).toThrow()
  })
})
```

- [ ] **Step 6: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/canvas/api.test.ts`
Expected: FAIL（`canvasRelPath` 场景画布路径断言不匹配 / 缺 label 未抛错）

- [ ] **Step 7: 修改 `api.ts`**

`frontend/src/canvas/api.ts` 中 `CanvasTarget` 增加 `label` 字段，`canvasRelPath` 场景分支要求 label：

```ts
/** 画布目标：定位某张画布 */
export interface CanvasTarget {
  kind: CanvasKind
  /** stage 画布时的场景名 */
  stage?: string
  /** stage 画布时的子场景标签 */
  label?: string
  /** scene 画布时的集数 */
  episode?: string
  /** scene 画布时的分镜号 */
  shot?: string
}

/**
 * 计算画布定义文件的相对路径。
 *
 * @param target 画布目标
 * @returns 项目内相对路径
 * @throws Error 目标参数不完整时
 */
export function canvasRelPath(target: CanvasTarget): string {
  if (target.kind === 'stage') {
    if (!target.stage) throw new Error('场景画布需要 stage')
    if (!target.label) throw new Error('场景画布需要 label')
    return stageCanvasRelPath(target.stage, target.label)
  }
  if (!target.episode || !target.shot) throw new Error('分镜画布需要 episode 与 shot')
  return sceneCanvasRelPath(target.episode, target.shot)
}
```

- [ ] **Step 8: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/canvas/api.test.ts src/canvas/paths.test.ts`
Expected: PASS

- [ ] **Step 9: 修改 `useCanvasGeneration.ts` 支持 label**

`frontend/src/canvas/useCanvasGeneration.ts`：

1. `GenTarget` 增加 `label?: string`：
```ts
/** 生成目标（与画布目标一致） */
export interface GenTarget {
  kind: CanvasKind
  stage?: string
  episode?: string
  shot?: string
  /** stage 画布时的子场景标签 */
  label?: string
}
```

2. `computeOutputPath` 的 scope 构造改为：
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
    return canvasNodeAssetPath(scope, node.id, version)
  }
```

3. `computePromptPath` 的 stage 分支改为直接拼 label 目录（**注意**：原实现 `rel.replace(/canvas\.json$/, '')` 在带 label 时会丢掉 label，必须改写）：
```ts
  function computePromptPath(nodeId: string): string {
    if (targetRef.value.kind === 'stage') {
      return `prompt/stage/${targetRef.value.stage ?? ''}/canvas/${targetRef.value.label ?? ''}/${nodeId}/prompt.md`
    }
    const rel = sceneCanvasRelPath(targetRef.value.episode ?? '', targetRef.value.shot ?? '')
    const dir = rel.replace(/canvas\.json$/, '')
    return `${dir}canvas/${nodeId}/prompt.md`
  }
```

4. 移除不再使用的 `stageCanvasRelPath` import（`computePromptPath` 已改为硬编码拼路径，避免 lint 未使用报错）。文件顶部 import 改为：
```ts
import { canvasNodeAssetPath, sceneCanvasRelPath } from './paths'
```

- [ ] **Step 10: 修复其余受影响测试并全量跑测**

Run: `cd frontend && npm test`
Expected: 全过。若 `useCanvasStore.test.ts` / `useCanvasGeneration.test.ts` 等存在 `kind: 'stage'` 的目标对象且断言了旧路径，为其补上 `label` 字段（grep `kind: 'stage'` 排查）。

- [ ] **Step 11: 提交**

```powershell
$f = "$env:TEMP\cm.txt"; [System.IO.File]::WriteAllText($f, "feat: 画布路径支持子场景label维度", [System.Text.UTF8Encoding]::new($false)); git add frontend/src/canvas/paths.ts frontend/src/canvas/api.ts frontend/src/canvas/useCanvasGeneration.ts frontend/src/canvas/paths.test.ts frontend/src/canvas/api.test.ts; git commit -F $f; Remove-Item $f; cmd /c "git log -1 --format=%B"
```

---

### Task 2: `autobuild.ts` 引用解析纯函数（对齐服务端）

**Files:**
- Modify: `frontend/src/canvas/autobuild.ts`
- Test: `frontend/src/canvas/autobuild.test.ts`

**Context:** 分镜画布 `buildShotRefsFromStage` 目前把 `场景/标签@变体` 拼成错误路径，也不支持 `custom/` 与角色变体。本任务对齐 `server/src/workflow-engine.ts` 的 `resolveStageAssetPath` / `resolveCharacterAssetPath`。`prev` 由调用方（Task 4）异步解析，这里返回 null。

- [ ] **Step 1: 更新 `autobuild.test.ts`，写失败测试**

在 `frontend/src/canvas/autobuild.test.ts` 中新增（保留既有 `buildAutoCanvas`/`mergePrompt` 描述块）：

```ts
import { describe, expect, it } from 'vitest'
import { createCanvasData } from './types'
import {
  buildAutoCanvas,
  buildShotRefsFromStage,
  mergePrompt,
  resolveCharacterRef,
  resolveShotStageRef,
} from './autobuild'

describe('resolveShotStageRef', () => {
  it('基础场景引用', () => {
    expect(resolveShotStageRef('街角/白天')).toEqual({
      assetPath: 'assert/stage/街角/白天.jpg',
      label: '街角/白天',
    })
  })

  it('场景衍生变体引用', () => {
    expect(resolveShotStageRef('街角/白天@门已打开')).toEqual({
      assetPath: 'assert/stage/街角/variants/白天/门已打开.jpg',
      label: '街角/白天@门已打开',
    })
  })

  it('custom 引用（含扩展名原样透传）', () => {
    expect(resolveShotStageRef('custom/stage/商场门外/门已打开.png')).toEqual({
      assetPath: 'assert/custom/stage/商场门外/门已打开.png',
      label: 'custom/stage/商场门外/门已打开.png',
    })
  })

  it('prev 返回 null（由调用方异步解析）', () => {
    expect(resolveShotStageRef('prev')).toBeNull()
  })

  it('无效格式返回 null', () => {
    expect(resolveShotStageRef('')).toBeNull()
    expect(resolveShotStageRef('只有场景名')).toBeNull()
  })
})

describe('resolveCharacterRef', () => {
  it('基础角色引用', () => {
    expect(resolveCharacterRef('张三')).toEqual({
      assetPath: 'assert/character/张三/appearance.jpg',
      label: '张三',
    })
  })

  it('角色衍生变体引用', () => {
    expect(resolveCharacterRef('李四@变体1')).toEqual({
      assetPath: 'assert/character/李四/variants/变体1.jpg',
      label: '李四@变体1',
    })
  })

  it('custom 引用', () => {
    expect(resolveCharacterRef('custom/character/张三/道具.png')).toEqual({
      assetPath: 'assert/custom/character/张三/道具.png',
      label: 'custom/character/张三/道具.png',
    })
  })
})
```

同时**替换**既有 `buildShotRefsFromStage` 描述块为（加入变体与 custom 断言）：

```ts
describe('buildShotRefsFromStage', () => {
  it('提取角色与场景引用（含场景变体 / 角色变体 / custom）', () => {
    const refs = buildShotRefsFromStage([
      { 基础场景: '街角/白天', 登场角色: ['张三', '李四@变体1'] },
      { 基础场景: '街角/白天@门已打开' },
      { 基础场景: 'custom/stage/商场门外/门已打开.png' },
      { 基础场景: 'prev' },
    ])
    expect(refs).toEqual([
      { assetPath: 'assert/stage/街角/白天.jpg', label: '街角/白天' },
      { assetPath: 'assert/character/张三/appearance.jpg', label: '张三' },
      { assetPath: 'assert/character/李四/variants/变体1.jpg', label: '李四@变体1' },
      { assetPath: 'assert/stage/街角/variants/白天/门已打开.jpg', label: '街角/白天@门已打开' },
      { assetPath: 'assert/custom/stage/商场门外/门已打开.png', label: 'custom/stage/商场门外/门已打开.png' },
    ])
  })

  it('空定义返回空', () => {
    expect(buildShotRefsFromStage([])).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/canvas/autobuild.test.ts`
Expected: FAIL（`resolveShotStageRef`/`resolveCharacterRef` 不存在，`buildShotRefsFromStage` 变体断言不匹配）

- [ ] **Step 3: 修改 `autobuild.ts`**

在 `frontend/src/canvas/autobuild.ts` 中新增引用解析函数，并重写 `buildShotRefsFromStage`：

```ts
import { newId, type CanvasConnection, type CanvasData, type CanvasNodeData } from './types'

/** 引用解析结果 */
export interface RefResolution {
  /** 资产项目相对路径（assert/ 下） */
  assetPath: string
  /** 锚点节点显示名 */
  label: string
}

/**
 * 解析分镜 stage.json 的「基础场景」引用为 assert 路径（对齐服务端 resolveStageAssetPath）。
 * 支持：`场景/标签`、`场景/标签@变体`、`custom/{路径}`；prev 返回 null（由调用方异步解析）。
 *
 * @param baseStage 基础场景引用
 * @returns 解析结果或 null（prev / 空 / 格式无效）
 */
export function resolveShotStageRef(baseStage: string): RefResolution | null {
  const trimmed = baseStage.trim()
  if (!trimmed || trimmed === 'prev' || trimmed.startsWith('prev')) return null
  if (trimmed.startsWith('custom/')) {
    return { assetPath: `assert/custom/${trimmed.slice('custom/'.length)}`, label: trimmed }
  }
  const at = trimmed.indexOf('@')
  const main = at >= 0 ? trimmed.slice(0, at) : trimmed
  const variantId = at >= 0 ? trimmed.slice(at + 1).trim() : ''
  const slash = main.indexOf('/')
  if (slash <= 0 || slash === main.length - 1) return null
  const stageName = main.slice(0, slash)
  const stageLabel = main.slice(slash + 1)
  if (variantId) {
    return { assetPath: `assert/stage/${stageName}/variants/${stageLabel}/${variantId}.jpg`, label: trimmed }
  }
  return { assetPath: `assert/stage/${stageName}/${stageLabel}.jpg`, label: trimmed }
}

/**
 * 解析分镜 stage.json 的「登场角色」引用为 assert 路径（对齐服务端 resolveCharacterAssetPath）。
 * 支持：`角色名`、`角色名@变体`、`custom/{路径}`。
 *
 * @param character 角色引用
 * @returns 解析结果或 null（空 / 格式无效）
 */
export function resolveCharacterRef(character: string): RefResolution | null {
  const trimmed = character.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('custom/')) {
    return { assetPath: `assert/custom/${trimmed.slice('custom/'.length)}`, label: trimmed }
  }
  const at = trimmed.indexOf('@')
  if (at < 0) {
    return { assetPath: `assert/character/${trimmed}/appearance.jpg`, label: trimmed }
  }
  const name = trimmed.slice(0, at).trim()
  const variantId = trimmed.slice(at + 1).trim()
  if (!name || !variantId) return null
  return { assetPath: `assert/character/${name}/variants/${variantId}.jpg`, label: trimmed }
}
```

替换 `buildShotRefsFromStage` 实现为：

```ts
/** 从分镜 stage.json 提取自动搭画布引用（角色/场景；prev 由调用方另行解析） */
export function buildShotRefsFromStage(stageDefs: unknown[]): AutoBuildRef[] {
  const refs: AutoBuildRef[] = []
  for (const def of stageDefs ?? []) {
    const d = def as { 基础场景?: string; 登场角色?: string[] }
    const shotRef = resolveShotStageRef(d.基础场景 ?? '')
    if (shotRef) refs.push({ assetPath: shotRef.assetPath, label: shotRef.label })
    for (const ch of d.登场角色 ?? []) {
      const charRef = resolveCharacterRef(ch)
      if (charRef) refs.push({ assetPath: charRef.assetPath, label: charRef.label })
    }
  }
  return refs
}
```

（`AutoBuildRef` 接口保留原样；`buildAutoCanvas` / `mergePrompt` 不动。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/canvas/autobuild.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
$f = "$env:TEMP\cm.txt"; [System.IO.File]::WriteAllText($f, "feat: 画布自动搭引用解析对齐服务端（变体/custom/角色变体）", [System.Text.UTF8Encoding]::new($false)); git add frontend/src/canvas/autobuild.ts frontend/src/canvas/autobuild.test.ts; git commit -F $f; Remove-Item $f; cmd /c "git log -1 --format=%B"
```

---

### Task 3: `autobuild.ts` 新增 `buildSubSceneAutoCanvas` 纯函数

**Files:**
- Modify: `frontend/src/canvas/autobuild.ts`
- Test: `frontend/src/canvas/autobuild.test.ts`

**Context:** 场景画布按子场景搭建：基础加载图片节点 + 每个变体一个生成图片节点 + 变体 refs 加载图片节点。幂等：加载节点按 `config.assetPath`、生成节点按 `config.autoRef`（`stage:{label}@{id}`）判重；已存在节点补缺连线。

- [ ] **Step 1: 在 `autobuild.test.ts` 写失败测试**

在 `frontend/src/canvas/autobuild.test.ts` 中新增：

```ts
import { buildSubSceneAutoCanvas, type StageVariantRef } from './autobuild'

describe('buildSubSceneAutoCanvas', () => {
  const base = 'assert/stage/街角/白天.jpg'

  it('空画布全搭：基础加载节点 + 每变体生成节点 + 连线', () => {
    const data = createCanvasData('stage')
    const variants: StageVariantRef[] = [
      { id: '门已打开', desc: '将门打开', refs: [] },
      { id: '夜间', desc: '改为夜晚', refs: [] },
    ]
    const r = buildSubSceneAutoCanvas(data, '白天', base, variants, 80, 80)
    // 1 基础加载 + 2 生成
    expect(r.nodes).toHaveLength(3)
    expect(r.nodes.filter((n) => n.prototypeId === 'image-loader')).toHaveLength(1)
    expect(r.nodes.filter((n) => n.prototypeId === 'image-generate')).toHaveLength(2)
    // 根变体都接到基础加载节点
    expect(r.connections).toHaveLength(2)
    const baseId = r.nodes.find((n) => n.config.assetPath === base)?.id
    expect(r.connections.every((c) => c.fromNodeId === baseId)).toBe(true)
    // 生成节点 prompt = desc，且带 autoRef
    const gen = r.nodes.find((n) => n.config.autoRef === 'stage:白天@门已打开')
    expect(gen?.config.prompt).toBe('将门打开')
  })

  it('嵌套变体接父变体生成节点', () => {
    const data = createCanvasData('stage')
    const variants: StageVariantRef[] = [
      { id: 'A', desc: 'A', refs: [] },
      { id: 'A2', desc: 'A 的子', parentId: 'A', refs: [] },
    ]
    const r = buildSubSceneAutoCanvas(data, '白天', base, variants, 80, 80)
    const aId = r.nodes.find((n) => n.config.autoRef === 'stage:白天@A')?.id
    const a2Id = r.nodes.find((n) => n.config.autoRef === 'stage:白天@A2')?.id
    const baseId = r.nodes.find((n) => n.config.assetPath === base)?.id
    expect(aId).toBeTruthy()
    expect(a2Id).toBeTruthy()
    // A → A2 连线存在
    expect(r.connections.some((c) => c.fromNodeId === aId && c.toNodeId === a2Id)).toBe(true)
    // A 接基础图
    expect(r.connections.some((c) => c.fromNodeId === baseId && c.toNodeId === aId)).toBe(true)
  })

  it('变体 refs 使用加载图片节点，同资产共享一个节点', () => {
    const data = createCanvasData('stage')
    const shared = 'assert/custom/道具/伞.png'
    const variants: StageVariantRef[] = [
      { id: 'A', desc: 'A', refs: [shared] },
      { id: 'B', desc: 'B', refs: [shared] },
    ]
    const r = buildSubSceneAutoCanvas(data, '白天', base, variants, 80, 80)
    // 基础加载 + 2 生成 + 1 共享 ref 加载
    expect(r.nodes).toHaveLength(4)
    const refLoaders = r.nodes.filter((n) => n.config.assetPath === shared)
    expect(refLoaders).toHaveLength(1)
    // ref 加载节点同时连到 A、B 两个生成节点
    const loaderId = refLoaders[0]?.id
    const aId = r.nodes.find((n) => n.config.autoRef === 'stage:白天@A')?.id
    const bId = r.nodes.find((n) => n.config.autoRef === 'stage:白天@B')?.id
    expect(r.connections.some((c) => c.fromNodeId === loaderId && c.toNodeId === aId)).toBe(true)
    expect(r.connections.some((c) => c.fromNodeId === loaderId && c.toNodeId === bId)).toBe(true)
  })

  it('幂等：应用一次后再调用不新增节点', () => {
    const data = createCanvasData('stage')
    const variants: StageVariantRef[] = [
      { id: '门已打开', desc: '开门', refs: [] },
      { id: 'A2', desc: 'A 的子', parentId: '门已打开', refs: [] },
    ]
    const first = buildSubSceneAutoCanvas(data, '白天', base, variants, 80, 80)
    const merged = createCanvasData('stage')
    merged.nodes = [...first.nodes]
    merged.connections = [...first.connections]
    const second = buildSubSceneAutoCanvas(merged, '白天', base, variants, 80, 80)
    expect(second.nodes).toHaveLength(0)
    expect(second.connections).toHaveLength(0)
  })

  it('已有生成节点但缺连线时补连', () => {
    const data = createCanvasData('stage')
    const variants: StageVariantRef[] = [{ id: 'A', desc: 'A', refs: [] }]
    const first = buildSubSceneAutoCanvas(data, '白天', base, variants, 80, 80)
    // 手动删除 first 里的连线，模拟「节点在、连线被删」
    const merged = createCanvasData('stage')
    merged.nodes = [...first.nodes]
    merged.connections = []
    const second = buildSubSceneAutoCanvas(merged, '白天', base, variants, 80, 80)
    expect(second.nodes).toHaveLength(0)
    expect(second.connections).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/canvas/autobuild.test.ts`
Expected: FAIL（`buildSubSceneAutoCanvas` 不存在）

- [ ] **Step 3: 实现 `buildSubSceneAutoCanvas`**

在 `frontend/src/canvas/autobuild.ts` 追加：

```ts
/** 子场景衍生变体元数据（读 prompt/stage/{stage}/variants/{label}/{id}.json） */
export interface StageVariantRef {
  /** 变体 id */
  id: string
  /** 衍生描述（生成节点 prompt） */
  desc: string
  /** 父变体 id（同 label 内，可选） */
  parentId?: string
  /** 额外引用资产路径（assert/ 开头，可选） */
  refs: string[]
}

/**
 * 自动搭「子场景画布」：基础加载图片节点 + 每个衍生变体一个生成图片节点 + 变体 refs 加载图片节点。
 * 连线规则：根变体 ← 基础加载节点；嵌套变体 ← 父变体生成节点；变体 refs ← 各自加载节点。
 * 幂等：加载节点按 config.assetPath、生成节点按 config.autoRef（stage:{label}@{id}）判重；
 * 已存在节点只补缺连线，不重复创建。
 *
 * @param data 现有画布（幂等判断）
 * @param label 子场景标签
 * @param baseAssetPath 子场景基础图路径（assert/stage/{stage}/{label}.jpg）
 * @param variants 变体元数据列表
 * @param x 基础加载节点 x
 * @param y 基础加载节点 y
 * @returns 应新增的节点与连线
 */
export function buildSubSceneAutoCanvas(
  data: CanvasData,
  label: string,
  baseAssetPath: string,
  variants: StageVariantRef[],
  x = 80,
  y = 80,
): AutoBuildResult {
  const nodes: CanvasNodeData[] = []
  const connections: CanvasConnection[] = []
  const existingPaths = new Set(
    data.nodes.map((n) => (typeof n.config.assetPath === 'string' ? n.config.assetPath : '')),
  )
  const hasConnection = (fromId: string, toId: string) =>
    data.connections.some((c) => c.fromNodeId === fromId && c.toNodeId === toId) ||
    connections.some((c) => c.fromNodeId === fromId && c.toNodeId === toId)
  const addConnection = (fromId: string, toId: string) => {
    if (fromId && toId && !hasConnection(fromId, toId)) {
      connections.push({ id: newId(), fromNodeId: fromId, fromPortId: 'out', toNodeId: toId, toPortId: 'in' })
    }
  }

  // 基础加载图片节点：只建一个，所有根变体共用
  let baseId = ''
  if (existingPaths.has(baseAssetPath)) {
    baseId = data.nodes.find((n) => n.config.assetPath === baseAssetPath)?.id ?? ''
  } else {
    const baseNode: CanvasNodeData = {
      id: newId(),
      prototypeId: 'image-loader',
      name: label,
      x,
      y,
      width: 220,
      height: 150,
      config: { assetPath: baseAssetPath },
    }
    nodes.push(baseNode)
    existingPaths.add(baseAssetPath)
    baseId = baseNode.id
  }

  // 每个变体一个生成图片节点（autoRef 幂等）
  const genIdByVariant = new Map<string, string>()
  let row = 0
  for (const v of variants) {
    const autoRef = `stage:${label}@${v.id}`
    const existing = data.nodes.find((n) => n.config.autoRef === autoRef)
    if (existing) {
      genIdByVariant.set(v.id, existing.id)
    } else {
      const genNode: CanvasNodeData = {
        id: newId(),
        prototypeId: 'image-generate',
        name: v.id,
        x: x + 320,
        y: y + row * 160,
        width: 240,
        height: 160,
        config: { prompt: v.desc, autoRef },
      }
      nodes.push(genNode)
      genIdByVariant.set(v.id, genNode.id)
      row += 1
    }
  }

  // 连线 + refs 加载节点（assetPath 共享）
  const refLoaderIds = new Map<string, string>()
  for (const v of variants) {
    const genId = genIdByVariant.get(v.id)
    if (!genId) continue
    const inputNodeId = v.parentId ? (genIdByVariant.get(v.parentId) ?? '') : baseId
    addConnection(inputNodeId, genId)
    for (const ref of v.refs) {
      let loaderId = refLoaderIds.get(ref)
      if (loaderId == null) {
        if (existingPaths.has(ref)) {
          loaderId = data.nodes.find((n) => n.config.assetPath === ref)?.id ?? ''
        } else {
          const loaderNode: CanvasNodeData = {
            id: newId(),
            prototypeId: 'image-loader',
            name: ref.split('/').pop() ?? ref,
            x: x + 640,
            y: y + row * 160,
            width: 220,
            height: 150,
            config: { assetPath: ref },
          }
          nodes.push(loaderNode)
          existingPaths.add(ref)
          loaderId = loaderNode.id
        }
        refLoaderIds.set(ref, loaderId)
      }
      addConnection(loaderId, genId)
    }
  }

  const firstGenId = genIdByVariant.values().next().value ?? ''
  return { nodes, connections, generateNodeId: firstGenId, prompt: '' }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/canvas/autobuild.test.ts`
Expected: PASS（新增 5 用例全过）

- [ ] **Step 5: 提交**

```powershell
$f = "$env:TEMP\cm.txt"; [System.IO.File]::WriteAllText($f, "feat: 新增子场景自动搭画布纯函数（变体结构+幂等）", [System.Text.UTF8Encoding]::new($false)); git add frontend/src/canvas/autobuild.ts frontend/src/canvas/autobuild.test.ts; git commit -F $f; Remove-Item $f; cmd /c "git log -1 --format=%B"
```

---

### Task 4: `AssetCanvas.vue` label 入口 + 空状态 + 分镜 prev 解析；`StagePanel.vue` 传 label

**Files:**
- Modify: `frontend/src/components/canvas/AssetCanvas.vue`
- Modify: `frontend/src/components/StagePanel.vue`

**Context:** 场景画布现在按子场景。`AssetCanvas` 需要新增 `label` prop；场景画布未选子场景时显示空状态；分镜画布 `collectRefs` 解析 `prev` 并改用新引用解析。

- [ ] **Step 1: `AssetCanvas.vue` 增加 `label` prop 与 target**

在 `frontend/src/components/canvas/AssetCanvas.vue` 中：

1. props 定义改为：
```ts
const props = defineProps<{
  project: string
  kind: 'stage' | 'scene'
  stage?: string
  /** 场景画布时的子场景标签 */
  label?: string
  episode?: string
  shot?: string
}>()
```

2. `target` computed 增加 `label`：
```ts
/** 画布目标（分镜画布需要 episode+shot，场景画布需要 stage+label） */
const target = computed(() => ({
  kind: props.kind,
  stage: props.stage,
  label: props.label,
  episode: props.episode,
  shot: props.shot,
}))
```

3. 新增空状态计算属性（放在 `target` 之后）：
```ts
/** 场景画布未选择子场景时显示空状态 */
const stageNoLabel = computed(() => props.kind === 'stage' && !props.label)
```

- [ ] **Step 2: 模板加空状态**

`AssetCanvas.vue` 模板：在根 `div.asset-canvas` 内最前面插入：

```html
    <div
      v-if="stageNoLabel"
      class="d-flex align-center justify-center text-grey"
      style="min-height: 200px;"
    >
      请从左侧资产浏览器选择子场景
    </div>
    <template v-else>
```

并把根 `div` 结束前（最后一个 `</v-snackbar>` 之后、根 `</div>` 之前）补上 `</template>`。

- [ ] **Step 3: 分镜 `collectRefs` 支持 prev 与变体引用**

替换 `AssetCanvas.vue` 中 `collectRefs` 的分镜分支（保留 `collectPrompt` 不动；stage 分支在 Task 5 处理）：

```ts
/**
 * 收集自动搭画布的资产引用：
 * - 分镜画布：读 stage.json 提取角色/场景引用（含变体/custom），并异步解析 prev
 * - 场景画布：见 collectStageBuild（Task 5）
 *
 * @returns 锚点引用列表
 */
async function collectRefs(): Promise<AutoBuildRef[]> {
  const t = target.value
  if (t.kind === 'scene') {
    if (!t.episode || !t.shot) return []
    const raw = await readFs(props.project, `prompt/scene/${t.episode}/${t.shot}/stage.json`)
    const defs = Array.isArray(raw) ? (raw as unknown[]) : []
    const refs = buildShotRefsFromStage(defs)
    // prev：同集上一分镜最后一项 → assert/scene/{ep}/{shot-1}/stage/{last}.jpg
    const shotNum = Number(t.shot)
    const hasPrev = defs.some((d) => {
      const base = (d as { 基础场景?: string })?.基础场景
      return typeof base === 'string' && base.startsWith('prev')
    })
    if (hasPrev && Number.isInteger(shotNum) && shotNum > 1) {
      const prevShot = String(shotNum - 1)
      try {
        const prevRaw = await readFs(props.project, `prompt/scene/${t.episode}/${prevShot}/stage.json`)
        if (Array.isArray(prevRaw) && prevRaw.length > 0) {
          refs.push({
            assetPath: `assert/scene/${t.episode}/${prevShot}/stage/${prevRaw.length - 1}.jpg`,
            label: '上一分镜场景图',
          })
        }
      } catch {
        // 读不到上一分镜定义则跳过 prev
      }
    }
    return refs
  }
  return []
}
```

- [ ] **Step 4: `StagePanel.vue` 传 label**

`frontend/src/components/StagePanel.vue` 中 `AssetCanvas` 调用改为：

```html
        <AssetCanvas
          :project="props.project"
          kind="stage"
          :stage="props.name"
          :label="props.subscene"
        />
```

- [ ] **Step 5: 类型检查与测试**

Run（仓库根）：`npm run typecheck`
Expected: 无错误

Run: `cd frontend && npm test`
Expected: 全过（Task 4 无新增单测，属 UI 胶水；若 typecheck 暴露 target 结构问题则修复）

- [ ] **Step 6: 提交**

```powershell
$f = "$env:TEMP\cm.txt"; [System.IO.File]::WriteAllText($f, "feat: 场景画布入口支持子场景label与空状态，分镜prev解析", [System.Text.UTF8Encoding]::new($false)); git add frontend/src/components/canvas/AssetCanvas.vue frontend/src/components/StagePanel.vue; git commit -F $f; Remove-Item $f; cmd /c "git log -1 --format=%B"
```

---

### Task 5: `AssetCanvas.vue` 场景分支变体收集 + autoBuild 集成 + `deriveStageFrameBody` 变体路径

**Files:**
- Modify: `frontend/src/components/canvas/AssetCanvas.vue`

**Context:** 场景画布自动搭画布改为：读子场景变体元数据 → `buildSubSceneAutoCanvas` → `applyNodes`。`deriveStageFrameBody` 补充变体输入路径解析，使「设为分镜场景图」能把变体图写为 `场景/标签@变体`。

- [ ] **Step 1: 修改 import**

`AssetCanvas.vue` 中 autobuild 导入行改为：

```ts
import {
  buildAutoCanvas,
  buildShotRefsFromStage,
  buildSubSceneAutoCanvas,
  type AutoBuildRef,
  type StageVariantRef,
} from '../../canvas/autobuild'
```

- [ ] **Step 2: 新增 `collectStageBuild`，并清理 `collectPrompt`**

（`collectRefs` 已在 Task 4 重构为分镜专用，stage 返回 `[]`；本任务新增场景专用的 `collectStageBuild`。在 `collectRefs` 函数后追加新函数：）

```ts
/**
 * 收集场景画布自动搭所需数据：子场景基础图路径 + 该子场景全部衍生变体元数据。
 * 变体元数据：prompt/stage/{stage}/variants/{label}/{id}.json（desc/parentId/refs）。
 *
 * @returns 基础图路径与变体列表（variants 目录不存在时为空的变体列表）
 */
async function collectStageBuild(): Promise<{ baseAssetPath: string; variants: StageVariantRef[] }> {
  const t = target.value
  const stage = t.stage ?? ''
  const label = t.label ?? ''
  const baseAssetPath = `assert/stage/${stage}/${label}.jpg`
  const variants: StageVariantRef[] = []
  const variantsDir = `prompt/stage/${stage}/variants/${label}`
  try {
    const dir = (await readFs(props.project, variantsDir)) as DirResponse
    const metaFiles = (dir?.entries ?? []).filter((e) => e.type === 'file' && e.name.endsWith('.json'))
    for (const f of metaFiles) {
      const id = f.name.replace(/\.json$/, '')
      try {
        const meta = (await readFs(props.project, `${variantsDir}/${f.name}`)) as {
          desc?: string
          parentId?: string
          refs?: string[]
        }
        variants.push({
          id,
          desc: String(meta?.desc ?? ''),
          parentId: typeof meta?.parentId === 'string' ? meta.parentId : undefined,
          refs: Array.isArray(meta?.refs) ? (meta.refs as string[]) : [],
        })
      } catch {
        // 单个变体元数据读取失败则跳过
      }
    }
  } catch {
    // variants 目录不存在 → 无变体，只搭基础图
  }
  return { baseAssetPath, variants }
}
```

并替换 `collectPrompt` 为分镜专用（删除已废弃的场景分支；分镜画布才需要 collectPrompt）：

```ts
/**
 * 收集生成节点 prompt 初稿（仅分镜画布；场景画布由各变体 desc 提供）。
 *
 * @returns prompt 文本
 */
async function collectPrompt(): Promise<string> {
  const t = target.value
  if (t.kind !== 'scene' || !t.episode || !t.shot) return ''
  try {
    const raw = (await readFs(props.project, `prompt/scene/${t.episode}/${t.shot}/overview.json`)) as {
      visual?: unknown
    }
    return typeof raw?.visual === 'string' ? raw.visual : ''
  } catch {
    return ''
  }
}
```

- [ ] **Step 3: 重构 `autoBuild` 分场景/分镜分支**

`autoBuild` 改为：

```ts
/** 触发自动搭画布：分镜画布按 stage.json 引用；场景画布按子场景变体结构 */
async function autoBuild() {
  if (autoBuilding.value) return
  autoBuilding.value = true
  try {
    if (target.value.kind === 'stage') {
      const { baseAssetPath, variants } = await collectStageBuild()
      const result = buildSubSceneAutoCanvas(store.data.value, target.value.label ?? '', baseAssetPath, variants)
      store.applyNodes(result.nodes, result.connections)
      const anchorCount = result.nodes.filter((n) => n.prototypeId === 'image-loader').length
      showSnackbar(`已搭建 ${anchorCount} 个锚点节点`, 'success')
      return
    }
    const refs = await collectRefs()
    const prompt = await collectPrompt()
    const result = buildAutoCanvas(store.data.value, refs, prompt)
    store.applyNodes(result.nodes, result.connections)
    const g = nodeMap.value[result.generateNodeId]
    if (g) {
      store.updateNode(g.id, { config: { ...g.config, prompt: result.prompt } })
    }
    const anchorCount = result.nodes.filter((n) => n.prototypeId === 'image-loader').length
    showSnackbar(`已搭建 ${anchorCount} 个锚点节点`, 'success')
  } catch (e) {
    showSnackbar(e instanceof Error ? e.message : '自动搭画布失败', 'error')
  } finally {
    autoBuilding.value = false
  }
}
```

- [ ] **Step 4: `deriveStageFrameBody` 支持变体输入路径**

把 `AssetCanvas.vue` 的 `deriveStageFrameBody` 中 `assert/stage/` 分支替换为：

```ts
    if (inp.path.startsWith('assert/stage/')) {
      const rest = inp.path.slice('assert/stage/'.length).replace(/\.(jpg|jpeg|png|webp)$/i, '')
      // 变体路径：{场景}/variants/{标签}/{变体} → 基础场景 = {场景}/{标签}@{变体}
      const vIdx = rest.indexOf('/variants/')
      if (vIdx > 0) {
        const stageName = rest.slice(0, vIdx)
        const rest2 = rest.slice(vIdx + '/variants/'.length)
        const slash = rest2.indexOf('/')
        if (slash > 0) {
          const stageLabel = rest2.slice(0, slash)
          const variantId = rest2.slice(slash + 1)
          if (stageLabel && variantId && !baseScene) baseScene = `${stageName}/${stageLabel}@${variantId}`
        }
      } else {
        const idx = rest.lastIndexOf('/')
        if (idx > 0) {
          const name = rest.slice(0, idx)
          const label = rest.slice(idx + 1)
          if (name && label && !baseScene) baseScene = `${name}/${label}`
        }
      }
    } else if (inp.path.startsWith('assert/character/')) {
```

- [ ] **Step 5: 类型检查与测试**

Run（仓库根）：`npm run typecheck`
Expected: 无错误

Run: `cd frontend && npm test`
Expected: 全过

- [ ] **Step 6: 提交**

```powershell
$f = "$env:TEMP\cm.txt"; [System.IO.File]::WriteAllText($f, "feat: 场景画布自动搭变体结构，设为分镜场景图支持变体路径", [System.Text.UTF8Encoding]::new($false)); git add frontend/src/components/canvas/AssetCanvas.vue; git commit -F $f; Remove-Item $f; cmd /c "git log -1 --format=%B"
```

---

### Task 6: `AssetPickerDialog.vue` 分镜场景图集数/分镜下拉 + 画布选择器启用 scene-stage

**Files:**
- Modify: `frontend/src/components/AssetPickerDialog.vue`
- Modify: `frontend/src/components/canvas/AssetCanvas.vue`

**Context:** 「分镜场景图」页签目前只能显示当前上下文（`contextEpisode`/`contextShot`）的帧。改为支持选择任意集数/分镜：顶部加集数 + 分镜两个下拉，枚举 `prompt/scene/` 与 `prompt/scene/{ep}/` 的目录。页签可见性不再依赖 `hasSceneContext`。

- [ ] **Step 1: 模板：页签可见性 + 页签内下拉**

`AssetPickerDialog.vue` 模板：

1. 「分镜场景图」页签 Tab 条件从 `visibleTabs.includes('scene-stage') && hasSceneContext` 改为：
```html
        <v-tab
          v-if="visibleTabs.includes('scene-stage')"
          value="scene-stage"
        >
          分镜场景图
        </v-tab>
```

2. 「分镜场景图」内容块条件从 `activeTab === 'scene-stage' && visibleTabs.includes('scene-stage') && hasSceneContext` 改为：
```html
        <template v-else-if="activeTab === 'scene-stage' && visibleTabs.includes('scene-stage')">
```
并在其内容顶部（`<v-row v-if="sceneStages.length">` 之前）插入下拉与提示：

```html
          <div class="d-flex align-center ga-2 mb-3">
            <v-select
              v-model="sceneEp"
              :items="episodeOptions"
              label="集数"
              density="compact"
              hide-details
              style="width: 120px;"
              @update:model-value="onSceneEpChange"
            />
            <v-select
              v-model="sceneShot"
              :items="shotOptions"
              label="分镜"
              density="compact"
              hide-details
              style="width: 120px;"
              @update:model-value="loadSceneStages"
            />
          </div>
```

- [ ] **Step 2: script：新增状态与加载函数**

在 `AssetPickerDialog.vue` script 中新增：

```ts
/** 分镜场景图页签：当前选中的集数与分镜 */
const sceneEp = ref<string | null>(null)
const sceneShot = ref<string | null>(null)
/** 集数选项（prompt/scene/ 下的目录名） */
const episodeOptions = ref<string[]>([])
/** 分镜选项（prompt/scene/{ep}/ 下的目录名） */
const shotOptions = ref<string[]>([])

/** 初始化分镜场景图页签：默认选中上下文集数/分镜，并加载集数选项 */
async function initSceneStageTab() {
  if (props.contextEpisode) sceneEp.value = props.contextEpisode
  if (props.contextShot) sceneShot.value = props.contextShot
  try {
    const res = (await readFs(props.project, 'prompt/scene')) as DirResponse
    episodeOptions.value = (res?.entries ?? [])
      .filter((e: DirEntry) => e.type === 'dir')
      .map((e: DirEntry) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh', { numeric: true }))
  } catch {
    episodeOptions.value = []
  }
  await onSceneEpChange()
}

/** 集数变化：刷新分镜选项并加载场景帧 */
async function onSceneEpChange() {
  shotOptions.value = []
  if (sceneEp.value) {
    try {
      const res = (await readFs(props.project, `prompt/scene/${sceneEp.value}`)) as DirResponse
      shotOptions.value = (res?.entries ?? [])
        .filter((e: DirEntry) => e.type === 'dir')
        .map((e: DirEntry) => e.name)
        .sort((a, b) => a.localeCompare(b, 'zh', { numeric: true }))
    } catch {
      shotOptions.value = []
    }
  }
  await loadSceneStages()
}
```

- [ ] **Step 3: `loadSceneStages` 改为读取选中集数/分镜**

替换 `loadSceneStages` 为：

```ts
/**
 * 加载「分镜场景图」页签数据。
 *
 * 读取选中的 assert/scene/{集数}/{分镜}/stage/ 目录下的 {i}.jpg 场景帧，
 * 按帧序号展示为「分镜场景图 N」；未选集数/分镜或目录不存在时为空。
 */
async function loadSceneStages() {
  tabLoading.value = true
  sceneStages.value = []
  try {
    const ep = sceneEp.value
    const shot = sceneShot.value
    if (!ep || !shot) return
    const dir = `assert/scene/${ep}/${shot}/stage`
    const res = await readFs(props.project, dir).catch(() => null) as DirResponse | null
    const entries = res?.entries ?? []
    const images = entries
      .filter((e: DirEntry) => e.type === 'file' && /\.jpe?g$/i.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }))
    sceneStages.value = images.map((e: DirEntry) => {
      const idx = Number(e.name.replace(/\.[^.]+$/, ''))
      return {
        path: `${dir}/${e.name}`,
        label: Number.isFinite(idx) ? `分镜场景图 ${idx + 1}` : e.name,
        thumbnail: `/api/fs/${props.project}/${dir}/${e.name}?t=${ts()}`,
        depth: 0,
      }
    })
  } finally {
    tabLoading.value = false
  }
}
```

- [ ] **Step 4: 页签切换时初始化**

`onTabChange` 中 `scene-stage` 分支改为：

```ts
  } else if (activeTab.value === 'scene-stage') {
    await initSceneStageTab()
  }
```

- [ ] **Step 5: `AssetCanvas.vue` 选择器启用 scene-stage**

`AssetCanvas.vue` 的 `AssetPickerDialog` 调用改为：

```html
    <!-- 资产选择器（加载图片节点绑定资产） -->
    <AssetPickerDialog
      v-model="picker.show"
      :project="props.project"
      :multiple="false"
      :tabs="['stage', 'character', 'custom', 'scene-stage']"
      :context-episode="target.kind === 'scene' ? target.episode : undefined"
      :context-shot="target.kind === 'scene' ? target.shot : undefined"
      @update:selected="onPickerConfirm"
    />
```

- [ ] **Step 6: 类型检查**

Run（仓库根）：`npm run typecheck`
Expected: 无错误（`sceneEp`/`sceneShot` 为 `string | null`，`loadSceneStages` 内已做非空守卫；`v-model` 绑定 `v-select` 兼容 `string | null`）

- [ ] **Step 7: 提交**

```powershell
$f = "$env:TEMP\cm.txt"; [System.IO.File]::WriteAllText($f, "feat: 资产选择器分镜场景图支持选择任意集数分镜", [System.Text.UTF8Encoding]::new($false)); git add frontend/src/components/AssetPickerDialog.vue frontend/src/components/canvas/AssetCanvas.vue; git commit -F $f; Remove-Item $f; cmd /c "git log -1 --format=%B"
```

---

### Task 7: 更新 `docs/asset-canvas.md`

**Files:**
- Modify: `docs/asset-canvas.md`

**Context:** 文档中的画布文件路径、自动搭画布描述已过时。

- [ ] **Step 1: 更新 §2.1 表**

把「场景画布」行改为：

```
| 场景画布 | `prompt/stage/{场景名}/canvas/{子场景标签}.json` | `assert/stage/{场景名}/canvas/{子场景标签}/` |
```

- [ ] **Step 2: 更新 §9 自动搭画布**

替换 §9 内容为：

```markdown
## 9. 自动搭画布（`frontend/src/canvas/autobuild.ts`）

- 工具栏「自动搭画布」：
  - **分镜画布**：根据分镜 `stage.json` 收集引用（场景/角色/变体/custom，`prev` 异步解析为上一分镜最后一帧）→ 生成「加载图片锚点 + 生成图片」结构 → 幂等应用（不重复添加已有引用）。引用解析规则与 `server` 的 `resolveStageAssetPath` / `resolveCharacterAssetPath` 对齐（见 `resolveShotStageRef` / `resolveCharacterRef`）。
  - **场景画布（按子场景）**：读 `prompt/stage/{场景}/variants/{标签}/` 下全部 `{id}.json` 变体元数据 → `buildSubSceneAutoCanvas` 搭建「基础加载图片（所有根变体共用）+ 每个变体一个生成图片（prompt = desc，`config.autoRef` 幂等）+ 变体 refs 加载图片（同资产共享）」→ 幂等应用（已存在节点只补缺连线）。
- 生成节点 prompt：分镜画布取 `overview.json.visual`；场景画布各变体取各自 `desc`。
```

- [ ] **Step 3: 更新 §12 模块结构**

在 `autobuild.ts` 条目后补充说明（追加一行）：

```
# 注：autobuild.ts 另含 resolveShotStageRef / resolveCharacterRef / buildSubSceneAutoCanvas
```

- [ ] **Step 4: 提交**

```powershell
$f = "$env:TEMP\cm.txt"; [System.IO.File]::WriteAllText($f, "docs: 更新资产画布文档（子场景画布与变体自动搭）", [System.Text.UTF8Encoding]::new($false)); git add docs/asset-canvas.md; git commit -F $f; Remove-Item $f; cmd /c "git log -1 --format=%B"
```

---

### Task 8: 全量验证

**Files:** 无（验证性任务）

- [ ] **Step 1: 全部单测**

Run（仓库根）：`npm run typecheck`
Expected: 无错误

Run（仓库根）：`npm run lint`
Expected: 无错误（仅允许 `server/src/assets/refs.ts` 既有 warning）

Run: `cd frontend && npm test`
Expected: 全部通过（含新增 autobuild / paths / api 用例）

- [ ] **Step 2: 浏览器验证**

启动：`npm run dev`（服务端 3001 + 前端 5233），浏览器打开 `http://localhost:5233`：

1. 打开一个 `基础场景` 含 `场景/标签@变体` 的分镜 → 「资产画布」→ 自动搭画布 → 「加载图片」节点能显示变体图。
2. 打开某场景（如 `现代商场`）选中一个带变体的子场景 → 「资产画布」→ 自动搭画布 → 出现「基础图 + 各变体生成节点 + refs 加载节点」，连线正确；再次点击不重复创建。
3. 切换左侧子场景 → 画布自动跟随加载；不选子场景 → 显示「请从左侧资产浏览器选择子场景」。
4. 加载图片节点 → 选择资产 → 「分镜场景图」页签 → 切换集数/分镜 → 能看到对应帧并选中。
5. 场景画布某变体生成节点 → 「设为分镜场景图」→ 新增帧 → 该分镜 `stage.json` 写入 `场景/标签@变体`。

- [ ] **Step 3: 若有问题回退修复**

若浏览器验证发现问题，按 `systematic-debugging` 技能排查并修复（新建修复 commit，中文信息）。

- [ ] **Step 4: 提交（如验证有修复）**

如有修复 commit，推送前确认全部测试与 lint 通过。
