import { describe, expect, it } from 'vitest'
import type { CanvasConnection, CanvasNodeData } from './types'
import {
  NODE_CLIPBOARD_PREFIX,
  NODE_GROUP_CLIPBOARD_PREFIX,
  parseNodeClipboardText,
  serializeNodeClipboard,
} from './nodeClipboard'

/** 构造最小合法节点数据 */
function makeNode(id = 'n1'): CanvasNodeData {
  return { id, prototypeId: 'text', name: '文本', x: 10, y: 20, width: 240, height: 160, config: { text: '你好' } }
}

/** 构造最小合法连线数据 */
function makeConnection(fromNodeId = 'n1', toNodeId = 'n2'): CanvasConnection {
  return { id: `c-${fromNodeId}-${toNodeId}`, fromNodeId, fromPortId: 'out', toNodeId, toPortId: 'in' }
}

describe('serializeNodeClipboard', () => {
  it('输出以多节点标记前缀开头且含节点与连线 JSON', () => {
    const text = serializeNodeClipboard([makeNode()], [makeConnection()])
    expect(text.startsWith(NODE_GROUP_CLIPBOARD_PREFIX)).toBe(true)
    const parsed = JSON.parse(text.slice(NODE_GROUP_CLIPBOARD_PREFIX.length)) as {
      nodes: CanvasNodeData[]
      connections: CanvasConnection[]
    }
    expect(parsed.nodes[0]).toMatchObject({ id: 'n1', prototypeId: 'text' })
    expect(parsed.connections[0]).toMatchObject({ fromNodeId: 'n1', toNodeId: 'n2' })
  })

  it('无连线时写空数组', () => {
    const text = serializeNodeClipboard([makeNode()])
    const parsed = JSON.parse(text.slice(NODE_GROUP_CLIPBOARD_PREFIX.length)) as { connections: CanvasConnection[] }
    expect(parsed.connections).toEqual([])
  })
})

describe('parseNodeClipboardText', () => {
  it('多节点序列化后可完整还原节点与连线', () => {
    const payload = { nodes: [makeNode('n1'), makeNode('n2')], connections: [makeConnection()] }
    expect(parseNodeClipboardText(serializeNodeClipboard(payload.nodes, payload.connections))).toEqual(payload)
  })

  it('兼容旧版单节点标记（包装为单元素数组）', () => {
    const node = makeNode()
    const text = NODE_CLIPBOARD_PREFIX + JSON.stringify(node)
    expect(parseNodeClipboardText(text)).toEqual({ nodes: [node], connections: [] })
  })

  it('普通文本（无标记前缀）返回 null', () => {
    expect(parseNodeClipboardText('随便复制的文字')).toBeNull()
    expect(parseNodeClipboardText('')).toBeNull()
    expect(parseNodeClipboardText(null)).toBeNull()
    expect(parseNodeClipboardText(undefined)).toBeNull()
  })

  it('标记前缀相同但 JSON 损坏时返回 null', () => {
    expect(parseNodeClipboardText(NODE_GROUP_CLIPBOARD_PREFIX + '{broken json')).toBeNull()
    expect(parseNodeClipboardText(NODE_CLIPBOARD_PREFIX + '{broken json')).toBeNull()
  })

  it('JSON 缺少节点必需字段时返回 null', () => {
    expect(parseNodeClipboardText(NODE_GROUP_CLIPBOARD_PREFIX + JSON.stringify({ nodes: [{ id: 'n1' }] }))).toBeNull()
    expect(parseNodeClipboardText(NODE_GROUP_CLIPBOARD_PREFIX + JSON.stringify({ nodes: [] }))).toBeNull()
    expect(parseNodeClipboardText(NODE_GROUP_CLIPBOARD_PREFIX + JSON.stringify('纯字符串'))).toBeNull()
    expect(parseNodeClipboardText(NODE_CLIPBOARD_PREFIX + JSON.stringify({ id: 'n1' }))).toBeNull()
  })

  it('多节点载荷中连线非法时整体返回 null', () => {
    const text = NODE_GROUP_CLIPBOARD_PREFIX + JSON.stringify({
      nodes: [makeNode()],
      connections: [{ id: 'c1' }],
    })
    expect(parseNodeClipboardText(text)).toBeNull()
  })

  it('仅前缀相似（非精确匹配）的文本返回 null', () => {
    expect(parseNodeClipboardText(NODE_GROUP_CLIPBOARD_PREFIX.slice(0, -2) + 'xx')).toBeNull()
  })
})
