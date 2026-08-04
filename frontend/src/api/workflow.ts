import client from './client'

/** 工作流用户可手动传入的参数类型 */
export type WorkflowUserParamType = 'boolean' | 'integer' | 'float' | 'string'

/** 工作流用户参数的值类型（表单提交时保持原生类型） */
export type WorkflowUserParamValue = boolean | number | string

/**
 * 工作流用户参数声明（注册工作流时声明，前端据此渲染输入表单）。
 */
export interface WorkflowUserParamDeclaration {
  /** 参数名称（供阅读），如 "图片宽度" */
  name: string
  /** 参数字段 key（写入 vars 的字段名），如 width */
  key: string
  /** 参数类型：boolean / integer / float / string */
  type: WorkflowUserParamType
  /** 默认值（表单初始值）；空字符串表示"不传"，由工作流/项目配置决定 */
  defaultValue: WorkflowUserParamValue
  /** 可选说明文案（表单 hint） */
  description?: string
}

/** 工作流实现信息 */
export interface WorkflowImplementation {
  impl: string
  name: string
  description?: string
  /** 可由用户手动传入的参数声明 */
  params?: WorkflowUserParamDeclaration[]
  /**
   * 工作流能力声明（前端据此展示导演台等能力入口）。
   * - director：是否支持导演台模式（true 时引擎才会注入 director 负载）
   * - audio：是否支持传入外部音频（如导演台混音产物）
   */
  capabilities?: { director?: boolean; audio?: boolean }
}

export interface WorkflowInfo {
  id: string
  name: string
  implementations: WorkflowImplementation[]
}

export interface TaskParams {
  vars: Record<string, string>
  promptPaths: string[]
  outputPath: string
}

export interface TaskResponse {
  taskId: string
  workflowId: string
  impl: string
  status: string
  result: { path: string } | null
  errorMsg?: string
  createdAt: string
  updatedAt: string
  params?: TaskParams
}

export interface LogEntry {
  level: string
  message: string
  metadata?: string
  created_at: string
}

export interface WorkflowRunParams {
  project: string
  workflowId: string
  impl?: string
  params: {
    vars: Record<string, string>
    promptPaths?: string[]
    outputPath: string
    /** 用户手动传入的工作流参数（按所选实现的声明 key） */
    userParams?: Record<string, WorkflowUserParamValue>
  }
}

export async function getWorkflows(): Promise<WorkflowInfo[]> {
  const { data } = await client.get<{ workflows: WorkflowInfo[] }>('/workflows')
  return data.workflows
}

export interface BatchRunParams {
  project: string
  assetTypes: string[]
  concurrency?: number
  overwrite?: boolean
  /** 资产类型 → 工作流实现（前端勾选资产类型后手动选择） */
  implByAssetType?: Record<string, string>
  /** 资产类型 → 用户手动传入的工作流参数（按该资产类型所选实现的声明 key） */
  userParamsByAssetType?: Record<string, Record<string, WorkflowUserParamValue>>
}

export interface BatchSummary {
  batch_id: string
  project: string
  total: number
  completed: number
  failed: number
  running: number
  pending: number
}

export async function runWorkflow(body: WorkflowRunParams): Promise<{ taskId: string; status: string }> {
  const { data } = await client.post<{ taskId: string; status: string }>('/workflow/run', body)
  return data
}

export async function runBatch(body: BatchRunParams): Promise<{ batchId: string | null; totalTasks: number; project: string }> {
  const { data } = await client.post<{ batchId: string | null; totalTasks: number; project: string }>('/workflow/batch-run', body)
  return data
}

export async function getBatchStatus(batchId: string): Promise<BatchSummary> {
  const { data } = await client.get<BatchSummary>(`/workflow/batch/${batchId}`)
  return data
}

export async function getTaskStatus(taskId: string): Promise<TaskResponse> {
  const { data } = await client.get<TaskResponse>(`/workflow/tasks/${taskId}`)
  return data
}

export async function listTasks(project?: string, status?: string, batchId?: string): Promise<TaskResponse[]> {
  const params = new URLSearchParams()
  if (project) params.set('project', project)
  if (status) params.set('status', status)
  if (batchId) params.set('batchId', batchId)
  const { data } = await client.get<{ tasks: TaskResponse[] }>(`/workflow/tasks?${params}`)
  return data.tasks
}

export async function getTaskLogs(taskId: string): Promise<LogEntry[]> {
  const { data } = await client.get<{ logs: LogEntry[] }>(`/workflow/tasks/${taskId}/log`)
  return data.logs
}

export async function retryTask(taskId: string): Promise<{ taskId: string; status: string }> {
  const { data } = await client.post<{ taskId: string; status: string }>(`/workflow/retry/${taskId}`)
  return data
}
