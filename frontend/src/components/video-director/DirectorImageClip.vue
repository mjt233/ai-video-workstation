<!--
  DirectorImageClip.vue —— 导演台时间轴图片素材块。

  以绝对定位块渲染单张图片素材：左 = startOffset * pxPerSec，宽 = duration * pxPerSec，
  缩略图使用 object-fit: cover 填满块内区域。支持：
  - 拖拽块主体 → 移动（startOffset 钳制在 [0, trackDuration - duration]，0.1s 步进）
  - 拖拽左/右边缘手柄 → 拉伸占位长度（最小 0.5s）
  - readOnly 时禁用全部拖拽/拉伸交互
  组件不持有任何状态，通过 select / move / resize 事件向上汇报。
-->
<template>
  <div
    class="image-clip"
    :class="{ selected }"
    :style="clipStyle"
    @pointerdown.stop="onBodyPointerDown"
  >
    <!-- 缩略图（无 URL 时显示占位纹理） -->
    <img
      v-if="imageUrl"
      :src="imageUrl"
      class="clip-thumb"
      alt=""
      draggable="false"
    >
    <div
      v-else
      class="clip-thumb clip-thumb-placeholder"
    />

    <!-- 底部文件名标签 -->
    <div class="clip-label">
      {{ clipName }}
    </div>

    <!-- 左/右边缘拉伸手柄（readOnly 时不渲染） -->
    <div
      v-if="!readOnly"
      class="resize-handle resize-left"
      @pointerdown.stop="onResizeStart('left', $event)"
    />
    <div
      v-if="!readOnly"
      class="resize-handle resize-right"
      @pointerdown.stop="onResizeStart('right', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DirectorImageClip } from './types'

/**
 * 图片素材块组件 props。
 */
const props = defineProps<{
  /** 图片素材块数据（startOffset/duration 驱动位置与宽度） */
  clip: DirectorImageClip
  /** 缩略图 URL；为空字符串时显示占位纹理 */
  imageUrl: string
  /** 缩放比例（像素/秒），用于把秒换算为像素 */
  pxPerSec: number
  /** 是否处于选中态（高亮边框） */
  selected: boolean
  /** 只读模式：禁用拖拽与拉伸 */
  readOnly: boolean
  /** 轨道总时长（秒），用于钳制移动范围上限 */
  trackDuration: number
}>()

/** 素材块事件：选中 / 移动 / 拉伸占位长度 */
const emit = defineEmits<{
  select: [id: string]
  move: [id: string, startOffset: number]
  resize: [id: string, duration: number]
}>()

/** 块绝对定位样式：left 由起始偏移换算，宽由占位时长换算 */
const clipStyle = computed(() => ({
  left: `${props.clip.startOffset * props.pxPerSec}px`,
  width: `${props.clip.duration * props.pxPerSec}px`,
}))

/** 文件名（取路径最后一段，用于底部标签） */
const clipName = computed(() => props.clip.path.split('/').pop() || props.clip.path)

/** 按 0.1 秒步进取整 */
function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/** 钳制数值到 [min, max] 区间 */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** 拖拽类型：move 移动 / resize-left 左缘拉伸 / resize-right 右缘拉伸 */
type DragType = 'move' | 'resize-left' | 'resize-right'

/** 拖拽会话状态（非响应式，仅指针交互期间有效） */
let dragging = false
let dragType: DragType = 'move'
let dragStartX = 0
let dragStartOffset = 0
let dragStartDuration = 0

/**
 * 块主体按下：选中并开始移动拖拽。
 *
 * @param e 指针按下事件
 */
function onBodyPointerDown(e: PointerEvent): void {
  if (props.readOnly || e.button !== 0) return
  emit('select', props.clip.id)
  dragging = true
  dragType = 'move'
  dragStartX = e.clientX
  dragStartOffset = props.clip.startOffset
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerEnd)
  document.addEventListener('pointercancel', onPointerEnd)
}

/**
 * 边缘手柄按下：选中并开始拉伸拖拽。
 *
 * 左缘固定右边缘、跟随左边缘；右缘固定左边缘、跟随右边缘。
 *
 * @param side 手柄方位（left 左缘 / right 右缘）
 * @param e 指针按下事件
 */
function onResizeStart(side: 'left' | 'right', e: PointerEvent): void {
  if (props.readOnly || e.button !== 0) return
  emit('select', props.clip.id)
  dragging = true
  dragType = side === 'left' ? 'resize-left' : 'resize-right'
  dragStartX = e.clientX
  dragStartOffset = props.clip.startOffset
  dragStartDuration = props.clip.duration
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerEnd)
  document.addEventListener('pointercancel', onPointerEnd)
}

/**
 * 指针移动：按拖拽类型换算并持续上报新值（0.1s 步进）。
 *
 * @param e 指针移动事件
 */
function onPointerMove(e: PointerEvent): void {
  if (!dragging) return
  const deltaSec = (e.clientX - dragStartX) / props.pxPerSec

  if (dragType === 'move') {
    // 移动：起始偏移钳制在 [0, 轨道时长 - 占位时长]
    const maxOffset = Math.max(0, props.trackDuration - props.clip.duration)
    emit('move', props.clip.id, round1(clamp(dragStartOffset + deltaSec, 0, maxOffset)))
  } else if (dragType === 'resize-right') {
    // 右缘拉伸：左边缘不动，仅改变占位时长（最小 0.5s）
    emit('resize', props.clip.id, Math.max(0.5, round1(dragStartDuration + deltaSec)))
  } else {
    // 左缘拉伸：右边缘保持固定，左边缘跟随指针
    const rightEdge = dragStartOffset + dragStartDuration
    const newStart = round1(clamp(dragStartOffset + deltaSec, 0, rightEdge - 0.5))
    // 先上报 resize（更新时长），再上报 move（起始偏移）：
    // 父级 moveClip 会按“新时长”钳制起始偏移，避免右边缘向左漂移
    emit('resize', props.clip.id, round1(rightEdge - newStart))
    emit('move', props.clip.id, newStart)
  }
}

/**
 * 指针抬起/取消：结束拖拽会话并清理监听。
 */
function onPointerEnd(): void {
  dragging = false
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerup', onPointerEnd)
  document.removeEventListener('pointercancel', onPointerEnd)
}
</script>

<style scoped>
.image-clip {
  position: absolute;
  top: 3px;
  height: calc(100% - 6px);
  background: #eef2f6;
  border: 1px solid #b9c4d0;
  border-radius: 4px;
  overflow: hidden;
  box-sizing: border-box;
  cursor: grab;
  user-select: none;
}

.image-clip.selected {
  border-color: #1976d2;
  box-shadow: 0 0 0 1px #1976d2;
}

.image-clip:active {
  cursor: grabbing;
}

.clip-thumb {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: calc(100% - 18px);
  object-fit: cover;
  pointer-events: none;
}

.clip-thumb-placeholder {
  background: repeating-linear-gradient(45deg, #e3e8ee 0 8px, #eef2f6 8px 16px);
}

.clip-label {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 18px;
  line-height: 18px;
  padding: 0 4px;
  font-size: 10px;
  color: #1f2937;
  background: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.resize-handle {
  position: absolute;
  top: 0;
  width: 8px;
  height: 100%;
  cursor: ew-resize;
  z-index: 3;
}

.resize-handle::after {
  content: '';
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: 3px;
  width: 2px;
  background: rgba(15, 23, 42, 0.35);
  border-radius: 1px;
}

.resize-left {
  left: 0;
}

.resize-right {
  right: 0;
}
</style>
