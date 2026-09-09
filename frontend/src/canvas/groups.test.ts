import { describe, expect, it } from 'vitest'
import type { CanvasGroupData, CanvasNodeData } from './types'
import {
  DEFAULT_GROUP_COLOR,
  GROUP_DRAG_MIN_PX,
  GROUP_HEADER_HEIGHT,
  GROUP_MIN_SIZE,
  GROUP_PALETTE,
  asCanvasGroupData,
  boundingRect,
  collectDragFollowSet,
  defaultGroupName,
  groupRectFromNodes,
  groupsOfNode,
  hexToRgba,
  nodesInGroup,
  rectContains,
  rectsOverlap,
} from './groups'

/** 构造最小节点数据 */
function makeNode(id: string, x: number, y: number, width = 240, height = 160): CanvasNodeData {
  return { id, prototypeId: 'text', name: id, x, y, width, height, config: {} }
}

/** 构造最小分组数据 */
function makeGroup(id: string, x: number, y: number, width = 400, height = 300, name = id): CanvasGroupData {
  return { id, name, color: DEFAULT_GROUP_COLOR, x, y, width, height }
}

describe('常量', () => {
  it('色板 8 色且默认色为色板首色', () => {
    expect(GROUP_PALETTE).toHaveLength(8)
    expect(DEFAULT_GROUP_COLOR).toBe(GROUP_PALETTE[0])
  })

  it('最小尺寸与拖动阈值', () => {
    expect(GROUP_MIN_SIZE).toEqual({ width: 160, height: 100 })
    expect(GROUP_DRAG_MIN_PX).toBe(4)
  })

  it('标题条高度为 28px（创建分组顶部留白依据）', () => {
    expect(GROUP_HEADER_HEIGHT).toBe(28)
  })
})

describe('hexToRgba', () => {
  it('6 位 hex 转 rgba', () => {
    expect(hexToRgba('#1976D2', 0.08)).toBe('rgba(25, 118, 210, 0.08)')
  })

  it('3 位简写与省略 # 均可解析', () => {
    expect(hexToRgba('#0af', 1)).toBe('rgba(0, 170, 255, 1)')
    expect(hexToRgba('2E7D32', 0.7)).toBe('rgba(46, 125, 50, 0.7)')
  })

  it('非法 hex 回退黑色', () => {
    expect(hexToRgba('not-a-color', 0.5)).toBe('rgba(0, 0, 0, 0.5)')
    expect(hexToRgba('', 0.5)).toBe('rgba(0, 0, 0, 0.5)')
  })
})

describe('rectsOverlap', () => {
  const base = { x: 0, y: 0, width: 100, height: 100 }

  it('相交返回 true', () => {
    expect(rectsOverlap(base, { x: 50, y: 50, width: 100, height: 100 })).toBe(true)
    expect(rectsOverlap(base, { x: -50, y: -50, width: 100, height: 100 })).toBe(true)
  })

  it('完全包含也算重叠', () => {
    expect(rectsOverlap(base, { x: 10, y: 10, width: 20, height: 20 })).toBe(true)
    expect(rectsOverlap({ x: 10, y: 10, width: 20, height: 20 }, base)).toBe(true)
  })

  it('边贴边相切返回 false', () => {
    expect(rectsOverlap(base, { x: 100, y: 0, width: 100, height: 100 })).toBe(false)
    expect(rectsOverlap(base, { x: 0, y: 100, width: 100, height: 100 })).toBe(false)
    expect(rectsOverlap(base, { x: -100, y: 0, width: 100, height: 100 })).toBe(false)
  })

  it('分离返回 false', () => {
    expect(rectsOverlap(base, { x: 200, y: 200, width: 10, height: 10 })).toBe(false)
  })

  it('零宽/零高矩形不算重叠', () => {
    expect(rectsOverlap(base, { x: 50, y: 50, width: 0, height: 100 })).toBe(false)
    expect(rectsOverlap(base, { x: 50, y: 50, width: 100, height: 0 })).toBe(false)
  })
})

describe('rectContains', () => {
  const outer = { x: 0, y: 0, width: 100, height: 100 }

  it('严格包含', () => {
    expect(rectContains(outer, { x: 10, y: 10, width: 50, height: 50 })).toBe(true)
  })

  it('边界相等视为包含', () => {
    expect(rectContains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true)
  })

  it('超出边界不算包含', () => {
    expect(rectContains(outer, { x: -1, y: 0, width: 100, height: 100 })).toBe(false)
    expect(rectContains(outer, { x: 0, y: 0, width: 101, height: 100 })).toBe(false)
  })

  it('容差内视为包含', () => {
    expect(rectContains(outer, { x: -2, y: 0, width: 104, height: 100 }, 2)).toBe(true)
    expect(rectContains(outer, { x: -3, y: 0, width: 104, height: 100 }, 2)).toBe(false)
  })
})

describe('nodesInGroup / groupsOfNode', () => {
  const group = makeGroup('g1', 0, 0, 300, 300)

  it('nodesInGroup：返回与分组重叠的节点（相切不算）', () => {
    const nodes = [
      makeNode('inside', 10, 10),
      makeNode('partial', 280, 280),
      makeNode('touching', 300, 0, 100, 100),
      makeNode('outside', 500, 500),
    ]
    expect(nodesInGroup(group, nodes).map((n) => n.id)).toEqual(['inside', 'partial'])
  })

  it('groupsOfNode：一个节点可属于多个重叠分组', () => {
    const groups = [makeGroup('g1', 0, 0, 300, 300), makeGroup('g2', 200, 200, 300, 300), makeGroup('g3', 900, 900, 100, 100)]
    expect(groupsOfNode(groups, makeNode('n', 220, 220, 40, 40)).map((g) => g.id)).toEqual(['g1', 'g2'])
  })
})

describe('collectDragFollowSet', () => {
  /** 嵌套场景：A 完全包含 B，B 内含 n1；n2 只在 A 内；n3 在两者之外 */
  function nestedScene() {
    const groups = [
      makeGroup('A', 0, 0, 600, 400),
      makeGroup('B', 100, 100, 200, 150),
    ]
    const nodes = [
      makeNode('n1', 120, 120, 100, 80),
      makeNode('n2', 400, 40, 100, 80),
      makeNode('n3', 800, 800, 100, 80),
    ]
    return { groups, nodes }
  }

  it('单层：收集重叠节点，不含无关节点', () => {
    const groups = [makeGroup('A', 0, 0, 300, 300)]
    const nodes = [makeNode('n1', 10, 10, 50, 50), makeNode('n2', 500, 500, 50, 50)]
    expect(collectDragFollowSet(groups, nodes, 'A')).toEqual({ groupIds: ['A'], nodeIds: ['n1'] })
  })

  it('嵌套递归：拖动外层带走被完全包含的内层与其节点', () => {
    const { groups, nodes } = nestedScene()
    const result = collectDragFollowSet(groups, nodes, 'A')
    expect(result.groupIds).toEqual(['A', 'B'])
    expect(result.nodeIds.sort()).toEqual(['n1', 'n2'])
  })

  it('拖动内层不带动外层，也不带走外层独有节点', () => {
    const { groups, nodes } = nestedScene()
    const result = collectDragFollowSet(groups, nodes, 'B')
    expect(result.groupIds).toEqual(['B'])
    expect(result.nodeIds).toEqual(['n1'])
  })

  it('节点去重：同时与父子分组重叠的节点只出现一次', () => {
    const groups = [makeGroup('A', 0, 0, 600, 400), makeGroup('B', 100, 100, 200, 150)]
    const nodes = [makeNode('n1', 120, 120, 100, 80)]
    const result = collectDragFollowSet(groups, nodes, 'A')
    expect(result.nodeIds).toEqual(['n1'])
  })

  it('部分重叠的分组不级联（未被完全包含）', () => {
    const groups = [makeGroup('A', 0, 0, 300, 300), makeGroup('B', 200, 200, 300, 300)]
    const result = collectDragFollowSet(groups, [], 'A')
    expect(result.groupIds).toEqual(['A'])
  })

  it('分组 id 不存在时返回空集', () => {
    expect(collectDragFollowSet([makeGroup('A', 0, 0)], [], 'ghost')).toEqual({ groupIds: [], nodeIds: [] })
  })

  it('无节点时只返回分组集合', () => {
    const groups = [makeGroup('A', 0, 0, 600, 400), makeGroup('B', 100, 100, 200, 150)]
    expect(collectDragFollowSet(groups, [], 'A')).toEqual({ groupIds: ['A', 'B'], nodeIds: [] })
  })
})

describe('boundingRect', () => {
  it('空列表返回 null', () => {
    expect(boundingRect([])).toBeNull()
  })

  it('节点与分组混合取并集包围盒 + 留白', () => {
    const nodes = [makeNode('n1', 100, 100, 200, 100)]
    const groups = [makeGroup('g1', 50, 40, 400, 300)]
    expect(boundingRect([...nodes, ...groups], 12)).toEqual({ x: 38, y: 28, width: 424, height: 324 })
  })

  it('单个矩形时即自身 + 留白', () => {
    expect(boundingRect([{ x: 0, y: 0, width: 10, height: 20 }], 0)).toEqual({ x: 0, y: 0, width: 10, height: 20 })
  })
})

describe('groupRectFromNodes', () => {
  it('空列表返回 null', () => {
    expect(groupRectFromNodes([])).toBeNull()
  })

  it('按节点包围盒加留白（不小于最小尺寸时不留额外扩张）', () => {
    const rect = groupRectFromNodes([makeNode('a', 100, 200, 300, 200), makeNode('b', 500, 500, 300, 200)], 12)
    expect(rect).toEqual({ x: 88, y: 188, width: 724, height: 524 })
  })

  it('小于最小尺寸时以包围盒中心对称扩张', () => {
    const rect = groupRectFromNodes([makeNode('a', 100, 100, 40, 20)], 0)
    expect(rect).toEqual({
      x: 100 - Math.floor((GROUP_MIN_SIZE.width - 40) / 2),
      y: 100 - Math.floor((GROUP_MIN_SIZE.height - 20) / 2),
      width: GROUP_MIN_SIZE.width,
      height: GROUP_MIN_SIZE.height,
    })
  })

  it('topInset 只作用于顶部：左右/下留白不变，高度增加 topInset', () => {
    const rect = groupRectFromNodes(
      [makeNode('a', 100, 200, 300, 200), makeNode('b', 500, 500, 300, 200)],
      12,
      GROUP_HEADER_HEIGHT,
    )
    // 顶部 = 200 - 12 - 28 = 160；左右/下仍 12px；高度 = 524 + 28
    expect(rect).toEqual({ x: 88, y: 160, width: 724, height: 524 + GROUP_HEADER_HEIGHT })
  })

  it('topInset 下最上方节点顶边距分组顶边 = padding + topInset（创建分组即 40px）', () => {
    const node = makeNode('a', 100, 200, 300, 200)
    const rect = groupRectFromNodes([node], 12, GROUP_HEADER_HEIGHT)
    expect(rect).not.toBeNull()
    expect(node.y - (rect as { y: number }).y).toBe(12 + GROUP_HEADER_HEIGHT)
  })

  it('撑到最小尺寸时顶部间距只会更大（对称扩张不吃掉 topInset）', () => {
    const node = makeNode('a', 100, 100, 40, 20)
    const rect = groupRectFromNodes([node], 12, GROUP_HEADER_HEIGHT)
    expect(rect).not.toBeNull()
    const gap = node.y - (rect as { y: number }).y
    expect(gap).toBeGreaterThanOrEqual(12 + GROUP_HEADER_HEIGHT)
    expect(rect).toMatchObject({ width: GROUP_MIN_SIZE.width, height: GROUP_MIN_SIZE.height })
  })
})

describe('defaultGroupName', () => {
  it('空列表得到 分组 1', () => {
    expect(defaultGroupName([])).toBe('分组 1')
  })

  it('取最小未占用编号（含跳号）', () => {
    expect(defaultGroupName([makeGroup('a', 0, 0, 0, 0, '分组 1'), makeGroup('b', 0, 0, 0, 0, '分组 3')])).toBe('分组 2')
  })

  it('自定义标题不占用编号', () => {
    expect(defaultGroupName([makeGroup('a', 0, 0, 0, 0, '主角区')])).toBe('分组 1')
  })

  it('兼容「分组3」无空格写法', () => {
    expect(defaultGroupName([makeGroup('a', 0, 0, 0, 0, '分组3')])).toBe('分组 1')
  })
})

describe('asCanvasGroupData', () => {
  it('合法数据通过并只保留已知字段', () => {
    const raw = { id: 'g1', name: '分组 1', color: '#1976D2', x: 1, y: 2, width: 3, height: 4, extra: 'x' }
    expect(asCanvasGroupData(raw)).toEqual({ id: 'g1', name: '分组 1', color: '#1976D2', x: 1, y: 2, width: 3, height: 4 })
  })

  it('缺失/类型错误字段返回 null', () => {
    expect(asCanvasGroupData(null)).toBeNull()
    expect(asCanvasGroupData('g1')).toBeNull()
    expect(asCanvasGroupData({ id: 'g1' })).toBeNull()
    expect(asCanvasGroupData({ id: '', name: 'n', color: '#000', x: 0, y: 0, width: 1, height: 1 })).toBeNull()
    expect(asCanvasGroupData({ id: 'g1', name: 'n', color: '#000', x: '0', y: 0, width: 1, height: 1 })).toBeNull()
  })

  it('NaN / Infinity 坐标返回 null', () => {
    expect(asCanvasGroupData({ id: 'g1', name: 'n', color: '#000', x: Number.NaN, y: 0, width: 1, height: 1 })).toBeNull()
    expect(asCanvasGroupData({ id: 'g1', name: 'n', color: '#000', x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 })).toBeNull()
  })
})

describe('持久分组的几何派生性质', () => {
  it('拖动外层分组后成员关系保持（相对位置不变 ⇒ 重叠关系不变）', () => {
    const groups = [makeGroup('A', 0, 0, 600, 400)]
    const nodes = [makeNode('n1', 100, 100, 100, 80)]
    const before = nodesInGroup(groups[0], nodes).map((n) => n.id)
    const moved = { ...groups[0], x: groups[0].x + 250, y: groups[0].y - 130 }
    const movedNode = { ...nodes[0], x: nodes[0].x + 250, y: nodes[0].y - 130 }
    expect(nodesInGroup(moved, [movedNode]).map((n) => n.id)).toEqual(before)
  })

  it('缩放分组框至与节点不再重叠 ⇒ 节点自动脱离', () => {
    const group = makeGroup('A', 0, 0, 600, 400)
    const nodes = [makeNode('n1', 500, 300, 100, 80)]
    expect(nodesInGroup(group, nodes)).toHaveLength(1)
    const shrunk = { ...group, width: 200, height: 200 }
    expect(nodesInGroup(shrunk, nodes)).toHaveLength(0)
  })
})
