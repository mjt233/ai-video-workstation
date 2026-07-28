<template>
  <v-dialog
    v-model="show"
    max-width="560"
  >
    <v-card>
      <!-- Config mode -->
      <template v-if="mode === 'config'">
        <v-card-title class="d-flex align-center">
          <v-icon
            class="mr-2"
            color="primary"
          >
            mdi-lightning-bolt
          </v-icon>
          一键生成资产
        </v-card-title>

        <v-card-text>
          <v-alert
            v-if="configWarning"
            type="warning"
            variant="tonal"
            class="mb-3"
            density="compact"
          >
            {{ configWarning }}
          </v-alert>

          <v-alert
            v-if="submitError"
            type="error"
            variant="tonal"
            class="mb-3"
            density="compact"
          >
            {{ submitError }}
          </v-alert>

          <div class="text-body-2 mb-2 font-weight-medium">
            选择要生成的资产类型
          </div>
          <v-row dense>
            <v-col
              v-for="at in assetTypes"
              :key="at.id"
              cols="6"
            >
              <v-checkbox
                v-model="selectedTypes"
                :label="at.label"
                :value="at.id"
                density="compact"
                hide-details
                color="primary"
              />
            </v-col>
          </v-row>

          <v-divider class="my-3" />

          <div class="text-body-2 mb-2 font-weight-medium">
            并发执行数
          </div>
          <v-slider
            v-model="concurrency"
            :min="1"
            :max="10"
            :step="1"
            thumb-label
            show-ticks
          />

          <v-divider class="my-3" />

          <v-checkbox
            v-model="overwrite"
            label="重复生成 — 已存在资产时也覆盖重新生成"
            density="compact"
            hide-details
            color="primary"
          />
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="close"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :disabled="selectedTypes.length === 0 || submitting"
            :loading="submitting"
            @click="startGenerate"
          >
            开始生成
          </v-btn>
        </v-card-actions>
      </template>

      <!-- Progress mode -->
      <template v-else>
        <v-card-title class="d-flex align-center">
          <v-icon
            class="mr-2"
            color="primary"
          >
            mdi-lightning-bolt
          </v-icon>
          一键生成资产
          <v-spacer />
          <span class="text-body-2 font-weight-regular text-grey">
            {{ summary.completed + summary.failed }} / {{ summary.total }}
          </span>
        </v-card-title>

        <v-card-text>
          <v-progress-linear
            :model-value="progressPercent"
            color="primary"
            height="8"
            rounded
            class="mb-3"
          />

          <v-list
            density="compact"
            style="max-height: 320px; overflow-y: auto;"
          >
            <v-list-item
              v-for="task in tasks"
              :key="task.taskId"
            >
              <template #prepend>
                <v-icon
                  :icon="getStatusIcon(task.status)"
                  :color="getStatusColor(task.status)"
                  class="mr-2"
                />
              </template>

              <v-list-item-title class="text-body-2">
                {{ getTaskDisplayName(task) }}
              </v-list-item-title>

              <v-list-item-subtitle class="text-caption">
                {{ getTaskStatusText(task.status) }}
                <span v-if="task.errorMsg"> — {{ task.errorMsg }}</span>
              </v-list-item-subtitle>

              <template #append>
                <v-btn
                  v-if="task.status === 'failed'"
                  variant="text"
                  icon="mdi-refresh"
                  size="small"
                  color="error"
                  @click="retryTask(task.taskId)"
                />
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="close"
          >
            {{ batchRunning ? '后台运行' : '关闭' }}
          </v-btn>
        </v-card-actions>
      </template>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  runBatch,
  retryTask as apiRetryTask,
  type BatchSummary,
  type TaskResponse,
} from '../api/workflow'

const props = defineProps<{
  modelValue: boolean
  project: string
  batchId: string | null
  summary: BatchSummary
  tasks: TaskResponse[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'update:batchId', v: string | null): void
  (e: 'refresh'): void
  (e: 'clear-batch'): void
}>()

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const assetTypes = [
  { id: 'character-appearance', label: '🧑 角色外观' },
  { id: 'character-voice', label: '🎤 角色声音' },
  { id: 'stage-image', label: '🏙️ 场景图片' },
  { id: 'scene-stage-image', label: '🎬 分镜场景图' },
  { id: 'scene-tts', label: '🔈 分镜语音' },
  { id: 'video-generate', label: '🎥 视频' },
]

const mode = ref<'config' | 'progress'>('config')
const selectedTypes = ref<string[]>(assetTypes.map(at => at.id))
const concurrency = ref(1)
const overwrite = ref(false)
const submitting = ref(false)
const submitError = ref<string | null>(null)
const configWarning = ref<string | null>(null)

const progressPercent = computed(() => {
  if (props.summary.total === 0) return 0
  return ((props.summary.completed + props.summary.failed) / props.summary.total) * 100
})

const batchRunning = computed(() => props.summary.running > 0 || props.summary.pending > 0)

const batchFinished = computed(() =>
  props.summary.total > 0
  && props.summary.completed + props.summary.failed === props.summary.total,
)

function getTaskStatusText(status: string): string {
  switch (status) {
    case 'completed': return '已完成'
    case 'running': return '生成中'
    case 'failed': return '失败'
    default: return '排队中'
  }
}

const statusIconMap: Record<string, string> = {
  completed: 'mdi-check-circle',
  running: 'mdi-loading mdi-spin',
  failed: 'mdi-alert-circle',
}

const statusColorMap: Record<string, string> = {
  completed: 'success',
  running: 'primary',
  failed: 'error',
}

const defaultIcon = 'mdi-clock-outline'
const defaultColor = 'grey-lighten-1'

function getStatusIcon(status: string): string {
  return statusIconMap[status] ?? defaultIcon
}

function getStatusColor(status: string): string {
  return statusColorMap[status] ?? defaultColor
}

function getTaskDisplayName(task: TaskResponse): string {
  const typeLabel = assetTypes.find(a => a.id === task.workflowId)?.label ?? task.workflowId
  const vars = task.params?.vars ?? {}

  switch (task.workflowId) {
    case 'character-appearance':
    case 'character-voice':
      return vars.name ? `${typeLabel} — ${vars.name}` : typeLabel
    case 'stage-image': {
      if (vars.name && vars.label) return `${typeLabel} — ${vars.name}/${vars.label}`
      if (vars.name) return `${typeLabel} — ${vars.name}`
      return typeLabel
    }
    case 'scene-stage-image':
    case 'video-generate': {
      if (vars.episode && vars.shot) return `${typeLabel} — 第${vars.episode}集 镜头${vars.shot}`
      return typeLabel
    }
    case 'scene-tts': {
      if (vars.episode && vars.shot && vars.character) {
        return `${typeLabel} — 第${vars.episode}集 镜头${vars.shot} · ${vars.character}`
      }
      if (vars.episode && vars.shot) return `${typeLabel} — 第${vars.episode}集 镜头${vars.shot}`
      return typeLabel
    }
    default:
      return typeLabel
  }
}

function resetConfig() {
  selectedTypes.value = assetTypes.map(at => at.id)
  concurrency.value = 1
  overwrite.value = false
  submitting.value = false
  submitError.value = null
  configWarning.value = null
}

// When dialog opens: resume progress if batch is active, otherwise config
watch(show, (val) => {
  if (!val) return
  if (props.batchId) {
    mode.value = 'progress'
    submitError.value = null
    configWarning.value = null
  } else {
    mode.value = 'config'
    resetConfig()
  }
})

// If parent clears batch while dialog is open, return to config
watch(() => props.batchId, (id) => {
  if (!id && show.value && mode.value === 'progress' && !submitting.value) {
    mode.value = 'config'
    resetConfig()
  }
})

async function startGenerate() {
  submitting.value = true
  submitError.value = null
  configWarning.value = null
  try {
    const result = await runBatch({
      project: props.project,
      assetTypes: selectedTypes.value,
      concurrency: concurrency.value,
      overwrite: overwrite.value,
    })

    if (!result.batchId || result.totalTasks === 0) {
      configWarning.value = '没有需要生成的资产。所选类型均已存在，可勾选「重复生成」后重试。'
      return
    }

    emit('update:batchId', result.batchId)
    mode.value = 'progress'
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    submitError.value = e?.response?.data?.error || e.message || '提交失败，请重试'
  } finally {
    submitting.value = false
  }
}

async function retryTask(taskId: string) {
  try {
    await apiRetryTask(taskId)
  } catch {
    // Ignore retry errors; next poll will refresh status
  }
}

function close() {
  // Background run: keep batchId so parent continues polling
  if (mode.value === 'progress' && batchFinished.value) {
    emit('refresh')
    emit('clear-batch')
  }
  show.value = false
}
</script>
