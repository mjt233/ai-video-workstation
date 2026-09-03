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

  it('pasteNode(source)：外部节点源（如系统剪贴板标记）粘贴为新节点', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('text', 0, 0)
    const b = store.pasteNode({ ...a, id: 'external', x: 100, y: 100 })
    expect(b).toBeTruthy()
    expect(b!.id).not.toBe('external')
    expect(b!.x).toBe(130)
    expect(store.nodes.value).toHaveLength(2)
    // 外部源不写入内部剪贴板
    expect(store.canPaste.value).toBe(false)
    expect(store.pasteNode()).toBeUndefined()
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

  it('removeInputOrderEntry：从 inputOrder 移除指定来源 id 并置脏', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 0, 0)
    store.updateNode(b.id, { config: { inputOrder: [a.id, 'other'] } })
    store.removeInputOrderEntry(b.id, a.id)
    expect(store.nodes.value.find((n) => n.id === b.id)!.config.inputOrder).toEqual(['other'])
    expect(store.dirty.value).toBe(true)
  })

  it('removeInputOrderEntry：无 inputOrder / 不含该 id 时 no-op', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 0, 0)
    store.removeInputOrderEntry(b.id, a.id)
    expect(store.nodes.value.find((n) => n.id === b.id)!.config.inputOrder).toBeUndefined()
    store.updateNode(b.id, { config: { inputOrder: ['x'] } })
    store.removeInputOrderEntry(b.id, a.id)
    expect(store.nodes.value.find((n) => n.id === b.id)!.config.inputOrder).toEqual(['x'])
    store.removeInputOrderEntry('missing', a.id)
    expect(store.dirty.value).toBe(true)
  })

  it('removeInputOrderEntry：节点不存在时 no-op', () => {
    const store = useCanvasStore('p', TARGET)
    store.removeInputOrderEntry('ghost', 'src')
    expect(store.nodes.value).toHaveLength(0)
  })

  it('disconnect + removeInputOrderEntry：单次撤销同时回退连线与 inputOrder', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 0, 0)
    store.updateNode(b.id, { config: { inputOrder: [a.id] } })
    expect(store.connect(a.id, b.id)).toBe(true)
    // 快捷断开链路的两个动作：断开连线 + 清理 inputOrder（后者不重复压撤销栈）
    store.disconnect(store.connections.value[0].id)
    store.removeInputOrderEntry(b.id, a.id)
    expect(store.connections.value).toHaveLength(0)
    expect(store.nodes.value.find((n) => n.id === b.id)!.config.inputOrder).toEqual([])
    // 一次撤销同时恢复连线与 inputOrder
    store.undo()
    expect(store.connections.value).toHaveLength(1)
    expect(store.nodes.value.find((n) => n.id === b.id)!.config.inputOrder).toEqual([a.id])
  })

  // ── 多选群组批量操作 ──────────────────────────────────

  it('copyNodes/pasteNodes：多节点复制粘贴重建 id 与组内连线', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 100)
    expect(store.connect(a.id, b.id)).toBe(true)
    store.copyNodes([a.id, b.id])
    const pasted = store.pasteNodes()
    expect(pasted).toHaveLength(2)
    const pastedIds = new Set(pasted.map((n) => n.id))
    expect(pastedIds.has(a.id)).toBe(false)
    expect(pastedIds.has(b.id)).toBe(false)
    // 组内连线按新 id 重建
    expect(store.connections.value).toHaveLength(2)
    const newConn = store.connections.value.find((cn) => pastedIds.has(cn.fromNodeId) && pastedIds.has(cn.toNodeId))
    expect(newConn).toBeTruthy()
    // 偏移 30px
    const pastedA = pasted.find((n) => n.prototypeId === 'image-loader')!
    expect(pastedA.x).toBe(30)
    expect(pastedA.y).toBe(30)
  })

  it('pasteNodes：重映射 config.inputOrder 与导演台素材块引用', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 100)
    store.updateNode(b.id, { config: { inputOrder: [a.id] } })
    expect(store.connect(a.id, b.id)).toBe(true)
    store.copyNodes([a.id, b.id])
    const pasted = store.pasteNodes()
    const pastedB = pasted.find((n) => n.prototypeId === 'image-generate')!
    expect(pastedB.config.inputOrder).toHaveLength(1)
    expect((pastedB.config.inputOrder as string[])[0]).not.toBe(a.id)
    // 重映射后的 id 与重建连线端点一致
    expect(store.connections.value.some((cn) => cn.toNodeId === pastedB.id && cn.fromNodeId === (pastedB.config.inputOrder as string[])[0])).toBe(true)
  })

  it('pasteNodes：外部载荷（多节点）粘贴不写入内部剪贴板', () => {
    const store = useCanvasStore('p', TARGET)
    const payload = {
      nodes: [{ ...store.addNode('text', 0, 0) }],
      connections: [] as { id: string; fromNodeId: string; fromPortId: string; toNodeId: string; toPortId: string }[],
    }
    const pasted = store.pasteNodes(payload)
    expect(pasted).toHaveLength(1)
    expect(store.canPaste.value).toBe(false)
  })

  it('pasteNodes：无剪贴板内容返回空数组', () => {
    const store = useCanvasStore('p', TARGET)
    expect(store.pasteNodes()).toEqual([])
  })

  it('updateNodes：批量移动位置为单次撤销', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('text', 0, 0)
    const b = store.addNode('text', 200, 200)
    store.updateNodes([{ id: a.id, x: 50, y: 60 }, { id: b.id, x: 260, y: 220 }])
    expect(store.nodes.value.find((n) => n.id === a.id)!.x).toBe(50)
    expect(store.nodes.value.find((n) => n.id === b.id)!.x).toBe(260)
    // 单次撤销回退整组
    store.undo()
    expect(store.nodes.value.find((n) => n.id === a.id)!.x).toBe(0)
    expect(store.nodes.value.find((n) => n.id === b.id)!.x).toBe(200)
  })

  it('updateNodes：全部 id 不存在时 no-op', () => {
    const store = useCanvasStore('p', TARGET)
    store.updateNodes([{ id: 'ghost', x: 1, y: 1 }])
    expect(store.nodes.value).toHaveLength(0)
    expect(store.canUndo.value).toBe(false)
  })

  it('removeNodes：批量删除节点与连线，单次撤销可恢复', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 100)
    store.connect(a.id, b.id)
    const events: { type: string }[] = []
    store.onConnectionsChanged((e) => events.push(e))
    store.removeNodes([a.id, b.id])
    expect(store.nodes.value).toHaveLength(0)
    expect(store.connections.value).toHaveLength(0)
    expect(events.map((e) => e.type)).toEqual(['disconnect'])
    store.undo()
    expect(store.nodes.value).toHaveLength(2)
    expect(store.connections.value).toHaveLength(1)
  })

  it('connectGroupToNode：兼容源全部连接，不兼容源忽略并给出原因', () => {
    const store = useCanvasStore('p', TARGET)
    const img1 = store.addNode('image-loader', 0, 0)
    const img2 = store.addNode('image-loader', 200, 0)
    const aud = store.addNode('audio-loader', 400, 0)
    const target = store.addNode('image-generate', 600, 0)
    const result = store.connectGroupToNode(target.id, [img1.id, img2.id, aud.id])
    expect(result.connected).toEqual([img1.id, img2.id])
    expect(result.skipped).toEqual([{ nodeId: aud.id, reason: 'incompatible' }])
    expect(store.connections.value).toHaveLength(2)
  })

  it('connectGroupToNode：media 输入口兼容全部来源类型', () => {
    const store = useCanvasStore('p', TARGET)
    const img = store.addNode('image-loader', 0, 0)
    const aud = store.addNode('audio-loader', 200, 0)
    const vid = store.addNode('video-loader', 400, 0)
    const target = store.addNode('video-generate', 600, 0)
    const result = store.connectGroupToNode(target.id, [img.id, aud.id, vid.id])
    expect(result.connected).toEqual([img.id, aud.id, vid.id])
    expect(result.skipped).toEqual([])
  })

  it('connectGroupToNode：目标在群组内/重复连线/成环均忽略', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 300, 0)
    store.connect(a.id, b.id)
    // 重复连接（已存在同源同目标）
    const dup = store.connectGroupToNode(b.id, [a.id])
    expect(dup.connected).toEqual([])
    expect(dup.skipped).toEqual([{ nodeId: a.id, reason: 'duplicate' }])
    // 成环：生成节点 → 加载节点
    const cycle = store.connectGroupToNode(a.id, [b.id])
    expect(cycle.connected).toEqual([])
    expect(cycle.skipped).toEqual([{ nodeId: b.id, reason: 'cycle' }])
    // 目标在群组内：把 a 自身连向 a
    const self = store.connectGroupToNode(a.id, [a.id])
    expect(self.skipped).toEqual([{ nodeId: a.id, reason: 'in-group' }])
  })

  it('connectGroupToNode：单次撤销回退全部群组连线', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-loader', 200, 0)
    const target = store.addNode('image-generate', 400, 0)
    const result = store.connectGroupToNode(target.id, [a.id, b.id])
    expect(result.connected).toHaveLength(2)
    store.undo()
    expect(store.connections.value).toHaveLength(0)
  })

  it('createNodeAndConnect：创建节点并连接全部兼容源，忽略不兼容源', () => {
    const store = useCanvasStore('p', TARGET)
    const img1 = store.addNode('image-loader', 0, 0)
    const img2 = store.addNode('image-loader', 200, 0)
    const vid = store.addNode('video-loader', 400, 0)
    const { node, result } = store.createNodeAndConnect('image-generate', 600, 300, [img1.id, img2.id, vid.id])
    expect(node.prototypeId).toBe('image-generate')
    expect(node.x).toBe(600)
    expect(result.connected).toEqual([img1.id, img2.id])
    expect(result.skipped).toEqual([{ nodeId: vid.id, reason: 'incompatible' }])
    expect(store.connections.value.filter((c) => c.toNodeId === node.id)).toHaveLength(2)
    // 一次撤销同时回退新节点与连线
    store.undo()
    expect(store.nodes.value.some((n) => n.id === node.id)).toBe(false)
    expect(store.connections.value).toHaveLength(0)
  })

  it('createNodeAndConnect：未知原型抛错', () => {
    const store = useCanvasStore('p', TARGET)
    expect(() => store.createNodeAndConnect('unknown', 0, 0, [])).toThrow()
  })
})
