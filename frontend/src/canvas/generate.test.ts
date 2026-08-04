import { describe, expect, it } from 'vitest'
import type { CanvasConnection, CanvasNodeData } from './types'
import { activateHistory, collectInputs, collectInputPaths, getHistory, getNodeCurrentAssetPath, type HistoryEntry } from './generate'

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

describe('collectInputs / inputOrder 排序', () => {
  const g2: CanvasNodeData = {
    id: 'g2', prototypeId: 'image-generate', name: '生成2', x: 0, y: 0, width: 10, height: 10,
    config: { current: { version: 1, path: 'assert/scene/1/1/canvas/g2/v1.jpg', date: '2026-01-01T00:00:00.000Z' } },
  }
  const conns: CanvasConnection[] = [
    { id: 'c1', fromNodeId: 'l1', fromPortId: 'out', toNodeId: 'g1', toPortId: 'in' },
    { id: 'c2', fromNodeId: 'g2', fromPortId: 'out', toNodeId: 'g1', toPortId: 'in' },
  ]

  it('默认按连接顺序返回', () => {
    const inputs = collectInputs('g1', conns, [loader, g2])
    expect(inputs.map((i) => i.nodeId)).toEqual(['l1', 'g2'])
    expect(inputs[0].label).toBe('appearance.jpg')
  })

  it('遵循 config.inputOrder 排序', () => {
    const inputs = collectInputs('g1', conns, [loader, g2], { inputOrder: ['g2', 'l1'] })
    expect(inputs.map((i) => i.nodeId)).toEqual(['g2', 'l1'])
    expect(collectInputPaths('g1', conns, [loader, g2], { inputOrder: ['g2', 'l1'] })).toEqual([
      'assert/scene/1/1/canvas/g2/v1.jpg',
      'assert/character/张三/appearance.jpg',
    ])
  })

  it('inputOrder 未出现的节点排在末尾', () => {
    const inputs = collectInputs('g1', conns, [loader, g2], { inputOrder: ['g2'] })
    expect(inputs.map((i) => i.nodeId)).toEqual(['g2', 'l1'])
  })
})

describe('activateHistory', () => {
  it('把历史条目激活为 current，history 引用与内容不变，原 config 不被修改', () => {
    const cfg = gen.config
    const next = activateHistory(cfg, {
      version: 1,
      path: 'assert/scene/1/1/canvas/g1/v1.jpg',
      date: '2026-01-01T00:00:00.000Z',
    })
    expect(next.current).toEqual({
      version: 1,
      path: 'assert/scene/1/1/canvas/g1/v1.jpg',
      date: '2026-01-01T00:00:00.000Z',
    })
    // history 引用不变（原当前图保留在历史中）
    expect(next.history).toBe(cfg.history)
    // 原 config 不被修改
    expect(cfg.current).toEqual({
      version: 2,
      path: 'assert/scene/1/1/canvas/g1/v2.jpg',
      date: '2026-01-01T00:00:00.000Z',
    })
  })

  it('激活后原当前图仍在历史中', () => {
    const cfg = gen.config
    const next = activateHistory(cfg, {
      version: 1,
      path: 'assert/scene/1/1/canvas/g1/v1.jpg',
      date: '2026-01-01T00:00:00.000Z',
    })
    expect((next.history as HistoryEntry[]).map((h) => h.version)).toEqual([1, 2])
  })
})
