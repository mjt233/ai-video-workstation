<template>
  <span class="d-inline-flex">
    <input
      ref="inputRef"
      type="file"
      class="d-none"
      accept="audio/flac,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/m4a,audio/aac"
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
      :prepend-icon="icon"
      :loading="uploading"
      :disabled="disabled || uploading"
      :title="label"
      @click="openPicker"
    >
      {{ label }}
    </v-btn>
  </span>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { AssetApiError, uploadAssetAudio } from '../api/assets'

/** 允许上传的音频扩展名（与服务端 upload-audio 白名单一致；保留原格式） */
const AUDIO_EXTS = ['flac', 'mp3', 'wav', 'ogg', 'm4a', 'aac']

const props = withDefaults(defineProps<{
  project: string
  /** 目标音频路径前缀（不含扩展名），如 assert/character/陈书文/voice */
  pathBase: string
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
  label: '上传音频',
  size: 'small',
  variant: 'tonal',
  color: undefined,
  disabled: false,
  iconOnly: false,
  icon: 'mdi-upload',
})

const emit = defineEmits<{
  uploaded: [{ path: string; archived: string[] }]
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

  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : ''
  if (!AUDIO_EXTS.includes(ext)) {
    const msg = '仅支持 FLAC / MP3 / WAV / OGG / M4A / AAC 音频文件'
    emit('error', msg)
    alert(msg)
    return
  }

  uploading.value = true
  try {
    const result = await uploadAssetAudio(props.project, `${props.pathBase}.${ext}`, file)
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
