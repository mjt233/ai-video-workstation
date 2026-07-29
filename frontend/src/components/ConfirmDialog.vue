<template>
  <v-dialog
    :model-value="modelValue"
    :max-width="maxWidth"
    persistent
    @update:model-value="onUpdate"
  >
    <v-card>
      <v-card-title>
        {{ title }}
      </v-card-title>
      <v-card-text class="text-body-2">
        {{ content }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="cancel"
        >
          {{ cancelText }}
        </v-btn>
        <v-btn
          :color="confirmColor"
          @click="confirm"
        >
          {{ confirmText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * 确认对话框 UI 组件。
 * 通常由 utils/confirm 动态挂载，也可在模板中直接使用。
 */
withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  content?: string
  confirmText?: string
  cancelText?: string
  confirmColor?: string
  maxWidth?: number | string
}>(), {
  title: '确认',
  content: '',
  confirmText: '确定',
  cancelText: '取消',
  confirmColor: 'primary',
  maxWidth: 420,
})

const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: []
  cancel: []
}>()

/**
 * 对话框开关变化（如 Esc）；关闭时视为取消。
 * @param open 是否打开
 */
function onUpdate(open: boolean) {
  emit('update:modelValue', open)
  if (!open) emit('cancel')
}

/** 取消 */
function cancel() {
  emit('update:modelValue', false)
  emit('cancel')
}

/** 确认 */
function confirm() {
  emit('confirm')
}
</script>
