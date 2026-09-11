import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useCanvasStore } from './useCanvasStore'
import { collectDragFollowSet, rectsOverlap } from './groups'
import { clipboardBounds, PASTE_CASCADE_GAP } from './pastePlacement'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    loadCanvas: vi.fn(),
    saveCanvas: vi.fn(),
  }
})

import { loadCanvas, saveCanvas, CanvasVersionError } from './api'

const TARGET = { kind: 'scene' as const, episode: '1', shot: '1' }

/** 构造 loadCanvas 的模拟返回（画布 + 版本号） */
function canvasResult(nodes: unknown[] = [], rev = 0) {
  return {
    canvas: {
      version: 2,
      kind: 'scene' as const,
      nodes,
      connections: [],
      groups: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    rev,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('useCanvasStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    ;(loadCanvas as Mock).mockResolvedValue(null)
    ;(saveCanvas as Mock).mockResolvedValue({ rev: 1, updatedAt: '2026-01-02T00:00:00.000Z' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('加载：文件不存在时保持空画布，版本号归零', async () => {
    const store = useCanvasStore('p', TARGET)
    await store.load()
    expect(store.loaded.value).toBe(true)
    expect(store.nodes.value).toHaveLength(0)
    expect(store.savedRev.value).toBe(0)
  })

  it('加载：存在时读取画布定义与保存版本号', async () => {
    const raw = {
      version: 1,
      kind: 'scene',
      nodes: [{ id: 'a', prototypeId: 'text', name: 'n', x: 0, y: 0, width: 10, height: 10, config: {} }],
      connections: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    ;(loadCanvas as Mock).mockResolvedValue(canvasResult(raw.nodes, 3))
    const store = useCanvasStore('p', TARGET)
    await store.load()
    expect(store.nodes.value).toHaveLength(1)
    expect(store.savedRev.value).toBe(3)
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

  it('addNode：默认尺寸按原型 defaultSize 应用（AI 文本生成更大，其余 240×160 兜底）', () => {
    const store = useCanvasStore('p', TARGET)
    const ai = store.addNode('text-ai', 0, 0)
    expect(ai.width).toBe(360)
    expect(ai.height).toBe(240)
    const loader = store.addNode('image-loader', 200, 200)
    expect(loader.width).toBe(240)
    expect(loader.height).toBe(160)
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
    // 加载视频(video) → 生成图片(in: ['image','text']) 类型不兼容
    const v = store.addNode('video-loader', 0, 0)
    const g = store.addNode('image-generate', 0, 0)
    expect(store.connect(v.id, g.id)).toBe(false)
    expect(store.connections.value).toHaveLength(0)
  })

  it('connect：文本(text) → 生成图片可连接（文本作为外部提示词）', () => {
    const store = useCanvasStore('p', TARGET)
    const t = store.addNode('text', 0, 0)
    const g = store.addNode('image-generate', 0, 0)
    expect(store.connect(t.id, g.id)).toBe(true)
    expect(store.connections.value).toHaveLength(1)
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

  it('pasteNode(source)：外部节点源（如系统剪贴板标记）粘贴到源节点之外（不叠压）', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('text', 0, 0)
    const b = store.pasteNode({ ...a, id: 'external', x: 100, y: 100 })
    expect(b).toBeTruthy()
    expect(b!.id).not.toBe('external')
    // 落点 = 源内容右下方向外错开一个身位 + 间隙：不与源节点矩形重叠
    expect(b!.x).toBe(100 + a.width + PASTE_CASCADE_GAP)
    expect(rectsOverlap(a, b!)).toBe(false)
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
    ;(loadCanvas as Mock).mockResolvedValue(canvasResult(raw2.nodes, 0))
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

  // ── 画布保存版本（CAS）冲突保护 ────────────────────────────────

  it('自动保存后版本号更新（savedRev 跟随后端）', async () => {
    ;(saveCanvas as Mock).mockResolvedValue({ rev: 6, updatedAt: 'x' })
    const store = useCanvasStore('p', TARGET)
    store.addNode('text', 0, 0)
    await vi.runAllTimersAsync()
    expect(saveCanvas).toHaveBeenCalledWith('p', TARGET, expect.anything(), { expectedRev: 0 })
    expect(store.savedRev.value).toBe(6)
    expect(store.dirty.value).toBe(false)
    // 再次编辑并保存：基于新版本号
    store.addNode('text', 0, 0)
    await vi.runAllTimersAsync()
    expect(saveCanvas).toHaveBeenLastCalledWith('p', TARGET, expect.anything(), { expectedRev: 6 })
  })

  it('版本冲突：进入冲突态、保留本地修改并停止自动保存', async () => {
    const store = useCanvasStore('p', TARGET)
    store.addNode('text', 0, 0)
    ;(saveCanvas as Mock).mockRejectedValue(new CanvasVersionError('画布保存冲突', 9, 0))
    await vi.runAllTimersAsync()
    expect(store.conflict.value).toEqual({ currentRev: 9, expectedRev: 0 })
    expect(store.dirty.value).toBe(true)
    expect(store.nodes.value).toHaveLength(1)
    // 冲突期间继续编辑不再触发自动保存
    expect(saveCanvas).toHaveBeenCalledTimes(1)
    store.addNode('text', 0, 0)
    await vi.runAllTimersAsync()
    expect(saveCanvas).toHaveBeenCalledTimes(1)
  })

  it('forceSave：强制覆盖后清除冲突并继续正常保存', async () => {
    const store = useCanvasStore('p', TARGET)
    store.addNode('text', 0, 0)
    ;(saveCanvas as Mock).mockRejectedValueOnce(new CanvasVersionError('画布保存冲突', 9, 0))
    await vi.runAllTimersAsync()
    expect(store.conflict.value).not.toBeNull()
    ;(saveCanvas as Mock).mockResolvedValueOnce({ rev: 10, updatedAt: 'x' })
    const ok = await store.forceSave()
    expect(ok).toBe(true)
    expect(saveCanvas).toHaveBeenLastCalledWith('p', TARGET, expect.anything(), { expectedRev: 0, force: true })
    expect(store.conflict.value).toBeNull()
    expect(store.dirty.value).toBe(false)
    expect(store.savedRev.value).toBe(10)
  })

  it('reloadFromServer：重新加载服务端版本并清除冲突与未保存修改', async () => {
    const store = useCanvasStore('p', TARGET)
    store.addNode('text', 0, 0)
    ;(saveCanvas as Mock).mockRejectedValueOnce(new CanvasVersionError('画布保存冲突', 9, 0))
    await vi.runAllTimersAsync()
    expect(store.conflict.value).not.toBeNull()
    ;(loadCanvas as Mock).mockResolvedValue(canvasResult([{ id: 'a', prototypeId: 'text', name: 'n', x: 0, y: 0, width: 10, height: 10, config: {} }], 9))
    await store.reloadFromServer()
    expect(store.conflict.value).toBeNull()
    expect(store.dirty.value).toBe(false)
    expect(store.nodes.value).toHaveLength(1)
    expect(store.savedRev.value).toBe(9)
  })

  it('switchTarget：存在版本冲突时不切换（返回 conflict 且数据保留）', async () => {
    const store = useCanvasStore('p', TARGET)
    store.addNode('text', 0, 0)
    ;(saveCanvas as Mock).mockRejectedValueOnce(new CanvasVersionError('画布保存冲突', 9, 0))
    await vi.runAllTimersAsync()
    const st = await store.switchTarget({ kind: 'scene', episode: '1', shot: '2' })
    expect(st).toBe('conflict')
    // 未切换：仍指向旧目标，本地修改保留
    expect(loadCanvas).not.toHaveBeenCalledWith('p', { kind: 'scene', episode: '1', shot: '2' })
    expect(store.nodes.value).toHaveLength(1)
    expect(store.dirty.value).toBe(true)
    // 用户选择「放弃本地修改」：discard 切换成功
    ;(loadCanvas as Mock).mockResolvedValue(canvasResult([], 9))
    const st2 = await store.switchTarget({ kind: 'scene', episode: '1', shot: '2' }, { discard: true })
    expect(st2).toBe('ok')
    expect(store.nodes.value).toHaveLength(0)
    expect(store.dirty.value).toBe(false)
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

  // ── 连线改接（连接转移 / 连接复制）──────────────────────

  it('rewireConnections：转移把多条连线按原顺序改接到目标节点，并同步两侧 inputOrder', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const c = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 0)
    const d = store.addNode('image-generate', 200, 0)
    store.connect(a.id, b.id)
    store.connect(c.id, b.id)
    // 源端 inputOrder 含两个来源；目标端已有其他顺序条目
    store.updateNode(b.id, { config: { inputOrder: [a.id, c.id] } })
    store.updateNode(d.id, { config: { inputOrder: ['stale'] } })
    const result = store.rewireConnections({
      removeSource: true,
      items: store.connections.value.map((conn) => ({ connectionId: conn.id, toNodeId: d.id })),
    })
    expect(result.skipped).toHaveLength(0)
    expect(result.connected.map((conn) => conn.fromNodeId)).toEqual([a.id, c.id])
    // 原连线全部移除，新连线按原顺序建立在 d 上
    expect(store.connections.value.filter((conn) => conn.toNodeId === b.id)).toHaveLength(0)
    expect(store.connections.value.filter((conn) => conn.toNodeId === d.id).map((conn) => conn.fromNodeId)).toEqual([a.id, c.id])
    // 源端 inputOrder 清理，目标端按顺序追加（已有条目保留在前）
    expect(store.nodes.value.find((n) => n.id === b.id)!.config.inputOrder).toEqual([])
    expect(store.nodes.value.find((n) => n.id === d.id)!.config.inputOrder).toEqual(['stale', a.id, c.id])
  })

  it('rewireConnections：转移为单次撤销，undo 整体回退连线与 inputOrder', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 0)
    const d = store.addNode('image-generate', 200, 0)
    store.connect(a.id, b.id)
    store.updateNode(b.id, { config: { inputOrder: [a.id] } })
    store.rewireConnections({ removeSource: true, items: [{ connectionId: store.connections.value[0].id, toNodeId: d.id }] })
    store.undo()
    expect(store.connections.value).toHaveLength(1)
    expect(store.connections.value[0]).toMatchObject({ fromNodeId: a.id, toNodeId: b.id })
    expect(store.nodes.value.find((n) => n.id === b.id)!.config.inputOrder).toEqual([a.id])
    expect(store.nodes.value.find((n) => n.id === d.id)!.config.inputOrder).toBeUndefined()
  })

  it('rewireConnections：复制保留原连线，仅新增连线', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 0)
    const d = store.addNode('image-generate', 200, 0)
    store.connect(a.id, b.id)
    const originalId = store.connections.value[0].id
    const result = store.rewireConnections({
      removeSource: false,
      items: [{ connectionId: originalId, toNodeId: d.id }],
    })
    expect(result.skipped).toHaveLength(0)
    expect(store.connections.value).toHaveLength(2)
    expect(store.connections.value.some((conn) => conn.id === originalId)).toBe(true)
    expect(store.connections.value.find((conn) => conn.toNodeId === d.id)).toMatchObject({ fromNodeId: a.id, toPortId: 'in' })
    // 复制时源端 inputOrder 不清理
    expect(store.nodes.value.find((n) => n.id === b.id)!.config.inputOrder).toBeUndefined()
  })

  it('rewireConnections：目标节点已有同一来源的连线时按节点级重复忽略，原连线保留', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 0)
    const d = store.addNode('image-generate', 200, 0)
    store.connect(a.id, b.id)
    store.connect(a.id, d.id)
    const historyLenBefore = store.historyPast.value.length
    const dirtyBefore = store.dirty.value
    const result = store.rewireConnections({
      removeSource: true,
      items: [{ connectionId: store.connections.value[0].id, toNodeId: d.id }],
    })
    expect(result.connected).toHaveLength(0)
    expect(result.skipped).toEqual([{ fromNodeId: a.id, toNodeId: d.id, reason: 'duplicate' }])
    expect(store.connections.value).toHaveLength(2)
    // 全部被忽略：不压撤销栈、不额外置脏
    expect(store.historyPast.value.length).toBe(historyLenBefore)
    expect(store.dirty.value).toBe(dirtyBefore)
  })

  it('rewireConnections：同一来源在批次内出现两条时只建立一条（节点级去重）', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 0)
    const d = store.addNode('image-generate', 200, 0)
    store.connect(a.id, b.id)
    store.connect(a.id, b.id)
    const result = store.rewireConnections({
      removeSource: true,
      items: store.connections.value.map((conn) => ({ connectionId: conn.id, toNodeId: d.id })),
    })
    expect(result.connected).toHaveLength(1)
    expect(result.skipped).toEqual([{ fromNodeId: a.id, toNodeId: d.id, reason: 'duplicate' }])
    expect(store.connections.value.filter((conn) => conn.toNodeId === d.id)).toHaveLength(1)
  })

  it('rewireConnections：目标端口类型不兼容时忽略并保留原连线', () => {
    const store = useCanvasStore('p', TARGET)
    const t = store.addNode('text', 0, 0)
    const b = store.addNode('text-ai', 100, 0)
    // 获取视频帧仅接受 video 输入：text 来源改接过去不兼容
    const d = store.addNode('video-frame-extract', 200, 0)
    store.connect(t.id, b.id)
    const result = store.rewireConnections({
      removeSource: true,
      items: [{ connectionId: store.connections.value[0].id, toNodeId: d.id }],
    })
    expect(result.skipped[0].reason).toBe('incompatible')
    expect(store.connections.value).toHaveLength(1)
  })

  it('rewireConnections：改接后会成环时忽略（reason=cycle）', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 0)
    const vg = store.addNode('video-generate', 200, 0)
    const v2i = store.addNode('video-frame-extract', 300, 0)
    const img2 = store.addNode('image-generate', 400, 0)
    store.connect(a.id, b.id)
    store.connect(b.id, vg.id)
    store.connect(vg.id, v2i.id)
    store.connect(v2i.id, img2.id)
    // 把 img2 的输入（来自 v2i）转移到 vg：v2i→vg 会经 vg→v2i 成环
    const result = store.rewireConnections({
      removeSource: true,
      items: [{ connectionId: store.connections.value.find((conn) => conn.toNodeId === img2.id)!.id, toNodeId: vg.id }],
    })
    expect(result.skipped).toEqual([{ fromNodeId: v2i.id, toNodeId: vg.id, reason: 'cycle' }])
    expect(store.connections.value.find((conn) => conn.toNodeId === img2.id)).toBeTruthy()
  })

  it('rewireConnections：改接到原目标节点视为重复忽略（无意义改接）', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 0)
    store.connect(a.id, b.id)
    const result = store.rewireConnections({
      removeSource: true,
      items: [{ connectionId: store.connections.value[0].id, toNodeId: b.id }],
    })
    expect(result.skipped).toEqual([{ fromNodeId: a.id, toNodeId: b.id, reason: 'duplicate' }])
    expect(store.connections.value).toHaveLength(1)
  })

  it('rewireConnections：转移触发 disconnect+connect 联动事件（导演台同步依赖）', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 0)
    const d = store.addNode('image-generate', 200, 0)
    store.connect(a.id, b.id)
    const events: { type: 'connect' | 'disconnect' }[] = []
    store.onConnectionsChanged((e) => events.push(e))
    events.length = 0
    store.rewireConnections({ removeSource: true, items: [{ connectionId: store.connections.value[0].id, toNodeId: d.id }] })
    expect(events.map((e) => e.type)).toEqual(['disconnect', 'connect'])
  })

  // ── 多选群组批量操作 ──────────────────────────────────

  it('copyNodes/pasteNodes：多节点复制粘贴重建 id 与组内连线，副本整体错出源内容包围盒', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 100)
    expect(store.connect(a.id, b.id)).toBe(true)
    store.copyNodes([a.id, b.id])
    const pastedResult = store.pasteNodes()
    const pasted = pastedResult.nodes
    expect(pasted).toHaveLength(2)
    const pastedIds = new Set(pasted.map((n) => n.id))
    expect(pastedIds.has(a.id)).toBe(false)
    expect(pastedIds.has(b.id)).toBe(false)
    // 组内连线按新 id 重建
    expect(store.connections.value).toHaveLength(2)
    const newConn = store.connections.value.find((cn) => pastedIds.has(cn.fromNodeId) && pastedIds.has(cn.toNodeId))
    expect(newConn).toBeTruthy()
    // 落点 = 源内容包围盒（两节点并集）右下方一个身位 + 间隙 ⇒ 副本节点不与任何源节点重叠
    const sourceBounds = clipboardBounds({ nodes: [a, b], connections: [], groups: [] })!
    const pastedA = pasted.find((n) => n.prototypeId === 'image-loader')!
    expect(pastedA.x).toBe(a.x + PASTE_CASCADE_GAP + sourceBounds.width)
    expect(pastedA.y).toBe(a.y + PASTE_CASCADE_GAP + sourceBounds.height)
    expect(rectsOverlap(pastedA, a)).toBe(false)
    expect(rectsOverlap(pasted.find((n) => n.prototypeId === 'image-generate')!, b)).toBe(false)
    // 首选落点未被占用：不算「被探测挪动」
    expect(pastedResult.cascaded).toBe(false)
  })

  it('pasteNodes：重映射 config.inputOrder 与导演台素材块引用', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const b = store.addNode('image-generate', 100, 100)
    store.updateNode(b.id, { config: { inputOrder: [a.id] } })
    expect(store.connect(a.id, b.id)).toBe(true)
    store.copyNodes([a.id, b.id])
    const pasted = store.pasteNodes().nodes
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
      groups: [],
    }
    const pasted = store.pasteNodes(payload).nodes
    expect(pasted).toHaveLength(1)
    expect(store.canPaste.value).toBe(false)
  })

  it('pasteNodes：无剪贴板内容返回空节点、空分组且未发生挪动', () => {
    const store = useCanvasStore('p', TARGET)
    expect(store.pasteNodes()).toEqual({ nodes: [], groups: [], cascaded: false })
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

  it('moveEntities：节点与分组一次回写，单次撤销', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('text', 0, 0)
    const g = store.addGroup(rect(100, 100))
    store.moveEntities([{ id: a.id, x: 40, y: 50 }], [{ id: g.id, x: 140, y: 150 }])
    expect(store.nodes.value.find((n) => n.id === a.id)).toMatchObject({ x: 40, y: 50 })
    expect(store.groups.value.find((x) => x.id === g.id)).toMatchObject({ x: 140, y: 150 })
    store.undo()
    expect(store.nodes.value.find((n) => n.id === a.id)).toMatchObject({ x: 0, y: 0 })
    expect(store.groups.value.find((x) => x.id === g.id)).toMatchObject({ x: 100, y: 100 })
  })

  it('moveEntities：仅分组补丁时同样生效（拖动分组）', () => {
    const store = useCanvasStore('p', TARGET)
    const g = store.addGroup(rect())
    store.moveEntities([], [{ id: g.id, x: 10, y: 20 }])
    expect(store.groups.value[0]).toMatchObject({ x: 10, y: 20 })
  })

  it('moveEntities：全部 id 不存在时 no-op', () => {
    const store = useCanvasStore('p', TARGET)
    store.moveEntities([{ id: 'ghost', x: 1, y: 1 }], [{ id: 'ghost-g', x: 1, y: 1 }])
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

  it('createNodeAndConnect：AI 文本生成节点按 defaultSize 创建更大默认尺寸', () => {
    const store = useCanvasStore('p', TARGET)
    const { node } = store.createNodeAndConnect('text-ai', 0, 0, [])
    expect(node.prototypeId).toBe('text-ai')
    expect(node.width).toBe(360)
    expect(node.height).toBe(240)
  })

  // ── LLM 会话视图同步（viewOnlyUpdate / adoptExternalChange）───────────

  /** 构造带 AI 文本节点的画布 store（跳过 api 依赖） */
  function makeTextAiStore(output = '') {
    const store = useCanvasStore('p', TARGET)
    store.data.value = {
      ...store.data.value,
      nodes: [{
        id: 'n1',
        prototypeId: 'text-ai',
        name: 'AI文本生成',
        x: 0,
        y: 0,
        width: 360,
        height: 240,
        config: { input: '你好', output },
      }],
    }
    return store
  }

  it('viewOnlyUpdate：纯内存合并 config，不入撤销栈、不置脏、不触发保存', async () => {
    const store = makeTextAiStore('')
    const beforeDirty = store.dirty.value
    store.viewOnlyUpdate('n1', { output: '流式部分' })
    expect(store.nodes.value[0].config.output).toBe('流式部分')
    expect(store.dirty.value).toBe(beforeDirty)
    expect(store.canUndo.value).toBe(false)
    await vi.runAllTimersAsync()
    expect(saveCanvas).not.toHaveBeenCalled()
  })

  it('viewOnlyUpdate：节点不存在时安全跳过', () => {
    const store = makeTextAiStore()
    store.viewOnlyUpdate('missing', { output: 'x' })
    expect(store.nodes.value).toHaveLength(1)
  })

  it('adoptExternalChange：合并终态补丁 + 入撤销栈（单次撤销回退生成前状态）+ savedRev 对齐，不触发写盘', async () => {
    const store = makeTextAiStore('')
    store.savedRev.value = 3
    store.adoptExternalChange('n1', {
      output: '完整答案',
      outputHistory: [{ id: 'h1', createdAt: '2024-01-01T00:00:00.000Z', input: '你好', output: '完整答案' }],
    }, 8)
    expect(store.nodes.value[0].config.output).toBe('完整答案')
    expect((store.nodes.value[0].config.outputHistory as unknown[])).toHaveLength(1)
    expect(store.savedRev.value).toBe(8)
    expect(store.dirty.value).toBe(false)
    await vi.runAllTimersAsync()
    expect(saveCanvas).not.toHaveBeenCalled() // 内容已在文件，不重复写盘
    // 撤销一次回到生成前状态
    store.undo()
    expect(store.nodes.value[0].config.output).toBe('')
  })

  it('adoptExternalChange：节点不存在时安全跳过', () => {
    const store = makeTextAiStore()
    store.adoptExternalChange('missing', { output: 'x' }, 5)
    expect(store.canUndo.value).toBe(false)
  })

  // ── 持久分组（groups[]）──────────────────────────────────────

  /** 构造分组矩形 */
  function rect(x = 0, y = 0, width = 400, height = 300) {
    return { x, y, width, height }
  }

  it('addGroup：默认标题与颜色，入撤销栈并可撤销', () => {
    const store = useCanvasStore('p', TARGET)
    const g1 = store.addGroup(rect(10, 20, 300, 200))
    expect(g1.name).toBe('分组 1')
    expect(g1.color).toBe('#1976D2')
    expect(g1.x).toBe(10)
    expect(g1.width).toBe(300)
    expect(store.groups.value).toHaveLength(1)
    const g2 = store.addGroup(rect())
    expect(g2.name).toBe('分组 2')
    expect(store.groups.value).toHaveLength(2)
    store.undo()
    expect(store.groups.value).toHaveLength(1)
    store.undo()
    expect(store.groups.value).toHaveLength(0)
    store.redo()
    expect(store.groups.value).toHaveLength(1)
  })

  it('addGroup：可指定标题与颜色', () => {
    const store = useCanvasStore('p', TARGET)
    const g = store.addGroup(rect(), { name: '主角区', color: '#2E7D32' })
    expect(g.name).toBe('主角区')
    expect(g.color).toBe('#2E7D32')
  })

  it('updateGroup：更新标题/颜色/几何，单次撤销', () => {
    const store = useCanvasStore('p', TARGET)
    const g = store.addGroup(rect())
    store.updateGroup(g.id, { name: '改名', color: '#C62828', x: 50, y: 60, width: 200, height: 120 })
    expect(store.groups.value[0]).toMatchObject({ name: '改名', color: '#C62828', x: 50, y: 60, width: 200, height: 120 })
    store.undo()
    expect(store.groups.value[0]).toMatchObject({ name: '分组 1', color: '#1976D2', x: 0, y: 0, width: 400, height: 300 })
  })

  it('updateGroup：分组不存在时 no-op', () => {
    const store = useCanvasStore('p', TARGET)
    store.updateGroup('ghost', { name: 'x' })
    expect(store.canUndo.value).toBe(false)
  })

  it('updateGroups：批量平移单次撤销', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addGroup(rect(0, 0))
    const b = store.addGroup(rect(500, 500))
    store.updateGroups([{ id: a.id, x: 100, y: 110 }, { id: b.id, x: 600, y: 610 }])
    expect(store.groups.value.find((g) => g.id === a.id)).toMatchObject({ x: 100, y: 110 })
    expect(store.groups.value.find((g) => g.id === b.id)).toMatchObject({ x: 600, y: 610 })
    store.undo()
    expect(store.groups.value.find((g) => g.id === a.id)).toMatchObject({ x: 0, y: 0 })
    expect(store.groups.value.find((g) => g.id === b.id)).toMatchObject({ x: 500, y: 500 })
  })

  it('updateGroups：全部 id 不存在时 no-op', () => {
    const store = useCanvasStore('p', TARGET)
    store.updateGroups([{ id: 'ghost', x: 1, y: 1 }])
    expect(store.canUndo.value).toBe(false)
  })

  it('removeGroups：解散分组但保留节点，单次撤销', () => {
    const store = useCanvasStore('p', TARGET)
    const node = store.addNode('text', 0, 0)
    const g = store.addGroup(rect())
    store.removeGroups([g.id])
    expect(store.groups.value).toHaveLength(0)
    expect(store.nodes.value).toHaveLength(1)
    expect(store.nodes.value[0].id).toBe(node.id)
    store.undo()
    expect(store.groups.value).toHaveLength(1)
  })

  it('removeGroups：空列表/不存在 id 时 no-op', () => {
    const store = useCanvasStore('p', TARGET)
    store.removeGroups([])
    store.removeGroups(['ghost'])
    expect(store.canUndo.value).toBe(false)
  })

  it('removeNodes：同时删除节点与分组（单次撤销）', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('image-loader', 0, 0)
    const g = store.addGroup(rect())
    const events: { type: string }[] = []
    store.onConnectionsChanged((e) => events.push(e))
    store.removeNodes([a.id], [g.id])
    expect(store.nodes.value).toHaveLength(0)
    expect(store.groups.value).toHaveLength(0)
    store.undo()
    expect(store.nodes.value).toHaveLength(1)
    expect(store.groups.value).toHaveLength(1)
  })

  it('copyNodes/pasteNodes：分组副本换新 id 且与源分组零重叠，成员关系仍由几何自动成立', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('text', 20, 30)
    const g = store.addGroup(rect(0, 0, 400, 300))
    store.copyNodes([a.id], [g.id])
    const pasted = store.pasteNodes()
    expect(pasted.nodes).toHaveLength(1)
    expect(pasted.groups).toHaveLength(1)
    const newGroup = pasted.groups[0]
    expect(newGroup.id).not.toBe(g.id)
    expect(newGroup.name).toBe('分组 1')
    // 落点 = 源内容包围盒（分组 400×300 ∪ 节点）右下 + 间隙：副本分组与源分组不重叠
    expect(newGroup.x).toBe(g.x + PASTE_CASCADE_GAP + 400)
    expect(newGroup.y).toBe(g.y + PASTE_CASCADE_GAP + 300)
    expect(rectsOverlap(newGroup, g)).toBe(false)
    expect(store.groups.value).toHaveLength(2)
    // 副本节点整体跟随副本分组平移，仍落在副本分组内（相对位置不变）
    const newNode = pasted.nodes[0]
    expect(newNode.x).toBe(a.x + PASTE_CASCADE_GAP + 400)
    expect(newNode.y).toBe(a.y + PASTE_CASCADE_GAP + 300)
    expect(newGroup.x <= newNode.x && newGroup.x + newGroup.width >= newNode.x + newNode.width).toBe(true)
    expect(newGroup.y <= newNode.y && newGroup.y + newGroup.height >= newNode.y + newNode.height).toBe(true)
    store.undo()
    expect(store.groups.value).toHaveLength(1)
    expect(store.nodes.value).toHaveLength(1)
  })

  it('copyNodes/pasteNodes（回归）：拖副本分组不再带走源节点，拖源分组不再带走副本节点', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('text', 20, 30)
    const g = store.addGroup(rect(0, 0, 400, 300))
    store.copyNodes([a.id], [g.id])
    const pasted = store.pasteNodes()
    const newGroup = pasted.groups[0]
    const newNode = pasted.nodes[0]

    // 拖副本分组：跟随集只含副本节点（源节点此前会因矩形重叠被一起拖走）
    const copyFollow = collectDragFollowSet(store.groups.value, store.nodes.value, newGroup.id)
    expect(copyFollow.groupIds).toEqual([newGroup.id])
    expect(copyFollow.nodeIds).toEqual([newNode.id])
    // 拖源分组：跟随集只含源节点
    const sourceFollow = collectDragFollowSet(store.groups.value, store.nodes.value, g.id)
    expect(sourceFollow.groupIds).toEqual([g.id])
    expect(sourceFollow.nodeIds).toEqual([a.id])
  })

  it('copyNodes/pasteNodes：连续粘贴三份互不重叠（副本本身成为下次粘贴的避让对象）', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('text', 20, 30)
    const g = store.addGroup(rect(0, 0, 400, 300))
    store.copyNodes([a.id], [g.id])
    store.pasteNodes()
    store.pasteNodes()
    expect(store.groups.value).toHaveLength(3)
    for (let i = 0; i < store.groups.value.length; i += 1) {
      for (let j = i + 1; j < store.groups.value.length; j += 1) {
        expect(rectsOverlap(store.groups.value[i], store.groups.value[j])).toBe(false)
      }
    }
    expect(store.nodes.value).toHaveLength(3)
  })

  it('copyNodes：仅复制分组（无节点）也可粘贴，canPaste 计入分组', () => {
    const store = useCanvasStore('p', TARGET)
    const g = store.addGroup(rect())
    store.copyNodes([], [g.id])
    expect(store.canPaste.value).toBe(true)
    const pasted = store.pasteNodes()
    expect(pasted.nodes).toHaveLength(0)
    expect(pasted.groups).toHaveLength(1)
    expect(store.groups.value).toHaveLength(2)
  })

  it('copyNodes：节点与分组均为空时忽略（不覆盖已有剪贴板）', () => {
    const store = useCanvasStore('p', TARGET)
    const a = store.addNode('text', 0, 0)
    store.copyNodes([a.id])
    store.copyNodes([], [])
    expect(store.canPaste.value).toBe(true)
    expect(store.pasteNodes().nodes).toHaveLength(1)
  })

  it('pasteNodes：外部载荷含分组时重建分组，落点按载荷包围盒错位', () => {
    const store = useCanvasStore('p', TARGET)
    const source = store.addNode('text', 0, 0)
    const payload = {
      nodes: [{ ...source }],
      connections: [],
      groups: [{ id: 'ext-g', name: '外部分组', color: '#0097A7', x: 100, y: 200, width: 300, height: 200 }],
    }
    const bounds = clipboardBounds(payload)!
    const pasted = store.pasteNodes(payload)
    expect(pasted.groups).toHaveLength(1)
    expect(pasted.groups[0].id).not.toBe('ext-g')
    // 偏移 = 载荷包围盒（节点 ∪ 分组）尺寸 + 间隙
    expect(pasted.groups[0].x).toBe(100 + PASTE_CASCADE_GAP + bounds.width)
    expect(pasted.groups[0].y).toBe(200 + PASTE_CASCADE_GAP + bounds.height)
    expect(store.groups.value).toHaveLength(1)
  })

  it('switchTarget：切换画布后分组被清空', async () => {
    const store = useCanvasStore('p', TARGET)
    store.addGroup(rect())
    expect(store.groups.value).toHaveLength(1)
    await store.switchTarget({ kind: 'scene', episode: '1', shot: '2' })
    expect(store.groups.value).toHaveLength(0)
  })

  // ── 蓝图支持：持久化适配器 / applyEntities / syncSavedRev ──────────

  it('持久化适配器：load 返回仅含 nodes/connections/groups 时由 store 兜底补全', async () => {
    const persistence = {
      load: vi.fn().mockResolvedValue({
        canvas: {
          nodes: [{ id: 'a', prototypeId: 'text', name: 'n', x: 1, y: 2, width: 10, height: 10, config: {} }],
          connections: [{ id: 'c', fromNodeId: 'a', fromPortId: 'out', toNodeId: 'a', toPortId: 'in' }],
          groups: [{ id: 'g', name: 'g', color: '#1976D2', x: 0, y: 0, width: 100, height: 100 }],
        },
        rev: 7,
      }),
      save: vi.fn().mockResolvedValue({ rev: 8 }),
    }
    const store = useCanvasStore('p', TARGET, persistence)
    await store.load()
    expect(store.loaded.value).toBe(true)
    expect(store.savedRev.value).toBe(7)
    expect(store.nodes.value).toHaveLength(1)
    expect(store.connections.value).toHaveLength(1)
    expect(store.groups.value).toHaveLength(1)
    // 缺省字段由 createCanvasData 兜底
    expect(store.data.value.kind).toBe('scene')
    expect(store.data.value.version).toBeGreaterThan(0)
    // 适配器注入后不再走画布定义接口
    expect(loadCanvas).not.toHaveBeenCalled()
  })

  it('持久化适配器：save 以 CAS 版本号写入并回写新 rev', async () => {
    const persistence = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({ rev: 5 }),
    }
    const store = useCanvasStore('p', TARGET, persistence)
    await store.load()
    store.addNode('text', 0, 0)
    const ok = await store.save()
    expect(ok).toBe(true)
    expect(persistence.save).toHaveBeenCalledWith(expect.anything(), { expectedRev: 0 })
    expect(store.savedRev.value).toBe(5)
    expect(saveCanvas).not.toHaveBeenCalled()
  })

  it('applyEntities：一次写入节点/连线/分组，单次撤销可整体回退', () => {
    const store = useCanvasStore('p', TARGET)
    store.addNode('text', 0, 0) // 已有节点，确保撤销后仍存在
    const before = store.nodes.value.length
    store.applyEntities({
      nodes: [
        { id: 'n1', prototypeId: 'text', name: 'a', x: 0, y: 0, width: 10, height: 10, config: {} },
        { id: 'n2', prototypeId: 'image-generate', name: 'b', x: 100, y: 0, width: 10, height: 10, config: {} },
      ],
      connections: [{ id: 'c1', fromNodeId: 'n1', fromPortId: 'out', toNodeId: 'n2', toPortId: 'in' }],
      groups: [{ id: 'g1', name: '蓝图', color: '#1976D2', x: -12, y: -12, width: 200, height: 120 }],
    })
    expect(store.nodes.value).toHaveLength(before + 2)
    expect(store.connections.value).toHaveLength(1)
    expect(store.groups.value).toHaveLength(1)
    store.undo()
    expect(store.nodes.value).toHaveLength(before)
    expect(store.connections.value).toHaveLength(0)
    expect(store.groups.value).toHaveLength(0)
  })

  it('applyEntities：空载荷不产生撤销条目', () => {
    const store = useCanvasStore('p', TARGET)
    store.applyEntities({ nodes: [], connections: [], groups: [] })
    expect(store.canUndo.value).toBe(false)
  })

  it('syncSavedRev：对齐外部部分写入后的版本号（不置脏、不触发保存）', async () => {
    const store = useCanvasStore('p', TARGET)
    await store.load()
    store.syncSavedRev(9)
    expect(store.savedRev.value).toBe(9)
    expect(store.dirty.value).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(saveCanvas).not.toHaveBeenCalled()
    // 非法值忽略
    store.syncSavedRev(-1)
    expect(store.savedRev.value).toBe(9)
  })

  // ── 手动保存模式（autoSave: false；蓝图编辑器）─────────────────────

  it('autoSave: false：结构改动只置脏、不自动落盘', async () => {
    const store = useCanvasStore('p', TARGET, undefined, { autoSave: false })
    await store.load()
    store.addNode('text', 0, 0)
    expect(store.nodes.value).toHaveLength(1)
    expect(store.dirty.value).toBe(true)
    await vi.runAllTimersAsync()
    expect(saveCanvas).not.toHaveBeenCalled()
    expect(store.dirty.value).toBe(true)
  })

  it('autoSave: false：显式 save() 落盘并清除脏标记（CAS 版本号沿用）', async () => {
    const persistence = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({ rev: 4 }),
    }
    const store = useCanvasStore('p', TARGET, persistence, { autoSave: false })
    await store.load()
    store.addNode('text', 0, 0)
    await vi.runAllTimersAsync()
    expect(persistence.save).not.toHaveBeenCalled()
    const ok = await store.save()
    expect(ok).toBe(true)
    expect(persistence.save).toHaveBeenCalledWith(expect.anything(), { expectedRev: 0 })
    expect(store.savedRev.value).toBe(4)
    expect(store.dirty.value).toBe(false)
  })

  it('autoSave: true（缺省）：仍走防抖自动保存', async () => {
    const store = useCanvasStore('p', TARGET, undefined, { autoSave: true })
    await store.load()
    store.addNode('text', 0, 0)
    await vi.runAllTimersAsync()
    expect(saveCanvas).toHaveBeenCalledTimes(1)
    expect(store.dirty.value).toBe(false)
  })
})
