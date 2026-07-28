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

          <v-alert
            v-if="submitError"
            type="error"
            variant="tonal"
            class="mb-3"
            density="compact"
          >
            {{ submitError }}
          </v-alert>

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
                {{ getTaskDisplayName(task.workflowId) }}
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
import { runBatch, retryTask as apiRetryTask } from '../api/workflow'
import { useBatchTask } from '../composables/useBatchTask'

const props = defineProps<{
  modelValue: boolean
  project: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'refresh'): void
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
const batchId = ref<string | null>(null)
const { summary, tasks, loading } = useBatchTask(batchId)

const progressPercent = computed(() => {
  if (summary.total === 0) return 0
  return ((summary.completed + summary.failed) / summary.total) * 100
})

const batchRunning = computed(() => summary.running > 0 || summary.pending > 0)

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

function getTaskDisplayName(workflowId: string): string {
  const at = assetTypes.find(a => a.id === workflowId)
  return at?.label ?? workflowId
}

// Reset state when dialog opens
watch(show, (val) => {
  if (val) {
    mode.value = 'config'
    selectedTypes.value = assetTypes.map(at => at.id)
    concurrency.value = 1
    overwrite.value = false
    submitting.value = false
    submitError.value = null
    batchId.value = null
  }
})

async function startGenerate() {
  submitting.value = true
  submitError.value = null
  try {
    const result = await runBatch({
      project: props.project,
      assetTypes: selectedTypes.value,
      concurrency: concurrency.value,
      overwrite: overwrite.value,
    })
    batchId.value = result.batchId
    mode.value = 'progress'
  } catch (err: any) {
    submitError.value = err?.response?.data?.error || err.message || '提交失败，请重试'
  } finally {
    submitting.value = false
  }
}

async function retryTask(taskId: string) {
  try {
    await apiRetryTask(taskId)
  } catch {
    // Ignore retry errors
  }
}

function close() {
  // If in progress mode and all tasks are done, refresh parent
  if (mode.value === 'progress' && summary.completed + summary.failed === summary.total && summary.total > 0) {
    emit('refresh')
  }
  show.value = false
}
</script>
