import type { CanvasConnection, CanvasNodeData, NodeConfig } from './types'
import { getPrototype } from './registry'
import { getNodeOutputType } from './connection'
import { canvasNodeOutputPath, type CanvasScope } from './paths'
import { audioTrimOutputExt } from './audioTrim'
import { cropOutputExt } from './imageCrop'

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
  /**
   * 源资产版本号（来源节点产物的 mtime；也用于预览 URL 缓存键）。
   * 仅当源资产实际变化（mtime 更新）时预览 URL 才变化，从而避免编辑器
   * 因配置修改等无关重渲染高频重建 Date.now() 缓存键导致图片/视频/音频反复重新加载。
   * 无 mtime 信息（如加载中/来源无产物）时为 undefined。
   */
  version?: number
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
    // 扩展名随节点配置变化的例外（其余生成节点取原型声明扩展名）：
    // - 裁剪音频：config.format / outputExt 镜像（原格式跟随输入）；
    // - 图片修剪与扩展：config.format（png / jpg）。
    const ext =
      node.prototypeId === 'audio-trim'
        ? audioTrimOutputExt(node.config)
        : node.prototypeId === 'image-crop'
          ? cropOutputExt(node.config)
          : proto.outputExt
    if (scope) return canvasNodeOutputPath(scope, node.id, ext)
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
 * 收集某节点的文本输入内容（来源节点输出类型为 text）。
 *
 * 文本来源包括「文本」节点（读 config.text）与「AI 文本生成」节点（读 config.output，
 * 该节点产物写入 output 而非 text）；空白内容（空串/纯空白）不收集——无内容的输入
 * 不能作为提示词。顺序按连接顺序（文本输入不参与 config.inputOrder 排序）。
 *
 * @param nodeId 目标节点 id
 * @param connections 全部连线
 * @param nodes 全部节点
 * @param portId 目标输入端口 id（可选，仅收集连到该端口的输入）
 * @returns 非空文本内容列表
 */
export function collectTextContents(
  nodeId: string,
  connections: CanvasConnection[],
  nodes: CanvasNodeData[],
  portId?: string,
): string[] {
  const out: string[] = []
  for (const c of connections) {
    if (c.toNodeId !== nodeId) continue
    if (portId && c.toPortId !== portId) continue
    const src = nodes.find((n) => n.id === c.fromNodeId)
    if (!src || getNodeOutputType(src.id, nodes) !== 'text') continue
    const raw = src.config.text ?? src.config.output
    const text = typeof raw === 'string' ? raw : ''
    if (text.trim()) out.push(text)
  }
  return out
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

/** 输入预览节点的媒体输入条目（输入资产信息 + 来源节点输出类型） */
export interface PreviewMediaInput extends CanvasInputInfo {
  /** 媒体类型（来源节点输出类型；仅 image / video / audio） */
  type: 'image' | 'video' | 'audio'
}

/**
 * 输入预览节点（input-preview）的预览数据：**上游来源节点自身**的全部连线输入。
 *
 * 输入预览节点只有一个输入口且无输出端口，本函数先按连线定位其上游来源节点
 * （同端口多条连线取第一条），再对该来源节点收集：
 * - 媒体输入：collectInputs（按来源节点 config.inputOrder 排序）后按来源输出类型过滤，
 *   仅保留 image / video / audio（其余类型不属媒体，见 isMediaOutputType 语义）；
 * - 文本输入：collectTextContents（「文本」节点读 config.text、「AI 文本生成」节点读
 *   config.output，空白内容不收集）。
 *
 * 媒体条目的 `version`（产物 mtime 作预览 URL 缓存键）由调用方（useCanvasNodeOps
 * 的 withVersions）补充——本函数保持纯函数，便于单测。
 *
 * @param nodeId 输入预览节点 id
 * @param connections 全部连线
 * @param nodes 全部节点
 * @param scope 画布作用域（可选；来源节点为生成类时按固定产物路径推导其输入需要）
 * @returns 上游来源节点的预览数据；未连接上游/来源节点不存在时返回 null
 */
export function collectPreviewSourceInputs(
  nodeId: string,
  connections: CanvasConnection[],
  nodes: CanvasNodeData[],
  scope?: CanvasScope,
): { sourceNodeId: string; sourceLabel: string; media: PreviewMediaInput[]; texts: string[] } | null {
  const conn = connections.find((c) => c.toNodeId === nodeId)
  if (!conn) return null
  const source = nodes.find((n) => n.id === conn.fromNodeId)
  if (!source) return null
  const media: PreviewMediaInput[] = []
  for (const info of collectInputs(source.id, connections, nodes, source.config, undefined, scope)) {
    const type = getNodeOutputType(info.nodeId, nodes)
    if (type !== 'image' && type !== 'video' && type !== 'audio') continue
    media.push({ nodeId: info.nodeId, path: info.path, type, label: info.label })
  }
  return {
    sourceNodeId: source.id,
    sourceLabel: source.name,
    media,
    texts: collectTextContents(source.id, connections, nodes),
  }
}

/**
 * 组内拖拽重排后合并回全局 inputOrder：保持其他组相对顺序不变，仅把本组新顺序排到末尾。
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
