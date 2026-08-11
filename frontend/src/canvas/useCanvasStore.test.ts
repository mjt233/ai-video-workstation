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

  it('undo/redo：恢复结构变更', () => {
    const store = useCanvasStore('p', TARGET)
    store.addNode('text', 0, 0)
    expect(store.nodes.value).toHaveLength(1)
    store.undo()
    expect(store.nodes.value).toHaveLength(0)
    store.redo()
    expect(store.nodes.value).toHaveLength(1)
  })

  it('copyNode/pasteNode：复制后粘贴为独立节点', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('text', 0, 0)
    store.copyNode(a.id)
    const b = store.pasteNode()
    expect(b).toBeTruthy()
    expect(b!.id).not.toBe(a.id)
    expect(store.nodes.value).toHaveLength(2)
  })

  it('switchTarget：切换分镜后重置状态并加载新画布', async () => {
    const raw2 = {
      version: 1,
      kind: 'scene',
      nodes: [{ id: 'x', prototypeId: 'text', name: 'n2', x: 0, y: 0, width: 10, height: 10, config: {} }],
      connections: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    ;(loadCanvas as Mock).mockResolvedValue(raw2)
    const store = useCanvasStore('p', TARGET)
    store.addNode('text', 0, 0)
    expect(store.nodes.value).toHaveLength(1)
    // 切换前先落盘未保存修改
    await store.switchTarget({ kind: 'scene', episode: '1', shot: '2' })
    expect(saveCanvas).toHaveBeenCalledTimes(1)
    expect(loadCanvas).toHaveBeenCalledWith('p', { kind: 'scene', episode: '1', shot: '2' })
    expect(store.nodes.value).toHaveLength(1)
    expect(store.nodes.value[0].id).toBe('x')
    expect(store.canUndo.value).toBe(false)
    expect(store.canRedo.value).toBe(false)
    expect(store.dirty.value).toBe(false)
  })

  it('switchTarget：无未保存修改时不触发落盘', async () => {
    const store = useCanvasStore('p', TARGET)
    await store.switchTarget({ kind: 'scene', episode: '1', shot: '2' })
    expect(saveCanvas).not.toHaveBeenCalled()
    expect(loadCanvas).toHaveBeenCalledWith('p', { kind: 'scene', episode: '1', shot: '2' })
  })

  it('connect：显式端口参数写入连线', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 0, 0)
    expect(store.connect(a.id, b.id, 'out', 'in')).toBe(true)
    expect(store.connections.value[0]).toMatchObject({
      fromNodeId: a.id,
      fromPortId: 'out',
      toNodeId: b.id,
      toPortId: 'in',
    })
  })

  it('onConnectionsChanged：connect/disconnect 触发事件，取消订阅后不再触发', () => {
    const store = useCanvasStore('p', TARGET)
    const events: { type: 'connect' | 'disconnect'; connection: { id: string } }[] = []
    const unsub = store.onConnectionsChanged((e) => events.push(e))
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 0, 0)
    expect(store.connect(a.id, b.id)).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('connect')
    store.disconnect(store.connections.value[0].id)
    expect(events).toHaveLength(2)
    expect(events[1].type).toBe('disconnect')
    unsub()
    expect(store.connect(a.id, b.id)).toBe(true)
    expect(events).toHaveLength(2)
  })

  it('removeNode：连带断开的连线触发 disconnect 事件', () => {
    const store = useCanvasStore('p', TARGET)
    const events: { type: 'connect' | 'disconnect' }[] = []
    store.onConnectionsChanged((e) => events.push(e))
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 0, 0)
    store.connect(a.id, b.id)
    store.removeNode(a.id)
    expect(events.map((e) => e.type)).toEqual(['connect', 'disconnect'])
  })

  /** 构造带指定音频块导演台配置的 video-generate 节点 */
  function setupVideoGenerate(store: ReturnType<typeof useCanvasStore>, clips: Array<{ sourceNodeId: string; duration: number }>) {
    const vg = store.addNode('video-generate', 0, 0)
    store.updateNode(vg.id, {
      config: {
        director: {
          duration: 10, width: 1080, height: 1920, fps: 24,
          imageClips: [],
          audioClips: clips.map((c, i) => ({ id: `a${i}`, sourceNodeId: c.sourceNodeId, startOffset: 0, trimStart: 0, trimEnd: 0, duration: c.duration })),
        },
      },
    })
    return vg
  }

  it('updateDirectorAudioClipDuration：命中匹配音频块并更新时长、置脏', () => {
    const store = useCanvasStore('p', TARGET)
    const vg = setupVideoGenerate(store, [{ sourceNodeId: 'aud1', duration: 2 }])
    store.updateDirectorAudioClipDuration(vg.id, 'aud1', 5)
    const clips = (store.nodes.value[0].config.director as { audioClips: Array<{ duration: number }> }).audioClips
    expect(clips[0].duration).toBe(5)
    expect(store.dirty.value).toBe(true)
  })

  it('updateDirectorAudioClipDuration：未找到匹配来源节点时 no-op', () => {
    const store = useCanvasStore('p', TARGET)
    const vg = setupVideoGenerate(store, [{ sourceNodeId: 'aud1', duration: 2 }])
    store.updateDirectorAudioClipDuration(vg.id, 'aud-other', 5)
    const clips = (store.nodes.value[0].config.director as { audioClips: Array<{ duration: number }> }).audioClips
    expect(clips[0].duration).toBe(2)
  })

  it('updateDirectorAudioClipDuration：时长无变化时 no-op', () => {
    const store = useCanvasStore('p', TARGET)
    const vg = setupVideoGenerate(store, [{ sourceNodeId: 'aud1', duration: 5 }])
    store.updateDirectorAudioClipDuration(vg.id, 'aud1', 5)
    const clips = (store.nodes.value[0].config.director as { audioClips: Array<{ duration: number }> }).audioClips
    expect(clips[0].duration).toBe(5)
  })

  it('updateDirectorAudioClipDuration：非 video-generate 节点 no-op', () => {
    const store = useCanvasStore('p', TARGET)
    const img = store.addNode('image-generate', 0, 0)
    store.updateDirectorAudioClipDuration(img.id, 'aud1', 5)
    expect(store.nodes.value).toHaveLength(1)
  })
})
