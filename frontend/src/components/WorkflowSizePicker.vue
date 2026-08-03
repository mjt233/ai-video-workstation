<template>
  <div class="workflow-size-picker">
    <!-- 模式选择 -->
    <v-select
      :model-value="mode"
      :items="modeOptions"
      item-title="label"
      item-value="value"
      label="输出尺寸"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="setMode"
    />

    <!-- 比例 × 分辨率 -->
    <div
      v-if="mode === 'preset'"
      class="d-flex ga-2"
    >
      <v-select
        :model-value="ratio"
        :items="SIZE_RATIOS"
        item-title="key"
        item-value="key"
        label="比例"
        density="compact"
        variant="outlined"
        hide-details
        class="flex-grow-1"
        @update:model-value="(v) => setRatio(v as SizeRatioKey)"
      />
      <v-select
        :model-value="resolution"
        :items="SIZE_RESOLUTIONS"
        item-title="key"
        item-value="key"
        label="分辨率"
        density="compact"
        variant="outlined"
        hide-details
        class="flex-grow-1"
        @update:model-value="(v) => setResolution(v as SizeResolutionKey)"
      />
    </div>

    <!-- 手动填写 -->
    <div
      v-else-if="mode === 'manual'"
      class="d-flex ga-2"
    >
      <v-text-field
        :model-value="manualWidth"
        label="宽度 (px)"
        type="number"
        min="1"
        density="compact"
        variant="outlined"
        hide-details
        class="flex-grow-1"
        @update:model-value="setManualWidth"
      />
      <v-text-field
        :model-value="manualHeight"
        label="高度 (px)"
        type="number"
        min="1"
        density="compact"
        variant="outlined"
        hide-details
        class="flex-grow-1"
        @update:model-value="setManualHeight"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { readFs } from '../api/client'
import type { WorkflowUserParamValue } from '../api/workflow'
import {
  SIZE_RATIOS,
  SIZE_RESOLUTIONS,
  computePresetSize,
  resolveSizeMode,
  type SizeMode,
  type SizeRatioKey,
  type SizeResolutionKey,
} from '../utils/workflowSize'

const props = defineProps<{
  /** 项目名（用于「使用项目尺寸」读取 project.json；为空时隐藏该模式） */
  project?: string
  /** 外部初始值/回显（key → 值），含 enable_specified_size / width / height */
  modelValue: Record<string, WorkflowUserParamValue>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, WorkflowUserParamValue>): void
}>()

/** 当前选中模式 */
const mode = ref<SizeMode>('none')
/** 比例档 */
const ratio = ref<SizeRatioKey>('9:16')
/** 分辨率档 */
const resolution = ref<SizeResolutionKey>('1080P')
/** 手动填写宽度（像素） */
const manualWidth = ref<number | null>(null)
/** 手动填写高度（像素） */
const manualHeight = ref<number | null>(null)
/** 项目尺寸（project.json），读取失败为 null */
const projectSize = ref<{ width: number; height: number } | null>(null)
/** 自触发标记：组件 emit 后跳过下一次回显，避免反馈循环 */
const skipNextEcho = ref(false)
/** 用户是否已手动操作过组件（此后不再因项目尺寸加载完成而重推断模式） */
const hasInteracted = ref(false)

/** 模式选项（无 project 时隐藏「使用项目尺寸」；项目尺寸未就绪时禁用） */
const modeOptions = computed(() => {
  const options: Array<{ label: string; value: SizeMode; disabled?: boolean }> = [
    { label: '不指定', value: 'none' },
    { label: '比例 + 分辨率', value: 'preset' },
    { label: '手动填写', value: 'manual' },
  ]
  if (props.project) {
    options.push({ label: '使用项目尺寸', value: 'project', disabled: !projectSize.value })
  }
  return options
})

/**
 * 按当前内部状态输出尺寸值并通知父组件。
 * - none → { enable_specified_size: false }
 * - 其他模式 → { enable_specified_size: true, width, height }
 */
function emitSize() {
  const out: Record<string, WorkflowUserParamValue> = {}
  if (mode.value === 'none') {
    out.enable_specified_size = false
  } else {
    out.enable_specified_size = true
    if (mode.value === 'preset') {
      const s = computePresetSize(ratio.value, resolution.value)
      out.width = s.width
      out.height = s.height
    } else if (mode.value === 'manual') {
      if (manualWidth.value != null && manualWidth.value > 0) out.width = manualWidth.value
      if (manualHeight.value != null && manualHeight.value > 0) out.height = manualHeight.value
    } else if (mode.value === 'project') {
      if (projectSize.value) {
        out.width = projectSize.value.width
        out.height = projectSize.value.height
      }
    }
  }
  skipNextEcho.value = true
  emit('update:modelValue', out)
}

/** 切换模式 */
function setMode(v: unknown) {
  mode.value = v as SizeMode
  hasInteracted.value = true
  emitSize()
}

/** 切换比例档 */
function setRatio(v: SizeRatioKey) {
  ratio.value = v
  hasInteracted.value = true
  emitSize()
}

/** 切换分辨率档 */
function setResolution(v: SizeResolutionKey) {
  resolution.value = v
  hasInteracted.value = true
  emitSize()
}

/** 更新手动宽度 */
function setManualWidth(v: unknown) {
  manualWidth.value = v === '' || v === null || v === undefined ? null : Number(v)
  hasInteracted.value = true
  emitSize()
}

/** 更新手动高度 */
function setManualHeight(v: unknown) {
  manualHeight.value = v === '' || v === null || v === undefined ? null : Number(v)
  hasInteracted.value = true
  emitSize()
}

/**
 * 读取项目尺寸（project.json 的 width/height，取整）。
 * 读取失败或无效时置 null（「使用项目尺寸」模式将无法输出尺寸）。
 * 加载完成后若用户尚未手动操作，重跑一次回显推断，
 * 使「保存值等于项目尺寸」的初始场景能正确显示为 project 模式。
 */
async function loadProjectSize() {
  if (!props.project) {
    projectSize.value = null
    applyEcho(true)
    return
  }
  try {
    const data = await readFs(props.project, 'project.json')
    if (data && typeof data === 'object' && 'width' in data && 'height' in data) {
      const w = Math.round(Number((data as { width: unknown }).width))
      const h = Math.round(Number((data as { height: unknown }).height))
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        projectSize.value = { width: w, height: h }
        applyEcho(true)
        return
      }
    }
  } catch {
    // project.json 缺失或无效
  }
  projectSize.value = null
  applyEcho(true)
}

// 项目变化时重新读取项目尺寸（新项目视为全新的尺寸上下文，重置交互标记）
watch(() => props.project, () => {
  hasInteracted.value = false
  loadProjectSize()
}, { immediate: true })

/** 最近一次回显时的尺寸子集（enable/width/height），用于判断外部是否真的改了尺寸相关值 */
let lastEchoedSize = ''

/**
 * 依据外部 modelValue 推断并应用内部状态（模式/比例/分辨率/手动值）。
 *
 * - 组件自身 emit 后（skipNextEcho）跳过下一次回显，避免反馈循环
 * - 尺寸相关值（enable/width/height）未变化时不重推断，
 *   避免用户编辑其他非尺寸参数时覆盖当前选择
 * - force 为 true 时无视尺寸子集比对强制重推断（项目尺寸加载完成后使用）
 *
 * @param force 是否强制重推断（忽略尺寸子集比对）
 */
function applyEcho(force = false) {
  const v = props.modelValue
  const sizeSubset = JSON.stringify({
    enable: v.enable_specified_size ?? null,
    width: v.width ?? null,
    height: v.height ?? null,
  })
  if (skipNextEcho.value) {
    skipNextEcho.value = false
    lastEchoedSize = sizeSubset
    return
  }
  if (!force && sizeSubset === lastEchoedSize) return
  lastEchoedSize = sizeSubset
  const inferred = resolveSizeMode({
    enableSpecifiedSize: v.enable_specified_size,
    width: v.width as number | string | undefined,
    height: v.height as number | string | undefined,
    projectSize: projectSize.value,
  })
  mode.value = inferred
  if (inferred === 'preset') {
    const w = Number(v.width)
    const h = Number(v.height)
    const r = SIZE_RATIOS.find((x) => Math.abs(x.ratio - w / h) < 0.01)
    const res = SIZE_RESOLUTIONS.find(
      (x) => x.base === w || x.base === h,
    )
    if (r) ratio.value = r.key
    if (res) resolution.value = res.key
  } else if (inferred === 'manual') {
    manualWidth.value = v.width !== undefined && v.width !== '' ? Number(v.width) : null
    manualHeight.value = v.height !== undefined && v.height !== '' ? Number(v.height) : null
  }
}

// 外部值变化（如表单重置/回显）时推断模式
watch(
  () => props.modelValue,
  () => applyEcho(),
  { immediate: true, deep: true },
)
</script>
