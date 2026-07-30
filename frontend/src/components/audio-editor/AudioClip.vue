<template>
  <div
    class="audio-clip"
    :style="clipStyle"
    @mousedown.stop="onDragStart"
  >
    <!-- 左裁剪手柄 -->
    <div
      class="trim-handle trim-left"
      @mousedown.stop="onTrimStart('left', $event)"
    />
    <!-- 波形 Canvas -->
    <canvas
      ref="canvasRef"
      class="waveform-canvas"
      :width="canvasWidth"
      :height="clipHeight - 24"
    />
    <!-- 标签 -->
    <div class="clip-label">
      {{ clip.角色名 }}：{{ clip.label }}
    </div>
    <!-- 时长 -->
    <div class="clip-duration">
      {{ visibleDuration.toFixed(1) }}s
    </div>
    <!-- 右裁剪手柄 -->
    <div
      class="trim-handle trim-right"
      @mousedown.stop="onTrimStart('right', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import type { AudioClipState, WaveformData } from './types'
import { drawWaveform, clipVisibleDuration } from './waveform'

const props = defineProps<{
  clip: AudioClipState
  waveform: WaveformData | undefined
  zoom: number
  scrollOffset: number
  trackHeight: number
}>()

const emit = defineEmits<{
  'update-offset': [index: number, newOffset: number]
  'update-trim': [index: number, trimStart: number, trimEnd: number]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

const visibleDuration = computed(() => clipVisibleDuration(props.clip))

const clipWidth = computed(() => visibleDuration.value * props.zoom)

const canvasWidth = computed(() => Math.max(1, clipWidth.value))

const clipHeight = computed(() => props.trackHeight)

const leftPx = computed(() => props.clip.startOffset * props.zoom - props.scrollOffset)

const clipStyle = computed(() => ({
  left: `${leftPx.value}px`,
  width: `${clipWidth.value}px`,
  height: `${clipHeight.value}px`,
}))

let dragging = false
let dragType: 'move' | 'trim-left' | 'trim-right' = 'move'
let dragStartX = 0
let dragStartOffset = 0
let dragStartTrimStart = 0
let dragStartTrimEnd = 0

function onDragStart(e: MouseEvent) {
  dragging = true
  dragType = 'move'
  dragStartX = e.clientX
  dragStartOffset = props.clip.startOffset
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onTrimStart(side: 'left' | 'right', e: MouseEvent) {
  dragging = true
  dragType = side === 'left' ? 'trim-left' : 'trim-right'
  dragStartX = e.clientX
  dragStartTrimStart = props.clip.trimStart
  dragStartTrimEnd = props.clip.trimEnd
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent) {
  if (!dragging) return
  const deltaX = e.clientX - dragStartX
  const deltaSec = deltaX / props.zoom

  if (dragType === 'move') {
    const newOffset = Math.max(0, dragStartOffset + deltaSec)
    emit('update-offset', props.clip.index, newOffset)
  } else if (dragType === 'trim-left') {
    const newTrim = Math.max(0, Math.min(
      dragStartTrimStart + deltaSec,
      props.clip.duration - props.clip.trimEnd - 0.05,
    ))
    emit('update-trim', props.clip.index, newTrim, props.clip.trimEnd)
  } else if (dragType === 'trim-right') {
    const newTrim = Math.max(0, Math.min(
      dragStartTrimEnd - deltaSec,
      props.clip.duration - props.clip.trimStart - 0.05,
    ))
    emit('update-trim', props.clip.index, props.clip.trimStart, newTrim)
  }
}

function onDragEnd() {
  dragging = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

function redraw() {
  if (!canvasRef.value || !props.waveform) return
  drawWaveform(
    canvasRef.value,
    props.waveform,
    '#4fc3f7',
    props.zoom,
    props.clip.trimStart * props.zoom,
    canvasWidth.value,
    clipHeight.value - 24,
  )
}

watch(
  () => [props.waveform, props.zoom, props.clip.trimStart, props.clip.trimEnd],
  redraw,
  { deep: false, flush: 'post' },
)

onMounted(() => {
  nextTick(redraw)
})
</script>

<style scoped>
.audio-clip {
  position: absolute;
  top: 2px;
  background: rgba(79, 195, 247, 0.15);
  border: 1px solid #4fc3f7;
  border-radius: 4px;
  cursor: grab;
  user-select: none;
  overflow: hidden;
  box-sizing: border-box;
}

.audio-clip:active {
  cursor: grabbing;
}

.waveform-canvas {
  display: block;
  width: 100%;
  height: calc(100% - 24px);
  pointer-events: none;
}

.clip-label {
  font-size: 10px;
  line-height: 14px;
  padding: 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #e0e0e0;
  pointer-events: none;
}

.clip-duration {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.5);
  pointer-events: none;
}

.trim-handle {
  position: absolute;
  top: 0;
  width: 8px;
  height: 100%;
  cursor: ew-resize;
  z-index: 2;
}

.trim-handle::after {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 3px;
  width: 2px;
  background: rgba(255, 255, 255, 0.4);
  border-radius: 1px;
}

.trim-left {
  left: 0;
}

.trim-right {
  right: 0;
}
</style>
