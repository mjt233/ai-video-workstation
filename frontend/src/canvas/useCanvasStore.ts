import { computed, ref } from 'vue'
import { createCanvasData, newId, type CanvasConnection, type CanvasData, type CanvasNodeData, type NodeConfig } from './types'
import { loadCanvas, saveCanvas, type CanvasTarget } from './api'
import { canConnectNodes, getNodeInputPortId, getNodeOutputPortId } from './connection'
import { getPrototype } from './registry'
import { applyConnectionSync } from './connectionSync'
import { serializeNodeClipboard } from './nodeClipboard'
import type { CanvasDirectorConfig } from './videoTypes'

/** 自动保存防抖毫秒数 */
const SAVE_DEBOUNCE_MS = 800

/** 撤销/重做历史栈容量上限 */
const HISTORY_LIMIT = 50

/**
 * 画布状态管理：加载/保存（防抖自动保存）、节点与连线的增删改查、连接校验。
 *
 * @param project 项目名
 * @param target 画布目标
 */
export function useCanvasStore(project: string, target: CanvasTarget) {
  /** 当前画布目标（切换分镜/场景时通过 switchTarget 更新） */
  const targetRef = ref<CanvasTarget>({ ...target })
  const data = ref<CanvasData>(createCanvasData(targetRef.value.kind))
  const loaded = ref(false)
  const dirty = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  /** 撤销历史栈（快照） */
  const historyPast = ref<CanvasData[]>([])
  /** 重做历史栈（快照） */
  const historyFuture = ref<CanvasData[]>([])

  const nodes = computed(() => data.value.nodes)
  const connections = computed(() => data.value.connections)

  /** 连线变化事件：connect（建立）/ disconnect（断开） */
  type ConnectionsChangedEvent = { type: 'connect' | 'disconnect'; connection: CanvasConnection }
  const connectionListeners = new Set<(e: ConnectionsChangedEvent) => void>()

  /**
   * 订阅连线变化事件（connect/disconnect/节点删除连带断开时触发），返回取消订阅函数。
   *
   * @param listener 事件监听器（接收连线变化事件）
   * @returns 取消订阅函数
   */
  function onConnectionsChanged(listener: (e: ConnectionsChangedEvent) => void): () => void {
    connectionListeners.add(listener)
    return () => { connectionListeners.delete(listener) }
  }

  /**
   * 触发连线变化事件，通知全部监听者。
   * 画布节点级联动：先同步目标节点数据（connectionSync），再通知监听者。
   * 注意：connect/disconnect 已在结构变更前 pushHistory，一次撤销即可回退连线与节点级联动两个变更。
   *
   * @param e 连线变化事件
   */
  function emitConnectionsChanged(e: ConnectionsChangedEvent): void {
    // 不在此处 pushHistory：connect/disconnect 已在结构变更前快照，
    // 一次撤销即可同时回退「连线」与「轨道同步」两个变更。
    const synced = applyConnectionSync(data.value, e)
    if (synced !== data.value) {
      data.value = synced
      markDirty()
    }
    for (const l of connectionListeners) l(e)
  }

  /** 加载画布；不存在时保持空画布 */
  async function load(): Promise<void> {
    const existing = await loadCanvas(project, targetRef.value)
    if (existing) {
      data.value = existing
    }
    loaded.value = true
  }

  /** 将当前数据快照压入撤销栈（深拷贝） */
  function pushHistory(): void {
    historyPast.value.push(JSON.parse(JSON.stringify(data.value)) as CanvasData)
    if (historyPast.value.length > HISTORY_LIMIT) historyPast.value.shift()
    historyFuture.value = []
  }

  function markDirty(): void {
    data.value.updatedAt = new Date().toISOString()
    dirty.value = true
    scheduleSave()
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void save()
    }, SAVE_DEBOUNCE_MS)
  }

  /** 立即保存画布定义 */
  async function save(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    saving.value = true
    try {
      await saveCanvas(project, targetRef.value, data.value)
      dirty.value = false
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      saving.value = false
    }
  }

  /**
   * 添加节点。
   *
   * @param prototypeId 节点原型 id
   * @param x 画布 x 坐标
   * @param y 画布 y 坐标
   * @param configPatch 初始配置补丁（合并到原型 defaultConfig 之上；如粘贴资产时写入 assetPath、粘贴文本时写入 text）
   * @returns 新节点
   * @throws Error 未知原型时
   */
  function addNode(prototypeId: string, x: number, y: number, configPatch?: NodeConfig): CanvasNodeData {
    const proto = getPrototype(prototypeId)
    if (!proto) throw new Error(`未知节点类型: ${prototypeId}`)
    const node: CanvasNodeData = {
      id: newId(),
      prototypeId,
      name: proto.name,
      x,
      y,
      width: 240,
      height: 160,
      config: {
        ...(proto.defaultConfig ? JSON.parse(JSON.stringify(proto.defaultConfig)) : {}),
        ...(configPatch ?? {}),
      },
    }
    pushHistory()
    data.value.nodes.push(node)
    markDirty()
    return node
  }

  /**
   * 删除节点及其所有连线（连带断开的连线触发 disconnect 事件）。
   *
   * @param nodeId 节点 id
   */
  function removeNode(nodeId: string): void {
    pushHistory()
    const removed = data.value.connections.filter((c) => c.fromNodeId === nodeId || c.toNodeId === nodeId)
    data.value.nodes = data.value.nodes.filter((n) => n.id !== nodeId)
    data.value.connections = data.value.connections.filter((c) => c.fromNodeId !== nodeId && c.toNodeId !== nodeId)
    markDirty()
    for (const connection of removed) {
      emitConnectionsChanged({ type: 'disconnect', connection })
    }
  }

  /**
   * 局部更新节点（坐标、尺寸、名称、配置等）。
   *
   * @param nodeId 节点 id
   * @param patch 更新字段
   */
  function updateNode(nodeId: string, patch: Partial<CanvasNodeData>): void {
    const node = data.value.nodes.find((n) => n.id === nodeId)
    if (!node) return
    pushHistory()
    Object.assign(node, patch)
    markDirty()
  }

  /**
   * 建立连线（自动校验类型兼容与防循环，成功后触发 connect 事件）。
   *
   * @param fromNodeId 输出节点 id
   * @param toNodeId 输入节点 id
   * @param fromPortId 输出端口 id（缺省时用节点第一个输出端口）
   * @param toPortId 输入端口 id（缺省时用节点第一个输入端口）
   * @returns 成功建立返回 true
   */
  function connect(fromNodeId: string, toNodeId: string, fromPortId?: string, toPortId?: string): boolean {
    if (!canConnectNodes(data.value.connections, fromNodeId, toNodeId, data.value.nodes, toPortId)) {
      return false
    }
    const connection: CanvasConnection = {
      id: newId(),
      fromNodeId,
      fromPortId: fromPortId ?? getNodeOutputPortId(fromNodeId, data.value.nodes) ?? 'out',
      toNodeId,
      toPortId: toPortId ?? getNodeInputPortId(toNodeId, data.value.nodes) ?? 'in',
    }
    pushHistory()
    data.value.connections.push(connection)
    markDirty()
    emitConnectionsChanged({ type: 'connect', connection })
    return true
  }

  /**
   * 断开连线（成功后触发 disconnect 事件）。
   *
   * @param connectionId 连线 id
   */
  function disconnect(connectionId: string): void {
    pushHistory()
    const removed = data.value.connections.find((c) => c.id === connectionId)
    data.value.connections = data.value.connections.filter((c) => c.id !== connectionId)
    markDirty()
    if (removed) {
      emitConnectionsChanged({ type: 'disconnect', connection: removed })
    }
  }

  /**
   * 从节点 config.inputOrder 中移除指定来源节点 id（输入断开后的顺序清理）。
   *
   * 不 pushHistory：这是 disconnect 操作的配套清理（disconnect 已在结构变更前快照），
   * 单次撤销即可同时回退「连线 + inputOrder」两个变更；节点不存在 / 无 inputOrder /
   * 该 id 不在顺序中时不做任何修改（幂等）。
   *
   * @param nodeId 目标节点 id
   * @param sourceNodeId 被断开的来源节点 id
   */
  function removeInputOrderEntry(nodeId: string, sourceNodeId: string): void {
    const node = data.value.nodes.find((n) => n.id === nodeId)
    if (!node) return
    const order = node.config.inputOrder
    if (!Array.isArray(order)) return
    if (!order.includes(sourceNodeId)) return
    node.config = {
      ...node.config,
      inputOrder: order.filter((id) => id !== sourceNodeId),
    }
    markDirty()
  }

  /** 是否可撤销 */
  const canUndo = computed(() => historyPast.value.length > 0)
  /** 是否可重做 */
  const canRedo = computed(() => historyFuture.value.length > 0)

  /** 撤销一次结构变更 */
  function undo(): void {
    const snapshot = historyPast.value.pop()
    if (!snapshot) return
    historyFuture.value.push(JSON.parse(JSON.stringify(data.value)) as CanvasData)
    data.value = snapshot
    markDirty()
  }

  /** 重做一次结构变更 */
  function redo(): void {
    const snapshot = historyFuture.value.pop()
    if (!snapshot) return
    historyPast.value.push(JSON.parse(JSON.stringify(data.value)) as CanvasData)
    data.value = snapshot
    markDirty()
  }

  /** 复制剪贴板内容（节点数据） */
  const clipboard = ref<CanvasNodeData | null>(null)

  /** 是否可粘贴 */
  const canPaste = computed(() => clipboard.value !== null)

  /**
   * 复制节点到内部剪贴板，并同步写入系统剪贴板（标记前缀 + 节点 JSON）。
   *
   * 写入系统剪贴板的目的：让 Ctrl+V 的全局 paste 事件能优先识别节点复制标记
   * 并粘贴节点，而不被剪贴板中残留的旧文本/文件抢占（复制节点会覆盖系统剪贴板，
   * 与主流节点编辑器的复制语义一致）。写入失败（无剪贴板 API/无权限等）静默忽略，
   * 内部剪贴板仍可用作兜底（剪贴板为空不派发 paste 事件时由 keydown 兜底粘贴）。
   *
   * @param nodeId 节点 id
   */
  function copyNode(nodeId: string): void {
    const node = data.value.nodes.find((n) => n.id === nodeId)
    if (!node) return
    clipboard.value = JSON.parse(JSON.stringify(node)) as CanvasNodeData
    try {
      void navigator.clipboard?.writeText(serializeNodeClipboard(clipboard.value))?.catch(() => {})
    } catch {
      // 剪贴板 API 不可用（非安全上下文等）：静默降级为仅内部剪贴板
    }
  }

  /**
   * 粘贴剪贴板节点（偏移 30px），生成全新 id。
   * 可传入外部节点源（如从系统剪贴板标记解析出的节点，支持跨画布/刷新后粘贴）：
   * 未传入时使用内部剪贴板内容。
   *
   * @param source 外部节点源（缺省用内部剪贴板）
   * @returns 新节点或 undefined（无可粘贴内容）
   */
  function pasteNode(source?: CanvasNodeData): CanvasNodeData | undefined {
    const base = source ?? clipboard.value
    if (!base) return undefined
    const copy = JSON.parse(JSON.stringify(base)) as CanvasNodeData
    copy.id = newId()
    copy.x += 30
    copy.y += 30
    pushHistory()
    data.value.nodes.push(copy)
    markDirty()
    return copy
  }

  /**
   * 批量应用新增节点与连线（自动搭画布结果）。
   * 一次性压入撤销快照并置脏保存。
   *
   * @param newNodes 新增节点列表
   * @param newConnections 新增连线列表
   */
  function applyNodes(newNodes: CanvasNodeData[], newConnections: CanvasConnection[]): void {
    if (newNodes.length === 0 && newConnections.length === 0) return
    pushHistory()
    data.value.nodes.push(...newNodes)
    data.value.connections.push(...newConnections)
    markDirty()
  }

  /**
   * 更新生成视频节点导演台音频轨中指定来源节点的素材块时长（连线后按真实时长回填）。
   *
   * 不 pushHistory：这是 connect 操作的异步补全（connect 已在结构变更前快照），
   * 单次撤销即可同时回退「连线 + 时长回填」；redo 会把时长还原为占位值，属可接受边缘。
   * 未找到节点/导演台配置/匹配音频块，或时长无变化时不做任何修改（幂等）。
   *
   * @param nodeId 生成视频节点 id
   * @param sourceNodeId 音频来源节点 id（audio-loader）
   * @param duration 音频真实时长（秒）
   */
  function updateDirectorAudioClipDuration(nodeId: string, sourceNodeId: string, duration: number): void {
    const node = data.value.nodes.find((n) => n.id === nodeId)
    if (!node || node.prototypeId !== 'video-generate') return
    const director = node.config.director
    if (!director || typeof director !== 'object') return
    const d = director as Partial<CanvasDirectorConfig>
    const audioClips = d.audioClips ?? []
    const clip = audioClips.find((c) => c.sourceNodeId === sourceNodeId)
    if (!clip || Math.abs(clip.duration - duration) < 0.01) return
    node.config = {
      ...node.config,
      director: {
        ...d,
        audioClips: audioClips.map((c) =>
          c.sourceNodeId === sourceNodeId ? { ...c, duration } : c,
        ),
      },
    }
    markDirty()
  }

  /**
   * 切换画布目标（如切换分镜/场景）：先落盘当前未保存修改，再重置全部状态并加载新画布。
   *
   * @param newTarget 新画布目标
   */
  async function switchTarget(newTarget: CanvasTarget): Promise<void> {
    // 先取消待执行的防抖保存，并把当前画布未保存的修改落盘（此刻仍指向旧目标）
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (dirty.value) {
      try {
        await save()
      } catch {
        // 保存失败不阻塞切换
      }
    }
    targetRef.value = { ...newTarget }
    data.value = createCanvasData(targetRef.value.kind)
    historyPast.value = []
    historyFuture.value = []
    clipboard.value = null
    dirty.value = false
    saving.value = false
    error.value = null
    loaded.value = false
    await load()
  }

  return {
    data,
    loaded,
    dirty,
    saving,
    error,
    nodes,
    connections,
    load,
    save,
    addNode,
    removeNode,
    updateNode,
    updateDirectorAudioClipDuration,
    removeInputOrderEntry,
    connect,
    disconnect,
    onConnectionsChanged,
    historyPast,
    historyFuture,
    canUndo,
    canRedo,
    undo,
    redo,
    clipboard,
    canPaste,
    copyNode,
    pasteNode,
    applyNodes,
    switchTarget,
  }
}
