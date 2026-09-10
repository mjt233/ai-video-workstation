/**
 * 画布流渲染与连线交互组合式：Vue Flow 节点/连线数据映射、拖拽/缩放回写、
 * 连接校验与建立、连线右键菜单（断开连接）。
 */

import { computed, reactive, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type {
  Connection,
  Edge as FlowEdge,
  EdgeChange,
  EdgeMouseEvent,
  NodeDragEvent,
} from '@vue-flow/core'
import type { OnResizeEnd } from '@vue-flow/node-resizer'
import { canConnectNodes, getNodeOutputType } from '../../../canvas/connection'
import { getAudioInfo } from '../../../canvas/api'
import { getNodeCurrentAssetPath } from '../../../canvas/generate'
import {
  GROUP_DOT_ID,
  GROUP_FRAME_ID,
  groupDotPosition,
  isSyntheticNodeId,
  type GroupRect,
} from '../../../canvas/groupSelection'
import type { CanvasStoreApi, NodeMap, WritableStringRef } from './types'

/** useCanvasFlow 参数 */
export interface UseCanvasFlowOptions {
  /** 画布数据 store（坐标/尺寸/连线回写） */
  store: CanvasStoreApi
  /** 节点 id → 节点数据索引 */
  nodeMap: NodeMap
  /** 项目名（音频时长探测） */
  project: string
  /** 当前选中连线 id（连线右键菜单选中与断开共用，由 selection 持有） */
  selectedEdgeId: WritableStringRef
  /** 当前选中的节点 id 列表（单选联动高亮数据源：恰好 1 个选中时，其直接相连的连线与邻接节点高亮） */
  selectedNodeIds: Ref<string[]>
  /** 运行中（Loading）节点 id 集合（运行态高亮数据源：其直接输入连线与上游节点联动高亮） */
  runningNodeIds: Ref<Set<string>>
  /** 当前多选（≥2）包围盒（合成节点与多选工具栏定位；单选/无选中时为 null） */
  groupRect: ComputedRef<GroupRect | null>
  /** Ctrl 键是否按下（持久分组节点穿透类数据源；按下时分组框整体不拦截指针 → Ctrl+拖拽恒为框选） */
  ctrlHeld: Ref<boolean>
  /** 连线改接（转移/复制）拖拽中被拔出的连线 id 集合（拖拽中这些连线显示虚线样式；缺省空集） */
  rewiringEdgeIds?: Ref<Set<string>>
}

/** 分组/节点位置回写补丁 */
export interface MovePatch {
  /** 实体 id（节点 id 或分组 id） */
  id: string
  /** 新的流坐标 x */
  x: number
  /** 新的流坐标 y */
  y: number
}

/** 单选联动高亮连线挂载到 edge wrapper 的 class（输入侧绿色 / 输出侧橙色，样式见 AssetCanvas scoped `:deep` 规则） */
const EDGE_RELATED_INPUT_CLASS = 'canvas-edge--related canvas-edge--input'
const EDGE_RELATED_OUTPUT_CLASS = 'canvas-edge--related canvas-edge--output'
/** 运行态高亮连线挂载到 edge wrapper 的 class（主色蓝，复用 canvas-edge--related 描边规则，颜色经 --edge-related-color 提供） */
const EDGE_RUNNING_RELATED_CLASS = 'canvas-edge--related canvas-edge--running'
/** 连线改接（转移/复制）拖拽中被拔出的连线 class（虚线半透明提示，样式见 AssetCanvas scoped `:deep` 规则） */
const EDGE_REWIRING_CLASS = 'canvas-edge--rewiring'
/**
 * 被点击选中的连线 class（主题色 `#1976D2` + 2px 加粗 + 同色光晕，
 * 与拖拽中的连线预览线 `.canvas-connection-preview` 同一视觉处理；
 * 样式见 AssetCanvas scoped `:deep` 规则）。
 *
 * 单选联动高亮（绿/橙）刻意**不再叠加流向箭头动画**：箭头表示「数据正在流经这条线」，
 * 是运行态与单选联动高亮的语义；单击选中只是「选中了这条线」，用颜色与线宽表达即可，
 * 叠加箭头会让人误以为该连线在参与生成。
 */
const EDGE_SELECTED_CLASS = 'canvas-edge--selected'

/**
 * 画布流渲染与连线交互组合式。
 *
 * @param options 依赖注入参数
 * @returns Vue Flow 数据映射、交互处理器与连线右键菜单状态
 */
export function useCanvasFlow(options: UseCanvasFlowOptions) {
  const { store, nodeMap, project, selectedEdgeId, selectedNodeIds, runningNodeIds, groupRect, ctrlHeld } = options
  /** 改接拖拽中被拔出的连线 id 集合（未接线改接组合式时为空集） */
  const rewiringIds = options.rewiringEdgeIds

  /**
   * 单选联动高亮（输入侧）：恰好选中 1 个节点时，收集「指向选中节点」的连线 id
   * （`toNodeId === 选中节点`，数据流方向为邻接节点 → 选中节点）。
   * 输入侧以绿色高亮（#2E7D32）；无选中/多选（≥2，群组操作模式）时返回空集。
   */
  const relatedInputEdgeIds = computed<Set<string>>(() => {
    const ids = selectedNodeIds.value
    if (ids.length !== 1) return new Set()
    const focus = ids[0]
    const set = new Set<string>()
    for (const c of store.connections.value) {
      if (c.toNodeId === focus) set.add(c.id)
    }
    return set
  })

  /**
   * 单选联动高亮（输出侧）：恰好选中 1 个节点时，收集「由选中节点发出」的连线 id
   * （`fromNodeId === 选中节点`，数据流方向为选中节点 → 邻接节点）。
   * 输出侧以橙色高亮（#EF6C00）；无选中/多选时返回空集。
   */
  const relatedOutputEdgeIds = computed<Set<string>>(() => {
    const ids = selectedNodeIds.value
    if (ids.length !== 1) return new Set()
    const focus = ids[0]
    const set = new Set<string>()
    for (const c of store.connections.value) {
      if (c.fromNodeId === focus) set.add(c.id)
    }
    return set
  })

  /**
   * 单选联动高亮（输入侧邻接节点）：指向选中节点的连线其「源」节点（输入邻居，
   * 即数据流上游，剔除选中节点自身）。用于输入侧邻接节点绿色边框。
   */
  const adjacentInputNodeIds = computed<Set<string>>(() => {
    const ids = selectedNodeIds.value
    if (ids.length !== 1) return new Set()
    const focus = ids[0]
    const set = new Set<string>()
    for (const c of store.connections.value) {
      if (c.toNodeId === focus) set.add(c.fromNodeId)
    }
    return set
  })

  /**
   * 单选联动高亮（输出侧邻接节点）：由选中节点发出的连线其「目标」节点（输出邻居）。
   * 用于输出侧邻接节点橙色边框；无选中/多选时为空集。
   */
  const adjacentOutputNodeIds = computed<Set<string>>(() => {
    const ids = selectedNodeIds.value
    if (ids.length !== 1) return new Set()
    const focus = ids[0]
    const set = new Set<string>()
    for (const c of store.connections.value) {
      if (c.fromNodeId === focus) set.add(c.toNodeId)
    }
    return set
  })

  /**
   * 运行态高亮（输入连线）：节点处于 Loading（running）时，收集「指向运行中节点」的
   * 连线 id（`toNodeId ∈ runningNodeIds`，数据流方向为上游节点 → 运行中节点）。
   * 连线以主色蓝高亮并叠加沿数据流向移动的箭头动画；无运行中节点时返回空集。
   */
  const runningInputEdgeIds = computed<Set<string>>(() => {
    const set = new Set<string>()
    if (runningNodeIds.value.size === 0) return set
    for (const c of store.connections.value) {
      if (runningNodeIds.value.has(c.toNodeId)) set.add(c.id)
    }
    return set
  })

  /**
   * 运行态高亮（上游节点）：指向运行中节点的连线其「源」节点（1 跳上游，
   * 剔除运行中节点自身——连线不成环已由连接校验保证）。用于上游节点主色弱描边；
   * 无运行中节点时为空集。
   */
  const runningInputNodeIds = computed<Set<string>>(() => {
    const set = new Set<string>()
    if (runningNodeIds.value.size === 0) return set
    for (const c of store.connections.value) {
      if (runningNodeIds.value.has(c.toNodeId)) set.add(c.fromNodeId)
    }
    return set
  })

  /** Vue Flow 节点列表（type 固定 canvas，走自定义 slot 渲染） */
  const flowNodeList = computed(() =>
    store.nodes.value.map((n) => ({
      id: n.id,
      type: 'canvas',
      position: { x: n.x, y: n.y },
      data: { label: n.name },
      style: { width: `${n.width}px`, height: `${n.height}px` },
    })),
  )

  /**
   * 持久分组节点列表（canvas.json groups[] 映射为 Vue Flow 节点，type: canvas-group）：
   * - `selectable: false`：分组永远进不了 Vue Flow 内部选中集（框选命中由 useCanvasGroups 自行判定）；
   * - `draggable: false`：原生拖动会连带移动全部选中节点（导致节点被移动两次），分组拖动改为自定义实现；
   * - `zIndex: -2`：绘制在真实节点（默认 z 0）与多选虚线框（-1）之下；
   * - `class` 函数按 Ctrl 状态挂穿透类（函数体内部读取 ctrlHeld，故本 computed **不依赖** Ctrl 状态，
   *   轮询期间不会因高频状态重建节点列表导致动画重置）；
   * - 尺寸经 `style` 下发（与真实节点一致）：NodeResizer 缩放期间会写入内部节点 style，
   *   若我们的节点对象不带 style，则 store 回写（缩放结束/撤销）后内部 style 残留旧尺寸，
   *   框体渲染尺寸与数据不一致。
   */
  const flowGroupNodeList = computed(() =>
    store.groups.value.map((g) => ({
      id: g.id,
      type: 'canvas-group',
      position: { x: g.x, y: g.y },
      style: { width: `${g.width}px`, height: `${g.height}px` },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: -2,
      class: () => (ctrlHeld.value ? 'canvas-group-node--passthrough' : ''),
    })),
  )

  /**
   * 群组合成节点（多选 ≥2 时追加，不入 store）：
   * - __group-frame：多选范围虚线框（**纯展示**，整框不拦截指针）；
   * - __group-dot：右侧输出连接点（zIndex 2000，位于全部节点之上，mousedown 由 useCanvasGroup 承接）。
   * 两者均 selectable/connectable/focusable=false，不参与选中/连线/框选。
   *
   * 虚线框 `zIndex: 1`（高于真实节点 0、高于持久分组节点 -2）：仅影响**绘制层级**，
   * 让虚线边框在选中内容之上始终可见（不会被节点盖住）；**不参与命中判定**
   * （`style.pointerEvents: 'none'` 覆盖 Vue Flow 内联的 `pointer-events: all`），
   * 故不会遮挡框内任何元素（持久分组标题条、节点、连线、Ctrl 框选）——
   * 详见 docs/canvas/interactions.md 实现约束表 T8。
   */
  const syntheticNodeList = computed(() => {
    const rect = groupRect.value
    if (!rect) return []
    const dot = groupDotPosition(rect)
    return [
      {
        id: GROUP_FRAME_ID,
        type: 'group-frame',
        position: { x: rect.x, y: rect.y },
        width: rect.width,
        height: rect.height,
        draggable: true,
        selectable: false,
        connectable: false,
        focusable: false,
        zIndex: 1,
        // 关键：Vue Flow 会为节点内联 `pointer-events: all`，压在框内元素之上（如持久分组标题条）
        // → 必须整体设为 none，命中判定完全交给框内真实元素与 pane（虚线框只作范围提示）
        style: { pointerEvents: 'none' as const },
      },
      {
        id: GROUP_DOT_ID,
        type: 'group-dot',
        position: dot,
        width: 16,
        height: 16,
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
        zIndex: 2000,
      },
    ]
  })

  /** Vue Flow 节点列表（持久分组 + 真实节点 + 多选合成节点；顺序即渲染层级，zIndex 另行控制） */
  const flowNodeFullList = computed(() => [...flowGroupNodeList.value, ...flowNodeList.value, ...syntheticNodeList.value])

  /**
   * 当前被点击选中的连线 id（仅当该连线仍存在时命中，否则为空串）。
   *
   * `selectedEdgeId` 在连线被删除后会保留旧 id（各删除路径不统一清理）；此处按
   * `store.connections` 校验一次，避免用陈旧 id 匹配到连线，语义也更清晰。
   */
  const selectedEdgeClassId = computed<string>(() => {
    const id = selectedEdgeId.value
    if (!id) return ''
    return store.connections.value.some((c) => c.id === id) ? id : ''
  })

  /** Vue Flow 连线列表（type 固定 default；联动高亮时给关联连线挂方向分色 class：
      运行态 canvas-edge--running（蓝，优先级最高）/ 改接拖拽 canvas-edge--rewiring（虚线半透明）/
      单击选中 canvas-edge--selected（蓝，仅被点击的那一条；拖拽中的连线仍显示改接虚线）/
      单选输入侧 canvas-edge--input（绿）/ 输出侧 canvas-edge--output（橙），Vue Flow 会把 edge.class 合并到 g.vue-flow__edge 上，
      由 AssetCanvas 的 :deep 规则渲染主题色） */
  const flowEdgeList = computed<FlowEdge[]>(() =>
    store.connections.value.map((c) => ({
      id: c.id,
      source: c.fromNodeId,
      sourceHandle: c.fromPortId,
      target: c.toNodeId,
      targetHandle: c.toPortId,
      type: 'default',
      class: runningInputEdgeIds.value.has(c.id)
        ? EDGE_RUNNING_RELATED_CLASS
        : rewiringIds?.value.has(c.id)
          ? EDGE_REWIRING_CLASS
          : selectedEdgeClassId.value === c.id
            ? EDGE_SELECTED_CLASS
            : relatedInputEdgeIds.value.has(c.id)
              ? EDGE_RELATED_INPUT_CLASS
              : relatedOutputEdgeIds.value.has(c.id)
                ? EDGE_RELATED_OUTPUT_CLASS
                : undefined,
    })),
  )

  /** 节点被拖动后回写坐标（Phase 2 行为保持；与 node-drag-stop 双保险） */
  watch(
    flowNodeList,
    (list) => {
      for (const n of list) {
        const node = store.nodes.value.find((x) => x.id === n.id)
        if (node && (node.x !== n.position.x || node.y !== n.position.y)) {
          node.x = Math.round(n.position.x)
          node.y = Math.round(n.position.y)
        }
      }
    },
    { deep: true },
  )

  /**
   * 拖动结束：通过 store 持久化位置（置脏并保存，进入撤销栈）。
   * 多个节点同时拖（含拖动群组虚线框时 Vue Flow 原生一起移动全部选中节点）批量回写，
   * 单次撤销快照即可整体回退；单个节点保持既有单条撤销语义。
   *
   * 若同时有**选中分组框跟随移动**（多选拖动场景，位置补丁由 useCanvasGroups 计算），
   * 则节点与分组经 moveEntities 一次回写（单次撤销）。
   *
   * @param payload 拖动结束事件（含被拖动的节点列表，可能含群组合成节点，需过滤）
   * @param groupPatches 同步移动的选中分组位置补丁（缺省为空）
   */
  function onNodeDragStop({ nodes: dragged }: NodeDragEvent, groupPatches: MovePatch[] = []): void {
    const real = dragged.filter((n) => !isSyntheticNodeId(n.id))
    if (real.length === 0 && groupPatches.length === 0) return
    if (real.length > 1 || groupPatches.length > 0) {
      store.moveEntities(
        real.map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
        groupPatches,
      )
    } else {
      store.updateNode(real[0].id, { x: Math.round(real[0].position.x), y: Math.round(real[0].position.y) })
    }
  }

  /**
   * 节点缩放结束：把最终尺寸/坐标回写 store（置脏并保存，进入撤销栈）。
   * 缩放过程中 Vue Flow 仅更新内部节点样式实现实时预览，结束才回写业务数据，
   * 避免在 resize 事件中高频写入历史栈与触发保存。
   * 尺寸/坐标无变化时（如仅点击控制点未拖动）跳过，避免产生无意义的撤销条目。
   *
   * @param nodeId 被缩放的节点 id
   * @param payload 缩放结束事件（params 含最终 x/y/width/height）
   */
  function onNodeResizeEnd(nodeId: string, payload: OnResizeEnd): void {
    const { params } = payload
    const node = nodeMap.value[nodeId]
    if (!node) return
    const x = Math.round(params.x)
    const y = Math.round(params.y)
    const width = Math.round(params.width)
    const height = Math.round(params.height)
    if (node.x === x && node.y === y && node.width === width && node.height === height) return
    store.updateNode(nodeId, { x, y, width, height })
  }

  /**
   * 校验临时连接是否可建立（source/target 可能为空需防御）。
   * 指定目标端口时按端口类型校验，否则回退到节点第一输入端口。
   *
   * @param conn Vue Flow 临时连接
   * @returns 可建立返回 true
   */
  function isValidConnection(conn: Connection): boolean {
    if (!conn.source || !conn.target) return false
    return canConnectNodes(
      store.connections.value,
      conn.source,
      conn.target,
      store.nodes.value,
      conn.targetHandle ?? undefined,
    )
  }

  /**
   * 音频来源 → 生成视频节点的联动探测：连线建立后探测音频真实时长，
   * 回填导演台素材块（修复占位 2s 截断）。
   * 手动连线（onConnect）与连线改接（useCanvasRewire 的 onConnectionsAdded）共用。
   *
   * @param sourceId 来源（音频输出）节点 id
   * @param targetId 生成视频节点 id
   */
  function probeDirectorAudioDuration(sourceId: string, targetId: string): void {
    const target = nodeMap.value[targetId]
    const source = nodeMap.value[sourceId]
    if (target?.prototypeId !== 'video-generate' || getNodeOutputType(sourceId, store.nodes.value) !== 'audio') return
    const path = getNodeCurrentAssetPath(source)
    if (!path) return
    getAudioInfo(project, path)
      .then((info) => {
        if (Number.isFinite(info.duration) && info.duration > 0) {
          store.updateDirectorAudioClipDuration(targetId, sourceId, info.duration)
        }
      })
      .catch(() => {
        // 探测失败保留占位时长，不打扰用户
      })
  }

  /** 连接成功：写入 store（记录端口 id；store 内部再次校验，失败忽略） */
  function onConnect(conn: Connection): void {
    if (!conn.source || !conn.target) return
    const ok = store.connect(conn.source, conn.target, conn.sourceHandle ?? undefined, conn.targetHandle ?? undefined)
    if (!ok) return
    probeDirectorAudioDuration(conn.source, conn.target)
  }

  /**
   * 连线被移除时同步删除 store 中的连线。
   * 注：本版本 @vue-flow/core 无 @edges-delete 事件，改用 @edges-change 的 remove 变更。
   *
   * @param changes 连线变更列表
   */
  function onEdgesChange(changes: EdgeChange[]): void {
    for (const ch of changes) {
      if (ch.type === 'remove') {
        store.disconnect(ch.id)
      }
    }
  }

  /** 连线右键菜单状态（断开连接） */
  const edgeMenu = reactive({ show: false, x: 0, y: 0 })

  /**
   * 打开连线右键菜单（相对画布容器定位）。
   * 节点右键菜单的关闭由 AssetCanvas 接线统一处理。
   *
   * @param payload Vue Flow 连线右键事件（含事件与连线）
   * @param flowEl 画布容器 DOM（定位基准）
   */
  function onEdgeContextMenu({ event, edge }: EdgeMouseEvent, flowEl: HTMLElement | null): void {
    // 阻止浏览器默认右键菜单，避免与自定义菜单叠加遮挡
    event.preventDefault()
    selectedEdgeId.value = edge.id
    edgeMenu.show = true
    const rect = flowEl?.getBoundingClientRect()
    const clientX = 'clientX' in event ? event.clientX : 0
    const clientY = 'clientY' in event ? event.clientY : 0
    edgeMenu.x = Math.round(clientX - (rect?.left ?? 0))
    edgeMenu.y = Math.round(clientY - (rect?.top ?? 0))
  }

  /** 菜单：断开选中的连线 */
  function disconnectEdge(): void {
    const id = selectedEdgeId.value
    edgeMenu.show = false
    if (id) store.disconnect(id)
  }

  /** 关闭连线右键菜单 */
  function closeEdgeMenu(): void {
    edgeMenu.show = false
  }

  return {
    flowNodes: flowNodeFullList,
    flowEdges: flowEdgeList,
    relatedInputEdgeIds,
    relatedOutputEdgeIds,
    selectedEdgeClassId,
    adjacentInputNodeIds,
    adjacentOutputNodeIds,
    runningInputEdgeIds,
    runningInputNodeIds,
    onNodeDragStop,
    onNodeResizeEnd,
    isValidConnection,
    onConnect,
    probeDirectorAudioDuration,
    onEdgesChange,
    edgeMenu,
    onEdgeContextMenu,
    disconnectEdge,
    closeEdgeMenu,
  }
}
