<template>
  <!--
    任务管理器「历史」页签：展示 SQLite 中持久化的任务（默认最近 14 天，与日志保留期一致）。
    任务行可展开查看完整日志（级别过滤 + 尾部片段 + 查看全部）。
  -->
  <div class="task-history">
    <!-- 筛选条 -->
    <div class="task-history__filters">
      <v-select
        v-model="filters.days"
        :items="dayOptions"
        item-title="label"
        item-value="value"
        label="时间范围"
        variant="outlined"
        density="compact"
        hide-details
        class="task-history__filter"
        @update:model-value="() => void reload()"
      />
      <v-select
        v-model="filters.status"
        :items="statusOptions"
        item-title="label"
        item-value="value"
        label="状态"
        variant="outlined"
        density="compact"
        hide-details
        class="task-history__filter"
        @update:model-value="() => void reload()"
      />
      <v-text-field
        v-model="filters.project"
        label="项目（留空 = 全部）"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        class="task-history__filter"
        @keyup.enter="() => void reload()"
      />
      <v-btn
        size="small"
        variant="tonal"
        color="primary"
        :loading="loading"
        @click="() => void reload()"
      >
        刷新
      </v-btn>
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-2"
    >
      {{ error }}
    </v-alert>

    <!-- 任务列表 -->
    <div
      v-if="tasks.length > 0"
      class="task-history__list"
    >
      <div
        v-for="t in tasks"
        :key="t.taskId"
        class="task-history__row"
      >
        <div class="task-history__head">
          <v-chip
            :color="statusColor(t.status)"
            size="x-small"
            variant="tonal"
            class="mr-2"
          >
            {{ statusLabel(t.status) }}
          </v-chip>
          <span class="task-history__name">{{ t.workflowId }}</span>
          <span class="task-history__meta">{{ t.impl }}</span>
          <v-spacer />
          <span class="task-history__meta">{{ formatDateTime(t.createdAt) }}</span>
          <v-btn
            size="x-small"
            variant="text"
            color="primary"
            class="ml-2"
            @click="() => void toggle(t.taskId)"
          >
            {{ expandedId === t.taskId ? '收起' : '查看日志' }}
          </v-btn>
        </div>
        <div class="task-history__meta-line">
          <span>{{ locationText(t) || '无画布定位' }}</span>
          <template v-if="t.errorMsg">
            <span class="mx-1">·</span>
            <span class="text-error">{{ t.errorMsg }}</span>
          </template>
          <template v-else-if="t.result?.path">
            <span class="mx-1">·</span>
            <span>{{ t.result.path }}</span>
          </template>
        </div>

        <!-- 展开的日志区（按需加载：点开才请求） -->
        <div
          v-if="expandedId === t.taskId"
          class="task-history__logs"
        >
          <TaskLogViewer
            v-model:level-filter="levelFilter"
            :logs="logs.logs"
            :total="logs.total"
            :truncated="logs.truncated"
            :loading="logs.loading"
            :error="logs.error"
            :max-height="300"
            @load-all="() => void logs.loadAll()"
            @refresh="() => void logs.reload()"
          />
        </div>
      </div>
    </div>

    <div
      v-else-if="!loading"
      class="text-body-medium text-medium-emphasis text-center py-6"
    >
      <v-icon
        icon="mdi-history"
        size="36"
        class="mb-2"
        color="grey"
      />
      <div>该时间范围内暂无历史任务</div>
      <div class="text-body-small mt-1">
        历史任务列表保留在数据库中；任务日志默认保留 {{ retentionDays }} 天
      </div>
    </div>

    <div
      v-else
      class="text-center py-6"
    >
      <v-progress-circular
        indeterminate
        color="primary"
        size="24"
      />
    </div>

    <!-- 分页 -->
    <div
      v-if="total > PAGE_SIZE"
      class="task-history__pager"
    >
      <v-btn
        size="small"
        variant="text"
        icon="mdi-chevron-left"
        aria-label="上一页"
        :disabled="page === 0"
        @click="() => void goPage(page - 1)"
      />
      <span class="text-body-small text-medium-emphasis">
        第 {{ page + 1 }} / {{ pageCount }} 页 · 共 {{ total }} 个任务
      </span>
      <v-btn
        size="small"
        variant="text"
        icon="mdi-chevron-right"
        aria-label="下一页"
        :disabled="page >= pageCount - 1"
        @click="() => void goPage(page + 1)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, toRef, watch } from 'vue'
import TaskLogViewer from './TaskLogViewer.vue'
import { listTasks, type TaskResponse } from '../../api/workflow'
import { getSystemSettings } from '../../api/system'
import { useTaskLogs, type TaskLogLevelFilter } from '../../composables/useTaskLogs'

const props = defineProps<{
  /** 面板是否可见（关闭时停止后续请求） */
  active: boolean
}>()

/** 每页任务数 */
const PAGE_SIZE = 20

/** 时间范围选项（value = 最近天数；0 = 不限） */
const dayOptions = [
  { label: '最近 1 天', value: 1 },
  { label: '最近 3 天', value: 3 },
  { label: '最近 7 天', value: 7 },
  { label: '最近 14 天', value: 14 },
  { label: '最近 30 天', value: 30 },
  { label: '不限时间', value: 0 },
]

/** 状态选项（value = 服务端状态；'' = 全部） */
const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
  { label: '运行中', value: 'running' },
  { label: '排队中', value: 'pending' },
]

/** 筛选条件 */
const filters = reactive({ days: 14, status: '', project: '' })

/** 当前页任务 */
const tasks = ref<TaskResponse[]>([])
/** 满足条件的任务总数 */
const total = ref(0)
/** 当前页码（0 起） */
const page = ref(0)
/** 是否正在加载列表 */
const loading = ref(false)
/** 列表加载失败信息 */
const error = ref<string | null>(null)
/** 当前展开日志的任务 id（空串 = 未展开） */
const expandedId = ref('')
/** 日志级别筛选（切换任务时复位） */
const levelFilter = ref<TaskLogLevelFilter>('all')
/** 日志保留期（空态提示用；读取失败时回退默认值） */
const retentionDays = ref(14)

/** 日志状态（taskId 为空时不请求） */
const logs = useTaskLogs(toRef(expandedId))

/** 总页数 */
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

/**
 * 拉取当前筛选条件下的任务列表。
 *
 * @param resetPage 是否重置到第一页（筛选变化时传 true）
 */
async function reload(resetPage = true): Promise<void> {
  if (resetPage) page.value = 0
  loading.value = true
  error.value = null
  try {
    const since = filters.days > 0
      ? new Date(Date.now() - filters.days * 86400000).toISOString()
      : undefined
    const result = await listTasks({
      ...(filters.project?.trim() ? { project: filters.project.trim() } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(since ? { since } : {}),
      limit: PAGE_SIZE,
      offset: page.value * PAGE_SIZE,
    })
    tasks.value = result.tasks
    total.value = result.total
    // 当前页可能因数据变化越界（如筛选后总数变少）：回退到最后一页
    if (tasks.value.length === 0 && page.value > 0) {
      page.value = Math.max(0, pageCount.value - 1)
      await reload(false)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    console.error('[task-history] 读取历史任务失败:', e)
  } finally {
    loading.value = false
  }
}

/**
 * 翻页。
 *
 * @param next 目标页码（0 起）
 */
async function goPage(next: number): Promise<void> {
  if (next < 0 || next >= pageCount.value) return
  page.value = next
  await reload(false)
}

/**
 * 展开/收起某个任务的日志（展开时按需拉取尾部片段）。
 *
 * @param taskId 任务 id
 */
async function toggle(taskId: string): Promise<void> {
  if (expandedId.value === taskId) {
    expandedId.value = ''
    levelFilter.value = 'all'
    logs.reset()
    return
  }
  expandedId.value = taskId
  levelFilter.value = 'all'
  logs.reset()
  await logs.load()
}

/**
 * 任务状态中文标签。
 *
 * @param status 服务端状态
 * @returns 中文标签
 */
function statusLabel(status: string): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'running') return '运行中'
  if (status === 'pending') return '排队中'
  return status
}

/**
 * 任务状态对应颜色。
 *
 * @param status 服务端状态
 * @returns Vuetify 颜色名
 */
function statusColor(status: string): string {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  return 'primary'
}

/**
 * 任务画布定位文案（params.canvas + params.nodeId）。
 *
 * @param t 任务响应
 * @returns 定位文本（无定位时返回空串）
 */
function locationText(t: TaskResponse): string {
  const parts: string[] = []
  if (t.params?.canvas) {
    const c = t.params.canvas
    if (c.kind === 'scene') parts.push(`分镜 ${c.episode ?? ''}-${c.shot ?? ''}`)
    else parts.push(`场景 ${c.stage ?? ''}/${c.label ?? ''}`)
  }
  if (t.params?.nodeId) parts.push(`节点 ${t.params.nodeId.slice(0, 8)}`)
  return parts.join(' · ')
}

/**
 * 时间格式化（SQLite UTC 串 → 本地 `MM-DD HH:MM`）。
 *
 * @param raw 服务端时间字符串
 * @returns 展示文本；无法解析时原样返回
 */
function formatDateTime(raw: string): string {
  const parsed = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`)
  if (Number.isNaN(parsed)) return raw
  const d = new Date(parsed)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 页签首次激活时加载列表与保留期 */
watch(
  () => props.active,
  async (active) => {
    if (!active || tasks.value.length > 0) return
    await reload()
    try {
      const settings = await getSystemSettings()
      retentionDays.value = settings.settings.taskLog.autoClean.retentionDays
    } catch (e) {
      // 保留期仅用于空态提示文案：读取失败回退默认值并打日志，不阻断历史列表
      console.error('[task-history] 读取日志保留期失败:', e)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  logs.reset()
})
</script>

<style scoped>
.task-history__filters {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.task-history__filter {
  max-width: 180px;
}

.task-history__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 460px;
  overflow-y: auto;
}

.task-history__row {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 4px;
  padding: 8px;
}

.task-history__head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.task-history__name {
  font-weight: 500;
}

.task-history__meta {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
}

.task-history__meta-line {
  margin-top: 4px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
  word-break: break-all;
}

.task-history__logs {
  margin-top: 8px;
}

.task-history__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}
</style>
