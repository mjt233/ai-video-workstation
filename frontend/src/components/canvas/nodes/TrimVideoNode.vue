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

    <!-- 裁剪中遮罩 -->
    <div
      v-if="status?.status === 'running'"
      class="trim-video-node__mask"
    >
      <v-progress-circular
        indeterminate
        size="28"
        color="primary"
      />
    </div>
    <div
      v-else-if="status?.status === 'error'"
      class="trim-video-node__mask trim-video-node__mask--error"
    >
      <v-icon
        icon="mdi-alert-circle-outline"
        color="error"
        size="28"
      />
      <div class="error-text">
        {{ status.errorMsg || '裁剪失败' }}
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

/**
 * 裁剪视频节点 body：当前输出视频预览 + 未裁剪占位（状态遮罩由 AssetCanvas 统一渲染）。
 *
 * 产物无历史版本，预览 URL 带 current.version 防缓存（覆盖同一 output.mp4）。
 */
const props = defineProps<{
  /** 项目名（构建预览 URL） */
  project: string
  /** 当前节点数据 */
  node: CanvasNodeData
  /** 裁剪运行状态（running / error 时显示遮罩） */
  status?: GenerateStatus | null
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
}>()

defineEmits<{
  /** 失败后重试（参数为节点 id） */
  (e: 'retry', nodeId: string): void
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

.trim-video-node__mask {
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

.trim-video-node__mask--error {
  background: rgba(255, 255, 255, 0.92);
}

.error-text {
  max-width: 90%;
  text-align: center;
  word-break: break-all;
}
</style>
