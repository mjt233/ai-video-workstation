/**
 * 成组群组组合式：多选包围盒计算、群组输出点连接拖拽、释放后目标节点选择菜单、
 * 成组连接执行与忽略反馈。
 *
 * 交互说明（见 docs/asset-canvas.md §5）：
 * - 群组虚线框由合成 Vue Flow 节点（__group-frame）渲染，拖动由 Vue Flow 原生拖动承接
 *   （框架节点 draggable，native drag 会把全部选中节点一起移动，node-drag-stop 批量回写）；
 * - 群组输出点由合成节点（__group-dot）渲染，mousedown 启动本组合式的自定义拖拽：
 *   拖到其他节点上释放 → 成组连接（类型不兼容/成环/重复/目标在组内 → 忽略 + 气泡提示）；
 *   释放时未命中已有节点（拖拽位移超过最小判定）→ 弹出目标原型选择菜单，
 *   点击后在释放点创建节点并连接兼容源。
 */

import { computed, reactive } from 'vue'
import type { Ref } from 'vue'
import {
  computeGroupRect,
  findNodeAt,
  groupConnectOptions,
  groupOutputTypes,
  GROUP_CONNECT_MIN_DRAG_PX,
  GROUP_FRAME_PADDING,
  type GroupRect,
} from '../../../canvas/groupSelection'
import type { GroupConnectResult } from '../../../canvas/useCanvasStore'
import type { CanvasNodeData } from '../../../canvas/types'
import type { CanvasStoreApi, NodeMap, ScreenToFlow, ShowSnackbar } from './types'

/** useCanvasGroup 参数 */
export interface UseCanvasGroupOptions {
  /** 画布数据 store（成组连接执行/创建节点并连接） */
  store: CanvasStoreApi
  /** 节点 id → 节点数据索引 */
  nodeMap: NodeMap
  /** 当前选中节点 id 列表读取（getter，避免把 ref 直接跨组合式传递） */
  getSelectedNodeIds: () => string[]
  /** Vue Flow 屏幕坐标 → 流坐标换算 */
  screenToFlowCoordinate: ScreenToFlow
  /** Vue Flow 视口（pan/zoom 实时更新；预览线/菜单定位用） */
  viewport: Ref<{ x: number; y: number; zoom: number }>
  /** 画布容器 DOM（相对定位基准） */
  flowEl: Ref<HTMLDivElement | null>
  /** 操作反馈提示（snackbar） */
  showSnackbar: ShowSnackbar
  /** 新节点创建后聚焦（程序化单选新节点并抑制配置面板弹出） */
  focusNode: (nodeIds: string[]) => void
}

/** 忽略原因说明 */
const SKIP_REASON_LABELS: Record<GroupConnectResult['skipped'][number]['reason'], string> = {
  incompatible: '类型不兼容',
  cycle: '会形成循环',
  'in-group': '目标在选区内',
  duplicate: '已有相同连接',
}

/**
 * 成组群组组合式。
 *
 * @param options 依赖注入参数
 * @returns 群组状态与操作 API
 */
export function useCanvasGroup(options: UseCanvasGroupOptions) {
  const { store, nodeMap, getSelectedNodeIds, screenToFlowCoordinate, viewport, flowEl, showSnackbar, focusNode } = options

  // ── 群组包围盒（合成节点定位基准）────────────────────────

  /** 当前多选（≥2 个）节点的包围盒（含与边缘节点的留白；单选/无选中时为 null，不渲染合成节点） */
  const groupRect = computed<GroupRect | null>(() => {
    const ids = getSelectedNodeIds()
    if (ids.length < 2) return null
    const nodes = ids
      .map((id) => nodeMap.value[id])
      .filter((n): n is CanvasNodeData => !!n)
    if (nodes.length < 2) return null
    // 虚线框与边缘节点保留留白（GROUP_FRAME_PADDING），便于辨认框选结果与整组拖动
    return computeGroupRect(nodes, GROUP_FRAME_PADDING)
  })

  // ── 群组输出点连接拖拽状态 ──────────────────────────────

  /** 连接拖拽状态：起点/当前屏幕坐标 + 悬停目标节点 id */
  const connectDrag = reactive({
    active: false,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    hoveredNodeId: '',
  })

  /** 目标原型选择菜单状态（x/y 相对画布容器；flowX/flowY 为新节点流坐标） */
  const connectMenu = reactive({ show: false, x: 0, y: 0, flowX: 0, flowY: 0 })

  /** 连接预览线（画布容器相对坐标；拖拽中才有值） */
  const connectLine = computed<{ x1: number; y1: number; x2: number; y2: number } | null>(() => {
    if (!connectDrag.active || !groupRect.value) return null
    const rect = groupRect.value
    const zoom = viewport.value?.zoom ?? 1
    const dotX = rect.x + rect.width
    const dotY = rect.y + rect.height / 2
    const el = flowEl.value
    const base = el?.getBoundingClientRect()
    return {
      x1: (viewport.value?.x ?? 0) + dotX * zoom,
      y1: (viewport.value?.y ?? 0) + dotY * zoom,
      x2: connectDrag.x - (base?.left ?? 0),
      y2: connectDrag.y - (base?.top ?? 0),
    }
  })

  /** 菜单候选（全部有输入端口的原型，按群组输出类型标记兼容性） */
  const menuItems = computed(() => {
    const ids = getSelectedNodeIds()
    const nodes = ids
      .map((id) => nodeMap.value[id])
      .filter((n): n is CanvasNodeData => !!n)
    return groupConnectOptions(groupOutputTypes(nodes))
  })

  /** 当前悬停目标节点（非选中节点，供高亮） */
  const hoveredNodeId = computed(() => connectDrag.hoveredNodeId)

  // ── 输出点拖拽 ─────────────────────────────────────────

  /** 输出点 mousedown：启动连接拖拽（预览线 + 命中检测） */
  function onDotMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return
    // 兜底清理上一次手势遗留的 click 拦截器（理论上 click 总会跟随 mouseup 触发，此处防极端情况）
    disarmClickSuppressor()
    event.preventDefault()
    event.stopPropagation()
    connectDrag.active = true
    connectDrag.startX = event.clientX
    connectDrag.startY = event.clientY
    connectDrag.x = event.clientX
    connectDrag.y = event.clientY
    connectDrag.hoveredNodeId = ''
    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('mouseup', onWindowMouseUp)
  }

  /** 输出点拖拽移动：更新预览线与悬停目标节点 */
  function onWindowMouseMove(event: MouseEvent): void {
    if (!connectDrag.active) return
    connectDrag.x = event.clientX
    connectDrag.y = event.clientY
    const flowPos = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    const exclude = new Set(getSelectedNodeIds())
    connectDrag.hoveredNodeId = findNodeAt(flowPos, store.nodes.value, exclude)?.id ?? ''
  }

  /** 输出点拖拽释放：命中目标 → 成组连接；未命中任何节点 → 弹出目标原型菜单（点击圆点未拖拽除外） */
  function onWindowMouseUp(event: MouseEvent): void {
    if (!connectDrag.active) return
    connectDrag.active = false
    window.removeEventListener('mousemove', onWindowMouseMove)
    window.removeEventListener('mouseup', onWindowMouseUp)

    const distance = Math.hypot(event.clientX - connectDrag.startX, event.clientY - connectDrag.startY)
    const flowPos = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    const exclude = new Set(getSelectedNodeIds())
    const target = findNodeAt(flowPos, store.nodes.value, exclude)
    if (target) {
      connectGroupToNode(target.id)
    } else if (distance > GROUP_CONNECT_MIN_DRAG_PX) {
      // 释放时未连接到已有节点即弹出目标原型菜单（最小位移仅用于区分「点击圆点」与拖拽）。
      // 必须先安装 click 拦截器再弹菜单：释放后浏览器会对同一手势补发一次 click，
      // 若释放点在画布空白处，该 click 的目标恰好是 Vue Flow 的 pane（dot 与 pane 的最近公共祖先），
      // 会触发 pane-click 立即关闭刚弹出的菜单（释放点在画布外时公共祖先不是 pane，故此前只在画布外正常）。
      armClickSuppressor()
      openConnectMenu(event, flowPos)
    }
    connectDrag.hoveredNodeId = ''
  }

  /** 取消当前拖拽（组件切换目标时兜底清理监听） */
  function cancelConnectDrag(): void {
    if (!connectDrag.active) return
    connectDrag.active = false
    connectDrag.hoveredNodeId = ''
    window.removeEventListener('mousemove', onWindowMouseMove)
    window.removeEventListener('mouseup', onWindowMouseUp)
  }

  // ── 拖拽释放后的合成 click 拦截 ─────────────────────────

  /** 当前已安装的捕获阶段 click 拦截器（null 表示未安装；与一次手势一一对应） */
  let clickSuppressorHandler: ((event: MouseEvent) => void) | null = null

  /**
   * 安装一次性捕获阶段 click 拦截器：吞掉「拖拽释放 → 浏览器补发的合成 click」，
   * 防止该 click 命中 Vue Flow pane 而触发 pane-click（会关闭刚弹出的目标原型菜单并清空选中）。
   * 拦截器在拦截到 click 后立即自卸；未被消费时由下次 mousedown / 权重置兜底清理。
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

  /** 卸载 click 拦截器（兜底清理：下次 mousedown / 权重置时调用；正常路径由拦截器自卸） */
  function disarmClickSuppressor(): void {
    if (!clickSuppressorHandler) return
    window.removeEventListener('click', clickSuppressorHandler, true)
    clickSuppressorHandler = null
  }

  // ── 成组连接执行与反馈 ─────────────────────────────────

  /**
   * 把全部选中节点连接到目标节点输入口（store 内逐源校验，忽略失败源并气泡提示）。
   *
   * @param targetNodeId 目标节点 id
   */
  function connectGroupToNode(targetNodeId: string): void {
    const ids = getSelectedNodeIds()
    const result = store.connectGroupToNode(targetNodeId, ids)
    reportGroupConnect(result)
  }

  /** 上报成组连接结果（成功/忽略摘要；忽略原因见 SKIP_REASON_LABELS） */
  function reportGroupConnect(result: GroupConnectResult): void {
    const parts: string[] = []
    if (result.connected.length > 0) parts.push(`已连接 ${result.connected.length} 个节点`)
    if (result.skipped.length > 0) {
      const labels = [...new Set(result.skipped.map((s) => SKIP_REASON_LABELS[s.reason]))].join('、')
      parts.push(`忽略 ${result.skipped.length} 个（${labels}）`)
    }
    if (parts.length === 0) return
    if (result.connected.length > 0) {
      showSnackbar(parts.join('；'), result.skipped.length > 0 ? 'primary' : 'success')
    } else {
      showSnackbar(parts.join('；'), 'error')
    }
  }

  // ── 目标原型选择菜单 ────────────────────────────────────

  /** 打开目标原型选择菜单（定位到释放点） */
  function openConnectMenu(event: MouseEvent, flowPos: { x: number; y: number }): void {
    const rect = flowEl.value?.getBoundingClientRect()
    connectMenu.x = Math.round(event.clientX - (rect?.left ?? 0))
    connectMenu.y = Math.round(event.clientY - (rect?.top ?? 0))
    connectMenu.flowX = Math.round(flowPos.x)
    connectMenu.flowY = Math.round(flowPos.y)
    connectMenu.show = true
  }

  /** 关闭目标原型选择菜单 */
  function closeConnectMenu(): void {
    connectMenu.show = false
  }

  /**
   * 选中目标原型：在释放点创建节点并连接全部兼容源（不兼容源忽略 + 气泡提示），
   * 随后单选新节点（聚焦，不自动打开配置面板）。
   *
   * @param prototypeId 节点原型 id
   */
  function createNodeFromMenu(prototypeId: string): void {
    const ids = getSelectedNodeIds()
    const { node, result } = store.createNodeAndConnect(prototypeId, connectMenu.flowX, connectMenu.flowY, ids)
    connectMenu.show = false
    focusNode([node.id])
    reportGroupConnect(result)
  }

  /** 重置全部群组状态（切换画布目标/组件卸载时调用） */
  function reset(): void {
    cancelConnectDrag()
    disarmClickSuppressor()
    connectMenu.show = false
    connectDrag.hoveredNodeId = ''
  }

  return {
    groupRect,
    connectDrag,
    connectLine,
    connectMenu,
    menuItems,
    hoveredNodeId,
    onDotMouseDown,
    connectGroupToNode,
    createNodeFromMenu,
    closeConnectMenu,
    reset,
  }
}
