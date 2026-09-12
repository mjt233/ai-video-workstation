/**
 * 粘贴落点纯逻辑单测：零重叠保证、碰撞探测、兜底路径与载荷实例化。
 *
 * 背景（见 `pastePlacement.ts` 模块注释）：分组成员关系由几何重叠实时派生，
 * 副本一旦压住原件就会导致「拖 A 带走 B」，故落点必须与画布已有内容零重叠。
 */

import { describe, expect, it } from 'vitest'
import {
  PASTE_CASCADE_GAP,
  PASTE_CLEARANCE,
  PASTE_PROBE_LANES,
  PASTE_PROBE_LIMIT,
  PASTE_PROBE_STEP,
  clipboardBounds,
  clipboardPlacementOffset,
  instantiateClipboard,
} from './pastePlacement'
import { DEFAULT_GROUP_COLOR, rectsOverlap, type RectLike } from './groups'
import type { CanvasGroupData, CanvasNodeData } from './types'
import type { NodeClipboardPayload } from './nodeClipboard'

/** 构造最小节点数据 */
function makeNode(id: string, x: number, y: number, width = 240, height = 160): CanvasNodeData {
  return { id, prototypeId: 'text', name: id, x, y, width, height, config: {} }
}

/** 构造最小分组数据 */
function makeGroup(id: string, x: number, y: number, width = 400, height = 300): CanvasGroupData {
  return { id, name: id, color: DEFAULT_GROUP_COLOR, x, y, width, height }
}

/** 构造粘贴载荷 */
function makePayload(
  nodes: CanvasNodeData[],
  groups: CanvasGroupData[] = [],
  connections: NodeClipboardPayload['connections'] = [],
): NodeClipboardPayload {
  return { nodes, connections, groups }
}

/**
 * 断言「按落点平移后的载荷」与给出的占用矩形全部零重叠。
 *
 * @param payload 粘贴载荷（源坐标）
 * @param offset 落点平移量
 * @param occupied 占用矩形列表
 */
function expectZeroOverlap(payload: NodeClipboardPayload, offset: { x: number; y: number }, occupied: RectLike[]): void {
  expectRectsZeroOverlap(shiftRects([...payload.nodes, ...payload.groups], offset), occupied)
}

/**
 * 断言落点与占用矩形之间留有净距：把占用矩形按 `PASTE_CLEARANCE` 外扩后仍不相交
 * （即不允许「贴边紧邻」——贴边后轻推十几像素就会变成重叠）。
 *
 * @param payload 粘贴载荷（源坐标）
 * @param offset 落点平移量
 * @param occupied 占用矩形列表
 */
function expectClearance(payload: NodeClipboardPayload, offset: { x: number; y: number }, occupied: RectLike[]): void {
  const inflated = occupied.map((r) => ({
    x: r.x - PASTE_CLEARANCE,
    y: r.y - PASTE_CLEARANCE,
    width: r.width + PASTE_CLEARANCE * 2,
    height: r.height + PASTE_CLEARANCE * 2,
  }))
  expectRectsZeroOverlap(shiftRects([...payload.nodes, ...payload.groups], offset), inflated)
}

/**
 * 按平移量换算矩形列表（仅取几何字段）。
 *
 * @param rects 源矩形列表
 * @param offset 平移量
 * @returns 平移后的矩形列表
 */
function shiftRects(rects: readonly RectLike[], offset: { x: number; y: number }): RectLike[] {
  return rects.map((r) => ({ x: r.x + Math.round(offset.x), y: r.y + Math.round(offset.y), width: r.width, height: r.height }))
}

/**
 * 断言两组矩形两两零重叠。
 *
 * @param placed 第一组矩形（副本）
 * @param occupied 第二组矩形（占用内容）
 */
function expectRectsZeroOverlap(placed: readonly RectLike[], occupied: readonly RectLike[]): void {
  for (const placedRect of placed) {
    for (const occupiedRect of occupied) {
      expect(rectsOverlap(placedRect, occupiedRect)).toBe(false)
    }
  }
}

describe('clipboardBounds', () => {
  it('节点 ∪ 分组的并集包围盒', () => {
    const node = makeNode('n', 20, 30, 240, 160)
    const group = makeGroup('g', 0, 0, 400, 300)
    expect(clipboardBounds(makePayload([node], [group]))).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })

  it('分组外的散节点同样计入包围盒', () => {
    const node = makeNode('n', 500, 600, 240, 160)
    const group = makeGroup('g', 0, 0, 400, 300)
    expect(clipboardBounds(makePayload([node], [group]))).toEqual({ x: 0, y: 0, width: 740, height: 760 })
  })

  it('空内容返回 null', () => {
    expect(clipboardBounds(makePayload([]))).toBeNull()
  })
})

describe('clipboardPlacementOffset：首选错位落点', () => {
  it('分组 + 组内节点：副本分组与源分组零重叠（历史 30px 固定偏移的修复核心）', () => {
    const node = makeNode('n', 20, 30)
    const group = makeGroup('g', 0, 0, 400, 300)
    const payload = makePayload([node], [group])
    const placement = clipboardPlacementOffset(payload, { nodes: [node], groups: [group] })
    // 偏移 = 源内容包围盒尺寸 + 间隙
    expect(placement.offset).toEqual({ x: 400 + PASTE_CASCADE_GAP, y: 300 + PASTE_CASCADE_GAP })
    expect(placement.cascaded).toBe(false)
    expectZeroOverlap(payload, placement.offset, [node, group])
    expectClearance(payload, placement.offset, [node, group])
  })

  it('载荷含分组但分组内无节点：仍走避让落点（不与源分组重叠）', () => {
    const group = makeGroup('g', 0, 0, 400, 300)
    const payload = makePayload([], [group])
    const placement = clipboardPlacementOffset(payload, { groups: [group] })
    expect(placement.offset).toEqual({ x: 400 + PASTE_CASCADE_GAP, y: 300 + PASTE_CASCADE_GAP })
    expect(placement.cascaded).toBe(false)
    expectZeroOverlap(payload, placement.offset, [group])
    expectClearance(payload, placement.offset, [group])
  })

  it('仅复制节点（无分组）：回到历史固定 30px 偏移，不做避让', () => {
    const node = makeNode('n', 0, 0)
    const placement = clipboardPlacementOffset(makePayload([node]), { nodes: [node] })
    expect(placement).toEqual({ offset: { x: PASTE_CASCADE_GAP, y: PASTE_CASCADE_GAP }, cascaded: false })
    // 固定偏移与节点尺寸、画布占用无关
    const big = makeNode('big', 200, 300, 1000, 800)
    expect(clipboardPlacementOffset(makePayload([big]), { nodes: [big] }).offset).toEqual({
      x: PASTE_CASCADE_GAP,
      y: PASTE_CASCADE_GAP,
    })
    const blocker = makeGroup('other', 10, 10, 400, 300)
    expect(clipboardPlacementOffset(makePayload([node]), { nodes: [node], groups: [blocker] }).offset).toEqual({
      x: PASTE_CASCADE_GAP,
      y: PASTE_CASCADE_GAP,
    })
  })

  it('仅复制节点：连续粘贴各再偏移 30px（第二份落在 +60，与历史行为一致）', () => {
    const node = makeNode('n', 0, 0)
    const first = clipboardPlacementOffset(makePayload([node]), { nodes: [node] })
    const placed: CanvasNodeData = { ...node, x: node.x + first.offset.x, y: node.y + first.offset.y }
    const second = clipboardPlacementOffset(makePayload([placed]), { nodes: [node, placed] })
    expect(second.offset).toEqual({ x: PASTE_CASCADE_GAP, y: PASTE_CASCADE_GAP })
    expect(second.cascaded).toBe(false)
    expect({ x: placed.x + second.offset.x, y: placed.y + second.offset.y }).toEqual({
      x: PASTE_CASCADE_GAP * 2,
      y: PASTE_CASCADE_GAP * 2,
    })
  })

  it('空画布（无占用内容）：含分组时仍按首选错位落点，不与源内容重叠', () => {
    const node = makeNode('n', 0, 0)
    const group = makeGroup('g', -20, -40, 400, 300)
    const placement = clipboardPlacementOffset(makePayload([node], [group]), {})
    expect(placement.cascaded).toBe(false)
    expectZeroOverlap(makePayload([node], [group]), placement.offset, [node, group])
  })

  it('无内容可粘贴：零偏移且未挪动', () => {
    expect(clipboardPlacementOffset(makePayload([]), {})).toEqual({ offset: { x: 0, y: 0 }, cascaded: false })
  })
})

describe('clipboardPlacementOffset：碰撞探测', () => {
  it('首选落点被已有分组占据时向右逐级探测（步长 = PASTE_PROBE_STEP）', () => {
    const node = makeNode('n', 0, 0, 100, 100)
    // 避让仅作用于「含分组」载荷：这里带一个远离落点的小分组保证走避让路径
    // （该分组占 x[-20,40]、y[-20,40]，不与 blocker 相交，故不干扰下面的推演）
    const own = makeGroup('own', -20, -20, 60, 60)
    const source = makePayload([node], [own])
    const bounds = clipboardBounds(source)!
    expect(bounds).toEqual({ x: -20, y: -20, width: 120, height: 120 })
    // blocker 占 x[120,220]：首选落点 x[-20,100] + 150 = [130,250] 与之重叠；
    // 因净距要求（判定时外扩 30）需连推 4 步才脱离，落点 = 首选 150 + 30 × 4 = 270
    const blocker = makeGroup('other', 120, 100, 100, 200)
    const placement = clipboardPlacementOffset(source, { nodes: [node], groups: [own, blocker] })
    expect(placement.cascaded).toBe(true)
    expect(placement.offset).toEqual({ x: 270, y: 150 })
    expect(placement.offset.x).toBe(bounds.width + PASTE_CASCADE_GAP + PASTE_PROBE_STEP * 4)
    expectZeroOverlap(source, placement.offset, [node, own, blocker])
    expectClearance(source, placement.offset, [node, own, blocker])
  })

  it('未知占用内容导致首选落点与全部探测点都相交时走兜底：仍零重叠且有净距', () => {
    const node = makeNode('n', 0, 0, 100, 100)
    // 同上：带一个远离落点的小分组以进入避让路径
    const own = makeGroup('own', -20, -20, 60, 60)
    const source = makePayload([node], [own])
    // 覆盖首选落点右侧全部探测范围（含换泳道后的 y 范围）的巨大分组
    const wall = makeGroup('wall', 130, 130, PASTE_PROBE_STEP * (PASTE_PROBE_LIMIT + 2), 20000)
    const placement = clipboardPlacementOffset(source, { nodes: [node], groups: [own, wall] })
    expect(placement.cascaded).toBe(true)
    expectZeroOverlap(source, placement.offset, [node, own, wall])
    expectClearance(source, placement.offset, [node, own, wall])
  })

  it('连续粘贴：第二份副本不会贴边紧邻第一份（净距 ≥ PASTE_CLEARANCE）', () => {
    const node = makeNode('n', 0, 0, 100, 100)
    const group = makeGroup('g', -10, -10, 400, 300)
    const source = makePayload([node], [group])
    // 第一次粘贴：源内容自身参与避让
    const first = clipboardPlacementOffset(source, { nodes: [node], groups: [group] })
    // 第二次粘贴：画布上已有「源内容 + 第一份副本」，两者都参与避让
    const placedFirstNode: CanvasNodeData = { ...node, x: node.x + first.offset.x, y: node.y + first.offset.y }
    const placedFirstGroup: CanvasGroupData = { ...group, x: group.x + first.offset.x, y: group.y + first.offset.y }
    const secondPayload: NodeClipboardPayload = source
    const second = clipboardPlacementOffset(secondPayload, {
      nodes: [node, placedFirstNode],
      groups: [group, placedFirstGroup],
    })
    const placedSecond: RectLike[] = shiftRects([...secondPayload.nodes, ...secondPayload.groups], second.offset)
    const occupied = [node, group, placedFirstNode, placedFirstGroup]
    expectRectsZeroOverlap(placedSecond, occupied)
    for (const rect of placedSecond) {
      for (const occupiedRect of occupied.map((r) => ({
        x: r.x - PASTE_CLEARANCE,
        y: r.y - PASTE_CLEARANCE,
        width: r.width + PASTE_CLEARANCE * 2,
        height: r.height + PASTE_CLEARANCE * 2,
      }))) {
        expect(rectsOverlap(rect, occupiedRect)).toBe(false)
      }
    }
  })

  it('候选落点集合覆盖全部泳道（常量自洽性）', () => {
    expect(PASTE_PROBE_LANES).toBeGreaterThan(0)
    expect(PASTE_PROBE_LIMIT).toBeGreaterThan(0)
    expect(PASTE_PROBE_STEP).toBeGreaterThan(0)
  })
})

describe('instantiateClipboard', () => {
  it('节点/连线/分组换新 id 并按落点平移，config 引用重映射', () => {
    const a = makeNode('a', 0, 0)
    const b = makeNode('b', 100, 100)
    const group = makeGroup('g', -12, -40, 400, 300)
    const payload = makePayload(
      [a, b],
      [group],
      [{ id: 'c1', fromNodeId: 'a', fromPortId: 'out', toNodeId: 'b', toPortId: 'in' }],
    )
    const { payload: placed, idMap } = instantiateClipboard(payload, { x: 30, y: 40 })
    expect(placed.nodes).toHaveLength(2)
    expect(placed.groups).toHaveLength(1)
    expect(placed.connections).toHaveLength(1)
    const newA = placed.nodes[0]
    const newB = placed.nodes[1]
    expect(newA.id).toBe(idMap.get('a'))
    expect(newA.x).toBe(30)
    expect(newA.y).toBe(40)
    expect(newB.x).toBe(130)
    expect(placed.groups[0].id).not.toBe('g')
    expect(placed.groups[0].x).toBe(group.x + 30)
    expect(placed.groups[0].y).toBe(group.y + 40)
    expect(placed.connections[0].fromNodeId).toBe(newA.id)
    expect(placed.connections[0].toNodeId).toBe(newB.id)
    expect(placed.connections[0].id).not.toBe('c1')
    // 原载荷不被修改
    expect(a.x).toBe(0)
    expect(group.x).toBe(-12)
  })

  it('平移量取整（落点对齐整数流坐标）', () => {
    const node = makeNode('a', 10, 10)
    const { payload: placed } = instantiateClipboard(makePayload([node]), { x: 30.4, y: 40.6 })
    expect(placed.nodes[0].x).toBe(40)
    expect(placed.nodes[0].y).toBe(51)
  })
})
