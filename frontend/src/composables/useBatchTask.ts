import { ref, watch, onUnmounted, reactive, type Ref } from 'vue'
import { getBatchStatus, listTasks, type BatchSummary, type TaskResponse } from '../api/workflow'

export function useBatchTask(batchId: Ref<string | null>) {
  const summary = reactive<BatchSummary>({
    batch_id: '',
    project: '',
    total: 0,
    completed: 0,
    failed: 0,
    running: 0,
    pending: 0,
  })
  const tasks = ref<TaskResponse[]>([])
  const loading = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  function startPolling(id: string) {
    stopPolling()
    loading.value = true

    const poll = async () => {
      try {
        const [s, t] = await Promise.all([
          getBatchStatus(id),
          listTasks(undefined, undefined, id),
        ])
        Object.assign(summary, s)
        tasks.value = t

        // Auto-stop when all tasks are done
        if (s.completed + s.failed === s.total && s.total > 0) {
          stopPolling()
        }
      } catch (err) {
        console.error('Batch polling error:', err)
      } finally {
        loading.value = false
      }
    }

    // Initial fetch
    poll()

    // Poll every 2 seconds
    timer = setInterval(poll, 2000)
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  watch(batchId, (id) => {
    if (id) startPolling(id)
    else stopPolling()
  })

  onUnmounted(stopPolling)

  return { summary, tasks, loading }
}
