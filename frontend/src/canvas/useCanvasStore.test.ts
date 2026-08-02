import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useCanvasStore } from './useCanvasStore'

vi.mock('./api', () => ({
  loadCanvas: vi.fn(),
  saveCanvas: vi.fn(),
}))

import { loadCanvas, saveCanvas } from './api'

const TARGET = { kind: 'scene' as const, episode: '1', shot: '1' }

describe('useCanvasStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    ;(loadCanvas as Mock).mockResolvedValue(null)
    ;(saveCanvas as Mock).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('加载：文件不存在时保持空画布', async () => {
    const store = useCanvasStore('p', TARGET)
    await store.load()
    expect(store.loaded.value).toBe(true)
    expect(store.nodes.value).toHaveLength(0)
  })

  it('加载：存在时读取画布定义', async () => {
    const raw = {
      version: 1,
      kind: 'scene',
      nodes: [{ id: 'a', prototypeId: 'text', name: 'n', x: 0, y: 0, width: 10, height: 10, config: {} }],
      connections: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    ;(loadCanvas as Mock).mockResolvedValue(raw)
    const store = useCanvasStore('p', TARGET)
    await store.load()
    expect(store.nodes.value).toHaveLength(1)
  })

  it('addNode：添加节点并置脏、触发防抖保存', async () => {
    const store = useCanvasStore('p', TARGET)
    const node = store.addNode('image-loader', 10, 20)
    expect(store.nodes.value).toHaveLength(1)
    expect(node.prototypeId).toBe('image-loader')
    expect(node.x).toBe(10)
    expect(store.dirty.value).toBe(true)
    await vi.runAllTimersAsync()
    expect(saveCanvas).toHaveBeenCalledTimes(1)
    expect(store.dirty.value).toBe(false)
  })

  it('addNode：未知原型抛错', () => {
    const store = useCanvasStore('p', TARGET)
    expect(() => store.addNode('unknown', 0, 0)).toThrow()
  })

  it('removeNode：删除节点及其连线', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 0, 0)
    expect(store.connect(a.id, b.id)).toBe(true)
    store.removeNode(a.id)
    expect(store.nodes.value).toHaveLength(1)
    expect(store.connections.value).toHaveLength(0)
  })

  it('connect：类型不兼容拒绝', () => {
    const store = useCanvasStore('p', TARGET)
    const t = store.addNode('text', 0, 0)
    const g = store.addNode('image-generate', 0, 0)
    expect(store.connect(t.id, g.id)).toBe(false)
    expect(store.connections.value).toHaveLength(0)
  })

  it('connect：成环拒绝', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 0, 0)
    store.connect(a.id, b.id)
    expect(store.connect(b.id, a.id)).toBe(false)
  })

  it('connect：合法连接成功', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 0, 0)
    expect(store.connect(a.id, b.id)).toBe(true)
    expect(store.connections.value).toHaveLength(1)
  })

  it('updateNode：局部更新', () => {
    const store = useCanvasStore('p', TARGET)
    const node = store.addNode('text', 0, 0)
    store.updateNode(node.id, { name: '改名' })
    expect(store.nodes.value[0].name).toBe('改名')
  })
})
