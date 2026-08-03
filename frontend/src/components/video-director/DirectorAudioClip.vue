<!--
  DirectorAudioClip.vue —— 导演台时间轴音频素材块。

  以绝对定位块渲染单段音频：显示宽度 = (duration - trimStart - trimEnd) * pxPerSec，
  内部以等宽柱状条渲染可见区间波形（waveform 为 0~1 峰值数组）。支持：
  - 拖拽块主体 → 移动（startOffset 钳制在 [0, trackDuration - 显示时长]，0.1s 步进）
  - 拖拽左/右边缘手柄 → 裁剪（调整 trimStart/trimEnd，保持显示时长 ≥ 0.5s）
  - readOnly 时禁用全部移动/裁剪交互
  组件不持有任何状态，通过 select / move / trim 事件向上汇报。
-->
<template>
  <div
    class="audio-clip"
    :class="{ selected }"
    :style="clipStyle"
    @pointerdown.stop="onBodyPointerDown"
  >
    <!-- 左裁剪手柄（readOnly 时不渲染） -->
    <div
      v-if="!readOnly"
      class="trim-handle trim-left"
      @pointerdown.stop="onTrimStart('left', $event)"
    />

    <!-- 波形（可见区间等宽柱状条） -->
    <div class="waveform">
      <div
        v-for="(peak, i) in visibleWaveform"
        :key="i"
        class="wave-bar"
        :style="{ height: `${barHeight(peak)}%` }"
      />
    </div>

    <!-- 底部标签：文件名 + 显示时长 -->
    <div class="clip-label">
      {{ clipName }} · {{ visibleDuration.toFixed(1) }}s
    </div>

    <!-- 右裁剪手柄（readOnly 时不渲染） -->
    <div
      v-if="!readOnly"
      class="trim-handle trim-right"
      @pointerdown.stop="onTrimStart('right', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DirectorAudioClip } from './types'

/**
 * 音频素材块组件 props。
 */
const props = defineProps<{
  /** 音频素材块数据（startOffset/duration/trimStart/trimEnd） */
  clip: DirectorAudioClip
  /** 波形峰值数组（0~1，覆盖整段音频原始时长；父级按 path 提供） */
  waveform: number[]
  /** 缩放比例（像素/秒），用于把秒换算为像素 */
  pxPerSec: number
  /** 是否处于选中态（高亮边框） */
  selected: boolean
  /** 只读模式：禁用移动与裁剪 */
  readOnly: boolean
  /** 轨道总时长（秒），用于钳制移动范围上限 */
  trackDuration: number
}>()

/** 素材块事件：选中 / 移动 / 裁剪 */
const emit = defineEmits<{
  select: [id: string]
  move: [id: string, startOffset: number]
  trim: [id: string, trimStart: number, trimEnd: number]
}>()

/** 裁剪后的显示时长（秒） */
const visibleDuration = computed(() =>
  Math.max(0, props.clip.duration - props.clip.trimStart - props.clip.trimEnd),
)

/** 块绝对定位样式：左 = startOffset * pxPerSec，宽 = 显示时长 * pxPerSec */
const clipStyle = computed(() => ({
  left: `${props.clip.startOffset * props.pxPerSec}px`,
  width: `${visibleDuration.value * props.pxPerSec}px`,
}))

/** 文件名（取路径最后一段） */
const clipName = computed(() => props.clip.path.split('/').pop() || props.clip.path)

/**
 * 可见区间内的波形子数组。
 *
 * waveform 覆盖 [0, duration] 整段音频；按 trimStart/trimEnd 截取
 * [trimStart, duration - trimEnd] 对应的柱子，裁剪时波形随之变化。
 */
const visibleWaveform = computed(() => {
  const wave = props.waveform
  if (!wave.length || props.clip.duration <= 0) return []
  const total = wave.length
  const startIdx = Math.max(0, Math.floor((props.clip.trimStart / props.clip.duration) * total))
  const endIdx = Math.min(
    total,
    Math.ceil(((props.clip.duration - props.clip.trimEnd) / props.clip.duration) * total),
  )
  return wave.slice(startIdx, endIdx)
})

/**
 * 峰值 → 柱高百分比（0~100%，至少 2% 保证可见）。
 *
 * @param peak 峰值（0~1）
 * @returns 柱高百分比
 */
function barHeight(peak: number): number {
  return Math.min(100, Math.max(2, peak * 100))
}

/** 按 0.1 秒步进取整 */
function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/** 钳制数值到 [min, max] 区间 */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** 拖拽类型：move 移动 / trim-left 左缘裁剪 / trim-right 右缘裁剪 */
type DragType = 'move' | 'trim-left' | 'trim-right'

/** 拖拽会话状态（非响应式，仅指针交互期间有效） */
let dragging = false
let dragType: DragType = 'move'
let dragStartX = 0
let dragStartOffset = 0
let dragStartTrimStart = 0
let dragStartTrimEnd = 0

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
 * 边缘手柄按下：选中并开始裁剪拖拽。
 *
 * @param side 手柄方位（left 头部裁剪 trimStart / right 尾部裁剪 trimEnd）
 * @param e 指针按下事件
 */
function onTrimStart(side: 'left' | 'right', e: PointerEvent): void {
  if (props.readOnly || e.button !== 0) return
  emit('select', props.clip.id)
  dragging = true
  dragType = side === 'left' ? 'trim-left' : 'trim-right'
  dragStartX = e.clientX
  dragStartTrimStart = props.clip.trimStart
  dragStartTrimEnd = props.clip.trimEnd
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerEnd)
  document.addEventListener('pointercancel', onPointerEnd)
}

/**
 * 指针移动：按拖拽类型换算并持续上报新值（0.1s 步进）。
 *
 * 移动钳制在 [0, 轨道时长 - 显示时长]；裁剪时保证剩余显示时长 ≥ 0.5s。
 *
 * @param e 指针移动事件
 */
function onPointerMove(e: PointerEvent): void {
  if (!dragging) return
  const deltaSec = (e.clientX - dragStartX) / props.pxPerSec

  if (dragType === 'move') {
    const displayLength = props.clip.duration - props.clip.trimStart - props.clip.trimEnd
    const maxOffset = Math.max(0, props.trackDuration - displayLength)
    emit('move', props.clip.id, round1(clamp(dragStartOffset + deltaSec, 0, maxOffset)))
  } else if (dragType === 'trim-left') {
    // 左缘右移 → trimStart 增大；上限保证剩余显示时长 ≥ 0.5s
    const maxTrimStart = Math.max(0, props.clip.duration - props.clip.trimEnd - 0.5)
    const newTrimStart = round1(clamp(dragStartTrimStart + deltaSec, 0, maxTrimStart))
    emit('trim', props.clip.id, newTrimStart, props.clip.trimEnd)
  } else {
    // 右缘左移 → trimEnd 增大；上限保证剩余显示时长 ≥ 0.5s
    const maxTrimEnd = Math.max(0, props.clip.duration - props.clip.trimStart - 0.5)
    const newTrimEnd = round1(clamp(dragStartTrimEnd - deltaSec, 0, maxTrimEnd))
    emit('trim', props.clip.id, props.clip.trimStart, newTrimEnd)
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
.audio-clip {
  position: absolute;
  top: 3px;
  height: calc(100% - 6px);
  background: rgba(79, 195, 247, 0.12);
  border: 1px solid #4fc3f7;
  border-radius: 4px;
  overflow: hidden;
  box-sizing: border-box;
  cursor: grab;
  user-select: none;
}

.audio-clip.selected {
  border-color: #1976d2;
  box-shadow: 0 0 0 1px #1976d2;
}

.audio-clip:active {
  cursor: grabbing;
}

.waveform {
  position: absolute;
  top: 2px;
  left: 0;
  right: 0;
  bottom: 18px;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 0 3px;
  overflow: hidden;
}

.wave-bar {
  flex: 1 1 0;
  min-width: 1px;
  background: #4fc3f7;
  border-radius: 1px;
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

.trim-handle {
  position: absolute;
  top: 0;
  width: 8px;
  height: 100%;
  cursor: ew-resize;
  z-index: 3;
}

.trim-handle::after {
  content: '';
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: 3px;
  width: 2px;
  background: rgba(15, 23, 42, 0.35);
  border-radius: 1px;
}

.trim-left {
  left: 0;
}

.trim-right {
  right: 0;
}
</style>
