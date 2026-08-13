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

    <!-- 生成中遮罩 -->
    <div
      v-if="status?.status === 'running'"
      class="tts-generate-node__mask"
    >
      <v-progress-circular
        indeterminate
        size="28"
        color="primary"
      />
      <div
        v-if="status.lastLog"
        class="text-body-small log-text"
      >
        {{ status.lastLog }}
      </div>
    </div>
    <div
      v-else-if="status?.status === 'error'"
      class="tts-generate-node__mask tts-generate-node__mask--error"
    >
      <v-icon
        icon="mdi-alert-circle-outline"
        color="error"
        size="28"
      />
      <div class="text-body-small error-text">
        {{ status.errorMsg || '生成失败' }}
      </div>
      <v-btn
        size="x-small"
        variant="tonal"
        color="error"
        @click.stop="$emit('retry', node.id)"
      >
        重试
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'
import type { GenerateStatus } from '../../../canvas/useCanvasGeneration'

/** TTS 声音生成节点 body：音频预览 + 未生成占位 + 运行/错误遮罩 */
const props = defineProps<{
  project: string
  node: CanvasNodeData
  status?: GenerateStatus | null
}>()

defineEmits<{
  (e: 'retry', nodeId: string): void
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
.tts-generate-node {
  position: relative;
  width: 100%;
  height: 100%;
}

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

.tts-generate-node__mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.85);
  z-index: 1;
  border-radius: 4px;
}

.tts-generate-node__mask--error {
  background: rgba(255, 235, 238, 0.92);
}

.log-text,
.error-text {
  max-width: 90%;
  text-align: center;
}
</style>
