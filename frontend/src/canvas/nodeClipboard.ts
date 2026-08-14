/**
 * 节点复制标记：画布内复制节点时，除写入 store 内部剪贴板外，
 * 同步把「标记前缀 + 节点 JSON」写入系统剪贴板（text/plain）。
 * 粘贴时优先识别该标记 → 粘贴节点，避免被剪贴板中残留的旧文本/文件抢占
 * （全局 paste 事件的文件/文本分支优先级高于内部剪贴板）。
 * 纯函数模块：无浏览器依赖，便于单元测试。
 */

import type { CanvasNodeData } from './types'

/**
 * 节点复制标记前缀（text/plain 首部）。
 * 含版本号（V1），便于未来复制格式演进时向后兼容识别。
 */
export const NODE_CLIPBOARD_PREFIX = '__AVW_NODE_COPY_V1__'

/**
 * 序列化节点数据为系统剪贴板文本（标记前缀 + 节点 JSON）。
 *
 * @param node 复制的节点数据
 * @returns 写入系统剪贴板（text/plain）的完整标记文本
 */
export function serializeNodeClipboard(node: CanvasNodeData): string {
  return NODE_CLIPBOARD_PREFIX + JSON.stringify(node)
}

/**
 * 解析系统剪贴板文本中的画布节点复制标记。
 * 非节点标记（普通文本/其他应用内容）或内容损坏时返回 null，
 * 由调用方回退到普通文本粘贴逻辑。
 *
 * @param text 剪贴板 text/plain 内容（可为空）
 * @returns 解析出的节点数据；非节点标记或解析失败返回 null
 */
export function parseNodeClipboardText(text: string | null | undefined): CanvasNodeData | null {
  if (!text || !text.startsWith(NODE_CLIPBOARD_PREFIX)) return null
  try {
    const parsed: unknown = JSON.parse(text.slice(NODE_CLIPBOARD_PREFIX.length))
    if (typeof parsed !== 'object' || parsed === null) return null
    const node = parsed as Partial<CanvasNodeData>
    // 最小结构校验：防止伪造/损坏的 JSON 被当作节点粘贴
    if (typeof node.id !== 'string' || typeof node.prototypeId !== 'string') return null
    if (typeof node.name !== 'string' || typeof node.x !== 'number' || typeof node.y !== 'number') return null
    if (typeof node.config !== 'object' || node.config === null) return null
    return node as CanvasNodeData
  } catch {
    return null
  }
}
