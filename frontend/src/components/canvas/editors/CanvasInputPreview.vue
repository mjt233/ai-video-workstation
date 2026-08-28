<template>
  <div class="canvas-input-preview">
    <!-- 图片组：存在图片输入时渲染（无输入不显示条目） -->
    <VideoRefInputGroup
      v-if="imagesInputs.length"
      :title="imagesTitle"
      :prefix="imagesPrefix"
      :inputs="imagesInputs"
      :max="imagesMax"
      :header-hint="dragHint"
      @reorder="(ids) => emit('reorder', ids)"
      @remove="(input) => emit('remove', input)"
    >
      <template #thumb="{ input }">
        <img
          class="canvas-input-item__thumb"
          :src="imageUrls[input.nodeId]"
          :alt="input.label"
          draggable="false"
        >
      </template>
      <template #zoom="{ input }">
        <img
          class="canvas-input-zoom"
          :src="imageUrls[input.nodeId]"
          :alt="input.label"
        >
      </template>
    </VideoRefInputGroup>

    <!-- 视频组：存在视频输入时渲染（无输入不显示条目） -->
    <VideoRefInputGroup
      v-if="videosInputs.length"
      :title="videosTitle"
      :prefix="videosPrefix"
      :inputs="videosInputs"
      :max="videosMax"
      @reorder="(ids) => emit('reorder', ids)"
      @remove="(input) => emit('remove', input)"
    >
      <template #thumb="{ input }">
        <video
          class="canvas-input-item__thumb"
          :src="videoUrls[input.nodeId]"
          muted
          draggable="false"
        />
      </template>
      <template #zoom="{ input }">
        <video
          class="canvas-input-zoom"
          :src="videoUrls[input.nodeId]"
          controls
          muted
        />
      </template>
    </VideoRefInputGroup>

    <!-- 音频组：存在音频输入时渲染（无输入不显示条目） -->
    <VideoRefInputGroup
      v-if="audiosInputs.length"
      :title="audiosTitle"
      :prefix="audiosPrefix"
      :inputs="audiosInputs"
      :max="audiosMax"
      @reorder="(ids) => emit('reorder', ids)"
      @remove="(input) => emit('remove', input)"
    >
      <template #thumb>
        <div class="canvas-input-item__audio">
          <v-icon icon="mdi-music-note" />
        </div>
      </template>
      <template #zoom="{ input }">
        <audio
          class="canvas-input-zoom"
          :src="audioUrls[input.nodeId]"
          controls
        />
      </template>
    </VideoRefInputGroup>

    <!-- 全部类型均无输入时的占位提示（各编排编辑器自定义文案） -->
    <div
      v-if="totalCount === 0"
      class="text-body-small text-grey mb-2"
    >
      {{ emptyText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { buildPreviewUrl } from '../../../canvas/preview'
import VideoRefInputGroup from './VideoRefInputGroup.vue'

/**
 * 生成节点统一输入预览组件：按类型（图片/视频/音频）分组展示连接到的输入资源，
 * 每组仅在该类型存在输入时渲染（无对应输入不显示条目），全部为空时显示占位提示。
 *
 * 交互能力（内部复用 VideoRefInputGroup）：
 * - 组内拖拽排序：reorder 事件上报本组重排后的 nodeId 顺序，由编排编辑器合并回
 *   全局 config.inputOrder（mergeInputOrder 语义：只影响本组相对顺序）；
 * - 悬浮放大：图片（大图）/ 视频（可播放）/ 音频（可播放）tooltip 预览；
 * - 悬浮快速断开：缩略图右上角红色 x，remove 事件上抛，由编排编辑器转发
 *   disconnect-input 断开该来源节点连线。
 *
 * 各类型缩略图与放大内容的预览 URL 以源资产 mtime（CanvasInputInfo.version）作
 * 缓存键，避免无关重渲染导致媒体反复重新加载（与各编辑器既有实现保持一致）。
 */
const props = withDefaults(
  defineProps<{
    /** 项目名（构建预览 URL） */
    project: string
    /** 图片类型输入（已按顺序排列；空数组 = 不显示图片组） */
    imagesInputs?: CanvasInputInfo[]
    /** 视频类型输入（已按顺序排列；空数组 = 不显示视频组） */
    videosInputs?: CanvasInputInfo[]
    /** 音频类型输入（已按顺序排列；空数组 = 不显示音频组） */
    audiosInputs?: CanvasInputInfo[]
    /** 图片组标题（如「图片」「输入图」「帧图片」） */
    imagesTitle?: string
    /** 图片组显示名前缀（如「图」「图像」「帧」） */
    imagesPrefix?: string
    /** 视频组标题 */
    videosTitle?: string
    /** 视频组显示名前缀 */
    videosPrefix?: string
    /** 音频组标题 */
    audiosTitle?: string
    /** 音频组显示名前缀 */
    audiosPrefix?: string
    /** 图片组数量上限（能力声明；未传不显示上限） */
    imagesMax?: number
    /** 视频组数量上限（能力声明；未传不显示上限） */
    videosMax?: number
    /** 音频组数量上限（能力声明；未传不显示上限） */
    audiosMax?: number
    /** 全部类型均无输入时显示的占位文案 */
    emptyText?: string
    /** 图片组标题右侧的灰色提示（如「拖拽调整顺序」；未传不显示） */
    dragHint?: string
  }>(),
  {
    imagesInputs: () => [],
    videosInputs: () => [],
    audiosInputs: () => [],
    imagesTitle: '图片',
    imagesPrefix: '图',
    videosTitle: '视频',
    videosPrefix: '视',
    audiosTitle: '音频',
    audiosPrefix: '音',
    emptyText: '暂无输入',
    imagesMax: undefined,
    videosMax: undefined,
    audiosMax: undefined,
    dragHint: undefined,
  },
)

/**
 * 组件事件：
 * - reorder：组内拖拽排序完成，参数为该组重排后的 nodeId 顺序
 * - remove：点击输入项右上角红色 x，请求断开该输入连接（参数为该输入项）
 */
const emit = defineEmits<{
  (e: 'reorder', nodeIds: string[]): void
  (e: 'remove', input: CanvasInputInfo): void
}>()

/** 全部类型输入总数（用于判定是否显示占位提示） */
const totalCount = computed(
  () => props.imagesInputs.length + props.videosInputs.length + props.audiosInputs.length,
)

/** 图片预览 URL（nodeId → URL；输入或项目变化时重建） */
const imageUrls = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.imagesInputs) m[inp.nodeId] = buildPreviewUrl(props.project, inp.path, inp.version)
  return m
})

/** 视频预览 URL（nodeId → URL；输入或项目变化时重建） */
const videoUrls = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.videosInputs) m[inp.nodeId] = buildPreviewUrl(props.project, inp.path, inp.version)
  return m
})

/** 音频预览 URL（nodeId → URL；输入或项目变化时重建） */
const audioUrls = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.audiosInputs) m[inp.nodeId] = buildPreviewUrl(props.project, inp.path, inp.version)
  return m
})
</script>

<style scoped>
/* 图片/视频缩略图（尺寸与既有编辑器实现一致） */
.canvas-input-item__thumb {
  width: 64px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(0, 0, 0, 0.04);
}

/* 音频缩略占位：图标（悬浮时由 tooltip 提供 audio 播放器） */
.canvas-input-item__audio {
  width: 64px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(0, 0, 0, 0.04);
}

/* 悬浮放大内容（图片/视频/音频通用约束） */
.canvas-input-zoom {
  max-width: 320px;
  max-height: 240px;
}
</style>