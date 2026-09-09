/**
 * 持久分组交互组合式：创建 / 拖动（R2 级联跟随）/ 缩放回写 / 重命名 / 改色 / 解散 /
 * 框选完全包含判定 / Ctrl 穿透状态 / 多选拖动时选中分组跟随。
 *
 * 关键实现约束（见 docs/canvas/interactions.md 与 Vue Flow 源码核实结论）：
 * - 分组节点 `selectable: false`（T1）：Vue Flow 框选**永远不会**选中分组，
 *   因此「完全框选选中分组」必须由本组合式在 `@selection-end` 自行判定
 *   （`userSelectionRect` 在该事件前已被置空（T5），只能从 selection-start / selection-end 的指针事件换算选框矩形）；
 * - 分组节点 `draggable: false`（T6）：原生拖动会连带移动全部选中节点，导致「节点被移动两次」，
 *   故分组拖动为自定义实现（window mousemove/mouseup）；
 * - 拖动中**不写 store**，仅经 `updateNodePosition` 命令式移动 Vue Flow 内部节点（视图跟随，
 *   连线同步跟随）；`mouseup` 时一次性经 `store.moveEntities` 回写（单次撤销，不污染撤销栈）。
 */

import { computed, reactive, ref } from 'vue'
import type { Ref } from 'vue'
import type { NodeDragEvent } from '@vue-flow/core'
import type { OnResizeEnd } from '@vue-flow/node-resizer'
import {
  GROUP_CONTAIN_TOLERANCE,
  GROUP_DRAG_MIN_PX,
  GROUP_HEADER_HEIGHT,
  GROUP_MIN_SIZE,
  GROUP_PALETTE,
  collectDragFollowSet,
  groupRectFromNodes,
  rectContains,
  rectsOverlap,
  type RectLike,
} from '../../../canvas/groups'
import { GROUP_FRAME_PADDING } from '../../../canvas/groupSelection'
import { confirm } from '../../../utils/confirm'
import type { CanvasNodeData } from '../../../canvas/types'
import type { CanvasStoreApi, NodeMap, ScreenToFlow, ShowSnackbar } from './types'

/** useCanvasGroups 参数 */
export interface UseCanvasGroupsOptions {
  /** 画布数据 store（分组 CRUD / 批量移动 / 解散） */
  store: CanvasStoreApi
  /** 节点 id → 节点数据索引 */
  nodeMap: NodeMap
  /** Vue Flow 屏幕坐标 → 流坐标换算（框选矩形换算） */
  screenToFlowCoordinate: ScreenToFlow
  /** Vue Flow 视口（拖动位移需除以 zoom 换算为流坐标） */
  viewport: Ref<{ x: number; y: number; zoom: number }>
  /** 画布容器 DOM（改色菜单定位基准） */
  flowEl: Ref<HTMLDivElement | null>
  /**
   * 命令式移动 Vue Flow 内部节点（拖动中视图跟随）：
   * 不写 store、不入撤销栈，仅更新内部坐标使节点与连线实时跟随；结束由 store 统一回写。
   */
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void
  /** 选中控制（分组选中集与应用级选中状态联动） */
  selection: {
    /** 读取当前选中节点 id 列表 */
    getSelectedNodeIds: () => string[]
    /** 读取当前选中分组 id 列表 */
    getSelectedGroupIds: () => string[]
    /** 绝对写入分组选中集 */
    setSelectedGroups: (groupIds: string[]) => void
    /** 增/减选单个分组（Ctrl 单击语义） */
    toggleSelectGroup: (groupId: string) => void
    /** 清空节点选中（单击分组标题条时单选分组） */
    clearNodeSelection: () => void
  }
  /** 操作反馈提示（snackbar） */
  showSnackbar: ShowSnackbar
}

/** 分组拖动进行中的状态（非响应式：仅事件处理器读写，避免逐帧触发重渲染） */
interface GroupDragState {
  /** 被拖动的分组 id（根分组） */
  groupId: string
  /** 拖动起点（屏幕坐标） */
  startClientX: number
  startClientY: number
  /** 是否已超过点击判定阈值（false 时 mouseup 视为「点击选中」） */
  moved: boolean
  /** 跟随平移的分组 id（含根分组与被完全包含的子分组） */
  followGroupIds: string[]
  /** 跟随平移的节点 id（与跟随分组重叠的节点） */
  followNodeIds: string[]
  /** 拖动开始时各跟随分组的原始坐标（结束回写绝对坐标用） */
  originGroups: { id: string; x: number; y: number }[]
  /** 拖动开始时各跟随节点的原始坐标 */
  originNodes: { id: string; x: number; y: number }[]
}

/** 多选拖动跟随状态（拖动已选中节点时，选中分组框同步跟随） */
interface NodeDragFollowState {
  /** 跟随的选中分组 id 列表 */
  groupIds: string[]
  /** 相对拖动起点的累计位移（流坐标） */
  dx: number
  dy: number
}

/**
 * 持久分组交互组合式。
 *
 * @param options 依赖注入参数
 * @returns 分组交互状态与操作 API
 */
export function useCanvasGroups(options: UseCanvasGroupsOptions) {
  const { store, nodeMap, screenToFlowCoordinate, viewport, flowEl, updateNodePosition, selection, showSnackbar } = options

  // ── Ctrl 键状态（分组节点穿透类，T4）──────────────────────

  /** Ctrl（Cmd）是否按下：按下时分组节点整体穿透指针事件，「Ctrl+拖拽 = 框选」零例外 */
  const ctrlHeld = ref(false)

  /**
   * 键盘按下：维护 Ctrl 状态。
   *
   * @param event 键盘事件
   */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Control' || event.ctrlKey || event.metaKey) ctrlHeld.value = true
  }

  /**
   * 键盘抬起：Ctrl 全部松开时复位。
   *
   * @param event 键盘事件
   */
  function onKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Control' || (!event.ctrlKey && !event.metaKey)) ctrlHeld.value = false
  }

  /** 窗口失焦：复位 Ctrl 状态并取消进行中的分组拖动（避免监听器悬挂与坐标错位） */
  function onWindowBlur(): void {
    ctrlHeld.value = false
    cancelGroupDrag()
  }

  // ── 空分组标记（FR-2.4）──────────────────────────────────

  /** 组内无任何节点的分组 id 集合（标题条显示「空」并降低不透明度；不自动删除） */
  const emptyGroupIds = computed<Set<string>>(() => {
    const set = new Set<string>()
    const nodes = store.nodes.value
    for (const g of store.groups.value) {
      if (!nodes.some((n) => rectsOverlap(g, n))) set.add(g.id)
    }
    return set
  })

  // ── 创建分组（FR-1）──────────────────────────────────────

  /**
   * 用当前选中节点创建分组：初始矩形 = 选中节点包围盒 + 四周 GROUP_FRAME_PADDING 留白
   * + 顶部额外 GROUP_HEADER_HEIGHT 留白（容纳标题条，保证最上方节点不被标题条压住，
   * 顶部合计 12 + 28 = 40px）。
   * 创建后保持多选状态（便于连续创建），snackbar 提示节点数量。
   */
  function createGroupFromSelection(): void {
    const nodes = selection
      .getSelectedNodeIds()
      .map((id) => nodeMap.value[id])
      .filter((n): n is CanvasNodeData => !!n)
    if (nodes.length === 0) {
      showSnackbar('请先框选至少 2 个节点再创建分组', 'error')
      return
    }
    const rect = groupRectFromNodes(nodes, GROUP_FRAME_PADDING, GROUP_HEADER_HEIGHT)
    if (!rect) return
    const group = store.addGroup(rect)
    showSnackbar(`已创建分组「${group.name}」（含 ${nodes.length} 个节点）`, 'success')
  }

  // ── 框选完全包含判定（FR-7.1 / FR-7.2）────────────────────

  /** 框选起点（屏幕坐标；@selection-start 记录，@selection-end 换算选框矩形） */
  let marqueeStart: { x: number; y: number } | null = null

  /**
   * 框选开始：记录屏幕起点（此时 `userSelectionRect` 尚不可读，见 T5）。
   *
   * @param event 指针事件（Vue Flow selection-start 抛出的原生事件）
   */
  function onSelectionStart(event: MouseEvent): void {
    marqueeStart = { x: event.clientX, y: event.clientY }
  }

  /**
   * 框选结束：用起止两点的流坐标算出选框矩形，把**被完全包含**（容差 2px）的分组加入选中集。
   * 仅相交不选中（FR-7.1）；完全包含时其成员节点必然同时被 Vue Flow 的 Partial 模式选中（FR-7.3）。
   *
   * @param event 指针事件（Vue Flow selection-end 抛出的原生事件）
   */
  function onSelectionEnd(event: MouseEvent): void {
    const start = marqueeStart
    marqueeStart = null
    if (!start) return
    const a = screenToFlowCoordinate(start)
    const b = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    const marquee: RectLike = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    }
    const ids = store.groups.value
      .filter((g) => rectContains(marquee, g, GROUP_CONTAIN_TOLERANCE))
      .map((g) => g.id)
    selection.setSelectedGroups(ids)
  }

  // ── 分组拖动（FR-3，自定义拖动，T6）──────────────────────

  /** 进行中的分组拖动状态（null = 未拖动） */
  let groupDrag: GroupDragState | null = null

  /**
   * 分组标题条 / 四边按下：启动自定义拖动。
   * 按住 Ctrl（或 Cmd）时直接返回——此时分组节点已整体穿透指针事件，不会走到这里；
   * 双重判定用于「先按下再按 Ctrl」的极端时序。
   *
   * @param groupId 被拖动的分组 id
   * @param event 鼠标按下事件
   */
  function onGroupDragStart(groupId: string, event: MouseEvent): void {
    if (event.button !== 0) return
    if (ctrlHeld.value || event.ctrlKey || event.metaKey) return
    const group = store.groups.value.find((g) => g.id === groupId)
    if (!group) return
    // 兜底清理上一次手势遗留的 click 拦截器
    disarmClickSuppressor()
    event.preventDefault()
    event.stopPropagation()
    const follow = collectDragFollowSet(store.groups.value, store.nodes.value, groupId)
    groupDrag = {
      groupId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
      followGroupIds: follow.groupIds,
      followNodeIds: follow.nodeIds,
      originGroups: follow.groupIds
        .map((id) => store.groups.value.find((g) => g.id === id))
        .filter((g): g is NonNullable<typeof g> => !!g)
        .map((g) => ({ id: g.id, x: g.x, y: g.y })),
      originNodes: follow.nodeIds
        .map((id) => store.nodes.value.find((n) => n.id === id))
        .filter((n): n is CanvasNodeData => !!n)
        .map((n) => ({ id: n.id, x: n.x, y: n.y })),
    }
    window.addEventListener('mousemove', onGroupDragMove)
    window.addEventListener('mouseup', onGroupDragEnd)
  }

  /**
   * 拖动位移（流坐标）：屏幕位移除以当前缩放比例。
   *
   * @param event 鼠标事件
   * @param state 拖动状态
   * @returns 流坐标位移
   */
  function dragDelta(event: MouseEvent, state: GroupDragState): { dx: number; dy: number } {
    const zoom = viewport.value?.zoom ?? 1
    return {
      dx: (event.clientX - state.startClientX) / zoom,
      dy: (event.clientY - state.startClientY) / zoom,
    }
  }

  /**
   * 拖动中：超过点击阈值后，命令式移动跟随分组与跟随节点（不写 store）。
   *
   * @param event 鼠标事件
   */
  function onGroupDragMove(event: MouseEvent): void {
    const state = groupDrag
    if (!state) return
    if (!state.moved) {
      const distance = Math.hypot(event.clientX - state.startClientX, event.clientY - state.startClientY)
      if (distance < GROUP_DRAG_MIN_PX) return
      state.moved = true
    }
    const { dx, dy } = dragDelta(event, state)
    for (const g of state.originGroups) {
      updateNodePosition(g.id, { x: g.x + dx, y: g.y + dy })
    }
    for (const n of state.originNodes) {
      updateNodePosition(n.id, { x: n.x + dx, y: n.y + dy })
    }
  }

  /**
   * 拖动结束：位移未超过阈值 → 视为点击（选中该分组 / Ctrl 增选）；
   * 否则一次性回写 store（分组 + 跟随节点，单次撤销）。
   *
   * @param event 鼠标事件
   */
  function onGroupDragEnd(event: MouseEvent): void {
    const state = groupDrag
    if (!state) return
    groupDrag = null
    window.removeEventListener('mousemove', onGroupDragMove)
    window.removeEventListener('mouseup', onGroupDragEnd)

    if (!state.moved) {
      if (event.ctrlKey || event.metaKey) {
        selection.toggleSelectGroup(state.groupId)
      } else {
        selection.clearNodeSelection()
        selection.setSelectedGroups([state.groupId])
      }
      return
    }

    // 拖动结束浏览器会对同一手势补发一次 click，若释放点落在画布空白处会命中 pane 并清空选中：
    // 安装一次性捕获阶段拦截器吞掉该合成 click（与 useCanvasGroup 输出点拖拽同一手法）
    armClickSuppressor()
    const { dx, dy } = dragDelta(event, state)
    const groupPatches = state.originGroups.map((g) => ({
      id: g.id,
      x: Math.round(g.x + dx),
      y: Math.round(g.y + dy),
    }))
    const nodePatches = state.originNodes.map((n) => ({
      id: n.id,
      x: Math.round(n.x + dx),
      y: Math.round(n.y + dy),
    }))
    store.moveEntities(nodePatches, groupPatches)
  }

  /**
   * 取消进行中的分组拖动：移除监听并把内部坐标还原为 store 中的坐标（视图回到拖动前状态）。
   */
  function cancelGroupDrag(): void {
    const state = groupDrag
    if (!state) return
    groupDrag = null
    window.removeEventListener('mousemove', onGroupDragMove)
    window.removeEventListener('mouseup', onGroupDragEnd)
    for (const g of state.originGroups) {
      updateNodePosition(g.id, { x: g.x, y: g.y })
    }
    for (const n of state.originNodes) {
      updateNodePosition(n.id, { x: n.x, y: n.y })
    }
  }

  // ── 拖动结束后的合成 click 拦截（T2：避免误清选中）────────

  /** 当前已安装的捕获阶段 click 拦截器（null 表示未安装；与一次手势一一对应） */
  let clickSuppressorHandler: ((event: MouseEvent) => void) | null = null

  /**
   * 安装一次性捕获阶段 click 拦截器：吞掉「拖拽释放 → 浏览器补发的合成 click」，
   * 防止该 click 命中 Vue Flow pane 触发 pane-click（清空刚选中的分组）。
   * 拦截到 click 后立即自卸；未被消费时由下次 mousedown / 权重置兜底清理。
   */
  function armClickSuppressor(): void {
    if (clickSuppressorHandler) return
    const handler = (event: MouseEvent): void => {
      // 先自卸再吞事件：保证只拦截本次合成 click，后续点击与菜单内部交互不受影响
      disarmClickSuppressor()
      event.preventDefault()
      event.stopPropagation()
    }
    clickSuppressorHandler = handler
    window.addEventListener('click', handler, true)
  }

  /** 卸载 click 拦截器（兜底清理；正常路径由拦截器自卸） */
  function disarmClickSuppressor(): void {
    if (!clickSuppressorHandler) return
    window.removeEventListener('click', clickSuppressorHandler, true)
    clickSuppressorHandler = null
  }

  // ── 多选拖动时选中分组跟随（FR-7 / 交互规则表）────────────

  /** 进行中的多选拖动跟随状态（null = 无） */
  let nodeDragFollow: NodeDragFollowState | null = null

  /**
   * 节点拖动中（`@node-drag`）：若选中集包含分组，则把选中分组按被拖节点的位移同步移动。
   * 只移动分组（节点由 Vue Flow 原生拖动负责，避免二次位移）。
   *
   * @param payload Vue Flow 节点拖动事件（含被拖节点与事件）
   */
  function onNodeDragFollow(payload: NodeDragEvent): void {
    const groupIds = selection.getSelectedGroupIds()
    if (groupIds.length === 0) return
    const dragged = payload.nodes.find((n) => !!nodeMap.value[n.id])
    if (!dragged) return
    const origin = store.nodes.value.find((n) => n.id === dragged.id)
    if (!origin) return
    const dx = dragged.position.x - origin.x
    const dy = dragged.position.y - origin.y
    nodeDragFollow = { groupIds, dx, dy }
    for (const id of groupIds) {
      const group = store.groups.value.find((g) => g.id === id)
      if (!group) continue
      updateNodePosition(id, { x: group.x + dx, y: group.y + dy })
    }
  }

  /**
   * 节点拖动结束：取出选中分组的最终位置补丁（供 store 与节点位置一次性回写，单次撤销）。
   *
   * @returns 分组位置补丁列表（无跟随分组时为空数组）
   */
  function takeNodeDragFollowPatches(): { id: string; x: number; y: number }[] {
    const state = nodeDragFollow
    nodeDragFollow = null
    if (!state) return []
    return state.groupIds
      .map((id) => {
        const group = store.groups.value.find((g) => g.id === id)
        return group ? { id, x: Math.round(group.x + state.dx), y: Math.round(group.y + state.dy) } : null
      })
      .filter((p): p is { id: string; x: number; y: number } => !!p)
  }

  // ── 缩放（FR-4）──────────────────────────────────────────

  /**
   * 缩放结束：把最终几何回写 store（单次撤销）。
   * 缩放**不移动、不缩放**组内节点（FR-4.4）；缩到与节点不再重叠时该节点自动脱离（成员派生，FR-4.5）。
   *
   * @param groupId 被缩放的分组 id
   * @param payload 缩放结束事件（params 含最终 x/y/width/height）
   */
  function onGroupResizeEnd(groupId: string, payload: OnResizeEnd): void {
    const group = store.groups.value.find((g) => g.id === groupId)
    if (!group) return
    const { params } = payload
    const x = Math.round(params.x)
    const y = Math.round(params.y)
    const width = Math.max(GROUP_MIN_SIZE.width, Math.round(params.width))
    const height = Math.max(GROUP_MIN_SIZE.height, Math.round(params.height))
    if (group.x === x && group.y === y && group.width === width && group.height === height) return
    store.updateGroup(groupId, { x, y, width, height })
  }

  // ── 重命名（FR-5.1）──────────────────────────────────────

  /** 正在内联编辑标题的分组 id（空 = 未编辑） */
  const renamingGroupId = ref('')
  /** 内联编辑输入框的临时值 */
  const groupRenameInput = ref('')

  /**
   * 进入标题内联编辑（双击标题条 / 右键菜单「重命名」）。
   *
   * @param groupId 分组 id
   */
  function startRenameGroup(groupId: string): void {
    renamingGroupId.value = groupId
    groupRenameInput.value = store.groups.value.find((g) => g.id === groupId)?.name ?? ''
  }

  /**
   * 提交标题修改（回车 / 失焦）；空名放弃修改。
   *
   * @param groupId 分组 id
   */
  function commitRenameGroup(groupId: string): void {
    if (renamingGroupId.value !== groupId) return
    const name = groupRenameInput.value.trim()
    if (name) store.updateGroup(groupId, { name })
    renamingGroupId.value = ''
  }

  /** 取消标题编辑（Esc） */
  function cancelRenameGroup(): void {
    renamingGroupId.value = ''
  }

  // ── 改色（FR-5.2 / FR-5.3）────────────────────────────────

  /** 预设色板菜单状态（x/y 相对画布容器） */
  const colorMenu = reactive({ show: false, x: 0, y: 0, groupId: '' })

  /**
   * 在画布容器指定坐标打开预设色板菜单（右键菜单「更改颜色」路径）。
   *
   * @param groupId 分组 id
   * @param x 相对画布容器的 x 坐标
   * @param y 相对画布容器的 y 坐标
   */
  function openColorMenuAt(groupId: string, x: number, y: number): void {
    colorMenu.x = Math.round(x)
    colorMenu.y = Math.round(y)
    colorMenu.groupId = groupId
    colorMenu.show = true
  }

  /**
   * 打开预设色板菜单（定位到色点按钮；标题条色点点击路径）。
   *
   * @param groupId 分组 id
   * @param event 点击事件（提供菜单锚点）
   */
  function openColorMenu(groupId: string, event: MouseEvent): void {
    const rect = flowEl.value?.getBoundingClientRect()
    openColorMenuAt(groupId, event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0))
  }

  /**
   * 选中预设色：更新分组主题色（标题条 / 填充 / 边框同步变化，单次撤销）。
   *
   * @param color 色板颜色 hex
   */
  function pickGroupColor(color: string): void {
    const id = colorMenu.groupId
    colorMenu.show = false
    if (id) store.updateGroup(id, { color })
  }

  /** 关闭预设色板菜单 */
  function closeColorMenu(): void {
    colorMenu.show = false
  }

  // ── 解散分组（FR-9.2）────────────────────────────────────

  /**
   * 解散分组：仅删除分组框，组内节点保留（删除类操作，弹窗确认）。
   *
   * @param groupId 分组 id
   */
  async function dissolveGroup(groupId: string): Promise<void> {
    const group = store.groups.value.find((g) => g.id === groupId)
    if (!group) return
    const ok = await confirm({
      title: '解散分组',
      content: `确定解散分组「${group.name}」？组内节点将保留。`,
      confirmText: '解散',
      confirmColor: 'error',
    })
    if (!ok) return
    store.removeGroups([groupId])
    selection.setSelectedGroups(selection.getSelectedGroupIds().filter((id) => id !== groupId))
  }

  /** 重置全部分组交互状态（切换画布目标 / 组件卸载时调用） */
  function reset(): void {
    cancelGroupDrag()
    disarmClickSuppressor()
    ctrlHeld.value = false
    marqueeStart = null
    nodeDragFollow = null
    renamingGroupId.value = ''
    groupRenameInput.value = ''
    colorMenu.show = false
    colorMenu.groupId = ''
  }

  return {
    ctrlHeld,
    emptyGroupIds,
    colorMenu,
    colorPalette: GROUP_PALETTE,
    renamingGroupId,
    groupRenameInput,
    createGroupFromSelection,
    onSelectionStart,
    onSelectionEnd,
    onGroupDragStart,
    onGroupResizeEnd,
    onNodeDragFollow,
    takeNodeDragFollowPatches,
    startRenameGroup,
    commitRenameGroup,
    cancelRenameGroup,
    openColorMenu,
    openColorMenuAt,
    pickGroupColor,
    closeColorMenu,
    dissolveGroup,
    onKeyDown,
    onKeyUp,
    onWindowBlur,
    reset,
  }
}
