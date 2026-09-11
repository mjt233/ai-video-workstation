<template>
  <!--
    任务日志查看器（复用组件）：
    - 画布节点错误「详情」对话框；
    - 任务管理器「历史」页签的任务详情。
    纯展示 + 交互：数据由父级经 useTaskLogs 拉取后传入（避免两处重复实现拉取逻辑）
  -->
  <div class="task-log-viewer">
    <!-- 工具条：级别过滤 + 条数信息 + 查看全部/刷新 -->
    <div class="task-log-viewer__toolbar">
      <v-btn-toggle
        :model-value="levelFilter"
        density="comfortable"
        variant="outlined"
        divided
        mandatory
        @update:model-value="(v: TaskLogLevelFilter) => emit('update:levelFilter', v)"
      >
        <v-btn
          value="all"
          size="small"
        >
          全部
        </v-btn>
        <v-btn
          value="info"
          size="small"
        >
          信息
        </v-btn>
        <v-btn
          value="warn"
          size="small"
        >
          警告
        </v-btn>
        <v-btn
          value="error"
          size="small"
        >
          错误
        </v-btn>
      </v-btn-toggle>

      <span class="text-body-small text-medium-emphasis ml-3">
        {{ summaryText }}
      </span>

      <v-spacer />

      <v-btn
        v-if="truncated"
        size="small"
        variant="text"
        color="primary"
        :loading="loading"
        @click="emit('load-all')"
      >
        查看全部
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        icon="mdi-refresh"
        aria-label="刷新日志"
        :loading="loading"
        @click="emit('refresh')"
      />
    </div>

    <!-- 错误提示（可重试） -->
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-2"
    >
      读取日志失败：{{ error }}
    </v-alert>

    <!-- 日志主体 -->
    <div
      ref="bodyRef"
      class="task-log-viewer__body"
      :style="{ maxHeight: bodyMaxHeight }"
    >
      <template v-if="visibleLogs.length > 0">
        <div
          v-for="log in visibleLogs"
          :key="log.id"
          class="task-log-viewer__row"
        >
          <span class="task-log-viewer__time">{{ formatTime(log.created_at) }}</span>
          <span
            class="task-log-viewer__level"
            :class="`task-log-viewer__level--${levelClass(log.level)}`"
          >
            {{ levelLabel(log.level) }}
          </span>
          <span
            class="task-log-viewer__message"
            :class="{ 'text-error': log.level === 'error' }"
          >
            {{ log.message }}
          </span>
        </div>
      </template>
      <div
        v-else
        class="text-body-small text-medium-emphasis text-center py-6"
      >
        <template v-if="loading">
          加载中…
        </template>
        <template v-else-if="logs.length > 0">
          当前筛选条件下没有日志
        </template>
        <template v-else>
          暂无日志（可能已超出保留期被自动清理）
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LogEntry } from '../../api/workflow'
import { filterLogsByLevel, type TaskLogLevelFilter } from '../../composables/useTaskLogs'

const props = defineProps<{
  /** 日志条目（按写入顺序正序） */
  logs: LogEntry[]
  /** 该任务日志总行数 */
  total: number
  /** 当前结果是否为截断的尾部片段 */
  truncated: boolean
  /** 是否正在加载 */
  loading: boolean
  /** 加载失败信息（null 表示无错误） */
  error: string | null
  /** 级别筛选（父级持有，便于切换任务时复位） */
  levelFilter: TaskLogLevelFilter
  /** 日志区最大高度（px；默认 360） */
  maxHeight?: number
}>()

const emit = defineEmits<{
  /** 级别筛选变更 */
  (e: 'update:levelFilter', value: TaskLogLevelFilter): void
  /** 请求加载完整日志 */
  (e: 'load-all'): void
  /** 请求刷新当前视图 */
  (e: 'refresh'): void
}>()

/** 日志滚动容器（新增日志时自动滚到底部） */
const bodyRef = ref<HTMLElement | null>(null)

/** 日志区最大高度（内联样式，避免 scoped CSS 依赖 props 绑定） */
const bodyMaxHeight = computed(() => `${props.maxHeight ?? 360}px`)

/** 过滤后的可见日志 */
const visibleLogs = computed(() => filterLogsByLevel(props.logs, props.levelFilter))

/** 条数摘要文案（区分全量/尾部片段） */
const summaryText = computed(() => {
  if (props.total === 0) return '共 0 条'
  const shown = visibleLogs.value.length
  const filtered = shown !== props.logs.length
  if (props.truncated) {
    return `仅显示最后 ${props.logs.length} 条（共 ${props.total} 条）${filtered ? `，筛选后 ${shown} 条` : ''}`
  }
  return filtered ? `共 ${props.total} 条，筛选后 ${shown} 条` : `共 ${props.total} 条`
})

/**
 * 日志时间格式化：SQLite 写入的是 UTC（`YYYY-MM-DD HH:MM:SS`），转本地时间展示。
 *
 * @param raw 服务端返回的时间字符串
 * @returns `MM-DD HH:MM:SS`；无法解析时原样返回
 */
function formatTime(raw: string): string {
  const parsed = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`)
  if (Number.isNaN(parsed)) return raw
  const d = new Date(parsed)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 级别中文标签。
 *
 * @param level 服务端级别（info / warn / error / debug）
 * @returns 展示用中文
 */
function levelLabel(level: string): string {
  if (level === 'error') return '错误'
  if (level === 'warn') return '警告'
  if (level === 'debug') return '调试'
  return '信息'
}

/**
 * 级别色标 CSS 后缀。
 *
 * @param level 服务端级别
 * @returns 'error' | 'warn' | 'debug' | 'info'
 */
function levelClass(level: string): string {
  if (level === 'error') return 'error'
  if (level === 'warn') return 'warn'
  if (level === 'debug') return 'debug'
  return 'info'
}

// 日志变化后滚到底部（最新日志在末尾）
watch(
  () => props.logs.length,
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const el = bodyRef.value
    if (el) el.scrollTop = el.scrollHeight
  },
)
</script>

<style scoped>
.task-log-viewer__toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.task-log-viewer__body {
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 4px;
  padding: 8px;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.6;
}

.task-log-viewer__row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.task-log-viewer__time {
  flex: 0 0 auto;
  color: rgba(0, 0, 0, 0.45);
}

.task-log-viewer__level {
  flex: 0 0 auto;
  width: 28px;
  text-align: center;
  border-radius: 3px;
  font-size: 11px;
}

.task-log-viewer__level--info {
  color: #1565c0;
}

.task-log-viewer__level--debug {
  color: rgba(0, 0, 0, 0.4);
}

.task-log-viewer__level--warn {
  color: #ef6c00;
  font-weight: 600;
}

.task-log-viewer__level--error {
  color: #c62828;
  font-weight: 600;
}

.task-log-viewer__message {
  flex: 1 1 auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
