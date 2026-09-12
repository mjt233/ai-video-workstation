import { computed, ref } from 'vue'
import { createCanvasData, newId, type CanvasConnection, type CanvasData, type CanvasGroupData, type CanvasNodeData, type NodeConfig } from './types'
import { loadCanvas, saveCanvas, CanvasVersionError, type CanvasTarget } from './api'
import { canConnect, canConnectNodes, getNodeInputPortId, getNodeOutputPortId } from './connection'
import { getPrototype } from './registry'
import { applyConnectionSync } from './connectionSync'
import { serializeNodeClipboard, type NodeClipboardPayload } from './nodeClipboard'
import { clipboardPlacementOffset, instantiateClipboard } from './pastePlacement'
import { DEFAULT_GROUP_COLOR, defaultGroupName, type RectLike } from './groups'
import type { CanvasDirectorConfig } from './videoTypes'

/** 自动保存防抖毫秒数 */
const SAVE_DEBOUNCE_MS = 800

/** 节点默认尺寸：原型未声明 defaultSize 时的兜底值 */
export const DEFAULT_NODE_SIZE = { width: 240, height: 160 }

/** 撤销/重做历史栈容量上限 */
const HISTORY_LIMIT = 50

/** 群组连接忽略原因 */
export type GroupConnectSkipReason = 'incompatible' | 'cycle' | 'in-group' | 'duplicate'

/** 群组连接结果：成功连接与忽略清单 */
export interface GroupConnectResult {
  /** 成功建立连接的源节点 id 列表 */
  connected: string[]
  /** 被忽略的源节点（原因见 GroupConnectSkipReason） */
  skipped: { nodeId: string; reason: GroupConnectSkipReason }[]
}

/** 连线改接忽略原因（与群组连接共用分类：转移/复制场景不会出现 in-group） */
export type RewireSkipReason = GroupConnectSkipReason

/** 连线改接结果：成功建立的新连线与被忽略项清单 */
export interface RewireResult {
  /** 成功建立的新连线列表（按传入顺序，供调用方做后续联动与文案） */
  connected: CanvasConnection[]
  /** 被忽略的改接项（原因见 RewireSkipReason） */
  skipped: { fromNodeId: string; toNodeId: string; reason: RewireSkipReason }[]
}

/** 单条连线改接描述（端点字段缺省时沿用原连线；输入端起点覆盖目标端，输出端起点覆盖来源端） */
export interface RewireItem {
  /** 原连线 id（改接基准；removeSource=true 时该连线将被移除） */
  connectionId: string
  /** 新连线的输出节点 id（缺省沿用原连线的输出节点） */
  fromNodeId?: string
  /** 新连线的输出端口 id（缺省沿用原连线的输出端口） */
  fromPortId?: string
  /** 新连线的输入节点 id（缺省沿用原连线的输入节点） */
  toNodeId?: string
  /** 新连线的输入端口 id（缺省沿用原连线的输入端口） */
  toPortId?: string
}

/** 连线改接参数 */
export interface RewireOptions {
  /** true=连接转移（移除原连线）；false=连接复制（保留原连线，仅新增） */
  removeSource: boolean
  /** 改接项列表（顺序即新连线的建立顺序，保证「按原顺序」转移） */
  items: RewireItem[]
}

/**
 * 画布持久化适配器（可注入）。
 *
 * 缺省实现 = 现有画布定义读写（`loadCanvas` / `saveCanvas`，按 project + target 定位 canvas.json）；
 * 蓝图编辑器（`AssetCanvas` mode='blueprint'）注入蓝图适配器，把同一套 store 能力
 * （增删改查 / 撤销重做 / 剪贴板 / CAS 保存）复用到蓝图文件上。
 */
export interface CanvasPersistence {
  /**
   * 读取数据（不存在返回 null）。
   *
   * @returns 画布数据（可只含 nodes/connections/groups，缺省字段由 store 兜底）与版本号
   */
  load(): Promise<{ canvas: Partial<CanvasData>; rev: number } | null>
  /**
   * CAS 保存。
   *
   * @param canvas 画布数据（含 nodes/connections/groups 等）
   * @param opts 版本选项（expectedRev / force）
   * @returns 保存后的版本号
   */
  save(canvas: CanvasData, opts: { expectedRev: number; force?: boolean }): Promise<{ rev: number }>
}

/**
 * useCanvasStore 选项。
 */
export interface UseCanvasStoreOptions {
  /**
   * 是否启用防抖自动保存（缺省 `true`）。
   *
   * 设为 `false` 时（蓝图编辑器「手动保存」模式）：结构改动只置脏（`dirty=true`）
   * 并更新内存数据，**不排定任何落盘**，须由调用方在用户点击「保存」时显式 `save()`；
   * 关闭编辑器时未保存的改动随组件卸载丢弃。
   */
  autoSave?: boolean
}

/**
 * 画布状态管理：加载/保存（防抖自动保存）、节点与连线的增删改查、连接校验。
 *
 * @param project 项目名
 * @param target 画布目标
 * @param persistence 持久化适配器（缺省为画布定义文件；蓝图模式注入蓝图适配器）
 * @param options 选项（`autoSave: false` = 手动保存模式，见 UseCanvasStoreOptions）
 */
export function useCanvasStore(
  project: string,
  target: CanvasTarget,
  persistence?: CanvasPersistence,
  options: UseCanvasStoreOptions = {},
) {
  /** 是否自动保存（false = 手动保存模式：markDirty 只置脏、不排定落盘） */
  const autoSave = options.autoSave !== false
  /** 当前画布目标（切换分镜/场景时通过 switchTarget 更新） */
  const targetRef = ref<CanvasTarget>({ ...target })
  const data = ref<CanvasData>(createCanvasData(targetRef.value.kind))
  const loaded = ref(false)
  const dirty = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  /** 最近一次成功保存/加载的画布版本号（rev；自动保存的 CAS 基准） */
  const savedRev = ref(0)
  /**
   * 保存版本冲突状态（服务端 409 VERSION_CONFLICT）：
   * 非空表示"当前画布已被他人或引用更新"，自动保存已停止，须用户决定
   * 备份/强制覆盖/重新加载后才会清除。
   */
  const conflict = ref<{ currentRev: number; expectedRev: number } | null>(null)

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  /** 撤销历史栈（快照） */
  const historyPast = ref<CanvasData[]>([])
  /** 重做历史栈（快照） */
  const historyFuture = ref<CanvasData[]>([])

  const nodes = computed(() => data.value.nodes)
  const connections = computed(() => data.value.connections)
  /** 持久分组列表（canvas.json groups[]；成员关系由几何重叠实时派生，不在此维护） */
  const groups = computed(() => data.value.groups ?? [])

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

  /**
   * 加载画布；不存在时保持空画布（并把版本号归零）。
   * 刷新版本号会同步清除冲突状态（加载到的即服务端最新版本）。
   *
   * 注入持久化适配器（蓝图模式）时，适配器返回的数据可只含 nodes/connections/groups，
   * 其余字段由 createCanvasData 兜底补全。
   */
  async function load(): Promise<void> {
    const existing = persistence ? await persistence.load() : await loadCanvas(project, targetRef.value)
    if (existing) {
      const base = createCanvasData(targetRef.value.kind)
      // groups 兜底：正常路径由 migrateCanvasData 保证存在（schema v2），此处防御非迁移来源的数据
      data.value = {
        ...base,
        ...existing.canvas,
        kind: targetRef.value.kind,
        nodes: existing.canvas.nodes ?? [],
        connections: existing.canvas.connections ?? [],
        groups: existing.canvas.groups ?? [],
      }
      savedRev.value = existing.rev
    } else {
      data.value = createCanvasData(targetRef.value.kind)
      savedRev.value = 0
    }
    conflict.value = null
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
    // 手动保存模式（蓝图编辑器）：不排定防抖保存，等待用户点击「保存」/Ctrl+S
    if (!autoSave) return
    // 版本冲突期间停止自动保存：保留本地修改，等待用户决定（备份/强制覆盖/重新加载）
    if (conflict.value) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void save()
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * CAS 保存画布定义（自动保存 / 切换前落盘 / 手动保存共用）。
   *
   * @returns true = 保存成功（或无冲突）；false = 失败（版本冲突 or 其它错误，
   *   冲突详情见 conflict，其它错误见 error）
   */
  async function save(): Promise<boolean> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (conflict.value) return false
    saving.value = true
    try {
      const res = persistence
        ? await persistence.save(data.value, { expectedRev: savedRev.value })
        : await saveCanvas(project, targetRef.value, data.value, { expectedRev: savedRev.value })
      savedRev.value = res.rev
      dirty.value = false
      conflict.value = null
      return true
    } catch (e) {
      if (e instanceof CanvasVersionError) {
        conflict.value = { currentRev: e.currentRev, expectedRev: e.expectedRev }
        dirty.value = true
      } else {
        error.value = e instanceof Error ? e.message : String(e)
      }
      return false
    } finally {
      saving.value = false
    }
  }

  /**
   * 强制覆盖保存（仅用户输入「确认覆盖」后调用）：跳过版本比对，rev 仍由后端递增。
   * 成功后清除冲突状态并继续正常自动保存。
   *
   * @returns true = 保存成功
   */
  async function forceSave(): Promise<boolean> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    saving.value = true
    try {
      const res = persistence
        ? await persistence.save(data.value, {
            expectedRev: conflict.value?.expectedRev ?? savedRev.value,
            force: true,
          })
        : await saveCanvas(project, targetRef.value, data.value, {
            expectedRev: conflict.value?.expectedRev ?? savedRev.value,
            force: true,
          })
      savedRev.value = res.rev
      dirty.value = false
      conflict.value = null
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      saving.value = false
    }
  }

  /**
   * 重新加载服务端最新版本（放弃本地未保存修改；调用方必须先经用户确认）。
   * 清空撤销历史与冲突状态。
   */
  async function reloadFromServer(): Promise<void> {
    await load()
    historyPast.value = []
    historyFuture.value = []
    dirty.value = false
    error.value = null
  }

  /**
   * 添加节点。
   *
   * @param prototypeId 节点原型 id
   * @param x 画布 x 坐标
   * @param y 画布 y 坐标
   * @param configPatch 初始配置补丁（合并到原型 defaultConfig 之上；如粘贴资产时写入 assetPath、粘贴文本时写入 text）
   * @param opts 附加选项：name 为创建时的节点名称（缺省使用原型名称；与创建同一次撤销）
   * @returns 新节点
   * @throws Error 未知原型时
   */
  function addNode(
    prototypeId: string,
    x: number,
    y: number,
    configPatch?: NodeConfig,
    opts?: { name?: string },
  ): CanvasNodeData {
    const proto = getPrototype(prototypeId)
    if (!proto) throw new Error(`未知节点类型: ${prototypeId}`)
    const node: CanvasNodeData = {
      id: newId(),
      prototypeId,
      name: opts?.name ?? proto.name,
      x,
      y,
      width: proto.defaultSize?.width ?? DEFAULT_NODE_SIZE.width,
      height: proto.defaultSize?.height ?? DEFAULT_NODE_SIZE.height,
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
   * 静默更新节点 config（不入撤销栈，仅修改 + 触发防抖保存）。
   *
   * 供高频流式更新使用（如 AI 文本生成节点的流式输出写入 config.output）：
   * 每次增量不入撤销历史，避免流式期间产生大量撤销快照；流结束时由调用方
   * 追加一次正常 updateNode 提交（单次撤销可回退到生成前状态）。
   *
   * @param nodeId 节点 id
   * @param configPatch 配置补丁（合并写入节点 config）
   */
  function updateNodeQuiet(nodeId: string, configPatch: Record<string, unknown>): void {
    const node = data.value.nodes.find((n) => n.id === nodeId)
    if (!node) return
    node.config = { ...node.config, ...configPatch }
    markDirty()
  }

  /**
   * 纯内存视图补丁（AI 文本节点流式期间显示用）：
   * 合并进节点 config，但**不入撤销栈、不置脏、不触发保存**。
   *
   * 流式期间的内容仅内存显示（下游文本消费者读取同一 store 数据，保持实时联动）；
   * 终态由后端一次性落盘（result-persist），前端经 adoptExternalChange 做视图同步。
   *
   * @param nodeId 节点 id
   * @param configPatch 配置补丁（合并写入节点 config）
   */
  function viewOnlyUpdate(nodeId: string, configPatch: Record<string, unknown>): void {
    const node = data.value.nodes.find((n) => n.id === nodeId)
    if (!node) return
    node.config = { ...node.config, ...configPatch }
  }

  /**
   * 终态视图同步（AI 文本节点完成后的 adopt）：合并后端已落盘的补丁
   * （config.output / outputHistory）+ 入撤销栈（保持「单次撤销可回退到生成前
   * 状态」语义）+ savedRev 对齐服务端新 rev。
   *
   * **不触发写盘**：内容已在画布定义文件中（后端终态已写），仅做内存同步。
   *
   * @param nodeId 节点 id
   * @param configPatch 终态补丁（后端持久化的 output/outputHistory 原值）
   * @param newRev 服务端写入后的新版本号（savedRev 对齐基准）
   */
  function adoptExternalChange(nodeId: string, configPatch: Record<string, unknown>, newRev: number): void {
    const node = data.value.nodes.find((n) => n.id === nodeId)
    if (!node) return
    pushHistory()
    node.config = { ...node.config, ...configPatch }
    savedRev.value = newRev
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

  /**
   * 向节点 config.inputOrder 末尾追加来源节点 id（连线改接后的目标端顺序同步）。
   *
   * 不 pushHistory：这是 rewireConnections 的配套清理（整个改接操作已在结构变更前
   * 快照一次），单次撤销即可同时回退「连线 + inputOrder」。已存在的 id 会先从原位置
   * 移除再统一追加到末尾，保证追加项之间的相对顺序与传入顺序一致且不产生重复条目；
   * 节点不存在或 ids 为空时不做任何修改（幂等）。
   *
   * @param nodeId 目标节点 id
   * @param ids 追加的来源节点 id 列表（顺序即期望的输入顺序）
   */
  function appendInputOrderEntries(nodeId: string, ids: string[]): void {
    if (ids.length === 0) return
    const node = data.value.nodes.find((n) => n.id === nodeId)
    if (!node) return
    const order = Array.isArray(node.config.inputOrder) ? ([...node.config.inputOrder] as string[]) : []
    const idSet = new Set(ids)
    node.config = {
      ...node.config,
      inputOrder: [...order.filter((id) => !idSet.has(id)), ...ids],
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

  /** 复制剪贴板内容（节点列表 + 组内连线） */
  const clipboard = ref<NodeClipboardPayload | null>(null)

  /** 是否可粘贴（节点或分组任一非空即可） */
  const canPaste = computed(
    () => clipboard.value !== null && (clipboard.value.nodes.length > 0 || clipboard.value.groups.length > 0),
  )

  /**
   * 复制节点（可同时复制分组框）到内部剪贴板，并同步写入系统剪贴板（标记前缀 + JSON）。
   *
   * 写入系统剪贴板的目的：让 Ctrl+V 的全局 paste 事件能优先识别节点复制标记
   * 并粘贴节点，而不被剪贴板中残留的旧文本/文件抢占（复制节点会覆盖系统剪贴板，
   * 与主流节点编辑器的复制语义一致）。写入失败（无剪贴板 API/无权限等）静默忽略，
   * 内部剪贴板仍可用作兜底（剪贴板为空不派发 paste 事件时由 keydown 兜底粘贴）。
   *
   * @param nodeIds 复制的节点 id 列表（组内连线 = 两端都在列表中的连线）
   * @param groupIds 同时复制的分组 id 列表（缺省为空：只复制节点）
   */
  function copyNodes(nodeIds: string[], groupIds: string[] = []): void {
    const idSet = new Set(nodeIds)
    const groupIdSet = new Set(groupIds)
    const nodes = data.value.nodes
      .filter((n) => idSet.has(n.id))
      .map((n) => JSON.parse(JSON.stringify(n)) as CanvasNodeData)
    const groups = (data.value.groups ?? [])
      .filter((g) => groupIdSet.has(g.id))
      .map((g) => JSON.parse(JSON.stringify(g)) as CanvasGroupData)
    if (nodes.length === 0 && groups.length === 0) return
    const connections = data.value.connections
      .filter((c) => idSet.has(c.fromNodeId) && idSet.has(c.toNodeId))
      .map((c) => JSON.parse(JSON.stringify(c)) as CanvasConnection)
    clipboard.value = { nodes, connections, groups }
    try {
      void navigator.clipboard?.writeText(serializeNodeClipboard(nodes, connections, groups))?.catch(() => {})
    } catch {
      // 剪贴板 API 不可用（非安全上下文等）：静默降级为仅内部剪贴板
    }
  }

  /**
   * 复制单个节点（兼容旧调用方：等价 copyNodes([nodeId])）。
   *
   * @param nodeId 节点 id
   */
  function copyNode(nodeId: string): void {
    copyNodes([nodeId])
  }

  /**
   * 粘贴剪贴板内容（节点 + 分组），生成全新 id 并按落点算法平移。
   *
   * 落点由 `pastePlacement.ts: clipboardPlacementOffset` 计算，按载荷是否含分组分流：
   * - **不含分组**（纯节点复制）→ 沿用历史行为：相对原位置固定偏移 30px，不做避让；
   * - **含分组** → 以「原内容右下方向外一个身位 + 30px 间隙」为首选，被画布已有内容占据时
   *   向右探测（再换泳道），保证**副本包围盒与画布已有任何节点/分组矩形零重叠且留有净距**。
   *   这是硬约束而非美观要求——分组成员关系由几何重叠实时派生（`groups.ts: rectsOverlap`），
   *   副本分组一旦压住原件，拖动任一分组都会把对方的节点一起带走（历史固定 30px 偏移的故障根因）。
   *
   * 其余处理：节点/连线/分组 id 全部更换、config 内节点引用重映射（`instantiateClipboard`）、
   * 组内连线按新 id 重建并逐条触发 connect 联动（connectionSync，与手动连线行为一致）。
   * 可传入外部载荷（如从系统剪贴板标记解析出的，支持跨画布/刷新后粘贴）：
   * 未传入时使用内部剪贴板内容。
   *
   * @param source 外部复制载荷（缺省用内部剪贴板）
   * @returns 新节点列表、新分组列表（均可能为空）与「落点是否被探测挪动过」标记（供提示文案使用）
   */
  function pasteNodes(source?: NodeClipboardPayload): {
    nodes: CanvasNodeData[]
    groups: CanvasGroupData[]
    cascaded: boolean
  } {
    const base = source ?? clipboard.value
    if (!base || (base.nodes.length === 0 && base.groups.length === 0)) return { nodes: [], groups: [], cascaded: false }
    const placement = clipboardPlacementOffset(base, {
      nodes: data.value.nodes,
      groups: data.value.groups ?? [],
    })
    const { payload } = instantiateClipboard(base, placement.offset)
    const { nodes, groups, connections } = payload
    pushHistory()
    data.value.nodes.push(...nodes)
    data.value.connections.push(...connections)
    if (groups.length > 0) data.value.groups = [...(data.value.groups ?? []), ...groups]
    markDirty()
    for (const connection of connections) {
      emitConnectionsChanged({ type: 'connect', connection })
    }
    return { nodes, groups, cascaded: placement.cascaded }
  }

  /**
   * 粘贴单个节点（兼容旧调用方：等价 pasteNodes(source).nodes 的第一项）。
   * 分组不被此入口粘贴（单节点语义）。
   *
   * @param source 外部节点源（缺省用内部剪贴板的第一项，均为单节点场景）
   * @returns 新节点或 undefined（无可粘贴内容）
   */
  function pasteNode(source?: CanvasNodeData): CanvasNodeData | undefined {
    const payload: NodeClipboardPayload | undefined = source
      ? { nodes: [source], connections: [], groups: [] }
      : (clipboard.value ?? undefined)
    return pasteNodes(payload).nodes[0]
  }

  /**
   * 原子写入一批实体（节点 + 连线 + 分组），**单次撤销快照**。
   *
   * 供「插入蓝图」使用：内容由 `canvas/blueprint.ts: instantiateBlueprint` 生成
   * （节点/连线/分组已换新 id、坐标已按插入点归一化），本方法只负责一次性落库；
   * 连线逐条触发 connect 联动（与 pasteNodes 一致，使 connectionSync 的节点级联动生效）。
   *
   * @param payload 内容载荷（id 须已重映射，坐标为最终坐标）
   */
  function applyEntities(payload: {
    nodes?: CanvasNodeData[]
    connections?: CanvasConnection[]
    groups?: CanvasGroupData[]
  }): void {
    const nodes = payload.nodes ?? []
    const connections = payload.connections ?? []
    const groups = payload.groups ?? []
    if (nodes.length === 0 && connections.length === 0 && groups.length === 0) return
    pushHistory()
    if (nodes.length > 0) data.value.nodes.push(...nodes)
    if (connections.length > 0) data.value.connections.push(...connections)
    if (groups.length > 0) data.value.groups = [...(data.value.groups ?? []), ...groups]
    markDirty()
    for (const connection of connections) {
      emitConnectionsChanged({ type: 'connect', connection })
    }
  }

  /**
   * 批量更新节点位置（整组移动：单次撤销快照）。
   *
   * @param patches 节点位置补丁列表
   */
  function updateNodes(patches: { id: string; x: number; y: number }[]): void {
    const valid = patches.filter((p) => data.value.nodes.some((n) => n.id === p.id))
    if (valid.length === 0) return
    pushHistory()
    for (const p of valid) {
      const node = data.value.nodes.find((n) => n.id === p.id)
      if (!node) continue
      node.x = Math.round(p.x)
      node.y = Math.round(p.y)
    }
    markDirty()
  }

  /**
   * 批量移动节点与分组（**单次撤销快照**）。
   *
   * 用于两类场景（拖动过程中仅做视图跟随，结束才调用本方法一次性回写）：
   * - 拖动分组（R2 跟随集：分组 + 组内节点一起平移）；
   * - 多选拖动节点时选中分组框同步跟随。
   *
   * @param nodePatches 节点位置补丁列表
   * @param groupPatches 分组位置补丁列表
   */
  function moveEntities(
    nodePatches: { id: string; x: number; y: number }[],
    groupPatches: { id: string; x: number; y: number }[],
  ): void {
    const validNodes = nodePatches.filter((p) => data.value.nodes.some((n) => n.id === p.id))
    const validGroups = groupPatches.filter((p) => (data.value.groups ?? []).some((g) => g.id === p.id))
    if (validNodes.length === 0 && validGroups.length === 0) return
    pushHistory()
    for (const p of validNodes) {
      const node = data.value.nodes.find((n) => n.id === p.id)
      if (!node) continue
      node.x = Math.round(p.x)
      node.y = Math.round(p.y)
    }
    for (const p of validGroups) {
      const group = data.value.groups.find((g) => g.id === p.id)
      if (!group) continue
      group.x = Math.round(p.x)
      group.y = Math.round(p.y)
    }
    markDirty()
  }

  // ── 持久分组（canvas.json groups[]；成员由几何重叠实时派生）──────

  /**
   * 创建持久分组（单次撤销）。
   *
   * @param rect 分组矩形（流坐标；通常由 groupRectFromNodes 按选中节点包围盒计算）
   * @param opts 可选覆盖：name 标题（缺省 `分组 N`）、color 主题色（缺省色板首色）
   * @returns 新分组
   */
  function addGroup(rect: RectLike, opts?: { name?: string; color?: string }): CanvasGroupData {
    const group: CanvasGroupData = {
      id: newId(),
      name: opts?.name ?? defaultGroupName(data.value.groups ?? []),
      color: opts?.color ?? DEFAULT_GROUP_COLOR,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
    pushHistory()
    data.value.groups = [...(data.value.groups ?? []), group]
    markDirty()
    return group
  }

  /**
   * 更新单个分组（标题 / 颜色 / 几何；单次撤销）。
   *
   * @param groupId 分组 id
   * @param patch 更新字段（id 不可改）
   */
  function updateGroup(groupId: string, patch: Partial<Omit<CanvasGroupData, 'id'>>): void {
    const group = (data.value.groups ?? []).find((g) => g.id === groupId)
    if (!group) return
    pushHistory()
    Object.assign(group, patch)
    markDirty()
  }

  /**
   * 批量更新分组位置（拖动分组 / 多选拖动跟随：单次撤销快照）。
   *
   * @param patches 分组位置补丁列表
   */
  function updateGroups(patches: { id: string; x: number; y: number }[]): void {
    const valid = patches.filter((p) => (data.value.groups ?? []).some((g) => g.id === p.id))
    if (valid.length === 0) return
    pushHistory()
    for (const p of valid) {
      const group = data.value.groups.find((g) => g.id === p.id)
      if (!group) continue
      group.x = Math.round(p.x)
      group.y = Math.round(p.y)
    }
    markDirty()
  }

  /**
   * 解散分组（仅删除分组框，组内节点保留；单次撤销）。
   *
   * @param groupIds 要解散的分组 id 列表
   */
  function removeGroups(groupIds: string[]): void {
    const idSet = new Set(groupIds)
    if (idSet.size === 0) return
    const exists = (data.value.groups ?? []).some((g) => idSet.has(g.id))
    if (!exists) return
    pushHistory()
    data.value.groups = data.value.groups.filter((g) => !idSet.has(g.id))
    markDirty()
  }

  /**
   * 批量删除节点及其全部连线，并可同时解散若干分组（单次撤销快照；
   * 连带断开的连线触发 disconnect 联动）。混合选中（节点 + 分组）的删除走此入口。
   *
   * @param nodeIds 删除的节点 id 列表
   * @param groupIds 同时解散的分组 id 列表（缺省为空：只删节点）
   */
  function removeNodes(nodeIds: string[], groupIds: string[] = []): void {
    const idSet = new Set(nodeIds)
    const groupIdSet = new Set(groupIds)
    if (idSet.size === 0 && groupIdSet.size === 0) return
    const removed = data.value.connections.filter((c) => idSet.has(c.fromNodeId) || idSet.has(c.toNodeId))
    pushHistory()
    data.value.nodes = data.value.nodes.filter((n) => !idSet.has(n.id))
    data.value.connections = data.value.connections.filter((c) => !idSet.has(c.fromNodeId) && !idSet.has(c.toNodeId))
    if (groupIdSet.size > 0) {
      data.value.groups = (data.value.groups ?? []).filter((g) => !groupIdSet.has(g.id))
    }
    markDirty()
    for (const connection of removed) {
      emitConnectionsChanged({ type: 'disconnect', connection })
    }
  }

  /**
   * 群组连接：把多个源节点的输出全部连接到目标节点输入口。
   * 逐源校验（类型兼容/成环/目标在组内/重复连线），成功者批量建立（单次撤销快照），
   * 失败者记录原因并忽略。
   *
   * @param targetNodeId 目标节点 id
   * @param sourceIds 源节点 id 列表
   * @returns 连接结果（成功列表 + 忽略清单）
   */
  function connectGroupToNode(targetNodeId: string, sourceIds: string[]): GroupConnectResult {
    const target = data.value.nodes.find((n) => n.id === targetNodeId)
    if (!target) {
      return { connected: [], skipped: sourceIds.map((nodeId) => ({ nodeId, reason: 'incompatible' as const })) }
    }
    pushHistory()
    const result = performGroupConnect(targetNodeId, sourceIds)
    if (result.connected.length > 0) markDirty()
    return result
  }

  /**
   * 在指定位置创建节点并连接全部兼容源节点（成组连接菜单路径：单次撤销快照）。
   * 与 connectGroupToNode 同一套校验/忽略规则；节点先加入数据再逐源校验（目标输入端口存在）。
   *
   * @param prototypeId 节点原型 id
   * @param x 节点流坐标 x（左缘对齐释放点）
   * @param y 节点流坐标 y（垂直中心对齐释放点）
   * @param sourceIds 源节点 id 列表
   * @returns 新节点与连接结果
   * @throws Error 未知原型时
   */
  function createNodeAndConnect(
    prototypeId: string,
    x: number,
    y: number,
    sourceIds: string[],
  ): { node: CanvasNodeData; result: GroupConnectResult } {
    const proto = getPrototype(prototypeId)
    if (!proto) throw new Error(`未知节点类型: ${prototypeId}`)
    const node: CanvasNodeData = {
      id: newId(),
      prototypeId,
      name: proto.name,
      x: Math.round(x),
      y: Math.round(y),
      width: proto.defaultSize?.width ?? DEFAULT_NODE_SIZE.width,
      height: proto.defaultSize?.height ?? DEFAULT_NODE_SIZE.height,
      config: {
        ...(proto.defaultConfig ? JSON.parse(JSON.stringify(proto.defaultConfig)) : {}),
      },
    }
    pushHistory()
    data.value.nodes.push(node)
    const result = performGroupConnect(node.id, sourceIds)
    markDirty()
    return { node, result }
  }

  /**
   * 执行群组连接：逐源校验 → 批量建线 → 逐条触发 connect 联动。
   * 不自行压撤销栈（connectGroupToNode/createNodeAndConnect 已快照）。
   *
   * @param targetNodeId 目标节点 id
   * @param sourceIds 源节点 id 列表
   * @returns 连接结果
   */
  function performGroupConnect(targetNodeId: string, sourceIds: string[]): GroupConnectResult {
    const targetInGroup = sourceIds.includes(targetNodeId)
    const toPortId = getNodeInputPortId(targetNodeId, data.value.nodes) ?? 'in'
    const connected: CanvasConnection[] = []
    const skipped: GroupConnectResult['skipped'] = []
    for (const sourceId of sourceIds) {
      const source = data.value.nodes.find((n) => n.id === sourceId)
      if (!source) continue
      if (targetInGroup) {
        skipped.push({ nodeId: sourceId, reason: 'in-group' })
        continue
      }
      const fromPortId = getNodeOutputPortId(sourceId, data.value.nodes) ?? 'out'
      if (data.value.connections.some(
        (c) => c.fromNodeId === sourceId && c.fromPortId === fromPortId && c.toNodeId === targetNodeId && c.toPortId === toPortId,
      )) {
        skipped.push({ nodeId: sourceId, reason: 'duplicate' })
        continue
      }
      const connection: CanvasConnection = {
        id: newId(),
        fromNodeId: sourceId,
        fromPortId,
        toNodeId: targetNodeId,
        toPortId,
      }
      if (!canConnectNodes(data.value.connections, connection.fromNodeId, connection.toNodeId, data.value.nodes, connection.toPortId)) {
        skipped.push({ nodeId: sourceId, reason: classifyConnectFailure(connection, data.value.nodes) })
        continue
      }
      connected.push(connection)
    }
    if (connected.length > 0) {
      data.value.connections.push(...connected)
      for (const connection of connected) {
        emitConnectionsChanged({ type: 'connect', connection })
      }
    }
    return { connected: connected.map((c) => c.fromNodeId), skipped }
  }

  /**
   * 分类连接校验失败原因（类型不兼容 / 会形成循环）。
   *
   * @param connection 拟建立的连线（端口已解析）
   * @param nodesList 画布全部节点
   * @returns 失败原因
   */
  function classifyConnectFailure(
    connection: CanvasConnection,
    nodesList: CanvasNodeData[],
  ): GroupConnectSkipReason {
    const source = nodesList.find((n) => n.id === connection.fromNodeId)
    const target = nodesList.find((n) => n.id === connection.toNodeId)
    const sourceProto = source ? getPrototype(source.prototypeId) : undefined
    const targetProto = target ? getPrototype(target.prototypeId) : undefined
    const outType = sourceProto?.outputPorts[0]?.type
    const port = targetProto?.inputPorts.find((p) => p.id === connection.toPortId)
    if (outType && port && !canConnect(outType, port.type)) return 'incompatible'
    return 'cycle'
  }

  /**
   * 批量改接连线（连接转移 / 连接复制的统一落点，单次撤销快照）。
   *
   * 每条改接项基于原连线解析新端点（fromNodeId/fromPortId/toNodeId/toPortId 缺省时
   * 沿用原连线对应端点）：输入端起点覆盖目标端（保持来源改去向），输出端起点覆盖
   * 来源端（保持去向改来源）。逐条校验后部分成功：
   * - 节点级重复：同一来源节点对同一目标节点已存在任意连线（含本批次刚建立的）则忽略；
   * - 新旧连线端点完全相同：无意义改接，按重复忽略（避免转移时删了再建）；
   * - 类型不兼容 / 成环：经 canConnectNodes 校验失败，按 classifyConnectFailure 归类忽略。
   *
   * 校验通过后一次性应用：移除原连线（仅转移模式）→ 建立新连线 → 同步两侧
   * config.inputOrder（转移时源端移除条目、目标端按新连线建立顺序追加条目）→
   * 逐条触发 connect/disconnect 联动（applyConnectionSync 同步导演台素材块）。
   * 全部条目被忽略时不做任何变更、不压撤销栈。
   *
   * @param options 改接参数（removeSource 区分转移/复制；items 顺序即新连线顺序）
   * @returns 改接结果（成功连线 + 忽略清单）
   */
  function rewireConnections(options: RewireOptions): RewireResult {
    const { removeSource, items } = options
    const connected: CanvasConnection[] = []
    const skipped: RewireResult['skipped'] = []
    const removals: CanvasConnection[] = []
    /** 本批次已建立连线的「来源→目标」键（同批次内也按节点级去重） */
    const addedKeys = new Set<string>()
    for (const item of items) {
      const original = data.value.connections.find((c) => c.id === item.connectionId)
      // 原连线已不存在（画布被并发修改等竞态）：静默跳过
      if (!original) continue
      const fromNodeId = item.fromNodeId ?? original.fromNodeId
      const fromPortId = item.fromPortId ?? original.fromPortId
      const toNodeId = item.toNodeId ?? original.toNodeId
      const toPortId = item.toPortId ?? original.toPortId
      // 目标与原连线完全相同（同来源同去向）：无意义的改接，按重复忽略（避免转移时删了再建）
      if (
        original.fromNodeId === fromNodeId
        && original.fromPortId === fromPortId
        && original.toNodeId === toNodeId
        && original.toPortId === toPortId
      ) {
        skipped.push({ fromNodeId: original.fromNodeId, toNodeId, reason: 'duplicate' })
        continue
      }
      // 节点级重复：同一来源节点对同一目标节点已存在连线（或本批次已建立）则忽略
      const exists = data.value.connections.some(
        (c) => c.fromNodeId === fromNodeId && c.toNodeId === toNodeId,
      ) || addedKeys.has(`${fromNodeId}→${toNodeId}`)
      if (exists) {
        skipped.push({ fromNodeId, toNodeId, reason: 'duplicate' })
        continue
      }
      const connection: CanvasConnection = {
        id: newId(),
        fromNodeId,
        fromPortId,
        toNodeId,
        toPortId,
      }
      // 校验时把本批次已接受的连线一并纳入（防同批次内经新增连线成环的边缘场景）
      const working = [...data.value.connections, ...connected]
      if (!canConnectNodes(working, connection.fromNodeId, connection.toNodeId, data.value.nodes, connection.toPortId)) {
        skipped.push({
          fromNodeId: connection.fromNodeId,
          toNodeId: connection.toNodeId,
          reason: classifyConnectFailure(connection, data.value.nodes),
        })
        continue
      }
      addedKeys.add(`${connection.fromNodeId}→${connection.toNodeId}`)
      connected.push(connection)
      removals.push(original)
    }
    if (connected.length === 0) return { connected, skipped }
    pushHistory()
    if (removeSource) {
      const removeIds = new Set(removals.map((c) => c.id))
      data.value.connections = data.value.connections.filter((c) => !removeIds.has(c.id))
    }
    data.value.connections.push(...connected)
    if (removeSource) {
      for (const original of removals) {
        removeInputOrderEntry(original.toNodeId, original.fromNodeId)
      }
    }
    const appendByNode = new Map<string, string[]>()
    for (const connection of connected) {
      const list = appendByNode.get(connection.toNodeId) ?? []
      list.push(connection.fromNodeId)
      appendByNode.set(connection.toNodeId, list)
    }
    for (const [nodeId, ids] of appendByNode) {
      appendInputOrderEntries(nodeId, ids)
    }
    markDirty()
    for (const original of removeSource ? removals : []) {
      emitConnectionsChanged({ type: 'disconnect', connection: original })
    }
    for (const connection of connected) {
      emitConnectionsChanged({ type: 'connect', connection })
    }
    return { connected, skipped }
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
   * 同步保存版本号（仅用于「外部部分写入」场景，如蓝图编辑器更新名称/资产项目后）。
   *
   * 该场景下服务端只更新了元信息字段（不涉及 nodes/connections/groups），
   * rev 已递增但本地数据未变，直接对齐版本号即可，避免后续自动保存被误判为冲突。
   * 不触发保存、不置脏。
   *
   * @param rev 服务端最新版本号
   */
  function syncSavedRev(rev: number): void {
    if (Number.isInteger(rev) && rev >= 0) savedRev.value = rev
  }

  /**
   * 切换画布目标（如切换分镜/场景）：先落盘当前未保存修改，再重置全部状态并加载新画布。
   *
   * @param newTarget 新画布目标
   * @param opts.discard 为 true 时跳过保存直接切换（仅切换对话框「放弃本地修改」使用；
   *   此时当前画布必然处于版本冲突态，本地修改将被丢弃）
   * @returns 'ok' = 已切换；'conflict' = 当前画布保存版本冲突，**未切换**、
   *   数据保留原样，由调用方提示用户（强制覆盖后重试 / 放弃修改 / 取消）
   */
  async function switchTarget(
    newTarget: CanvasTarget,
    opts: { discard?: boolean } = {},
  ): Promise<'ok' | 'conflict'> {
    // 目标与当前相同：无需切换（冲突「取消」回退 URL 会再次触发切换请求）
    const cur = targetRef.value
    if (
      cur.kind === newTarget.kind
      && cur.episode === newTarget.episode
      && cur.shot === newTarget.shot
      && cur.stage === newTarget.stage
      && cur.label === newTarget.label
    ) {
      return 'ok'
    }
    // 先取消待执行的防抖保存，并把当前画布未保存的修改落盘（此刻仍指向旧目标）
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!opts.discard && dirty.value) {
      // 非冲突错误不阻塞切换（沿用原行为）；版本冲突则阻止切换，交由调用方提示
      const ok = await save()
      if (!ok && conflict.value) return 'conflict'
    }
    targetRef.value = { ...newTarget }
    data.value = createCanvasData(targetRef.value.kind)
    historyPast.value = []
    historyFuture.value = []
    clipboard.value = null
    dirty.value = false
    saving.value = false
    error.value = null
    conflict.value = null
    loaded.value = false
    await load()
    return 'ok'
  }

  return {
    data,
    loaded,
    dirty,
    saving,
    error,
    savedRev,
    syncSavedRev,
    conflict,
    nodes,
    connections,
    groups,
    load,
    save,
    forceSave,
    reloadFromServer,
    addNode,
    removeNode,
    removeNodes,
    updateNode,
    updateNodeQuiet,
    viewOnlyUpdate,
    adoptExternalChange,
    updateNodes,
    moveEntities,
    addGroup,
    updateGroup,
    updateGroups,
    removeGroups,
    updateDirectorAudioClipDuration,
    removeInputOrderEntry,
    connect,
    disconnect,
    rewireConnections,
    connectGroupToNode,
    createNodeAndConnect,
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
    copyNodes,
    pasteNode,
    pasteNodes,
    applyEntities,
    applyNodes,
    switchTarget,
  }
}
