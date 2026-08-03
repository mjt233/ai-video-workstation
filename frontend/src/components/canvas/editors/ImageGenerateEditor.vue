<template>
  <div class="image-generate-editor">
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
      输入图（{{ inputs.length }}）
      <span
        v-if="inputs.length"
        class="text-grey"
      >
        · 拖拽调整顺序
      </span>
    </div>
    <div
      v-if="inputs.length"
      ref="listEl"
      class="canvas-input-list mb-2"
      @dragover.prevent="onListDragOver"
      @drop.prevent="onDrop"
    >
      <v-tooltip
        v-for="(input, i) in inputs"
        :key="input.nodeId"
        location="right"
        open-delay="250"
      >
        <template #activator="{ props: tp }">
          <div
            class="canvas-input-item"
            :class="[
              draggingIndex === i ? 'canvas-input-item--dragging' : '',
              dropSide(i) === 'left' ? 'canvas-input-item--insert-left' : '',
              dropSide(i) === 'right' ? 'canvas-input-item--insert-right' : '',
            ]"
            v-bind="tp"
            draggable="true"
            @dragstart="onDragStart($event, i)"
            @dragend="onDragEnd"
          >
            <img
              class="canvas-input-item__thumb"
              :src="previewUrls[input.nodeId]"
              :alt="input.label"
              draggable="false"
            >
            <span class="canvas-input-item__label">{{ input.label }}</span>
          </div>
        </template>
        <img
          class="canvas-input-zoom"
          :src="previewUrls[input.nodeId]"
          :alt="input.label"
        >
      </v-tooltip>
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
import { getHistory, type CanvasInputInfo } from '../../../canvas/generate'
import { buildPreviewUrl } from '../../../canvas/preview'
import WorkflowParamsForm from '../../WorkflowParamsForm.vue'
import type { WorkflowUserParamValue } from '../../../api/workflow'

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
  (e: 'set-as-scene', nodeId: string): void
}>()

const workflows = ref<WorkflowInfo[]>([])

const prompt = computed(() => (typeof props.node.config.prompt === 'string' ? props.node.config.prompt : ''))
const workflowId = computed(() => {
  const explicit = props.node.config.workflowId
  if (typeof explicit === 'string' && explicit) return explicit
  return props.inputs.length > 0 ? 'image-edit' : 'text-to-image'
})
const history = computed(() => getHistory(props.node.config))
const workflowParams = ref<Record<string, WorkflowUserParamValue>>({})

/** 输入图缩略图/放大预览 URL（按来源节点缓存，输入变化时重建） */
const previewUrls = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.inputs) m[inp.nodeId] = buildPreviewUrl(props.project, inp.path)
  return m
})

// ── 输入图拖拽排序 ────────────────────────────────────────

/** 正在拖拽的输入项下标 */
const draggingIndex = ref<number | null>(null)
/** 拖拽插入位置（0..inputs.length，表示插入到该下标之前） */
const dropIndex = ref<number | null>(null)
/** 输入图列表容器 DOM */
const listEl = ref<HTMLElement | null>(null)

/**
 * 拖拽开始：记录源下标并初始化插入位置。
 *
 * @param e 拖拽事件
 * @param i 源下标
 */
function onDragStart(e: DragEvent, i: number) {
  draggingIndex.value = i
  dropIndex.value = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
  }
}

/** 拖拽结束（含放下后）：清空拖拽状态 */
function onDragEnd() {
  draggingIndex.value = null
  dropIndex.value = null
}

/**
 * 列表 dragover：按鼠标水平位置计算插入下标（前半插到该项前，后半插到该项后）。
 *
 * @param e 拖拽事件
 */
function onListDragOver(e: DragEvent) {
  if (draggingIndex.value === null) return
  e.preventDefault()
  const items = Array.from(listEl.value?.querySelectorAll('.canvas-input-item') ?? [])
  let idx = items.length
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect()
    if (e.clientX < r.left + r.width / 2) {
      idx = i
      break
    }
  }
  dropIndex.value = idx
}

/**
 * 当前项左右侧的插入高亮（用于显示插入位置）。
 *
 * @param i 下标
 * @returns 插入到该项左侧/右侧，或 null
 */
function dropSide(i: number): 'left' | 'right' | null {
  if (dropIndex.value === null) return null
  if (dropIndex.value === i) return 'left'
  if (dropIndex.value === i + 1) return 'right'
  return null
}

/** 放下：按插入位置重排并持久化 inputOrder 到节点配置 */
function onDrop() {
  const from = draggingIndex.value
  const to = dropIndex.value
  draggingIndex.value = null
  dropIndex.value = null
  if (from === null || to === null) return
  if (from === to || from === to - 1) return
  const arr = [...props.inputs]
  const [moved] = arr.splice(from, 1)
  const target = to > from ? to - 1 : to
  arr.splice(target, 0, moved)
  emit('update:config', { inputOrder: arr.map((x) => x.nodeId) })
}

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

<style scoped>
.canvas-input-list {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  padding: 4px;
  min-height: 58px;
  border: 1px dashed rgba(0, 0, 0, 0.16);
  border-radius: 6px;
}

.canvas-input-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 58px;
  padding: 2px;
  border-radius: 4px;
  cursor: grab;
  user-select: none;
}

.canvas-input-item--dragging {
  opacity: 0.4;
}

.canvas-input-item--insert-left {
  box-shadow: inset 2px 0 0 rgb(25, 118, 210);
}

.canvas-input-item--insert-right {
  box-shadow: inset -2px 0 0 rgb(25, 118, 210);
}

.canvas-input-item__thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(0, 0, 0, 0.04);
}

.canvas-input-item__label {
  font-size: 10px;
  line-height: 1.2;
  color: rgba(0, 0, 0, 0.6);
  max-width: 58px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.canvas-input-zoom {
  display: block;
  max-width: 280px;
  max-height: 280px;
  border-radius: 6px;
  background: #fff;
  padding: 4px;
}
</style>
