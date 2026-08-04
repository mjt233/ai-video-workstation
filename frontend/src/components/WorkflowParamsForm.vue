<template>
  <div
    v-if="declarations.length"
    class="workflow-params-form"
  >
    <!-- 尺寸参数（width/height）→ 通用尺寸选择组件 -->
    <WorkflowSizePicker
      v-if="sizeKeys"
      :project="project"
      :model-value="sizeModelValue"
      class="mb-2"
      @update:model-value="onSizeChange"
    />

    <template
      v-for="d in sizeFilteredDeclarations"
      :key="d.key"
    >
      <!-- 布尔参数：开关 -->
      <v-switch
        v-if="d.type === 'boolean'"
        :model-value="values[d.key] ?? d.defaultValue"
        :label="d.name"
        :hint="d.description"
        persistent-hint
        density="compact"
        hide-details
        color="primary"
        class="mb-2"
        @update:model-value="(v) => setValue(d.key, v)"
      />

      <!-- 整数 / 小数参数：数字输入框 -->
      <v-text-field
        v-else-if="d.type === 'integer' || d.type === 'float'"
        :model-value="values[d.key] ?? d.defaultValue"
        :label="d.name"
        :hint="d.description"
        persistent-hint
        type="number"
        :step="d.type === 'integer' ? '1' : 'any'"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => setValue(d.key, v)"
      />

      <!-- 字符串参数：文本输入框 -->
      <v-text-field
        v-else
        :model-value="values[d.key] ?? d.defaultValue"
        :label="d.name"
        :hint="d.description"
        persistent-hint
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => setValue(d.key, v)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import WorkflowSizePicker from './WorkflowSizePicker.vue'
import { findSizeParamKeys, mergeSizeValues } from '../utils/workflowSize'
import type {
  WorkflowUserParamDeclaration,
  WorkflowUserParamValue,
} from '../api/workflow'

const props = defineProps<{
  /** 工作流参数声明列表（来自所选工作流实现） */
  declarations: WorkflowUserParamDeclaration[]
  /** 当前参数值（key → 值），仅用于外部初始化/回显 */
  modelValue: Record<string, WorkflowUserParamValue>
  /** 项目名（用于尺寸组件「使用项目尺寸」读取 project.json） */
  project?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, WorkflowUserParamValue>): void
}>()

/** 表单内部值（key → 值） */
const values = ref<Record<string, WorkflowUserParamValue>>({})

/** 尺寸相关 key（检测到 width + height 声明时非 null） */
const sizeKeys = computed(() => findSizeParamKeys(props.declarations))

/** 剔除尺寸相关 key 后的声明列表（其余参数仍走通用渲染） */
const sizeFilteredDeclarations = computed(() => {
  if (!sizeKeys.value) return props.declarations
  const excluded = new Set([sizeKeys.value.widthKey, sizeKeys.value.heightKey])
  if (sizeKeys.value.enableKey) excluded.add(sizeKeys.value.enableKey)
  return props.declarations.filter((d) => !excluded.has(d.key))
})

/** 尺寸组件的外部值（仅含 width/height/enable_specified_size 三个 key 的现值） */
const sizeModelValue = computed(() => {
  if (!sizeKeys.value) return {}
  const out: Record<string, WorkflowUserParamValue> = {}
  for (const k of [sizeKeys.value.widthKey, sizeKeys.value.heightKey, sizeKeys.value.enableKey]) {
    if (k && values.value[k] !== undefined) out[k] = values.value[k]
  }
  return out
})

/**
 * 尺寸组件值变化时合并进表单值。
 * 复用纯函数 `mergeSizeValues`：先清除旧的尺寸相关值，
 * 再并入组件输出中属于已声明尺寸 key 的新值。
 *
 * @param v 组件输出的尺寸值（enable_specified_size/width/height）
 */
function onSizeChange(v: Record<string, WorkflowUserParamValue>) {
  if (!sizeKeys.value) return
  values.value = mergeSizeValues(values.value, sizeKeys.value, v)
  emit('update:modelValue', { ...values.value })
}

/**
 * 根据声明初始化表单值（取各参数默认值），并回填外部已保存的值（modelValue），
 * 然后通知父组件。
 *
 * 说明：
 * - 声明为空（如画布节点的工作流列表尚未异步加载完成）时不初始化也不回写父级，
 *   避免用空对象覆盖父级已保存的配置（如节点 config.workflowParams 里的输出尺寸）。
 * - modelValue 仅用于「外部初始化/回显」——挂载或声明变化时，把其中属于已声明
 *   key 的非空值覆盖到默认值之上。这样画布节点等场景在配置面板重挂载后能正确
 *   回显已保存的配置组合（如输出尺寸），不会退化为默认值；modelValue 为空对象时
 *   则与旧行为一致（全部使用默认值）。
 *
 * @param decls 参数声明列表
 */
function initFromDefaults(decls: WorkflowUserParamDeclaration[]) {
  if (!decls.length) return
  const next: Record<string, WorkflowUserParamValue> = {}
  for (const d of decls) next[d.key] = d.defaultValue
  const saved = props.modelValue
  if (saved && typeof saved === 'object') {
    for (const d of decls) {
      const v = saved[d.key]
      if (v !== undefined && v !== null) next[d.key] = v
    }
  }
  values.value = next
  emit('update:modelValue', { ...next })
}

// 声明变化（如切换工作流实现）时，按新默认值重置表单
// immediate：组件挂载即初始化；父组件必须传入稳定的声明数组引用，避免重复触发
watch(
  () => props.declarations,
  (decls) => initFromDefaults(decls ?? []),
  { immediate: true, deep: true },
)

/**
 * 更新单个参数值并通知父组件。
 *
 * @param key 参数字段 key
 * @param val 用户输入的原生值（boolean / number / string）
 */
function setValue(key: string, val: unknown) {
  values.value = { ...values.value, [key]: val as WorkflowUserParamValue }
  emit('update:modelValue', { ...values.value })
}

/**
 * 重置表单为声明默认值。
 * 父组件可在打开对话框等需要“恢复默认”的场景调用。
 */
function reset() {
  initFromDefaults(props.declarations)
}

defineExpose({ reset })
</script>
