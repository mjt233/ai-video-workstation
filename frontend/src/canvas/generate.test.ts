import { describe, expect, it } from 'vitest'
import type { CanvasConnection, CanvasNodeData } from './types'
import { collectInputPaths, getHistory, getNodeCurrentAssetPath, type HistoryEntry } from './generate'

const loader: CanvasNodeData = {
  id: 'l1', prototypeId: 'image-loader', name: '加载', x: 0, y: 0, width: 10, height: 10,
  config: { assetPath: 'assert/character/张三/appearance.jpg' },
}
const gen: CanvasNodeData = {
  id: 'g1', prototypeId: 'image-generate', name: '生成', x: 0, y: 0, width: 10, height: 10,
  config: {
    current: { version: 2, path: 'assert/scene/1/1/canvas/g1/v2.jpg', date: '2026-01-01T00:00:00.000Z' },
    history: [
      { version: 1, path: 'assert/scene/1/1/canvas/g1/v1.jpg', date: '2026-01-01T00:00:00.000Z' },
      { version: 2, path: 'assert/scene/1/1/canvas/g1/v2.jpg', date: '2026-01-01T00:00:00.000Z' },
    ],
  },
}
const text: CanvasNodeData = {
  id: 't1', prototypeId: 'text', name: '文本', x: 0, y: 0, width: 10, height: 10, config: {},
}

describe('getHistory', () => {
  it('无 history 返回空数组', () => {
    expect(getHistory({})).toEqual([])
  })

  it('返回历史列表', () => {
    const h = getHistory(gen.config)
    expect(h).toHaveLength(2)
  })
})

describe('getNodeCurrentAssetPath', () => {
  it('加载图片取 assetPath', () => {
    expect(getNodeCurrentAssetPath(loader)).toBe('assert/character/张三/appearance.jpg')
  })

  it('生成图片取 current.path', () => {
    expect(getNodeCurrentAssetPath(gen)).toBe('assert/scene/1/1/canvas/g1/v2.jpg')
  })

  it('文本/无节点返回 undefined', () => {
    expect(getNodeCurrentAssetPath(text)).toBeUndefined()
    expect(getNodeCurrentAssetPath(undefined)).toBeUndefined()
  })
})

describe('collectInputPaths', () => {
  const conns: CanvasConnection[] = [
    { id: 'c1', fromNodeId: 'l1', fromPortId: 'out', toNodeId: 'g1', toPortId: 'in' },
    { id: 'c2', fromNodeId: 't1', fromPortId: 'out', toNodeId: 'g1', toPortId: 'in' },
  ]

  it('只收集有资产的输入节点路径', () => {
    const paths = collectInputPaths('g1', conns, [loader, gen, text])
    expect(paths).toEqual(['assert/character/张三/appearance.jpg'])
  })

  it('无入边返回空数组', () => {
    expect(collectInputPaths('t1', conns, [loader, gen, text])).toEqual([])
  })
})
