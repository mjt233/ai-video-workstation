<template>
  <div class="tts-generate-node">
    <template v-if="audioUrl">
      <audio
        :src="audioUrl"
        controls
        class="tts-generate-node__audio"
      />
    </template>
    <template v-else>
      <div class="tts-generate-node__empty">
        <v-icon
          icon="mdi-voice"
          size="large"
        />
        <div class="text-body-small text-medium-emphasis">
          未生成音频
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'

/** TTS 声音生成节点 body：音频预览 + 未生成占位（状态角标由 AssetCanvas 统一渲染） */
const props = defineProps<{
  project: string
  node: CanvasNodeData
}>()

const audioUrl = ref('')
const current = computed(() => props.node.config.current as { path?: string } | undefined)

watch(
  current,
  (c) => {
    audioUrl.value = c?.path ? buildPreviewUrl(props.project, c.path) : ''
  },
  { immediate: true },
)
</script>

<style scoped>
.tts-generate-node__audio {
  width: 100%;
  max-height: 200px;
}

.tts-generate-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
}
</style>
