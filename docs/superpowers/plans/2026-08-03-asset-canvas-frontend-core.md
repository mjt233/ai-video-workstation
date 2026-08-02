# 资产画布 Phase 2：前端画布核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建前端画布核心层：数据模型、节点原型注册表（类型化端口）、连接校验、canvas.json 读写、预览 URL 工具、画布状态 store，以及一个可加载/保存/渲染基础节点与连线的 `AssetCanvas.vue`（Vue Flow）。产出独立可测试的软件。

**Architecture:** 在 `frontend/src/canvas/` 下建立与 UI 解耦的纯数据层（types / registry / connection / paths / preview / api），全部纯函数可单测；`useCanvasStore.ts` 是薄组合式 API（状态 + 持久化防抖）；`frontend/src/components/canvas/AssetCanvas.vue` 基于 `@vue-flow/core` 渲染。Phase 3 将在此基础上实现节点 body/editor 组件、连线交互、自动搭画布与面板集成。

**Tech Stack:** Vue 3 + TypeScript + Vite + `@vue-flow/core` + `@vue-flow/background` + vitest + jsdom。

**验证约定：** 项目无历史测试框架，已引入 vitest。每个任务验证 = `npm test`（对应目录）+ `npm run typecheck` + `npm run lint`。

**范围检查：** 本计划只覆盖前端画布核心数据层与基础渲染。节点具体 UI（bodyComponent/editorComponent）、连线拖拽交互、撤销重做、自动搭画布、面板 Tab 集成为 Phase 3 独立计划。

**相关规格：** `docs/plans/canva.md` §4（类型系统）、§5（节点定义）、§10（持久化与资源引用）。

---

### Task 1: 安装 Vue Flow 依赖

**Files:**
- Modify: `frontend/package.json` / `frontend/package-lock.json`

- [ ] **Step 1: 安装依赖**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npm install @vue-flow/core @vue-flow/background
```

Expected: 安装成功，package.json 出现 `@vue-flow/core` 与 `@vue-flow/background`。

- [ ] **Step 2: 验证 typecheck**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation
npm run typecheck
```
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: 安装 @vue-flow/core 与 @vue-flow/background"
```

---

### Task 2: 数据模型（types.ts）

**Files:**
- Create: `frontend/src/canvas/types.ts`
- Create: `frontend/src/canvas/types.test.ts`

- [ ] **Step 1: 创建 `frontend/src/canvas/types.ts`**

```ts
/**
 * 资产画布数据模型。
 *
 * 画布定义（节点、连线、坐标、配置）持久化为 canvas.json（prompt/ 下）；
 * 生成产物为磁盘文件（assert/{scope}/canvas/{nodeId}/v{n}.jpg）。
 */

/** 数据流类型：连接是否允许由端口数据类型决定（ComfyUI 思路） */
export type DataType = 'image' | 'text'

/** 端口：节点的输入/输出接口，每个端口有固定类型 */
export interface Port {
  /** 端口唯一标识（节点内唯一） */
  id: string
  /** 端口数据类型，连接时校验 */
  type: DataType
  /** 端口显示名 */
  label?: string
}

/** 画布类型：场景画布 / 分镜画布 */
export type CanvasKind = 'stage' | 'scene'

/** 画布连线 */
export interface CanvasConnection {
  id: string
  fromNodeId: string
  fromPortId: string
  toNodeId: string
  toPortId: string
}

/** 节点配置（各原型自定义，见具体节点） */
export type NodeConfig = Record<string, unknown>

/** 持久化的节点数据（不含运行时方法） */
export interface CanvasNodeData {
  id: string
  prototypeId: string
  name: string
  x: number
  y: number
  width: number
  height: number
  config: NodeConfig
}

/** 画布定义（canvas.json 内容） */
export interface CanvasData {
  version: number
  kind: CanvasKind
  nodes: CanvasNodeData[]
  connections: CanvasConnection[]
  createdAt: string
  updatedAt: string
}

/** 当前 schema 版本 */
export const CANVAS_SCHEMA_VERSION = 1

/**
 * 生成唯一 id（优先 crypto.randomUUID，退化用时间戳+随机数）。
 *
 * @returns 唯一字符串
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 创建默认画布数据。
 *
 * @param kind 画布类型
 * @returns 空画布定义
 */
export function createCanvasData(kind: CanvasKind): CanvasData {
  const now = new Date().toISOString()
  return {
    version: CANVAS_SCHEMA_VERSION,
    kind,
    nodes: [],
    connections: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 计算下一版本号（历史长度 + 1）。
 *
 * @param history 历史版本列表
 * @returns 下一版本号
 */
export function nextVersion(history: { version: number }[]): number {
  return history.length + 1
}

/**
 * 读取时迁移/校验画布数据；结构不合法时抛出错误。
 *
 * @param raw 反序列化后的原始数据
 * @returns 规范化后的画布定义
 * @throws Error 当 raw 不是对象时
 */
export function migrateCanvasData(raw: unknown): CanvasData {
  if (!raw || typeof raw !== 'object') {
    throw new Error('画布数据格式错误')
  }
  const obj = raw as Partial<CanvasData>
  const kind: CanvasKind = obj.kind === 'scene' ? 'scene' : 'stage'
  return {
    version: CANVAS_SCHEMA_VERSION,
    kind,
    nodes: Array.isArray(obj.nodes) ? obj.nodes : [],
    connections: Array.isArray(obj.connections) ? obj.connections : [],
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
  }
}
```

- [ ] **Step 2: 创建 `frontend/src/canvas/types.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { CANVAS_SCHEMA_VERSION, createCanvasData, migrateCanvasData, newId, nextVersion } from './types'

describe('createCanvasData', () => {
  it('创建空画布且 version 为当前 schema', () => {
    const data = createCanvasData('scene')
    expect(data.kind).toBe('scene')
    expect(data.version).toBe(CANVAS_SCHEMA_VERSION)
    expect(data.nodes).toEqual([])
    expect(data.connections).toEqual([])
    expect(data.createdAt).toBeTruthy()
  })

  it('stage 类型同样生效', () => {
    expect(createCanvasData('stage').kind).toBe('stage')
  })
})

describe('nextVersion', () => {
  it('空历史返回 1', () => {
    expect(nextVersion([])).toBe(1)
  })

  it('3 条历史返回 4', () => {
    expect(nextVersion([{ version: 1 }, { version: 2 }, { version: 3 }])).toBe(4)
  })
})

describe('newId', () => {
  it('连续生成 id 不重复', () => {
    const ids = new Set([newId(), newId(), newId()])
    expect(ids.size).toBe(3)
  })
})

describe('migrateCanvasData', () => {
  it('合法数据原样迁移', () => {
    const raw = {
      version: 1,
      kind: 'scene',
      nodes: [{ id: 'a', prototypeId: 'text', name: 'x', x: 0, y: 0, width: 10, height: 10, config: {} }],
      connections: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const data = migrateCanvasData(raw)
    expect(data.nodes).toHaveLength(1)
    expect(data.connections).toEqual([])
  })

  it('非对象抛出错误', () => {
    expect(() => migrateCanvasData(null)).toThrow()
    expect(() => migrateCanvasData('str')).toThrow()
  })

  it('缺失字段补齐默认值', () => {
    const data = migrateCanvasData({ kind: 'stage' })
    expect(data.version).toBe(CANVAS_SCHEMA_VERSION)
    expect(data.nodes).toEqual([])
    expect(data.connections).toEqual([])
    expect(data.createdAt).toBeTruthy()
  })
})
```

- [ ] **Step 3: 运行测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npx vitest run src/canvas/types.test.ts
```
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/canvas/types.ts frontend/src/canvas/types.test.ts
git commit -m "feat: 画布数据模型（types）"
```

---

### Task 3: 节点原型注册表（registry.ts）

**Files:**
- Create: `frontend/src/canvas/registry.ts`
- Create: `frontend/src/canvas/registry.test.ts`

- [ ] **Step 1: 创建 `frontend/src/canvas/registry.ts`**

```ts
import type { Port } from './types'

/**
 * 节点原型：定义节点类型的端口与能力。
 *
 * bodyComponent / editorComponent（Vue 组件）由 Phase 3 接入，此处只定义数据。
 */
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
}

/** 内置节点原型注册表 */
export const NODE_PROTOTYPES: NodePrototype[] = [
  {
    id: 'image-loader',
    name: '加载图片',
    inputPorts: [],
    outputPorts: [{ id: 'out', type: 'image', label: '图片' }],
    resizeable: false,
  },
  {
    id: 'image-generate',
    name: '生成图片',
    inputPorts: [{ id: 'in', type: 'image', label: '参考图' }],
    outputPorts: [{ id: 'out', type: 'image', label: '图片' }],
    resizeable: true,
  },
  {
    id: 'text',
    name: '文本',
    inputPorts: [],
    outputPorts: [{ id: 'out', type: 'text', label: '文本' }],
    resizeable: true,
  },
]

/**
 * 按原型 id 查询节点原型。
 *
 * @param prototypeId 原型 id
 * @returns 原型或 undefined
 */
export function getPrototype(prototypeId: string): NodePrototype | undefined {
  return NODE_PROTOTYPES.find((p) => p.id === prototypeId)
}
```

- [ ] **Step 2: 创建 `frontend/src/canvas/registry.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { getPrototype, NODE_PROTOTYPES } from './registry'

describe('NODE_PROTOTYPES', () => {
  it('包含三个内置节点', () => {
    expect(NODE_PROTOTYPES.map((p) => p.id).sort()).toEqual(['image-generate', 'image-loader', 'text'])
  })

  it('生成图片只接受 image 输入，输出 image', () => {
    const p = getPrototype('image-generate')!
    expect(p.inputPorts.every((port) => port.type === 'image')).toBe(true)
    expect(p.outputPorts[0].type).toBe('image')
  })

  it('文本输出 text 类型', () => {
    expect(getPrototype('text')!.outputPorts[0].type).toBe('text')
  })
})

describe('getPrototype', () => {
  it('未知原型返回 undefined', () => {
    expect(getPrototype('unknown')).toBeUndefined()
  })
})
```

- [ ] **Step 3: 运行测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npx vitest run src/canvas/registry.test.ts
```
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/canvas/registry.ts frontend/src/canvas/registry.test.ts
git commit -m "feat: 节点原型注册表（类型化端口）"
```

---

### Task 4: 连接校验（connection.ts）

**Files:**
- Create: `frontend/src/canvas/connection.ts`
- Create: `frontend/src/canvas/connection.test.ts`

- [ ] **Step 1: 创建 `frontend/src/canvas/connection.ts`**

```ts
import type { CanvasConnection, CanvasNodeData, DataType } from './types'
import { getPrototype } from './registry'

/**
 * 连接校验（ComfyUI 思路）：按端口数据类型判断，而非按节点类型。
 */

/** 两个端口类型是否兼容（v1 仅支持同类型） */
export function canConnect(fromType: DataType, toType: DataType): boolean {
  return fromType === toType
}

/** 获取节点的输出端口类型（v1 每个节点单输出端口，取第一个） */
export function getNodeOutputType(nodeId: string, nodes: CanvasNodeData[]): DataType | undefined {
  const node = nodes.find((n) => n.id === nodeId)
  const proto = node ? getPrototype(node.prototypeId) : undefined
  return proto?.outputPorts[0]?.type
}

/** 获取节点的输入端口类型（v1 每个节点单输入端口，取第一个） */
export function getNodeInputType(nodeId: string, nodes: CanvasNodeData[]): DataType | undefined {
  const node = nodes.find((n) => n.id === nodeId)
  const proto = node ? getPrototype(node.prototypeId) : undefined
  return proto?.inputPorts[0]?.type
}

/** 获取节点的输出端口 id（v1 取第一个输出端口） */
export function getNodeOutputPortId(nodeId: string, nodes: CanvasNodeData[]): string | undefined {
  const node = nodes.find((n) => n.id === nodeId)
  const proto = node ? getPrototype(node.prototypeId) : undefined
  return proto?.outputPorts[0]?.id
}

/** 获取节点的输入端口 id（v1 取第一个输入端口） */
export function getNodeInputPortId(nodeId: string, nodes: CanvasNodeData[]): string | undefined {
  const node = nodes.find((n) => n.id === nodeId)
  const proto = node ? getPrototype(node.prototypeId) : undefined
  return proto?.inputPorts[0]?.id
}

/**
 * 判断新增 from→to 连线是否会形成循环（从 to 沿既有输出边可达 from 即成环）。
 *
 * @param connections 现有连线
 * @param fromNodeId 输出节点
 * @param toNodeId 输入节点
 * @returns 会成环返回 true
 */
export function wouldCreateCycle(
  connections: CanvasConnection[],
  fromNodeId: string,
  toNodeId: string,
): boolean {
  if (fromNodeId === toNodeId) return true
  const adjacency = new Map<string, string[]>()
  for (const c of connections) {
    const list = adjacency.get(c.fromNodeId) ?? []
    list.push(c.toNodeId)
    adjacency.set(c.fromNodeId, list)
  }
  const stack = [toNodeId]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (cur === fromNodeId) return true
    if (visited.has(cur)) continue
    visited.add(cur)
    for (const next of adjacency.get(cur) ?? []) stack.push(next)
  }
  return false
}

/**
 * 校验一条连线是否可建立：两端节点存在、类型兼容、且不成环。
 *
 * @param connections 现有连线
 * @param fromNodeId 输出节点 id
 * @param toNodeId 输入节点 id
 * @param nodes 画布全部节点
 * @returns 可建立返回 true
 */
export function canConnectNodes(
  connections: CanvasConnection[],
  fromNodeId: string,
  toNodeId: string,
  nodes: CanvasNodeData[],
): boolean {
  const outType = getNodeOutputType(fromNodeId, nodes)
  const inType = getNodeInputType(toNodeId, nodes)
  if (!outType || !inType) return false
  if (!canConnect(outType, inType)) return false
  return !wouldCreateCycle(connections, fromNodeId, toNodeId)
}
```

- [ ] **Step 2: 创建 `frontend/src/canvas/connection.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import type { CanvasConnection, CanvasNodeData } from './types'
import { canConnect, canConnectNodes, getNodeInputType, getNodeOutputType, wouldCreateCycle } from './connection'

const nodes: CanvasNodeData[] = [
  { id: 'loader', prototypeId: 'image-loader', name: '加载', x: 0, y: 0, width: 10, height: 10, config: {} },
  { id: 'gen', prototypeId: 'image-generate', name: '生成', x: 0, y: 0, width: 10, height: 10, config: {} },
  { id: 'text', prototypeId: 'text', name: '文本', x: 0, y: 0, width: 10, height: 10, config: {} },
]

describe('canConnect', () => {
  it('同类型兼容', () => {
    expect(canConnect('image', 'image')).toBe(true)
    expect(canConnect('text', 'text')).toBe(true)
  })

  it('不同类型不兼容', () => {
    expect(canConnect('image', 'text')).toBe(false)
  })
})

describe('getNodeOutputType / getNodeInputType', () => {
  it('加载图片输出 image', () => {
    expect(getNodeOutputType('loader', nodes)).toBe('image')
  })

  it('生成图片输入 image', () => {
    expect(getNodeInputType('gen', nodes)).toBe('image')
  })

  it('文本输出 text', () => {
    expect(getNodeOutputType('text', nodes)).toBe('text')
  })

  it('未知节点返回 undefined', () => {
    expect(getNodeOutputType('nope', nodes)).toBeUndefined()
  })
})

describe('wouldCreateCycle', () => {
  it('自身连接成环', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true)
  })

  it('直接反向连接成环', () => {
    const conns: CanvasConnection[] = [{ id: 'c1', fromNodeId: 'a', fromPortId: 'o', toNodeId: 'b', toPortId: 'i' }]
    expect(wouldCreateCycle(conns, 'b', 'a')).toBe(true)
  })

  it('长链反向连接成环', () => {
    const conns: CanvasConnection[] = [
      { id: 'c1', fromNodeId: 'a', fromPortId: 'o', toNodeId: 'b', toPortId: 'i' },
      { id: 'c2', fromNodeId: 'b', fromPortId: 'o', toNodeId: 'c', toPortId: 'i' },
    ]
    expect(wouldCreateCycle(conns, 'c', 'a')).toBe(true)
  })

  it('无环路径返回 false', () => {
    const conns: CanvasConnection[] = [{ id: 'c1', fromNodeId: 'a', fromPortId: 'o', toNodeId: 'b', toPortId: 'i' }]
    expect(wouldCreateCycle(conns, 'a', 'b')).toBe(false)
  })
})

describe('canConnectNodes', () => {
  it('加载图片(image) → 生成图片(image) 可连接', () => {
    expect(canConnectNodes([], 'loader', 'gen', nodes)).toBe(true)
  })

  it('文本(text) → 生成图片(image) 类型不兼容', () => {
    expect(canConnectNodes([], 'text', 'gen', nodes)).toBe(false)
  })

  it('生成图片(image) → 加载图片(无输入) 不可连接', () => {
    expect(canConnectNodes([], 'gen', 'loader', nodes)).toBe(false)
  })

  it('成环时不可连接', () => {
    const conns: CanvasConnection[] = [{ id: 'c1', fromNodeId: 'gen', fromPortId: 'o', toNodeId: 'loader', toPortId: 'i' }]
    expect(canConnectNodes(conns, 'loader', 'gen', nodes)).toBe(false)
  })
})
```

- [ ] **Step 3: 运行测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npx vitest run src/canvas/connection.test.ts
```
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/canvas/connection.ts frontend/src/canvas/connection.test.ts
git commit -m "feat: 连接校验（类型兼容 + 防循环）"
```

---

### Task 5: 路径与预览工具（paths.ts / preview.ts）

**Files:**
- Create: `frontend/src/canvas/paths.ts`
- Create: `frontend/src/canvas/preview.ts`
- Create: `frontend/src/canvas/paths.test.ts`
- Create: `frontend/src/canvas/preview.test.ts`

- [ ] **Step 1: 创建 `frontend/src/canvas/paths.ts`**

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
  /** scene 时为分镜号；stage 时为空 */
  secondary?: string
}

/** 场景画布定义文件：prompt/stage/{场景名}/canvas.json */
export function stageCanvasRelPath(stage: string): string {
  return `prompt/stage/${stage}/canvas.json`
}

/** 分镜画布定义文件：prompt/scene/{集数}/{分镜}/canvas.json */
export function sceneCanvasRelPath(episode: string, shot: string): string {
  return `prompt/scene/${episode}/${shot}/canvas.json`
}

/** 画布生成产物目录：assert/{scope}/canvas/ */
export function canvasAssetDir(scope: CanvasScope): string {
  if (scope.kind === 'stage') {
    return `assert/stage/${scope.primary}/canvas`
  }
  return `assert/scene/${scope.primary}/${scope.secondary ?? ''}/canvas`
}

/** 节点产物路径：assert/{scope}/canvas/{nodeId}/v{n}.jpg */
export function canvasNodeAssetPath(scope: CanvasScope, nodeId: string, version: number): string {
  return `${canvasAssetDir(scope)}/${nodeId}/v${version}.jpg`
}
```

- [ ] **Step 2: 创建 `frontend/src/canvas/preview.ts`**

```ts
/**
 * 画布资产预览 URL 工具。
 * 沿用全项目约定：/api/fs/{project}/{relPath}?t=... 防缓存。
 */

/**
 * 构建资产预览 URL。
 *
 * @param project 项目名
 * @param relPath 项目内相对路径（assert/ 下）
 * @param version 可选版本号；提供时作为缓存键（版本变化即刷新缓存）
 * @returns 预览 URL
 */
export function buildPreviewUrl(project: string, relPath: string, version?: number): string {
  const base = `/api/fs/${project}/${relPath}`
  if (version != null) {
    return `${base}?t=v${version}`
  }
  return `${base}?t=${Date.now()}`
}
```

- [ ] **Step 3: 创建 `frontend/src/canvas/paths.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { canvasAssetDir, canvasNodeAssetPath, sceneCanvasRelPath, stageCanvasRelPath } from './paths'

describe('stageCanvasRelPath', () => {
  it('返回场景画布定义路径', () => {
    expect(stageCanvasRelPath('便利店内部')).toBe('prompt/stage/便利店内部/canvas.json')
  })
})

describe('sceneCanvasRelPath', () => {
  it('返回分镜画布定义路径', () => {
    expect(sceneCanvasRelPath('1', '3')).toBe('prompt/scene/1/3/canvas.json')
  })
})

describe('canvasAssetDir', () => {
  it('场景画布产物目录', () => {
    expect(canvasAssetDir({ kind: 'stage', primary: '便利店内部' })).toBe('assert/stage/便利店内部/canvas')
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

- [ ] **Step 4: 创建 `frontend/src/canvas/preview.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { buildPreviewUrl } from './preview'

describe('buildPreviewUrl', () => {
  it('无版本时以时间戳防缓存', () => {
    const url = buildPreviewUrl('AI的第一天', 'assert/scene/1/1/canvas/a.jpg')
    expect(url.startsWith('/api/fs/AI的第一天/assert/scene/1/1/canvas/a.jpg?t=')).toBe(true)
  })

  it('带版本时以版本作缓存键', () => {
    expect(buildPreviewUrl('p', 'assert/a/b.jpg', 3)).toBe('/api/fs/p/assert/a/b.jpg?t=v3')
  })
})
```

- [ ] **Step 5: 运行测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npx vitest run src/canvas/paths.test.ts src/canvas/preview.test.ts
```
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/canvas/paths.ts frontend/src/canvas/preview.ts frontend/src/canvas/paths.test.ts frontend/src/canvas/preview.test.ts
git commit -m "feat: 画布路径与预览 URL 工具"
```

---

### Task 6: canvas.json 读写（api.ts）

**Files:**
- Create: `frontend/src/canvas/api.ts`
- Create: `frontend/src/canvas/api.test.ts`

- [ ] **Step 1: 创建 `frontend/src/canvas/api.ts`**

```ts
import { readFs, writeFs } from '../api/client'
import { migrateCanvasData, type CanvasData, type CanvasKind } from './types'
import { sceneCanvasRelPath, stageCanvasRelPath } from './paths'

/** 画布目标：定位某张画布 */
export interface CanvasTarget {
  kind: CanvasKind
  /** stage 画布时的场景名 */
  stage?: string
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
    return stageCanvasRelPath(target.stage)
  }
  if (!target.episode || !target.shot) throw new Error('分镜画布需要 episode 与 shot')
  return sceneCanvasRelPath(target.episode, target.shot)
}

/**
 * 加载画布定义；文件不存在或解析失败时返回 null。
 *
 * @param project 项目名
 * @param target 画布目标
 * @returns 画布定义或 null
 */
export async function loadCanvas(project: string, target: CanvasTarget): Promise<CanvasData | null> {
  const rel = canvasRelPath(target)
  try {
    const raw = await readFs(project, rel)
    if (typeof raw !== 'string' || raw.trim() === '') return null
    return migrateCanvasData(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

/**
 * 保存画布定义（写入 canvas.json）。
 *
 * @param project 项目名
 * @param target 画布目标
 * @param data 画布定义
 */
export async function saveCanvas(project: string, target: CanvasTarget, data: CanvasData): Promise<void> {
  const rel = canvasRelPath(target)
  await writeFs(project, rel, JSON.stringify(data, null, 2))
}
```

- [ ] **Step 2: 创建 `frontend/src/canvas/api.test.ts`**

```ts
import { describe, expect, it, vi, type Mock } from 'vitest'
import { canvasRelPath, loadCanvas, saveCanvas } from './api'

vi.mock('../api/client', () => ({
  readFs: vi.fn(),
  writeFs: vi.fn(),
}))

import { readFs, writeFs } from '../api/client'

const validRaw = JSON.stringify({
  version: 1,
  kind: 'scene',
  nodes: [],
  connections: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('canvasRelPath', () => {
  it('场景画布路径', () => {
    expect(canvasRelPath({ kind: 'stage', stage: '街角' })).toBe('prompt/stage/街角/canvas.json')
  })

  it('分镜画布路径', () => {
    expect(canvasRelPath({ kind: 'scene', episode: '2', shot: '5' })).toBe('prompt/scene/2/5/canvas.json')
  })

  it('缺少 stage 抛错', () => {
    expect(() => canvasRelPath({ kind: 'stage' })).toThrow()
  })

  it('缺少 episode/shot 抛错', () => {
    expect(() => canvasRelPath({ kind: 'scene', episode: '1' })).toThrow()
  })
})

describe('loadCanvas', () => {
  it('读取并解析合法 JSON', async () => {
    (readFs as Mock).mockResolvedValue(validRaw)
    const data = await loadCanvas('p', { kind: 'scene', episode: '1', shot: '1' })
    expect(data?.kind).toBe('scene')
    expect(data?.nodes).toEqual([])
  })

  it('文件不存在返回 null', async () => {
    (readFs as Mock).mockRejectedValue(new Error('ENOENT'))
    const data = await loadCanvas('p', { kind: 'scene', episode: '1', shot: '1' })
    expect(data).toBeNull()
  })

  it('非法 JSON 返回 null', async () => {
    (readFs as Mock).mockResolvedValue('not json{{{')
    const data = await loadCanvas('p', { kind: 'scene', episode: '1', shot: '1' })
    expect(data).toBeNull()
  })
})

describe('saveCanvas', () => {
  it('序列化写入 canvas.json', async () => {
    (writeFs as Mock).mockResolvedValue({ success: true })
    const data = { ...(JSON.parse(validRaw) as object), nodes: [], connections: [] }
    await saveCanvas('p', { kind: 'scene', episode: '1', shot: '1' }, data as never)
    expect(writeFs).toHaveBeenCalledWith('p', 'prompt/scene/1/1/canvas.json', expect.stringContaining('"kind":"scene"'))
  })
})
```

- [ ] **Step 3: 运行测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npx vitest run src/canvas/api.test.ts
```
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/canvas/api.ts frontend/src/canvas/api.test.ts
git commit -m "feat: canvas.json 读写 API"
```

---

### Task 7: 画布状态 store（useCanvasStore.ts）

**Files:**
- Create: `frontend/src/canvas/useCanvasStore.ts`
- Create: `frontend/src/canvas/useCanvasStore.test.ts`

- [ ] **Step 1: 创建 `frontend/src/canvas/useCanvasStore.ts`**

```ts
import { computed, ref } from 'vue'
import { createCanvasData, newId, type CanvasConnection, type CanvasData, type CanvasNodeData } from './types'
import { loadCanvas, saveCanvas, type CanvasTarget } from './api'
import { canConnectNodes, getNodeInputPortId, getNodeOutputPortId } from './connection'
import { getPrototype } from './registry'

/** 自动保存防抖毫秒数 */
const SAVE_DEBOUNCE_MS = 800

/**
 * 画布状态管理：加载/保存（防抖自动保存）、节点与连线的增删改查、连接校验。
 *
 * @param project 项目名
 * @param target 画布目标
 */
export function useCanvasStore(project: string, target: CanvasTarget) {
  const data = ref<CanvasData>(createCanvasData(target.kind))
  const loaded = ref(false)
  const dirty = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const nodes = computed(() => data.value.nodes)
  const connections = computed(() => data.value.connections)

  /** 加载画布；不存在时保持空画布 */
  async function load(): Promise<void> {
    const existing = await loadCanvas(project, target)
    if (existing) {
      data.value = existing
    }
    loaded.value = true
  }

  function markDirty(): void {
    data.value.updatedAt = new Date().toISOString()
    dirty.value = true
    scheduleSave()
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void save()
    }, SAVE_DEBOUNCE_MS)
  }

  /** 立即保存画布定义 */
  async function save(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    saving.value = true
    try {
      await saveCanvas(project, target, data.value)
      dirty.value = false
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      saving.value = false
    }
  }

  /**
   * 添加节点。
   *
   * @param prototypeId 节点原型 id
   * @param x 画布 x 坐标
   * @param y 画布 y 坐标
   * @returns 新节点
   * @throws Error 未知原型时
   */
  function addNode(prototypeId: string, x: number, y: number): CanvasNodeData {
    const proto = getPrototype(prototypeId)
    if (!proto) throw new Error(`未知节点类型: ${prototypeId}`)
    const node: CanvasNodeData = {
      id: newId(),
      prototypeId,
      name: proto.name,
      x,
      y,
      width: 240,
      height: 160,
      config: {},
    }
    data.value.nodes.push(node)
    markDirty()
    return node
  }

  /**
   * 删除节点及其所有连线。
   *
   * @param nodeId 节点 id
   */
  function removeNode(nodeId: string): void {
    data.value.nodes = data.value.nodes.filter((n) => n.id !== nodeId)
    data.value.connections = data.value.connections.filter((c) => c.fromNodeId !== nodeId && c.toNodeId !== nodeId)
    markDirty()
  }

  /**
   * 局部更新节点（坐标、尺寸、名称、配置等）。
   *
   * @param nodeId 节点 id
   * @param patch 更新字段
   */
  function updateNode(nodeId: string, patch: Partial<CanvasNodeData>): void {
    const node = data.value.nodes.find((n) => n.id === nodeId)
    if (!node) return
    Object.assign(node, patch)
    markDirty()
  }

  /**
   * 建立连线（自动校验类型兼容与防循环）。
   *
   * @param fromNodeId 输出节点 id
   * @param toNodeId 输入节点 id
   * @returns 成功建立返回 true
   */
  function connect(fromNodeId: string, toNodeId: string): boolean {
    if (!canConnectNodes(data.value.connections, fromNodeId, toNodeId, data.value.nodes)) {
      return false
    }
    const connection: CanvasConnection = {
      id: newId(),
      fromNodeId,
      fromPortId: getNodeOutputPortId(fromNodeId, data.value.nodes) ?? 'out',
      toNodeId,
      toPortId: getNodeInputPortId(toNodeId, data.value.nodes) ?? 'in',
    }
    data.value.connections.push(connection)
    markDirty()
    return true
  }

  /**
   * 断开连线。
   *
   * @param connectionId 连线 id
   */
  function disconnect(connectionId: string): void {
    data.value.connections = data.value.connections.filter((c) => c.id !== connectionId)
    markDirty()
  }

  return {
    data,
    loaded,
    dirty,
    saving,
    error,
    nodes,
    connections,
    load,
    save,
    addNode,
    removeNode,
    updateNode,
    connect,
    disconnect,
  }
}
```

- [ ] **Step 2: 创建 `frontend/src/canvas/useCanvasStore.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useCanvasStore } from './useCanvasStore'

vi.mock('./api', () => ({
  loadCanvas: vi.fn(),
  saveCanvas: vi.fn(),
}))

import { loadCanvas, saveCanvas } from './api'

const TARGET = { kind: 'scene' as const, episode: '1', shot: '1' }

describe('useCanvasStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    ;(loadCanvas as Mock).mockResolvedValue(null)
    ;(saveCanvas as Mock).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('加载：文件不存在时保持空画布', async () => {
    const store = useCanvasStore('p', TARGET)
    await store.load()
    expect(store.loaded.value).toBe(true)
    expect(store.nodes.value).toHaveLength(0)
  })

  it('加载：存在时读取画布定义', async () => {
    const raw = {
      version: 1,
      kind: 'scene',
      nodes: [{ id: 'a', prototypeId: 'text', name: 'n', x: 0, y: 0, width: 10, height: 10, config: {} }],
      connections: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    ;(loadCanvas as Mock).mockResolvedValue(raw)
    const store = useCanvasStore('p', TARGET)
    await store.load()
    expect(store.nodes.value).toHaveLength(1)
  })

  it('addNode：添加节点并置脏、触发防抖保存', async () => {
    const store = useCanvasStore('p', TARGET)
    const node = store.addNode('image-loader', 10, 20)
    expect(store.nodes.value).toHaveLength(1)
    expect(node.prototypeId).toBe('image-loader')
    expect(node.x).toBe(10)
    expect(store.dirty.value).toBe(true)
    await vi.runAllTimersAsync()
    expect(saveCanvas).toHaveBeenCalledTimes(1)
    expect(store.dirty.value).toBe(false)
  })

  it('addNode：未知原型抛错', () => {
    const store = useCanvasStore('p', TARGET)
    expect(() => store.addNode('unknown', 0, 0)).toThrow()
  })

  it('removeNode：删除节点及其连线', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 0, 0)
    expect(store.connect(a.id, b.id)).toBe(true)
    store.removeNode(a.id)
    expect(store.nodes.value).toHaveLength(1)
    expect(store.connections.value).toHaveLength(0)
  })

  it('connect：类型不兼容拒绝', () => {
    const store = useCanvasStore('p', TARGET)
    const t = store.addNode('text', 0, 0)
    const g = store.addNode('image-generate', 0, 0)
    expect(store.connect(t.id, g.id)).toBe(false)
    expect(store.connections.value).toHaveLength(0)
  })

  it('connect：成环拒绝', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 0, 0)
    store.connect(a.id, b.id)
    expect(store.connect(b.id, a.id)).toBe(false)
  })

  it('connect：合法连接成功', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 0, 0)
    expect(store.connect(a.id, b.id)).toBe(true)
    expect(store.connections.value).toHaveLength(1)
  })

  it('updateNode：局部更新', () => {
    const store = useCanvasStore('p', TARGET)
    const node = store.addNode('text', 0, 0)
    store.updateNode(node.id, { name: '改名' })
    expect(store.nodes.value[0].name).toBe('改名')
  })
})
```

- [ ] **Step 3: 运行测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npx vitest run src/canvas/useCanvasStore.test.ts
```
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/canvas/useCanvasStore.ts frontend/src/canvas/useCanvasStore.test.ts
git commit -m "feat: 画布状态 store（加载/保存/节点与连线操作）"
```

---

### Task 8: 基础画布组件（AssetCanvas.vue）

**Files:**
- Create: `frontend/src/components/canvas/AssetCanvas.vue`

- [ ] **Step 1: 创建 `frontend/src/components/canvas/AssetCanvas.vue`**

```vue
<template>
  <div class="asset-canvas">
    <div class="asset-canvas__toolbar">
      <v-btn size="small" variant="text" icon="mdi-fit-to-screen-outline" title="适应视图" @click="fitView" />
      <v-btn size="small" variant="text" icon="mdi-plus" title="放大" @click="zoomIn" />
      <v-btn size="small" variant="text" icon="mdi-minus" title="缩小" @click="zoomOut" />
      <v-spacer />
      <v-progress-circular v-if="saving" size="18" indeterminate color="primary" />
      <span v-else-if="dirty" class="text-caption text-medium-emphasis">未保存</span>
      <span v-else class="text-caption text-disabled">已保存</span>
    </div>

    <div class="asset-canvas__flow">
      <VueFlow
        v-model:nodes="flowNodes"
        v-model:edges="flowEdges"
        :fit-view-on-init="true"
        :min-zoom="0.2"
        :max-zoom="3"
        :nodes-draggable="true"
        @node-click="onNodeClick"
        @pane-click="onPaneClick"
      >
        <Background :gap="16" />
        <template #node-default="{ data }">
          <div class="canvas-node">
            <div class="canvas-node__header">
              <span class="text-caption font-weight-medium">{{ data.label }}</span>
            </div>
            <div class="canvas-node__body">
              <span class="text-caption text-medium-emphasis">{{ data.typeLabel }}</span>
            </div>
          </div>
        </template>
      </VueFlow>
    </div>

    <div v-if="!loaded" class="asset-canvas__overlay">加载中…</div>
    <div v-else-if="nodes.length === 0" class="asset-canvas__overlay asset-canvas__empty">
      <div class="text-body-2">画布为空</div>
      <div class="text-caption text-medium-emphasis">双击空白处添加节点</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { VueFlow, useVueFlow, type Node as FlowNode, type Edge as FlowEdge } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { useCanvasStore } from '../../canvas/useCanvasStore'
import { getPrototype } from '../../canvas/registry'
import type { CanvasNodeData } from '../../canvas/types'

/** 组件 props：定位一张画布 */
const props = defineProps<{
  project: string
  kind: 'stage' | 'scene'
  stage?: string
  episode?: string
  shot?: string
}>()

const target = computed(() => ({
  kind: props.kind,
  stage: props.stage,
  episode: props.episode,
  shot: props.shot,
}))

const store = useCanvasStore(props.project, target.value)
const { loaded, nodes, connections, dirty, saving, addNode, removeNode, connect, disconnect } = store

const { fitView, zoomIn, zoomOut } = useVueFlow()

/** 节点 id → 类型标签 */
const typeLabelOf = (node: CanvasNodeData): string => getPrototype(node.prototypeId)?.name ?? node.prototypeId

const flowNodes = computed<FlowNode[]>(() =>
  nodes.value.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.name, typeLabel: typeLabelOf(n) },
    style: { width: `${n.width}px`, height: `${n.height}px` },
  })),
)

const flowEdges = computed<FlowEdge[]>(() =>
  connections.value.map((c) => ({
    id: c.id,
    source: c.fromNodeId,
    sourceHandle: c.fromPortId,
    target: c.toNodeId,
    targetHandle: c.toPortId,
    type: 'default',
  })),
)

/** 节点被拖动后回写坐标（Phase 3 完整接入，此处保证位置持久化） */
watch(
  flowNodes,
  (list) => {
    for (const n of list) {
      const node = nodes.value.find((x) => x.id === n.id)
      if (node && (node.x !== n.position.x || node.y !== n.position.y)) {
        node.x = Math.round(n.position.x)
        node.y = Math.round(n.position.y)
      }
    }
  },
  { deep: true },
)

function onNodeClick({ node }: { node: FlowNode }) {
  void node
}

function onPaneClick() {
  // Phase 3：空白点击关闭选中
}

onMounted(() => {
  void store.load()
})
</script>

<style scoped>
.asset-canvas {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.asset-canvas__toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}

.asset-canvas__flow {
  flex: 1;
  min-height: 0;
  position: relative;
}

.asset-canvas__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  pointer-events: none;
}

.asset-canvas__empty {
  pointer-events: none;
}

.canvas-node {
  width: 100%;
  height: 100%;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  background: #fff;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.canvas-node__header {
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.04);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.canvas-node__body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
```

> **说明**：本组件只做「渲染已有节点/连线 + 位置回写 + 加载/保存」，不包含拖拽建连等交互（Phase 3）。`@vue-flow/core` 的样式通过 css 导入引入。

- [ ] **Step 2: 运行 typecheck**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation
npm run typecheck
```
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/canvas/AssetCanvas.vue
git commit -m "feat: 基础画布组件（Vue Flow 渲染 + 位置持久化）"
```

---

### Task 9: 全量验证

**Files:**
- 无（纯验证）

- [ ] **Step 1: 运行全部前端测试**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npm test
```
Expected: 全部通过（含既有/新增测试）。

- [ ] **Step 2: 全仓 typecheck 与 lint**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation
npm run typecheck
npm run lint
```
Expected: 均无错误（lint 仅允许既有 warning）。

- [ ] **Step 3: 提交（如发现问题修复后）**

```bash
git add -A
git commit -m "fix: Phase2 收尾修复"
```
若无问题则跳过。

---

## 后续阶段（独立计划）

- **Phase 3 — 节点与交互**：节点 body/editor 组件（加载图片/生成图片/文本）、连线拖拽交互、节点右键菜单、复制粘贴、撤销重做、自动搭画布、「设为分镜场景图」、场景/分镜面板 Tab 集成、浏览器模拟操作测试。

## Self-Review

- **Spec coverage**：canva.md §4.2 类型系统（types/registry/connection）、§10.2 持久化模型（api/paths）、§10.3 预览（preview）、§5 节点实例持久化（types）、基础渲染（AssetCanvas.vue）均已覆盖。
- **Placeholder scan**：所有代码步骤完整，无 TBD/TODO。
- **Type consistency**：`CanvasKind`/`CanvasTarget`/`CanvasNodeData`/`CanvasConnection` 命名全计划一致；`loadCanvas`/`saveCanvas`/`useCanvasStore` 返回值与调用方一致。
