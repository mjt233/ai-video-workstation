import { computed, ref } from 'vue'
import { createCanvasData, newId, type CanvasConnection, type CanvasData, type CanvasNodeData } from './types'
import { loadCanvas, saveCanvas, type CanvasTarget } from './api'
import { canConnectNodes, getNodeInputPortId, getNodeOutputPortId } from './connection'
import { getPrototype } from './registry'

/** 自动保存防抖毫秒数 */
const SAVE_DEBOUNCE_MS = 800

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
    data.value.connections = data.value.connections.filter((c) => c.id !== connectionId)
    markDirty()
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
  }
}
