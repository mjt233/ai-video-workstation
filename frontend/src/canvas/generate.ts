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

/** 生成图片节点的单个输入资产信息（含来源节点，用于预览与拖拽排序） */
export interface CanvasInputInfo {
  /** 来源节点 id（排序持久化用） */
  nodeId: string
  /** 资产相对路径（预览用） */
  path: string
  /** 展示名（文件名） */
  label: string
}

/** 读取节点 config 中的历史版本列表（无则返回空数组） */
export function getHistory(config: NodeConfig): HistoryEntry[] {
  return Array.isArray(config.history) ? (config.history as HistoryEntry[]) : []
}

/**
 * 把某历史版本激活为节点当前图片（返回新 config）。
 * 仅改写 current 指针，history 列表不变——原当前图本就保留在历史中，
 * 因此激活后原图自然成为历史版本。
 *
 * @param config 节点原配置
 * @param entry 要激活的历史条目
 * @returns 新配置（current 指向该条目，history 引用不变）
 */
export function activateHistory(config: NodeConfig, entry: HistoryEntry): NodeConfig {
  return { ...config, current: { version: entry.version, path: entry.path, date: entry.date } }
}

/**
 * 从节点 config 的历史列表中移除指定版本条目（返回新 config）。
 * 仅改写 history，current 不变；当前版本不可删除（UI 层已禁用），
 * 若目标版本恰为当前版本或不存在则返回原配置。
 *
 * @param config 节点原配置
 * @param version 要删除的历史版本号
 * @returns 新配置（history 中已移除该版本条目）
 */
export function removeHistoryEntry(config: NodeConfig, version: number): NodeConfig {
  const cur = config.current as { version?: number } | undefined
  if (cur && cur.version === version) return config
  const history = getHistory(config).filter((h) => h.version !== version)
  if (history.length === getHistory(config).length) return config
  return { ...config, history }
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
 * 收集某节点的输入资产信息（图片路径 + 来源节点），顺序遵循节点 config.inputOrder；
 * inputOrder 中未记录的节点按连接顺序排在末尾。
 *
 * @param nodeId 目标节点 id
 * @param connections 全部连线
 * @param nodes 全部节点
 * @param config 目标节点配置（可选，用于读取 inputOrder 排序）
 * @returns 输入资产信息数组（仅包含有资产的输入节点）
 */
export function collectInputs(
  nodeId: string,
  connections: CanvasConnection[],
  nodes: CanvasNodeData[],
  config?: NodeConfig,
): CanvasInputInfo[] {
  const order: string[] = Array.isArray(config?.inputOrder) ? (config.inputOrder as string[]) : []
  const list: CanvasInputInfo[] = []
  for (const c of connections) {
    if (c.toNodeId !== nodeId) continue
    const src = nodes.find((n) => n.id === c.fromNodeId)
    const p = getNodeCurrentAssetPath(src)
    if (!src || !p) continue
    list.push({ nodeId: src.id, path: p, label: p.split('/').pop() ?? p })
  }
  list.sort((a, b) => {
    const ia = order.indexOf(a.nodeId)
    const ib = order.indexOf(b.nodeId)
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
  })
  return list
}

/**
 * 收集某节点的输入资产路径（顺序遵循节点 config.inputOrder）。
 *
 * @param nodeId 目标节点 id
 * @param connections 全部连线
 * @param nodes 全部节点
 * @param config 目标节点配置（可选，用于读取 inputOrder 排序）
 * @returns 输入资产相对路径数组
 */
export function collectInputPaths(
  nodeId: string,
  connections: CanvasConnection[],
  nodes: CanvasNodeData[],
  config?: NodeConfig,
): string[] {
  return collectInputs(nodeId, connections, nodes, config).map((i) => i.path)
}
