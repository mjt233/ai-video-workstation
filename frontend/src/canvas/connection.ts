import type { CanvasConnection, CanvasNodeData, DataType, PortType } from './types'
import { getPrototype } from './registry'

/**
 * 连接校验（ComfyUI 思路）：按端口数据类型判断，而非按节点类型。
 */

/**
 * 两个端口类型是否兼容。
 *
 * - 类型为数组时（如 AI文本生成节点的 ['media', 'text']）：任一匹配即可连接
 *   （转发节点混合来源时的实际类型也用数组表达，如 video+audio → ['video','audio']）；
 * - **来源为空数组 = 类型尚未确定**（未接入任何输入的「输入转发」节点）：与任意端口兼容，
 *   使「先搭拓扑、后接来源」可用；**目标为空数组 = 端口不接受任何类型**：恒不可连；
 * - `media` 为**通配类型，仅用于端口声明**（含义是「任意类型」）：作输入口时接受任意来源
 *   （生成视频节点），作混合输入口的一个成员时同样接受任意来源（AI文本生成/输入转发的
 *   ['media','text']）；它**不表示「媒体的并集」**，混合来源一律用显式并集数组表达，
 *   故「转发视频+音频」不会被误判成可以只接受视频的下游；
 * - 其余情况要求类型一致（v1 仅支持同类型）。
 *
 * @param fromType 来源端口类型（单一或数组）
 * @param toType 目标端口类型（单一或数组；数组表示可接受多种类型）
 * @returns 兼容返回 true
 */
export function canConnect(fromType: PortType, toType: PortType): boolean {
  // 来源为空数组 = 「类型尚未确定」（未接入输入的输入转发节点）：与任意端口兼容
  if (Array.isArray(fromType) && fromType.length === 0) return true
  // 目标为空数组 = 端口不接受任何类型：恒不可连（来源为空数组的情形已在上方放行）
  if (Array.isArray(toType) && toType.length === 0) return false
  // 目标为通配媒体输入口（生成视频等）：接受任意来源
  if (toType === 'media') return true
  if (Array.isArray(toType)) return toType.some((t) => canConnect(fromType, t))
  // 来源为通配类型（`media` 仅用于端口声明，含文本语义）：落到任何输入口都放行
  if (fromType === 'media') return true
  if (Array.isArray(fromType)) return fromType.some((f) => canConnect(f, toType))
  return fromType === toType
}

/**
 * 解析节点的**实际输出类型**（「输入转发」等 `passThrough` 节点专用）。
 *
 * 转发节点的输出就是它的输入，自身不产出类型，故需沿连线向上游递归解析：
 * - 来源节点为普通节点 → 返回原型声明的输出端口类型；
 * - 来源节点也是转发节点 → 继续向上解析（转发链）；
 * - 来源节点不存在 / 转发节点没有任何入边 → 返回**空数组**（类型尚未确定，
 *   `canConnect` 视其与任意端口兼容 → 允许「先搭拓扑、后接来源」）；
 *   注意这与原型声明的 `'media'` 不同：`'media'` 表示「已知是媒体但不确定哪一种」，
 *   会拒绝只接受文本的下游。
 *
 * 多处来源（转发节点可连多路输入）时按上游**连接顺序逐项归并**（见 mergeOutputType）：
 * 全部同类型 → 该类型；混合来源 → 各来源类型的**并集数组**（如 video+audio → `['video','audio']`）。
 * 并集数组在连线校验中取**乐观语义**（任一成员兼容即可连）：转发「视频+音频」既能接视频专一
 * 下游（确实有视频来源），也能接音频专一下游；实际提交给下游的输入路径仍由下游按类型过滤
 * （如生成视频只取音频来源进导演台音轨），与并集无交集的输入口（只接受图片）则被拒。
 *
 * 成环由 canConnectNodes 在连线时拦截；本函数仍用 `visited` 集合防御旧数据/损坏
 * 文件中的环（否则递归不终止）。
 *
 * @param nodeId 目标节点 id
 * @param nodes 画布全部节点
 * @param connections 画布全部连线（解析转发节点的上游来源需要）
 * @returns 实际输出类型（可能为数组；未接输入的转发节点为空数组）；节点不存在时 undefined
 */
export function getEffectiveOutputType(
  nodeId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
): PortType | undefined {
  return resolveEffectiveOutputType(nodeId, nodes, connections, new Set<string>())
}

/**
 * getEffectiveOutputType 的递归实现（携带 visited 防环）。
 *
 * @param nodeId 目标节点 id
 * @param nodes 画布全部节点
 * @param connections 画布全部连线
 * @param visited 已访问节点 id 集合（防环）
 * @returns 实际输出类型；节点不存在时 undefined
 */
function resolveEffectiveOutputType(
  nodeId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
  visited: Set<string>,
): PortType | undefined {
  if (visited.has(nodeId)) return undefined
  visited.add(nodeId)
  const node = nodes.find((n) => n.id === nodeId)
  const proto = node ? getPrototype(node.prototypeId) : undefined
  if (!proto) return undefined
  if (!proto.passThrough) return proto.outputPorts[0]?.type
  let resolved: PortType | undefined
  for (const c of connections) {
    if (c.toNodeId !== nodeId) continue
    const upstream = resolveEffectiveOutputType(c.fromNodeId, nodes, connections, visited)
    if (upstream === undefined || (Array.isArray(upstream) && upstream.length === 0)) continue
    resolved = mergeOutputType(resolved, upstream)
  }
  // 路径回溯：visited 是「当前递归路径」而非全局已访问集，同层兄弟分支（菱形拓扑）仍需解析
  visited.delete(nodeId)
  // 未接输入 / 上游类型也未确定（环形防御）：空数组 = 类型尚未确定（放行任意下游连线）
  return resolved ?? []
}

/**
 * 归并两个输出类型（转发节点多路来源时的类型收敛）。
 *
 * 归并规则（口径唯一，改这里即改全部转发节点的类型语义）：
 * - 未归并出类型（undefined）→ 取另一侧；
 * - 类型完全一致（含同序数组）→ 取该类型（多路同类型来源的最常见情形）；
 * - 其余情况 → 两侧类型的**并集**，且**按声明顺序（媒体在前、文本在后）排列**。
 *   这正是「实际类型」的诚实表达：
 *   - video + audio → `['image','video','audio']`：只接受视频/只接受音频的下游被拒，
 *     接受任意媒体的下游（生成视频等）可用；
 *   - image + text → `['image','text']`：接受「图片+文本」的下游（生成图片等）可用，
 *     只接受视频的下游被拒；
 *   - 并集共 4 个类型时即「任意类型」。
 *   刻意**不使用**通配 `'media'` 表示混合：`media` 是端口声明用的通配类型（含文本语义），
 *   用它表示「媒体混合」会让只接受视频的下游被误放行（历史缺陷）。
 *
 * @param current 已归并的类型（undefined = 尚无）
 * @param next 待归并的类型
 * @returns 归并后的类型
 */
function mergeOutputType(current: PortType | undefined, next: PortType): PortType {
  if (current === undefined) return next
  if (typesEqual(current, next)) return current
  const union = new Set<DataType>([...typeList(current), ...typeList(next)])
  return OUTPUT_TYPE_MERGE_ORDER.filter((t) => union.has(t))
}

/** 归并时的类型声明顺序（媒体在前、文本在后；并集数组按此顺序排列） */
const OUTPUT_TYPE_MERGE_ORDER: DataType[] = ['image', 'video', 'audio', 'text', 'media']

/** 端口类型归一化为类型数组（单一类型 → 单元素数组） */
function typeList(type: PortType): DataType[] {
  return Array.isArray(type) ? type : [type]
}

/** 两个端口类型是否完全一致（数组按顺序逐项比较） */
function typesEqual(a: PortType, b: PortType): boolean {
  const arrA = typeList(a)
  const arrB = typeList(b)
  return arrA.length === arrB.length && arrA.every((t, i) => t === arrB[i])
}

/**
 * 获取节点的输出端口类型（v1 每个节点单输出端口，取第一个）。
 *
 * `passThrough` 节点（「输入转发」）的输出类型等于其上游来源的实际类型，故必须
 * 传入 `connections` 才能解析；其余节点只读原型声明。**调用方一律传 `connections`**：
 * 漏传时转发节点会退化成原型声明的占位类型（'media'），使「裁剪视频 / TTS 等
 * 类型专一下游」的连线校验被放宽——参数已改为必传，由类型检查保证不漏。
 *
 * @param nodeId 节点 id
 * @param nodes 画布全部节点
 * @param connections 画布全部连线（解析转发节点的输出类型）
 * @returns 端口数据类型（可能为数组；未接输入的转发节点为空数组）；节点不存在时 undefined
 */
export function getNodeOutputType(
  nodeId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
): PortType | undefined {
  return getEffectiveOutputType(nodeId, nodes, connections)
}

/** 获取节点的输入端口类型（v1 每个节点单输入端口，取第一个） */
export function getNodeInputType(nodeId: string, nodes: CanvasNodeData[]): PortType | undefined {
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
 * @returns 端口数据类型（可能为数组），端口或节点不存在时返回 undefined
 */
export function getNodeInputPortType(nodeId: string, portId: string, nodes: CanvasNodeData[]): PortType | undefined {
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
  const outType = getNodeOutputType(fromNodeId, nodes, connections)
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
