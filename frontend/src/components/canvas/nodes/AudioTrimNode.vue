<template>
  <div class="audio-trim-node">
    <template v-if="audioUrl">
      <audio
        :src="audioUrl"
        controls
        class="audio-trim-node__audio"
      />
    </template>
    <template v-else>
      <div class="audio-trim-node__empty">
        <v-icon
          icon="mdi-scissors-cutting"
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
 * 裁剪音频节点 body：当前输出音频预览 + 未裁剪占位。
 * loading/错误遮罩由 CanvasNodeCard 统一渲染，本组件不做状态展示。
 */
const props = defineProps<{
  /** 项目名（构建预览 URL） */
  project: string
  /** 当前节点数据 */
  node: CanvasNodeData
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
}>()

/** 当前输出音频预览 URL */
const audioUrl = ref('')

/** 当前产物相对路径（优先 AssetCanvas 下发的固定路径产物，回落到 config.current 旧数据） */
const currentPath = computed(() => {
  const out = props.output
  if (out?.path) return out.path
  const cur = props.node.config.current as { path?: string } | undefined
  return cur?.path ?? ''
})

/** 防缓存 token（产物 mtime；固定路径覆盖后需刷新，否则浏览器命中旧缓存） */
const currentToken = computed(
  () => props.output?.token ?? (props.node.config.current as { version?: number } | undefined)?.version,
)

watch(
  [currentPath, currentToken],
  ([p, token]) => {
    audioUrl.value = p ? buildPreviewUrl(props.project, p, token) : ''
  },
  { immediate: true },
)
</script>

<style scoped>
.audio-trim-node {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

.audio-trim-node__audio {
  width: 100%;
  height: 48px;
}

.audio-trim-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
</style>
