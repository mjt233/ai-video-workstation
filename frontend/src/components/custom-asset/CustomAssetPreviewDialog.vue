<template>
  <v-dialog
    :model-value="modelValue"
    :max-width="kind === 'text' ? 900 : 1000"
    max-height="85vh"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          class="mr-2"
          color="primary"
        >
          {{ kindIcon }}
        </v-icon>
        <span class="text-truncate">{{ fileName }}</span>
        <v-spacer />
        <v-btn
          v-if="url"
          :href="url"
          download
          icon="mdi-download"
          size="small"
          variant="text"
          title="下载"
        />
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-divider />
      <v-card-text
        class="pa-0 preview-body"
        :class="`preview-body--${kind}`"
      >
        <div
          v-if="loading"
          class="d-flex align-center justify-center pa-8"
        >
          <v-progress-circular
            indeterminate
            color="primary"
          />
        </div>

        <template v-else>
          <!-- 图片预览 -->
          <img
            v-if="kind === 'image'"
            :src="url"
            :alt="fileName"
            class="preview-image"
          >

          <!-- 视频预览 -->
          <video
            v-else-if="kind === 'video'"
            :src="url"
            class="preview-video"
            controls
            autoplay
            preload="metadata"
          />

          <!-- 音频预览 -->
          <div
            v-else-if="kind === 'audio'"
            class="preview-audio-wrap"
          >
            <v-icon
              icon="mdi-music-circle"
              size="72"
              color="deep-purple-darken-1"
              class="mb-4"
            />
            <div class="text-body-large mb-4 text-center">
              {{ fileName }}
            </div>
            <audio
              :src="url"
              class="preview-audio"
              controls
              autoplay
              preload="metadata"
            />
          </div>

          <!-- 文本预览 -->
          <pre
            v-else-if="kind === 'text'"
            class="pa-4 text-body-medium preview-text"
          >{{ textContent }}</pre>

          <div
            v-else
            class="d-flex align-center justify-center pa-8 text-grey"
          >
            无法预览此文件类型
          </div>
        </template>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  previewKindIcon,
  type PreviewKind,
} from '../../utils/customAssetFile'

/**
 * 自定义资产预览对话框。
 * 按类型渲染图片 / 视频 / 音频 / 文本预览。
 */
const props = defineProps<{
  /** 是否显示 */
  modelValue: boolean
  /** 文件名 */
  fileName: string
  /** 预览类型 */
  kind: PreviewKind
  /** 资源 URL */
  url: string
  /** 文本内容（仅 text 类型） */
  textContent: string | null
  /** 是否加载中 */
  loading: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

/** 标题图标 */
const kindIcon = computed(() => previewKindIcon(props.kind))
</script>

<style scoped>
.preview-body {
  min-height: 200px;
  max-height: 70vh;
  overflow-y: auto;
}

.preview-body--image,
.preview-body--video {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #111;
}

.preview-image {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  display: block;
}

.preview-video {
  width: 100%;
  max-height: 70vh;
  background: #000;
  display: block;
}

.preview-audio-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  min-height: 240px;
}

.preview-audio {
  width: min(100%, 480px);
}

.preview-text {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
</style>
