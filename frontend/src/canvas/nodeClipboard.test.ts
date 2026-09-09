import { describe, expect, it, vi } from 'vitest'
import type { CanvasConnection, CanvasGroupData, CanvasNodeData } from './types'
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

/** 构造最小合法分组数据 */
function makeGroup(id = 'g1'): CanvasGroupData {
  return { id, name: '分组 1', color: '#1976D2', x: 0, y: 0, width: 400, height: 300 }
}

describe('serializeNodeClipboard', () => {
  it('输出以多节点标记前缀开头且含节点与连线 JSON', () => {
    const text = serializeNodeClipboard([makeNode()], [makeConnection()])
    expect(text.startsWith(NODE_GROUP_CLIPBOARD_PREFIX)).toBe(true)
    const parsed = JSON.parse(text.slice(NODE_GROUP_CLIPBOARD_PREFIX.length)) as {
      nodes: CanvasNodeData[]
      connections: CanvasConnection[]
      groups: CanvasGroupData[]
    }
    expect(parsed.nodes[0]).toMatchObject({ id: 'n1', prototypeId: 'text' })
    expect(parsed.connections[0]).toMatchObject({ fromNodeId: 'n1', toNodeId: 'n2' })
    expect(parsed.groups).toEqual([])
  })

  it('无连线时写空数组', () => {
    const text = serializeNodeClipboard([makeNode()])
    const parsed = JSON.parse(text.slice(NODE_GROUP_CLIPBOARD_PREFIX.length)) as { connections: CanvasConnection[] }
    expect(parsed.connections).toEqual([])
  })

  it('传入分组时序列化到 groups 字段', () => {
    const text = serializeNodeClipboard([makeNode()], [], [makeGroup()])
    const parsed = JSON.parse(text.slice(NODE_GROUP_CLIPBOARD_PREFIX.length)) as { groups: CanvasGroupData[] }
    expect(parsed.groups).toEqual([makeGroup()])
  })
})

describe('parseNodeClipboardText', () => {
  it('多节点序列化后可完整还原节点与连线', () => {
    const payload = { nodes: [makeNode('n1'), makeNode('n2')], connections: [makeConnection()], groups: [] }
    expect(parseNodeClipboardText(serializeNodeClipboard(payload.nodes, payload.connections))).toEqual(payload)
  })

  it('含分组的载荷可完整还原（含分组往返）', () => {
    const groups = [makeGroup('g1'), makeGroup('g2')]
    const payload = { nodes: [makeNode()], connections: [], groups }
    expect(parseNodeClipboardText(serializeNodeClipboard(payload.nodes, payload.connections, groups))).toEqual(payload)
  })

  it('兼容旧版单节点标记（包装为单元素数组，groups 为空）', () => {
    const node = makeNode()
    const text = NODE_CLIPBOARD_PREFIX + JSON.stringify(node)
    expect(parseNodeClipboardText(text)).toEqual({ nodes: [node], connections: [], groups: [] })
  })

  it('兼容无 groups 字段的多节点旧标记（解析为 []）', () => {
    const node = makeNode()
    const text = NODE_GROUP_CLIPBOARD_PREFIX + JSON.stringify({ nodes: [node], connections: [] })
    expect(parseNodeClipboardText(text)).toEqual({ nodes: [node], connections: [], groups: [] })
  })

  it('非法分组项被丢弃（不影响节点解析）并输出警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const node = makeNode()
    const text = NODE_GROUP_CLIPBOARD_PREFIX + JSON.stringify({
      nodes: [node],
      connections: [],
      groups: [makeGroup('g1'), { id: 'bad' }],
    })
    expect(parseNodeClipboardText(text)).toEqual({ nodes: [node], connections: [], groups: [makeGroup('g1')] })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('groups 非数组时按空数组处理', () => {
    const node = makeNode()
    const text = NODE_GROUP_CLIPBOARD_PREFIX + JSON.stringify({ nodes: [node], connections: [], groups: 'oops' })
    expect(parseNodeClipboardText(text)).toEqual({ nodes: [node], connections: [], groups: [] })
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
