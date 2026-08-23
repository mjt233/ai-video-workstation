/**
 * 右键菜单与添加节点菜单组合式：节点右键菜单（重新生成/历史/保存为（子菜单）/断开/重命名/复制/删除）、
 * 添加节点菜单（双击空白/工具栏「＋」）的状态与动作。
 * 菜单能力显隐由节点原型能力标志（registry.canGenerate/hasHistory）与运行状态推导。
 */

import { computed, reactive } from 'vue'
import { getPrototype } from '../../../canvas/registry'
import { getNodeOutputType } from '../../../canvas/connection'
import { getNodeCurrentAssetPath } from '../../../canvas/generate'
import type { CanvasNodeData } from '../../../canvas/types'
import type { CanvasScope } from '../../../canvas/paths'
import type { CanvasStoreApi, NodeMap, SaveAsType } from './types'

/** useCanvasMenus 参数 */
export interface UseCanvasMenusOptions {
  /** 画布数据 store（复制/断开/添加节点） */
  store: CanvasStoreApi
  /** 节点 id → 节点数据索引 */
  nodeMap: NodeMap
  /** 选中控制（openContextMenu 同步应用级选中；删除动作复用） */
  selection: {
    setSelectedNode: (nodeId: string) => void
    deleteNode: (nodeId: string) => Promise<void>
  }
  /** 内联重命名（右键「重命名」复用） */
  rename: { startRename: (nodeId: string) => void }
  /** 对话框入口（历史/保存为） */
  dialogs: {
    openHistory: (nodeId: string) => void
    openSaveAsset: (nodeId: string) => void
    openSaveAs: (nodeId: string, type: Exclude<SaveAsType, 'custom'>) => void
  }
  /** 画布作用域 getter（生成类节点产物固定路径推导需要；随切换目标实时更新） */
  getScope: () => CanvasScope
  /** 生成调度（右键「重新生成」） */
  generate: (nodeId: string) => void
}

/**
 * 右键菜单与添加节点菜单组合式。
 *
 * @param options 依赖注入参数
 * @returns 菜单状态与操作 API
 */
export function useCanvasMenus(options: UseCanvasMenusOptions) {
  const { store, nodeMap, selection, rename, dialogs, getScope, generate } = options

  // ── 节点右键菜单 ────────────────────────────────────────

  /** 节点右键菜单状态（x/y 相对画布容器） */
  const contextMenu = reactive({ show: false, x: 0, y: 0, nodeId: '' })

  /** 当前右键菜单对应的节点 */
  const contextMenuNode = computed(() => (contextMenu.nodeId ? nodeMap.value[contextMenu.nodeId] : undefined))

  /**
   * 判断节点是否有「重新生成」能力（按原型能力标志）。
   *
   * @param node 节点数据（可为 undefined）
   * @returns 可重新生成返回 true
   */
  function canGenerateOf(node: CanvasNodeData | undefined): boolean {
    if (!node) return false
    return getPrototype(node.prototypeId)?.canGenerate === true
  }

  /**
   * 判断节点是否有版本历史（按原型能力标志；获取视频帧节点无历史）。
   *
   * @param node 节点数据（可为 undefined）
   * @returns 支持历史返回 true
   */
  function hasHistoryOf(node: CanvasNodeData | undefined): boolean {
    if (!node) return false
    return getPrototype(node.prototypeId)?.hasHistory === true
  }

  /**
   * 节点是否显示「保存为」菜单：输出类型为图片且有当前产物。
   * （音频/视频节点不再提供保存入口；「保存为」仅面向图片输出节点）
   *
   * @param node 右键菜单对应节点
   * @returns 显示「保存为」返回 true
   */
  function canSaveImage(node: CanvasNodeData | undefined): boolean {
    if (!node || !contextMenu.nodeId) return false
    if (getNodeOutputType(contextMenu.nodeId, store.nodes.value) !== 'image') return false
    return !!getNodeCurrentAssetPath(node, getScope())
  }

  /**
   * 打开节点右键菜单（相对画布容器定位）。
   *
   * @param event 鼠标右键事件
   * @param nodeId 节点 id
   * @param flowEl 画布容器 DOM（定位基准）
   */
  function openContextMenu(event: MouseEvent, nodeId: string, flowEl: HTMLElement | null): void {
    selection.setSelectedNode(nodeId)
    contextMenu.nodeId = nodeId
    const rect = flowEl?.getBoundingClientRect()
    contextMenu.x = Math.round(event.clientX - (rect?.left ?? 0))
    contextMenu.y = Math.round(event.clientY - (rect?.top ?? 0))
    contextMenu.show = true
  }

  /** 菜单：重新生成 */
  function contextGenerate(): void {
    const id = contextMenu.nodeId
    contextMenu.show = false
    if (id) generate(id)
  }

  /** 菜单：查看历史 */
  function contextHistory(): void {
    const id = contextMenu.nodeId
    contextMenu.show = false
    if (id) dialogs.openHistory(id)
  }

  /**
   * 菜单：保存为（按目标类型分派）——
   * 自定义资产走 SaveAssetDialog（openSaveAsset），其余四类走 SaveAsDialog 目标选择（openSaveAs）。
   *
   * @param type 保存目标类型
   */
  function contextSaveAs(type: SaveAsType): void {
    const id = contextMenu.nodeId
    contextMenu.show = false
    if (!id) return
    if (type === 'custom') dialogs.openSaveAsset(id)
    else dialogs.openSaveAs(id, type)
  }

  /** 节点是否关联了连线（驱动右键菜单「断开连接」显隐） */
  function nodeHasConnections(nodeId: string): boolean {
    return store.connections.value.some((c) => c.fromNodeId === nodeId || c.toNodeId === nodeId)
  }

  /** 菜单：断开节点的所有连接 */
  function contextDisconnect(): void {
    const id = contextMenu.nodeId
    contextMenu.show = false
    if (!id) return
    for (const c of store.connections.value.filter((x) => x.fromNodeId === id || x.toNodeId === id)) {
      store.disconnect(c.id)
    }
  }

  /** 菜单：重命名（双击节点名称也可进入内联编辑） */
  function contextRename(): void {
    const id = contextMenu.nodeId
    contextMenu.show = false
    if (id) rename.startRename(id)
  }

  /** 菜单：复制 */
  function contextCopy(): void {
    const id = contextMenu.nodeId
    contextMenu.show = false
    if (id) store.copyNode(id)
  }

  /** 菜单：删除 */
  function contextDelete(): void {
    const id = contextMenu.nodeId
    contextMenu.show = false
    if (id) void selection.deleteNode(id)
  }

  // ── 添加节点菜单 ────────────────────────────────────────

  /** 添加节点菜单状态：show 控制显隐；x/y 为菜单锚点坐标（相对画布容器）；flowX/flowY 为新建节点放置的流坐标 */
  const addMenu = reactive({ show: false, x: 0, y: 0, flowX: 80, flowY: 80 })

  /**
   * 打开添加节点菜单：锚点定位到鼠标位置，并指定新建节点放置的流坐标。
   *
   * @param event 触发打开的鼠标事件（提供菜单弹出位置）
   * @param flowX 新建节点在画布流坐标系中的 x
   * @param flowY 新建节点在画布流坐标系中的 y
   * @param flowEl 画布容器 DOM（定位基准）
   */
  function openAddMenu(event: MouseEvent, flowX: number, flowY: number, flowEl: HTMLElement | null): void {
    const rect = flowEl?.getBoundingClientRect()
    addMenu.x = Math.round(event.clientX - (rect?.left ?? 0))
    addMenu.y = Math.round(event.clientY - (rect?.top ?? 0))
    addMenu.flowX = flowX
    addMenu.flowY = flowY
    addMenu.show = true
  }

  /** 按原型添加节点（关闭菜单） */
  function addNodeAt(prototypeId: string): void {
    store.addNode(prototypeId, addMenu.flowX, addMenu.flowY)
    addMenu.show = false
  }

  /** 关闭全部菜单（节点/连线右键菜单 + 添加节点菜单） */
  function closeAll(): void {
    contextMenu.show = false
    addMenu.show = false
  }

  /** 关闭节点右键菜单 */
  function closeNodeMenu(): void {
    contextMenu.show = false
  }

  /** 重置菜单状态（切换画布目标时调用） */
  function reset(): void {
    closeAll()
    contextMenu.nodeId = ''
  }

  return {
    contextMenu,
    contextMenuNode,
    canGenerateOf,
    hasHistoryOf,
    canSaveImage,
    openContextMenu,
    contextGenerate,
    contextHistory,
    contextSaveAs,
    nodeHasConnections,
    contextDisconnect,
    contextRename,
    contextCopy,
    contextDelete,
    addMenu,
    openAddMenu,
    addNodeAt,
    closeAll,
    closeNodeMenu,
    reset,
  }
}
