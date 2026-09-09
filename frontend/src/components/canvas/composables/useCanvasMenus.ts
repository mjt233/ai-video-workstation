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
    deleteSelected: () => Promise<void>
    getSelectedNodeIds: () => string[]
    /** 读取当前选中分组 id 列表（群组菜单标题展示节点/分组数量） */
    getSelectedGroupIds: () => string[]
  }
  /** 内联重命名（右键「重命名」复用） */
  rename: { startRename: (nodeId: string) => void }
  /** 持久分组实体动作（右键分组框菜单：重命名 / 更改颜色 / 解散分组） */
  groupActions: {
    /** 进入分组标题内联编辑 */
    startRename: (groupId: string) => void
    /** 在画布容器指定坐标打开预设色板菜单（x/y 相对画布容器） */
    openColorAt: (groupId: string, x: number, y: number) => void
    /** 解散分组（弹窗确认，仅删框） */
    dissolve: (groupId: string) => Promise<void>
  }
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
  const { store, nodeMap, selection, rename, groupActions, dialogs, getScope, generate } = options

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
   * 节点是否显示「保存为」菜单：有当前产物即可
   * （图片/视频/音频输出节点均支持；各节点可保存的目标类型见 saveTargetsOf）。
   *
   * @param node 右键菜单对应节点
   * @returns 显示「保存为」返回 true
   */
  function canSaveImage(node: CanvasNodeData | undefined): boolean {
    if (!node || !contextMenu.nodeId) return false
    return !!getNodeCurrentAssetPath(node, getScope())
  }

  /**
   * 节点可用的「保存为」目标类型（按节点输出类型推导）：
   * - image：角色设计 / 角色设计-衍生变体 / 场景图 / 场景图-衍生变体 / 道具图片 / 自定义资产
   * - video：道具视频
   * - audio：道具音频
   *
   * @param node 右键菜单对应节点
   * @returns 可用保存目标类型列表（无产物时为空）
   */
  function saveTargetsOf(node: CanvasNodeData | undefined): SaveAsType[] {
    if (!node || !contextMenu.nodeId) return []
    if (!getNodeCurrentAssetPath(node, getScope())) return []
    const outputType = getNodeOutputType(contextMenu.nodeId, store.nodes.value)
    if (outputType === 'image') {
      return ['character', 'character-variant', 'stage', 'stage-variant', 'prop-image', 'custom']
    }
    if (outputType === 'video') return ['prop-video']
    if (outputType === 'audio') return ['prop-audio']
    return []
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

  // ── 群组右键菜单（多选虚线框，复制/删除整组）─────────────

  /** 群组右键菜单状态（x/y 相对画布容器；count 为选中节点数，groupCount 为选中分组数） */
  const groupMenu = reactive({ show: false, x: 0, y: 0, count: 0, groupCount: 0 })

  /**
   * 打开群组右键菜单：不改变当前多选状态。
   *
   * @param event 鼠标右键事件
   * @param flowEl 画布容器 DOM（定位基准）
   */
  function openGroupMenu(event: MouseEvent, flowEl: HTMLElement | null): void {
    const ids = selection.getSelectedNodeIds()
    const groupIds = selection.getSelectedGroupIds()
    if (ids.length + groupIds.length < 2) return
    event.preventDefault()
    event.stopPropagation()
    const rect = flowEl?.getBoundingClientRect()
    groupMenu.x = Math.round(event.clientX - (rect?.left ?? 0))
    groupMenu.y = Math.round(event.clientY - (rect?.top ?? 0))
    groupMenu.count = ids.length
    groupMenu.groupCount = groupIds.length
    groupMenu.show = true
  }

  /** 菜单：复制整组（选中节点 + 选中分组） */
  function groupCopy(): void {
    const ids = selection.getSelectedNodeIds()
    const groupIds = selection.getSelectedGroupIds()
    groupMenu.show = false
    if (ids.length + groupIds.length > 0) store.copyNodes(ids, groupIds)
  }

  /** 菜单：删除整组（弹窗确认一次；含分组时同时解散分组） */
  function groupDelete(): void {
    groupMenu.show = false
    void selection.deleteSelected()
  }

  // ── 分组实体右键菜单（右键分组框：重命名 / 更改颜色 / 解散分组）──

  /** 分组实体右键菜单状态（x/y 相对画布容器；groupId 为对应分组） */
  const groupEntityMenu = reactive({ show: false, x: 0, y: 0, groupId: '' })

  /**
   * 打开分组实体右键菜单（不改变当前选中状态）。
   *
   * @param event 鼠标右键事件
   * @param groupId 分组 id
   * @param flowEl 画布容器 DOM（定位基准）
   */
  function openGroupEntityMenu(event: MouseEvent, groupId: string, flowEl: HTMLElement | null): void {
    if (!store.groups.value.some((g) => g.id === groupId)) return
    event.preventDefault()
    event.stopPropagation()
    const rect = flowEl?.getBoundingClientRect()
    groupEntityMenu.x = Math.round(event.clientX - (rect?.left ?? 0))
    groupEntityMenu.y = Math.round(event.clientY - (rect?.top ?? 0))
    groupEntityMenu.groupId = groupId
    groupEntityMenu.show = true
  }

  /** 菜单：重命名分组（进入标题内联编辑） */
  function groupEntityRename(): void {
    const id = groupEntityMenu.groupId
    groupEntityMenu.show = false
    if (id) groupActions.startRename(id)
  }

  /** 菜单：更改分组颜色（在右键菜单处打开预设色板） */
  function groupEntityColor(): void {
    const id = groupEntityMenu.groupId
    const { x, y } = groupEntityMenu
    groupEntityMenu.show = false
    if (id) groupActions.openColorAt(id, x, y)
  }

  /** 菜单：解散分组（弹窗确认，仅删框、节点保留） */
  function groupEntityDissolve(): void {
    const id = groupEntityMenu.groupId
    groupEntityMenu.show = false
    if (id) void groupActions.dissolve(id)
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

  /** 关闭全部菜单（节点/连线右键菜单 + 群组菜单 + 分组实体菜单 + 添加节点菜单） */
  function closeAll(): void {
    contextMenu.show = false
    addMenu.show = false
    groupMenu.show = false
    groupEntityMenu.show = false
  }

  /** 关闭节点右键菜单 */
  function closeNodeMenu(): void {
    contextMenu.show = false
  }

  /** 重置菜单状态（切换画布目标时调用） */
  function reset(): void {
    closeAll()
    contextMenu.nodeId = ''
    groupEntityMenu.groupId = ''
  }

  return {
    contextMenu,
    contextMenuNode,
    canGenerateOf,
    hasHistoryOf,
    canSaveImage,
    saveTargetsOf,
    openContextMenu,
    contextGenerate,
    contextHistory,
    contextSaveAs,
    nodeHasConnections,
    contextDisconnect,
    contextRename,
    contextCopy,
    contextDelete,
    groupMenu,
    openGroupMenu,
    groupCopy,
    groupDelete,
    groupEntityMenu,
    openGroupEntityMenu,
    groupEntityRename,
    groupEntityColor,
    groupEntityDissolve,
    addMenu,
    openAddMenu,
    addNodeAt,
    closeAll,
    closeNodeMenu,
    reset,
  }
}
