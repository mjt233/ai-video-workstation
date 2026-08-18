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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'
import ImageNodeActions from './ImageNodeActions.vue'

/** 获取视频帧节点 body：当前提取帧图片预览 + 未提取占位（loading/错误遮罩由 CanvasNodeCard 统一渲染） */
const props = defineProps<{
  project: string
  node: CanvasNodeData
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
}>()

const imageUrl = ref('')
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
    imageUrl.value = p ? buildPreviewUrl(props.project, p, token) : ''
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

</style>