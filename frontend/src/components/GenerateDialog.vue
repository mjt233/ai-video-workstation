<template>
  <v-dialog
    v-model="show"
    max-width="520"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          class="mr-2"
          color="primary"
        >
          mdi-auto-fix
        </v-icon>
        {{ workflowName }}
      </v-card-title>

      <v-card-text>
        <!-- Implementation selector -->
        <v-select
          v-if="implementations.length > 1"
          v-model="selectedImpl"
          :items="implementations"
          item-title="name"
          item-value="impl"
          label="选择生成模型"
          variant="outlined"
          class="mb-3"
          hide-details
        />

        <!-- Existing asset info -->
        <div
          v-if="existingAsset"
          class="text-caption text-grey mb-2"
        >
          当前资产: {{ existingAsset }}
        </div>

        <!-- Loading state -->
        <template v-if="polling.status === 'running'">
          <v-progress-linear
            indeterminate
            color="primary"
            class="mb-2"
          />
          <div class="text-caption text-primary mb-2">
            生成中，请稍候...
          </div>
        </template>

        <!-- Logs -->
        <div
          v-if="polling.logs.length"
          ref="logRef"
          class="bg-grey-lighten-3 rounded pa-2 mb-2"
          style="max-height: 180px; overflow-y: auto; font-size: 12px; font-family: monospace;"
        >
          <div
            v-for="(log, i) in polling.logs"
            :key="i"
            class="text-caption"
            :class="log.level === 'error' ? 'text-error' : log.level === 'warn' ? 'text-warning' : 'text-grey-darken-1'"
          >
            [{{ log.created_at }}] {{ log.message }}
          </div>
        </div>

        <!-- Completed -->
        <v-alert
          v-if="polling.status === 'completed'"
          type="success"
          variant="tonal"
          class="mb-2"
        >
          生成完成
          <template #append>
            <v-btn
              size="small"
              variant="text"
              @click="$emit('refresh')"
            >
              刷新查看
            </v-btn>
          </template>
        </v-alert>

        <!-- Failed -->
        <v-alert
          v-if="polling.status === 'failed'"
          type="error"
          variant="tonal"
          class="mb-2"
        >
          {{ polling.error || '生成失败' }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn
          v-if="polling.status === 'idle' || polling.status === 'failed'"
          color="primary"
          :loading="submitting"
          @click="submit"
        >
          {{ polling.status === 'failed' ? '重新生成' : '开始生成' }}
        </v-btn>
        <v-btn
          variant="text"
          @click="close"
        >
          {{ polling.status === 'running' ? '后台运行' : '关闭' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick, reactive } from 'vue'
import { runWorkflow, getWorkflows, type WorkflowInfo } from '../api/workflow'
import { useWorkflowTask } from '../composables/useWorkflowTask'

const props = defineProps<{
  modelValue: boolean
  project: string
  workflowId: string
  workflowName: string
  vars: Record<string, string>
  outputPath: string
  promptPaths?: string[]
  existingAsset?: string
  defaultImpl?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'refresh'): void
}>()

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const selectedImpl = ref(props.defaultImpl ?? 'default')
const implementations = ref<{ impl: string; name: string; description?: string }[]>([])
const submitting = ref(false)
const taskId = ref<string | null>(null)
const polling = reactive(useWorkflowTask(taskId))
const logRef = ref<HTMLElement | null>(null)

// Load implementations when dialog opens
watch(show, async (val) => {
  if (val) {
    try {
      const workflows = await getWorkflows()
      const wf = workflows.find(w => w.id === props.workflowId)
      if (wf) {
        implementations.value = wf.implementations
        if (props.defaultImpl) selectedImpl.value = props.defaultImpl
      }
    } catch {
      // Ignore errors
    }
  } else {
    // Reset on close
    taskId.value = null
    selectedImpl.value = props.defaultImpl ?? 'default'
  }
})

// Auto-scroll logs
watch(() => polling.logs.length, async () => {
  await nextTick()
  if (logRef.value) {
    logRef.value.scrollTop = logRef.value.scrollHeight
  }
})

async function submit() {
  submitting.value = true
  try {
    const result = await runWorkflow({
      project: props.project,
      workflowId: props.workflowId,
      impl: selectedImpl.value,
      params: {
        vars: props.vars,
        promptPaths: props.promptPaths ?? [],
        outputPath: props.outputPath,
      },
    })
    taskId.value = result.taskId
  } catch (err: any) {
    console.error('Failed to submit workflow:', err)
  } finally {
    submitting.value = false
  }
}

function close() {
  show.value = false
}
</script>
