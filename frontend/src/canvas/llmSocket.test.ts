import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * llmSocket 纯逻辑测试：FakeWebSocket 替身驱动连接/订阅队列/消息路由/退订。
 * 每个用例 resetModules 重建单例（llmSocket.connect 幂等，避免跨用例污染）。
 */

interface FakeSocket {
  url: string
  sent: string[]
  readyState: number
  open(): void
  close(): void
  receive(data: unknown): void
}

function installFakeWebSocket(): FakeSocket[] {
  const instances: FakeSocket[] = []
  class FakeWebSocket {
    static readonly OPEN = 1
    static readonly CONNECTING = 0
    static readonly CLOSED = 3
    readyState = 0
    sent: string[] = []
    onopen: (() => void) | null = null
    onmessage: ((e: { data: unknown }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: ((e: unknown) => void) | null = null

    constructor(public url: string) {
      instances.push(this as unknown as FakeSocket)
    }

    send(data: string): void {
      this.sent.push(data)
    }

    open(): void {
      this.readyState = 1
      this.onopen?.()
    }

    close(): void {
      this.readyState = 3
      this.onclose?.()
    }

    receive(data: unknown): void {
      this.onmessage?.({ data: JSON.stringify(data) })
    }
  }
  ;(globalThis as Record<string, unknown>).WebSocket = FakeWebSocket
  return instances
}

/** 动态导入并取回 llmSocket 单例（每个用例独立模块状态） */
async function freshLlmSocket(): Promise<typeof import('./llmSocket')['llmSocket']> {
  vi.resetModules()
  vi.doMock('../api/llm', () => ({ cancelLlmTask: vi.fn(async () => {}) }))
  const mod = await import('./llmSocket')
  return mod.llmSocket
}

let llmSocket: typeof import('./llmSocket')['llmSocket']
let sockets: FakeSocket[]

beforeEach(async () => {
  sockets = installFakeWebSocket()
  llmSocket = await freshLlmSocket()
})

afterEach(() => {
  vi.unmock('../api/llm')
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('llmSocket', () => {
  it('connect 建立连接；服务端 sessions 全量替换响应式列表', () => {
    llmSocket.connect()
    const s = sockets[0]
    expect(s.url.endsWith('/llm-ws')).toBe(true)
    s.open()
    s.receive({
      type: 'sessions',
      sessions: [{ taskId: 't1', nodeId: 'n1', label: 'AI文本生成', phase: 'thinking', status: 'running', startedAt: 1, project: 'p', canvas: { kind: 'scene', episode: '1', shot: '1' } }],
    })
    expect(llmSocket.sessions.value).toHaveLength(1)
    expect(llmSocket.sessions.value[0].taskId).toBe('t1')
    expect(llmSocket.connected.value).toBe(true)
  })

  it('未连接时 subscribe 入队，连接后自动补发订阅', () => {
    llmSocket.connect()
    const s = sockets[0]
    // 未打开：订阅入队
    const off = llmSocket.subscribe('t1', () => {})
    expect(s.sent).toHaveLength(0)
    s.open()
    // 连接后补发 subscribe
    expect(s.sent).toContain(JSON.stringify({ type: 'subscribe', taskId: 't1' }))
    off()
    expect(s.sent).toContain(JSON.stringify({ type: 'unsubscribe', taskId: 't1' }))
  })

  it('同任务多订阅方：事件分发到全部处理器；退订一个不影响另一个', () => {
    llmSocket.connect()
    const s = sockets[0]
    s.open()
    const a = vi.fn()
    const b = vi.fn()
    const offA = llmSocket.subscribe('t1', a)
    llmSocket.subscribe('t1', b)
    s.receive({ type: 'text', taskId: 't1', delta: '答' })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    offA()
    s.receive({ type: 'text', taskId: 't1', delta: '案' })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('终端事件（finished/not-found）路由到订阅者', () => {
    llmSocket.connect()
    const s = sockets[0]
    s.open()
    const handler = vi.fn()
    llmSocket.subscribe('t1', handler)
    s.receive({ type: 'finished', taskId: 't1', info: { taskId: 't1', status: 'completed', output: '答案', rev: 5 } })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toMatchObject({ type: 'finished', info: { status: 'completed', rev: 5 } })
  })

  it('cancel：WS 优先发送 + HTTP 兜底（mock 后无网络）', () => {
    llmSocket.connect()
    const s = sockets[0]
    s.open()
    llmSocket.cancel('t9')
    expect(s.sent).toContain(JSON.stringify({ type: 'cancel', taskId: 't9' }))
  })

  it('断线后重连（指数退避）：连接成功即重置退避并重订阅队列', async () => {
    vi.useFakeTimers()
    llmSocket.connect()
    const first = sockets[0]
    const off = llmSocket.subscribe('t1', () => {})
    first.open()
    // 断线 → onclose → 定时重连（1s 后）
    first.close()
    expect(llmSocket.connected.value).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(sockets).toHaveLength(2)
    const second = sockets[1]
    second.open()
    // 重连后补发订阅（含队列）
    expect(second.sent).toContain(JSON.stringify({ type: 'subscribe', taskId: 't1' }))
    expect(llmSocket.connected.value).toBe(true)
    off()
  })
})
