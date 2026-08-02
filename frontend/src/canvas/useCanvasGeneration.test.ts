import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useCanvasGeneration } from './useCanvasGeneration'

vi.mock('../api/client', () => ({ writeFs: vi.fn() }))
vi.mock('../api/workflow', () => ({
  runWorkflow: vi.fn(),
  getTaskStatus: vi.fn(),
  getTaskLogs: vi.fn(),
}))

import { writeFs } from '../api/client'
import { runWorkflow, getTaskStatus, getTaskLogs } from '../api/workflow'
import type { CanvasNodeData } from './types'

const TARGET = { kind: 'scene' as const, episode: '1', shot: '1' }

function makeNode(prompt: string, workflowId?: string): CanvasNodeData {
  return {
    id: 'n1', prototypeId: 'image-generate', name: '生成', x: 0, y: 0, width: 240, height: 160,
    config: { prompt, ...(workflowId ? { workflowId } : {}) },
  }
}

describe('useCanvasGeneration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    ;(runWorkflow as Mock).mockResolvedValue({ taskId: 'task-1', status: 'running' })
    ;(getTaskStatus as Mock).mockResolvedValue({ taskId: 'task-1', status: 'completed', result: { path: 'x' }, errorMsg: undefined, workflowId: 'image-edit', impl: 'default', createdAt: '', updatedAt: '' })
    ;(getTaskLogs as Mock).mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('文生图：写入 prompt 文件并调用 runWorkflow（text-to-image）', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('一只猫')
    let savedConfig: Record<string, unknown> | null = null
    await gen.generate(node, (c) => { savedConfig = c })
    expect(writeFs).toHaveBeenCalledWith('p', 'prompt/scene/1/1/canvas/n1/prompt.md', '一只猫')
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'text-to-image',
        params: expect.objectContaining({ outputPath: 'assert/scene/1/1/canvas/n1/v1.jpg' }),
      }),
    )
    // 成功后更新配置
    await vi.advanceTimersByTimeAsync(2100)
    expect(savedConfig).toBeTruthy()
    expect((savedConfig as unknown as { history: unknown[] }).history).toHaveLength(1)
  })

  it('图生图：使用 image-edit 并传入 imagePaths', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('改成夜景', 'image-edit')
    gen.setInputPaths('n1', ['assert/stage/街角/白天.jpg'])
    await gen.generate(node, () => {})
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'image-edit',
        params: expect.objectContaining({
          vars: expect.objectContaining({ desc: '改成夜景', imagePaths: '["assert/stage/街角/白天.jpg"]' }),
        }),
      }),
    )
  })

  it('生成失败进入 error 状态', async () => {
    ;(getTaskStatus as Mock).mockResolvedValue({ taskId: 'task-1', status: 'failed', result: null, errorMsg: '失败', workflowId: 'image-edit', impl: 'default', createdAt: '', updatedAt: '' })
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('x', 'image-edit')
    gen.setInputPaths('n1', ['assert/a.jpg'])
    await gen.generate(node, () => {})
    await vi.advanceTimersByTimeAsync(2100)
    expect(gen.statusByNode.value.n1.status).toBe('error')
    expect(gen.statusByNode.value.n1.errorMsg).toBe('失败')
  })
})
