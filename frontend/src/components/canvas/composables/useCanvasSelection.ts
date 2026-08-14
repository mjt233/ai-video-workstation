/**
 * 选中状态组合式：节点/连线选中、配置面板抑制标志、配置面板渲染信息与删除操作。
 * 菜单关闭/双击加节点等跨组合式动作由 AssetCanvas 的接线函数统一编排（本组合式保持单一职责）。
 */

import { computed, ref } from 'vue'
import type { Component } from 'vue'
import type { EdgeMouseEvent, NodeMouseEvent } from '@vue-flow/core'
import { getPrototype } from '../../../canvas/registry'
import type { CanvasNodeData } from '../../../canvas/types'
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

  /** 当前选中节点 id（驱动复制/删除/右键菜单） */
  const selectedNodeId = ref('')
  /** 当前选中连线 id（驱动 Delete 键删除连线） */
  const selectedEdgeId = ref('')
  /** 拖拽进行中：抑制配置面板显示（拖拽不触发配置） */
  const suppressEditor = ref(false)
  /** 程序化选中（如粘贴自动聚焦）后抑制配置面板自动弹出；用户点击节点后恢复 */
  const suppressPanelOnSelect = ref(false)

  /** 当前选中的节点数据 */
  const selectedNode = computed(() => store.nodes.value.find((n) => n.id === selectedNodeId.value) ?? null)

  /** 当前选中节点的编辑器组件（无配置组件时为空） */
  const editorPanel = computed<EditorPanelInfo | null>(() => {
    const node = selectedNode.value
    if (!node) return null
    const proto = getPrototype(node.prototypeId)
    return proto?.editorComponent ? { node, editorComponent: proto.editorComponent } : null
  })

  /** 点击节点：选中（允许显示配置面板）；菜单关闭由 AssetCanvas 接线统一处理 */
  function onNodeClick({ node }: NodeMouseEvent): void {
    suppressEditor.value = false
    suppressPanelOnSelect.value = false
    selectedNodeId.value = node.id
  }

  /** 节点开始拖拽：抑制配置面板显示（仅点击节点才显示配置） */
  function onNodeDragStart(): void {
    suppressEditor.value = true
  }

  /** 空白处点击：取消选中并恢复面板显示；双击加节点由 AssetCanvas 接线统一处理 */
  function onPaneClick(): void {
    suppressEditor.value = false
    suppressPanelOnSelect.value = false
    selectedNodeId.value = ''
    selectedEdgeId.value = ''
  }

  /** 记录当前选中的连线（供 Delete 键/连线右键菜单断开） */
  function onEdgeClick({ edge }: EdgeMouseEvent): void {
    selectedEdgeId.value = edge.id
  }

  /** 程序化设置选中节点（右键菜单/粘贴聚焦等场景） */
  function setSelectedNode(nodeId: string): void {
    selectedNodeId.value = nodeId
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
    if (selectedNodeId.value === nodeId) selectedNodeId.value = ''
  }

  /** 重置全部选中状态（切换画布目标/组件卸载时调用） */
  function reset(): void {
    suppressEditor.value = false
    suppressPanelOnSelect.value = false
    selectedNodeId.value = ''
    selectedEdgeId.value = ''
  }

  return {
    selectedNodeId,
    selectedEdgeId,
    suppressEditor,
    suppressPanelOnSelect,
    selectedNode,
    editorPanel,
    onNodeClick,
    onNodeDragStart,
    onPaneClick,
    onEdgeClick,
    setSelectedNode,
    setSuppressPanelOnSelect,
    deleteNode,
    reset,
  }
}
