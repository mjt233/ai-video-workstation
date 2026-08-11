<template>
  <div class="concat-video-editor">
    <div class="text-body-small text-medium-emphasis mb-1">
      拼接顺序（拖拽调整）：按顺序首尾相连
    </div>

    <!-- 视频输入分组：组内拖拽排序写 config.inputOrder -->
    <VideoRefInputGroup
      title="视频"
      prefix="视"
      :inputs="videosInputs"
      @reorder="(ids) => emit('update:config', { inputOrder: mergeInputOrder(ids) })"
    >
      <template #thumb="{ input }">
        <video
          class="canvas-input-item__thumb"
          :src="previewUrls[input.nodeId]"
          muted
          draggable="false"
        />
      </template>
      <template #zoom="{ input }">
        <video
          class="canvas-input-zoom"
          :src="previewUrls[input.nodeId]"
          controls
          muted
        />
      </template>
    </VideoRefInputGroup>

    <!-- 拼接 / 重新拼接 -->
    <div class="d-flex align-center ga-2">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
        :disabled="videosInputs.length < 2"
        @click="emit('generate', node.id)"
      >
        {{ node.config.current ? '重新拼接' : '拼接' }}
      </v-btn>
      <span class="text-body-small text-grey">
        至少连接 2 段视频；各段分辨率/帧率须一致
      </span>
    </div>

    <!-- 当前结果 -->
    <div
      v-if="currentVideo"
      class="mt-3"
    >
      <div class="text-body-small text-medium-emphasis mb-1">
        当前结果
      </div>
      <video
        :src="currentVideo"
        controls
        muted
        class="concat-video-editor__result"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { mergeInputOrder as mergeGlobalInputOrder } from '../../../canvas/generate'
import { buildPreviewUrl } from '../../../canvas/preview'
import VideoRefInputGroup from './VideoRefInputGroup.vue'

/**
 * 拼接视频节点配置组件。
 *
 * 展示全部视频输入（VideoRefInputGroup，组内拖拽排序写 config.inputOrder，
 * 顺序即 ffmpeg 拼接顺序），提供「拼接/重新拼接」按钮（复用父级 @generate 事件，
 * 由 AssetCanvas 按节点原型路由到服务端 concat-video 接口）；下方预览当前输出视频。
 */
const props = defineProps<{
  /** 项目名（用于资产预览 URL） */
  project: string
  /** 当前节点数据（config 为持久化配置） */
  node: CanvasNodeData
  /** 全部输入（编辑器统一传入，本组件未直接使用） */
  inputs: CanvasInputInfo[]
  /** 视频端口输入，已按 config.inputOrder 排序 */
  videosInputs: CanvasInputInfo[]
  /** 节点是否正在拼接（显示加载态并禁用按钮） */
  isRunning: boolean
}>()

/**
 * 组件事件：
 * - update:config：配置补丁（直接写回节点 config）
 * - generate：触发拼接（参数为节点 id；复用父级 @generate，由 generateNode 按原型路由）
 */
const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
}>()

/** 全部视频输入的预览 URL（nodeId → URL；输入或项目变化时重建） */
const previewUrls = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.videosInputs) m[inp.nodeId] = buildPreviewUrl(props.project, inp.path)
  return m
})

/** 当前输出视频预览 URL（config.current.path，带版本号防缓存） */
const currentVideo = computed(() => {
  const cur = props.node.config.current as { path?: string; version?: number } | undefined
  return cur?.path ? buildPreviewUrl(props.project, cur.path, cur.version) : ''
})

/**
 * 组内重排后合并回全局 inputOrder（共享纯函数 generate.mergeInputOrder）。
 *
 * @param orderedIds 本组重排后的 nodeId 顺序
 * @returns 新的全局 inputOrder
 */
function mergeInputOrder(orderedIds: string[]): string[] {
  const inputOrder = Array.isArray(props.node.config.inputOrder) ? (props.node.config.inputOrder as string[]) : []
  return mergeGlobalInputOrder(inputOrder, orderedIds)
}
</script>

<style scoped>
/* 视频缩略样式（供 VideoRefInputGroup 插槽内容使用；插槽内容带本组件 scope） */
.canvas-input-item__thumb {
  width: 64px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(0, 0, 0, 0.04);
}

.canvas-input-zoom {
  max-width: 320px;
  max-height: 240px;
}

.concat-video-editor__result {
  width: 100%;
  max-height: 180px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.04);
}
</style>
