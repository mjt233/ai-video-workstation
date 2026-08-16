import type { CanvasConnection, CanvasNodeData, NodeConfig } from './types'
import { getPrototype } from './registry'
import { canvasNodeOutputPath, type CanvasScope } from './paths'

/**
 * 资产生成辅助纯函数：输入路径收集、节点资产读取。
 * 与 UI/网络解耦，便于单元测试。
 *
 * 注：历史版本（history/current 元数据）已退役——产物为固定 output.{ext} 文件，
 * 版本管理由服务端 assets/history.ts（history/ 目录 + /api/assets/:project/history*）负责。
 */

/** 生成图片节点的单个输入资产信息（含来源节点，用于预览与拖拽排序） */
export interface CanvasInputInfo {
  /** 来源节点 id（排序持久化用） */
  nodeId: string
  /** 资产相对路径（预览用） */
  path: string
  /** 展示名（文件名） */
  label: string
}

/**
 * 获取节点当前的资产相对路径。
 *
 * 输出资产解析优先级：
 * 1. 生成类节点（原型声明 outputExt）且已提供 scope → 固定产物路径
 *    assert/{scope}/canvas/{nodeId}/output.{ext}（"当前结果"为文件系统事实，不依赖元数据）；
 * 2. 原型声明的解析器（加载类读 config.assetPath）；
 * 3. 未声明解析器的节点按画布约定默认读 config.current.path（旧数据兼容）。
 *
 * @param node 节点数据（可为 undefined）
 * @param scope 画布作用域（生成类节点推导固定产物路径需要）
 * @returns 项目内相对路径或 undefined
 */
export function getNodeCurrentAssetPath(
  node: CanvasNodeData | undefined,
  scope?: CanvasScope,
): string | undefined {
  if (!node) return undefined
  const proto = getPrototype(node.prototypeId)
  // 生成类节点：产物为固定文件名，按 scope+nodeId+扩展名恒等推导
  if (proto?.outputExt) {
    if (scope) return canvasNodeOutputPath(scope, node.id, proto.outputExt)
    // 无 scope（如旧调用点）时回落到 config.current 旧数据
    const cur = node.config.current as { path?: string } | undefined
    return cur?.path
  }
  const resolver = proto?.getOutputAssetPath
  if (resolver) return resolver(node.config)
  const cur = node.config.current as { path?: string } | undefined
  return cur?.path
}

/**
 * 收集某节点的输入资产信息（图片路径 + 来源节点），顺序遵循节点 config.inputOrder；
 * inputOrder 中未记录的节点按连接顺序排在末尾。
 *
 * @param nodeId 目标节点 id
 * @param connections 全部连线
 * @param nodes 全部节点
 * @param config 目标节点配置（可选，用于读取 inputOrder 排序）
 * @param portId 目标输入端口 id（可选，仅收集连到该端口的输入）
 * @param scope 画布作用域（可选；生成类来源节点的当前产物按固定路径推导需要）
 * @returns 输入资产信息数组（仅包含有资产的输入节点）
 */
export function collectInputs(
  nodeId: string,
  connections: CanvasConnection[],
  nodes: CanvasNodeData[],
  config?: NodeConfig,
  portId?: string,
  scope?: CanvasScope,
): CanvasInputInfo[] {
  const order: string[] = Array.isArray(config?.inputOrder) ? (config.inputOrder as string[]) : []
  const list: CanvasInputInfo[] = []
  for (const c of connections) {
    if (c.toNodeId !== nodeId) continue
    if (portId && c.toPortId !== portId) continue
    const src = nodes.find((n) => n.id === c.fromNodeId)
    const p = getNodeCurrentAssetPath(src, scope)
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
 * @param portId 目标输入端口 id（可选，仅收集连到该端口的输入）
 * @param scope 画布作用域（可选；生成类来源节点的当前产物按固定路径推导需要）
 * @returns 输入资产相对路径数组
 */
export function collectInputPaths(
  nodeId: string,
  connections: CanvasConnection[],
  nodes: CanvasNodeData[],
  config?: NodeConfig,
  portId?: string,
  scope?: CanvasScope,
): string[] {
  return collectInputs(nodeId, connections, nodes, config, portId, scope).map((i) => i.path)
}

/**
 * 组内拖拽重排后合并回全局 inputOrder：保持其他组相对顺序不变，仅把本组新顺序排到末尾。
 *
 * 视频生成/拼接等节点把图片/视频/音频各自分组展示并支持组内拖拽排序，各组共享一个
 * config.inputOrder（全局 nodeId 顺序）。重排本组时，先把本组 nodeId 从原顺序中移除，
 * 再把新顺序追加到末尾，从而只影响本组相对顺序、不影响其他组。
 *
 * @param inputOrder 全局输入顺序（config.inputOrder）
 * @param orderedIds 本组重排后的 nodeId 顺序
 * @returns 合并后的全局输入顺序
 */
export function mergeInputOrder(inputOrder: string[], orderedIds: string[]): string[] {
  const groupIds = new Set(orderedIds)
  const rest = inputOrder.filter((id) => !groupIds.has(id))
  return [...rest, ...orderedIds]
}
