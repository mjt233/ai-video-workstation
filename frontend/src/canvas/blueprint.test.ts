import { describe, expect, it, vi } from 'vitest'
import type { CanvasConnection, CanvasGroupData, CanvasNodeData } from './types'
import {
  BLUEPRINT_SCHEMA_VERSION,
  blueprintBounds,
  blueprintSummary,
  captureBlueprintFromCanvas,
  defaultBlueprintName,
  instantiateBlueprint,
  isBlueprintEmpty,
  migrateBlueprint,
  stripRuntimeConfig,
} from './blueprint'
import { DEFAULT_GROUP_COLOR, GROUP_HEADER_HEIGHT, GROUP_MIN_SIZE } from './groups'
import { GROUP_FRAME_PADDING } from './groupSelection'

/** 构造最小节点数据 */
function makeNode(id: string, x: number, y: number, config: Record<string, unknown> = {}): CanvasNodeData {
  return { id, prototypeId: 'text', name: id, x, y, width: 240, height: 160, config }
}

/** 构造最小分组数据 */
function makeGroup(id: string, x: number, y: number, width = 400, height = 300): CanvasGroupData {
  return { id, name: id, color: DEFAULT_GROUP_COLOR, x, y, width, height }
}

/** 构造最小连线 */
function makeConn(id: string, from: string, to: string): CanvasConnection {
  return { id, fromNodeId: from, fromPortId: 'out', toNodeId: to, toPortId: 'in' }
}

describe('captureBlueprintFromCanvas', () => {
  const a = makeNode('a', 0, 0)
  const b = makeNode('b', 300, 0)
  const c = makeNode('c', 600, 0)

  it('只捕获选中节点与两端都在选中集内的连线', () => {
    const payload = captureBlueprintFromCanvas(
      { nodes: [a, b, c], connections: [makeConn('e1', 'a', 'b'), makeConn('e2', 'b', 'c')], groups: [] },
      ['a', 'b'],
    )
    expect(payload.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(payload.connections.map((e) => e.id)).toEqual(['e1'])
  })

  it('深拷贝：修改结果不影响原画布数据', () => {
    const payload = captureBlueprintFromCanvas({ nodes: [a], connections: [], groups: [] }, ['a'])
    payload.nodes[0].name = '改动'
    payload.nodes[0].config.assetPath = 'assert/x.jpg'
    expect(a.name).toBe('a')
    expect(a.config.assetPath).toBeUndefined()
  })

  it('分组未被选中时：即使组内节点全部选中，也不带入分组', () => {
    const g1 = makeGroup('g1', -20, -20) // 只覆盖 a
    const g2 = makeGroup('g2', 280, -20, 300, 300) // 只覆盖 b
    const payload = captureBlueprintFromCanvas(
      { nodes: [a, b, c], connections: [], groups: [g1, g2] },
      ['a', 'b'],
    )
    expect(payload.groups).toHaveLength(0)
  })

  it('分组被选中且成员节点全部选中时：收纳该分组', () => {
    const g1 = makeGroup('g1', -20, -20) // 只覆盖 a
    const g2 = makeGroup('g2', 280, -20, 300, 300) // 只覆盖 b
    const g3 = makeGroup('g3', -20, -20, 1000, 300) // 同时覆盖 a、b、c
    const payload = captureBlueprintFromCanvas(
      { nodes: [a, b, c], connections: [], groups: [g1, g2, g3] },
      ['a', 'b'],
      ['g1', 'g2'],
    )
    expect(payload.groups.map((g) => g.id)).toEqual(['g1', 'g2'])
  })

  it('分组被选中但存在成员节点未选中时：不收纳（避免半截分组）', () => {
    const g3 = makeGroup('g3', -20, -20, 1000, 300) // 同时覆盖 a、b、c
    const payload = captureBlueprintFromCanvas(
      { nodes: [a, b, c], connections: [], groups: [g3] },
      ['a', 'b'],
      ['g3'],
    )
    expect(payload.groups).toHaveLength(0)
  })

  it('空分组：未选中不收纳，显式选中则收纳', () => {
    const empty = makeGroup('g-empty', 5000, 5000)
    const notSelected = captureBlueprintFromCanvas(
      { nodes: [a], connections: [], groups: [empty] },
      ['a'],
    )
    expect(notSelected.groups).toHaveLength(0)
    const selected = captureBlueprintFromCanvas(
      { nodes: [a], connections: [], groups: [empty] },
      ['a'],
      ['g-empty'],
    )
    expect(selected.groups.map((g) => g.id)).toEqual(['g-empty'])
  })

  it('无选中节点时返回空载荷', () => {
    const payload = captureBlueprintFromCanvas({ nodes: [a], connections: [], groups: [] }, [])
    expect(payload).toEqual({ nodes: [], connections: [], groups: [] })
  })
})

describe('blueprintBounds', () => {
  it('取节点与分组的并集包围盒', () => {
    const rect = blueprintBounds({
      nodes: [makeNode('a', 100, 200)],
      connections: [],
      groups: [makeGroup('g', 50, 50, 100, 100)],
    })
    expect(rect).toEqual({ x: 50, y: 50, width: 290, height: 310 })
  })

  it('空内容返回 null', () => {
    expect(blueprintBounds({ nodes: [], connections: [], groups: [] })).toBeNull()
  })
})

describe('stripRuntimeConfig', () => {
  it('剥离 current / history / outputHistory，保留其余字段', () => {
    const out = stripRuntimeConfig({
      prompt: '提示词',
      inputOrder: ['x'],
      current: { path: 'assert/a.jpg' },
      history: [{ path: 'assert/b.jpg' }],
      outputHistory: [{ text: '旧文本' }],
    })
    expect(out).toEqual({ prompt: '提示词', inputOrder: ['x'] })
  })
})

describe('instantiateBlueprint', () => {
  it('归一化：内容包围盒左上角对齐 origin', () => {
    const out = instantiateBlueprint(
      { nodes: [makeNode('a', 100, 200), makeNode('b', 400, 260)], connections: [], groups: [] },
      { origin: { x: 1000, y: 500 } },
    )
    expect(out.nodes.map((n) => ({ x: n.x, y: n.y }))).toEqual([
      { x: 1000, y: 500 },
      { x: 1300, y: 560 },
    ])
  })

  it('id 全部重映射，连线端点指向新节点，配置引用同步重映射', () => {
    const nodes = [
      makeNode('a', 0, 0),
      makeNode('b', 300, 0, {
        inputOrder: ['a', 'external'],
        director: { imageClips: [{ sourceNodeId: 'a', at: 0 }], audioClips: [{ sourceNodeId: 'a' }] },
      }),
    ]
    const out = instantiateBlueprint({ nodes, connections: [makeConn('e1', 'a', 'b')], groups: [] }, { origin: { x: 0, y: 0 } })
    const newA = out.nodes[0].id
    const newB = out.nodes[1].id
    expect(newA).not.toBe('a')
    expect(newB).not.toBe('b')
    expect(out.connections[0]).toMatchObject({ fromNodeId: newA, toNodeId: newB, fromPortId: 'out', toPortId: 'in' })
    expect(out.connections[0].id).not.toBe('e1')
    const config = out.nodes[1].config as {
      inputOrder: string[]
      director: { imageClips: { sourceNodeId: string }[]; audioClips: { sourceNodeId: string }[] }
    }
    // 蓝图内的引用重映射到新 id；蓝图外的 id 保持原值
    expect(config.inputOrder).toEqual([newA, 'external'])
    expect(config.director.imageClips[0].sourceNodeId).toBe(newA)
    expect(config.director.audioClips[0].sourceNodeId).toBe(newA)
  })

  it('剥离产物/文本历史，资产路径原样保留', () => {
    const out = instantiateBlueprint(
      {
        nodes: [makeNode('a', 0, 0, {
          assetPath: 'assert/custom/canvas/1-a.png',
          current: { path: 'assert/x.jpg' },
          history: [{ path: 'assert/y.jpg' }],
          outputHistory: [{ text: 't' }],
        })],
        connections: [],
        groups: [],
      },
      { origin: { x: 0, y: 0 } },
    )
    expect(out.nodes[0].config).toEqual({ assetPath: 'assert/custom/canvas/1-a.png' })
  })

  it('以独立分组插入：外层分组名为蓝图名、节点全部落在分组矩形内、原分组同步平移', () => {
    const inner = makeGroup('g', -20, -20, 700, 220)
    const out = instantiateBlueprint(
      { nodes: [makeNode('a', 0, 0), makeNode('b', 300, 0)], connections: [], groups: [inner] },
      { origin: { x: 500, y: 400 }, asGroup: true, groupName: '角色三视图' },
    )
    expect(out.groups).toHaveLength(2)
    const outer = out.groups[0]
    expect(outer.name).toBe('角色三视图')
    expect(outer.color).toBe(DEFAULT_GROUP_COLOR)
    expect(outer).toMatchObject({ x: 500, y: 400 })
    // 内容包围盒 = 节点 ∪ 蓝图内分组：x -20..680（宽 700）、y -20..200（高 220）
    // 尺寸 = 包围盒 + 左右 12px×2 + 顶部 12 + 28px（标题条）
    expect(outer.width).toBe(700 + GROUP_FRAME_PADDING * 2)
    expect(outer.height).toBe(220 + GROUP_FRAME_PADDING * 2 + GROUP_HEADER_HEIGHT)
    // 最上方内容（此处为蓝图内分组）顶边距分组顶边 = padding + topInset = 40px（不被标题条压住）
    const contentTop = Math.min(...out.nodes.map((n) => n.y), ...out.groups.slice(1).map((g) => g.y))
    expect(contentTop - outer.y).toBe(GROUP_FRAME_PADDING + GROUP_HEADER_HEIGHT)
    for (const node of out.nodes) {
      expect(node.x).toBeGreaterThan(outer.x)
      expect(node.y).toBeGreaterThan(outer.y)
      expect(node.x + node.width).toBeLessThan(outer.x + outer.width)
      expect(node.y + node.height).toBeLessThan(outer.y + outer.height)
    }
    // 原分组的相对位置保持（与节点同一位移）
    const shifted = out.groups[1]
    expect(shifted.x - inner.x).toBe(out.nodes[0].x - 0)
    expect(shifted.y - inner.y).toBe(out.nodes[0].y - 0)
    expect(shifted.id).not.toBe(inner.id)
  })

  it('独立分组：topInset 可覆盖（0 表示不预留标题条空间）', () => {
    const out = instantiateBlueprint(
      { nodes: [makeNode('a', 0, 0), makeNode('b', 300, 0)], connections: [], groups: [] },
      { origin: { x: 0, y: 0 }, asGroup: true, topInset: 0 },
    )
    const outer = out.groups[0]
    expect(outer.height).toBe(160 + GROUP_FRAME_PADDING * 2)
    expect(Math.min(...out.nodes.map((n) => n.y)) - outer.y).toBe(GROUP_FRAME_PADDING)
  })

  it('独立分组：内容不足最小尺寸时顶部间距不小于 padding + topInset', () => {
    const small: CanvasNodeData = { id: 'a', prototypeId: 'text', name: 'a', x: 0, y: 0, width: 40, height: 20, config: {} }
    const out = instantiateBlueprint(
      { nodes: [small], connections: [], groups: [] },
      { origin: { x: 0, y: 0 }, asGroup: true },
    )
    const outer = out.groups[0]
    expect(outer).toMatchObject({ width: GROUP_MIN_SIZE.width, height: GROUP_MIN_SIZE.height })
    expect(out.nodes[0].y - outer.y).toBeGreaterThanOrEqual(GROUP_FRAME_PADDING + GROUP_HEADER_HEIGHT)
  })

  it('未创建独立分组时不产生分组', () => {
    const out = instantiateBlueprint(
      { nodes: [makeNode('a', 10, 10)], connections: [], groups: [] },
      { origin: { x: 0, y: 0 } },
    )
    expect(out.groups).toHaveLength(0)
  })

  it('丢弃端点缺失的连线并支持空蓝图', () => {
    const out = instantiateBlueprint(
      { nodes: [makeNode('a', 0, 0)], connections: [makeConn('e', 'a', 'missing')], groups: [] },
      { origin: { x: 0, y: 0 } },
    )
    expect(out.connections).toHaveLength(0)
    expect(instantiateBlueprint({ nodes: [], connections: [], groups: [] }, { origin: { x: 0, y: 0 } }))
      .toEqual({ nodes: [], connections: [], groups: [] })
  })
})

describe('defaultBlueprintName', () => {
  it('取最小未占用编号', () => {
    expect(defaultBlueprintName([])).toBe('蓝图 1')
    expect(defaultBlueprintName([{ name: '蓝图 1' }, { name: '蓝图2' }])).toBe('蓝图 3')
    expect(defaultBlueprintName([{ name: '自定义' }])).toBe('蓝图 1')
  })
})

describe('blueprintSummary', () => {
  it('统计数量与原型分布', () => {
    const summary = blueprintSummary({
      nodes: [makeNode('a', 0, 0), makeNode('b', 300, 0), { ...makeNode('c', 600, 0), prototypeId: 'image-generate' }],
      connections: [makeConn('e1', 'a', 'b')],
      groups: [makeGroup('g', 0, 0)],
    })
    expect(summary.nodeCount).toBe(3)
    expect(summary.connectionCount).toBe(1)
    expect(summary.groupCount).toBe(1)
    expect(summary.prototypeCounts).toEqual({ text: 2, 'image-generate': 1 })
  })
})

describe('migrateBlueprint', () => {
  it('规范化字段并补齐默认值', () => {
    const bp = migrateBlueprint({ id: 'x', name: '  名称  ', nodes: [makeNode('a', 0, 0)], assetProject: ' P ' })
    expect(bp).not.toBeNull()
    expect(bp?.version).toBe(BLUEPRINT_SCHEMA_VERSION)
    expect(bp?.name).toBe('名称')
    expect(bp?.assetProject).toBe('P')
    expect(bp?.description).toBe('')
    expect(bp?.connections).toEqual([])
    expect(bp?.groups).toEqual([])
  })

  it('丢弃结构非法的节点/连线/分组并输出警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bp = migrateBlueprint({
      name: 'x',
      nodes: [makeNode('a', 0, 0), { id: 'bad' }],
      connections: [makeConn('e1', 'a', 'a'), { id: 'e2' }, makeConn('e3', 'a', 'missing')],
      groups: [{ id: 'g' }],
    })
    warn.mockRestore()
    expect(bp?.nodes.map((n) => n.id)).toEqual(['a'])
    expect(bp?.connections.map((e) => e.id)).toEqual(['e1'])
    expect(bp?.groups).toEqual([])
  })

  it('assetProject 为空串/非字符串时归一化为 null', () => {
    expect(migrateBlueprint({ name: 'x', nodes: [], assetProject: '  ' })?.assetProject).toBeNull()
    expect(migrateBlueprint({ name: 'x', nodes: [], assetProject: 123 })?.assetProject).toBeNull()
  })

  it('整体非法时返回 null', () => {
    expect(migrateBlueprint(null)).toBeNull()
    expect(migrateBlueprint('text')).toBeNull()
    expect(migrateBlueprint([])).toBeNull()
  })
})

describe('isBlueprintEmpty', () => {
  it('无节点视为空', () => {
    expect(isBlueprintEmpty({ nodes: [], connections: [], groups: [makeGroup('g', 0, 0)] })).toBe(true)
    expect(isBlueprintEmpty({ nodes: [makeNode('a', 0, 0)], connections: [], groups: [] })).toBe(false)
  })
})
