import { computed, ref } from 'vue'
import { cancelTask } from '../api/tasks'

/** 画布定位（与服务端 CanvasDefTarget 一致；画布恢复按 scope 过滤用） */
export interface LlmCanvasTarget {
  kind: 'scene' | 'stage'
  /** 分镜画布时的集数 */
  episode?: string
  /** 分镜画布时的分镜号 */
  shot?: string
  /** 场景画布时的场景名 */
  stage?: string
  /** 场景画布时的子场景标签 */
  label?: string
}

/** 任务类型（统一任务架构：工作流 / LLM 会话 / ffmpeg） */
export type TaskType = 'workflow' | 'llm' | 'ffmpeg'

/** 任务状态（终态即移出活跃列表） */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

/** 统一任务摘要（tasks 广播与任务管理器展示用） */
export interface TaskInfo {
  /** 任务 id（LLM 会话 id 即任务 id） */
  id: string
  /** 任务类型 */
  type: TaskType
  /** 展示名 */
  label: string
  /** 状态 */
  status: TaskStatus
  /** 进度百分比（0~100）；缺省表示不确定进度 */
  progress?: number
  /** 登记时间（毫秒时间戳；耗时由客户端按 startedAt 自行刷新） */
  startedAt: number
  /** 项目名 */
  project?: string
  /** 发起节点 id */
  nodeId?: string
  /** 画布定位 */
  canvas?: LlmCanvasTarget
  /** 是否可中断 */
  cancelable: boolean
  /** 不可中断原因 */
  cancelBlockReason?: string
  /** 类型自有字段（如拼接模式/输出尺寸/工作流实现） */
  payload?: Record<string, unknown>
  /** 错误信息（仅 failed） */
  error?: string
  /** LLM 会话阶段（仅 type=llm） */
  phase?: 'thinking' | 'responding'
  /** LLM 模型名（仅 type=llm） */
  modelName?: string
}

/** LLM 活跃会话摘要（兼容既有画布恢复逻辑：字段与统一任务摘要一致，id 对应 taskId） */
export interface LlmSessionInfo extends TaskInfo {
  /** 会话 id（与 TaskInfo.id 相同；保留字段名兼容既有调用方） */
  taskId: string
  /** 发起会话的节点 id（LLM 会话必有） */
  nodeId: string
  /** 画布定位（LLM 会话必有） */
  canvas: LlmCanvasTarget
}

/** LLM 会话快照（subscribe 即发：运行中 = 累计进度，供恢复态补齐显示） */
export interface LlmSnapshotInfo extends LlmSessionInfo {
  thinking: string
  text: string
  warnings: string[]
  error?: string
}

/** LLM 终态信息（finished 全局广播载荷；后端已完成落盘） */
export interface LlmFinishedInfo {
  taskId: string
  /** 发起会话的节点 id（前端按节点采纳补丁） */
  nodeId: string
  status: 'completed' | 'failed' | 'cancelled'
  /** 项目名（前端全局通知按项目过滤） */
  project: string
  /** 画布定位（前端全局通知按画布 scope 过滤） */
  canvas: LlmCanvasTarget
  error?: string
  /** 实际写入画布的 config.output（无落盘时缺省） */
  output?: string
  /** 实际写入画布的 config.outputHistory（completed 且正文非空时携带） */
  outputHistory?: { id: string; createdAt: string; input: string; output: string; modelName?: string; presetName?: string; mediaLabels?: string[] }[]
  /** 写入后的画布版本号（savedRev 对齐基准） */
  rev?: number
  /** 写入前的画布版本号（前端 savedRev === prevRev 时才采纳补丁） */
  prevRev?: number
}

/** 服务端推送的任务事件（time 通知订阅者；taskId 为任务 id） */
export type LlmTaskEvent =
  | { type: 'thinking' | 'text'; taskId: string; delta: string }
  | { type: 'warning'; taskId: string; message: string }
  | { type: 'snapshot'; taskId: string; session: LlmSnapshotInfo }
  | { type: 'finished'; taskId: string; info: LlmFinishedInfo }
  | { type: 'not-found'; taskId: string }
  | { type: 'cancelling'; taskId: string }

/** 任务事件处理器（由订阅方注册；同一任务可多订阅方） */
export type LlmTaskHandler = (event: LlmTaskEvent) => void

/** 全局终态监听器（finished 全局广播：不依赖按任务订阅，画布按 项目+scope 过滤消费） */
export type LlmFinishedListener = (info: LlmFinishedInfo) => void

/** 任务增量监听器（task-update 广播：任务进度与终态，画布按 nodeId 消费） */
export type TaskUpdateListener = (task: TaskInfo) => void

/** 客户端 → 服务端消息 */
type LlmWsClientMessage =
  | { type: 'subscribe' | 'unsubscribe' | 'cancel'; taskId: string }

/** 断线重连退避：初始 1s，翻倍至上限 15s */
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15000

/** 服务端推送的服务消息（tasks 全量列表 / task-update 增量 / 任务事件） */
type ServerMessage =
  | { type: 'tasks'; tasks: TaskInfo[] }
  | { type: 'task-update'; task: TaskInfo }
  | LlmTaskEvent

/**
 * 统一任务 WebSocket 客户端（全局单例）。
 *
 * - App 挂载即 connect()；断线指数退避重连；
 * - 连接建立/重连后服务端推送 `tasks` 全量活跃列表，响应式存于 `tasks`
 *   （任务管理器展示、画布按 项目 + scope 过滤恢复）；
 * - `task-update` 增量合并进 `tasks`（ffmpeg 进度、工作流状态、LLM 阶段实时刷新）；
 * - subscribe(taskId, handler)：未连接时入队，连接后自动补发（重连后重订阅
 *   全部已知 taskId，配合服务端 snapshot 补齐进度）；同一任务支持多订阅方；
 * - cancel(taskId)：WS 优先发送（服务端收敛），HTTP 兜底（`/api/tasks/:id/cancel`，
 *   幂等，404 视为已终态）。
 *
 * `sessions` 为 LLM 会话视图（按 type=llm 过滤并补 taskId 字段），兼容既有画布
 * 恢复/全局面板代码；新代码应直接使用 `tasks`。
 */
class TaskSocketClient {
  /** 全部活跃任务（服务端 tasks/task-update 驱动；响应式） */
  readonly tasks = ref<TaskInfo[]>([])
  /** WS 连接是否已建立（重连对账用） */
  readonly connected = ref(false)
  /**
   * 是否已收到本次连接的 `tasks` 全量快照（画布恢复前对账用）。
   *
   * 连接建立到快照到达之间有窗口：此期间 `tasks` 仍为空/旧值，
   * 画布若在此时按 `tasks` 恢复 Loading 会漏掉运行中任务；
   * 断线时重置为 false（旧快照可能过期，恢复方改走 HTTP 兜底 `GET /api/tasks`）。
   */
  readonly snapshotReady = ref(false)
  /**
   * LLM 会话列表视图（按 type=llm 过滤，补 taskId 字段）。
   *
   * 兼容既有画布恢复/面板代码（原 `llmSocket.sessions`）；新代码请直接用 `tasks`。
   */
  readonly sessions = computed<LlmSessionInfo[]>(() =>
    this.tasks.value
      .filter((t) => t.type === 'llm' && !!t.nodeId && !!t.canvas)
      .map((t) => ({ ...t, taskId: t.id, nodeId: t.nodeId as string, canvas: t.canvas as LlmCanvasTarget })),
  )

  /** 原生 WebSocket 实例 */
  private socket: WebSocket | null = null
  /** 连接中标记（防止重复发起连接） */
  private connecting = false
  /** 已订阅任务 → 处理器集合（同一任务多订阅方） */
  private readonly handlers = new Map<string, Set<LlmTaskHandler>>()
  /** 全局终态监听器（finished 广播通知；与按任务订阅解耦） */
  private readonly finishedListeners = new Set<LlmFinishedListener>()
  /** 任务增量监听器（task-update 广播：任务管理器/画布消费进度与终态） */
  private readonly taskUpdateListeners = new Set<TaskUpdateListener>()
  /** 等待连接建立后补发的订阅队列 */
  private readonly pendingSubscribes = new Set<string>()
  /** 重连定时器 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** 当前退避间隔（毫秒；连接成功即重置） */
  private backoffMs = RECONNECT_BASE_MS
  /** 是否已随 App 挂载连接（防止热重载重复连接） */
  private started = false

  /**
   * 建立全局 WS 连接（幂等：已连接/连接中/已启动时忽略）。
   * App.vue 挂载时调用一次。
   */
  connect(): void {
    if (this.started) return
    this.started = true
    this.open()
  }

  /** 打开连接（关闭后按退避自动重连） */
  private open(): void {
    if (this.socket || this.connecting) return
    this.connecting = true
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${window.location.host}/llm-ws`)
    this.socket = ws
    ws.onopen = () => {
      this.connecting = false
      this.connected.value = true
      this.backoffMs = RECONNECT_BASE_MS
      // 服务端连接建立即推送 tasks 全量；此处重订阅全部已知任务（重连后快照补齐/对账）
      for (const taskId of this.handlers.keys()) {
        this.send({ type: 'subscribe', taskId })
      }
      this.flushPending()
    }
    ws.onmessage = (e) => this.onMessage(e)
    ws.onclose = () => {
      this.socket = null
      this.connecting = false
      this.connected.value = false
      // 旧快照可能已过期（断线期间任务可能推进）：标记未就绪，恢复方改走 HTTP 兜底
      this.snapshotReady.value = false
      this.scheduleReconnect()
    }
    ws.onerror = (e) => {
      console.error('[task-ws] 连接错误（等待重连）:', e)
    }
  }

  /** 断线重连：指数退避（1s → 15s 封顶） */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, this.backoffMs)
    this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_MS)
  }

  /** 收到服务端消息：tasks 全量替换 / task-update 增量合并 / 任务事件按 taskId 分发 */
  private onMessage(e: MessageEvent): void {
    let msg: ServerMessage
    try {
      msg = JSON.parse(String(e.data)) as ServerMessage
    } catch (err) {
      console.error('[task-ws] 消息解析失败（已忽略）:', err)
      return
    }
    if (msg.type === 'tasks') {
      if (Array.isArray(msg.tasks)) this.tasks.value = msg.tasks
      // 连接建立后的首个全量快照到达：恢复方据此判断 tasks 是否可用于对账
      this.snapshotReady.value = true
      return
    }
    if (msg.type === 'task-update') {
      this.mergeTask(msg.task)
      for (const listener of [...this.taskUpdateListeners]) {
        try {
          listener(msg.task)
        } catch (err) {
          console.error('[task-ws] 任务增量监听器处理异常:', err)
        }
      }
      return
    }
    this.dispatch(msg as LlmTaskEvent)
    // finished 为服务端全局广播（不依赖订阅）：任务订阅处理器之外，通知全局终态监听器
    if (msg.type === 'finished') {
      for (const listener of [...this.finishedListeners]) {
        try {
          listener(msg.info)
        } catch (err) {
          console.error('[task-ws] 全局终态监听器处理异常:', err)
        }
      }
    }
  }

  /**
   * 合并一条任务增量（不存在则插入；保持按登记时间倒序）。
   *
   * @param task 任务摘要
   */
  private mergeTask(task: TaskInfo): void {
    const list = [...this.tasks.value]
    const idx = list.findIndex((t) => t.id === task.id)
    if (idx >= 0) list[idx] = task
    else list.push(task)
    list.sort((a, b) => b.startedAt - a.startedAt)
    this.tasks.value = list
  }

  /** 分发任务事件给该任务的全部订阅处理器（处理器异常只打日志） */
  private dispatch(event: LlmTaskEvent): void {
    const set = this.handlers.get(event.taskId)
    if (!set) return
    for (const handler of [...set]) {
      try {
        handler(event)
      } catch (err) {
        console.error(`[task-ws] 任务事件处理异常（${event.taskId}/${event.type}）:`, err)
      }
    }
  }

  /** 连接建立后补发订阅队列（含重连后的重订阅） */
  private flushPending(): void {
    for (const taskId of this.pendingSubscribes) {
      this.send({ type: 'subscribe', taskId })
    }
    this.pendingSubscribes.clear()
  }

  /** 发送客户端消息（未连接时忽略——订阅入队由 subscribe 负责） */
  private send(msg: LlmWsClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg))
    }
  }

  /**
   * 订阅全局终态广播（finished）：服务端落盘完成后向全部客户端广播，
   * 不依赖按任务订阅——监听方自行按 项目 + 画布 scope 过滤消费
   * （AssetCanvas 采纳终态补丁并对齐 savedRev 用）。
   *
   * @param listener 终态监听器（接收 finished 载荷）
   * @returns 取消监听函数
   */
  onFinished(listener: LlmFinishedListener): () => void {
    this.finishedListeners.add(listener)
    return () => { this.finishedListeners.delete(listener) }
  }

  /**
   * 订阅任务增量广播（task-update）：任务进度/终态实时通知，不依赖按任务订阅。
   *
   * @param listener 增量监听器
   * @returns 取消监听函数
   */
  onTaskUpdate(listener: TaskUpdateListener): () => void {
    this.taskUpdateListeners.add(listener)
    return () => {
      this.taskUpdateListeners.delete(listener)
    }
  }

  /**
   * 订阅一个任务（LLM 会话流式事件 / 画布 ffmpeg 任务进度）。
   *
   * - 同一任务可多次订阅（多页签/恢复与节点并存）；返回取消订阅函数；
   * - 未连接时入队，连接建立后自动补发（服务端回 snapshot/not-found 完成对齐）。
   *
   * @param taskId 任务 id
   * @param handler 事件处理器
   * @returns 取消订阅函数（仅移除本处理器；无剩余处理器时通知服务端退订）
   */
  subscribe(taskId: string, handler: LlmTaskHandler): () => void {
    let set = this.handlers.get(taskId)
    if (!set) {
      set = new Set()
      this.handlers.set(taskId, set)
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send({ type: 'subscribe', taskId })
      } else {
        this.pendingSubscribes.add(taskId)
      }
    }
    set.add(handler)
    return () => {
      const cur = this.handlers.get(taskId)
      if (!cur) return
      cur.delete(handler)
      if (cur.size === 0) {
        this.handlers.delete(taskId)
        this.pendingSubscribes.delete(taskId)
        this.send({ type: 'unsubscribe', taskId })
      }
    }
  }

  /**
   * 退订一个任务（移除全部订阅处理器；任务继续在服务端执行）。
   * 节点卸载/切换画布时使用；重进画布由任务列表过滤恢复接管。
   *
   * @param taskId 任务 id
   */
  unsubscribe(taskId: string): void {
    this.handlers.delete(taskId)
    this.pendingSubscribes.delete(taskId)
    this.send({ type: 'unsubscribe', taskId })
  }

  /**
   * 中断任务（停止生成 / 任务管理器「中断」）：WS 优先（快），HTTP 兜底（可靠，幂等）。
   * 服务端收敛后广播 task-update/tasks（LLM 另有 finished），本地状态由订阅方处理。
   *
   * @param taskId 任务 id
   */
  cancel(taskId: string): void {
    this.send({ type: 'cancel', taskId })
    void cancelTask(taskId).catch((e) => {
      console.error(`[task-ws] HTTP 兜底取消失败: ${e instanceof Error ? e.message : String(e)}`)
    })
  }

  /**
   * 中断 LLM 会话（兼容既有调用点语义，与 `cancel` 等价）。
   *
   * @param taskId 会话 id
   */
  cancelLlm(taskId: string): void {
    this.cancel(taskId)
  }

  /** 按 taskId 查询是否有订阅者（调试/对账辅助） */
  hasSubscribers(taskId: string): boolean {
    return this.handlers.has(taskId)
  }

  /**
   * 按 taskId 查询活跃任务。
   *
   * @param taskId 任务 id
   * @returns 任务摘要或 undefined
   */
  getTask(taskId: string): TaskInfo | undefined {
    return this.tasks.value.find((t) => t.id === taskId)
  }

  /**
   * 触发任务增量监听器（**仅测试使用**：单测里模拟服务端 task-update 广播）。
   *
   * @param task 任务摘要
   */
  emitTaskUpdateForTest(task: TaskInfo): void {
    for (const listener of [...this.taskUpdateListeners]) listener(task)
  }

  /**
   * 触发按任务订阅的事件处理器（**仅测试使用**：模拟服务端 snapshot/not-found 等）。
   *
   * @param event 任务事件
   */
  emitTaskEventForTest(event: LlmTaskEvent): void {
    this.dispatch(event)
  }
}

/** 全局统一任务 WS 客户端单例（App 启动即连接；全站共享任务列表） */
export const taskSocket = new TaskSocketClient()
