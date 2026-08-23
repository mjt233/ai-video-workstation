<template>
  <v-alert
    type="error"
    variant="tonal"
    density="compact"
    class="mt-2"
    :text="`未注册的配置组件：${componentName || name || '（未声明）'}`"
  />
</template>

<script setup lang="ts">
/**
 * 未在映射表中登记的 component 字段占位。
 * 避免对话框因未知组件名崩溃，仅展示错误提示。
 */
defineProps<{
  /** schema 声明的组件名（对话框通过 name 传入） */
  name?: string
  /** 备用：部分调用方以 componentName 传入 */
  componentName?: string
  /** 透传的字段值（本组件不使用，仅满足 v-model 签名） */
  modelValue?: unknown
}>()

defineEmits<{
  (e: 'update:modelValue', value: unknown): void
}>()
</script>
