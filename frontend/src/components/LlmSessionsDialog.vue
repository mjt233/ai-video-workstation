<template>
  <!-- 全局「LLM 活跃会话」面板（Header 右上角图标展开；全站可用） -->
  <v-dialog
    :model-value="modelValue"
    max-width="480"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <v-card class="llm-sessions-dialog">
      <v-card-title class="d-flex align-center">
        <v-icon
          icon="mdi-broadcast"
          size="20"
          class="mr-2"
          color="primary"
        />
        LLM 活跃会话
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          aria-label="关闭"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text class="llm-sessions-dialog__body">
        <template v-if="runningSessions.length > 0">
          <div
            v-for="s in runningSessions"
            :key="s.taskId"
            class="llm-sessions-dialog__row"
          >
            <div class="llm-sessions-dialog__info">
              <div class="llm-sessions-dialog__title">
                <v-progress-circular
                  :size="14"
                  :width="2"
                  indeterminate
                  color="primary"
                  class="mr-2"
                />
                <span class="llm-sessions-dialog__name">{{ s.label }}</span>
                <span class="llm-sessions-dialog__model">
                  {{ s.modelName || '未命名模型' }}
                </span>
              </div>
              <div class="llm-sessions-dialog__meta">
                <span>{{ s.phase === 'responding' ? '正在响应…' : 'Thinking…' }}</span>
                <span class="mx-1">·</span>
                <span>已运行 {{ formatElapsed(s.startedAt) }}</span>
                <span class="mx-1">·</span>
                <span>{{ canvasLabel(s) }}</span>
              </div>
            </div>
            <v-btn
              size="small"
              variant="tonal"
              color="error"
              class="llm-sessions-dialog__interrupt"
              @click="onInterrupt(s)"
            >
              中断
            </v-btn>
          </div>
        </template>
        <div
          v-else
          class="llm-sessions-dialog__empty"
        >
          <v-icon
            icon="mdi-broadcast-off"
            size="36"
            class="mb-2"
            color="grey"
          />
          <div class="text-body-medium text-medium-emphasis">
            暂无进行中的 LLM 会话
          </div>
        </div>
        <div
          v-if="finishedNoticeCount > 0"
          class="llm-sessions-dialog__finished-note"
        >
          本次会话期间已有 {{ finishedNoticeCount }} 个会话完成（终态结果已写入画布）
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { llmSocket, type LlmCanvasTarget, type LlmSessionInfo } from '../canvas/llmSocket'

/**
 * 全局「LLM 活跃会话」面板：
 * - 会话列表实时来自 llmSocket.sessions（服务端 begin/update/finish 广播）；
 * - 阶段（Thinking… / 正在响应…）与耗时（按 startedAt 客户端每秒刷新）；
 * - 每行「中断」操作（取消非删除，无需 confirm；取消后等待服务端 finished 收敛）；
 * - 空态与完成计数提示。
 */

const props = defineProps<{
  /** 面板可见性（v-model） */
  modelValue: boolean
  /** 活跃会话列表（llmSocket.sessions 注入） */
  sessions: LlmSessionInfo[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  /** 操作反馈（snackbar） */
  (e: 'notify', text: string, color?: 'success' | 'error' | 'primary'): void
}>()

/** 活跃（running）会话列表（按启动时间倒序） */
const runningSessions = computed(() =>
  props.sessions.filter((s) => s.status === 'running').sort((a, b) => b.startedAt - a.startedAt),
)

/** 已完成计数提示（本次面板打开期间收敛的会话数；面板打开时清零） */
const finishedNoticeCount = ref(0)
/** 上次会话快照（数量减少判定完成） */
let prevCount = runningSessions.value.length

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
      prevCount = runningSessions.value.length
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

/** 会话数量下降（终态移除）→ 完成计数 +1（面板打开期间） */
watch(
  () => runningSessions.value.length,
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
 * 格式化会话耗时（毫秒时间差 → mm:ss 或 h:mm:ss）。
 *
 * @param startedAt 会话启动时间（毫秒时间戳）
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
 * 会话画布位置展示（分镜/场景中文标签）。
 *
 * @param s 会话信息
 * @returns 画布位置文本
 */
function canvasLabel(s: LlmSessionInfo): string {
  const c: LlmCanvasTarget = s.canvas
  if (c.kind === 'scene') return `分镜第${c.episode}集 ${c.shot}#`
  return `场景 ${c.stage ?? ''} / ${c.label ?? ''}`
}

/**
 * 中断会话（取消非删除，无需 confirm）：WS 优先 + HTTP 兜底；
 * 服务端收敛后广播 finished（后端写部分输出），面板列表实时移除。
 *
 * @param s 会话信息
 */
function onInterrupt(s: LlmSessionInfo): void {
  llmSocket.cancel(s.taskId)
  emit('notify', `已中断「${s.label}」（部分输出将写入画布）`, 'primary')
}
</script>

<style scoped>
.llm-sessions-dialog__body {
  max-height: 420px;
  overflow-y: auto;
  padding-top: 0;
}

.llm-sessions-dialog__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.llm-sessions-dialog__row:last-child {
  border-bottom: none;
}

.llm-sessions-dialog__info {
  flex: 1 1 auto;
  min-width: 0;
}

.llm-sessions-dialog__title {
  display: flex;
  align-items: center;
  min-width: 0;
}

.llm-sessions-dialog__name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.llm-sessions-dialog__model {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.55);
  margin-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.llm-sessions-dialog__meta {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.5);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.llm-sessions-dialog__interrupt {
  flex: 0 0 auto;
}

.llm-sessions-dialog__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 12px;
}

.llm-sessions-dialog__finished-note {
  margin-top: 8px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.5);
  text-align: center;
}
</style>
