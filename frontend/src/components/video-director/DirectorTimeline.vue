<!--
  DirectorTimeline.vue —— 导演台时间轴。

  由顶部整秒标尺、图片轨、音频轨与播放头组成：
  - 图片轨渲染 DirectorImageClip 列表，音频轨渲染 DirectorAudioClip 列表
  - 播放头为跟随 currentTime 的竖直红线（与标尺对齐）
  - 点击/拖拽空白区域 → seek（0.1s 步进，钳制在 [0, duration]）
  - 素材块事件透传：select / move（补充轨道类型）/ resize / trim
  组件不持有任何项目状态，全部通过 props 接收数据、事件向上汇报。
-->
<template>
  <div
    ref="containerRef"
    class="director-timeline"
  >
    <div
      ref="contentRef"
      class="timeline-content"
      :style="{ width: `${contentWidth}px` }"
      @pointerdown="onSeekStart"
    >
      <!-- 时间标尺（整秒刻度 + 标签） -->
      <div class="timeline-ruler">
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

      <!-- 图片轨 -->
      <div class="track track-image">
        <DirectorImageClip
          v-for="clip in imageClips"
          :key="clip.id"
          :clip="clip"
          :image-url="imageUrls[clip.path] ?? ''"
          :px-per-sec="zoom"
          :selected="clip.id === selectedId"
          :read-only="readOnly"
          :track-duration="duration"
          @select="(id) => emit('select', id)"
          @move="(id, off) => emit('move', 'image', id, off)"
          @resize="(id, dur) => emit('resize', id, dur)"
        />
      </div>

      <!-- 音频轨 -->
      <div class="track track-audio">
        <DirectorAudioClip
          v-for="clip in audioClips"
          :key="clip.id"
          :clip="clip"
          :waveform="waveforms[clip.path] ?? []"
          :px-per-sec="zoom"
          :selected="clip.id === selectedId"
          :read-only="readOnly"
          :track-duration="duration"
          @select="(id) => emit('select', id)"
          @move="(id, off) => emit('move', 'audio', id, off)"
          @trim="(id, ts, te) => emit('trim', id, ts, te)"
        />
      </div>

      <!-- 播放头 -->
      <div
        class="playhead"
        :style="{ left: `${currentTime * zoom}px` }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  DirectorAudioClip as DirectorAudioClipData,
  DirectorImageClip as DirectorImageClipData,
} from './types'
import DirectorImageClip from './DirectorImageClip.vue'
import DirectorAudioClip from './DirectorAudioClip.vue'

/**
 * 导演台时间轴组件 props。
 */
const props = defineProps<{
  /** 图片轨素材块列表 */
  imageClips: DirectorImageClipData[]
  /** 音频轨素材块列表 */
  audioClips: DirectorAudioClipData[]
  /** 图片缩略图 URL 映射（key 为图片 path，value 为可访问 URL） */
  imageUrls: Record<string, string>
  /** 音频波形峰值映射（key 为音频 path，value 为 0~1 峰值数组） */
  waveforms: Record<string, number[]>
  /** 视频总时长（秒），决定轨道与标尺范围 */
  duration: number
  /** 播放头当前时间（秒） */
  currentTime: number
  /** 时间轴缩放（像素/秒） */
  zoom: number
  /** 当前选中素材块 id（无选中时为 null） */
  selectedId: string | null
  /** 只读模式：禁用所有素材块拖拽/拉伸/裁剪交互（仍可点击空白跳转播放头） */
  readOnly: boolean
}>()

/**
 * 时间轴事件：透传素材块事件并补充轨道类型；seek 用于跳转播放头。
 */
const emit = defineEmits<{
  /** 选中素材块（id 为素材块自身 id） */
  select: [id: string]
  /** 移动素材块；kind 区分 image/audio 轨道，便于父级路由到 moveClip */
  move: [kind: 'image' | 'audio', id: string, startOffset: number]
  /** 调整图片块占位长度 */
  resize: [id: string, duration: number]
  /** 调整音频块裁剪 */
  trim: [id: string, trimStart: number, trimEnd: number]
  /** 跳转播放头（秒，0.1s 步进，钳制在 [0, duration]） */
  seek: [t: number]
  /** 滚轮缩放：上报缩放后的像素/秒值（由父级 setZoom 应用） */
  zoom: [zoom: number]
}>()

/** 时间轴滚动容器引用（用于滚轮缩放锚点换算） */
const containerRef = ref<HTMLDivElement | null>(null)
/** 滚动内容区引用（用于按坐标换算时间） */
const contentRef = ref<HTMLDivElement | null>(null)

/** 滚轮缩放步长（向上滚动放大/向下缩小的倍率） */
const WHEEL_ZOOM_STEP = 1.2
/** 缩放最小值（像素/秒，与父级缩放滑块下限一致） */
const MIN_ZOOM = 10
/** 缩放最大值（像素/秒，与父级缩放滑块上限一致） */
const MAX_ZOOM = 500

/**
 * 内容宽度：时长铺满时为 duration * zoom；
 * 不足时由 CSS min-width: 100% 兜底撑满容器（实现 max(duration*zoom, 容器宽)）。
 */
const contentWidth = computed(() => Math.max(0, props.duration * props.zoom))

/** 标尺刻度：整秒，从 0 到 ceil(duration) */
const rulerMarks = computed(() => {
  const marks: { sec: number; px: number }[] = []
  const total = Math.max(0, Math.ceil(props.duration))
  for (let s = 0; s <= total; s++) {
    marks.push({ sec: s, px: s * props.zoom })
  }
  return marks
})

/**
 * 标尺标签时间格式化（分:秒）。
 *
 * @param sec 秒数
 * @returns 形如 "5" 或 "1:05" 的标签文本
 */
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}`
}

/**
 * 由事件坐标换算为播放头时间（0.1s 步进）。
 *
 * 坐标基于内容区（已含水平滚动偏移），换算公式：t = x / zoom，
 * 再钳制到 [0, duration] 并按 0.1s 取整。
 *
 * @param e 指针事件
 * @returns 换算后的时间（秒）
 */
function seekFromEvent(e: PointerEvent): number {
  if (!contentRef.value || props.zoom <= 0) return 0
  const rect = contentRef.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const t = Math.max(0, Math.min(props.duration, x / props.zoom))
  return Math.round(t * 10) / 10
}

/** 是否处于拖拽跳转中 */
let seeking = false

/**
 * 空白区域按下：跳转播放头并支持拖拽连续跳转。
 *
 * 素材块自身的 pointerdown 已 stopPropagation，不会触达此处。
 *
 * @param e 指针按下事件
 */
function onSeekStart(e: PointerEvent): void {
  if (e.button !== 0) return
  seeking = true
  emit('seek', seekFromEvent(e))
  document.addEventListener('pointermove', onSeekMove)
  document.addEventListener('pointerup', onSeekEnd)
  document.addEventListener('pointercancel', onSeekEnd)
}

/**
 * 拖拽跳转中：持续上报新时间。
 *
 * @param e 指针移动事件
 */
function onSeekMove(e: PointerEvent): void {
  if (!seeking) return
  emit('seek', seekFromEvent(e))
}

/**
 * 结束跳转：清理监听。
 */
function onSeekEnd(): void {
  seeking = false
  document.removeEventListener('pointermove', onSeekMove)
  document.removeEventListener('pointerup', onSeekEnd)
  document.removeEventListener('pointercancel', onSeekEnd)
}

/**
 * 滚轮缩放：以鼠标位置为锚点缩放时间轴。
 *
 * 向上滚动放大、向下滚动缩小，倍率 WHEEL_ZOOM_STEP；缩放后保持鼠标下的
 * 时间点在容器内的像素位置不变（通过调整 scrollLeft 实现）。
 *
 * @param e 滚轮事件
 */
function onWheel(e: WheelEvent): void {
  // 横向滚动（shift+滚轮 / 触控板横滑）交给原生横向滚动，不缩放
  if (e.deltaY === 0) return
  e.preventDefault()
  const container = containerRef.value
  if (!container || props.zoom <= 0) return
  const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, props.zoom * factor))
  if (newZoom === props.zoom) return
  // 锚点：鼠标在内容区的水平坐标 → 对应的时间点
  const rect = container.getBoundingClientRect()
  const mouseXInContent = e.clientX - rect.left + container.scrollLeft
  const anchorT = mouseXInContent / props.zoom
  emit('zoom', newZoom)
  // 缩放（父级更新 zoom prop）后，滚动使锚点时间回到鼠标原位置
  requestAnimationFrame(() => {
    container.scrollLeft = Math.max(0, anchorT * newZoom - (e.clientX - rect.left))
  })
}

// 滚轮需用非被动监听才能 preventDefault 阻止页面随滚动
onMounted(() => {
  containerRef.value?.addEventListener('wheel', onWheel, { passive: false })
})
onBeforeUnmount(() => {
  containerRef.value?.removeEventListener('wheel', onWheel)
})
</script>

<style scoped>
.director-timeline {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 160px;
  overflow-x: auto;
  overflow-y: hidden;
  background: #fafbfd;
  border: 1px solid #d0d7e0;
  border-radius: 4px;
  user-select: none;
}

.timeline-content {
  position: relative;
  min-width: 100%;
  min-height: 100%;
}

.timeline-ruler {
  position: relative;
  height: 26px;
  background: #f0f4fa;
  border-bottom: 1px solid #d0d7e0;
}

.ruler-mark {
  position: absolute;
  top: 0;
  height: 100%;
}

.ruler-tick {
  width: 1px;
  height: 8px;
  margin: 0 auto;
  background: #aeb6c2;
}

.ruler-label {
  padding-left: 2px;
  font-size: 9px;
  color: #64748b;
  white-space: nowrap;
}

.track {
  position: relative;
  border-bottom: 1px solid #eef1f5;
}

.track-image {
  height: 72px;
}

.track-audio {
  height: 64px;
}

.playhead {
  position: absolute;
  top: 0;
  height: 100%;
  width: 2px;
  background: #ff5722;
  z-index: 10;
  pointer-events: none;
}
</style>
