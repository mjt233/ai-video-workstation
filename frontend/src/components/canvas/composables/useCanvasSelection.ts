/**
 * 选中状态组合式：单/多选节点、连线选中、配置面板抑制标志、配置面板渲染信息与删除操作。
 * 菜单关闭/双击加节点等跨组合式动作由 AssetCanvas 的接线函数统一编排（本组合式保持单一职责）。
 *
 * 多选交互（Ctrl 框选/Ctrl 加减选）由 Vue Flow 内置能力承担：
 * - 应用级 selectedNodeIds 为「虚线框/整组操作」的数据源；
 * - Vue Flow 内部选中态经由 mirrorSelectionToVueFlow 镜像，保证节点选中边框一致；
 * - 框选结束（@selection-end）/空白点击（@pane-click）/节点点击时调用 syncFromVueFlow 或
 *   onNodeClick 同步回应用级状态（详见 AssetCanvas 接线）。
 */

import { computed, ref } from 'vue'
import type { Component } from 'vue'
import type { EdgeMouseEvent, NodeMouseEvent } from '@vue-flow/core'
import { getPrototype } from '../../../canvas/registry'
import type { CanvasNodeData } from '../../../canvas/types'
import { isSyntheticNodeId } from '../../../canvas/groupSelection'
import { confirm } from '../../../utils/confirm'
import type { CanvasStoreApi } from './types'

/** useCanvasSelection 参数 */
export interface UseCanvasSelectionOptions {
  /** 画布数据 store（删除节点） */
  store: CanvasStoreApi
}

/** 配置面板渲染信息：选中节点 + 其编辑器组件 */
export interface EditorPanelInfo {
  node: CanvasNodeData
  editorComponent: Component
}

/**
 * 选中状态组合式。
 *
 * @param options 依赖注入参数
 * @returns 选中状态、配置面板信息与操作 API
 */
export function useCanvasSelection(options: UseCanvasSelectionOptions) {
  const { store } = options

  /** 当前选中的节点 id 列表（多选主状态；驱动虚线框/整组复制/整组删除/成组连接） */
  const selectedNodeIds = ref<string[]>([])
  /** 当前选中连线 id（驱动 Delete 键删除连线） */
  const selectedEdgeId = ref('')
  /** 拖拽进行中：抑制配置面板显示（拖拽不触发配置） */
  const suppressEditor = ref(false)
  /** 程序化选中（如粘贴自动聚焦）后抑制配置面板自动弹出；用户点击节点后恢复 */
  const suppressPanelOnSelect = ref(false)

  /** 当前选中节点 id：恰好选中一个节点时为其 id，否则为空串（单节点路径兼容） */
  const selectedNodeId = computed(() => (selectedNodeIds.value.length === 1 ? selectedNodeIds.value[0] : ''))

  /** 当前选中的节点数据 */
  const selectedNode = computed(() => store.nodes.value.find((n) => n.id === selectedNodeId.value) ?? null)

  /** 当前选中节点列表（顺序与选中列表一致） */
  const selectedNodes = computed<CanvasNodeData[]>(() =>
    selectedNodeIds.value
      .map((id) => store.nodes.value.find((n) => n.id === id))
      .filter((n): n is CanvasNodeData => !!n),
  )

  /** 当前选中节点的编辑器组件（仅单选且有配置组件时产生；多选不显示配置面板） */
  const editorPanel = computed<EditorPanelInfo | null>(() => {
    const node = selectedNode.value
    if (!node) return null
    const proto = getPrototype(node.prototypeId)
    return proto?.editorComponent ? { node, editorComponent: proto.editorComponent } : null
  })

  /** 是否处于多选状态（≥2 个节点选中） */
  const isMultiSelected = computed(() => selectedNodeIds.value.length > 1)

  /**
   * 点击节点：普通单击切换为单选该节点；Ctrl（或 Cmd）单击增/减选。
   * 合成节点（群组框/输出点）点击不改变选择。
   *
   * @param payload Vue Flow 节点点击事件（含 event 与 node）
   */
  function onNodeClick(payload: NodeMouseEvent): void {
    suppressEditor.value = false
    suppressPanelOnSelect.value = false
    const id = payload.node.id
    if (isSyntheticNodeId(id)) return
    const event = payload.event as MouseEvent | undefined
    if (event?.ctrlKey || event?.metaKey) {
      toggleSelectNode(id)
    } else {
      setSelectedNodes([id])
    }
  }

  /** 节点开始拖拽：抑制配置面板显示（仅点击节点才显示配置） */
  function onNodeDragStart(): void {
    suppressEditor.value = true
  }

  /** 空白处点击：取消选中并恢复面板显示；双击加节点由 AssetCanvas 接线统一处理 */
  function onPaneClick(): void {
    suppressEditor.value = false
    suppressPanelOnSelect.value = false
    selectedNodeIds.value = []
    selectedEdgeId.value = ''
  }

  /** 记录当前选中的连线（供 Delete 键/连线右键菜单断开） */
  function onEdgeClick({ edge }: EdgeMouseEvent): void {
    selectedEdgeId.value = edge.id
  }

  /** 程序化设置单节点选中（右键菜单等场景） */
  function setSelectedNode(nodeId: string): void {
    setSelectedNodes([nodeId])
  }

  /** 程序化设置选中节点列表（过滤不存在的节点 id，去重） */
  function setSelectedNodes(nodeIds: string[]): void {
    const existing = new Set(store.nodes.value.map((n) => n.id))
    const seen = new Set<string>()
    const next: string[] = []
    for (const id of nodeIds) {
      if (!existing.has(id) || seen.has(id)) continue
      seen.add(id)
      next.push(id)
    }
    selectedNodeIds.value = next
  }

  /** 勾选/取消勾选单个节点（Ctrl 单击语义） */
  function toggleSelectNode(nodeId: string): void {
    const next = selectedNodeIds.value.includes(nodeId)
      ? selectedNodeIds.value.filter((id) => id !== nodeId)
      : [...selectedNodeIds.value, nodeId]
    setSelectedNodes(next)
  }

  /** 从 Vue Flow 内部选中态同步应用级选择（框选结束/空白点击后调用） */
  function syncFromVueFlow(getVueFlowSelectedNodeIds: () => string[]): void {
    setSelectedNodes(getVueFlowSelectedNodeIds())
  }

  /** 程序化设置面板抑制标志（粘贴自动聚焦等场景） */
  function setSuppressPanelOnSelect(value: boolean): void {
    suppressPanelOnSelect.value = value
  }

  /**
   * 删除节点（弹窗确认）。
   *
   * @param nodeId 节点 id
   */
  async function deleteNode(nodeId: string): Promise<void> {
    const node = store.nodes.value.find((n) => n.id === nodeId)
    if (!node) return
    const ok = await confirm({
      title: '删除节点',
      content: `确定删除节点「${node.name}」？`,
      confirmText: '删除',
      confirmColor: 'error',
    })
    if (!ok) return
    store.removeNode(nodeId)
    if (selectedNodeIds.value.includes(nodeId)) {
      selectedNodeIds.value = selectedNodeIds.value.filter((id) => id !== nodeId)
    }
  }

  /**
   * 删除当前选中的节点（1 个给出节点名，多个给出数量；弹窗确认一次）。
   * 无选中时忽略。
   *
   * @param getVueFlowSelectedNodeIds 可选的内部选中读取（未使用，保持接口稳定）
   */
  async function deleteSelected(): Promise<void> {
    const ids = selectedNodeIds.value
    if (ids.length === 0) return
    const nodes = selectedNodes.value
    const ok = await confirm({
      title: ids.length === 1 ? '删除节点' : '删除选中节点',
      content: ids.length === 1
        ? `确定删除节点「${nodes[0]?.name ?? ''}」？`
        : `确定删除选中的 ${ids.length} 个节点？`,
      confirmText: '删除',
      confirmColor: 'error',
    })
    if (!ok) return
    if (ids.length === 1) {
      store.removeNode(ids[0])
    } else {
      store.removeNodes(ids)
    }
    selectedNodeIds.value = []
  }

  /** 重置全部选中状态（切换画布目标/组件卸载时调用） */
  function reset(): void {
    suppressEditor.value = false
    suppressPanelOnSelect.value = false
    selectedNodeIds.value = []
    selectedEdgeId.value = ''
  }

  return {
    selectedNodeId,
    selectedNodeIds,
    selectedNode,
    selectedNodes,
    selectedEdgeId,
    suppressEditor,
    suppressPanelOnSelect,
    isMultiSelected,
    editorPanel,
    onNodeClick,
    onNodeDragStart,
    onPaneClick,
    onEdgeClick,
    setSelectedNode,
    setSelectedNodes,
    toggleSelectNode,
    syncFromVueFlow,
    setSuppressPanelOnSelect,
    deleteNode,
    deleteSelected,
    reset,
  }
}
