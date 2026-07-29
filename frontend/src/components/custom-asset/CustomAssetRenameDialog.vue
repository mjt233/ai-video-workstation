<template>
  <v-dialog
    :model-value="modelValue"
    max-width="400"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>重命名</v-card-title>
      <v-card-text>
        <v-text-field
          :model-value="name"
          :label="isDir ? '新目录名' : '新文件名'"
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
          确定
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * 重命名对话框。
 */
defineProps<{
  /** 是否显示 */
  modelValue: boolean
  /** 新名称 */
  name: string
  /** 是否为目录 */
  isDir: boolean
  /** 错误信息 */
  error: string
  /** 是否提交中 */
  loading: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:name': [value: string]
  /** 确认重命名 */
  confirm: []
}>()
</script>
