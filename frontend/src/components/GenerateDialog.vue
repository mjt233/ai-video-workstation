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
          v-model="selectedImpl"
          :items="implementations"
          item-title="name"
          item-value="impl"
          label="选择生成模型"
          variant="outlined"
          class="mb-3"
          hide-details
        />

        <!-- User-settable workflow params -->
        <WorkflowParamsForm
          v-if="selectedDeclarations.length"
          ref="paramsFormRef"
          v-model="userValues"
          :declarations="selectedDeclarations"
          :project="props.project"
          class="mb-3"
        />

        <!-- Existing asset info -->
        <div
          v-if="existingAsset"
          class="text-body-small text-grey mb-2"
        >
          当前资产: {{ existingAsset }}
        </div>

        <!-- Optional hint (e.g. director mode notice) -->
        <div
          v-if="props.hint"
          class="text-body-small text-primary mb-2"
        >
          {{ props.hint }}
        </div>

        <!-- Loading state -->
        <template v-if="polling.status === 'running'">
          <v-progress-linear
            indeterminate
            color="primary"
            class="mb-2"
          />
          <div class="text-body-small text-primary mb-2">
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
            class="text-body-small"
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

        <!-- Submit Error -->
        <v-alert
          v-if="submitError"
          type="error"
          variant="tonal"
          class="mb-2"
        >
          {{ submitError }}
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
import { runWorkflow, getWorkflows, type WorkflowInfo, type WorkflowUserParamDeclaration, type WorkflowUserParamValue } from '../api/workflow'
import { useWorkflowTask } from '../composables/useWorkflowTask'
import WorkflowParamsForm from './WorkflowParamsForm.vue'

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
  /** 可选提示文案（如导演台模式提示），非空时在对话框内展示 */
  hint?: string
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
const implementations = ref<WorkflowInfo['implementations']>([])
const submitting = ref(false)
const submitError = ref<string | null>(null)
const taskId = ref<string | null>(null)
const polling = reactive(useWorkflowTask(taskId))
const logRef = ref<HTMLElement | null>(null)

/** 用户手动传入的工作流参数值（key → 值） */
const userValues = ref<Record<string, WorkflowUserParamValue>>({})
/** 参数输入表单引用（用于打开时重置为默认值） */
const paramsFormRef = ref<InstanceType<typeof WorkflowParamsForm> | null>(null)

/** 当前选中实现声明的用户参数（供表单渲染；随实现切换自动重置） */
const selectedDeclarations = computed<WorkflowUserParamDeclaration[]>(() => {
  const implDef = implementations.value.find((i) => i.impl === selectedImpl.value)
  return implDef?.params ?? []
})

// Load implementations when dialog opens
watch(show, async (val) => {
  if (val) {
    // Reset polling state for fresh start
    polling.status = 'idle'
    polling.logs = []
    polling.error = null
    submitError.value = null
    try {
      const workflows = await getWorkflows()
      const wf = workflows.find(w => w.type === props.workflowId)
      if (wf) {
        implementations.value = wf.implementations
        if (props.defaultImpl) {
          selectedImpl.value = props.defaultImpl
        } else {
          selectedImpl.value = implementations.value[0].impl
        }
      }
    } catch {
      // Ignore errors
    }
    // 打开对话框时，用户参数表单重置为默认值
    await nextTick()
    paramsFormRef.value?.reset()
  } else {
    // Reset on close
    taskId.value = null
    selectedImpl.value = props.defaultImpl ?? 'default'
    userValues.value = {}
  }
})

// Auto-scroll logs
watch(() => polling.logs.length, async () => {
  await nextTick()
  if (logRef.value) {
    logRef.value.scrollTop = logRef.value.scrollHeight
  }
})

// Auto-refresh parent and close when task completes
watch(() => polling.status, (newStatus) => {
  if (newStatus === 'completed') {
    emit('refresh')
    setTimeout(() => {
      show.value = false
    }, 1200)
  }
})

async function submit() {
  submitting.value = true
  submitError.value = null
  polling.error = null
  try {
    const result = await runWorkflow({
      project: props.project,
      workflowId: props.workflowId,
      impl: selectedImpl.value,
      params: {
        vars: props.vars,
        promptPaths: props.promptPaths ?? [],
        outputPath: props.outputPath,
        userParams: userValues.value,
      },
    })
    taskId.value = result.taskId
  } catch (err: any) {
    submitError.value = err?.response?.data?.error || err.message || '提交失败，请重试'
  } finally {
    submitting.value = false
  }
}

function close() {
  show.value = false
}
</script>
