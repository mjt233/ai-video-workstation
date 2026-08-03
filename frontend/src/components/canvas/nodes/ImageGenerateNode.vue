<template>
  <div class="image-generate-node">
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
      <div class="image-generate-node__empty">
        <v-icon
          icon="mdi-image-plus"
          size="large"
        />
        <div class="text-caption text-medium-emphasis">
          尚未生成
        </div>
      </div>
    </template>

    <!-- 上游更新角标 -->
    <v-badge
      v-if="upstreamUpdated"
      color="warning"
      content="上游已更新"
      location="top start"
      offset-x="6"
      offset-y="6"
    />

    <!-- 生成中遮罩 -->
    <div
      v-if="status?.status === 'running'"
      class="image-generate-node__mask"
    >
      <v-progress-circular
        indeterminate
        size="28"
        color="primary"
      />
      <div
        v-if="status.lastLog"
        class="text-caption log-text"
      >
        {{ status.lastLog }}
      </div>
    </div>
    <div
      v-else-if="status?.status === 'error'"
      class="image-generate-node__mask image-generate-node__mask--error"
    >
      <v-icon
        icon="mdi-alert-circle-outline"
        color="error"
        size="28"
      />
      <div class="text-caption error-text">
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
import ImageNodeActions from './ImageNodeActions.vue'

const props = defineProps<{
  project: string
  node: CanvasNodeData
  status?: GenerateStatus | null
  upstreamUpdated?: boolean
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
.image-generate-node {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

.image-generate-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

/* 鼠标悬浮节点时显示右上角操作按钮 */
.image-generate-node:hover .image-node-actions {
  opacity: 1;
  pointer-events: auto;
}

.image-generate-node__mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.85);
  padding: 6px;
}

.image-generate-node__mask--error {
  background: rgba(255, 235, 238, 0.9);
}

.log-text,
.error-text {
  max-width: 90%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
