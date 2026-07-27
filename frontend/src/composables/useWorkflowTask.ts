import { ref, watch, onUnmounted, type Ref } from 'vue'
import { getTaskStatus, getTaskLogs, type TaskResponse, type LogEntry } from '../api/workflow'

export function useWorkflowTask(taskId: Ref<string | null>) {
  const status = ref<string>('idle')
  const task = ref<TaskResponse | null>(null)
  const logs = ref<LogEntry[]>([])
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  function startPolling(id: string) {
    stopPolling()
    status.value = 'running'
    error.value = null

    // Initial fetch
    getTaskStatus(id).then(t => {
      task.value = t
      if (t.status === 'completed' || t.status === 'failed') {
        status.value = t.status
        if (t.status === 'failed') error.value = t.errorMsg ?? 'Task failed'
        // Fetch logs immediately for terminal states
        getTaskLogs(id).then(l => { logs.value = l }).catch(() => {})
        return
      }
    }).catch(() => {})

    // Poll every 2 seconds
    timer = setInterval(async () => {
      try {
        const t = await getTaskStatus(id)
        task.value = t
        status.value = t.status

        // Also fetch logs
        logs.value = await getTaskLogs(id)

        if (t.status === 'completed') {
          status.value = 'completed'
          stopPolling()
        } else if (t.status === 'failed') {
          status.value = 'failed'
          error.value = t.errorMsg ?? 'Task failed'
          stopPolling()
        }
      } catch (err: unknown) {
        console.error('Polling error:', err)
      }
    }, 2000)
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  watch(taskId, (id) => {
    if (id) startPolling(id)
    else stopPolling()
  })

  onUnmounted(stopPolling)

  return { status, task, logs, error }
}
