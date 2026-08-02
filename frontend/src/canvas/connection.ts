import type { CanvasConnection, CanvasNodeData, DataType } from './types'
import { getPrototype } from './registry'

/**
 * 连接校验（ComfyUI 思路）：按端口数据类型判断，而非按节点类型。
 */

/** 两个端口类型是否兼容（v1 仅支持同类型） */
export function canConnect(fromType: DataType, toType: DataType): boolean {
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
 * 校验一条连线是否可建立：两端节点存在、类型兼容、且不成环。
 *
 * @param connections 现有连线
 * @param fromNodeId 输出节点 id
 * @param toNodeId 输入节点 id
 * @param nodes 画布全部节点
 * @returns 可建立返回 true
 */
export function canConnectNodes(
  connections: CanvasConnection[],
  fromNodeId: string,
  toNodeId: string,
  nodes: CanvasNodeData[],
): boolean {
  const outType = getNodeOutputType(fromNodeId, nodes)
  const inType = getNodeInputType(toNodeId, nodes)
  if (!outType || !inType) return false
  if (!canConnect(outType, inType)) return false
  return !wouldCreateCycle(connections, fromNodeId, toNodeId)
}
