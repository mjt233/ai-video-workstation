<template>
  <div class="video-generate-editor">
    <div class="text-caption text-medium-emphasis">
      生成视频节点配置（待完善）
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'

/** 生成视频节点编辑器（占位；Task 13 完善工作流/模式/导演台配置） */
defineProps<{
  project: string
  node: CanvasNodeData
  inputs: CanvasInputInfo[]
  isRunning: boolean
  kind: CanvasKind
}>()
</script>
