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

/** TTS 声音生成节点 body：音频预览 + 未生成占位（loading/错误遮罩由 CanvasNodeCard 统一渲染） */
const props = defineProps<{
  project: string
  node: CanvasNodeData
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
}>()

const audioUrl = ref('')
const current = computed(() => {
  const out = props.output
  if (out?.path) return { path: out.path, version: out.token }
  return props.node.config.current as { path?: string; version?: number } | undefined
})

watch(
  current,
  (c) => {
    audioUrl.value = c?.path ? buildPreviewUrl(props.project, c.path, c.version) : ''
  },
  { immediate: true },
)
</script>

<style scoped>
.tts-generate-node {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

.tts-generate-node__audio {
  width: 100%;
  height: 48px;
}

.tts-generate-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
}

</style>