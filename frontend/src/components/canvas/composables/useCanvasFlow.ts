/**
 * 画布流渲染与连线交互组合式：Vue Flow 节点/连线数据映射、拖拽/缩放回写、
 * 连接校验与建立、连线右键菜单（断开连接）。
 */

import { computed, reactive, watch } from 'vue'
import type { ComputedRef } from 'vue'
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
  /** 当前多选（≥2 个）节点包围盒（合成节点定位；单选/无选中时为 null） */
  groupRect: ComputedRef<GroupRect | null>
}

/**
 * 画布流渲染与连线交互组合式。
 *
 * @param options 依赖注入参数
 * @returns Vue Flow 数据映射、交互处理器与连线右键菜单状态
 */
export function useCanvasFlow(options: UseCanvasFlowOptions) {
  const { store, nodeMap, project, selectedEdgeId, groupRect } = options

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
   * 群组合成节点（多选 ≥2 时追加，不入 store）：
   * - __group-frame：虚线框（置于节点下层 zIndex -1，拖动框体经 Vue Flow 原生拖动整体移动选中节点）；
   * - __group-dot：右侧输出连接点（zIndex 2000，位于全部节点之上，mousedown 由 useCanvasGroup 承接）。
   * 两者均 selectable/connectable/focusable=false，不参与选中/连线/框选。
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
        zIndex: -1,
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

  /** Vue Flow 节点列表（真实节点 + 群组合成节点） */
  const flowNodeFullList = computed(() => [...flowNodeList.value, ...syntheticNodeList.value])

  /** Vue Flow 连线列表 */
  const flowEdgeList = computed<FlowEdge[]>(() =>
    store.connections.value.map((c) => ({
      id: c.id,
      source: c.fromNodeId,
      sourceHandle: c.fromPortId,
      target: c.toNodeId,
      targetHandle: c.toPortId,
      type: 'default',
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
   * @param dragged 被拖动的节点列表（可能含群组合成节点，需过滤）
   */
  function onNodeDragStop({ nodes: dragged }: NodeDragEvent): void {
    const real = dragged.filter((n) => !isSyntheticNodeId(n.id))
    if (real.length === 0) return
    if (real.length > 1) {
      store.updateNodes(
        real.map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
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

  /** 连接成功：写入 store（记录端口 id；store 内部再次校验，失败忽略） */
  function onConnect(conn: Connection): void {
    if (!conn.source || !conn.target) return
    const ok = store.connect(conn.source, conn.target, conn.sourceHandle ?? undefined, conn.targetHandle ?? undefined)
    if (!ok) return
    // 音频来源 → 生成视频节点：连线后探测音频真实时长回填导演台素材块（修复占位 2s 截断）
    const target = nodeMap.value[conn.target]
    const source = nodeMap.value[conn.source]
    if (target?.prototypeId === 'video-generate' && getNodeOutputType(conn.source, store.nodes.value) === 'audio') {
      const path = getNodeCurrentAssetPath(source)
      if (path) {
        getAudioInfo(project, path)
          .then((info) => {
            if (Number.isFinite(info.duration) && info.duration > 0) {
              store.updateDirectorAudioClipDuration(conn.target!, conn.source!, info.duration)
            }
          })
          .catch(() => {
            // 探测失败保留占位时长，不打扰用户
          })
      }
    }
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
    onNodeDragStop,
    onNodeResizeEnd,
    isValidConnection,
    onConnect,
    onEdgesChange,
    edgeMenu,
    onEdgeContextMenu,
    disconnectEdge,
    closeEdgeMenu,
  }
}
