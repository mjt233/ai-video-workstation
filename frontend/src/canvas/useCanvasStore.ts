import { computed, ref } from 'vue'
import { createCanvasData, newId, type CanvasConnection, type CanvasData, type CanvasNodeData } from './types'
import { loadCanvas, saveCanvas, type CanvasTarget } from './api'
import { canConnectNodes, getNodeInputPortId, getNodeOutputPortId } from './connection'
import { getPrototype } from './registry'

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
  const data = ref<CanvasData>(createCanvasData(target.kind))
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

  /** 加载画布；不存在时保持空画布 */
  async function load(): Promise<void> {
    const existing = await loadCanvas(project, target)
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
      await saveCanvas(project, target, data.value)
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
   * @returns 新节点
   * @throws Error 未知原型时
   */
  function addNode(prototypeId: string, x: number, y: number): CanvasNodeData {
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
      config: {},
    }
    pushHistory()
    data.value.nodes.push(node)
    markDirty()
    return node
  }

  /**
   * 删除节点及其所有连线。
   *
   * @param nodeId 节点 id
   */
  function removeNode(nodeId: string): void {
    pushHistory()
    data.value.nodes = data.value.nodes.filter((n) => n.id !== nodeId)
    data.value.connections = data.value.connections.filter((c) => c.fromNodeId !== nodeId && c.toNodeId !== nodeId)
    markDirty()
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
   * 建立连线（自动校验类型兼容与防循环）。
   *
   * @param fromNodeId 输出节点 id
   * @param toNodeId 输入节点 id
   * @returns 成功建立返回 true
   */
  function connect(fromNodeId: string, toNodeId: string): boolean {
    if (!canConnectNodes(data.value.connections, fromNodeId, toNodeId, data.value.nodes)) {
      return false
    }
    const connection: CanvasConnection = {
      id: newId(),
      fromNodeId,
      fromPortId: getNodeOutputPortId(fromNodeId, data.value.nodes) ?? 'out',
      toNodeId,
      toPortId: getNodeInputPortId(toNodeId, data.value.nodes) ?? 'in',
    }
    pushHistory()
    data.value.connections.push(connection)
    markDirty()
    return true
  }

  /**
   * 断开连线。
   *
   * @param connectionId 连线 id
   */
  function disconnect(connectionId: string): void {
    pushHistory()
    data.value.connections = data.value.connections.filter((c) => c.id !== connectionId)
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
   * 复制节点到内部剪贴板。
   *
   * @param nodeId 节点 id
   */
  function copyNode(nodeId: string): void {
    const node = data.value.nodes.find((n) => n.id === nodeId)
    if (!node) return
    clipboard.value = JSON.parse(JSON.stringify(node)) as CanvasNodeData
  }

  /**
   * 粘贴剪贴板节点（偏移 30px）。
   *
   * @returns 新节点或 undefined
   */
  function pasteNode(): CanvasNodeData | undefined {
    if (!clipboard.value) return undefined
    const copy = JSON.parse(JSON.stringify(clipboard.value)) as CanvasNodeData
    copy.id = newId()
    copy.x += 30
    copy.y += 30
    pushHistory()
    data.value.nodes.push(copy)
    markDirty()
    return copy
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
    connect,
    disconnect,
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
  }
}
