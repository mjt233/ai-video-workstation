import client from './client'

export interface WorkflowInfo {
  id: string
  name: string
  implementations: { impl: string; name: string; description?: string }[]
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

export async function runWorkflow(body: WorkflowRunParams): Promise<{ taskId: string; status: string }> {
  const { data } = await client.post<{ taskId: string; status: string }>('/workflow/run', body)
  return data
}

export async function getTaskStatus(taskId: string): Promise<TaskResponse> {
  const { data } = await client.get<TaskResponse>(`/workflow/tasks/${taskId}`)
  return data
}

export async function listTasks(project?: string, status?: string): Promise<TaskResponse[]> {
  const params = new URLSearchParams()
  if (project) params.set('project', project)
  if (status) params.set('status', status)
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
