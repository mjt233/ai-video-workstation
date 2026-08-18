<template>
  <div class="trim-video-node">
    <template v-if="videoUrl">
      <video
        :src="videoUrl"
        controls
        muted
        class="trim-video-node__video"
      />
    </template>
    <template v-else>
      <div class="trim-video-node__empty">
        <v-icon
          icon="mdi-content-cut"
          size="large"
        />
        <div class="text-body-small text-medium-emphasis">
          未裁剪
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'

/**
 * 裁剪视频节点 body：当前输出视频预览 + 未裁剪占位（loading/错误遮罩由 CanvasNodeCard 统一渲染）。
 *
 * 产物无历史版本，预览 URL 带 current.version 防缓存（覆盖同一 output.mp4）。
 */
const props = defineProps<{
  /** 项目名（构建预览 URL） */
  project: string
  /** 当前节点数据 */
  node: CanvasNodeData
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
}>()

/** 当前输出视频预览 URL */
const videoUrl = ref('')

/** 当前产物相对路径（优先 AssetCanvas 下发的固定路径产物，回落到 config.current 旧数据） */
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
.trim-video-node {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

.trim-video-node__video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.trim-video-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

</style>