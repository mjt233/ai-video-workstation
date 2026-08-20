<template>
  <div class="video-loader-editor">
    <!-- 当前视频预览 -->
    <div class="text-body-small text-medium-emphasis mb-1">
      当前视频
    </div>
    <div class="video-loader-editor__preview mb-2">
      <video
        v-if="assetUrl"
        :src="assetUrl"
        controls
        class="video-loader-editor__video"
      />
      <div
        v-else
        class="video-loader-editor__empty"
      >
        <v-icon
          icon="mdi-video-outline"
          size="large"
        />
        <span class="text-body-small text-grey">
          未选择视频
        </span>
      </div>
    </div>

    <!-- 操作：上传 / 选择资产 -->
    <div class="d-flex align-center ga-2">
      <v-btn
        size="small"
        color="primary"
        variant="tonal"
        prepend-icon="mdi-upload"
        @click="openUpload"
      >
        上传视频
      </v-btn>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-folder-video"
        @click="openPicker"
      >
        选择资产
      </v-btn>
      <v-spacer />
      <v-btn
        v-if="kind === 'scene' && !!assetPath"
        size="small"
        variant="tonal"
        color="primary"
        @click="emit('set-as-video', node.id)"
      >
        设为分镜视频
      </v-btn>
    </div>

    <!-- 当前资产路径提示 -->
    <div
      v-if="assetPath"
      class="text-body-small text-grey mt-1 video-loader-editor__path"
      :title="assetPath"
    >
      {{ assetPath }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'
import { buildLoaderUploadDest } from '../../../canvas/clipboard'
import type { CanvasUploadFilePayload } from '../composables/useCanvasUpload'

/** 加载视频节点编辑器：上传视频 / 选择资产以加载其他视频 */
const props = defineProps<{
  project: string
  node: CanvasNodeData
  /** 画布类型：仅分镜画布（scene）显示「设为分镜视频」 */
  kind: CanvasKind
  /** 预留（加载类编辑器不使用；父级统一下发，避免非 prop 属性透传） */
  output?: { path: string; token?: number } | null
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'open-picker', nodeId: string): void
  (e: 'set-as-video', nodeId: string): void
  (e: 'upload-file', payload: CanvasUploadFilePayload): void
}>()

const assetUrl = ref('')

/** 当前资产路径（config.assetPath） */
const assetPath = computed(() => (typeof props.node.config.assetPath === 'string' ? props.node.config.assetPath : ''))

watch(
  assetPath,
  (p) => {
    assetUrl.value = p ? buildPreviewUrl(props.project, p) : ''
  },
  { immediate: true },
)

/** 打开系统文件选择并交给父级上传（上传进度显示在节点卡片遮罩上），成功后写入 assetPath */
function openUpload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'video/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    emit('upload-file', { nodeId: props.node.id, file, dest: buildLoaderUploadDest(file) })
  }
  input.click()
}

/** 打开资产选择器（由 AssetCanvas 统一提供） */
function openPicker() {
  emit('open-picker', props.node.id)
}
</script>

<style scoped>
.video-loader-editor__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  border: 1px dashed rgba(0, 0, 0, 0.16);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.03);
}

.video-loader-editor__video {
  width: 100%;
  max-height: 180px;
}

.video-loader-editor__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
}

.video-loader-editor__path {
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
