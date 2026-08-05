<template>
  <div class="video-ref-group">
    <div class="text-caption text-medium-emphasis mb-1">
      {{ title }}（{{ inputs.length }}{{ max != null ? `/${max}` : '' }}）
    </div>
    <div
      v-if="inputs.length"
      ref="listEl"
      class="canvas-input-list mb-2"
      @dragover.prevent="onListDragOver"
      @drop.prevent="onDrop"
    >
      <v-tooltip
        v-for="(input, i) in inputs"
        :key="input.nodeId"
        location="top"
        open-delay="250"
      >
        <template #activator="{ props: tp }">
          <div
            class="canvas-input-item"
            :class="[
              draggingIndex === i ? 'canvas-input-item--dragging' : '',
              dropSide(i) === 'left' ? 'canvas-input-item--insert-left' : '',
              dropSide(i) === 'right' ? 'canvas-input-item--insert-right' : '',
            ]"
            v-bind="tp"
            draggable="true"
            @dragstart="onDragStart($event, i)"
            @dragend="onDragEnd"
          >
            <slot
              name="thumb"
              :input="input"
            />
            <span
              class="canvas-input-item__label"
              :title="input.label"
            >{{ labelOf(i) }}</span>
          </div>
        </template>
        <slot
          name="zoom"
          :input="input"
        />
      </v-tooltip>
    </div>
    <div
      v-else
      class="text-caption text-grey mb-2"
    >
      无{{ title }}输入
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { CanvasInputInfo } from '../../../canvas/generate'

/**
 * 参考模式输入分组：按类型（图片/视频/音频）展示参考素材并支持组内拖拽排序。
 * 缩略图与悬浮放大内容通过插槽（thumb/zoom）由父组件提供，
 * 排序结果通过 reorder 事件（新的 nodeId 顺序数组）上报。
 */
const props = defineProps<{
  /** 组标题（如「图片」） */
  title: string
  /** 该组输入（已按顺序排列） */
  inputs: CanvasInputInfo[]
  /** 该类型数量上限（未声明则不显示上限） */
  max?: number
  /** 显示名前缀（如「图」） */
  prefix: string
}>()

/**
 * 组件事件：
 * - reorder：组内拖拽排序完成，参数为新顺序的 nodeId 数组
 */
const emit = defineEmits<{
  (e: 'reorder', nodeIds: string[]): void
}>()

/** 正在拖拽的输入项下标（null 表示未在拖拽） */
const draggingIndex = ref<number | null>(null)
/** 拖拽插入位置（0..inputs.length，表示插入到该下标之前） */
const dropIndex = ref<number | null>(null)
/** 输入列表容器 DOM（dragover 计算插入位置用） */
const listEl = ref<HTMLElement | null>(null)

/**
 * 显示名：前缀 + 组内序号（如图1、图2）。
 *
 * @param i 组内下标（0 基）
 * @returns 显示名
 */
function labelOf(i: number): string {
  return `${props.prefix}${i + 1}`
}

/**
 * 拖拽开始：记录源下标并初始化插入位置。
 *
 * @param e 拖拽事件
 * @param i 源下标
 */
function onDragStart(e: DragEvent, i: number) {
  draggingIndex.value = i
  dropIndex.value = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
  }
}

/** 拖拽结束（含放下后）：清空拖拽状态 */
function onDragEnd() {
  draggingIndex.value = null
  dropIndex.value = null
}

/**
 * 列表 dragover：按鼠标水平位置计算插入下标（前半插到该项前，后半插到该项后）。
 *
 * @param e 拖拽事件
 */
function onListDragOver(e: DragEvent) {
  if (draggingIndex.value === null) return
  e.preventDefault()
  const items = Array.from(listEl.value?.querySelectorAll('.canvas-input-item') ?? [])
  let idx = items.length
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect()
    if (e.clientX < r.left + r.width / 2) {
      idx = i
      break
    }
  }
  dropIndex.value = idx
}

/**
 * 当前项左右侧的插入高亮（用于显示插入位置）。
 *
 * @param i 下标
 * @returns 插入到该项左侧/右侧，或 null
 */
function dropSide(i: number): 'left' | 'right' | null {
  if (dropIndex.value === null) return null
  if (dropIndex.value === i) return 'left'
  if (dropIndex.value === i + 1) return 'right'
  return null
}

/** 放下：按插入位置重排并上报新的 nodeId 顺序 */
function onDrop() {
  const from = draggingIndex.value
  const to = dropIndex.value
  draggingIndex.value = null
  dropIndex.value = null
  if (from === null || to === null) return
  if (from === to || from === to - 1) return
  const arr = [...props.inputs]
  const [moved] = arr.splice(from, 1)
  const target = to > from ? to - 1 : to
  arr.splice(target, 0, moved)
  emit('reorder', arr.map((x) => x.nodeId))
}
</script>

<style scoped>
/* 输入列表与条目样式（本组件自身渲染的元素；缩略图/放大内容在父组件插槽内由父级样式负责） */
.canvas-input-list {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  padding: 4px;
  min-height: 58px;
  border: 1px dashed rgba(0, 0, 0, 0.16);
  border-radius: 6px;
}

.canvas-input-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 64px;
  cursor: grab;
  user-select: none;
}

.canvas-input-item__label {
  max-width: 64px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.canvas-input-item--dragging {
  opacity: 0.4;
}

.canvas-input-item--insert-left::before,
.canvas-input-item--insert-right::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgb(var(--v-theme-primary));
}

.canvas-input-item--insert-left::before {
  left: -5px;
}

.canvas-input-item--insert-right::before {
  right: -5px;
}
</style>
