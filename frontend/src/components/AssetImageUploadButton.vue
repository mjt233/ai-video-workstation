<template>
  <span class="d-inline-flex">
    <input
      ref="inputRef"
      type="file"
      class="d-none"
      accept="image/jpeg,image/jpg,image/png,image/webp"
      @change="onFileChange"
    >
    <v-btn
      v-if="iconOnly"
      :size="size"
      :variant="variant"
      :color="color"
      :icon="iconOnly ? icon : undefined"
      :prepend-icon="iconOnly ? undefined : icon"
      :loading="uploading"
      :disabled="disabled || uploading"
      :title="label"
      @click="openPicker"
    />
    <v-btn
      v-else
      :size="size"
      :variant="variant"
      :color="color"
      :icon="icon"
      :loading="uploading"
      :disabled="disabled || uploading"
      :title="label"
      @click="openPicker"
    />
  </span>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { AssetApiError, uploadAssetImage } from '../api/assets'

const props = withDefaults(defineProps<{
  project: string
  /** 目标 assert 相对路径，如 assert/character/陈书文/appearance.jpg */
  assetPath: string
  /** 按钮文案；iconOnly 时作为 title 提示 */
  label?: string
  size?: string | number
  variant?: 'flat' | 'text' | 'elevated' | 'outlined' | 'plain' | 'tonal'
  color?: string
  disabled?: boolean
  /** 是否仅显示图标按钮 */
  iconOnly?: boolean
  /** 图标名称 */
  icon?: string
}>(), {
  label: '上传图片',
  size: 'small',
  variant: 'tonal',
  color: undefined,
  disabled: false,
  iconOnly: false,
  icon: 'mdi-upload',
})

const emit = defineEmits<{
  uploaded: [{ path: string; archived: string | null }]
  error: [string]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

function openPicker() {
  if (props.disabled || uploading.value) return
  inputRef.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  if (!file.type.startsWith('image/')) {
    const msg = '请选择图片文件'
    emit('error', msg)
    alert(msg)
    return
  }

  uploading.value = true
  try {
    const result = await uploadAssetImage(props.project, props.assetPath, file)
    emit('uploaded', { path: result.path, archived: result.archived })
  } catch (e) {
    const msg = e instanceof AssetApiError ? e.message : '上传失败'
    emit('error', msg)
    alert(msg)
  } finally {
    uploading.value = false
  }
}
</script>
