/**
 * 工作流完成通知气泡 store（模块级单例，纯内存、不持久化）。
 *
 * 职责：接收**统一任务注册表**经 WS 广播的工作流任务终态（`taskSocket.onTaskUpdate`，
 * `type === 'workflow'` 且终态为 `completed` / `failed`），在页面右下角弹出一张
 * 独立的气泡卡片（不聚合），30 秒后自动关闭，`×` 可手动关闭。
 *
 * 边界（有意如此，见 docs/canvas/notification.md）：
 * - **只覆盖工作流任务**（生成图片 / 生成视频 / TTS 声音生成）；ffmpeg / LLM 任务不弹气泡；
 * - **纯内存**：刷新页面即消失；要看历史记录用任务管理器（抽屉）的「历史」页签；
 * - **不做兜底轮询**：WS 断线窗口内完成的任务不弹气泡（任务管理器照常可查）；
 *   注册表 `finish` 每个任务只 emit 一次终态，故仅需 1 行同 taskId 守卫去重；
 * - **用户主动中断不弹**（引擎会把中断收敛为 `failed` + 原因「用户中断」），
 *   但**任何工作流终态都会自增 `workflowFinishedTick`**：任务管理器「历史」列表据此刷新
 *   （历史数据在 SQLite，不自动感知新任务）。
 */
import { ref } from 'vue'
import { taskSocket, type TaskInfo } from './taskSocket'
import { buildPreviewUrl, mediaKindOfPath, type MediaKind } from './preview'

/** 气泡自动关闭时长（毫秒）：固定 30 秒（有意不做配置项） */
export const WORKFLOW_NOTIFY_AUTO_CLOSE_MS = 30_000

/** 右下角同时最多展示的气泡数（超出时先移除最旧的一张） */
export const WORKFLOW_NOTIFY_MAX = 3

/** 引擎对「用户主动中断」写入的失败原因（该终态不弹气泡） */
export const USER_CANCEL_REASON = '用户中断'

/** 失败任务缺少原因时的兜底文案 */
const FAILED_FALLBACK_MSG = '执行失败（详见任务管理器 → 历史）'

/** 单张气泡卡片的数据（全部来自任务终态广播，无需额外请求） */
export interface WorkflowNotifyItem {
  /** 任务 id（同任务只保留一张卡片） */
  taskId: string
  /** 标题：工作流实现名（服务端广播的 `label`） */
  title: string
  /** 副标题：项目 + 画布定位 + 节点短号（无定位信息时为空串） */
  subtitle: string
  /** 项目名（拼产物预览 URL 用） */
  project: string
  /** 产物相对路径（失败任务为空串） */
  outputPath: string
  /** 产物媒体类型（失败任务恒为 `none`） */
  mediaKind: MediaKind
  /** 产物预览 URL（带缓存键；无产物时为空串） */
  mediaUrl: string
  /** 终态：completed → success；failed → failed */
  status: 'success' | 'failed'
  /** 失败原因（仅 failed；广播未携带原因时为兜底文案） */
  errorMsg: string
  /** 入栈时间（毫秒时间戳） */
  createdAt: number
}

/** 当前展示的气泡（新任务追加在末尾，即视觉上的最下方） */
const notifications = ref<WorkflowNotifyItem[]>([])

/**
 * 工作流终态计数器（含用户中断与失败）。
 *
 * 与气泡列表解耦：只要有一个工作流任务收敛，就自增一次，供任务管理器（抽屉）
 * 监听后刷新「历史」列表 —— 历史数据来自 SQLite，不自动感知新任务
 * （见 `TaskManagerDrawer` 的 `historyReloadToken`）。
 */
const workflowFinishTick = ref(0)

/** taskId → 自动关闭定时器 */
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * 清理某张卡片的自动关闭定时器。
 *
 * @param taskId 任务 id
 */
function clearTimer(taskId: string): void {
  const timer = timers.get(taskId)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(taskId)
  }
}

/**
 * 关闭一张气泡卡片（`×` 手动关闭与 30 秒超时共用）。
 *
 * @param taskId 任务 id
 */
export function dismissWorkflowNotify(taskId: string): void {
  clearTimer(taskId)
  notifications.value = notifications.value.filter((n) => n.taskId !== taskId)
}

/** 清空全部气泡与定时器，并复位终态计数器（单测复位用；正常流程不会整批关闭） */
export function resetWorkflowNotify(): void {
  for (const taskId of [...timers.keys()]) clearTimer(taskId)
  notifications.value = []
  workflowFinishTick.value = 0
}

/**
 * 组装副标题：项目 + 画布定位 + 节点短号。
 *
 * @param task 任务摘要
 * @returns 副标题文本（无任何定位信息时为空串，调用方不渲染该行）
 */
function subtitleOf(task: TaskInfo): string {
  const parts: string[] = []
  if (task.project) parts.push(task.project)
  const c = task.canvas
  if (c) {
    parts.push(
      c.kind === 'scene'
        ? `分镜第${c.episode ?? ''}集 ${c.shot ?? ''}#`
        : `场景 ${c.stage ?? ''} / ${c.label ?? ''}`,
    )
  }
  if (task.nodeId) parts.push(`节点 ${task.nodeId.slice(0, 8)}`)
  return parts.join(' · ')
}

/**
 * 推送一张完成气泡（非工作流任务 / 非终态 / 用户中断 / 重复 taskId 直接忽略）。
 *
 * 产物路径取自任务 `payload.outputPath`（引擎登记注册表时写入），预览 URL 以
 * 「入栈时刻」作缓存键 —— 生成产物是固定文件名 `output.{ext}`，不带版本号会导致
 * 浏览器复用上一次的缓存图。
 *
 * **无论是否弹卡片**，工作流终态都会自增 `workflowFinishTick`：用户中断的任务虽不弹
 * 气泡，但它在任务管理器「历史」里是一条新记录，同样需要刷新列表。
 *
 * @param task 任务摘要（WS `task-update` 广播载荷）
 */
export function pushWorkflowFinished(task: TaskInfo): void {
  if (task.type !== 'workflow') return
  if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') return
  workflowFinishTick.value += 1
  // 已中断（cancelled 终态，或引擎收敛的「用户中断」失败）：画布节点已有「已中断」反馈，不弹气泡
  if (task.status === 'cancelled' || task.error === USER_CANCEL_REASON) return
  // 注册表 finish 每任务只广播一次；守卫覆盖「同一 taskId 被重复推送」的异常情况
  if (notifications.value.some((n) => n.taskId === task.id)) return

  const project = task.project ?? ''
  const outputPath = task.status === 'completed' && typeof task.payload?.outputPath === 'string'
    ? task.payload.outputPath
    : ''
  const item: WorkflowNotifyItem = {
    taskId: task.id,
    title: task.label,
    subtitle: subtitleOf(task),
    project,
    outputPath,
    mediaKind: outputPath ? mediaKindOfPath(outputPath) : 'none',
    mediaUrl: outputPath && project ? buildPreviewUrl(project, outputPath, Date.now()) : '',
    status: task.status === 'completed' ? 'success' : 'failed',
    errorMsg: task.status === 'failed' ? (task.error || FAILED_FALLBACK_MSG) : '',
    createdAt: Date.now(),
  }

  // 超出上限：先移除最旧的一张（并清掉它的定时器，避免其超时回调误伤新卡片）
  const next = [...notifications.value, item]
  while (next.length > WORKFLOW_NOTIFY_MAX) {
    const dropped = next.shift()
    if (dropped) clearTimer(dropped.taskId)
  }
  notifications.value = next
  timers.set(task.id, setTimeout(() => dismissWorkflowNotify(task.id), WORKFLOW_NOTIFY_AUTO_CLOSE_MS))
}

/**
 * 订阅统一任务广播并推送完成气泡（App 挂载时调用一次）。
 *
 * @returns 取消订阅函数（组件卸载时调用）
 */
export function installWorkflowNotifyListener(): () => void {
  return taskSocket.onTaskUpdate((task) => pushWorkflowFinished(task))
}

/** 当前气泡列表（只读消费：`WorkflowNotifyStack.vue`） */
export const workflowNotifications = notifications

/** 工作流终态计数器（只读消费：`TaskManagerDrawer.vue` 据此刷新「历史」列表） */
export const workflowFinishedTick = workflowFinishTick
