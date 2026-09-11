import { ref, watch, onUnmounted, type Ref } from 'vue'
import { getTaskStatus, getTaskLogs, type TaskResponse, type LogEntry } from '../api/workflow'

/**
 * 工作流任务轮询（生成对话框 / 批量任务详情用）。
 *
 * 日志按 `limit` 拉取尾部片段（默认 200 条）：任务日志可达上千行，全量拉取既慢又无意义
 * （对话框只展示最近若干条）。需要完整日志时由日志查看器显式请求全量。
 */

/** 单次拉取的日志条数上限（尾部片段） */
const LOG_TAIL_LIMIT = 200

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
        getTaskLogs(id, { limit: LOG_TAIL_LIMIT }).then(r => { logs.value = r.logs }).catch(() => {})
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
        logs.value = (await getTaskLogs(id, { limit: LOG_TAIL_LIMIT })).logs

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
