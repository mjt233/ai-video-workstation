<template>
  <div class="image-generate-editor">
    <v-text-field
      :model-value="nodeName"
      label="节点名称"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="(v) => emit('update:config', { name: v })"
    />

    <v-textarea
      :model-value="prompt"
      label="提示词 Prompt"
      rows="3"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="(v) => emit('update:config', { prompt: v })"
    />

    <v-select
      :model-value="workflowId"
      :items="workflowItems"
      item-title="label"
      item-value="id"
      label="工作流"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="(v) => emit('update:config', { workflowId: v, workflowImpl: undefined, workflowParams: {} })"
    />

    <div class="text-caption text-medium-emphasis mb-1">
      输入图（{{ inputPaths.length }}）
    </div>
    <div
      v-if="inputPaths.length"
      class="d-flex flex-wrap ga-1 mb-2"
    >
      <v-chip
        v-for="(p, i) in inputPaths"
        :key="i"
        size="small"
      >
        {{ p.split('/').pop() }}
      </v-chip>
    </div>
    <div
      v-else
      class="text-caption text-grey mb-2"
    >
      无输入图，默认使用文生图工作流
    </div>

    <WorkflowParamsForm
      v-model="workflowParams"
      :declarations="currentDeclarations"
    />

    <div class="d-flex align-center ga-2 mb-2">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
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
      <v-btn
        v-if="node.config.current && !isRunning"
        size="small"
        variant="tonal"
        color="primary"
        @click="emit('set-as-scene', node.id)"
      >
        设为分镜场景图
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getWorkflows, type WorkflowInfo } from '../../../api/workflow'
import type { CanvasNodeData } from '../../../canvas/types'
import { getHistory } from '../../../canvas/generate'
import WorkflowParamsForm from '../../WorkflowParamsForm.vue'
import type { WorkflowUserParamValue } from '../../../api/workflow'

const props = defineProps<{
  project: string
  node: CanvasNodeData
  inputPaths: string[]
  isRunning: boolean
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'open-history', nodeId: string): void
  (e: 'set-as-scene', nodeId: string): void
}>()

const workflows = ref<WorkflowInfo[]>([])

const nodeName = computed(() => props.node.name)
const prompt = computed(() => (typeof props.node.config.prompt === 'string' ? props.node.config.prompt : ''))
const workflowId = computed(() => {
  const explicit = props.node.config.workflowId
  if (typeof explicit === 'string' && explicit) return explicit
  return props.inputPaths.length > 0 ? 'image-edit' : 'text-to-image'
})
const history = computed(() => getHistory(props.node.config))
const workflowParams = ref<Record<string, WorkflowUserParamValue>>({})

const currentWorkflow = computed(() => workflows.value.find((w) => w.id === workflowId.value))
const currentDeclarations = computed(() => {
  const impl = currentWorkflow.value?.implementations.find((i) => i.impl === (props.node.config.workflowImpl || 'default'))
  return impl?.params ?? []
})

const workflowItems = computed(() =>
  workflows.value
    .filter((w) => w.id === 'text-to-image' || w.id === 'image-edit')
    .map((w) => ({ id: w.id, label: w.name })),
)

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
