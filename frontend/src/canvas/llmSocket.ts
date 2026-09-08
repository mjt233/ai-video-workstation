import { ref } from 'vue'
import { cancelLlmTask } from '../api/llm'

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

/** 活跃会话摘要（sessions 广播与全局面板展示用） */
export interface LlmSessionInfo {
  taskId: string
  nodeId: string
  label: string
  modelName?: string
  phase: 'thinking' | 'responding'
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  /** 会话启动时间（毫秒时间戳；耗时由客户端按 startedAt 自行刷新） */
  startedAt: number
  project: string
  canvas: LlmCanvasTarget
}

/** 会话快照（订阅即发：运行中 = 累计进度，供恢复态补齐显示） */
export interface LlmSnapshotInfo extends LlmSessionInfo {
  thinking: string
  text: string
  warnings: string[]
  error?: string
}

/** 终态信息（finished 全局广播载荷；后端已完成落盘） */
export interface LlmFinishedInfo {
  taskId: string
  /** 发起会话的节点 id（前端按节点采纳补丁） */
  nodeId: string
  status: 'completed' | 'failed' | 'cancelled'
  /** 项目名（全局通知按项目过滤） */
  project: string
  /** 画布定位（全局通知按画布 scope 过滤） */
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

/** 服务端推送的会话事件（time 通知订阅者；taskId 为会话 id） */
export type LlmTaskEvent =
  | { type: 'thinking' | 'text'; taskId: string; delta: string }
  | { type: 'warning'; taskId: string; message: string }
  | { type: 'snapshot'; taskId: string; session: LlmSnapshotInfo }
  | { type: 'finished'; taskId: string; info: LlmFinishedInfo }
  | { type: 'not-found'; taskId: string }

/** 任务事件处理器（由订阅方注册；同一任务可多订阅方） */
export type LlmTaskHandler = (event: LlmTaskEvent) => void

/** 全局终态监听器（finished 全局广播：不依赖按任务订阅，画布按 项目+scope 过滤消费） */
export type LlmFinishedListener = (info: LlmFinishedInfo) => void

/** 客户端 → 服务端消息 */
type LlmWsClientMessage =
  | { type: 'subscribe' | 'unsubscribe' | 'cancel'; taskId: string }

/** 断线重连退避：初始 1s，翻倍至上限 15s */
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15000

/** 服务端推送的服务消息（sessions 列表 / 任务事件） */
type ServerMessage = { type: 'sessions'; sessions: LlmSessionInfo[] } | LlmTaskEvent

/**
 * LLM 会话 WebSocket 客户端（全局单例）。
 *
 * - App 挂载即 connect()；断线指数退避重连；
 * - 连接建立/重连后服务端推送 sessions 全量活跃列表，响应式存于 `sessions`
 *   （画布按 项目 + scope 过滤恢复、Header 徽标/面板消费）；
 * - subscribe(taskId, handler)：未连接时入队，连接后自动补发（重连后重订阅
 *   全部已知 taskId，配合服务端 snapshot 补齐进度）；同一任务支持多订阅方；
 * - cancel(taskId)：WS 优先发送（服务端收敛），HTTP 兜底（cancelLlmTask，
 *   幂等，404 视为已终态）。
 */
class LlmSocketClient {
  /** 活跃会话列表（服务端 begin/update/finish 广播全量驱动；响应式） */
  readonly sessions = ref<LlmSessionInfo[]>([])
  /** WS 连接是否已建立（重连对账用） */
  readonly connected = ref(false)

  /** 原生 WebSocket 实例 */
  private socket: WebSocket | null = null
  /** 连接中标记（防止重复发起连接） */
  private connecting = false
  /** 已订阅任务 → 处理器集合（同一任务多订阅方） */
  private readonly handlers = new Map<string, Set<LlmTaskHandler>>()
  /** 全局终态监听器（finished 广播通知；与按任务订阅解耦） */
  private readonly finishedListeners = new Set<LlmFinishedListener>()
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
      // 服务端连接建立即推送 sessions 全量；此处重订阅全部已知任务（重连后快照补齐/对账）
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
      this.scheduleReconnect()
    }
    ws.onerror = (e) => {
      console.error('[llm-ws] 连接错误（等待重连）:', e)
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

  /** 收到服务端消息：sessions 全量替换；任务事件按 taskId 分发 */
  private onMessage(e: MessageEvent): void {
    let msg: ServerMessage
    try {
      msg = JSON.parse(String(e.data)) as ServerMessage
    } catch (err) {
      console.error('[llm-ws] 消息解析失败（已忽略）:', err)
      return
    }
    if (msg.type === 'sessions') {
      if (Array.isArray(msg.sessions)) this.sessions.value = msg.sessions
      return
    }
    this.dispatch(msg)
    // finished 为服务端全局广播（不依赖订阅）：任务订阅处理器之外，通知全局终态监听器
    if (msg.type === 'finished') {
      for (const listener of [...this.finishedListeners]) {
        try {
          listener(msg.info)
        } catch (err) {
          console.error('[llm-ws] 全局终态监听器处理异常:', err)
        }
      }
    }
  }

  /** 分发任务事件给该任务的全部订阅处理器（处理器异常只打日志） */
  private dispatch(event: LlmTaskEvent): void {
    const set = this.handlers.get(event.taskId)
    if (!set) return
    for (const handler of [...set]) {
      try {
        handler(event)
      } catch (err) {
        console.error(`[llm-ws] 会话事件处理异常（${event.taskId}/${event.type}）:`, err)
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
   * 订阅一个会话任务（生成开始 / 恢复订阅）。
   *
   * - 同一任务可多次订阅（多页签/恢复与节点并存）；返回取消订阅函数；
   * - 未连接时入队，连接建立后自动补发（服务端回 snapshot/not-found 完成对齐）。
   *
   * @param taskId 会话 id
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
   * 退订一个会话任务（移除全部订阅处理器；任务继续在服务端执行）。
   * 节点卸载/切换画布时使用；重进画布由 sessions 过滤恢复接管。
   *
   * @param taskId 会话 id
   */
  unsubscribe(taskId: string): void {
    this.handlers.delete(taskId)
    this.pendingSubscribes.delete(taskId)
    this.send({ type: 'unsubscribe', taskId })
  }

  /**
   * 取消会话（停止生成）：WS 优先（快），HTTP 兜底（可靠，幂等）。
   * 服务端收敛后广播 finished，本地状态由订阅方处理。
   *
   * @param taskId 会话 id
   */
  cancel(taskId: string): void {
    this.send({ type: 'cancel', taskId })
    void cancelLlmTask(taskId).catch((e) => {
      console.error(`[llm-ws] HTTP 兜底取消失败: ${e instanceof Error ? e.message : String(e)}`)
    })
  }

  /** 按 taskId 查询是否有订阅者（调试/对账辅助） */
  hasSubscribers(taskId: string): boolean {
    return this.handlers.has(taskId)
  }
}

/** 全局 LLM 会话 WS 客户端单例（App 启动即连接；全站共享会话列表） */
export const llmSocket = new LlmSocketClient()
