<template>
  <div class="audio-loader-node">
    <template v-if="assetUrl">
      <audio
        :src="assetUrl"
        controls
        class="audio-loader-node__audio"
      />
    </template>
    <template v-else>
      <div class="audio-loader-node__empty">
        <v-icon
          icon="mdi-music-note"
          size="large"
        />
        <div class="text-body-small text-medium-emphasis">
          未选择音频
        </div>
        <div class="d-flex ga-1 mt-1">
          <v-btn
            size="x-small"
            variant="tonal"
            color="primary"
            @click.stop="openUpload"
          >
            上传音频
          </v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            @click.stop="openPicker"
          >
            选择资产
          </v-btn>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'
import { buildLoaderUploadDest } from '../../../canvas/clipboard'
import type { CanvasUploadFilePayload } from '../composables/useCanvasUpload'

/** 加载音频节点 body：播放音频或提示未选择 */
const props = defineProps<{
  project: string
  node: CanvasNodeData
  /** 预留（加载类节点不使用；父级统一下发，避免非 prop 属性透传） */
  output?: { path: string; token?: number } | null
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'open-picker', nodeId: string): void
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
  input.accept = 'audio/*'
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
.audio-loader-node {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

.audio-loader-node__audio {
  width: 100%;
  height: 48px;
}

.audio-loader-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
}
</style>
