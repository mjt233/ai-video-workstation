import { reactive, ref, type Ref } from 'vue'
import { getTaskLogs, type LogEntry } from '../api/workflow'

/**
 * 任务日志查看状态（画布节点错误日志对话框 / 任务管理器历史日志 共用）。
 *
 * **拉取策略**：
 * - 首次打开只取**尾部片段**（默认 200 条）——服务端 `limit` 直取尾部并命中主键索引，
 *   避免把上千行日志全量搬进浏览器；
 * - 「查看全部」显式请求全量（`limit = 0`）；
 * - `truncated` 为真时提示「仅显示最后 N 条 / 共 M 条」，避免误以为日志被清空。
 *
 * 切换 taskId（同一对话框复用）时调用 `reset()` 再 `load()`，避免上一个任务的日志残留。
 */

/** 首次打开的尾部条数上限 */
export const LOG_TAIL_LIMIT = 200

/** 日志级别筛选项（'all' 表示不过滤） */
export type TaskLogLevelFilter = 'all' | 'info' | 'warn' | 'error'

/**
 * 任务日志查看状态。
 *
 * 返回 `reactive` 对象（而非裸 ref 集合）：模板里直接 `state.logs` 取值，
 * 与 `useWorkflowTask` 的用法一致。
 *
 * @param taskId 任务 id 的响应式引用（可为 null：无任务时不请求）
 * @returns 日志数据、加载状态与操作方法
 */
export function useTaskLogs(taskId: Ref<string | null>) {
  /** 当前展示的日志条目（按写入顺序正序） */
  const logs = ref<LogEntry[]>([])
  /** 该任务日志总行数 */
  const total = ref(0)
  /** 当前结果是否为截断的尾部片段 */
  const truncated = ref(false)
  /** 是否正在加载 */
  const loading = ref(false)
  /** 加载失败信息（null 表示无错误） */
  const error = ref<string | null>(null)

  /**
   * 拉取日志。
   *
   * @param limit 条数上限（0 = 全量）；省略时用尾部默认值
   */
  async function load(limit: number = LOG_TAIL_LIMIT): Promise<void> {
    const id = taskId.value
    if (!id) {
      logs.value = []
      total.value = 0
      truncated.value = false
      return
    }
    loading.value = true
    error.value = null
    try {
      const result = await getTaskLogs(id, { limit })
      logs.value = result.logs
      total.value = result.total
      truncated.value = result.truncated
    } catch (e) {
      // 请求失败：保留已有日志并给出可重试的错误提示（不静默）
      error.value = e instanceof Error ? e.message : String(e)
      console.error(`[task-logs] 读取任务日志失败（${id}）:`, e)
    } finally {
      loading.value = false
    }
  }

  /** 加载该任务的完整日志（忽略尾部上限） */
  async function loadAll(): Promise<void> {
    await load(0)
  }

  /** 重新拉取当前视图（保持当前是否全量的状态） */
  async function reload(): Promise<void> {
    await load(truncated.value ? LOG_TAIL_LIMIT : 0)
  }

  /** 清空全部状态（关闭对话框 / 切换任务时调用） */
  function reset(): void {
    logs.value = []
    total.value = 0
    truncated.value = false
    loading.value = false
    error.value = null
  }

  return reactive({ logs, total, truncated, loading, error, load, loadAll, reload, reset })
}

/**
 * 按级别过滤日志条目。
 *
 * @param logs 原始日志条目
 * @param filter 级别筛选（'all' 不过滤）
 * @returns 过滤后的条目
 */
export function filterLogsByLevel(logs: LogEntry[], filter: TaskLogLevelFilter): LogEntry[] {
  if (filter === 'all') return logs
  if (filter === 'warn') return logs.filter((l) => l.level === 'warn' || l.level === 'error')
  if (filter === 'error') return logs.filter((l) => l.level === 'error')
  // 'info'：信息及以上（debug 属于心跳类噪声，仅在「全部」中展示）
  return logs.filter((l) => l.level !== 'debug')
}
