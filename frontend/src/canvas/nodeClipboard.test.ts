import { describe, expect, it } from 'vitest'
import type { CanvasNodeData } from './types'
import { NODE_CLIPBOARD_PREFIX, parseNodeClipboardText, serializeNodeClipboard } from './nodeClipboard'

/** 构造最小合法节点数据 */
function makeNode(id = 'n1'): CanvasNodeData {
  return { id, prototypeId: 'text', name: '文本', x: 10, y: 20, width: 240, height: 160, config: { text: '你好' } }
}

describe('serializeNodeClipboard', () => {
  it('输出以标记前缀开头且含节点 JSON', () => {
    const text = serializeNodeClipboard(makeNode())
    expect(text.startsWith(NODE_CLIPBOARD_PREFIX)).toBe(true)
    expect(JSON.parse(text.slice(NODE_CLIPBOARD_PREFIX.length))).toMatchObject({ id: 'n1', prototypeId: 'text' })
  })
})

describe('parseNodeClipboardText', () => {
  it('序列化后可完整还原节点数据', () => {
    const node = makeNode()
    expect(parseNodeClipboardText(serializeNodeClipboard(node))).toEqual(node)
  })

  it('普通文本（无标记前缀）返回 null', () => {
    expect(parseNodeClipboardText('随便复制的文字')).toBeNull()
    expect(parseNodeClipboardText('')).toBeNull()
    expect(parseNodeClipboardText(null)).toBeNull()
    expect(parseNodeClipboardText(undefined)).toBeNull()
  })

  it('标记前缀相同但 JSON 损坏时返回 null', () => {
    expect(parseNodeClipboardText(NODE_CLIPBOARD_PREFIX + '{broken json')).toBeNull()
  })

  it('JSON 缺少节点必需字段时返回 null', () => {
    expect(parseNodeClipboardText(NODE_CLIPBOARD_PREFIX + JSON.stringify({ id: 'n1' }))).toBeNull()
    expect(parseNodeClipboardText(NODE_CLIPBOARD_PREFIX + JSON.stringify({ prototypeId: 'text' }))).toBeNull()
    expect(parseNodeClipboardText(NODE_CLIPBOARD_PREFIX + JSON.stringify('纯字符串'))).toBeNull()
    expect(parseNodeClipboardText(NODE_CLIPBOARD_PREFIX + 'null')).toBeNull()
  })

  it('仅前缀相似（非精确匹配）的文本返回 null', () => {
    expect(parseNodeClipboardText(NODE_CLIPBOARD_PREFIX.slice(0, -2) + 'xx')).toBeNull()
  })
})
