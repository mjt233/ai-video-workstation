/**
 * 节点复制标记：画布内复制节点时，除写入 store 内部剪贴板外，
 * 同步把「标记前缀 + 节点 JSON」写入系统剪贴板（text/plain）。
 * 粘贴时优先识别该标记 → 粘贴节点，避免被剪贴板中残留的旧文本/文件抢占
 * （全局 paste 事件的文件/文本分支优先级高于内部剪贴板）。
 *
 * 支持单节点与多节点（含组内连线）两种格式：
 * - 多节点格式（当前写入）：`__AVW_NODE_COPY_MULTI_V1__` + `{ nodes, connections }`；
 * - 单节点旧格式（V1）：`__AVW_NODE_COPY_V1__` + 单节点 JSON，解析时包装为单元素数组（向后兼容）。
 * 纯函数模块：无浏览器依赖，便于单元测试。
 */

import type { CanvasConnection, CanvasNodeData } from './types'

/**
 * 多节点复制标记前缀（text/plain 首部）。
 * 含版本号（V1），便于未来复制格式演进时向后兼容识别。
 */
export const NODE_GROUP_CLIPBOARD_PREFIX = '__AVW_NODE_COPY_MULTI_V1__'

/**
 * 单节点复制标记前缀（旧格式，仅解析兼容；新复制一律写多节点格式）。
 */
export const NODE_CLIPBOARD_PREFIX = '__AVW_NODE_COPY_V1__'

/** 画布复制剪贴板载荷：节点列表 + 组内连线列表 */
export interface NodeClipboardPayload {
  /** 复制的节点（深拷贝） */
  nodes: CanvasNodeData[]
  /** 组内连线（两端都位于 nodes 中） */
  connections: CanvasConnection[]
}

/**
 * 序列化节点数据为系统剪贴板文本（多节点标记前缀 + 节点与连线 JSON）。
 *
 * @param nodes 复制的节点列表（至少一个）
 * @param connections 组内连线列表（可为空）
 * @returns 写入系统剪贴板（text/plain）的完整标记文本
 */
export function serializeNodeClipboard(nodes: CanvasNodeData[], connections: CanvasConnection[] = []): string {
  return NODE_GROUP_CLIPBOARD_PREFIX + JSON.stringify({ nodes, connections })
}

/**
 * 解析系统剪贴板文本中的画布节点复制标记（多节点或旧单节点格式）。
 * 非节点标记（普通文本/其他应用内容）或内容损坏时返回 null，
 * 由调用方回退到普通文本粘贴逻辑。
 *
 * @param text 剪贴板 text/plain 内容（可为空）
 * @returns 解析出的复制载荷（节点 + 组内连线）；非节点标记或解析失败返回 null
 */
export function parseNodeClipboardText(text: string | null | undefined): NodeClipboardPayload | null {
  if (!text) return null
  if (text.startsWith(NODE_GROUP_CLIPBOARD_PREFIX)) {
    return parseGroupPayload(text.slice(NODE_GROUP_CLIPBOARD_PREFIX.length))
  }
  if (text.startsWith(NODE_CLIPBOARD_PREFIX)) {
    // 旧版单节点标记：包装为单元素数组
    const node = parseSingleNode(text.slice(NODE_CLIPBOARD_PREFIX.length))
    return node ? { nodes: [node], connections: [] } : null
  }
  return null
}

/**
 * 解析多节点载荷 JSON（{ nodes, connections }）。
 * 结构校验：nodes 为合法节点数组（升级为单节点格式时兼容）；connections 非法时忽略。
 *
 * @param rawJson 标记后的 JSON 文本
 * @returns 解析出的载荷；非对象/节点数组非法时返回 null
 */
function parseGroupPayload(rawJson: string): NodeClipboardPayload | null {
  try {
    const parsed: unknown = JSON.parse(rawJson)
    if (typeof parsed !== 'object' || parsed === null) return null
    const obj = parsed as { nodes?: unknown; connections?: unknown }
    if (!Array.isArray(obj.nodes) || obj.nodes.length === 0) return null
    const nodes: CanvasNodeData[] = []
    for (const item of obj.nodes) {
      const node = asNode(item)
      if (!node) return null
      nodes.push(node)
    }
    const connections: CanvasConnection[] = []
    if (Array.isArray(obj.connections)) {
      for (const item of obj.connections) {
        const conn = asConnection(item)
        if (!conn) return null
        connections.push(conn)
      }
    }
    return { nodes, connections }
  } catch {
    return null
  }
}

/**
 * 解析旧版单节点 JSON。
 *
 * @param rawJson 标记后的 JSON 文本
 * @returns 节点数据；非法时返回 null
 */
function parseSingleNode(rawJson: string): CanvasNodeData | null {
  try {
    return asNode(JSON.parse(rawJson))
  } catch {
    return null
  }
}

/**
 * 校验并还原节点数据（最小结构校验：防止伪造/损坏的 JSON 被当作节点粘贴）。
 *
 * @param value 反序列化值
 * @returns 节点数据；非法时返回 null
 */
function asNode(value: unknown): CanvasNodeData | null {
  if (typeof value !== 'object' || value === null) return null
  const node = value as Partial<CanvasNodeData>
  if (typeof node.id !== 'string' || typeof node.prototypeId !== 'string') return null
  if (typeof node.name !== 'string' || typeof node.x !== 'number' || typeof node.y !== 'number') return null
  if (typeof node.config !== 'object' || node.config === null) return null
  return node as CanvasNodeData
}

/**
 * 校验并还原连线数据。
 *
 * @param value 反序列化值
 * @returns 连线数据；非法时返回 null
 */
function asConnection(value: unknown): CanvasConnection | null {
  if (typeof value !== 'object' || value === null) return null
  const conn = value as Partial<CanvasConnection>
  if (typeof conn.id !== 'string') return null
  if (typeof conn.fromNodeId !== 'string' || typeof conn.fromPortId !== 'string') return null
  if (typeof conn.toNodeId !== 'string' || typeof conn.toPortId !== 'string') return null
  return conn as CanvasConnection
}
