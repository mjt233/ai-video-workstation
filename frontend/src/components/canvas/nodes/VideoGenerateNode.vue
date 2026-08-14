<template>
  <div class="video-generate-node">
    <template v-if="videoUrl">
      <video
        :src="videoUrl"
        controls
        class="video-generate-node__video"
      />
    </template>
    <template v-else>
      <div class="video-generate-node__empty">
        <v-icon
          icon="mdi-video-plus"
          size="large"
        />
        <div class="text-body-small text-medium-emphasis">
          未生成视频
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'

/** 生成视频节点 body：视频预览 + 未生成占位（状态角标由 AssetCanvas 统一渲染） */
const props = defineProps<{
  project: string
  node: CanvasNodeData
}>()

const videoUrl = ref('')
const current = computed(() => props.node.config.current as { path?: string } | undefined)

watch(
  current,
  (c) => {
    videoUrl.value = c?.path ? buildPreviewUrl(props.project, c.path) : ''
  },
  { immediate: true },
)
</script>

<style scoped>
.video-generate-node {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

.video-generate-node__video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.video-generate-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
}
</style>
