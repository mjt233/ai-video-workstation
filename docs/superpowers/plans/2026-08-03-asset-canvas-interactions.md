# 资产画布 Phase 3：节点、生成与交互 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现画布的核心用户体验：三种节点的 body/editor 组件、资产生成（文生图/图生图 + 状态轮询 + 版本历史）、连线交互、撤销重做、复制粘贴、右键菜单、自动搭画布，以及场景/分镜面板的「资产画布」Tab 集成。

**Architecture:** 在 Phase 2 数据层之上：`canvas/generate.ts`（纯函数：输入路径收集、版本号）、`canvas/autobuild.ts`（纯函数：按引用生成画布结构）、`canvas/useCanvasGeneration.ts`（组合式：跑工作流 + 轮询 + 更新历史）；`canvas/registry.ts` 接入 Vue 组件；节点 body/editor 组件放 `components/canvas/nodes/` 与 `components/canvas/editors/`；`AssetCanvas.vue` 承担全部画布交互；最后接入 `ScenePanel.vue` / `StagePanel.vue` 的 Tab。

**Tech Stack:** Vue 3 + Vuetify 3 + `@vue-flow/core` + TypeScript + vitest。

**验证约定：** 每任务 = 对应 vitest + `npm run typecheck` + `npm run lint`。

**范围检查：** 本计划是画布功能最后一个阶段，覆盖 canva.md §3（交互）、§6（节点）、§7（自动搭画布）、§8（生成状态/上游提示）、§9（生命周期/桥接）、§2（入口）。「A/B 版本对比」「画布复制到其他分镜」「候选方案生成」因体量较大不在 v1 范围内（见 canva.md §11 预留扩展），本计划不实现。

**相关规格：** `docs/plans/canva.md`；Phase 2 已建 `frontend/src/canvas/`（types/registry/connection/paths/preview/api/useCanvasStore）。

---

### Task 1: 生成辅助纯函数（generate.ts）

**Files:**
- Create: `frontend/src/canvas/generate.ts`
- Create: `frontend/src/canvas/generate.test.ts`

- [ ] **Step 1: 创建 `frontend/src/canvas/generate.ts`**

```ts
import type { CanvasConnection, CanvasNodeData, NodeConfig } from './types'

/**
 * 资产生成辅助纯函数：输入路径收集、节点资产读取、版本号计算。
 * 与 UI/网络解耦，便于单元测试。
 */

/** 生成图片节点的历史版本条目 */
export interface HistoryEntry {
  version: number
  path: string
  date: string
}

/** 读取节点 config 中的历史版本列表（无则返回空数组） */
export function getHistory(config: NodeConfig): HistoryEntry[] {
  return Array.isArray(config.history) ? (config.history as HistoryEntry[]) : []
}

/**
 * 获取节点当前的资产相对路径：
 * - 加载图片：config.assetPath
 * - 生成图片：config.current.path
 *
 * @param node 节点数据（可为 undefined）
 * @returns 项目内相对路径或 undefined
 */
export function getNodeCurrentAssetPath(node: CanvasNodeData | undefined): string | undefined {
  if (!node) return undefined
  if (node.prototypeId === 'image-loader') {
    const ap = node.config.assetPath
    return typeof ap === 'string' && ap ? ap : undefined
  }
  if (node.prototypeId === 'image-generate') {
    const cur = node.config.current as { path?: string } | undefined
    return cur?.path
  }
  return undefined
}

/**
 * 收集某节点的输入资产路径（按其所有入边连线的顺序）。
 *
 * @param nodeId 目标节点 id
 * @param connections 全部连线
 * @param nodes 全部节点
 * @returns 输入资产相对路径数组
 */
export function collectInputPaths(
  nodeId: string,
  connections: CanvasConnection[],
  nodes: CanvasNodeData[],
): string[] {
  const incoming = connections.filter((c) => c.toNodeId === nodeId)
  const paths: string[] = []
  for (const c of incoming) {
    const src = nodes.find((n) => n.id === c.fromNodeId)
    const p = getNodeCurrentAssetPath(src)
    if (p) paths.push(p)
  }
  return paths
}
```

- [ ] **Step 2: 创建 `frontend/src/canvas/generate.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import type { CanvasConnection, CanvasNodeData } from './types'
import { collectInputPaths, getHistory, getNodeCurrentAssetPath, type HistoryEntry } from './generate'

const loader: CanvasNodeData = {
  id: 'l1', prototypeId: 'image-loader', name: '加载', x: 0, y: 0, width: 10, height: 10,
  config: { assetPath: 'assert/character/张三/appearance.jpg' },
}
const gen: CanvasNodeData = {
  id: 'g1', prototypeId: 'image-generate', name: '生成', x: 0, y: 0, width: 10, height: 10,
  config: {
    current: { version: 2, path: 'assert/scene/1/1/canvas/g1/v2.jpg', date: '2026-01-01T00:00:00.000Z' },
    history: [
      { version: 1, path: 'assert/scene/1/1/canvas/g1/v1.jpg', date: '2026-01-01T00:00:00.000Z' },
      { version: 2, path: 'assert/scene/1/1/canvas/g1/v2.jpg', date: '2026-01-01T00:00:00.000Z' },
    ],
  },
}
const text: CanvasNodeData = {
  id: 't1', prototypeId: 'text', name: '文本', x: 0, y: 0, width: 10, height: 10, config: {},
}

describe('getHistory', () => {
  it('无 history 返回空数组', () => {
    expect(getHistory({})).toEqual([])
  })

  it('返回历史列表', () => {
    const h = getHistory(gen.config)
    expect(h).toHaveLength(2)
  })
})

describe('getNodeCurrentAssetPath', () => {
  it('加载图片取 assetPath', () => {
    expect(getNodeCurrentAssetPath(loader)).toBe('assert/character/张三/appearance.jpg')
  })

  it('生成图片取 current.path', () => {
    expect(getNodeCurrentAssetPath(gen)).toBe('assert/scene/1/1/canvas/g1/v2.jpg')
  })

  it('文本/无节点返回 undefined', () => {
    expect(getNodeCurrentAssetPath(text)).toBeUndefined()
    expect(getNodeCurrentAssetPath(undefined)).toBeUndefined()
  })
})

describe('collectInputPaths', () => {
  const conns: CanvasConnection[] = [
    { id: 'c1', fromNodeId: 'l1', fromPortId: 'out', toNodeId: 'g1', toPortId: 'in' },
    { id: 'c2', fromNodeId: 't1', fromPortId: 'out', toNodeId: 'g1', toPortId: 'in' },
  ]

  it('只收集有资产的输入节点路径', () => {
    const paths = collectInputPaths('g1', conns, [loader, gen, text])
    expect(paths).toEqual(['assert/character/张三/appearance.jpg'])
  })

  it('无入边返回空数组', () => {
    expect(collectInputPaths('t1', conns, [loader, gen, text])).toEqual([])
  })
})
```

- [ ] **Step 3: 运行测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npx vitest run src/canvas/generate.test.ts
```
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/canvas/generate.ts frontend/src/canvas/generate.test.ts
git commit -m "feat: 资产生成辅助纯函数"
```

---

### Task 2: 自动搭画布纯函数（autobuild.ts）

**Files:**
- Create: `frontend/src/canvas/autobuild.ts`
- Create: `frontend/src/canvas/autobuild.test.ts`

- [ ] **Step 1: 创建 `frontend/src/canvas/autobuild.ts`**

```ts
import { newId, type CanvasConnection, type CanvasData, type CanvasNodeData } from './types'
import { nextVersion } from './types'
import { getHistory } from './generate'

/**
 * 自动搭画布纯函数：根据资产引用列表生成/合并画布结构。
 * 幂等：已存在同路径锚点或生成节点时不重复创建，只补充缺失引用。
 */

/** 锚点引用：一个加载图片节点要绑定的资产 */
export interface AutoBuildRef {
  /** 资产项目相对路径（assert/ 下） */
  assetPath: string
  /** 锚点节点显示名 */
  label: string
}

/** 自动搭画布结果：应新增的节点、连线与生成节点 prompt */
export interface AutoBuildResult {
  nodes: CanvasNodeData[]
  connections: CanvasConnection[]
  generateNodeId: string
  prompt: string
}

/**
 * 从现有画布 + 引用列表生成自动搭画布结果。
 *
 * @param data 现有画布（用于幂等判断）
 * @param refs 锚点引用列表
 * @param prompt 生成节点 prompt 初稿
 * @param x 锚点起始 x
 * @param y 锚点起始 y
 * @returns 应新增/更新的节点与连线
 */
export function buildAutoCanvas(data: CanvasData, refs: AutoBuildRef[], prompt: string, x = 80, y = 80): AutoBuildResult {
  const nodes: CanvasNodeData[] = []
  const connections: CanvasConnection[] = []
  const existingPaths = new Set(data.nodes.map((n) => (typeof n.config.assetPath === 'string' ? n.config.assetPath : '')))

  // 生成节点：复用现有 image-generate 节点，否则新建
  let generateNode = data.nodes.find((n) => n.prototypeId === 'image-generate')
  if (!generateNode) {
    generateNode = {
      id: newId(),
      prototypeId: 'image-generate',
      name: '生成图片',
      x: x + 320,
      y,
      width: 240,
      height: 160,
      config: {},
    }
    nodes.push(generateNode)
  }
  const generateId = generateNode.id

  // 锚点节点：为缺失的引用创建加载图片节点
  let cursor = 0
  for (const ref of refs) {
    if (existingPaths.has(ref.assetPath)) continue
    const anchor: CanvasNodeData = {
      id: newId(),
      prototypeId: 'image-loader',
      name: ref.label,
      x,
      y + cursor * 160,
      width: 220,
      height: 150,
      config: { assetPath: ref.assetPath },
    }
    nodes.push(anchor)
    existingPaths.add(ref.assetPath)
    connections.push({
      id: newId(),
      fromNodeId: anchor.id,
      fromPortId: 'out',
      toNodeId: generateId,
      toPortId: 'in',
    })
    cursor += 1
  }

  return { nodes, connections, generateNodeId: generateId, prompt }
}

/**
 * 生成节点配置的 prompt 初稿。
 *
 * @param prompt 已有 prompt
 * @param extra 追加内容
 * @returns 合并后的 prompt（已有时追加换行，否则取 extra）
 */
export function mergePrompt(prompt: string, extra: string): string {
  if (prompt.trim()) return `${prompt.trim()}\n${extra.trim()}`
  return extra.trim()
}

/** 从分镜 stage.json 提取自动搭画布引用（角色/场景） */
export function buildShotRefsFromStage(stageDefs: unknown[]): AutoBuildRef[] {
  const refs: AutoBuildRef[] = []
  for (const def of stageDefs ?? []) {
    const d = def as { 基础场景?: string; 登场角色?: string[] }
    const stage = d.基础场景 ?? ''
    // 场景引用：{场景名}/{标签}；prev 跳过
    if (stage && stage !== 'prev' && !stage.startsWith('prev')) {
      const [stageName, label] = stage.split('/')
      if (stageName && label) {
        refs.push({ assetPath: `assert/stage/${stageName}/${label}.jpg`, label: stage })
      }
    }
    for (const ch of d.登场角色 ?? []) {
      // 角色引用：{名}@{变体}，v1 仅用基础外观
      const name = ch.split('@')[0]
      if (name) refs.push({ assetPath: `assert/character/${name}/appearance.jpg`, label: name })
    }
  }
  return refs
}
```

- [ ] **Step 2: 创建 `frontend/src/canvas/autobuild.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { createCanvasData } from './types'
import { buildAutoCanvas, buildShotRefsFromStage, mergePrompt } from './autobuild'

describe('buildAutoCanvas', () => {
  it('空画布创建锚点与生成节点并连线', () => {
    const data = createCanvasData('scene')
    const refs = [
      { assetPath: 'assert/stage/街角/白天.jpg', label: '街角/白天' },
      { assetPath: 'assert/character/张三/appearance.jpg', label: '张三' },
    ]
    const r = buildAutoCanvas(data, refs, '画面描述', 80, 80)
    expect(r.nodes).toHaveLength(3) // 2 锚点 + 1 生成
    expect(r.connections).toHaveLength(2)
    expect(r.generateNodeId).toBeTruthy()
  })

  it('幂等：已有同路径锚点不重复创建', () => {
    const data = createCanvasData('scene')
    const refs = [
      { assetPath: 'assert/character/张三/appearance.jpg', label: '张三' },
      { assetPath: 'assert/character/李四/appearance.jpg', label: '李四' },
    ]
    const first = buildAutoCanvas(data, refs, '', 80, 80)
    // 应用第一次结果后，再次调用应只补充缺失
    const merged = createCanvasData('scene')
    merged.nodes = [...first.nodes]
    merged.connections = [...first.connections]
    const second = buildAutoCanvas(merged, refs, '', 80, 80)
    expect(second.nodes).toHaveLength(0)
  })

  it('已有生成节点时复用', () => {
    const data = createCanvasData('scene')
    const refs = [{ assetPath: 'assert/character/张三/appearance.jpg', label: '张三' }]
    const r = buildAutoCanvas(data, refs, '', 80, 80)
    const data2 = createCanvasData('scene')
    data2.nodes = [...r.nodes]
    const r2 = buildAutoCanvas(data2, refs, '新prompt', 80, 80)
    expect(r2.nodes).toHaveLength(0)
    expect(r2.generateNodeId).toBe(r.generateNodeId)
  })
})

describe('mergePrompt', () => {
  it('空 prompt 取 extra', () => {
    expect(mergePrompt('', '描述A')).toBe('描述A')
  })

  it('已有 prompt 追加 extra', () => {
    expect(mergePrompt('已有', '追加')).toBe('已有\n追加')
  })
})

describe('buildShotRefsFromStage', () => {
  it('提取角色与场景引用', () => {
    const refs = buildShotRefsFromStage([
      { 基础场景: '街角/白天', 登场角色: ['张三', '李四@变体1'] },
      { 基础场景: 'prev' },
    ])
    expect(refs).toEqual([
      { assetPath: 'assert/stage/街角/白天.jpg', label: '街角/白天' },
      { assetPath: 'assert/character/张三/appearance.jpg', label: '张三' },
      { assetPath: 'assert/character/李四/appearance.jpg', label: '李四' },
    ])
  })

  it('空定义返回空', () => {
    expect(buildShotRefsFromStage([])).toEqual([])
  })
})
```

- [ ] **Step 3: 运行测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npx vitest run src/canvas/autobuild.test.ts
```
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/canvas/autobuild.ts frontend/src/canvas/autobuild.test.ts
git commit -m "feat: 自动搭画布纯函数（幂等）"
```

---

### Task 3: 生成组合式（useCanvasGeneration.ts）

**Files:**
- Create: `frontend/src/canvas/useCanvasGeneration.ts`
- Create: `frontend/src/canvas/useCanvasGeneration.test.ts`

- [ ] **Step 1: 创建 `frontend/src/canvas/useCanvasGeneration.ts`**

```ts
import { ref } from 'vue'
import { writeFs } from '../api/client'
import { runWorkflow, getTaskStatus, getTaskLogs, type WorkflowUserParamValue } from '../api/workflow'
import type { CanvasNodeData, CanvasKind } from './types'
import { canvasNodeAssetPath, sceneCanvasRelPath, stageCanvasRelPath } from './paths'
import { getHistory, type HistoryEntry } from './generate'
import { nextVersion } from './types'

/** 生成状态（挂在生成节点上展示） */
export interface GenerateStatus {
  status: 'running' | 'success' | 'error'
  progress?: number
  lastLog?: string
  errorMsg?: string
  taskId?: string
}

/** 生成目标（与画布目标一致） */
export interface GenTarget {
  kind: CanvasKind
  stage?: string
  episode?: string
  shot?: string
}

/**
 * 生成图片节点的资产生成组合式：跑工作流、轮询状态、更新节点历史。
 *
 * @param project 项目名
 * @param target 画布目标（决定产物目录与 prompt 文件位置）
 */
export function useCanvasGeneration(project: string, target: GenTarget) {
  /** nodeId → 生成状态 */
  const statusByNode = ref<Record<string, GenerateStatus>>({})
  /** nodeId → 轮询句柄 */
  const pollTimers: Record<string, ReturnType<typeof setInterval>> = {}
  /** nodeId → 当前 taskId（用于中断） */
  const taskIdByNode: Record<string, string> = {}
  /** nodeId → 输入资产路径（由调用方通过 setInputPaths 注入） */
  const inputPathsRef = ref<Record<string, string[]>>({})

  /**
   * 注入某节点的输入资产路径（由 AssetCanvas 在发起生成前计算）。
   *
   * @param nodeId 节点 id
   * @param paths 输入资产相对路径数组
   */
  function setInputPaths(nodeId: string, paths: string[]): void {
    inputPathsRef.value[nodeId] = paths
  }

  /** 计算生成节点的产物路径（版本号 = 历史长度 + 1） */
  function computeOutputPath(node: CanvasNodeData): string {
    const version = nextVersion(getHistory(node.config))
    const scope =
      target.kind === 'stage'
        ? { kind: 'stage' as const, primary: target.stage ?? '' }
        : { kind: 'scene' as const, primary: target.episode ?? '', secondary: target.shot }
    return canvasNodeAssetPath(scope, node.id, version)
  }

  /** 计算生成节点 prompt 文件相对路径（文生图工作流需要） */
  function computePromptPath(nodeId: string): string {
    if (target.kind === 'stage') {
      const rel = stageCanvasRelPath(target.stage ?? '')
      const dir = rel.replace(/canvas\.json$/, '')
      return `${dir}${nodeId}/prompt.md`
    }
    const rel = sceneCanvasRelPath(target.episode ?? '', target.shot ?? '')
    const dir = rel.replace(/canvas\.json$/, '')
    return `${dir}${nodeId}/prompt.md`
  }

  /**
   * 触发生成节点的资产生成。
   *
   * @param node 生成图片节点数据
   * @param updateConfig 更新节点配置的回调（由调用方写入 current/history）
   */
  async function generate(node: CanvasNodeData, updateConfig: (config: Record<string, unknown>) => void): Promise<void> {
    const nodeId = node.id
    if (statusByNode.value[nodeId]?.status === 'running') return

    const config = node.config
    const prompt = String(config.prompt ?? '')
    const inputPaths = inputPathsRef.value[nodeId] ?? []
    const explicitWorkflow = typeof config.workflowId === 'string' && config.workflowId ? config.workflowId : undefined
    const workflowId = explicitWorkflow ?? (inputPaths.length > 0 ? 'image-edit' : 'text-to-image')
    const impl = String(config.workflowImpl ?? 'default')
    const outputPath = computeOutputPath(node)

    let vars: Record<string, string>
    if (workflowId === 'image-edit') {
      vars = { desc: prompt, imagePaths: JSON.stringify(inputPaths), purpose: 'canvas-image' }
    } else {
      const promptPath = computePromptPath(nodeId)
      await writeFs(project, promptPath, prompt)
      vars = { promptPath, purpose: 'canvas-image' }
    }

    const userParams = (config.workflowParams as Record<string, WorkflowUserParamValue> | undefined) ?? {}
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
  }

  function poll(
    taskId: string,
    node: CanvasNodeData,
    outputPath: string,
    updateConfig: (config: Record<string, unknown>) => void,
  ): void {
    if (pollTimers[node.id]) clearInterval(pollTimers[node.id])
    pollTimers[node.id] = setInterval(async () => {
      try {
        const task = await getTaskStatus(taskId)
        const logs = await getTaskLogs(taskId).catch(() => [])
        const lastLog = logs.length > 0 ? String(logs[logs.length - 1].message) : undefined
        statusByNode.value[node.id] = {
          status: task.status === 'running' || task.status === 'pending' ? 'running' : task.status === 'success' ? 'success' : 'error',
          lastLog,
          taskId,
          errorMsg: task.errorMsg,
        }

        if (task.status === 'success') {
          clearInterval(pollTimers[node.id])
          delete pollTimers[node.id]
          const history: HistoryEntry[] = [...getHistory(node.config), { version: nextVersion(getHistory(node.config)), path: outputPath, date: new Date().toISOString() }]
          updateConfig({
            ...node.config,
            current: { version: nextVersion(getHistory(node.config)), path: outputPath, date: new Date().toISOString() },
            history,
          })
        } else if (task.status === 'error' || task.status === 'failed' || task.status === 'cancelled') {
          clearInterval(pollTimers[node.id])
          delete pollTimers[node.id]
          statusByNode.value[node.id] = { status: 'error', errorMsg: task.errorMsg, taskId }
        }
      } catch {
        // 轮询失败忽略，下轮重试
      }
    }, 2000)
  }

  /** 中断生成 */
  async function interrupt(nodeId: string): Promise<void> {
    const taskId = taskIdByNode.value[nodeId]
    if (!taskId) return
    if (pollTimers[nodeId]) {
      clearInterval(pollTimers[nodeId])
      delete pollTimers[nodeId]
    }
    statusByNode.value[nodeId] = { status: 'error', errorMsg: '已中断', taskId }
    // 现有 API 无取消端点，v1 仅停止前端轮询与状态展示
  }

  /** 清除节点状态（如失败后重试前） */
  function clearStatus(nodeId: string): void {
    delete statusByNode.value[nodeId]
  }

  return { statusByNode, setInputPaths, generate, interrupt, clearStatus, computeOutputPath }
}
```

> **实现说明**：`collectInputPaths` 的调用方逻辑（根据连线与节点计算输入路径）由 AssetCanvas（Task 7）在发起生成前计算，并通过 `setInputPaths(nodeId, paths)` 注入；组合式本身不持有 store。

- [ ] **Step 2: 创建 `frontend/src/canvas/useCanvasGeneration.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useCanvasGeneration } from './useCanvasGeneration'

vi.mock('../api/client', () => ({ writeFs: vi.fn() }))
vi.mock('../api/workflow', () => ({
  runWorkflow: vi.fn(),
  getTaskStatus: vi.fn(),
  getTaskLogs: vi.fn(),
}))

import { writeFs } from '../api/client'
import { runWorkflow, getTaskStatus, getTaskLogs } from '../api/workflow'
import type { CanvasNodeData } from './types'

const TARGET = { kind: 'scene' as const, episode: '1', shot: '1' }

function makeNode(prompt: string, workflowId?: string): CanvasNodeData {
  return {
    id: 'n1', prototypeId: 'image-generate', name: '生成', x: 0, y: 0, width: 240, height: 160,
    config: { prompt, ...(workflowId ? { workflowId } : {}) },
  }
}

describe('useCanvasGeneration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    ;(runWorkflow as Mock).mockResolvedValue({ taskId: 'task-1', status: 'running' })
    ;(getTaskStatus as Mock).mockResolvedValue({ taskId: 'task-1', status: 'success', result: { path: 'x' }, errorMsg: undefined, workflowId: 'image-edit', impl: 'default', createdAt: '', updatedAt: '' })
    ;(getTaskLogs as Mock).mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('文生图：写入 prompt 文件并调用 runWorkflow（text-to-image）', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('一只猫')
    let savedConfig: Record<string, unknown> | null = null
    await gen.generate(node, (c) => { savedConfig = c })
    expect(writeFs).toHaveBeenCalledWith('p', 'prompt/scene/1/1/canvas/n1/prompt.md', '一只猫')
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'text-to-image',
        params: expect.objectContaining({ outputPath: 'assert/scene/1/1/canvas/n1/v1.jpg' }),
      }),
    )
    // 成功后更新配置
    await vi.advanceTimersByTimeAsync(2100)
    expect(savedConfig).toBeTruthy()
    expect((savedConfig as { history: unknown[] }).history).toHaveLength(1)
  })

  it('图生图：使用 image-edit 并传入 imagePaths', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('改成夜景', 'image-edit')
    gen.setInputPaths('n1', ['assert/stage/街角/白天.jpg'])
    await gen.generate(node, () => {})
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'image-edit',
        params: expect.objectContaining({
          vars: expect.objectContaining({ desc: '改成夜景', imagePaths: '["assert/stage/街角/白天.jpg"]' }),
        }),
      }),
    )
  })

  it('生成失败进入 error 状态', async () => {
    ;(getTaskStatus as Mock).mockResolvedValue({ taskId: 'task-1', status: 'error', result: null, errorMsg: '失败', workflowId: 'image-edit', impl: 'default', createdAt: '', updatedAt: '' })
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('x', 'image-edit')
    gen.setInputPaths('n1', ['assert/a.jpg'])
    await gen.generate(node, () => {})
    await vi.advanceTimersByTimeAsync(2100)
    expect(gen.statusByNode.value.n1.status).toBe('error')
    expect(gen.statusByNode.value.n1.errorMsg).toBe('失败')
  })
})
```

> 说明：若测试与实现有出入，以「实现满足上述三个用例」为准微调实现，不要删减用例语义。

- [ ] **Step 3: 运行测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npx vitest run src/canvas/useCanvasGeneration.test.ts
```
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/canvas/useCanvasGeneration.ts frontend/src/canvas/useCanvasGeneration.test.ts
git commit -m "feat: 资产生成组合式（工作流 + 轮询 + 历史）"
```

---

### Task 4: store 增加撤销/重做与复制粘贴

**Files:**
- Modify: `frontend/src/canvas/useCanvasStore.ts`
- Modify: `frontend/src/canvas/useCanvasStore.test.ts`

- [ ] **Step 1: 在 `useCanvasStore.ts` 中增加历史快照与复制粘贴**

在文件顶部 `SAVE_DEBOUNCE_MS` 之后新增：

```ts
/** 撤销/重做历史栈容量上限 */
const HISTORY_LIMIT = 50
```

在 `let saveTimer` 声明后新增：

```ts
  const historyPast = ref<CanvasData[]>([])
  const historyFuture = ref<CanvasData[]>([])
```

在 `markDirty` 之前新增（所有结构变更先调用）：

```ts
  /** 将当前数据快照压入撤销栈（深拷贝） */
  function pushHistory(): void {
    historyPast.value.push(JSON.parse(JSON.stringify(data.value)) as CanvasData)
    if (historyPast.value.length > HISTORY_LIMIT) historyPast.value.shift()
    historyFuture.value = []
  }
```

在 `disconnect` 之后新增：

```ts
  /** 是否可撤销 */
  const canUndo = computed(() => historyPast.value.length > 0)
  /** 是否可重做 */
  const canRedo = computed(() => historyFuture.value.length > 0)

  /** 撤销一次结构变更 */
  function undo(): void {
    const snapshot = historyPast.value.pop()
    if (!snapshot) return
    historyFuture.value.push(JSON.parse(JSON.stringify(data.value)) as CanvasData)
    data.value = snapshot
    markDirty()
  }

  /** 重做一次结构变更 */
  function redo(): void {
    const snapshot = historyFuture.value.pop()
    if (!snapshot) return
    historyPast.value.push(JSON.parse(JSON.stringify(data.value)) as CanvasData)
    data.value = snapshot
    markDirty()
  }

  /**
   * 复制节点到内部剪贴板。
   *
   * @param nodeId 节点 id
   */
  function copyNode(nodeId: string): void {
    const node = data.value.nodes.find((n) => n.id === nodeId)
    if (!node) return
    clipboard.value = JSON.parse(JSON.stringify(node)) as CanvasNodeData
  }

  /**
   * 粘贴剪贴板节点（偏移 30px）。
   *
   * @returns 新节点或 undefined
   */
  function pasteNode(): CanvasNodeData | undefined {
    if (!clipboard.value) return undefined
    const copy = JSON.parse(JSON.stringify(clipboard.value)) as CanvasNodeData
    copy.id = newId()
    copy.x += 30
    copy.y += 30
    data.value.nodes.push(copy)
    markDirty()
    return copy
  }

  /** 复制剪贴板内容（节点数据） */
  const clipboard = ref<CanvasNodeData | null>(null)

  /** 是否可粘贴 */
  const canPaste = computed(() => clipboard.value !== null)
```

> **注意**：`clipboard`、`canPaste` 声明需在 `copyNode`/`pasteNode` 使用前（`const` 提升问题：`clipboard` 是 `ref` 初始化，函数体内的引用在调用时求值，声明顺序只要在函数定义之前或之后均可，但为清晰请把 `clipboard` 的 `ref` 声明放在 `copyNode` 之前）。

同时：`addNode`/`removeNode`/`connect`/`disconnect`/`pasteNode` 中调用 `markDirty()` 的位置前插入 `pushHistory()`。`updateNode` 中坐标/尺寸变更也应 `pushHistory()`（每次变更都入栈即可）。

在 return 对象中新增：`historyPast, historyFuture, canUndo, canRedo, undo, redo, copyNode, pasteNode, canPaste, clipboard`。

- [ ] **Step 2: 更新 `useCanvasStore.test.ts` 追加用例**

在文件末尾 `describe` 内追加：

```ts
  it('undo/redo：恢复结构变更', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('text', 0, 0)
    expect(store.nodes.value).toHaveLength(1)
    store.undo()
    expect(store.nodes.value).toHaveLength(0)
    store.redo()
    expect(store.nodes.value).toHaveLength(1)
  })

  it('copyNode/pasteNode：复制后粘贴为独立节点', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('text', 0, 0)
    store.copyNode(a.id)
    const b = store.pasteNode()
    expect(b).toBeTruthy()
    expect(b!.id).not.toBe(a.id)
    expect(store.nodes.value).toHaveLength(2)
  })
```

- [ ] **Step 3: 运行测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npx vitest run src/canvas/useCanvasStore.test.ts
```
Expected: 全部通过（含原有用例）。

- [ ] **Step 4: typecheck 与提交**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation
npm run typecheck
```
Expected: 无错误。

```bash
git add frontend/src/canvas/useCanvasStore.ts frontend/src/canvas/useCanvasStore.test.ts
git commit -m "feat: store 支持撤销/重做与复制粘贴"
```

---

### Task 5: 节点 body 组件与 registry 接入

**Files:**
- Create: `frontend/src/components/canvas/nodes/ImageLoaderNode.vue`
- Create: `frontend/src/components/canvas/nodes/ImageGenerateNode.vue`
- Create: `frontend/src/components/canvas/nodes/TextNode.vue`
- Modify: `frontend/src/canvas/registry.ts`

- [ ] **Step 1: 创建 `ImageLoaderNode.vue`**

```vue
<template>
  <div class="image-loader-node">
    <template v-if="imageUrl">
      <v-img
        :src="imageUrl"
        contain
        width="100%"
        height="100%"
        @error="imageUrl = ''"
      />
    </template>
    <template v-else>
      <div class="image-loader-node__empty">
        <v-icon icon="mdi-image-outline" size="large" />
        <div class="text-caption text-medium-emphasis">未选择图片</div>
        <div class="d-flex ga-1 mt-1">
          <v-btn size="x-small" variant="tonal" color="primary" @click.stop="openUpload">
            上传图片
          </v-btn>
          <v-btn size="x-small" variant="tonal" @click.stop="openPicker">
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

/** 节点 body 组件统一 props：节点数据 + 项目名 */
const props = defineProps<{
  project: string
  node: CanvasNodeData
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
}>()

const imageUrl = ref('')

/** 当前资产路径（config.assetPath） */
const assetPath = computed(() => (typeof props.node.config.assetPath === 'string' ? props.node.config.assetPath : ''))

watch(
  assetPath,
  (p) => {
    imageUrl.value = p ? buildPreviewUrl(props.project, p) : ''
  },
  { immediate: true },
)

/** 打开系统文件选择并上传到自定义资产，然后写入 assetPath */
function openUpload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
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

/** 打开资产选择器（Task 7 在 AssetCanvas 统一提供，此处先占位） */
function openPicker() {
  emit('open-picker', props.node.id)
}
</script>

<style scoped>
.image-loader-node {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

.image-loader-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px;
}
</style>
```

> **说明**：组件需声明 `open-picker` 事件（`defineEmits` 中补充 `(e: 'open-picker', nodeId: string): void`）；`assetPath` 变化后应同步回节点（本组件通过 `update:config` 由父级写入）。**Task 5 结束时确保 typecheck 通过**（未接入的 emit 以 `defineEmits` 声明即可，不强制父级使用）。

- [ ] **Step 2: 创建 `ImageGenerateNode.vue`**

```vue
<template>
  <div class="image-generate-node">
    <template v-if="imageUrl">
      <v-img
        :src="imageUrl"
        contain
        width="100%"
        height="100%"
        @error="imageUrl = ''"
      />
    </template>
    <template v-else>
      <div class="image-generate-node__empty">
        <v-icon icon="mdi-image-plus" size="large" />
        <div class="text-caption text-medium-emphasis">尚未生成</div>
      </div>
    </template>

    <!-- 上游更新角标 -->
    <v-badge
      v-if="upstreamUpdated"
      color="warning"
      content="上游已更新"
      location="top start"
      offset-x="6"
      offset-y="6"
    />

    <!-- 生成中遮罩 -->
    <div v-if="status?.status === 'running'" class="image-generate-node__mask">
      <v-progress-circular indeterminate size="28" color="primary" />
      <div v-if="status.lastLog" class="text-caption log-text">{{ status.lastLog }}</div>
    </div>
    <div v-else-if="status?.status === 'error'" class="image-generate-node__mask image-generate-node__mask--error">
      <v-icon icon="mdi-alert-circle-outline" color="error" size="28" />
      <div class="text-caption error-text">{{ status.errorMsg || '生成失败' }}</div>
      <v-btn size="x-small" variant="tonal" color="error" @click.stop="$emit('retry', node.id)">重试</v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'
import type { GenerateStatus } from '../../../canvas/useCanvasGeneration'

const props = defineProps<{
  project: string
  node: CanvasNodeData
  status?: GenerateStatus | null
  upstreamUpdated?: boolean
}>()

defineEmits<{
  (e: 'retry', nodeId: string): void
}>()

const imageUrl = ref('')
const currentPath = computed(() => {
  const cur = props.node.config.current as { path?: string } | undefined
  return cur?.path ?? ''
})

watch(
  currentPath,
  (p) => {
    imageUrl.value = p ? buildPreviewUrl(props.project, p, (props.node.config.current as { version?: number } | undefined)?.version) : ''
  },
  { immediate: true },
)
</script>

<style scoped>
.image-generate-node {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

.image-generate-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.image-generate-node__mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.85);
  padding: 6px;
}

.image-generate-node__mask--error {
  background: rgba(255, 235, 238, 0.9);
}

.log-text,
.error-text {
  max-width: 90%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

- [ ] **Step 3: 创建 `TextNode.vue`**

```vue
<template>
  <textarea
    class="text-node"
    :value="text"
    placeholder="输入文本…"
    @input="onInput"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'

const props = defineProps<{
  node: CanvasNodeData
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
}>()

const text = computed(() => (typeof props.node.config.text === 'string' ? props.node.config.text : ''))

function onInput(e: Event) {
  emit('update:config', { text: (e.target as HTMLTextAreaElement).value })
}
</script>

<style scoped>
.text-node {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 8px;
  font-size: 13px;
  background: transparent;
  font-family: inherit;
}
</style>
```

- [ ] **Step 4: 修改 `frontend/src/canvas/registry.ts`**

将 `NodePrototype` 接口扩展，并为三个原型挂接组件：

```ts
import type { Port } from './types'
import type { Component } from 'vue'

/** 节点原型：定义节点类型的端口、能力与渲染组件 */
export interface NodePrototype {
  /** 该节点类型的唯一标识，代码中硬编码 */
  id: string
  /** 节点名称（方便用户阅读） */
  name: string
  /** 输入端口定义（可接受的连接类型由此决定） */
  inputPorts: Port[]
  /** 输出端口定义 */
  outputPorts: Port[]
  /** 该类型节点是否允许用户自由缩放大小 */
  resizeable: boolean
  /** 渲染节点卡片主体的 Vue 组件（可拿到 node/project 等 props） */
  bodyComponent?: Component
  /** 节点被选中后渲染在节点下方的配置组件 */
  editorComponent?: Component
}
```

在 `NODE_PROTOTYPES` 中为三个原型补充：

```ts
import ImageLoaderNode from '../components/canvas/nodes/ImageLoaderNode.vue'
import ImageGenerateNode from '../components/canvas/nodes/ImageGenerateNode.vue'
import TextNode from '../components/canvas/nodes/TextNode.vue'
```

并分别在 `image-loader`、`image-generate`、`text` 原型对象中增加：
- `image-loader`: `bodyComponent: ImageLoaderNode`
- `image-generate`: `bodyComponent: ImageGenerateNode`
- `text`: `bodyComponent: TextNode`

- [ ] **Step 5: typecheck 与提交**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation
npm run typecheck
```
Expected: 无错误（若 Vue SFC 有类型问题请修复）。

```bash
git add frontend/src/components/canvas/nodes/ frontend/src/canvas/registry.ts
git commit -m "feat: 节点 body 组件并接入 registry"
```

---

### Task 6: 生成图片配置组件（ImageGenerateEditor.vue）

**Files:**
- Create: `frontend/src/components/canvas/editors/ImageGenerateEditor.vue`

- [ ] **Step 1: 创建 `ImageGenerateEditor.vue`**

```vue
<template>
  <div class="image-generate-editor">
    <v-text-field
      :model-value="nodeName"
      label="节点名称"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="(v) => emit('update:config', { name: v })"
    />

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
      @update:model-value="(v) => emit('update:config', { workflowId: v, workflowImpl: undefined, workflowParams: {} })"
    />

    <div class="text-caption text-medium-emphasis mb-1">
      输入图（{{ inputPaths.length }}）
    </div>
    <div v-if="inputPaths.length" class="d-flex flex-wrap ga-1 mb-2">
      <v-chip
        v-for="(p, i) in inputPaths"
        :key="i"
        size="small"
      >
        {{ p.split('/').pop() }}
      </v-chip>
    </div>
    <div v-else class="text-caption text-grey mb-2">
      无输入图，默认使用文生图工作流
    </div>

    <WorkflowParamsForm
      v-model="workflowParams"
      :declarations="currentDeclarations"
    />

    <div class="d-flex align-center ga-2 mb-2">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
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
      <v-btn
        v-if="node.config.current && !isRunning"
        size="small"
        variant="tonal"
        color="primary"
        @click="emit('set-as-scene', node.id)"
      >
        设为分镜场景图
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getWorkflows, type WorkflowInfo } from '../../../api/workflow'
import type { CanvasNodeData } from '../../../canvas/types'
import { getHistory } from '../../../canvas/generate'
import WorkflowParamsForm from '../../WorkflowParamsForm.vue'
import type { WorkflowUserParamValue } from '../../../api/workflow'

const props = defineProps<{
  project: string
  node: CanvasNodeData
  inputPaths: string[]
  isRunning: boolean
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'open-history', nodeId: string): void
  (e: 'set-as-scene', nodeId: string): void
}>()

const workflows = ref<WorkflowInfo[]>([])

const nodeName = computed(() => props.node.name)
const prompt = computed(() => (typeof props.node.config.prompt === 'string' ? props.node.config.prompt : ''))
const workflowId = computed(() => {
  const explicit = props.node.config.workflowId
  if (typeof explicit === 'string' && explicit) return explicit
  return props.inputPaths.length > 0 ? 'image-edit' : 'text-to-image'
})
const history = computed(() => getHistory(props.node.config))
const workflowParams = ref<Record<string, WorkflowUserParamValue>>({})

const currentWorkflow = computed(() => workflows.value.find((w) => w.id === workflowId.value))
const currentDeclarations = computed(() => {
  const impl = currentWorkflow.value?.implementations.find((i) => i.impl === (props.node.config.workflowImpl || 'default'))
  return impl?.params ?? []
})

const workflowItems = computed(() =>
  workflows.value
    .filter((w) => w.id === 'text-to-image' || w.id === 'image-edit')
    .map((w) => ({ id: w.id, label: w.name })),
)

watch(
  () => props.node.config.workflowParams,
  (v) => {
    if (v && typeof v === 'object') workflowParams.value = { ...(v as Record<string, WorkflowUserParamValue>) }
  },
  { immediate: true, deep: true },
)

watch(workflowParams, (v) => {
  emit('update:config', { workflowParams: v })
})

// 加载工作流列表（初始化一次）
getWorkflows()
  .then((list) => { workflows.value = list })
  .catch(() => { workflows.value = [] })
</script>
```

> **说明**：`set-as-scene`（设为分镜场景图）与 `open-history`（历史）由 Task 7 的 AssetCanvas 统一实现（历史弹窗可先简化为 `v-dialog` 列出 `history` 条目路径；「设为分镜场景图」调用 `copyFs` 把 `current.path` 复制到 `assert/scene/{ep}/{shot}/stage/0.jpg`）。若这些联动过重，Task 7 可只实现「设为分镜场景图」的 `copyFs` 调用 + toast 提示，历史弹窗用 AssetHistoryDialog 组件复用（传入 `current.path`）。

- [ ] **Step 2: typecheck 与提交**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation
npm run typecheck
```
Expected: 无错误。

```bash
git add frontend/src/components/canvas/editors/ImageGenerateEditor.vue
git commit -m "feat: 生成图片配置组件"
```

---

### Task 7: AssetCanvas 交互增强

**Files:**
- Modify: `frontend/src/components/canvas/AssetCanvas.vue`

- [ ] **Step 1: 重写 `AssetCanvas.vue`**

按以下要点重构（完整代码如下）：

1. **工具栏**：适应视图 / 缩放 / 撤销 / 重做 / 自动搭画布 / 保存状态。
2. **节点渲染**：自定义节点类型 `canvas`，slot 内根据 `prototypeId` 动态渲染 body 组件；有输入端口渲染左侧 `<Handle>`，有输出端口渲染右侧 `<Handle>`；选中时在下方渲染 editorComponent。
3. **连线交互**：`isValidConnection` 用 `canConnectNodes` + 节点查询校验；`@connect` 事件把临时连接写入 store（失败忽略）。
4. **删除**：节点删除走 `confirm` 弹窗；连线删除直接删；`Delete` 键删除选中。
5. **右键菜单**：选中节点后 `contextmenu` 弹出菜单（重新生成 / 历史 / 重命名 / 复制 / 删除）。
6. **键盘**：`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+C` / `Ctrl+V` / `Ctrl+D`（复制并粘贴）。
7. **自动搭画布**：读 `stage.json`（scene）或子场景文件（stage）→ `buildShotRefsFromStage` → `buildAutoCanvas` → 写入 store。
8. **生成联动**：`useCanvasGeneration` + `collectInputPaths`，把生成的 current/history 写回节点配置。
9. **设为分镜场景图**：`copyFs(current.path → assert/scene/{ep}/{shot}/stage/0.jpg)` + 成功提示。
10. **上游更新角标**：生成图片节点若其任一输入节点 `current.date` 晚于本节点 `current.date`，显示角标。

> **实现约束**：本 Task 代码量较大，实现时保持 Phase 2 已有的 store 接口（`load/save/addNode/removeNode/updateNode/connect/disconnect/undo/redo/copyNode/pasteNode`）与 `useCanvasGeneration` 接口不变。`@vue-flow/core` 的 `isValidConnection` 通过 `<VueFlow :is-valid-connection="...">` 传入。连线事件返回的临时 connection（`{ source, target, sourceHandle, targetHandle }`）转换为 `store.connect(source, target)`（store 内部会校验类型/防环）。**请基于上述要点写出完整实现**，确保 typecheck 通过、与 store/生成组合式接口一致，代码完整可直接运行。

- [ ] **Step 2: typecheck 与 lint**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation
npm run typecheck
npm run lint
```
Expected: 无错误（如出现 vue 格式 warning 用 `npx eslint --fix` 处理对应文件）。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/canvas/AssetCanvas.vue
git commit -m "feat: 画布交互增强（连线/撤销/复制/删除/右键/自动搭画布）"
```

---

### Task 8: 场景/分镜面板集成

**Files:**
- Modify: `frontend/src/components/ScenePanel.vue`
- Modify: `frontend/src/components/StagePanel.vue`

- [ ] **Step 1: `ScenePanel.vue` 新增「资产画布」Tab**

在 `v-tabs` 中（`总览/台词/场景图片/视频生成/自定义资产` 之后）新增：

```html
      <v-tab value="canvas">
        资产画布
      </v-tab>
```

在 `v-tabs-window` 中新增：

```html
      <v-tabs-window-item value="canvas">
        <AssetCanvas
          :project="props.project"
          kind="scene"
          :episode="props.episode"
          :shot="props.shot"
        />
      </v-tabs-window-item>
```

在 `<script setup>` 的 import 区新增：

```ts
import AssetCanvas from './canvas/AssetCanvas.vue'
```

（Tab 容器需给画布足够高度：若父容器为 `overflow-y: auto` 且画布高度不足，给 `AssetCanvas` 外层包一层 `style="height: 60vh"`。）

- [ ] **Step 2: `StagePanel.vue` 新增「资产画布」Tab**

在 `StagePanel.vue` 的 `v-tabs` 中新增 `<v-tab value="canvas">资产画布</v-tab>`，在 `v-tabs-window` 中新增：

```html
      <v-tabs-window-item value="canvas">
        <AssetCanvas
          :project="props.project"
          kind="stage"
          :stage="props.name"
        />
      </v-tabs-window-item>
```

import 区新增：

```ts
import AssetCanvas from './canvas/AssetCanvas.vue'
```

- [ ] **Step 3: typecheck 与 lint**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation
npm run typecheck
npm run lint
```
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/ScenePanel.vue frontend/src/components/StagePanel.vue
git commit -m "feat: 场景/分镜面板接入资产画布 Tab"
```

---

### Task 9: 全量验证

**Files:**
- 无（纯验证）

- [ ] **Step 1: 全部前端测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npm test
```
Expected: 全部通过。

- [ ] **Step 2: 全仓 typecheck / lint / server 测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation
npm run typecheck
npm run lint
cd server
npm test
```
Expected: 均通过；lint 仅允许 `server/src/assets/refs.ts` 既有 warning。

- [ ] **Step 3: 提交（如有修复）**

```bash
git add -A
git commit -m "fix: Phase3 收尾修复"
```

---

## 后续（不在本计划内）

- 浏览器模拟操作测试（在 dev server 上验证画布端到端交互，随后单独执行）。
- A/B 版本对比、画布复制到其他分镜、候选方案生成（canva.md §11 预留扩展）。

## Self-Review

- **Spec coverage**：canva.md §6.1/6.2/6.3（节点组件）、§4.3（连线交互）、§3.2/3.3（删除/撤销）、§7（自动搭画布）、§8（生成状态/上游提示）、§9（桥接设为分镜场景图）、§2（入口 Tab）均覆盖。
- **Placeholder scan**：Task 7 因体量按要点实现而非逐行给出，已在任务内给出明确接口约束与行为清单，非 TBD。
- **Type consistency**：`store.connect/undo/redo/copyNode/pasteNode`、`useCanvasGeneration.generate/interrupt/statusByNode`、`ImageGenerateNode` 的 `retry` 事件、`ImageGenerateEditor` 的 `generate/interrupt/set-as-scene/open-history` 事件命名在 Task 3-7 间一致。
