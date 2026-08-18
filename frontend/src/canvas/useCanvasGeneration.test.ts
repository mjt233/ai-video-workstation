import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useCanvasGeneration } from './useCanvasGeneration'

vi.mock('../api/client', () => ({ writeFs: vi.fn() }))
vi.mock('../api/workflow', () => ({
  runWorkflow: vi.fn(),
  getTaskStatus: vi.fn(),
  getTaskLogs: vi.fn(),
  cancelWorkflow: vi.fn(),
}))
vi.mock('./api', () => ({
  extractVideoFrame: vi.fn(),
  extractVideoFrameAtTime: vi.fn(),
  concatVideo: vi.fn(),
  trimVideo: vi.fn(),
  getCanvasNodeInfo: vi.fn(),
}))

import { writeFs } from '../api/client'
import { runWorkflow, getTaskStatus, getTaskLogs, cancelWorkflow } from '../api/workflow'
import { extractVideoFrame, extractVideoFrameAtTime, concatVideo, trimVideo, getCanvasNodeInfo } from './api'
import type { CanvasNodeData } from './types'

const TARGET = { kind: 'scene' as const, episode: '1', shot: '1' }
/** 画布 1/1 的任务持久化键（localStorage） */
const TASK_KEY = 'dsh.asset-canvas.tasks.p:prompt/scene/1/1/canvas.json'

/** 完成态任务响应（getTaskStatus mock 常用） */
const COMPLETED_TASK = {
  taskId: 'task-1', status: 'completed', result: { path: 'x' }, errorMsg: undefined,
  workflowId: 'image-edit', impl: '', createdAt: '', updatedAt: '',
}
/** 运行态任务响应 */
const RUNNING_TASK = {
  taskId: 'task-1', status: 'running', result: null, errorMsg: undefined,
  workflowId: 'image-edit', impl: '', createdAt: '', updatedAt: '',
}

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
    localStorage.clear()
    ;(runWorkflow as Mock).mockResolvedValue({ taskId: 'task-1', status: 'running' })
    ;(getTaskStatus as Mock).mockResolvedValue(COMPLETED_TASK)
    ;(getTaskLogs as Mock).mockResolvedValue([])
    ;(getCanvasNodeInfo as Mock).mockResolvedValue({ exists: false, mtime: null, size: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('文生图：写入 prompt 文件、提交固定产物路径，完成后通知结果且不回写 config', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('一只猫')
    const onResult = vi.fn()
    await gen.generate(node, undefined, onResult)
    expect(writeFs).toHaveBeenCalledWith('p', 'prompt/scene/1/1/canvas/n1/prompt.md', '一只猫')
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'text-to-image',
        params: expect.objectContaining({ outputPath: 'assert/scene/1/1/canvas/n1/output.jpg' }),
      }),
    )
    // 首轮立即查询：冲刷微任务即可完成
    await vi.advanceTimersByTimeAsync(1)
    expect(gen.statusByNode.value.n1?.status).toBe('success')
    expect(onResult).toHaveBeenCalledWith('n1', 'assert/scene/1/1/canvas/n1/output.jpg')
    // 任务到达终态：持久化记录已清除
    expect(localStorage.getItem(TASK_KEY)).toBeNull()
  })

  it('图生图：使用 image-edit 并传入 imagePaths', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('改成夜景', 'image-edit')
    gen.setInputPaths('n1', ['assert/stage/街角/白天.jpg'])
    await gen.generate(node)
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
    await gen.generate(node)
    expect(writeFs).toHaveBeenCalledWith('p', 'prompt/stage/街角/canvas/白天/n1/prompt.md', '打开正门')
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'text-to-image',
        params: expect.objectContaining({ outputPath: 'assert/stage/街角/canvas/白天/n1/output.jpg' }),
      }),
    )
  })

  it('生成失败进入 error 状态且不通知结果', async () => {
    ;(getTaskStatus as Mock).mockResolvedValue({ taskId: 'task-1', status: 'failed', result: null, errorMsg: '失败', workflowId: 'image-edit', impl: '', createdAt: '', updatedAt: '' })
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('x', 'image-edit')
    gen.setInputPaths('n1', ['assert/a.jpg'])
    const onResult = vi.fn()
    await gen.generate(node, undefined, onResult)
    await vi.advanceTimersByTimeAsync(2100)
    expect(gen.statusByNode.value.n1.status).toBe('error')
    expect(gen.statusByNode.value.n1.errorMsg).toBe('失败')
    expect(onResult).not.toHaveBeenCalled()
  })

  it('视频节点：走自包含提交参数并提交固定 .mp4 产物路径', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'vg', prototypeId: 'video-generate', name: '生成视频', x: 0, y: 0, width: 240, height: 160,
      config: { workflowImpl: 'ceb-ltx-2.3-director', workflowParams: { seed: '1' } },
    }
    const videoParams = { mode: 'director' as const, resolution: { width: 1080, height: 1920 }, duration: 10, prompt: 'p', extraParams: {} }
    await gen.generate(node, videoParams)
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'image-to-video',
        impl: 'ceb-ltx-2.3-director',
        params: expect.objectContaining({
          outputPath: 'assert/scene/1/1/canvas/vg/output.mp4',
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
    await gen.generate(node)
    expect(runWorkflow).not.toHaveBeenCalled()
    expect(gen.statusByNode.value.vg?.status).toBe('error')
    expect(gen.statusByNode.value.vg?.errorMsg).toBe('缺少视频提交参数')
  })

  it('TTS 声音生成（设计模式）：tts-voice-design + prompt/text + .flac 产物', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'tg', prototypeId: 'tts-generate', name: 'TTS声音生成', x: 0, y: 0, width: 240, height: 160,
      config: { mode: 'design', text: '你好', prompt: '温柔女声', workflowImpl: 'ceb-tts_voice_design' },
    }
    await gen.generate(node)
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'tts-voice-design',
        impl: 'ceb-tts_voice_design',
        params: expect.objectContaining({
          vars: expect.objectContaining({ text: '你好', prompt: '温柔女声' }),
          outputPath: 'assert/scene/1/1/canvas/tg/output.flac',
        }),
      }),
    )
  })

  it('TTS 声音生成（克隆模式）：tts-voice-clone + refAudioPath + .flac 产物', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'tg', prototypeId: 'tts-generate', name: 'TTS声音生成', x: 0, y: 0, width: 240, height: 160,
      config: { mode: 'clone', text: '你好', refText: '参考文本', workflowImpl: 'ceb-tts_voice_clone' },
    }
    gen.setInputPaths('tg', ['assert/custom/ref.flac'])
    await gen.generate(node)
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'tts-voice-clone',
        impl: 'ceb-tts_voice_clone',
        params: expect.objectContaining({
          vars: expect.objectContaining({ text: '你好', refText: '参考文本', refAudioPath: '["assert/custom/ref.flac"]' }),
          outputPath: 'assert/scene/1/1/canvas/tg/output.flac',
        }),
      }),
    )
  })

  it('TTS 声音生成（克隆模式）无音频输入：error 且不调用 runWorkflow', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'tg', prototypeId: 'tts-generate', name: 'TTS声音生成', x: 0, y: 0, width: 240, height: 160,
      config: { mode: 'clone', text: '你好', refText: '参考文本' },
    }
    await gen.generate(node)
    expect(runWorkflow).not.toHaveBeenCalled()
    expect(gen.statusByNode.value.tg?.status).toBe('error')
    expect(gen.statusByNode.value.tg?.errorMsg).toContain('需先连接音频输入')
  })

  it('拼接视频节点：调用服务端 concat-video 并通知 .mp4 结果', async () => {
    ;(concatVideo as Mock).mockResolvedValue({ success: true, path: 'assert/scene/1/1/canvas/vc/output.mp4' })
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'vc', prototypeId: 'video-concat', name: '拼接视频', x: 0, y: 0, width: 240, height: 160,
      config: {},
    }
    const onResult = vi.fn()
    await gen.concatVideo(node, ['assert/a.mp4', 'assert/b.mp4'], onResult)
    expect(concatVideo).toHaveBeenCalledWith('p', ['assert/a.mp4', 'assert/b.mp4'], 'assert/scene/1/1/canvas/vc/output.mp4')
    expect(gen.statusByNode.value.vc?.status).toBe('success')
    expect(onResult).toHaveBeenCalledWith('vc', 'assert/scene/1/1/canvas/vc/output.mp4')
  })

  it('拼接视频节点：失败进入 error 状态', async () => {
    ;(concatVideo as Mock).mockRejectedValue(new Error('各段规格不一致，无法无损拼接'))
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'vc', prototypeId: 'video-concat', name: '拼接视频', x: 0, y: 0, width: 240, height: 160,
      config: {},
    }
    const onResult = vi.fn()
    await gen.concatVideo(node, ['assert/a.mp4', 'assert/b.mp4'], onResult)
    expect(gen.statusByNode.value.vc?.status).toBe('error')
    expect(gen.statusByNode.value.vc?.errorMsg).toContain('各段规格不一致')
    expect(onResult).not.toHaveBeenCalled()
  })

  it('中断：停止轮询并调用 cancelWorkflow，同时清除持久化记录', async () => {
    // 任务保持 running（避免首轮立即查询进入完成态与中断断言竞态）
    ;(getTaskStatus as Mock).mockResolvedValue(RUNNING_TASK)
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('一只猫')
    gen.setInputPaths('n1', ['assert/a.jpg'])
    await gen.generate(node)
    await vi.advanceTimersByTimeAsync(1) // 让首轮立即查询先落定（任务保持 running）
    expect(localStorage.getItem(TASK_KEY)).toContain('n1')
    await gen.interrupt('n1')
    expect(cancelWorkflow).toHaveBeenCalledWith('task-1')
    expect(gen.statusByNode.value.n1?.status).toBe('error')
    expect(gen.statusByNode.value.n1?.errorMsg).toBe('已中断')
    expect(localStorage.getItem(TASK_KEY)).toBeNull()
  })

  it('cancelWorkflow 失败不阻断状态展示', async () => {
    ;(getTaskStatus as Mock).mockResolvedValue(RUNNING_TASK)
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('一只猫')
    gen.setInputPaths('n1', ['assert/a.jpg'])
    await gen.generate(node)
    await vi.advanceTimersByTimeAsync(1) // 让首轮立即查询先落定（任务保持 running）
    ;(cancelWorkflow as Mock).mockRejectedValueOnce(new Error('boom'))
    await expect(gen.interrupt('n1')).resolves.toBeUndefined()
    expect(gen.statusByNode.value.n1?.errorMsg).toBe('已中断')
  })

  it('裁剪视频节点：按时间调用 trim-video，产物固定 output.mp4，成功后通知结果', async () => {
    ;(trimVideo as Mock).mockResolvedValue({ success: true, path: 'assert/scene/1/1/canvas/vt/output.mp4' })
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'vt', prototypeId: 'video-trim', name: '裁剪视频', x: 0, y: 0, width: 240, height: 160,
      config: { startMode: 'time', startValue: 1.5, duration: 2 },
    }
    const onResult = vi.fn()
    await gen.trimVideo(node, 'assert/v.mp4', onResult)
    expect(trimVideo).toHaveBeenCalledWith(
      'p',
      'assert/v.mp4',
      { startTime: 1.5, duration: 2 },
      'assert/scene/1/1/canvas/vt/output.mp4',
    )
    expect(gen.statusByNode.value.vt?.status).toBe('success')
    expect(onResult).toHaveBeenCalledWith('vt', 'assert/scene/1/1/canvas/vt/output.mp4')
  })

  it('裁剪视频节点：帧模式传 startFrame', async () => {
    ;(trimVideo as Mock).mockResolvedValue({ success: true, path: 'assert/scene/1/1/canvas/vt/output.mp4' })
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'vt', prototypeId: 'video-trim', name: '裁剪视频', x: 0, y: 0, width: 240, height: 160,
      config: { startMode: 'frame', startValue: 12, duration: 0.5 },
    }
    await gen.trimVideo(node, 'assert/v.mp4')
    expect(trimVideo).toHaveBeenCalledWith(
      'p',
      'assert/v.mp4',
      { startFrame: 12, duration: 0.5 },
      'assert/scene/1/1/canvas/vt/output.mp4',
    )
  })

  it('裁剪视频节点：失败进入 error 状态且不通知结果', async () => {
    ;(trimVideo as Mock).mockRejectedValueOnce(new Error('起始位置越界'))
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'vt', prototypeId: 'video-trim', name: '裁剪视频', x: 0, y: 0, width: 240, height: 160,
      config: { startMode: 'time', startValue: 99, duration: 1 },
    }
    const onResult = vi.fn()
    await gen.trimVideo(node, 'assert/v.mp4', onResult)
    expect(gen.statusByNode.value.vt?.status).toBe('error')
    expect(gen.statusByNode.value.vt?.errorMsg).toBe('起始位置越界')
    expect(onResult).not.toHaveBeenCalled()
  })

  it('获取视频帧：调用 extractVideoFrame 并通知 .png 结果', async () => {
    ;(extractVideoFrame as Mock).mockResolvedValue({ success: true, path: 'assert/scene/1/1/canvas/ef/output.png' })
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'ef', prototypeId: 'video-frame-extract', name: '获取视频帧', x: 0, y: 0, width: 240, height: 160,
      config: { frameIndex: -1 },
    }
    const onResult = vi.fn()
    await gen.extractFrame(node, 'assert/scene/1/1/canvas/vg/output.mp4', onResult)
    expect(extractVideoFrame).toHaveBeenCalledWith('p', 'assert/scene/1/1/canvas/vg/output.mp4', -1, 'assert/scene/1/1/canvas/ef/output.png')
    expect(gen.statusByNode.value.ef?.status).toBe('success')
    expect(onResult).toHaveBeenCalledWith('ef', 'assert/scene/1/1/canvas/ef/output.png')
  })

  it('获取视频帧：config.frameTime 存在时按时间点提取（extractVideoFrameAtTime）', async () => {
    ;(extractVideoFrameAtTime as Mock).mockResolvedValue({ success: true, path: 'assert/scene/1/1/canvas/ef/output.png' })
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'ef', prototypeId: 'video-frame-extract', name: '获取视频帧', x: 0, y: 0, width: 240, height: 160,
      config: { frameIndex: 12, frameTime: 2.5 },
    }
    await gen.extractFrame(node, 'assert/v.mp4')
    expect(extractVideoFrameAtTime).toHaveBeenCalledWith('p', 'assert/v.mp4', 2.5, 'assert/scene/1/1/canvas/ef/output.png')
    expect(extractVideoFrame).not.toHaveBeenCalled()
    expect(gen.statusByNode.value.ef?.status).toBe('success')
  })

  it('获取视频帧：提取失败进入 error 状态且不通知结果', async () => {
    ;(extractVideoFrame as Mock).mockRejectedValueOnce(new Error('帧索引越界'))
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'ef', prototypeId: 'video-frame-extract', name: '获取视频帧', x: 0, y: 0, width: 240, height: 160,
      config: { frameIndex: 999 },
    }
    const onResult = vi.fn()
    await gen.extractFrame(node, 'assert/v.mp4', onResult)
    expect(gen.statusByNode.value.ef?.status).toBe('error')
    expect(gen.statusByNode.value.ef?.errorMsg).toBe('帧索引越界')
    expect(onResult).not.toHaveBeenCalled()
  })

  it('switchTarget 重置全部状态（切画布后不再持有旧轮询/任务）', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('x')
    await gen.generate(node)
    expect(gen.statusByNode.value.n1?.status).toBeTruthy()
    await gen.switchTarget({ kind: 'scene', episode: '2', shot: '3' })
    expect(gen.statusByNode.value).toEqual({})
    expect(gen.computeOutputPath(node)).toBe('assert/scene/2/3/canvas/n1/output.jpg')
  })

  // ── 运行中任务持久化与恢复（离开画布 / 刷新页面后继续显示 loading）────────

  it('任务运行中持久化到 localStorage，模拟刷新后恢复 loading 并继续轮询到完成', async () => {
    ;(getTaskStatus as Mock).mockResolvedValue(RUNNING_TASK)
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('x', 'image-edit')
    gen.setInputPaths('n1', ['assert/a.jpg'])
    await gen.generate(node)
    await vi.advanceTimersByTimeAsync(1) // 首轮查询落定（running）
    // 运行中记录已持久化
    expect(localStorage.getItem(TASK_KEY)).toContain('n1')
    expect(gen.statusByNode.value.n1?.status).toBe('running')

    // 模拟离开画布/刷新：新建组合式实例（旧实例内存态被丢弃），恢复后继续显示 loading
    const onResult = vi.fn()
    const gen2 = useCanvasGeneration('p', TARGET, { onResult })
    await gen2.restore()
    await vi.advanceTimersByTimeAsync(1)
    expect(gen2.statusByNode.value.n1?.status).toBe('running')

    // 服务端任务随后完成：恢复实例的轮询收敛为 success、通知结果并清除记录
    ;(getTaskStatus as Mock).mockResolvedValue(COMPLETED_TASK)
    await vi.advanceTimersByTimeAsync(2000)
    expect(gen2.statusByNode.value.n1.status).toBe('success')
    expect(onResult).toHaveBeenCalledWith('n1', 'assert/scene/1/1/canvas/n1/output.jpg')
    expect(localStorage.getItem(TASK_KEY)).toBeNull()
  })

  it('恢复时任务已完成：直接收敛为 success 并通知结果、清除记录', async () => {
    localStorage.setItem(
      TASK_KEY,
      JSON.stringify({ n1: { kind: 'workflow', taskId: 'task-1', outputPath: 'assert/scene/1/1/canvas/n1/output.jpg', startedAt: Date.now() } }),
    )
    const onResult = vi.fn()
    const gen = useCanvasGeneration('p', TARGET, { onResult })
    await gen.restore()
    await vi.advanceTimersByTimeAsync(1)
    expect(gen.statusByNode.value.n1?.status).toBe('success')
    expect(onResult).toHaveBeenCalledWith('n1', 'assert/scene/1/1/canvas/n1/output.jpg')
    expect(localStorage.getItem(TASK_KEY)).toBeNull()
  })

  it('恢复时任务已失败：收敛为 error 并清除记录', async () => {
    ;(getTaskStatus as Mock).mockResolvedValue({ ...RUNNING_TASK, status: 'failed', errorMsg: '生成失败' })
    localStorage.setItem(
      TASK_KEY,
      JSON.stringify({ n1: { kind: 'workflow', taskId: 'task-1', outputPath: 'assert/scene/1/1/canvas/n1/output.jpg', startedAt: Date.now() } }),
    )
    const gen = useCanvasGeneration('p', TARGET)
    await gen.restore()
    await vi.advanceTimersByTimeAsync(1)
    expect(gen.statusByNode.value.n1?.status).toBe('error')
    expect(gen.statusByNode.value.n1?.errorMsg).toBe('生成失败')
    expect(localStorage.getItem(TASK_KEY)).toBeNull()
  })

  it('切换画布后内存状态清空但持久化记录保留，切回时恢复 loading', async () => {
    ;(getTaskStatus as Mock).mockResolvedValue(RUNNING_TASK)
    const gen = useCanvasGeneration('p', TARGET)
    const node = makeNode('x', 'image-edit')
    gen.setInputPaths('n1', ['assert/a.jpg'])
    await gen.generate(node)
    await vi.advanceTimersByTimeAsync(1)
    expect(localStorage.getItem(TASK_KEY)).toContain('n1')

    // 切到另一张画布：内存清空，本画布记录保留（任务仍在服务端执行）
    await gen.switchTarget({ kind: 'scene', episode: '2', shot: '3' })
    expect(gen.statusByNode.value).toEqual({})
    expect(localStorage.getItem(TASK_KEY)).toContain('n1')

    // 切回本画布：恢复 loading 展示并继续轮询
    await gen.switchTarget(TARGET)
    expect(gen.statusByNode.value.n1?.status).toBe('running')
  })

  it('ffmpeg 任务运行中持久化（含产物基线），刷新后按产物 mtime 变化恢复为 success', async () => {
    // 请求永不返回：模拟页面在服务端处理期间离开/刷新
    ;(extractVideoFrame as Mock).mockImplementation(() => new Promise(() => {}))
    // 提交前基线：产物已存在，mtime=100
    ;(getCanvasNodeInfo as Mock).mockResolvedValue({ exists: true, mtime: 100, size: 1 })
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'ef', prototypeId: 'video-frame-extract', name: '获取视频帧', x: 0, y: 0, width: 240, height: 160,
      config: { frameIndex: 0 },
    }
    void gen.extractFrame(node, 'assert/v.mp4')
    await vi.advanceTimersByTimeAsync(1) // 基线查询完成 → running 记录持久化
    expect(gen.statusByNode.value.ef?.status).toBe('running')
    expect(localStorage.getItem(TASK_KEY)).toContain('ef')

    // 模拟刷新：新实例恢复 → 产物 mtime 已更新为 200（服务端写盘完成）→ 收敛 success
    ;(getCanvasNodeInfo as Mock).mockResolvedValue({ exists: true, mtime: 200, size: 2 })
    const onResult = vi.fn()
    const gen2 = useCanvasGeneration('p', TARGET, { onResult })
    await gen2.restore()
    await vi.advanceTimersByTimeAsync(1)
    expect(gen2.statusByNode.value.ef?.status).toBe('success')
    expect(onResult).toHaveBeenCalledWith('ef', 'assert/scene/1/1/canvas/ef/output.png')
    expect(localStorage.getItem(TASK_KEY)).toBeNull()
  })

  it('ffmpeg 任务：中断后清除持久化记录并保持已中断错误态', async () => {
    ;(getCanvasNodeInfo as Mock).mockResolvedValue({ exists: false, mtime: null, size: null })
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'ef', prototypeId: 'video-frame-extract', name: '获取视频帧', x: 0, y: 0, width: 240, height: 160,
      config: { frameIndex: 0 },
    }
    // 请求挂起不返回（模拟服务端仍在处理）
    ;(extractVideoFrame as Mock).mockImplementation(() => new Promise(() => {}))
    const p = gen.extractFrame(node, 'assert/v.mp4')
    await vi.advanceTimersByTimeAsync(1)
    expect(localStorage.getItem(TASK_KEY)).toContain('ef')
    await gen.interrupt('ef')
    expect(gen.statusByNode.value.ef?.status).toBe('error')
    expect(gen.statusByNode.value.ef?.errorMsg).toBe('已中断')
    expect(localStorage.getItem(TASK_KEY)).toBeNull()
    p.catch(() => {}) // 挂起请求防未处理拒绝
  })
})
