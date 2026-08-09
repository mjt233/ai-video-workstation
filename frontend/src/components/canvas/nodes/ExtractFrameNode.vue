<template>
  <div class="extract-frame-node">
    <template v-if="imageUrl">
      <v-img
        :src="imageUrl"
        contain
        width="100%"
        height="100%"
        @error="imageUrl = ''"
      />
      <!-- 悬浮操作：放大查看 / 下载图片 -->
      <ImageNodeActions
        :image-url="imageUrl"
        :asset-path="currentPath"
      />
    </template>
    <template v-else>
      <div class="extract-frame-node__empty">
        <v-icon
          icon="mdi-camera-outline"
          size="large"
        />
        <div class="text-body-small text-medium-emphasis">
          未提取
        </div>
      </div>
    </template>

    <!-- 提取中遮罩 -->
    <div
      v-if="status?.status === 'running'"
      class="extract-frame-node__mask"
    >
      <v-progress-circular
        indeterminate
        size="28"
        color="primary"
      />
    </div>
    <div
      v-else-if="status?.status === 'error'"
      class="extract-frame-node__mask extract-frame-node__mask--error"
    >
      <v-icon
        icon="mdi-alert-circle-outline"
        color="error"
        size="28"
      />
      <div class="text-body-small error-text">
        {{ status.errorMsg || '提取失败' }}
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
import ImageNodeActions from './ImageNodeActions.vue'

/** 获取视频帧节点 body：当前提取帧图片预览 + 未提取占位（状态遮罩由 AssetCanvas 统一渲染） */
const props = defineProps<{
  project: string
  node: CanvasNodeData
  status?: GenerateStatus | null
}>()

defineEmits<{
  (e: 'retry', nodeId: string): void
}>()

const imageUrl = ref('')
const currentPath = computed(() => {
  const cur = props.node.config.current as { path?: string } | undefined
  return cur?.path ?? ''
})

watch(
  currentPath,
  (p) => {
    imageUrl.value = p ? buildPreviewUrl(props.project, p, (props.node.config.current as { version?: number } | undefined)?.version) : ''
  },
  { immediate: true },
)
</script>

<style scoped>
.extract-frame-node {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

.extract-frame-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

/* 鼠标悬浮节点时显示右上角操作按钮 */
.extract-frame-node:hover .image-node-actions {
  opacity: 1;
  pointer-events: auto;
}

.extract-frame-node__mask {
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

.extract-frame-node__mask--error {
  background: rgba(255, 255, 255, 0.92);
}

.error-text {
  max-width: 90%;
  text-align: center;
  word-break: break-all;
}
</style>
