<template>
  <div
    v-if="declarations.length"
    class="workflow-params-form"
  >
    <template
      v-for="d in declarations"
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
import { ref, watch } from 'vue'
import type {
  WorkflowUserParamDeclaration,
  WorkflowUserParamValue,
} from '../api/workflow'

const props = defineProps<{
  /** 工作流参数声明列表（来自所选工作流实现） */
  declarations: WorkflowUserParamDeclaration[]
  /** 当前参数值（key → 值），仅用于外部初始化/回显 */
  modelValue: Record<string, WorkflowUserParamValue>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, WorkflowUserParamValue>): void
}>()

/** 表单内部值（key → 值） */
const values = ref<Record<string, WorkflowUserParamValue>>({})

/**
 * 根据声明重新初始化表单值（取各参数默认值），并通知父组件。
 *
 * @param decls 参数声明列表
 */
function initFromDefaults(decls: WorkflowUserParamDeclaration[]) {
  const next: Record<string, WorkflowUserParamValue> = {}
  for (const d of decls) next[d.key] = d.defaultValue
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
