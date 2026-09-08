import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { applyLlmEvent, createLlmStreamState, createThrottledCommit } from './llmEvents'
import type { LlmTaskEvent } from './llmSocket'

/** 测试事件构造：自动补 taskId */
function ev(event: Record<string, unknown>): LlmTaskEvent {
  return { taskId: 't1', ...event } as LlmTaskEvent
}

describe('applyLlmEvent', () => {
  it('thinking 增量只进 thinking（内部展示），不混入 text（config.output 仅正文）', () => {
    let s = createLlmStreamState()
    s = applyLlmEvent(s, ev({ type: 'thinking', delta: '思路A' }))
    s = applyLlmEvent(s, ev({ type: 'thinking', delta: '思路B' }))
    expect(s.thinking).toBe('思路A思路B')
    expect(s.text).toBe('')
    expect(s.phase).toBe('thinking')
  })

  it('首个 text 增量切 responding；后续增量累计到 text', () => {
    let s = createLlmStreamState()
    s = applyLlmEvent(s, ev({ type: 'text', delta: '答' }))
    expect(s.phase).toBe('responding')
    expect(s.text).toBe('答')
    s = applyLlmEvent(s, ev({ type: 'text', delta: '案' }))
    expect(s.text).toBe('答案')
  })

  it('warning 追加；snapshot 整体替换进度（恢复态补齐）', () => {
    let s = createLlmStreamState()
    s = applyLlmEvent(s, ev({ type: 'warning', message: '图片被忽略' }))
    expect(s.warnings).toEqual(['图片被忽略'])
    s = applyLlmEvent(s, ev({
      type: 'snapshot',
      session: {
        taskId: 't1',
        nodeId: 'n1',
        label: 'AI文本生成',
        phase: 'responding',
        status: 'running',
        startedAt: 1000,
        project: 'proj',
        canvas: { kind: 'scene', episode: '1', shot: '1' },
        thinking: '已思考',
        text: '已有正文',
        warnings: ['旧警告'],
      },
    }))
    expect(s.phase).toBe('responding')
    expect(s.text).toBe('已有正文')
    expect(s.thinking).toBe('已思考')
    expect(s.warnings).toEqual(['旧警告'])
    expect(s.active).toBe(true)
  })

  it('finished(completed)：置终态并携带 fallback 后端信息（patch/rev）', () => {
    let s = createLlmStreamState()
    s = applyLlmEvent(s, ev({
      type: 'finished',
      info: {
        taskId: 't1',
        status: 'completed',
        output: '完整答案',
        outputHistory: [{ id: 'h1', createdAt: '2024-01-01T00:00:00.000Z', input: '你好', output: '完整答案' }],
        rev: 9,
      },
    }))
    expect(s.active).toBe(false)
    expect(s.finished).toBe(true)
    expect(s.finishStatus).toBe('completed')
    expect(s.finishInfo?.rev).toBe(9)
    expect(s.errorMsg).toBe('')
  })

  it('finished(failed)：错误信息附到 errorMsg', () => {
    let s = createLlmStreamState()
    s = applyLlmEvent(s, ev({ type: 'finished', info: { taskId: 't1', status: 'failed', error: '模型超时' } }))
    expect(s.finishStatus).toBe('failed')
    expect(s.errorMsg).toBe('模型超时')
  })

  it('not-found：静默终态（cancelled 语义，不置错误）', () => {
    let s = createLlmStreamState()
    s = applyLlmEvent(s, ev({ type: 'not-found' }))
    expect(s.active).toBe(false)
    expect(s.finished).toBe(true)
    expect(s.finishStatus).toBe('cancelled')
    expect(s.errorMsg).toBe('')
  })
})

describe('createThrottledCommit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('首条立即提交；间隔内合并到定时器；flush 收口最后一段', () => {
    const commit = vi.fn()
    const t = createThrottledCommit(commit, 500)
    t.push('a') // 立即
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenLastCalledWith('a')
    vi.advanceTimersByTime(100)
    t.push('ab') // 合并
    t.push('abc') // 仍合并（同窗口）
    expect(commit).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(400)
    expect(commit).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenLastCalledWith('abc')
    // 新窗口（自上次提交 ≥500ms）：立即
    vi.advanceTimersByTime(500)
    t.push('abcd')
    expect(commit).toHaveBeenCalledTimes(3)
    expect(commit).toHaveBeenLastCalledWith('abcd')
  })

  it('flush 提交未发出的最后一段并清定时器', () => {
    const commit = vi.fn()
    const t = createThrottledCommit(commit, 500)
    t.push('a')
    vi.advanceTimersByTime(100)
    t.push('ab')
    t.flush()
    expect(commit).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenLastCalledWith('ab')
    vi.advanceTimersByTime(1000)
    expect(commit).toHaveBeenCalledTimes(2) // 定时器已清，无重复提交
  })

  it('flush 无待定值时不提交', () => {
    const commit = vi.fn()
    const t = createThrottledCommit(commit, 500)
    t.push('a')
    t.flush()
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
