import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useCanvasGeneration } from './useCanvasGeneration'

vi.mock('../api/client', () => ({ writeFs: vi.fn() }))
vi.mock('../api/workflow', () => ({
  runWorkflow: vi.fn(),
  getTaskStatus: vi.fn(),
  getTaskLogs: vi.fn(),
}))
vi.mock('../api/tasks', () => ({ cancelTask: vi.fn(), listTasks: vi.fn() }))
vi.mock('./api', () => ({
  extractVideoFrame: vi.fn(),
  extractVideoFrameAtTime: vi.fn(),
  concatVideo: vi.fn(),
  trimVideo: vi.fn(),
  trimAudio: vi.fn(),
  getCanvasNodeInfo: vi.fn(),
}))

import { writeFs } from '../api/client'
import { runWorkflow, getTaskStatus, getTaskLogs } from '../api/workflow'
import { cancelTask } from '../api/tasks'
import { extractVideoFrame, extractVideoFrameAtTime, concatVideo, trimVideo, trimAudio } from './api'
import { taskSocket, type TaskInfo } from './taskSocket'
import type { CanvasNodeData } from './types'

const TARGET = { kind: 'scene' as const, episode: '1', shot: '1' }

/** 完成态工作流任务响应（getTaskStatus mock 常用） */
const COMPLETED_TASK = {
  taskId: 'task-1', status: 'completed', result: { path: 'x' }, errorMsg: undefined,
  workflowId: 'image-edit', impl: '', createdAt: '', updatedAt: '',
}
/** 运行态工作流任务响应 */
const RUNNING_TASK = {
  taskId: 'task-1', status: 'running', result: null, errorMsg: undefined,
  workflowId: 'image-edit', impl: '', createdAt: '', updatedAt: '',
}

/**
 * 构造统一任务摘要（ffmpeg 任务广播用）。
 *
 * @param patch 覆盖字段
 * @returns 任务摘要
 */
function ffmpegTask(patch: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: 'ff-1',
    type: 'ffmpeg',
    label: '拼接视频',
    status: 'running',
    startedAt: Date.now(),
    project: 'p',
    nodeId: 'vc',
    canvas: { kind: 'scene', episode: '1', shot: '1' },
    cancelable: true,
    ...patch,
  }
}

/**
 * 模拟服务端任务广播：更新 taskSocket.tasks 并触发增量监听器。
 *
 * @param task 任务摘要
 */
function emitTaskUpdate(task: TaskInfo): void {
  const list = taskSocket.tasks.value.filter((t) => t.id !== task.id)
  taskSocket.tasks.value = [task, ...list]
  taskSocket.emitTaskUpdateForTest(task)
}

function makeNode(prompt: string, workflowId?: string): CanvasNodeData {
  return {
    id: 'n1', prototypeId: 'image-generate', name: '生成', x: 0, y: 0, width: 240, height: 160,
    config: { prompt, workflowImpl: 'ceb-canvas-image', ...(workflowId ? { workflowId } : {}) },
  }
}

/** 拼接视频节点（config 可覆盖） */
function concatNode(config: Record<string, unknown> = {}): CanvasNodeData {
  return {
    id: 'vc', prototypeId: 'video-concat', name: '拼接视频', x: 0, y: 0, width: 240, height: 160,
    config,
  }
}

describe('useCanvasGeneration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    taskSocket.tasks.value = []
    ;(runWorkflow as Mock).mockResolvedValue({ taskId: 'task-1', status: 'running' })
    ;(getTaskStatus as Mock).mockResolvedValue(COMPLETED_TASK)
    ;(getTaskLogs as Mock).mockResolvedValue([])
    ;(concatVideo as Mock).mockResolvedValue({ taskId: 'ff-1' })
    ;(trimVideo as Mock).mockResolvedValue({ taskId: 'ff-1' })
    ;(trimAudio as Mock).mockResolvedValue({ taskId: 'ff-1' })
    ;(extractVideoFrame as Mock).mockResolvedValue({ taskId: 'ff-1' })
    ;(extractVideoFrameAtTime as Mock).mockResolvedValue({ taskId: 'ff-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it('图片节点 config.sizeConfig 随 params.sizeConfig 提交', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      ...makeNode('一只猫'),
      config: {
        prompt: '一只猫',
        workflowImpl: 'seedream-5-pro',
        sizeConfig: { ratio: '1:1', size: '2K', width: 1024, height: 1024 },
      },
    }
    await gen.generate(node)
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ sizeConfig: { ratio: '1:1', size: '2K', width: 1024, height: 1024 } }),
      }),
    )
  })

  it('图片节点未选择工作流实现：error 且不调用 runWorkflow', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = { ...makeNode('一只猫'), config: { prompt: '一只猫' } }
    await gen.generate(node)
    expect(runWorkflow).not.toHaveBeenCalled()
    expect(gen.statusByNode.value.n1?.status).toBe('error')
    expect(gen.statusByNode.value.n1?.errorMsg).toContain('工作流实现')
  })

  // ── 拼接视频节点（异步任务 + 编码方式/输出尺寸参数）────────────────────────

  it('拼接视频节点：提交异步任务并透传编码方式与输出尺寸策略', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node = concatNode({ mode: 'reencode', sizeMode: 'custom', width: 1920, height: 1080 })
    const onResult = vi.fn()

    await gen.concatVideo(node, ['assert/a.mp4', 'assert/b.mp4'], onResult)

    expect(concatVideo).toHaveBeenCalledWith(
      'p',
      ['assert/a.mp4', 'assert/b.mp4'],
      'assert/scene/1/1/canvas/vc/output.mp4',
      { mode: 'reencode', sizeMode: 'custom', width: 1920, height: 1080 },
      { nodeId: 'vc', canvas: { kind: 'scene', episode: '1', shot: '1' } },
    )
    // 提交后进入 running（终态由任务广播驱动）
    expect(gen.statusByNode.value.vc?.status).toBe('running')
    expect(gen.statusByNode.value.vc?.taskId).toBe('ff-1')

    // 服务端广播终态 completed → 收敛 success 并通知结果
    emitTaskUpdate(ffmpegTask({ status: 'completed', progress: 100 }))
    expect(gen.statusByNode.value.vc?.status).toBe('success')
    expect(onResult).toHaveBeenCalledWith('vc', 'assert/scene/1/1/canvas/vc/output.mp4')
  })

  it('拼接视频节点：缺省配置提交 reencode + max（不传 custom 宽高）', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    await gen.concatVideo(concatNode(), ['assert/a.mp4', 'assert/b.mp4'])
    expect(concatVideo).toHaveBeenCalledWith(
      'p',
      ['assert/a.mp4', 'assert/b.mp4'],
      'assert/scene/1/1/canvas/vc/output.mp4',
      { mode: 'reencode', sizeMode: 'max' },
      expect.any(Object),
    )
  })

  it('拼接视频节点：copy 模式只提交 mode（不传尺寸策略）', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    await gen.concatVideo(concatNode({ mode: 'copy', sizeMode: 'custom', width: 1920, height: 1080 }), [
      'assert/a.mp4',
      'assert/b.mp4',
    ])
    expect(concatVideo).toHaveBeenCalledWith(
      'p',
      ['assert/a.mp4', 'assert/b.mp4'],
      'assert/scene/1/1/canvas/vc/output.mp4',
      { mode: 'copy' },
      expect.any(Object),
    )
  })

  it('拼接视频节点：提交失败进入 error 状态', async () => {
    ;(concatVideo as Mock).mockRejectedValueOnce(new Error('各段规格不一致，无法无损拼接，请改用重编码'))
    const gen = useCanvasGeneration('p', TARGET)
    const onResult = vi.fn()
    await gen.concatVideo(concatNode({ mode: 'copy' }), ['assert/a.mp4', 'assert/b.mp4'], onResult)
    expect(gen.statusByNode.value.vc?.status).toBe('error')
    expect(gen.statusByNode.value.vc?.errorMsg).toContain('各段规格不一致')
    expect(onResult).not.toHaveBeenCalled()
  })

  it('拼接视频节点：任务广播 failed → 收敛 error 并携带服务端错误', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    await gen.concatVideo(concatNode(), ['assert/a.mp4', 'assert/b.mp4'])
    emitTaskUpdate(ffmpegTask({ status: 'failed', error: '拼接失败：Invalid data found' }))
    expect(gen.statusByNode.value.vc?.status).toBe('error')
    expect(gen.statusByNode.value.vc?.errorMsg).toContain('Invalid data found')
  })

  it('中断：统一调用 /api/tasks/:id/cancel 并置已中断', async () => {
    ;(getTaskStatus as Mock).mockResolvedValue(RUNNING_TASK)
    const gen = useCanvasGeneration('p', TARGET)
    gen.setInputPaths('n1', ['assert/a.jpg'])
    await gen.generate(makeNode('一只猫'))
    await vi.advanceTimersByTimeAsync(1) // 首轮查询落定（保持 running）
    await gen.interrupt('n1')
    expect(cancelTask).toHaveBeenCalledWith('task-1')
    expect(gen.statusByNode.value.n1?.status).toBe('error')
    expect(gen.statusByNode.value.n1?.errorMsg).toBe('已中断')
  })

  it('cancel 失败不阻断状态展示', async () => {
    ;(getTaskStatus as Mock).mockResolvedValue(RUNNING_TASK)
    const gen = useCanvasGeneration('p', TARGET)
    gen.setInputPaths('n1', ['assert/a.jpg'])
    await gen.generate(makeNode('一只猫'))
    await vi.advanceTimersByTimeAsync(1)
    ;(cancelTask as Mock).mockRejectedValueOnce(new Error('boom'))
    await expect(gen.interrupt('n1')).resolves.toBeUndefined()
    expect(gen.statusByNode.value.n1?.errorMsg).toBe('已中断')
  })

  it('裁剪视频节点：按时间提交 trim-video 异步任务，产物固定 output.mp4', async () => {
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
      expect.any(Object),
    )
    expect(gen.statusByNode.value.vt?.status).toBe('running')
    emitTaskUpdate(ffmpegTask({ nodeId: 'vt', status: 'completed' }))
    expect(gen.statusByNode.value.vt?.status).toBe('success')
    expect(onResult).toHaveBeenCalledWith('vt', 'assert/scene/1/1/canvas/vt/output.mp4')
  })

  it('裁剪视频节点：帧模式传 startFrame', async () => {
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
      expect.any(Object),
    )
  })

  it('裁剪视频节点：提交失败进入 error 状态且不通知结果', async () => {
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

  it('裁剪音频节点：按时间提交 trim-audio（缺省「原格式」，输入 .flac → output.flac）', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'at', prototypeId: 'audio-trim', name: '裁剪音频', x: 0, y: 0, width: 240, height: 160,
      config: { startValue: 1.5, duration: 2 },
    }
    const onResult = vi.fn()
    await gen.trimAudio(node, 'assert/a.flac', onResult)
    expect(trimAudio).toHaveBeenCalledWith(
      'p',
      'assert/a.flac',
      { startTime: 1.5, duration: 2, format: '---', mp3Bitrate: 192 },
      'assert/scene/1/1/canvas/at/output.flac',
      expect.any(Object),
    )
    emitTaskUpdate(ffmpegTask({ nodeId: 'at', status: 'completed' }))
    expect(gen.statusByNode.value.at?.status).toBe('success')
    expect(onResult).toHaveBeenCalledWith('at', 'assert/scene/1/1/canvas/at/output.flac')
  })

  it('裁剪音频节点：原格式跟随输入扩展名（.wav 输入 → output.wav）', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'at', prototypeId: 'audio-trim', name: '裁剪音频', x: 0, y: 0, width: 240, height: 160,
      config: { startValue: 0, duration: 2 },
    }
    await gen.trimAudio(node, 'assert/voice.wav')
    expect(trimAudio).toHaveBeenCalledWith(
      'p',
      'assert/voice.wav',
      { startTime: 0, duration: 2, format: '---', mp3Bitrate: 192 },
      'assert/scene/1/1/canvas/at/output.wav',
      expect.any(Object),
    )
  })

  it('裁剪音频节点：显式 mp3 + 自定义码率 → output.mp3 并附带格式参数', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'at', prototypeId: 'audio-trim', name: '裁剪音频', x: 0, y: 0, width: 240, height: 160,
      config: { startValue: 0, duration: 2, format: 'mp3', mp3Bitrate: 320 },
    }
    await gen.trimAudio(node, 'assert/a.flac')
    expect(trimAudio).toHaveBeenCalledWith(
      'p',
      'assert/a.flac',
      { startTime: 0, duration: 2, format: 'mp3', mp3Bitrate: 320 },
      'assert/scene/1/1/canvas/at/output.mp3',
      expect.any(Object),
    )
  })

  it('裁剪音频节点：提交失败进入 error 状态且不通知结果', async () => {
    ;(trimAudio as Mock).mockRejectedValueOnce(new Error('起始位置越界'))
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'at', prototypeId: 'audio-trim', name: '裁剪音频', x: 0, y: 0, width: 240, height: 160,
      config: { startValue: 99, duration: 1 },
    }
    const onResult = vi.fn()
    await gen.trimAudio(node, 'assert/a.flac', onResult)
    expect(gen.statusByNode.value.at?.status).toBe('error')
    expect(gen.statusByNode.value.at?.errorMsg).toBe('起始位置越界')
    expect(onResult).not.toHaveBeenCalled()
  })

  it('获取视频帧：提交异步任务并通知 .png 结果', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'ef', prototypeId: 'video-frame-extract', name: '获取视频帧', x: 0, y: 0, width: 240, height: 160,
      config: { frameIndex: -1 },
    }
    const onResult = vi.fn()
    await gen.extractFrame(node, 'assert/scene/1/1/canvas/vg/output.mp4', onResult)
    expect(extractVideoFrame).toHaveBeenCalledWith(
      'p',
      'assert/scene/1/1/canvas/vg/output.mp4',
      -1,
      'assert/scene/1/1/canvas/ef/output.png',
      expect.any(Object),
    )
    emitTaskUpdate(ffmpegTask({ nodeId: 'ef', status: 'completed' }))
    expect(gen.statusByNode.value.ef?.status).toBe('success')
    expect(onResult).toHaveBeenCalledWith('ef', 'assert/scene/1/1/canvas/ef/output.png')
  })

  it('获取视频帧：config.frameTime 存在时按时间点提取', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    const node: CanvasNodeData = {
      id: 'ef', prototypeId: 'video-frame-extract', name: '获取视频帧', x: 0, y: 0, width: 240, height: 160,
      config: { frameIndex: 12, frameTime: 2.5 },
    }
    await gen.extractFrame(node, 'assert/v.mp4')
    expect(extractVideoFrameAtTime).toHaveBeenCalledWith(
      'p',
      'assert/v.mp4',
      2.5,
      'assert/scene/1/1/canvas/ef/output.png',
      expect.any(Object),
    )
    expect(extractVideoFrame).not.toHaveBeenCalled()
    expect(gen.statusByNode.value.ef?.status).toBe('running')
  })

  it('获取视频帧：提交失败进入 error 状态且不通知结果', async () => {
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

  // ── 服务端任务注册表驱动的恢复（刷新/切换画布后保持 loading）──────────────

  it('restore：按 项目 + 画布 scope 恢复运行中的 ffmpeg 任务，终态广播后收敛', async () => {
    taskSocket.tasks.value = [
      ffmpegTask({ nodeId: 'vc', payload: { outputPath: 'assert/scene/1/1/canvas/vc/output.mp4' } }),
      // 其他画布的任务：不恢复
      ffmpegTask({ id: 'ff-2', nodeId: 'x', canvas: { kind: 'scene', episode: '9', shot: '9' } }),
      // 其他项目的任务：不恢复
      ffmpegTask({ id: 'ff-3', nodeId: 'y', project: 'other' }),
    ]
    const onResult = vi.fn()
    const gen = useCanvasGeneration('p', TARGET, { onResult })
    await gen.restore(new Set(['vc']))

    expect(gen.statusByNode.value.vc?.status).toBe('running')
    expect(gen.statusByNode.value.x).toBeUndefined()
    expect(gen.statusByNode.value.y).toBeUndefined()

    emitTaskUpdate(
      ffmpegTask({
        nodeId: 'vc',
        status: 'completed',
        payload: { outputPath: 'assert/scene/1/1/canvas/vc/output.mp4' },
      }),
    )
    expect(gen.statusByNode.value.vc?.status).toBe('success')
    expect(onResult).toHaveBeenCalledWith('vc', 'assert/scene/1/1/canvas/vc/output.mp4')
  })

  it('restore：恢复的任务终态广播后通知结果（产物路径来自任务 payload）', async () => {
    taskSocket.tasks.value = [
      ffmpegTask({ nodeId: 'vc', payload: { outputPath: 'assert/scene/1/1/canvas/vc/output.mp4' } }),
    ]
    const onResult = vi.fn()
    const gen = useCanvasGeneration('p', TARGET, { onResult })
    await gen.restore(new Set(['vc']))
    emitTaskUpdate(
      ffmpegTask({
        nodeId: 'vc',
        status: 'completed',
        payload: { outputPath: 'assert/scene/1/1/canvas/vc/output.mp4' },
      }),
    )
    expect(onResult).toHaveBeenCalledWith('vc', 'assert/scene/1/1/canvas/vc/output.mp4')
  })

  it('restore：节点已删除的任务不恢复 loading', async () => {
    taskSocket.tasks.value = [ffmpegTask({ nodeId: 'gone' })]
    const gen = useCanvasGeneration('p', TARGET)
    await gen.restore(new Set(['vc']))
    expect(gen.statusByNode.value.gone).toBeUndefined()
  })

  it('任务广播中断态（cancelled）→ 节点显示已中断', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    await gen.concatVideo(concatNode(), ['assert/a.mp4', 'assert/b.mp4'])
    emitTaskUpdate(ffmpegTask({ status: 'cancelled' }))
    expect(gen.statusByNode.value.vc?.status).toBe('error')
    expect(gen.statusByNode.value.vc?.errorMsg).toBe('已中断')
  })

  it('进度广播更新节点阶段日志', async () => {
    const gen = useCanvasGeneration('p', TARGET)
    await gen.concatVideo(concatNode(), ['assert/a.mp4', 'assert/b.mp4'])
    emitTaskUpdate(ffmpegTask({ status: 'running', progress: 42 }))
    expect(gen.statusByNode.value.vc?.status).toBe('running')
    expect(gen.statusByNode.value.vc?.progress).toBe(42)
  })
})
