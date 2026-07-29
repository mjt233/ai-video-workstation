<template>
  <v-dialog
    :model-value="modelValue"
    max-width="400"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>新建目录</v-card-title>
      <v-card-text>
        <v-text-field
          :model-value="name"
          label="目录名称"
          variant="outlined"
          density="comfortable"
          autofocus
          :error-messages="error"
          @update:model-value="emit('update:name', String($event ?? ''))"
          @keyup.enter="emit('confirm')"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="emit('update:modelValue', false)"
        >
          取消
        </v-btn>
        <v-btn
          color="primary"
          variant="tonal"
          :loading="loading"
          @click="emit('confirm')"
        >
          创建
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * 新建目录对话框。
 */
defineProps<{
  /** 是否显示 */
  modelValue: boolean
  /** 目录名称 */
  name: string
  /** 错误信息 */
  error: string
  /** 是否创建中 */
  loading: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:name': [value: string]
  /** 确认创建 */
  confirm: []
}>()
</script>
