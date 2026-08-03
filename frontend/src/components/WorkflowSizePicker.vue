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

/** 模式选项（无 project 时隐藏「使用项目尺寸」） */
const modeOptions = computed(() => {
  const options: Array<{ label: string; value: SizeMode }> = [
    { label: '不指定', value: 'none' },
    { label: '比例 + 分辨率', value: 'preset' },
    { label: '手动填写', value: 'manual' },
  ]
  if (props.project) {
    options.push({ label: '使用项目尺寸', value: 'project' })
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
      if (manualWidth.value != null) out.width = manualWidth.value
      if (manualHeight.value != null) out.height = manualHeight.value
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
  emitSize()
}

/** 切换比例档 */
function setRatio(v: SizeRatioKey) {
  ratio.value = v
  emitSize()
}

/** 切换分辨率档 */
function setResolution(v: SizeResolutionKey) {
  resolution.value = v
  emitSize()
}

/** 更新手动宽度 */
function setManualWidth(v: unknown) {
  manualWidth.value = v === '' || v === null || v === undefined ? null : Number(v)
  emitSize()
}

/** 更新手动高度 */
function setManualHeight(v: unknown) {
  manualHeight.value = v === '' || v === null || v === undefined ? null : Number(v)
  emitSize()
}

/**
 * 读取项目尺寸（project.json 的 width/height，取整）。
 * 读取失败或无效时置 null（「使用项目尺寸」模式将无法输出尺寸）。
 */
async function loadProjectSize() {
  if (!props.project) {
    projectSize.value = null
    return
  }
  try {
    const data = await readFs(props.project, 'project.json')
    if (data && typeof data === 'object' && 'width' in data && 'height' in data) {
      const w = Math.round(Number((data as { width: unknown }).width))
      const h = Math.round(Number((data as { height: unknown }).height))
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        projectSize.value = { width: w, height: h }
        return
      }
    }
  } catch {
    // project.json 缺失或无效
  }
  projectSize.value = null
}

// 项目变化时重新读取项目尺寸
watch(() => props.project, loadProjectSize, { immediate: true })

// 外部值变化（如表单重置/回显）时推断模式
watch(
  () => props.modelValue,
  (v) => {
    if (skipNextEcho.value) {
      skipNextEcho.value = false
      return
    }
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
  },
  { immediate: true, deep: true },
)
</script>
