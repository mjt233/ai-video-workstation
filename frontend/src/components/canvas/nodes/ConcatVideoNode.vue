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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'

/** 拼接视频节点 body：当前输出视频预览 + 未拼接占位（loading/错误遮罩由 CanvasNodeCard 统一渲染） */
const props = defineProps<{
  project: string
  node: CanvasNodeData
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
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

</style>