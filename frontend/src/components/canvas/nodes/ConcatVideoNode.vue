<template>
  <div class="concat-video-node">
    <template v-if="videoUrl">
      <video
        :src="videoUrl"
        muted
        class="concat-video-node__video"
      />
    </template>
    <template v-else>
      <div class="concat-video-node__empty">
        <v-icon
          icon="mdi-video-switch-outline"
          size="large"
        />
        <div class="text-body-small text-medium-emphasis">
          未拼接
        </div>
      </div>
    </template>

    <!-- 拼接中遮罩 -->
    <div
      v-if="status?.status === 'running'"
      class="concat-video-node__mask"
    >
      <v-progress-circular
        indeterminate
        size="28"
        color="primary"
      />
    </div>
    <div
      v-else-if="status?.status === 'error'"
      class="concat-video-node__mask concat-video-node__mask--error"
    >
      <v-icon
        icon="mdi-alert-circle-outline"
        color="error"
        size="28"
      />
      <div class="error-text">
        {{ status.errorMsg || '拼接失败' }}
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

/** 拼接视频节点 body：当前输出视频预览 + 未拼接占位（状态遮罩由 AssetCanvas 统一渲染） */
const props = defineProps<{
  project: string
  node: CanvasNodeData
  status?: GenerateStatus | null
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
}>()

defineEmits<{
  (e: 'retry', nodeId: string): void
}>()

const videoUrl = ref('')
const currentPath = computed(() => {
  const out = props.output
  if (out?.path) return out.path
  const cur = props.node.config.current as { path?: string } | undefined
  return cur?.path ?? ''
})
/** 防缓存 token（产物 mtime；与 path 一起变化时需刷新预览，否则固定路径覆盖后浏览器命中旧缓存） */
const currentToken = computed(
  () => props.output?.token ?? (props.node.config.current as { version?: number } | undefined)?.version,
)

watch(
  [currentPath, currentToken],
  ([p, token]) => {
    videoUrl.value = p ? buildPreviewUrl(props.project, p, token) : ''
  },
  { immediate: true },
)
</script>

<style scoped>
.concat-video-node {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

.concat-video-node__video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.concat-video-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.concat-video-node__mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.85);
  z-index: 2;
}

.concat-video-node__mask--error {
  background: rgba(255, 255, 255, 0.92);
}

.error-text {
  max-width: 90%;
  text-align: center;
  word-break: break-all;
}
</style>
