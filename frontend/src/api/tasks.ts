import client from './client'

/** 统一任务摘要（与服务端 tasks 广播一致） */
export interface TaskInfo {
  /** 任务 id */
  id: string
  /** 任务类型 */
  type: 'workflow' | 'llm' | 'ffmpeg'
  /** 展示名 */
  label: string
  /** 状态 */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  /** 进度百分比（0~100）；缺省表示不确定进度 */
  progress?: number
  /** 登记时间（毫秒时间戳） */
  startedAt: number
  /** 项目名 */
  project?: string
  /** 发起节点 id */
  nodeId?: string
  /** 画布定位 */
  canvas?: { kind: 'scene' | 'stage'; episode?: string; shot?: string; stage?: string; label?: string }
  /** 是否可中断 */
  cancelable: boolean
  /** 不可中断原因 */
  cancelBlockReason?: string
  /** 类型自有字段 */
  payload?: Record<string, unknown>
  /** 错误信息（仅 failed） */
  error?: string
  /** LLM 会话阶段（仅 type=llm） */
  phase?: 'thinking' | 'responding'
  /** LLM 模型名（仅 type=llm） */
  modelName?: string
}

/**
 * 查询当前活跃任务（WS 不可用时的降级/调试路径；任务管理器主通道为 WS 广播）。
 *
 * @param project 可选项目名过滤
 * @returns 活跃任务列表
 */
export async function listTasks(project?: string): Promise<TaskInfo[]> {
  const { data } = await client.get<{ tasks: TaskInfo[] }>('/tasks', {
    params: project ? { project } : {},
  })
  return data.tasks
}

/**
 * 中断任务（统一入口）：服务端路由到对应执行器的中断实现（ffmpeg kill 子进程 /
 * LLM abort 上游 / 工作流 Bridge 取消）；幂等，任务已结束返回 404。
 *
 * @param taskId 任务 id
 */
export async function cancelTask(taskId: string): Promise<void> {
  await client.post(`/tasks/${encodeURIComponent(taskId)}/cancel`)
}
