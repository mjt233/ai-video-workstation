/**
 * useCanvasSelection 单元测试：聚焦/选中状态机、拖动聚焦（focusNodeForDrag）、
 * 分组单元选中（selectGroupWithMembers / toggleGroupWithMembers）与整组删除（deleteSelected）。
 *
 * 说明：confirm 工具在模块加载时会连带引入 Vuetify 插件（jsdom 下无需真实弹窗），
 * 故整体 mock 掉；store 替身只提供 nodes/groups 只读视图（与真实 store 的 computed 一致，
 * 测试经 nodesRef/groupsRef 改写内容）与 removeNode/removeNodes/removeGroups 替身。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useCanvasSelection } from './useCanvasSelection'
import type { CanvasStoreApi } from './types'
import type { CanvasGroupData, CanvasNodeData } from '../../../canvas/types'
import { confirm } from '../../../utils/confirm'

vi.mock('../../../utils/confirm', () => ({
  confirm: vi.fn(async () => true),
  default: vi.fn(async () => true),
}))

/** 构造最小节点数据（仅 id/几何参与选中与成员判定，其余字段为类型占位） */
function node(id: string, x = 0, y = 0, width = 200, height = 120): CanvasNodeData {
  return { id, prototypeId: 'text', name: id, x, y, width, height, config: {} }
}

/** 构造最小分组数据 */
function group(id: string, name = id, x = 0, y = 0, width = 600, height = 400): CanvasGroupData {
  return { id, name, color: '#1976D2', x, y, width, height }
}

/** 构造仅含节点/分组列表与删除入口替身的 store 替身 */
function createSelection() {
  const nodesRef = ref<CanvasNodeData[]>([node('a'), node('b'), node('c')])
  const groupsRef = ref<CanvasGroupData[]>([])
  const store = {
    nodes: computed(() => nodesRef.value),
    groups: computed(() => groupsRef.value),
    removeNode: vi.fn(),
    removeNodes: vi.fn(),
    removeGroups: vi.fn(),
  } as unknown as CanvasStoreApi
  return { selection: useCanvasSelection({ store }), store, nodesRef, groupsRef }
}

describe('useCanvasSelection.focusNodeForDrag', () => {
  it('拖动聚焦：单选被拖节点并抑制配置面板弹出', () => {
    const { selection } = createSelection()
    selection.focusNodeForDrag('b')
    expect(selection.selectedNodeIds.value).toEqual(['b'])
    expect(selection.selectedNodeId.value).toBe('b')
    expect(selection.suppressPanelOnSelect.value).toBe(true)
  })

  it('拖动聚焦：由多选坍缩为单选该节点', () => {
    const { selection } = createSelection()
    selection.setSelectedNodes(['a', 'b'])
    selection.focusNodeForDrag('c')
    expect(selection.selectedNodeIds.value).toEqual(['c'])
  })

  it('拖动聚焦：节点不存在时忽略，不改变选中态与抑制标志', () => {
    const { selection } = createSelection()
    selection.setSelectedNodes(['a'])
    selection.focusNodeForDrag('missing')
    expect(selection.selectedNodeIds.value).toEqual(['a'])
    expect(selection.suppressPanelOnSelect.value).toBe(false)
  })

  it('拖动聚焦：不触发删除确认（纯状态操作）', () => {
    const { selection } = createSelection()
    selection.focusNodeForDrag('a')
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('useCanvasSelection 面板抑制与复位', () => {
  it('节点开始拖拽：仅抑制配置面板显示', () => {
    const { selection } = createSelection()
    selection.onNodeDragStart()
    expect(selection.suppressEditor.value).toBe(true)
  })

  it('点击节点：复位拖动聚焦写入的抑制标志（面板可重新弹出）', () => {
    const { selection } = createSelection()
    selection.focusNodeForDrag('a')
    expect(selection.suppressPanelOnSelect.value).toBe(true)
    selection.onNodeClick({ event: new MouseEvent('click'), node: { id: 'a' } } as never)
    expect(selection.suppressPanelOnSelect.value).toBe(false)
    expect(selection.selectedNodeIds.value).toEqual(['a'])
  })

  it('点击分组节点：不清空分组选中（Vue Flow 也会为分组派发 node-click）', () => {
    const ctx = createSelection()
    ctx.groupsRef.value = [group('g1', '分组 1', 0, 0, 600, 400)]
    ctx.selection.selectGroupWithMembers('g1')
    expect(ctx.selection.selectedGroupIds.value).toEqual(['g1'])
    // 模拟 Vue Flow 补发的 click（分组节点 id）
    ctx.selection.onNodeClick({ event: new MouseEvent('click'), node: { id: 'g1' } } as never)
    expect(ctx.selection.selectedGroupIds.value).toEqual(['g1'])
    expect(ctx.selection.selectedNodeIds.value).toEqual(['a', 'b', 'c'])
  })

  it('点击真实节点：照常清空分组选中（FR-7.6）', () => {
    const ctx = createSelection()
    ctx.groupsRef.value = [group('g1', '分组 1', 0, 0, 600, 400)]
    ctx.selection.selectGroupWithMembers('g1')
    ctx.selection.onNodeClick({ event: new MouseEvent('click'), node: { id: 'c' } } as never)
    expect(ctx.selection.selectedGroupIds.value).toEqual([])
    expect(ctx.selection.selectedNodeIds.value).toEqual(['c'])
  })
})

describe('useCanvasSelection 分组单元选中', () => {
  /** 分组 g1（含 a、b）与分组 g2（含 c）的 store 场景 */
  function createGroupScene() {
    const ctx = createSelection()
    ctx.nodesRef.value = [
      node('a', 10, 10),
      node('b', 100, 100),
      node('c', 1000, 1000),
    ]
    ctx.groupsRef.value = [group('g1', '分组 1'), group('g2', '分组 2', 900, 900, 400, 300)]
    return ctx
  }

  it('单击标题条：分组与其全部组内节点一起选中，并替换原选中', () => {
    const { selection } = createGroupScene()
    selection.setSelectedNodes(['c'])
    selection.setSelectedGroups(['g2'])
    selection.selectGroupWithMembers('g1')
    expect(selection.selectedGroupIds.value).toEqual(['g1'])
    expect(selection.selectedNodeIds.value).toEqual(['a', 'b'])
  })

  it('单击标题条：复位连线选中与配置面板抑制标志', () => {
    const { selection } = createGroupScene()
    selection.selectedEdgeId.value = 'e1'
    selection.setSuppressPanelOnSelect(true)
    selection.selectGroupWithMembers('g1')
    expect(selection.selectedEdgeId.value).toBe('')
    expect(selection.suppressPanelOnSelect.value).toBe(false)
  })

  it('单击标题条：分组不存在时忽略，不改变选中集', () => {
    const { selection } = createGroupScene()
    selection.setSelectedNodes(['a'])
    selection.selectGroupWithMembers('ghost')
    expect(selection.selectedNodeIds.value).toEqual(['a'])
    expect(selection.selectedGroupIds.value).toEqual([])
  })

  it('Ctrl 单击：未整组选中 → 分组与成员节点加入当前选中集（保留原有选中）', () => {
    const { selection } = createGroupScene()
    selection.setSelectedNodes(['c'])
    selection.toggleGroupWithMembers('g1')
    expect(selection.selectedGroupIds.value).toEqual(['g1'])
    expect(selection.selectedNodeIds.value).toEqual(['c', 'a', 'b'])
  })

  it('Ctrl 单击：已整组选中 → 分组与成员节点一起摘除（组外的 c 保留）', () => {
    const { selection } = createGroupScene()
    selection.setSelectedNodes(['c'])
    selection.toggleGroupWithMembers('g1')
    selection.toggleGroupWithMembers('g1')
    expect(selection.selectedGroupIds.value).toEqual([])
    expect(selection.selectedNodeIds.value).toEqual(['c'])
  })

  it('Ctrl 单击：分组已选中但成员节点不全 → 视为增选（补齐成员）', () => {
    const { selection } = createGroupScene()
    selection.setSelectedGroups(['g1'])
    selection.setSelectedNodes(['a'])
    selection.toggleGroupWithMembers('g1')
    expect(selection.selectedGroupIds.value).toEqual(['g1'])
    expect(selection.selectedNodeIds.value).toEqual(['a', 'b'])
  })
})

describe('useCanvasSelection 删除分组单元', () => {
  /** 分组 g1（含 a、b）场景 */
  function createGroupScene() {
    const ctx = createSelection()
    ctx.nodesRef.value = [node('a', 10, 10), node('b', 100, 100), node('c', 1000, 1000)]
    ctx.groupsRef.value = [group('g1', '分组 1')]
    return ctx
  }

  beforeEach(() => {
    vi.mocked(confirm).mockClear()
    vi.mocked(confirm).mockResolvedValue(true)
  })

  it('分组单元选中后 Delete：确认一次并连同组内全部节点删除', async () => {
    const { selection, store } = createGroupScene()
    selection.selectGroupWithMembers('g1')
    await selection.deleteSelected()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(store.removeNodes)).toHaveBeenCalledWith(['a', 'b'], ['g1'])
    expect(selection.selectedNodeIds.value).toEqual([])
    expect(selection.selectedGroupIds.value).toEqual([])
  })

  it('分组单元选中 + 组外节点：组外节点一并删除（补集去重）', async () => {
    const { selection, store } = createGroupScene()
    selection.selectGroupWithMembers('g1')
    selection.setSelectedNodes(['a', 'b', 'c'])
    await selection.deleteSelected()
    expect(vi.mocked(store.removeNodes)).toHaveBeenCalledWith(['a', 'b', 'c'], ['g1'])
  })

  it('仅分组选中（无节点）：走解散语义 removeGroups，节点不删', async () => {
    const { selection, store } = createGroupScene()
    selection.setSelectedGroups(['g1'])
    await selection.deleteSelected()
    expect(vi.mocked(store.removeGroups)).toHaveBeenCalledWith(['g1'])
    expect(vi.mocked(store.removeNodes)).not.toHaveBeenCalled()
    expect(selection.selectedGroupIds.value).toEqual([])
  })

  it('确认弹窗取消：不执行任何删除，选中集保留', async () => {
    vi.mocked(confirm).mockResolvedValue(false)
    const { selection, store, nodesRef } = createGroupScene()
    selection.selectGroupWithMembers('g1')
    await selection.deleteSelected()
    expect(vi.mocked(store.removeNodes)).not.toHaveBeenCalled()
    expect(vi.mocked(store.removeNode)).not.toHaveBeenCalled()
    expect(vi.mocked(store.removeGroups)).not.toHaveBeenCalled()
    expect(nodesRef.value.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(selection.selectedGroupIds.value).toEqual(['g1'])
    expect(selection.selectedNodeIds.value).toEqual(['a', 'b'])
  })

  it('无选中时 Delete：不弹确认', async () => {
    const { selection } = createGroupScene()
    await selection.deleteSelected()
    expect(confirm).not.toHaveBeenCalled()
  })
})
