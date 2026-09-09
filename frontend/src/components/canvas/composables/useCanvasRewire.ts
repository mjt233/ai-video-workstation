/**
 * 连线改接交互组合式（连接转移 / 连接复制）：
 *
 * - **连接转移**：按住 Shift + 左键在真实节点端点（Vue Flow Handle）按下，把输入/输出
 *   该端点的全部连线「拔出」——拖拽期间原连线保留在 store（仅虚线样式提示），跟随鼠标
 *   移动，在另一节点的同类型端点（输入端→输入端 / 输出端→输出端）上释放后批量改接；
 * - **连接复制**：按住 Ctrl + 左键，操作方式与转移一致，但原连线保留、仅新增连线。
 *
 * 实现要点：
 * - mousedown 在画布容器 **capture 阶段**拦截（Vue Flow Handle 自身监听 mousedown 启动
 *   原生连线拖拽，祖先 capture 先于其触发，stopPropagation 可阻止原生行为，同时避免
 *   Ctrl 触发框选 / 节点多选）；端点上无连线时不拦截（维持原生拖线行为）；
 * - 落点识别用 `document.elementFromPoint` 找 `.vue-flow__handle`（读取 Vue Flow 自带的
 *   `data-nodeid` / `data-handleid` 与 `source` / `target` class），拖拽中悬停端点实时
 *   校验高亮；落点为空白/同节点/全部被忽略时分别静默取消或气泡说明；
 * - 校验与执行统一交给 `store.rewireConnections`（节点级重复 / 类型兼容 / 成环逐条校验，
 *   部分成功，单次撤销快照，inputOrder 同步，connect/disconnect 联动）；
 * - 预览曲线端点取 GraphNode.handleBounds + computedPosition 经 viewport 变换为容器内
 *   屏幕坐标（SVG 覆盖层绘制）；取不到时降级为仅徽标跟随鼠标。
 */

import { onBeforeUnmount, reactive, watch } from 'vue'
import type { Ref } from 'vue'
import type { CanvasConnection } from '../../../canvas/types'
import { canConnectNodes } from '../../../canvas/connection'
import { isSyntheticNodeId } from '../../../canvas/groupSelection'
import type { CanvasStoreApi, FindNode, ShowSnackbar } from './types'

/** 连线改接模式：transfer=连接转移（移除原连线）；copy=连接复制（保留原连线） */
export type RewireDragMode = 'transfer' | 'copy'

/** 改接拖拽起点方向：input=输入端起点（释放到输入端）；output=输出端起点（释放到输出端） */
export type RewireDragOrigin = 'input' | 'output'

/** 预览曲线固定端点（画布容器内屏幕坐标） */
export interface RewireAnchorPoint {
  /** 容器内 x 坐标 */
  x: number
  /** 容器内 y 坐标 */
  y: number
}

/** 改接拖拽状态（AssetCanvas 覆盖层数据源：预览曲线、徽标、端点高亮） */
export interface RewireDragState {
  /** 是否正在拖拽 */
  active: boolean
  /** 改接模式 */
  mode: RewireDragMode
  /** 拖拽起点方向 */
  origin: RewireDragOrigin
  /** 被改接的连线 id 列表（转移模式下这些连线拖拽中显示虚线样式） */
  connectionIds: string[]
  /** 预览曲线固定端点列表（容器内屏幕坐标；输入起点=各来源节点输出端点，输出起点=各目标端点） */
  anchorPoints: RewireAnchorPoint[]
  /** 鼠标当前位置（容器内屏幕坐标） */
  mouse: RewireAnchorPoint
  /** 当前悬停的端点与可落性（null=未悬停在端点上；valid=false 端点显示不可落样式） */
  hover: { nodeId: string; portId: string; valid: boolean } | null
}

/** useCanvasRewire 参数 */
export interface UseCanvasRewireOptions {
  /** 画布数据 store（连线读取与 rewireConnections 执行） */
  store: CanvasStoreApi
  /** 画布容器 DOM（capture 拦截绑定与覆盖层坐标基准） */
  flowEl: Ref<HTMLElement | null>
  /** Vue Flow 按 id 查询内部节点（读取 handleBounds/computedPosition 计算预览端点） */
  findNode: FindNode
  /** Vue Flow 当前视口（流坐标 → 容器内屏幕坐标换算） */
  viewport: Ref<{ x: number; y: number; zoom: number }>
  /** 操作反馈提示 */
  showSnackbar: ShowSnackbar
  /** 改接成功建立新连线后的联动（如 audio→video-generate 的音频时长探测回填导演台） */
  onConnectionsAdded?: (connections: CanvasConnection[]) => void
}

/** 拖拽上下文（内部状态，不对外暴露） */
interface RewireDragContext {
  /** 改接模式 */
  mode: RewireDragMode
  /** 起点方向 */
  origin: RewireDragOrigin
  /** 起点节点 id */
  originNodeId: string
  /** 起点端口 id */
  originPortId: string
  /** 被改接的连线集合（按连接数组顺序，即「原顺序」） */
  connections: CanvasConnection[]
}

/** Handle DOM 上的落点信息 */
interface HandleHit {
  /** 落点端点所属节点 id */
  nodeId: string
  /** 落点端点 id */
  portId: string
  /** 端点方向（source=输出端 / target=输入端） */
  type: 'source' | 'target'
  /** 命中的端点 DOM 元素（悬停高亮标记用） */
  el: Element
}

/** 忽略原因 → 气泡文案片段 */
const REASON_LABELS: Record<string, string> = {
  duplicate: '重复',
  incompatible: '类型不兼容',
  cycle: '成环',
  'in-group': '群组内',
}

/**
 * 连线改接交互组合式。
 *
 * @param options 依赖注入参数
 * @returns 拖拽状态（供覆盖层渲染）
 */
export function useCanvasRewire(options: UseCanvasRewireOptions) {
  const { store, flowEl, findNode, viewport, showSnackbar, onConnectionsAdded } = options

  /** 对外拖拽状态（reactive：模板直接读取） */
  const rewireDrag = reactive<RewireDragState>({
    active: false,
    mode: 'transfer',
    origin: 'input',
    connectionIds: [],
    anchorPoints: [],
    mouse: { x: 0, y: 0 },
    hover: null,
  })

  /** 当前拖拽上下文（null=未拖拽） */
  let drag: RewireDragContext | null = null

  /** 悬停高亮的端点元素（拖拽中实时标记可落/不可落样式，结束/移动时清理） */
  let hoveredHandleEl: Element | null = null

  /** 拖拽期间的 window 监听（结束/取消时统一移除） */
  const listeners: Array<[keyof WindowEventMap, EventListener, boolean?]> = []

  // ── 坐标换算 ─────────────────────────────────────────

  /**
   * 流坐标 → 画布容器内屏幕坐标（SVG 覆盖层与流坐标系对齐：容器原点即 VueFlow 视口原点）。
   *
   * @param flow 流坐标
   * @returns 容器内屏幕坐标
   */
  function flowToScreen(flow: { x: number; y: number }): RewireAnchorPoint {
    const vp = viewport.value
    return { x: flow.x * vp.zoom + vp.x, y: flow.y * vp.zoom + vp.y }
  }

  /**
   * 读取节点指定端口在容器内的屏幕坐标（预览曲线固定端）。
   * 取 GraphNode.handleBounds 中对应端口的包围盒中心 + computedPosition（绝对流坐标）。
   *
   * @param nodeId 节点 id
   * @param portId 端口 id
   * @param type 端口方向（source=输出端 / target=输入端）
   * @returns 容器内屏幕坐标；节点/端点包围盒未就绪时返回 null（覆盖层降级为仅徽标）
   */
  function handleScreenPoint(nodeId: string, portId: string, type: 'source' | 'target'): RewireAnchorPoint | null {
    const node = findNode(nodeId)
    const bounds = node?.handleBounds?.[type]
    if (!node || !bounds || bounds.length === 0) return null
    const bound = bounds.find((b) => b.id === portId) ?? bounds[0]
    return flowToScreen({
      x: (node.computedPosition?.x ?? 0) + bound.x + bound.width / 2,
      y: (node.computedPosition?.y ?? 0) + bound.y + bound.height / 2,
    })
  }

  /** 按拖拽上下文重算预览曲线固定端点（输入起点=各来源输出端；输出起点=各目标输入端） */
  function refreshAnchorPoints(): void {
    if (!drag) return
    const points: RewireAnchorPoint[] = []
    for (const connection of drag.connections) {
      const point = drag.origin === 'input'
        ? handleScreenPoint(connection.fromNodeId, connection.fromPortId, 'source')
        : handleScreenPoint(connection.toNodeId, connection.toPortId, 'target')
      if (point) points.push(point)
    }
    rewireDrag.anchorPoints = points
  }

  // ── 落点识别与校验 ───────────────────────────────────

  /**
   * 从事件坐标识别其下的 Vue Flow 端点。
   *
   * @param clientX 事件屏幕 x
   * @param clientY 事件屏幕 y
   * @returns 端点信息；不在端点上时返回 null
   */
  function hitHandle(clientX: number, clientY: number): HandleHit | null {
    const el = document.elementFromPoint(clientX, clientY)?.closest?.('.vue-flow__handle')
    if (!el) return null
    // Vue Flow Handle 的 class 含方向名（source/target），并自带 data-nodeid / data-handleid
    const type = el.classList.contains('source') ? 'source' : el.classList.contains('target') ? 'target' : null
    const nodeId = el.getAttribute('data-nodeid')
    const portId = el.getAttribute('data-handleid')
    if (!type || !nodeId || isSyntheticNodeId(nodeId)) return null
    return { nodeId, portId: portId ?? '', type, el }
  }

  /**
   * 判断落点是否属于「方向不匹配」（输入起点落到输出端 / 输出起点落到输入端）：
   * 此类落点与释放到空白一致，静默取消。
   *
   * @param hit 落点端点
   * @param context 拖拽上下文
   * @returns 方向不匹配返回 true
   */
  function isDirectionMismatch(hit: HandleHit, context: RewireDragContext): boolean {
    return (context.origin === 'input' && hit.type === 'source') || (context.origin === 'output' && hit.type === 'target')
  }

  /**
   * 校验拖拽集合中至少一条连线可改接到指定落点端点（与 store.rewireConnections 同规则：
   * 不同节点、方向匹配、类型兼容 + 成环、节点级重复；部分成功即可落）。
   *
   * @param hit 落点端点
   * @param context 拖拽上下文
   * @returns 至少一条可改接返回 true
   */
  function canDropOn(hit: HandleHit, context: RewireDragContext): boolean {
    // 需求限定「另一个节点」：同节点端点不可落
    if (hit.nodeId === context.originNodeId) return false
    // 方向匹配：输入端起点只能落到输入端，输出端起点只能落到输出端
    if (isDirectionMismatch(hit, context)) return false
    const connections = store.connections.value
    const nodesList = store.nodes.value
    for (const connection of context.connections) {
      // 输入起点：仅改目标端为落点端点（保持来源）；输出起点：仅改来源端为落点端点（保持去向）
      const fromNodeId = context.origin === 'input' ? connection.fromNodeId : hit.nodeId
      const toNodeId = context.origin === 'input' ? hit.nodeId : connection.toNodeId
      const toPortId = context.origin === 'input' ? hit.portId : connection.toPortId
      // 节点级重复：同一来源节点对同一目标节点已存在任意连线则该条被忽略
      if (connections.some((c) => c.fromNodeId === fromNodeId && c.toNodeId === toNodeId)) continue
      if (!canConnectNodes(connections, fromNodeId, toNodeId, nodesList, toPortId)) continue
      return true
    }
    return false
  }

  // ── 结果反馈 ─────────────────────────────────────────

  /**
   * 按原因汇总被忽略条数（「重复 2、类型不兼容 1」）。
   *
   * @param skipped 被忽略项列表
   * @returns 文案；无忽略项返回空串
   */
  function summarizeSkipped(skipped: { reason: string }[]): string {
    const counts = new Map<string, number>()
    for (const item of skipped) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1)
    return [...counts.entries()].map(([reason, count]) => `${REASON_LABELS[reason] ?? reason} ${count}`).join('、')
  }

  /**
   * 汇总改接结果并气泡提示。
   *
   * @param result rewireConnections 返回结果
   * @param total 尝试改接的总条数
   * @param targetNodeId 落点节点 id（气泡文案）
   * @param mode 改接模式（文案动词：转移/复制）
   */
  function reportResult(
    result: { connected: CanvasConnection[]; skipped: { reason: string }[] },
    total: number,
    targetNodeId: string,
    mode: RewireDragMode,
  ): void {
    const verb = mode === 'copy' ? '复制' : '转移'
    const targetName = store.nodes.value.find((n) => n.id === targetNodeId)?.name ?? '目标节点'
    if (result.connected.length === 0) {
      const detail = summarizeSkipped(result.skipped)
      showSnackbar(`未能${verb}：${detail || '无可改接连线'}`, 'error')
      return
    }
    if (result.connected.length === total) {
      showSnackbar(`已${verb} ${total} 条连线到「${targetName}」`, 'success')
      return
    }
    showSnackbar(
      `已${verb} ${result.connected.length} 条到「${targetName}」，跳过 ${result.skipped.length} 条（${summarizeSkipped(result.skipped)}）`,
      'primary',
    )
  }

  // ── 落点执行 ─────────────────────────────────────────

  /**
   * 在落点端点上执行改接（转移/复制统一入口；调用方已排除无落点的情况）：
   * - 同节点端点：气泡「无效目标」，不做变更；
   * - 方向不匹配：静默取消（与释放到空白一致）；
   * - 其余交由 store.rewireConnections 精确校验并部分成功，气泡汇总。
   *
   * @param hit 落点端点
   * @param context 拖拽上下文
   */
  function commitDrop(hit: HandleHit, context: RewireDragContext): void {
    if (hit.nodeId === context.originNodeId) {
      showSnackbar('无效目标：不能改接到同一节点', 'error')
      return
    }
    if (isDirectionMismatch(hit, context)) return
    const items = context.connections.map((connection) =>
      context.origin === 'input'
        ? { connectionId: connection.id, toNodeId: hit.nodeId, toPortId: hit.portId }
        : { connectionId: connection.id, fromNodeId: hit.nodeId, fromPortId: hit.portId },
    )
    const result = store.rewireConnections({ removeSource: context.mode === 'transfer', items })
    if (result.connected.length > 0) onConnectionsAdded?.(result.connected)
    reportResult(result, context.connections.length, hit.nodeId, context.mode)
  }

  // ── 拖拽生命周期 ─────────────────────────────────────

  /** window 监听挂载辅助（记录到 listeners 供统一移除；MouseEvent 处理器经类型收窄安全转换） */
  function addWindowListener(type: keyof WindowEventMap, listener: (event: never) => void, capture = false): void {
    window.addEventListener(type, listener as EventListener, capture)
    listeners.push([type, listener as EventListener, capture])
  }

  /** 移除全部拖拽期 window 监听 */
  function removeWindowListeners(): void {
    for (const [type, listener, capture] of listeners) {
      window.removeEventListener(type, listener, capture)
    }
    listeners.length = 0
  }

  /** 拖拽中单击吞噬（一次性：阻止拖拽结束后的 click 误触节点选中/Vue Flow 点击连线） */
  function suppressClickOnce(event: Event): void {
    event.stopPropagation()
    event.preventDefault()
    window.removeEventListener('click', suppressClickOnce, true)
    const index = listeners.findIndex(([type, listener]) => type === 'click' && listener === suppressClickOnce)
    if (index >= 0) listeners.splice(index, 1)
  }

  /**
   * 清理悬停端点元素上的高亮 class。
   */
  function clearHoverHighlight(): void {
    hoveredHandleEl?.classList.remove('canvas-rewire-target--valid', 'canvas-rewire-target--invalid')
    hoveredHandleEl = null
  }

  /**
   * 拖拽中鼠标移动：更新徽标位置、重算预览端点、识别悬停端点并校验可落性（命令式标记高亮 class）。
   *
   * @param event 鼠标事件
   */
  function onDragMove(event: MouseEvent): void {
    if (!drag) return
    const rect = flowEl.value?.getBoundingClientRect()
    rewireDrag.mouse = {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    }
    refreshAnchorPoints()
    const hit = hitHandle(event.clientX, event.clientY)
    const valid = hit ? canDropOn(hit, drag) : false
    rewireDrag.hover = hit ? { nodeId: hit.nodeId, portId: hit.portId, valid } : null
    // 悬停端点高亮（命中元素可能随移动变化：先清理旧元素再标记新元素）
    if (hit?.el !== hoveredHandleEl) {
      clearHoverHighlight()
      hoveredHandleEl = hit?.el ?? null
    }
    if (hoveredHandleEl) {
      hoveredHandleEl.classList.toggle('canvas-rewire-target--valid', valid)
      hoveredHandleEl.classList.toggle('canvas-rewire-target--invalid', hit != null && !valid)
    }
  }

  /**
   * 拖拽结束（释放左键）：识别落点并执行改接，随后清理拖拽状态。
   *
   * @param event 鼠标事件
   */
  function onDragEnd(event: MouseEvent): void {
    if (!drag) return
    const hit = hitHandle(event.clientX, event.clientY)
    const context = drag
    endDrag()
    if (!hit) return
    commitDrop(hit, context)
  }

  /**
   * Escape 取消拖拽（原连线未拔出，静默恢复）。
   *
   * @param event 键盘事件
   */
  function onKeyDown(event: Event): void {
    if ((event as KeyboardEvent).key !== 'Escape') return
    endDrag()
  }

  /**
   * 开始拖拽：写入状态并挂 window 监听（mousemove / mouseup / Escape 取消 / click 吞噬）。
   *
   * @param context 拖拽上下文
   */
  function startDrag(context: RewireDragContext): void {
    drag = context
    rewireDrag.active = true
    rewireDrag.mode = context.mode
    rewireDrag.origin = context.origin
    rewireDrag.connectionIds = context.connections.map((c) => c.id)
    rewireDrag.mouse = { x: 0, y: 0 }
    rewireDrag.hover = null
    refreshAnchorPoints()
    addWindowListener('mousemove', onDragMove)
    addWindowListener('mouseup', onDragEnd)
    addWindowListener('keydown', onKeyDown)
    addWindowListener('click', suppressClickOnce, true)
  }

  /** 结束拖拽：清理状态、悬停高亮与监听 */
  function endDrag(): void {
    drag = null
    rewireDrag.active = false
    rewireDrag.connectionIds = []
    rewireDrag.anchorPoints = []
    rewireDrag.hover = null
    clearHoverHighlight()
    removeWindowListeners()
  }

  // ── mousedown capture 拦截 ───────────────────────────

  /**
   * 画布容器 capture 阶段 mousedown 拦截：在真实节点端点上按 Shift（转移）/ Ctrl（复制）
   * + 左键且端点上有连线时，接管为批量改接拖拽（阻止 Vue Flow 原生单线拖拽与 Ctrl 框选）。
   * Shift 与 Ctrl 同按时转移优先。
   *
   * @param event 鼠标按下事件
   */
  function onCanvasMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return
    const wantTransfer = event.shiftKey
    const wantCopy = event.ctrlKey || event.metaKey
    if (!wantTransfer && !wantCopy) return
    const target = event.target as Element | null
    const handle = target?.closest?.('.vue-flow__handle')
    if (!handle) return
    const isTarget = handle.classList.contains('target')
    const isSource = handle.classList.contains('source')
    if (!isTarget && !isSource) return
    const nodeId = handle.getAttribute('data-nodeid')
    const portId = handle.getAttribute('data-handleid')
    if (!nodeId || isSyntheticNodeId(nodeId)) return
    const connections = isTarget
      ? store.connections.value.filter((c) => c.toNodeId === nodeId && c.toPortId === portId)
      : store.connections.value.filter((c) => c.fromNodeId === nodeId && c.fromPortId === portId)
    // 端点上没有连线可改接：不拦截，维持原生连线行为
    if (connections.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    startDrag({
      mode: wantTransfer ? 'transfer' : 'copy',
      origin: isTarget ? 'input' : 'output',
      originNodeId: nodeId,
      originPortId: portId ?? '',
      connections,
    })
  }

  /** 绑定/跟随 flowEl：容器就绪后挂 capture 拦截，卸载时清理 */
  watch(
    flowEl,
    (el, prev) => {
      if (prev) prev.removeEventListener('mousedown', onCanvasMouseDown, true)
      if (el) el.addEventListener('mousedown', onCanvasMouseDown, true)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    removeWindowListeners()
    flowEl.value?.removeEventListener('mousedown', onCanvasMouseDown, true)
  })

  return { rewireDrag }
}
