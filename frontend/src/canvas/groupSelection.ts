/**
 * 多选群组纯函数：群组包围盒、目标节点命中测试、目标原型兼容性、粘贴时节点引用重映射。
 *
 * 本模块无浏览器/Vue 依赖，仅处理数据层计算，便于单元测试。
 * 画布交互（Ctrl 框选/加减选）由 Vue Flow 内置能力承担，组合式层的状态同步见
 * components/canvas/composables/useCanvasGroup.ts 与 useCanvasSelection.ts。
 */

import type { CanvasNodeData, DataType, NodeConfig } from './types'
import { getPrototype, NODE_PROTOTYPES, type NodePrototype } from './registry'
import { canConnect } from './connection'

/** 群组虚线框合成节点 id（不入 store，仅用于渲染与整组拖动） */
export const GROUP_FRAME_ID = '__group-frame'
/** 群组输出连接点合成节点 id（不入 store，仅用于成组连接拖拽起点） */
export const GROUP_DOT_ID = '__group-dot'

/** 输出点拖拽的最小位移（屏幕像素）：小于该值视为「点击圆点」而非拖拽，不弹出目标原型菜单 */
export const GROUP_CONNECT_MIN_DRAG_PX = 6

/** 群组虚线框与边缘节点的留白（流坐标像素；框选结果更易读，也给整组拖动留抓取余地） */
export const GROUP_FRAME_PADDING = 12

/** 合成节点 id 判定（群组框/输出点，非画布真实节点） */
export function isSyntheticNodeId(id: string): boolean {
  return id === GROUP_FRAME_ID || id === GROUP_DOT_ID
}

/** 群组包围盒（流坐标，单位为纯像素） */
export interface GroupRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 计算选中节点的包围盒（含 padding 更方便命中；默认不额外扩张）。
 *
 * @param nodes 选中节点列表（至少一个）
 * @param padding 边框留白（流坐标像素，默认 0；群组虚线框用 GROUP_FRAME_PADDING）
 * @returns 包围盒；节点为空时返回 null
 */
export function computeGroupRect(nodes: CanvasNodeData[], padding = 0): GroupRect | null {  if (nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }
  return {
    x: Math.round(minX - padding),
    y: Math.round(minY - padding),
    width: Math.round(maxX - minX + padding * 2),
    height: Math.round(maxY - minY + padding * 2),
  }
}

/**
 * 群组输出连接点（合成节点）位置：包围盒右边缘垂直居中，圆点约 16px。
 * 返回该圆点节点的左上角流坐标（用于合成节点 position）。
 *
 * @param rect 群组包围盒
 * @param dotSize 圆点直径（默认 16）
 * @returns 圆点节点左上角流坐标
 */
export function groupDotPosition(rect: GroupRect, dotSize = 16): { x: number; y: number } {
  return {
    x: Math.round(rect.x + rect.width - dotSize / 2),
    y: Math.round(rect.y + rect.height / 2 - dotSize / 2),
  }
}

/**
 * 命中测试：给定流坐标点，返回包含该点且不在排除集合中的节点（自上而下无重叠时任意一个）。
 *
 * @param pos 流坐标点
 * @param nodes 候选节点列表（画布真实节点）
 * @param excludeIds 排除的节点 id 集合（如当前选中群组）
 * @returns 命中的节点；无命中返回 undefined
 */
export function findNodeAt(
  pos: { x: number; y: number },
  nodes: CanvasNodeData[],
  excludeIds: ReadonlySet<string>,
): CanvasNodeData | undefined {
  for (const n of nodes) {
    if (excludeIds.has(n.id)) continue
    if (pos.x >= n.x && pos.x <= n.x + n.width && pos.y >= n.y && pos.y <= n.y + n.height) {
      return n
    }
  }
  return undefined
}

/**
 * 收集群组输出类型（按原型输出端口去重，v1 每节点单输出端口）。
 *
 * @param nodes 选中节点列表
 * @returns 去重后的输出类型列表
 */
export function groupOutputTypes(nodes: CanvasNodeData[]): DataType[] {
  const types = new Set<DataType>()
  for (const n of nodes) {
    const proto = getPrototype(n.prototypeId)
    const t = proto?.outputPorts[0]?.type
    if (t) types.add(t)
  }
  return [...types]
}

/** 群组连接目标菜单项：目标原型 + 兼容性说明 */
export interface GroupConnectOption {
  /** 原型 id */
  prototypeId: string
  /** 节点名称 */
  name: string
  /** 图标（mdi） */
  icon: string
  /** 是否与群组输出类型兼容（任何输入口可接受任一输出类型即可） */
  compatible: boolean
  /** 不兼容原因说明（兼容时为空） */
  reason: string
}

/**
 * 端口类型的可读名称（提示文案用）。
 *
 * @param type 数据类型
 * @returns 中文名称
 */
export function dataTypeLabel(type: DataType): string {
  switch (type) {
    case 'image':
      return '图片'
    case 'video':
      return '视频'
    case 'audio':
      return '音频'
    case 'text':
      return '文本'
    case 'media':
      return '媒体'
  }
}

/**
 * 计算「群组连接到新节点」菜单项：列出全部有输入端口的原型，
 * 按群组输出类型集合判定兼容性（与 canConnect 规则一致：media 输入口兼容一切）。
 * 不兼容项给出原因（如「仅支持 图片 输入」）。
 *
 * @param outputTypes 群组输出类型集合
 * @returns 菜单项列表（按原型注册顺序）
 */
export function groupConnectOptions(outputTypes: DataType[]): GroupConnectOption[] {
  const protos = getPrototypeWithInputs()
  return protos.map((proto) => {
    const compatible = proto.inputPorts.some((port) =>
      outputTypes.some((t) => canConnect(t, port.type)),
    )
    const labels = proto.inputPorts.map((p) => dataTypeLabel(p.type))
    return {
      prototypeId: proto.id,
      name: proto.name,
      icon: proto.icon,
      compatible,
      reason: compatible ? '' : `仅支持 ${labels.join('/')} 输入`,
    }
  })
}

/** 全部有输入端口的原型（群组连接菜单候选，按注册顺序） */
const NODE_PROTOTYPES_WITH_INPUTS = NODE_PROTOTYPES.filter((p) => p.inputPorts.length > 0)

/** 有输入端口的全部原型（菜单候选列表 = NODE_PROTOTYPES_WITH_INPUTS 的别名，保持语义清晰） */
function getPrototypeWithInputs(): NodePrototype[] {
  return NODE_PROTOTYPES_WITH_INPUTS
}

/**
 * 某节点输出是否能连接到指定原型的任一输入端口。
 *
 * @param node 源节点
 * @param prototype 目标原型
 * @returns 可连接返回 true
 */
export function nodeCanConnectToPrototype(node: CanvasNodeData, prototype: NodePrototype): boolean {
  const proto = getPrototype(node.prototypeId)
  if (!proto) return false
  const outType = proto.outputPorts[0]?.type
  if (!outType) return false
  return prototype.inputPorts.some((port) => canConnect(outType, port.type))
}

/**
 * 粘贴时重映射节点 config 中的节点 id 引用：
 * - config.inputOrder：来源节点 id 数组；
 * - config.director.imageClips / audioClips[].sourceNodeId：导演台素材块来源。
 * 未出现在 idMap 中的 id 保持原值（指向画布中仍存在的节点，如复制单个节点时）。
 *
 * @param config 节点配置
 * @param idMap 旧 id → 新 id 映射
 * @returns 重映射后的配置（浅拷贝；未命中的字段原样保留）
 */
export function remapNodeConfig(config: NodeConfig, idMap: ReadonlyMap<string, string>): NodeConfig {
  const next: NodeConfig = { ...config }

  if (Array.isArray(config.inputOrder)) {
    next.inputOrder = (config.inputOrder as unknown[]).map((id) =>
      typeof id === 'string' ? (idMap.get(id) ?? id) : id,
    )
  }

  const director = config.director
  if (director && typeof director === 'object') {
    const d = { ...(director as Record<string, unknown>) }
    if (Array.isArray(d.imageClips)) {
      d.imageClips = (d.imageClips as Record<string, unknown>[]).map((clip) => (
        typeof clip?.sourceNodeId === 'string'
          ? { ...clip, sourceNodeId: idMap.get(clip.sourceNodeId) ?? clip.sourceNodeId }
          : { ...clip }
      ))
    }
    if (Array.isArray(d.audioClips)) {
      d.audioClips = (d.audioClips as Record<string, unknown>[]).map((clip) => (
        typeof clip?.sourceNodeId === 'string'
          ? { ...clip, sourceNodeId: idMap.get(clip.sourceNodeId) ?? clip.sourceNodeId }
          : { ...clip }
      ))
    }
    next.director = d
  }

  return next
}
