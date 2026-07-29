<template>
  <div
    ref="containerRef"
    class="timeline-container"
    tabindex="0"
    @wheel.prevent="onWheel"
    @keydown="onKeyDown"
  >
    <!-- 时间标尺 -->
    <div
      class="ruler"
      :style="{ width: `${rulerWidth}px` }"
    >
      <div
        v-for="mark in rulerMarks"
        :key="mark.sec"
        class="ruler-mark"
        :style="{ left: `${mark.px}px` }"
      >
        <div class="ruler-tick" />
        <div class="ruler-label">
          {{ formatTime(mark.sec) }}
        </div>
      </div>
    </div>

    <!-- 轨道区域 -->
    <div
      class="tracks-area"
      :style="{ width: `${timelineWidth}px` }"
      @mousedown="onTrackClick"
    >
      <AudioClip
        v-for="clip in clips"
        :key="clip.index"
        :clip="clip"
        :waveform="waveforms.get(clip.index)"
        :zoom="zoom"
        :scroll-offset="scrollOffset"
        :track-height="trackHeight"
        @update-offset="(idx: number, off: number) => emit('update-offset', idx, off)"
        @update-trim="(idx: number, ts: number, te: number) => emit('update-trim', idx, ts, te)"
      />
    </div>

    <!-- 播放进度指示线 -->
    <div
      v-if="currentTime > 0"
      class="play-cursor"
      :style="{ left: `${currentTime * zoom - scrollOffset}px` }"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { AudioClipState, WaveformData } from './types'
import AudioClip from './AudioClip.vue'

const props = defineProps<{
  clips: AudioClipState[]
  waveforms: Map<number, WaveformData>
  zoom: number
  currentTime: number
  totalDuration: number
}>()

const emit = defineEmits<{
  'update-offset': [index: number, offset: number]
  'update-trim': [index: number, trimStart: number, trimEnd: number]
  'toggle-play': []
  'set-zoom': [zoom: number]
  'seek': [time: number]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const scrollOffset = ref(0)
const trackHeight = 80

const timelineWidth = computed(() => Math.max(props.totalDuration * props.zoom + 200, 2000))
const rulerWidth = computed(() => timelineWidth.value)

// 时间标尺刻度
const rulerMarks = computed(() => {
  const marks: { sec: number; px: number }[] = []
  const step = getRulerStep(props.zoom)
  const totalSec = props.totalDuration + 2
  for (let s = 0; s <= totalSec; s += step) {
    marks.push({ sec: s, px: s * props.zoom })
  }
  return marks
})

function getRulerStep(zoom: number): number {
  if (zoom >= 200) return 0.5
  if (zoom >= 100) return 1
  if (zoom >= 50) return 2
  return 5
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 10)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}.${ms}` : `${s}.${ms}`
}

// 滚轮缩放
function onWheel(e: WheelEvent) {
  const delta = e.deltaY > 0 ? -10 : 10
  const newZoom = Math.max(10, Math.min(500, props.zoom + delta))
  emit('set-zoom', newZoom)
  // 滚动
  scrollOffset.value = Math.max(0, scrollOffset.value + e.deltaX)
}

// 空格切换播放
function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'Space') {
    e.preventDefault()
    emit('toggle-play')
  }
}

// 点击轨道跳转
function onTrackClick(e: MouseEvent) {
  // 使用容器的滚动偏移来计算点击位置
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const x = e.clientX - rect.left + containerRef.value.scrollLeft
  const sec = x / props.zoom
  emit('seek', Math.max(0, sec))
}

// 同步外部 scrollOffset（可由父组件控制）
// 这里直接在 container 上监听 scroll
function onContainerScroll() {
  if (containerRef.value) {
    // 不使用 scrollOffset ref，直接用 scrollLeft
  }
}

onMounted(() => {
  if (containerRef.value) {
    containerRef.value.addEventListener('scroll', () => {
      // 不做额外处理，卷轴由容器原生滚动
    })
  }
})
</script>

<style scoped>
.timeline-container {
  position: relative;
  width: 100%;
  height: 300px;
  overflow: auto;
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 4px;
  outline: none;
}

.ruler {
  position: sticky;
  top: 0;
  z-index: 10;
  height: 24px;
  background: #252525;
  border-bottom: 1px solid #333;
}

.ruler-mark {
  position: absolute;
  top: 0;
  height: 100%;
}

.ruler-tick {
  width: 1px;
  height: 8px;
  background: #555;
  margin: 0 auto;
}

.ruler-label {
  font-size: 9px;
  color: #888;
  padding-left: 2px;
  white-space: nowrap;
}

.tracks-area {
  position: relative;
  height: calc(100% - 24px);
  min-height: 200px;
}

.play-cursor {
  position: absolute;
  top: 0;
  width: 2px;
  height: 100%;
  background: #ff5722;
  z-index: 20;
  pointer-events: none;
}
</style>
