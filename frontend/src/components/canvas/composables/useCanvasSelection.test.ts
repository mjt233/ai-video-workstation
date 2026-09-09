/**
 * useCanvasSelection 单元测试：聚焦/选中状态机与拖动聚焦（focusNodeForDrag）。
 *
 * 说明：confirm 工具在模块加载时会连带引入 Vuetify 插件（jsdom 下无需真实弹窗），
 * 故整体 mock 掉；store 仅需 nodes/groups 两个 ref（删除类操作在本测试中不触发）。
 */

import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useCanvasSelection } from './useCanvasSelection'
import type { CanvasStoreApi } from './types'
import type { CanvasNodeData } from '../../../canvas/types'
import { confirm } from '../../../utils/confirm'

vi.mock('../../../utils/confirm', () => ({
  confirm: vi.fn(async () => true),
  default: vi.fn(async () => true),
}))

/** 构造最小节点数据（仅 id 参与选中逻辑，其余字段为类型占位） */
function node(id: string): CanvasNodeData {
  return { id, prototypeId: 'text', name: id, x: 0, y: 0, width: 200, height: 120, config: {} }
}

/** 构造仅含节点/分组列表的 store 替身 */
function createSelection() {
  const store = {
    nodes: ref<CanvasNodeData[]>([node('a'), node('b'), node('c')]),
    groups: ref([]),
  } as unknown as CanvasStoreApi
  return useCanvasSelection({ store })
}

describe('useCanvasSelection.focusNodeForDrag', () => {
  it('拖动聚焦：单选被拖节点并抑制配置面板弹出', () => {
    const selection = createSelection()
    selection.focusNodeForDrag('b')
    expect(selection.selectedNodeIds.value).toEqual(['b'])
    expect(selection.selectedNodeId.value).toBe('b')
    expect(selection.suppressPanelOnSelect.value).toBe(true)
  })

  it('拖动聚焦：由多选坍缩为单选该节点', () => {
    const selection = createSelection()
    selection.setSelectedNodes(['a', 'b'])
    selection.focusNodeForDrag('c')
    expect(selection.selectedNodeIds.value).toEqual(['c'])
  })

  it('拖动聚焦：节点不存在时忽略，不改变选中态与抑制标志', () => {
    const selection = createSelection()
    selection.setSelectedNodes(['a'])
    selection.focusNodeForDrag('missing')
    expect(selection.selectedNodeIds.value).toEqual(['a'])
    expect(selection.suppressPanelOnSelect.value).toBe(false)
  })

  it('拖动聚焦：不触发删除确认（纯状态操作）', () => {
    const selection = createSelection()
    selection.focusNodeForDrag('a')
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('useCanvasSelection 面板抑制与复位', () => {
  it('节点开始拖拽：仅抑制配置面板显示', () => {
    const selection = createSelection()
    selection.onNodeDragStart()
    expect(selection.suppressEditor.value).toBe(true)
  })

  it('点击节点：复位拖动聚焦写入的抑制标志（面板可重新弹出）', () => {
    const selection = createSelection()
    selection.focusNodeForDrag('a')
    expect(selection.suppressPanelOnSelect.value).toBe(true)
    selection.onNodeClick({ event: new MouseEvent('click'), node: { id: 'a' } } as never)
    expect(selection.suppressPanelOnSelect.value).toBe(false)
    expect(selection.selectedNodeIds.value).toEqual(['a'])
  })
})
