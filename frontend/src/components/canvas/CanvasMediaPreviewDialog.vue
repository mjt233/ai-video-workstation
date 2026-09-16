<template>
  <v-dialog
    :model-value="modelValue"
    max-width="90vw"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          :icon="kind === 'video' ? 'mdi-video-outline' : 'mdi-image-outline'"
          size="small"
          color="primary"
          class="mr-2"
        />
        <span class="text-truncate">{{ title || fileName }}</span>
        <v-spacer />
        <v-btn
          icon="mdi-download"
          size="small"
          variant="text"
          title="下载"
          @click="download"
        />
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          aria-label="关闭"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-divider />
      <v-card-text class="media-preview__body">
        <img
          v-if="kind === 'image'"
          :src="url"
          :alt="title || fileName"
          class="media-preview__img"
        >
        <video
          v-else
          :src="url"
          class="media-preview__video"
          controls
          autoplay
        />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * 产物放大预览对话框（图片 / 视频）。
 *
 * 供两处共用，避免重复实现：
 * - 右下角工作流完成通知气泡（点缩略图放大预览生成产物）；
 * - 任务管理器（抽屉）「历史」页签行内产物缩略图。
 *
 * 音频产物不在此处预览（气泡内联播放即可）。
 */
const props = defineProps<{
  /** 对话框可见性（v-model） */
  modelValue: boolean
  /** 产物预览 URL（`/api/fs/...` 带缓存键） */
  url: string
  /** 媒体类型（图片 / 视频） */
  kind: 'image' | 'video'
  /** 标题（空则回退文件名） */
  title?: string
  /** 文件名（下载用；空则回退「产物」） */
  fileName?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

/** 下载产物：同源地址可直接用 `<a download>` 指定下载文件名 */
function download(): void {
  const a = document.createElement('a')
  a.href = props.url
  a.download = props.fileName || '产物'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
</script>

<style scoped>
.media-preview__body {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #111;
  min-height: 240px;
}

.media-preview__img,
.media-preview__video {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  display: block;
}
</style>
