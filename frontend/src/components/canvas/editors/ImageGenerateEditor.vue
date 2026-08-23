<template>
  <div class="image-generate-editor">
    <div class="text-body-small text-medium-emphasis mb-1">
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
        location="top"
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
            <span
              class="canvas-input-item__label"
              :title="input.label"
            >图像{{ i + 1 }}</span>
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
      class="text-body-small text-grey mb-2"
    >
      无输入图，默认使用文生图工作流
    </div>

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
      :items="workflowTypeItems"
      item-title="label"
      item-value="value"
      label="工作流类型"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="onTypeChange"
    />

    <v-select
      :model-value="currentImplId"
      :items="implItems"
      item-title="label"
      item-value="value"
      label="工作流实现"
      placeholder="请选择工作流实现"
      density="compact"
      variant="outlined"
      :disabled="workflowsLoaded && implItems.length === 0"
      :error="!!implError"
      :error-messages="implError ? [implError] : []"
      class="mb-2"
      @update:model-value="onImplChange"
    >
      <!-- 下拉选项最右侧显示提供商 chip（v-bind="itemProps" 保留 title 与选中态） -->
      <template #item="{ item, props: itemProps }">
        <v-list-item v-bind="itemProps">
          <template #append>
            <v-chip
              v-if="providerLabel(item)"
              size="x-small"
              label
              variant="tonal"
              color="secondary"
              class="ml-1"
            >
              {{ providerLabel(item) }}
            </v-chip>
          </template>
        </v-list-item>
      </template>
    </v-select>

    <WorkflowParamsForm
      v-model="workflowParams"
      :declarations="currentDeclarations"
      :provider="currentImpl?.providerInstanceId"
      :provider-type="currentImpl?.provider"
      :project="props.project"
    />

    <div class="d-flex align-center ga-2 mb-2">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
        @click="requestGenerate"
      >
        {{ hasOutput ? '重新生成' : '生成' }}
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
        v-if="hasOutput"
        size="small"
        variant="text"
        @click="emit('open-history', node.id)"
      >
        历史
      </v-btn>
      <v-btn
        v-if="kind === 'scene' && hasOutput && !isRunning"
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
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { buildPreviewUrl } from '../../../canvas/preview'
import WorkflowParamsForm from '../../WorkflowParamsForm.vue'
import type { WorkflowUserParamValue } from '../../../api/workflow'

const props = defineProps<{
  project: string
  node: CanvasNodeData
  inputs: CanvasInputInfo[]
  isRunning: boolean
  /** 画布类型：仅分镜画布（scene）显示「设为分镜场景图」 */
  kind: CanvasKind
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'open-history', nodeId: string): void
  (e: 'set-as-scene', nodeId: string): void
}>()

const workflows = ref<WorkflowInfo[]>([])
/** 工作流列表是否已加载完成（区分「加载中」与「类型下没有可用实现」的校验提示） */
const workflowsLoaded = ref(false)
/** 工作流实现校验错误（未选择实现时点击生成显示，选择后清除） */
const implError = ref('')

/** 节点当前是否已有产物（生成按钮文案/历史/设为分镜场景图入口用；产物为固定路径文件，由服务端落盘） */
const hasOutput = computed(() => !!(props.output || props.node.config.current))

const prompt = computed(() => (typeof props.node.config.prompt === 'string' ? props.node.config.prompt : ''))
const workflowId = computed(() => {
  const explicit = props.node.config.workflowId
  if (typeof explicit === 'string' && explicit) return explicit
  return props.inputs.length > 0 ? 'image-edit' : 'text-to-image'
})
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

const currentWorkflow = computed(() => workflows.value.find((w) => w.type === workflowId.value))

/** 工作流类型下拉（文生图 / 图片编辑） */
const workflowTypeItems = computed(() =>
  workflows.value
    .filter((w) => w.type === 'text-to-image' || w.type === 'image-edit')
    .map((w) => ({ value: w.type, label: w.type === 'text-to-image' ? '文生图' : '图片编辑' })),
)

/** 当前类型下的所有实现（如 ComfyUI default / Seedream pro / Seedream lite；providerName 用于选项 chip） */
const implItems = computed(() =>
  (currentWorkflow.value?.implementations ?? []).map((i) => ({ value: i.impl, label: i.name, providerName: i.providerName, provider: i.provider })),
)

/**
 * 解析工作流实现条目的服务商显示名。
 *
 * 优先展示服务商实例名（providerName，来自 /api/workflows）；未提供时回退显示
 * provider 类型 ID；均缺失返回空串（下拉选项不渲染 chip）。
 *
 * @param raw 下拉原始条目（含可选 providerName / provider 字段）
 * @returns 服务商显示名；未声明时为空串
 */
function providerLabel(raw: { providerName?: string; provider?: string }): string {
  return raw?.providerName ?? raw?.provider ?? ''
}

/** 当前选择的工作流实现标识（仅回显 config.workflowImpl；缺失/非法时为空，不展示虚假默认值） */
const currentImplId = computed(() => {
  const impl = props.node.config.workflowImpl
  if (typeof impl === 'string' && implItems.value.some((i) => i.value === impl)) return impl
  return ''
})

/**
 * 切换工作流类型：显式写入 workflowId，重置实现与参数（实现置空，须用户重新选择）。
 * @param v 工作流类型（text-to-image / image-edit）
 */
function onTypeChange(v: string) {
  implError.value = ''
  emit('update:config', { workflowId: v, workflowImpl: undefined, workflowParams: {} })
}

/**
 * 切换工作流实现（如 ComfyUI default / Seedream pro/lite），重置参数为默认。
 * @param v 实现标识（impl）
 */
function onImplChange(v: string) {
  implError.value = ''
  emit('update:config', { workflowImpl: v, workflowParams: {} })
}

/**
 * 点击「生成」：未选择工作流实现时展示校验错误且不触发生成，
 * 保证实际提交的实现与界面显示一致。
 */
function requestGenerate() {
  if (!currentImplId.value) {
    implError.value = !workflowsLoaded.value
      ? '工作流列表加载中，请稍候再试'
      : implItems.value.length === 0
        ? '当前工作流类型没有可用实现，请先在服务商设置中配置实例'
        : '请先选择工作流实现'
    return
  }
  implError.value = ''
  emit('generate', props.node.id)
}

/** 当前选择的工作流实现（找不到时为 undefined） */
const currentImpl = computed(() =>
  (currentWorkflow.value?.implementations ?? []).find((i) => i.impl === currentImplId.value),
)

const currentDeclarations = computed(() => currentImpl.value?.params ?? [])

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
  .finally(() => { workflowsLoaded.value = true })
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
