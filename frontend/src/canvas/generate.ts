import type { CanvasConnection, CanvasNodeData, NodeConfig } from './types'

/**
 * 资产生成辅助纯函数：输入路径收集、节点资产读取、版本号计算。
 * 与 UI/网络解耦，便于单元测试。
 */

/** 生成图片节点的历史版本条目 */
export interface HistoryEntry {
  version: number
  path: string
  date: string
}

/** 读取节点 config 中的历史版本列表（无则返回空数组） */
export function getHistory(config: NodeConfig): HistoryEntry[] {
  return Array.isArray(config.history) ? (config.history as HistoryEntry[]) : []
}

/**
 * 获取节点当前的资产相对路径：
 * - 加载图片：config.assetPath
 * - 生成图片：config.current.path
 *
 * @param node 节点数据（可为 undefined）
 * @returns 项目内相对路径或 undefined
 */
export function getNodeCurrentAssetPath(node: CanvasNodeData | undefined): string | undefined {
  if (!node) return undefined
  if (node.prototypeId === 'image-loader') {
    const ap = node.config.assetPath
    return typeof ap === 'string' && ap ? ap : undefined
  }
  if (node.prototypeId === 'image-generate') {
    const cur = node.config.current as { path?: string } | undefined
    return cur?.path
  }
  return undefined
}

/**
 * 收集某节点的输入资产路径（按其所有入边连线的顺序）。
 *
 * @param nodeId 目标节点 id
 * @param connections 全部连线
 * @param nodes 全部节点
 * @returns 输入资产相对路径数组
 */
export function collectInputPaths(
  nodeId: string,
  connections: CanvasConnection[],
  nodes: CanvasNodeData[],
): string[] {
  const incoming = connections.filter((c) => c.toNodeId === nodeId)
  const paths: string[] = []
  for (const c of incoming) {
    const src = nodes.find((n) => n.id === c.fromNodeId)
    const p = getNodeCurrentAssetPath(src)
    if (p) paths.push(p)
  }
  return paths
}
