<template>
  <!--
    画布节点「任务详情」对话框：展示该节点最近一次生成任务的完整日志。
    入口：节点卡片错误遮罩的「详情」按钮（仅任务可查询时渲染）。
  -->
  <v-dialog
    :model-value="modelValue"
    max-width="760"
    scrollable
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <v-card class="node-log-dialog">
      <v-card-title class="d-flex align-center">
        <v-icon
          icon="mdi-text-box-search-outline"
          size="20"
          class="mr-2"
          color="primary"
        />
        任务详情{{ nodeName ? ` · ${nodeName}` : '' }}
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          aria-label="关闭"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>

      <v-card-text>
        <!-- 任务摘要：状态 / 耗时 / 画布定位 / 错误信息 -->
        <div
          v-if="summary"
          class="node-log-dialog__summary"
        >
          <div class="node-log-dialog__summary-row">
            <v-chip
              :color="statusColor"
              size="x-small"
              variant="tonal"
            >
              {{ statusLabel }}
            </v-chip>
            <span class="text-body-small text-medium-emphasis">
              任务 {{ taskId || '—' }}
            </span>
            <template v-if="elapsedText">
              <span class="text-body-small text-medium-emphasis">·</span>
              <span class="text-body-small text-medium-emphasis">{{ elapsedText }}</span>
            </template>
          </div>
          <v-alert
            v-if="summary.errorMsg"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-2"
          >
            {{ summary.errorMsg }}
          </v-alert>

          <!-- 文本生成产物（text-generation：无产物文件）：任务详情是唯一能看到全文的地方 -->
          <div
            v-if="resultText"
            class="node-log-dialog__text mt-2"
          >
            <div class="d-flex align-center mb-1">
              <v-icon
                icon="mdi-text-box-outline"
                size="16"
                class="mr-1"
              />
              <span class="text-body-small font-weight-medium">文本产物</span>
              <v-spacer />
              <v-btn
                size="x-small"
                variant="text"
                color="primary"
                prepend-icon="mdi-content-copy"
                @click="copyResultText"
              >
                复制
              </v-btn>
            </div>
            <textarea
              class="node-log-dialog__text-area"
              :value="resultText"
              readonly
              spellcheck="false"
            />
          </div>
        </div>

        <TaskLogViewer
          v-model:level-filter="levelFilter"
          :logs="taskLogs.logs"
          :total="taskLogs.total"
          :truncated="taskLogs.truncated"
          :loading="taskLogs.loading"
          :error="taskLogs.error"
          :max-height="420"
          @load-all="() => void taskLogs.loadAll()"
          @refresh="() => void taskLogs.reload()"
        />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import TaskLogViewer from '../task/TaskLogViewer.vue'
import { getTaskStatus, type TaskResponse } from '../../api/workflow'
import { useTaskLogs, type TaskLogLevelFilter } from '../../composables/useTaskLogs'

const props = defineProps<{
  /** 对话框显隐（v-model） */
  modelValue: boolean
  /** 任务 id（为空时不拉取日志，仅提示不可查询） */
  taskId: string | null
  /** 节点名称（标题展示用） */
  nodeName?: string
}>()

const emit = defineEmits<{
  /** 对话框显隐变更 */
  (e: 'update:modelValue', value: boolean): void
}>()

/** 任务摘要（状态 / 错误信息；拉取失败保持 null） */
const summary = ref<TaskResponse | null>(null)
/** 级别筛选（关闭对话框时复位） */
const levelFilter = ref<TaskLogLevelFilter>('all')

/**
 * 文本产物内容（文本生成任务才有）。
 *
 * 任务结果有两种形态：媒体类 `{ path }`、文本生成类 `{ text, patch?, rev? }`。
 * 文本任务没有产物文件，**本对话框是唯一能看到全文的地方**（任务管理器历史行只显示摘要），
 * 故按非空字符串读取并渲染为只读文本区。
 */
const resultText = computed(() => {
  const result = summary.value?.result
  if (!result || typeof result !== 'object') return ''
  const text = (result as { text?: unknown }).text
  return typeof text === 'string' && text.trim() !== '' ? text : ''
})

/** 复制文本产物到剪贴板（失败仅打日志：剪贴板权限在非安全上下文下可能不可用） */
function copyResultText(): void {
  void navigator.clipboard?.writeText(resultText.value).catch((e: unknown) => {
    console.error(`[canvas] 复制文本产物失败: ${e instanceof Error ? e.message : String(e)}`)
  })
}

/** 日志状态（taskId 为空时不请求） */
const taskLogs = useTaskLogs(toRef(props, 'taskId'))

/** 任务状态中文标签 */
const statusLabel = computed(() => {
  const s = summary.value?.status
  if (s === 'completed') return '已完成'
  if (s === 'failed') return '已失败'
  if (s === 'running') return '运行中'
  if (s === 'pending') return '排队中'
  return s ?? '未知'
})

/** 任务状态对应的 chip 颜色 */
const statusColor = computed(() => {
  const s = summary.value?.status
  if (s === 'completed') return 'success'
  if (s === 'failed') return 'error'
  return 'primary'
})

/** 任务耗时文案（创建 → 最后更新时间） */
const elapsedText = computed(() => {
  const t = summary.value
  if (!t?.createdAt || !t.updatedAt) return ''
  const start = Date.parse(t.createdAt.includes('T') ? t.createdAt : `${t.createdAt.replace(' ', 'T')}Z`)
  const end = Date.parse(t.updatedAt.includes('T') ? t.updatedAt : `${t.updatedAt.replace(' ', 'T')}Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return ''
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  if (seconds < 60) return `耗时 ${seconds} 秒`
  return `耗时 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
})

/**
 * 打开对话框时拉取任务摘要与日志尾部；关闭时清空，避免下次打开显示上一个任务的内容。
 *
 * @param open 对话框是否打开
 */
async function onOpenChange(open: boolean): Promise<void> {
  if (!open) {
    summary.value = null
    levelFilter.value = 'all'
    taskLogs.reset()
    return
  }
  const id = props.taskId
  if (!id) return
  await Promise.all([
    void taskLogs.load(),
    getTaskStatus(id)
      .then((t) => { summary.value = t })
      .catch((e: unknown) => {
        // 摘要仅为辅助信息（日志可能已超期清理/任务记录不存在）：失败打日志不阻断日志展示
        console.error(`[node-log] 读取任务摘要失败（${id}）:`, e)
      }),
  ])
}

watch(() => props.modelValue, (open) => void onOpenChange(open), { immediate: true })
</script>

<style scoped>
.node-log-dialog__summary {
  margin-bottom: 12px;
}

.node-log-dialog__summary-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 文本产物区（文本生成任务）：只读文本区 + 复制按钮 */
.node-log-dialog__text-area {
  width: 100%;
  min-height: 120px;
  max-height: 240px;
  resize: vertical;
  padding: 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.02);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
