/**
 * 选中状态组合式：单/多选节点、分组选中、连线选中、配置面板抑制标志、配置面板渲染信息与删除操作。
 * 菜单关闭/双击加节点等跨组合式动作由 AssetCanvas 的接线函数统一编排（本组合式保持单一职责）。
 *
 * 多选交互（Ctrl 框选/Ctrl 加减选）由 Vue Flow 内置能力承担：
 * - 应用级 selectedNodeIds 为「虚线框/整组操作」的数据源；
 * - Vue Flow 内部选中态经由 mirrorSelectionToVueFlow 镜像，保证节点选中边框一致；
 * - 框选结束（@selection-end）/空白点击（@pane-click）/节点点击时调用 syncFromVueFlow 或
 *   onNodeClick 同步回应用级状态（详见 AssetCanvas 接线）；
 * - 持久分组的选中集（selectedGroupIds）独立维护：分组节点 `selectable: false`，
 *   框选命中由 useCanvasGroups 在 @selection-end 自行判定后写入；
 * - **分组单元选中**：单击分组标题条（useCanvasGroups.onGroupDragEnd 的点击分支）调用
 *   selectGroupWithMembers / toggleGroupWithMembers，把分组与其全部组内节点一起写入选中集，
 *   使 Ctrl+C / Ctrl+V / Delete 按「整组」语义工作；点击节点或空白处照常清空分组选中。
 */

import { computed, ref } from 'vue'
import type { Component } from 'vue'
import type { EdgeMouseEvent, NodeMouseEvent } from '@vue-flow/core'
import { getPrototype } from '../../../canvas/registry'
import type { CanvasGroupData, CanvasNodeData } from '../../../canvas/types'
import { collectGroupSelectionUnit, isGroupUnitSelected, nodesInGroup } from '../../../canvas/groups'
import { isSyntheticNodeId } from '../../../canvas/groupSelection'
import { confirm } from '../../../utils/confirm'
import type { CanvasStoreApi } from './types'

/** useCanvasSelection 参数 */
export interface UseCanvasSelectionOptions {
  /** 画布数据 store（删除节点/分组） */
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
  /** 当前选中的持久分组 id 列表（框选完全包含/单击标题条写入；驱动分组高亮与整组复制删除） */
  const selectedGroupIds = ref<string[]>([])
  /** 当前选中连线 id（驱动 Delete 键删除连线） */
  const selectedEdgeId = ref('')
  /** 拖拽进行中：抑制配置面板显示（拖拽不触发配置） */
  const suppressEditor = ref(false)
  /** 程序化选中（如粘贴自动聚焦）后抑制配置面板自动弹出；用户点击节点后恢复 */
  const suppressPanelOnSelect = ref(false)
  /** 配置面板被用户手动关闭（X/Esc）：仅隐藏面板、保留节点选中与关联高亮；点击节点/切换选中后自动重开 */
  const panelDismissed = ref(false)

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

  /** 当前选中的分组列表（顺序与选中列表一致） */
  const selectedGroups = computed<CanvasGroupData[]>(() =>
    selectedGroupIds.value
      .map((id) => store.groups.value.find((g) => g.id === id))
      .filter((g): g is CanvasGroupData => !!g),
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

  /** 应用级多选（选中节点数 + 选中分组数 ≥ 2）：驱动虚线框与多选悬浮工具栏 */
  const hasMultiSelection = computed(() => selectedNodeIds.value.length + selectedGroupIds.value.length >= 2)

  /**
   * 点击节点：普通单击切换为单选该节点；Ctrl（或 Cmd）单击增/减选。
   *
   * **持久分组节点（`type: canvas-group`）不在此处理**：Vue Flow 仍会为分组节点派发 `node-click`
   * （`selectable: false` 不能阻止该事件），若照常清空分组选中，则「单击分组标题条 → 选中分组单元」
   * 会被随后补发的 click 立即清掉（双击进入重命名时同样如此）。分组选中只由
   * `useCanvasGroups`（标题条点击 / Ctrl 框选完全包含）与 `selectGroupWithMembers` 写入。
   * 合成节点（群组框/输出点）同理直接忽略。两者都只复位配置面板标志。
   *
   * 点击真实节点同时清空分组选中（FR-7.6）与**连线选中**（`selectedEdgeId`）——选中节点后其关联
   * 连线按方向分色高亮，若保留上一条被点选的连线，画面上会同时存在两种「主题色高亮」，
   * 用户无从判断当前焦点是节点还是连线。
   *
   * @param payload Vue Flow 节点点击事件（含 event 与 node）
   */
  function onNodeClick(payload: NodeMouseEvent): void {
    suppressEditor.value = false
    suppressPanelOnSelect.value = false
    panelDismissed.value = false
    const id = payload.node.id
    if (isSyntheticNodeId(id)) return
    if (store.groups.value.some((g) => g.id === id)) return
    selectedGroupIds.value = []
    selectedEdgeId.value = ''
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

  /**
   * 单节点拖动聚焦：拖动开始时把应用级选中切为**单选**该节点，同时抑制配置面板自动弹出。
   *
   * 语义（与「点击节点」的差别仅在面板）：拖动即选中——
   * - 应用级 `selectedNodeIds` 写入该节点后，`useCanvasFlow` 的单选联动高亮派生集
   *   （输入侧绿 / 输出侧橙连线 + 沿数据流向箭头动画 + 邻接节点分色描边）自动生效，
   *   拖动过程中即可看到该节点的输入/输出连接；AssetCanvas 既有的
   *   `watch(selectedNodeIds) → mirrorSelectionToVueFlow` 会把选中态镜像回 Vue Flow，
   *   故节点蓝色选中边框同样跟随；
   * - 拖动结束**保持选中**（Delete / Ctrl+C / 右键菜单等快捷键可用），面板仍不弹出；
   *   再次**单击**该节点由 `onNodeClick` 复位抑制标志后正常打开面板；
   * - 仅由 AssetCanvas 在「被拖动的真实节点恰好 1 个」时调用；多选整组拖动、拖动群组
   *   虚线框/输出点（合成节点）不调用，保持原有整组移动语义。
   *
   * @param nodeId 被拖动节点 id（不存在时忽略，不改变任何选中状态）
   */
  function focusNodeForDrag(nodeId: string): void {
    if (!store.nodes.value.some((n) => n.id === nodeId)) return
    setSelectedNodes([nodeId])
    suppressPanelOnSelect.value = true
  }

  /** 空白处点击：取消全部选中（节点 + 分组 + 连线）并恢复面板显示；双击加节点由 AssetCanvas 接线统一处理 */
  function onPaneClick(): void {
    suppressEditor.value = false
    suppressPanelOnSelect.value = false
    panelDismissed.value = false
    selectedNodeIds.value = []
    selectedGroupIds.value = []
    selectedEdgeId.value = ''
  }

  /**
   * 记录当前选中的连线（主题色高亮 + 供 Delete 键/连线右键菜单断开）。
   *
   * 仅写入连线选中，**不改变节点选中**：连线的关联高亮（绿/橙）与节点的关联高亮是两套
   * 独立派生集，允许同屏并存（详见 useCanvasFlow 的 class 优先级）。清空时机为点击空白
   * （`onPaneClick`）、点击节点（`onNodeClick`）、重置（`reset`）；连线被删除后其 id 不再
   * 命中任何连线，class 自然失效（无需额外清理）。
   *
   * @param payload Vue Flow 连线点击事件（含连线）
   */
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

  /** 绝对写入分组选中集（框选完全包含判定 / 单击标题条时调用；过滤不存在的分组 id 并去重） */
  function setSelectedGroups(groupIds: string[]): void {
    const existing = new Set(store.groups.value.map((g) => g.id))
    const seen = new Set<string>()
    const next: string[] = []
    for (const id of groupIds) {
      if (!existing.has(id) || seen.has(id)) continue
      seen.add(id)
      next.push(id)
    }
    selectedGroupIds.value = next
  }

  /**
   * 选中「分组单元」：单击分组标题条时把分组与其**全部组内节点**一起选中
   * （成员判定 = 节点矩形与分组矩形重叠，含嵌套子分组内的节点，子分组框本身不入选）。
   *
   * 语义与普通单击节点一致：**替换**当前全部选中（分组 + 节点），并清空连线选中
   * （避免与「选中节点后关联连线分色高亮」两种焦点并存）；同时复位配置面板抑制标志
   * （与 onNodeClick 相同，保证后续点击行为一致）。分组不存在时忽略。
   *
   * @param groupId 分组 id
   */
  function selectGroupWithMembers(groupId: string): void {
    const group = store.groups.value.find((g) => g.id === groupId)
    if (!group) return
    suppressEditor.value = false
    suppressPanelOnSelect.value = false
    panelDismissed.value = false
    selectedEdgeId.value = ''
    const unit = collectGroupSelectionUnit(group, store.nodes.value)
    setSelectedGroups([unit.groupId])
    setSelectedNodes(unit.nodeIds)
  }

  /**
   * 增/减选「分组单元」（`Ctrl` 单击分组标题条）：已整体选中 → 分组与其成员节点一起摘除；
   * 否则 → 分组与其成员节点一起加入当前选中集（保留原有节点选中，便于跨分组累计）。
   *
   * @param groupId 分组 id
   */
  function toggleGroupWithMembers(groupId: string): void {
    const group = store.groups.value.find((g) => g.id === groupId)
    if (!group) return
    const unit = collectGroupSelectionUnit(group, store.nodes.value)
    const groupSelected = isGroupUnitSelected(
      group,
      store.nodes.value,
      selectedGroupIds.value,
      selectedNodeIds.value,
    )
    if (groupSelected) {
      setSelectedGroups(selectedGroupIds.value.filter((id) => id !== unit.groupId))
      const removed = new Set(unit.nodeIds)
      setSelectedNodes(selectedNodeIds.value.filter((id) => !removed.has(id)))
      return
    }
    setSelectedGroups([...selectedGroupIds.value, unit.groupId])
    setSelectedNodes([...selectedNodeIds.value, ...unit.nodeIds])
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
   * 关闭配置面板（X 按钮 / Esc）：仅隐藏面板，不改动选中态——
   * 节点保持聚焦（选中边框/关联高亮/Delete 等快捷键均保留）。
   * 再次点击当前节点或选中其他节点时面板自动重新打开（onNodeClick 复位该标志）。
   */
  function dismissPanel(): void {
    panelDismissed.value = true
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
   * 删除当前选中内容（节点 + 分组，弹窗确认一次）。无选中时忽略。
   *
   * 语义（FR-9.1 / FR-9.2）：
   * - **仅分组被选中**（不含任何节点）→ 「解散分组」：只删框，组内节点保留；
   * - **含节点选中** → 删除选中节点，并连带解散选中分组；此外把**选中分组的全部成员节点**
   *   一并删除（补集：成员节点 − 已选中节点）——「分组单元选中」（单击标题条）下按 Delete
   *   即删除整组内容，与复制/粘贴的整组语义一致。删除节点与分组仍为**一次确认、单次撤销**。
   */
  async function deleteSelected(): Promise<void> {
    const nodeIds = selectedNodeIds.value
    const groupIds = selectedGroupIds.value
    if (nodeIds.length === 0 && groupIds.length === 0) return
    const nodes = selectedNodes.value
    const groups = selectedGroups.value

    // 仅分组选中：解散语义（只删框，节点保留）
    if (nodeIds.length === 0) {
      const memberCounts = groups.map((g) => nodesInGroup(g, store.nodes.value).length)
      const memberTotal = memberCounts.reduce((sum, n) => sum + n, 0)
      const content = groups.length === 1
        ? `确定解散分组「${groups[0]?.name ?? ''}」？组内 ${memberTotal} 个节点将保留，不会被删除。`
        : `确定解散选中的 ${groups.length} 个分组？组内共 ${memberTotal} 个节点将保留，不会被删除。`
      const ok = await confirm({
        title: '解散分组',
        content,
        confirmText: '解散',
        confirmColor: 'error',
      })
      if (!ok) return
      store.removeGroups(groupIds)
      selectedGroupIds.value = []
      return
    }

    // 含节点选中：除显式选中的节点外，选中分组的其余成员节点一并删除（分组单元语义的补集）
    const explicit = new Set(nodeIds)
    const memberIds = new Set<string>()
    for (const g of groups) {
      for (const n of nodesInGroup(g, store.nodes.value)) {
        if (!explicit.has(n.id)) memberIds.add(n.id)
      }
    }
    const allNodeIds = [...nodeIds, ...memberIds]
    const title = groupIds.length > 0
      ? '删除选中内容'
      : (nodeIds.length === 1 ? '删除节点' : '删除选中节点')
    let content: string
    if (groups.length === 1 && groupIds.length === 1) {
      const name = groups[0]?.name ?? ''
      const extra = memberIds.size - nodeIds.length
      content = extra > 0
        ? `确定删除分组「${name}」及其 ${allNodeIds.length} 个节点（含组内其余节点）？`
        : `确定删除分组「${name}」及其 ${allNodeIds.length} 个节点？`
    } else if (groupIds.length > 0) {
      content = `确定删除选中的 ${allNodeIds.length} 个节点和 ${groupIds.length} 个分组？`
    } else if (nodeIds.length === 1) {
      content = `确定删除节点「${nodes[0]?.name ?? ''}」？`
    } else {
      content = `确定删除选中的 ${allNodeIds.length} 个节点？`
    }
    const ok = await confirm({ title, content, confirmText: '删除', confirmColor: 'error' })
    if (!ok) return
    if (allNodeIds.length === 1 && groupIds.length === 0) {
      store.removeNode(allNodeIds[0])
    } else {
      store.removeNodes(allNodeIds, groupIds)
    }
    selectedNodeIds.value = []
    selectedGroupIds.value = []
  }

  /** 重置全部选中状态（切换画布目标/组件卸载时调用） */
  function reset(): void {
    suppressEditor.value = false
    suppressPanelOnSelect.value = false
    panelDismissed.value = false
    selectedNodeIds.value = []
    selectedGroupIds.value = []
    selectedEdgeId.value = ''
  }

  return {
    selectedNodeId,
    selectedNodeIds,
    selectedNode,
    selectedNodes,
    selectedGroupIds,
    selectedGroups,
    selectedEdgeId,
    suppressEditor,
    suppressPanelOnSelect,
    panelDismissed,
    isMultiSelected,
    hasMultiSelection,
    editorPanel,
    onNodeClick,
    onNodeDragStart,
    focusNodeForDrag,
    onPaneClick,
    onEdgeClick,
    setSelectedNode,
    setSelectedNodes,
    toggleSelectNode,
    setSelectedGroups,
    selectGroupWithMembers,
    toggleGroupWithMembers,
    syncFromVueFlow,
    setSuppressPanelOnSelect,
    dismissPanel,
    deleteNode,
    deleteSelected,
    reset,
  }
}
