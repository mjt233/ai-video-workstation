import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * taskSocket 纯逻辑测试：FakeWebSocket 替身驱动连接/订阅队列/消息路由/退订/任务增量。
 * 每个用例 resetModules 重建单例（taskSocket.connect 幂等，避免跨用例污染）。
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

/** 动态导入并取回 taskSocket 单例（每个用例独立模块状态） */
async function freshTaskSocket(): Promise<typeof import('./taskSocket')['taskSocket']> {
  vi.resetModules()
  vi.doMock('../api/tasks', () => ({ cancelTask: vi.fn(async () => {}), listTasks: vi.fn(async () => []) }))
  const mod = await import('./taskSocket')
  return mod.taskSocket
}

let taskSocket: typeof import('./taskSocket')['taskSocket']
let sockets: FakeSocket[]

beforeEach(async () => {
  sockets = installFakeWebSocket()
  taskSocket = await freshTaskSocket()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** 构造任务摘要（默认 ffmpeg 任务） */
function task(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
    type: 'ffmpeg',
    label: '拼接视频',
    status: 'running',
    startedAt: 1,
    cancelable: true,
    ...patch,
  }
}

describe('taskSocket', () => {
  it('connect 建立连接；服务端 tasks 全量替换响应式列表', () => {
    taskSocket.connect()
    expect(sockets).toHaveLength(1)
    expect(sockets[0].url.endsWith('/llm-ws')).toBe(true)
    sockets[0].open()
    sockets[0].receive({ type: 'tasks', tasks: [task()] })
    expect(taskSocket.tasks.value).toHaveLength(1)
    expect(taskSocket.tasks.value[0].id).toBe('t1')
    expect(taskSocket.connected.value).toBe(true)
  })

  it('connect 幂等（重复调用不重复建连）', () => {
    taskSocket.connect()
    taskSocket.connect()
    expect(sockets).toHaveLength(1)
  })

  it('sessions 视图按 type=llm 过滤并补 taskId', () => {
    taskSocket.connect()
    sockets[0].open()
    sockets[0].receive({
      type: 'tasks',
      tasks: [
        task({
          id: 'llm-1',
          type: 'llm',
          nodeId: 'n1',
          canvas: { kind: 'scene', episode: '1', shot: '1' },
          phase: 'responding',
        }),
        task({ id: 'ff-1' }),
      ],
    })
    expect(taskSocket.sessions.value).toHaveLength(1)
    expect(taskSocket.sessions.value[0].taskId).toBe('llm-1')
    expect(taskSocket.sessions.value[0].nodeId).toBe('n1')
  })

  it('task-update 增量合并（存在则替换，不存在则插入）并通知增量监听器', () => {
    taskSocket.connect()
    sockets[0].open()
    const listener = vi.fn()
    taskSocket.onTaskUpdate(listener)

    sockets[0].receive({ type: 'tasks', tasks: [task({ progress: 0 })] })
    sockets[0].receive({ type: 'task-update', task: task({ progress: 50 }) })
    sockets[0].receive({ type: 'task-update', task: task({ id: 't2', label: '裁剪视频' }) })

    expect(taskSocket.tasks.value).toHaveLength(2)
    expect(taskSocket.tasks.value.find((t) => t.id === 't1')?.progress).toBe(50)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('订阅分发：同任务多处理器、退订只移除自身、无处理器时通知服务端退订', () => {
    taskSocket.connect()
    sockets[0].open()
    const a = vi.fn()
    const b = vi.fn()
    const offA = taskSocket.subscribe('t1', a)
    const offB = taskSocket.subscribe('t1', b)
    // 首个订阅发送 subscribe 消息
    expect(sockets[0].sent.filter((s) => s.includes('"subscribe"'))).toHaveLength(1)

    sockets[0].receive({ type: 'text', taskId: 't1', delta: 'hi' })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    offA()
    sockets[0].receive({ type: 'text', taskId: 't1', delta: 'x' })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)

    offB()
    expect(sockets[0].sent.filter((s) => s.includes('"unsubscribe"'))).toHaveLength(1)
  })

  it('未连接时订阅入队，连接后自动补发', () => {
    taskSocket.connect()
    const handler = vi.fn()
    taskSocket.subscribe('t1', handler)
    expect(sockets[0].sent).toHaveLength(0)
    sockets[0].open()
    expect(sockets[0].sent.some((s) => s.includes('"subscribe"') && s.includes('t1'))).toBe(true)
  })

  it('onFinished 全局终态监听器：finished 广播通知（与订阅解耦）', () => {
    taskSocket.connect()
    sockets[0].open()
    const listener = vi.fn()
    taskSocket.onFinished(listener)
    sockets[0].receive({
      type: 'finished',
      taskId: 't1',
      info: { taskId: 't1', nodeId: 'n1', status: 'completed', project: 'p', canvas: { kind: 'scene', episode: '1', shot: '1' }, rev: 5 },
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toMatchObject({ taskId: 't1', nodeId: 'n1', rev: 5 })
  })

  it('监听器异常只打日志，不影响其他监听器', () => {
    taskSocket.connect()
    sockets[0].open()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = vi.fn(() => {
      throw new Error('boom')
    })
    const good = vi.fn()
    taskSocket.onFinished(bad)
    taskSocket.onFinished(good)
    sockets[0].receive({
      type: 'finished',
      taskId: 't1',
      info: { taskId: 't1', nodeId: 'n1', status: 'failed', project: 'p', canvas: { kind: 'scene', episode: '1', shot: '1' } },
    })
    expect(good).toHaveBeenCalledTimes(1)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('cancel：WS 优先发送 + HTTP 兜底', () => {
    taskSocket.connect()
    sockets[0].open()
    taskSocket.cancel('t9')
    expect(sockets[0].sent.some((s) => s.includes('"cancel"') && s.includes('t9'))).toBe(true)
  })

  it('断线后重连（退避定时器触发）', () => {
    vi.useFakeTimers()
    taskSocket.connect()
    sockets[0].open()
    expect(taskSocket.connected.value).toBe(true)
    sockets[0].close()
    expect(taskSocket.connected.value).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(2)
    sockets[1].open()
    expect(taskSocket.connected.value).toBe(true)
  })
})
