import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useCanvasGeneration } from './useCanvasGeneration'

vi.mock('../api/client', () => ({ writeFs: vi.fn() }))
vi.mock('../api/workflow', () => ({
  runWorkflow: vi.fn(),
  getTaskStatus: vi.fn(),
  getTaskLogs: vi.fn(),
  cancelWorkflow: vi.fn(),
}))
vi.mock('./api', () => ({ extractVideoFrame: vi.fn(), extractVideoFrameAtTime: vi.fn() }))

import { writeFs } from '../api/client'
import { runWorkflow, getTaskStatus, getTaskLogs, cancelWorkflow } from '../api/workflow'
import { extractVideoFrame, extractVideoFrameAtTime } from './api'
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
    ;(getTaskStatus as Mock).mockResolvedValue({ taskId: 'task-1', status: 'completed', result: { path: 'x' }, errorMsg: undefined, workflowId: 'image-edit', impl: '', createdAt: '', updatedAt: '' })
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
          vars: expect.objectContaining({ prompt: '改成夜景', imagePaths: '["assert/stage/街角/白天.jpg"]' }),
        }),
      }),
    )
  })

  it('场景画布（含子场景标签）：prompt 与产物路径包含 label', async () => {
    const gen = useCanvasGeneration('p', { kind: 'stage', stage: '街角', label: '白天' })
    const node = makeNode('打开正门')
    await gen.generate(node, () => {})
    expect(writeFs).toHaveBeenCalledWith('p', 'prompt/stage/街角/canvas/白天/n1/prompt.md', '打开正门')
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'text-to-image',
        params: expect.objectContaining({ outputPath: 'assert/stage/街角/canvas/白天/n1/v1.jpg' }),
      }),
    )
  })

  it('生成失败进入 error 状态', async () => {
    ;(getTaskStatus as Mock).mockResolvedValue({ taskId: 'task-1', status: 'failed', result: null, errorMsg: '失败', workflowId: 'image-edit', impl: '', createdAt: '', updatedAt: '' })
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('x', 'image-edit')
    gen.setInputPaths('n1', ['assert/a.jpg'])
    await gen.generate(node, () => {})
    await vi.advanceTimersByTimeAsync(2100)
    expect(gen.statusByNode.value.n1.status).toBe('error')
    expect(gen.statusByNode.value.n1.errorMsg).toBe('失败')
  })

  it('视频节点：走自包含提交参数并生成 .mp4 产物路径', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'vg', prototypeId: 'video-generate', name: '生成视频', x: 0, y: 0, width: 240, height: 160,
      config: { workflowImpl: 'ceb-ltx-2.3-director', workflowParams: { seed: '1' } },
    }
    const videoParams = { mode: 'director' as const, resolution: { width: 1080, height: 1920 }, duration: 10, prompt: 'p', extraParams: {} }
    await gen.generate(node, () => {}, videoParams)
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'image-to-video',
        impl: 'ceb-ltx-2.3-director',
        params: expect.objectContaining({
          outputPath: 'assert/scene/1/1/canvas/vg/v1.mp4',
          video: videoParams,
        }),
      }),
    )
  })

  it('视频节点缺少提交参数：进入 error 状态且不调用 runWorkflow', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'vg', prototypeId: 'video-generate', name: '生成视频', x: 0, y: 0, width: 240, height: 160,
      config: {},
    }
    await gen.generate(node, () => {})
    expect(runWorkflow).not.toHaveBeenCalled()
    expect(gen.statusByNode.value.vg?.status).toBe('error')
    expect(gen.statusByNode.value.vg?.errorMsg).toBe('缺少视频提交参数')
  })

  it('中断：停止轮询并调用 cancelWorkflow', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('一只猫')
    gen.setInputPaths('n1', ['assert/a.jpg'])
    await gen.generate(node, () => {})
    await gen.interrupt('n1')
    expect(cancelWorkflow).toHaveBeenCalledWith('task-1')
    expect(gen.statusByNode.value.n1?.status).toBe('error')
    expect(gen.statusByNode.value.n1?.errorMsg).toBe('已中断')
  })

  it('cancelWorkflow 失败不阻断状态展示', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('一只猫')
    gen.setInputPaths('n1', ['assert/a.jpg'])
    await gen.generate(node, () => {})
    ;(cancelWorkflow as Mock).mockRejectedValueOnce(new Error('boom'))
    await expect(gen.interrupt('n1')).resolves.toBeUndefined()
    expect(gen.statusByNode.value.n1?.errorMsg).toBe('已中断')
  })

  it('获取视频帧：调用 extractVideoFrame 并回写 current/history（.png 产物路径）', async () => {
    ;(extractVideoFrame as Mock).mockResolvedValue({ success: true, path: 'assert/scene/1/1/canvas/ef/v1.png' })
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'ef', prototypeId: 'video-frame-extract', name: '获取视频帧', x: 0, y: 0, width: 240, height: 160,
      config: { frameIndex: -1 },
    }
    let savedConfig: Record<string, unknown> | null = null
    await gen.extractFrame(node, 'assert/scene/1/1/canvas/vg/v1.mp4', (c) => { savedConfig = c })
    expect(extractVideoFrame).toHaveBeenCalledWith('p', 'assert/scene/1/1/canvas/vg/v1.mp4', -1, 'assert/scene/1/1/canvas/ef/v1.png')
    expect(gen.statusByNode.value.ef?.status).toBe('success')
    const cfg = savedConfig as unknown as { current: { path: string }; history: unknown[] }
    expect(cfg.current.path).toBe('assert/scene/1/1/canvas/ef/v1.png')
    expect(cfg.history).toHaveLength(1)
  })

  it('获取视频帧：config.frameTime 存在时按时间点提取（extractVideoFrameAtTime）', async () => {
    ;(extractVideoFrameAtTime as Mock).mockResolvedValue({ success: true, path: 'assert/scene/1/1/canvas/ef/v1.png' })
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'ef', prototypeId: 'video-frame-extract', name: '获取视频帧', x: 0, y: 0, width: 240, height: 160,
      config: { frameIndex: 12, frameTime: 2.5 },
    }
    let savedConfig: Record<string, unknown> | null = null
    await gen.extractFrame(node, 'assert/v.mp4', (c) => { savedConfig = c })
    expect(extractVideoFrameAtTime).toHaveBeenCalledWith('p', 'assert/v.mp4', 2.5, 'assert/scene/1/1/canvas/ef/v1.png')
    expect(extractVideoFrame).not.toHaveBeenCalled()
    expect(gen.statusByNode.value.ef?.status).toBe('success')
    const cfg = savedConfig as unknown as { current: { path: string } }
    expect(cfg.current.path).toBe('assert/scene/1/1/canvas/ef/v1.png')
  })

  it('获取视频帧：提取失败进入 error 状态且不回写配置', async () => {
    ;(extractVideoFrame as Mock).mockRejectedValueOnce(new Error('帧索引越界'))
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'ef', prototypeId: 'video-frame-extract', name: '获取视频帧', x: 0, y: 0, width: 240, height: 160,
      config: { frameIndex: 999 },
    }
    let savedConfig: Record<string, unknown> | null = null
    await gen.extractFrame(node, 'assert/v.mp4', (c) => { savedConfig = c })
    expect(gen.statusByNode.value.ef?.status).toBe('error')
    expect(gen.statusByNode.value.ef?.errorMsg).toBe('帧索引越界')
    expect(savedConfig).toBeNull()
  })
})
