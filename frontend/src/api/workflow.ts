import client from './client'

export interface WorkflowInfo {
  id: string
  name: string
  implementations: { impl: string; name: string; description?: string }[]
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
