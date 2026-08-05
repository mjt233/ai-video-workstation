import type { CanvasConnection, CanvasNodeData, DataType } from './types'
import { getPrototype } from './registry'

/**
 * 连接校验（ComfyUI 思路）：按端口数据类型判断，而非按节点类型。
 */

/**
 * 两个端口类型是否兼容。
 *
 * - media 输入口（如生成视频节点）可接受任意来源类型；
 * - 其余情况要求类型一致（v1 仅支持同类型）。
 */
export function canConnect(fromType: DataType, toType: DataType): boolean {
  if (toType === 'media') return true
  return fromType === toType
}

/** 获取节点的输出端口类型（v1 每个节点单输出端口，取第一个） */
export function getNodeOutputType(nodeId: string, nodes: CanvasNodeData[]): DataType | undefined {
  const node = nodes.find((n) => n.id === nodeId)
  const proto = node ? getPrototype(node.prototypeId) : undefined
  return proto?.outputPorts[0]?.type
}

/** 获取节点的输入端口类型（v1 每个节点单输入端口，取第一个） */
export function getNodeInputType(nodeId: string, nodes: CanvasNodeData[]): DataType | undefined {
  const node = nodes.find((n) => n.id === nodeId)
  const proto = node ? getPrototype(node.prototypeId) : undefined
  return proto?.inputPorts[0]?.type
}

/** 获取节点的输出端口 id（v1 取第一个输出端口） */
export function getNodeOutputPortId(nodeId: string, nodes: CanvasNodeData[]): string | undefined {
  const node = nodes.find((n) => n.id === nodeId)
  const proto = node ? getPrototype(node.prototypeId) : undefined
  return proto?.outputPorts[0]?.id
}

/** 获取节点的输入端口 id（v1 取第一个输入端口） */
export function getNodeInputPortId(nodeId: string, nodes: CanvasNodeData[]): string | undefined {
  const node = nodes.find((n) => n.id === nodeId)
  const proto = node ? getPrototype(node.prototypeId) : undefined
  return proto?.inputPorts[0]?.id
}

/**
 * 获取节点指定输入端口的类型。
 *
 * @param nodeId 节点 id
 * @param portId 输入端口 id
 * @param nodes 画布全部节点
 * @returns 端口数据类型，端口或节点不存在时返回 undefined
 */
export function getNodeInputPortType(nodeId: string, portId: string, nodes: CanvasNodeData[]): DataType | undefined {
  const node = nodes.find((n) => n.id === nodeId)
  const proto = node ? getPrototype(node.prototypeId) : undefined
  return proto?.inputPorts.find((p) => p.id === portId)?.type
}

/**
 * 判断新增 from→to 连线是否会形成循环（从 to 沿既有输出边可达 from 即成环）。
 *
 * @param connections 现有连线
 * @param fromNodeId 输出节点
 * @param toNodeId 输入节点
 * @returns 会成环返回 true
 */
export function wouldCreateCycle(
  connections: CanvasConnection[],
  fromNodeId: string,
  toNodeId: string,
): boolean {
  if (fromNodeId === toNodeId) return true
  const adjacency = new Map<string, string[]>()
  for (const c of connections) {
    const list = adjacency.get(c.fromNodeId) ?? []
    list.push(c.toNodeId)
    adjacency.set(c.fromNodeId, list)
  }
  const stack = [toNodeId]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (cur === fromNodeId) return true
    if (visited.has(cur)) continue
    visited.add(cur)
    for (const next of adjacency.get(cur) ?? []) stack.push(next)
  }
  return false
}

/**
 * 校验一条连线是否可建立：两端节点存在、目标端口类型兼容、且不成环。
 *
 * @param connections 现有连线
 * @param fromNodeId 输出节点 id
 * @param toNodeId 输入节点 id
 * @param nodes 画布全部节点
 * @param toPortId 目标输入端口 id（缺省时用节点第一个输入端口）
 * @returns 可建立返回 true
 */
export function canConnectNodes(
  connections: CanvasConnection[],
  fromNodeId: string,
  toNodeId: string,
  nodes: CanvasNodeData[],
  toPortId?: string,
): boolean {
  const outType = getNodeOutputType(fromNodeId, nodes)
  if (!outType) return false
  if (toPortId) {
    const inType = getNodeInputPortType(toNodeId, toPortId, nodes)
    if (!inType || !canConnect(outType, inType)) return false
  } else {
    const inType = getNodeInputType(toNodeId, nodes)
    if (!inType || !canConnect(outType, inType)) return false
  }
  return !wouldCreateCycle(connections, fromNodeId, toNodeId)
}
