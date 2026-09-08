<template>
  <!-- 全局「任务管理器」面板（Header 右上角图标展开；展示系统当前全部异步任务） -->
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <v-card class="task-manager-dialog">
      <v-card-title class="d-flex align-center">
        <v-icon
          icon="mdi-progress-clock"
          size="20"
          class="mr-2"
          color="primary"
        />
        任务管理器
        <span
          v-if="activeTasks.length > 0"
          class="text-body-small text-medium-emphasis ml-2"
        >
          （{{ activeTasks.length }} 个进行中）
        </span>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          aria-label="关闭"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text class="task-manager-dialog__body">
        <template v-if="activeTasks.length > 0">
          <div
            v-for="t in activeTasks"
            :key="t.id"
            class="task-manager-dialog__row"
          >
            <div class="task-manager-dialog__info">
              <div class="task-manager-dialog__title">
                <v-progress-circular
                  v-if="t.status === 'running'"
                  :size="14"
                  :width="2"
                  indeterminate
                  color="primary"
                  class="mr-2"
                />
                <v-icon
                  v-else
                  icon="mdi-clock-outline"
                  size="14"
                  color="warning"
                  class="mr-2"
                />
                <v-chip
                  :color="typeColor(t.type)"
                  size="x-small"
                  variant="tonal"
                  class="mr-2"
                >
                  {{ typeLabel(t.type) }}
                </v-chip>
                <span class="task-manager-dialog__name">{{ t.label }}</span>
              </div>
              <div class="task-manager-dialog__meta">
                <span>{{ statusText(t) }}</span>
                <span class="mx-1">·</span>
                <span>已运行 {{ formatElapsed(t.startedAt) }}</span>
                <template v-if="locationText(t)">
                  <span class="mx-1">·</span>
                  <span>{{ locationText(t) }}</span>
                </template>
              </div>
              <!-- 进度条：ffmpeg 真实百分比；其余任务不确定进度（indeterminate） -->
              <v-progress-linear
                v-if="t.status === 'running'"
                :model-value="t.progress"
                :indeterminate="typeof t.progress !== 'number'"
                height="4"
                rounded
                color="primary"
                class="mt-1"
              />
            </div>
            <v-tooltip
              :text="t.cancelable ? '中断该任务' : (t.cancelBlockReason || '该任务不支持中断')"
              location="left"
            >
              <template #activator="{ props: tipProps }">
                <span v-bind="tipProps">
                  <v-btn
                    size="small"
                    variant="tonal"
                    color="error"
                    class="task-manager-dialog__interrupt"
                    :disabled="!t.cancelable"
                    @click="onInterrupt(t)"
                  >
                    中断
                  </v-btn>
                </span>
              </template>
            </v-tooltip>
          </div>
        </template>
        <div
          v-else
          class="task-manager-dialog__empty"
        >
          <v-icon
            icon="mdi-progress-clock"
            size="36"
            class="mb-2"
            color="grey"
          />
          <div class="text-body-medium text-medium-emphasis">
            暂无进行中的任务
          </div>
        </div>
        <div
          v-if="finishedNoticeCount > 0"
          class="task-manager-dialog__finished-note"
        >
          本次面板打开期间已有 {{ finishedNoticeCount }} 个任务完成
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { taskSocket, type LlmCanvasTarget, type TaskInfo, type TaskType } from '../canvas/taskSocket'

/**
 * 全局「任务管理器」面板（由原 LLM 活跃会话面板升级）：
 * - 任务列表实时来自 `taskSocket.tasks`（服务端 begin/update/finish 广播，含 ffmpeg 真实进度）；
 * - 每行展示：类型标记 / 名称 / 状态 / 已运行时长（按 startedAt 客户端每秒刷新）/ 画布位置 / 进度条；
 * - 「中断」按钮统一走 `taskSocket.cancel`（ffmpeg kill 子进程、LLM abort 上游、工作流 Bridge 取消）；
 *   不可中断的任务按钮置灰并以 tooltip 显示原因（如「该工作流不支持中断」）。
 */
const props = defineProps<{
  /** 面板可见性（v-model） */
  modelValue: boolean
  /** 活跃任务列表（taskSocket.tasks 注入） */
  tasks: TaskInfo[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  /** 操作反馈（snackbar） */
  (e: 'notify', text: string, color?: 'success' | 'error' | 'primary'): void
}>()

/** 活跃（pending/running）任务列表（按启动时间倒序） */
const activeTasks = computed(() =>
  props.tasks
    .filter((t) => t.status === 'running' || t.status === 'pending')
    .sort((a, b) => b.startedAt - a.startedAt),
)

/** 已完成计数提示（本次面板打开期间收敛的任务数；面板打开时清零） */
const finishedNoticeCount = ref(0)
/** 上次任务快照（数量减少判定完成） */
let prevCount = activeTasks.value.length

/** 当前时间（秒级刷新；耗时展示用） */
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

/** 面板打开时启动秒级计时；关闭时停止并清零完成计数 */
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      nowTick.value = Date.now()
      finishedNoticeCount.value = 0
      prevCount = activeTasks.value.length
      tickTimer ??= setInterval(() => {
        nowTick.value = Date.now()
      }, 1000)
    } else {
      if (tickTimer) {
        clearInterval(tickTimer)
        tickTimer = null
      }
    }
  },
  { immediate: true },
)

/** 任务数量下降（终态移除）→ 完成计数 +1（面板打开期间） */
watch(
  () => activeTasks.value.length,
  (count) => {
    if (!props.modelValue) return
    if (count < prevCount) finishedNoticeCount.value += prevCount - count
    prevCount = count
  },
)

onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer)
})

/**
 * 格式化任务耗时（毫秒时间差 → mm:ss 或 h:mm:ss）。
 *
 * @param startedAt 任务启动时间（毫秒时间戳）
 * @returns 已运行时长文本
 */
function formatElapsed(startedAt: number): string {
  const total = Math.max(0, Math.floor((nowTick.value - startedAt) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

/**
 * 任务类型中文标签。
 *
 * @param type 任务类型
 * @returns 中文标签
 */
function typeLabel(type: TaskType): string {
  if (type === 'workflow') return 'AI 生成'
  if (type === 'llm') return 'LLM 会话'
  return '视频处理'
}

/**
 * 任务类型标记颜色。
 *
 * @param type 任务类型
 * @returns Vuetify 颜色名
 */
function typeColor(type: TaskType): string {
  if (type === 'workflow') return 'primary'
  if (type === 'llm') return 'purple'
  return 'teal'
}

/**
 * 状态文案：pending 排队中；running 按类型显示阶段（LLM Thinking/响应中、ffmpeg 进度百分比、工作流运行中）。
 *
 * @param t 任务摘要
 * @returns 状态文本
 */
function statusText(t: TaskInfo): string {
  if (t.status === 'pending') return '排队中'
  if (t.status !== 'running') return t.status === 'completed' ? '已完成' : t.status === 'failed' ? '失败' : '已中断'
  if (t.type === 'llm') return t.phase === 'responding' ? '正在响应…' : 'Thinking…'
  if (t.type === 'ffmpeg') return typeof t.progress === 'number' ? `处理中 ${t.progress}%` : '处理中…'
  return '运行中…'
}

/**
 * 任务位置展示（项目 + 画布中文标签）。
 *
 * @param t 任务摘要
 * @returns 位置文本（无定位信息时返回空串）
 */
function locationText(t: TaskInfo): string {
  const parts: string[] = []
  if (t.project) parts.push(t.project)
  const c: LlmCanvasTarget | undefined = t.canvas
  if (c) {
    if (c.kind === 'scene') parts.push(`分镜第${c.episode}集 ${c.shot}#`)
    else parts.push(`场景 ${c.stage ?? ''} / ${c.label ?? ''}`)
  }
  return parts.join(' · ')
}

/**
 * 中断任务（取消非删除，无需 confirm）：WS 优先 + HTTP 兜底；
 * 服务端收敛后广播任务列表更新（LLM 另有 finished 广播），面板列表实时移除。
 *
 * @param t 任务摘要
 */
function onInterrupt(t: TaskInfo): void {
  taskSocket.cancel(t.id)
  emit('notify', `已请求中断「${t.label}」`, 'primary')
}
</script>

<style scoped>
.task-manager-dialog__body {
  max-height: 460px;
  overflow-y: auto;
  padding-top: 0;
}

.task-manager-dialog__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.task-manager-dialog__row:last-child {
  border-bottom: none;
}

.task-manager-dialog__info {
  flex: 1 1 auto;
  min-width: 0;
}

.task-manager-dialog__title {
  display: flex;
  align-items: center;
  min-width: 0;
}

.task-manager-dialog__name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-manager-dialog__meta {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.5);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-manager-dialog__interrupt {
  flex: 0 0 auto;
}

.task-manager-dialog__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 12px;
}

.task-manager-dialog__finished-note {
  margin-top: 8px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.5);
  text-align: center;
}
</style>
