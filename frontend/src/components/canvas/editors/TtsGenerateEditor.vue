<template>
  <div class="tts-generate-editor">
    <v-radio-group
      :model-value="mode"
      inline
      density="compact"
      hide-details
      class="mb-1"
      @update:model-value="onModeChange"
    >
      <v-radio
        label="音色克隆"
        value="clone"
      />
      <v-radio
        label="音色设计"
        value="design"
      />
    </v-radio-group>

    <div class="text-body-small text-medium-emphasis mb-2">
      <template v-if="mode === 'clone'">
        参考音频（{{ inputs.length }}）：
        <span v-if="inputs.length">已连接，将作为克隆音色参考</span>
        <span
          v-else
          class="text-error"
        >需先连接「加载音频」节点</span>
      </template>
      <template v-else>
        音色设计无需参考音频
      </template>
    </div>

    <template v-if="mode === 'clone'">
      <v-textarea
        :model-value="text"
        label="朗读文本 Text"
        rows="3"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => emit('update:config', { text: v })"
      />
      <v-textarea
        :model-value="refText"
        label="参考音频文字内容 RefText"
        rows="2"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => emit('update:config', { refText: v })"
      />
    </template>
    <template v-else>
      <v-textarea
        :model-value="prompt"
        label="声线描述 Prompt"
        rows="2"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => emit('update:config', { prompt: v })"
      />
      <v-textarea
        :model-value="text"
        label="朗读文本 Text"
        rows="3"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => emit('update:config', { text: v })"
      />
    </template>

    <v-select
      :model-value="currentImplId"
      :items="implItems"
      item-title="label"
      item-value="value"
      :label="mode === 'clone' ? '克隆工作流实现' : '设计工作流实现'"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="onImplChange"
    />

    <WorkflowParamsForm
      v-model="workflowParams"
      :declarations="currentDeclarations"
      :project="props.project"
    />

    <div class="d-flex align-center ga-2">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
        :disabled="!canGenerate"
        @click="emit('generate', node.id)"
      >
        {{ node.config.current ? '重新生成' : '生成' }}
      </v-btn>
      <v-btn
        v-if="isRunning"
        size="small"
        variant="tonal"
        @click="emit('interrupt', node.id)"
      >
        中断
      </v-btn>
      <v-spacer />
      <v-btn
        v-if="node.config.current"
        size="small"
        variant="text"
        @click="emit('open-history', node.id)"
      >
        历史 ({{ history.length }})
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getWorkflows, type WorkflowInfo, type WorkflowUserParamValue } from '../../../api/workflow'
import type { CanvasNodeData } from '../../../canvas/types'
import { getHistory, type CanvasInputInfo } from '../../../canvas/generate'
import WorkflowParamsForm from '../../WorkflowParamsForm.vue'

const props = defineProps<{
  project: string
  node: CanvasNodeData
  inputs: CanvasInputInfo[]
  isRunning: boolean
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'open-history', nodeId: string): void
}>()

const workflows = ref<WorkflowInfo[]>([])

const mode = computed(() => (props.node.config.mode === 'clone' ? 'clone' : 'design'))
const text = computed(() => (typeof props.node.config.text === 'string' ? props.node.config.text : ''))
const refText = computed(() => (typeof props.node.config.refText === 'string' ? props.node.config.refText : ''))
const prompt = computed(() => (typeof props.node.config.prompt === 'string' ? props.node.config.prompt : ''))
const history = computed(() => getHistory(props.node.config))
const workflowParams = ref<Record<string, WorkflowUserParamValue>>({})

const workflowId = computed(() => (mode.value === 'clone' ? 'tts-voice-clone' : 'tts-voice-design'))

const currentWorkflow = computed(() => workflows.value.find((w) => w.type === workflowId.value))

const implItems = computed(() =>
  (currentWorkflow.value?.implementations ?? []).map((i) => ({ value: i.impl, label: i.name })),
)

const currentImplId = computed(() => {
  const impl = props.node.config.workflowImpl
  if (typeof impl === 'string' && implItems.value.some((i) => i.value === impl)) return impl
  return implItems.value[0]?.value ?? ''
})

/** 克隆模式未连接音频输入时禁用生成 */
const canGenerate = computed(() => !(mode.value === 'clone' && props.inputs.length < 1))

const currentDeclarations = computed(() => {
  const impl = (currentWorkflow.value?.implementations ?? []).find((i) => i.impl === currentImplId.value)
  return impl?.params ?? []
})

/**
 * 切换生成模式（音色克隆 / 音色设计）：重置工作流实现与参数。
 * @param v 目标模式（clone / design，VRadioGroup 可能抛出 null）
 */
function onModeChange(v: string | null) {
  if (v !== 'clone' && v !== 'design') return
  emit('update:config', { mode: v, workflowImpl: undefined, workflowParams: {} })
}

/**
 * 切换工作流实现（如不同 TTS 提供方），重置参数为默认。
 * @param v 实现标识（impl）
 */
function onImplChange(v: string) {
  emit('update:config', { workflowImpl: v, workflowParams: {} })
}

watch(
  () => props.node.config.workflowParams,
  (v) => {
    if (v && typeof v === 'object') workflowParams.value = { ...(v as Record<string, WorkflowUserParamValue>) }
  },
  { immediate: true, deep: true },
)

watch(
  workflowParams,
  (v) => {
    // 相等性守卫：config.workflowParams 与本地值一致时不再回写，
    // 避免「config → 本地 → emit → config」无限循环。
    const cur = props.node.config.workflowParams
    const same = cur != null && typeof cur === 'object' && JSON.stringify(cur) === JSON.stringify(v)
    if (!same) emit('update:config', { workflowParams: v })
  },
)

// 加载工作流列表（初始化一次）
getWorkflows()
  .then((list) => { workflows.value = list })
  .catch(() => { workflows.value = [] })
</script>
