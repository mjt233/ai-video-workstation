import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { taskSocket, type TaskInfo } from './taskSocket'
import {
  WORKFLOW_NOTIFY_AUTO_CLOSE_MS,
  WORKFLOW_NOTIFY_MAX,
  dismissWorkflowNotify,
  installWorkflowNotifyListener,
  pushWorkflowFinished,
  resetWorkflowNotify,
  workflowFinishedTick,
  workflowNotifications,
} from './notify'

/**
 * 构造工作流任务终态摘要（WS `task-update` 广播载荷形态）。
 *
 * @param patch 覆盖字段
 * @returns 任务摘要
 */
function finishedTask(patch: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: 'task-1',
    type: 'workflow',
    label: 'Bridge 文生图',
    status: 'completed',
    startedAt: Date.now(),
    project: 'p',
    nodeId: 'n1234567890',
    canvas: { kind: 'scene', episode: '1', shot: '2' },
    cancelable: false,
    payload: { outputPath: 'assert/scene/1/2/canvas/n1/output.jpg' },
    ...patch,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetWorkflowNotify()
})

afterEach(() => {
  resetWorkflowNotify()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('pushWorkflowFinished 卡片构建', () => {
  it('成功任务：标题/副标题/媒体类型/带缓存键的预览 URL', () => {
    pushWorkflowFinished(finishedTask())
    expect(workflowNotifications.value).toHaveLength(1)
    const item = workflowNotifications.value[0]
    expect(item.title).toBe('Bridge 文生图')
    expect(item.subtitle).toBe('p · 分镜第1集 2# · 节点 n1234567')
    expect(item.status).toBe('success')
    expect(item.mediaKind).toBe('image')
    expect(item.outputPath).toBe('assert/scene/1/2/canvas/n1/output.jpg')
    expect(item.mediaUrl.startsWith('/api/fs/p/assert/scene/1/2/canvas/n1/output.jpg?t=')).toBe(true)
    expect(item.errorMsg).toBe('')
  })

  it('视频产物按扩展名识别为 video', () => {
    pushWorkflowFinished(finishedTask({ payload: { outputPath: 'assert/a/output.mp4' } }))
    expect(workflowNotifications.value[0].mediaKind).toBe('video')
  })

  it('文本生成任务（无产物文件）：textTask 标记 + 无预览 URL，不误报「产物路径未知」', () => {
    pushWorkflowFinished(finishedTask({
      label: '文本工作流A',
      payload: { workflowId: 'text-generation', impl: 'custom-wf-text-inst' },
    }))
    const item = workflowNotifications.value[0]
    expect(item.status).toBe('success')
    expect(item.textTask).toBe(true)
    expect(item.outputPath).toBe('')
    expect(item.mediaKind).toBe('none')
    expect(item.mediaUrl).toBe('')
  })

  it('媒体任务不带 textTask 标记', () => {
    pushWorkflowFinished(finishedTask())
    expect(workflowNotifications.value[0].textTask).toBe(false)
  })

  it('失败任务：无预览 URL，原因为广播携带的 error', () => {
    pushWorkflowFinished(finishedTask({ status: 'failed', error: '远端任务超时', payload: {} }))
    const item = workflowNotifications.value[0]
    expect(item.status).toBe('failed')
    expect(item.mediaKind).toBe('none')
    expect(item.mediaUrl).toBe('')
    expect(item.outputPath).toBe('')
    expect(item.errorMsg).toBe('远端任务超时')
  })

  it('失败任务缺少原因时使用兜底文案', () => {
    pushWorkflowFinished(finishedTask({ status: 'failed', payload: {} }))
    expect(workflowNotifications.value[0].errorMsg).toBe('执行失败（详见任务管理器 → 历史）')
  })

  it('非终态 / 用户中断 / 非工作流任务不弹卡片', () => {
    pushWorkflowFinished(finishedTask({ status: 'running' }))
    pushWorkflowFinished(finishedTask({ id: 't2', status: 'cancelled' }))
    pushWorkflowFinished(finishedTask({ id: 't3', status: 'failed', error: '用户中断' }))
    pushWorkflowFinished(finishedTask({ id: 't4', type: 'ffmpeg' }))
    expect(workflowNotifications.value).toHaveLength(0)
  })

  it('无定位信息时副标题为空串', () => {
    pushWorkflowFinished(finishedTask({ project: undefined, canvas: undefined, nodeId: undefined }))
    expect(workflowNotifications.value[0].subtitle).toBe('')
  })

  it('同一 taskId 重复推送只保留一张卡片', () => {
    pushWorkflowFinished(finishedTask())
    pushWorkflowFinished(finishedTask())
    expect(workflowNotifications.value).toHaveLength(1)
  })
})

describe('气泡生命周期', () => {
  it('固定 30 秒后自动关闭', () => {
    pushWorkflowFinished(finishedTask())
    vi.advanceTimersByTime(WORKFLOW_NOTIFY_AUTO_CLOSE_MS - 1)
    expect(workflowNotifications.value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(workflowNotifications.value).toHaveLength(0)
  })

  it('多张卡片各自独立计时（后完成的不延长先完成的）', () => {
    pushWorkflowFinished(finishedTask({ id: 'a' }))
    vi.advanceTimersByTime(20_000)
    pushWorkflowFinished(finishedTask({ id: 'b' }))
    vi.advanceTimersByTime(10_000)
    expect(workflowNotifications.value.map((n) => n.taskId)).toEqual(['b'])
    vi.advanceTimersByTime(20_000)
    expect(workflowNotifications.value).toHaveLength(0)
  })

  it('手动关闭：立即移除且定时器不再影响其他卡片', () => {
    pushWorkflowFinished(finishedTask({ id: 'a' }))
    pushWorkflowFinished(finishedTask({ id: 'b' }))
    dismissWorkflowNotify('a')
    expect(workflowNotifications.value.map((n) => n.taskId)).toEqual(['b'])
    vi.advanceTimersByTime(30_000)
    expect(workflowNotifications.value).toHaveLength(0)
  })

  it(`最多同时展示 ${WORKFLOW_NOTIFY_MAX} 张：超出先淘汰最旧`, () => {
    pushWorkflowFinished(finishedTask({ id: 'a' }))
    vi.advanceTimersByTime(10_000)
    pushWorkflowFinished(finishedTask({ id: 'b' }))
    vi.advanceTimersByTime(10_000)
    pushWorkflowFinished(finishedTask({ id: 'c' }))
    vi.advanceTimersByTime(5_000)
    pushWorkflowFinished(finishedTask({ id: 'd' }))
    expect(workflowNotifications.value.map((n) => n.taskId)).toEqual(['b', 'c', 'd'])
    // 越过被淘汰卡片（a）原定的到期时刻：不得误伤仍在展示的卡片
    vi.advanceTimersByTime(5_000)
    expect(workflowNotifications.value.map((n) => n.taskId)).toEqual(['b', 'c', 'd'])
    vi.advanceTimersByTime(10_000)
    expect(workflowNotifications.value.map((n) => n.taskId)).toEqual(['c', 'd'])
  })
})

describe('workflowFinishedTick（任务管理器「历史」刷新信号）', () => {
  it('任何工作流终态都自增（含失败与用户中断，后者不弹卡片）', () => {
    pushWorkflowFinished(finishedTask({ id: 'ok' }))
    expect(workflowFinishedTick.value).toBe(1)
    pushWorkflowFinished(finishedTask({ id: 'bad', status: 'failed', error: '远端超时', payload: {} }))
    expect(workflowFinishedTick.value).toBe(2)
    pushWorkflowFinished(finishedTask({ id: 'cancel', status: 'failed', error: '用户中断', payload: {} }))
    expect(workflowFinishedTick.value).toBe(3)
    pushWorkflowFinished(finishedTask({ id: 'cancelled', status: 'cancelled', payload: {} }))
    expect(workflowFinishedTick.value).toBe(4)
    // 用户中断只计数、不弹卡片
    expect(workflowNotifications.value.map((n) => n.taskId)).toEqual(['ok', 'bad'])
  })

  it('非终态与非工作流任务不计数', () => {
    pushWorkflowFinished(finishedTask({ id: 'run', status: 'running' }))
    pushWorkflowFinished(finishedTask({ id: 'ff', type: 'ffmpeg' }))
    expect(workflowFinishedTick.value).toBe(0)
  })
})

describe('installWorkflowNotifyListener', () => {
  it('只消费工作流任务广播，返回的取消函数可退订', () => {
    const listeners: Array<(task: TaskInfo) => void> = []
    const off = vi.spyOn(taskSocket, 'onTaskUpdate').mockImplementation((l) => {
      listeners.push(l as (task: TaskInfo) => void)
      return () => {
        listeners.length = 0
      }
    })
    const unsubscribe = installWorkflowNotifyListener()
    expect(listeners).toHaveLength(1)
    listeners[0](finishedTask({ id: 'ff', type: 'ffmpeg' }))
    expect(workflowNotifications.value).toHaveLength(0)
    listeners[0](finishedTask({ id: 'wf' }))
    expect(workflowNotifications.value.map((n) => n.taskId)).toEqual(['wf'])
    unsubscribe()
    expect(listeners).toHaveLength(0)
    off.mockRestore()
  })
})
