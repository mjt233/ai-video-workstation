<!--
  VideoDirector.vue —— 视频导演台主组件（布局 A：预览置顶 + 双轨下方）。

  组成：
  - 工具栏：播放/暂停/停止、缩放、当前/总时长、添加图片、添加音频、复制、粘贴、保存、生成视频
  - 预览窗口：显示时间轴当前位置应展示的图片（取最后一个 startOffset <= currentTime 的图片块）
  - DirectorTimeline：双轨（图片 + 音频）时间轴，支持拖拽/拉伸/裁剪/转跳

  组件不直接落盘：通过 `update:director` 上报数据变更（v-model 风格）、
  `save`/`generate` 事件交由外部实现保存与生成视频。
  播放通过复用 audio-editor 的 PlaybackEngine 实现音频实时播放与时间轴跟随。
-->
<template>
  <div class="video-director d-flex flex-column">
    <!-- 工具栏 -->
    <div class="d-flex align-center ga-2 pa-2">
      <v-btn
        :prepend-icon="playState === 'playing' ? 'mdi-pause' : 'mdi-play'"
        :color="playState === 'playing' ? 'warning' : 'primary'"
        variant="tonal"
        size="small"
        :disabled="readOnly || !canPlay"
        @click="togglePlayback"
      >
        {{ playState === 'playing' ? '暂停' : playState === 'paused' ? '继续' : '播放' }}
      </v-btn>
      <v-btn
        icon="mdi-stop"
        variant="text"
        size="small"
        :disabled="readOnly || playState === 'idle'"
        @click="stopPlayback"
      />

      <v-divider
        vertical
        class="mx-1"
      />
      <span class="text-caption text-grey">缩放：</span>
      <v-slider
        v-model="zoomModel"
        :min="10"
        :max="500"
        step="10"
        density="compact"
        hide-details
        class="zoom-slider"
        style="width: 120px;"
      />

      <v-divider
        vertical
        class="mx-1"
      />
      <v-chip
        size="small"
        variant="outlined"
      >
        当前：{{ formatTime(currentTime) }}
      </v-chip>
      <v-chip
        size="small"
        variant="outlined"
      >
        总长：{{ formatTime(duration) }}s
      </v-chip>

      <v-spacer />

      <template v-if="!readOnly && allowAddAsset">
        <v-btn
          prepend-icon="mdi-image-plus"
          size="small"
          variant="tonal"
          @click="imagePickerOpen = true"
        >
          添加图片
        </v-btn>
        <v-btn
          prepend-icon="mdi-music-note-plus"
          size="small"
          variant="tonal"
          @click="audioPickerOpen = true"
        >
          添加音频
        </v-btn>
      </template>
      <v-btn
        v-if="!readOnly"
        prepend-icon="mdi-content-copy"
        size="small"
        variant="tonal"
        :disabled="!selectedId"
        @click="copySelected"
      >
        复制
      </v-btn>
      <v-btn
        v-if="!readOnly"
        prepend-icon="mdi-content-paste"
        size="small"
        variant="tonal"
        :disabled="!clipboard"
        @click="paste"
      >
        粘贴
      </v-btn>

      <v-btn
        v-if="!readOnly"
        color="primary"
        prepend-icon="mdi-content-save-check"
        size="small"
        :disabled="!dirty"
        @click="emit('save', toProject())"
      >
        保存
      </v-btn>
      <v-btn
        color="success"
        prepend-icon="mdi-video-outline"
        size="small"
        @click="emit('generate', toProject())"
      >
        生成视频
      </v-btn>
    </div>

    <!-- 预览窗口（布局 A：轨道上方） -->
    <div class="preview-window mx-2 my-1">
      <img
        v-if="previewUrl"
        :src="previewUrl"
        class="preview-img"
        alt="当前帧预览"
      >
      <div
        v-else
        class="preview-placeholder text-grey"
      >
        无图片预览（将图片块放置在轨道上后，此处显示当前时间点的图片）
      </div>
    </div>

    <!-- 时间轴（双轨） -->
    <div
      class="flex-grow-1"
      style="min-height: 0;"
    >
      <DirectorTimeline
        :image-clips="imageClips"
        :audio-clips="audioClips"
        :image-urls="imageUrls"
        :waveforms="waveforms"
        :duration="duration"
        :current-time="currentTime"
        :zoom="zoom"
        :selected-id="selectedId"
        :read-only="readOnly"
        @select="select"
        @move="moveClip"
        @resize="resizeClip"
        @trim="trimClip"
        @seek="seekTo"
      />
    </div>

    <!-- 图片资产选择器 -->
    <AssetPickerDialog
      v-model="imagePickerOpen"
      :project="project"
      :tabs="['stage', 'character', 'custom']"
      title="添加图片素材"
      @update:selected="onImagePicked"
    />

    <!-- 音频资产选择器（自定义资产可存放任意音频文件） -->
    <AssetPickerDialog
      v-model="audioPickerOpen"
      :project="project"
      :tabs="['custom']"
      title="添加音频素材"
      @update:selected="onAudioPicked"
    />
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue'
import {
  useVideoDirector,
  previewImageAt,
} from './useVideoDirector'
import type { DirectorProject } from './types'
import DirectorTimeline from './DirectorTimeline.vue'
import AssetPickerDialog from '../AssetPickerDialog.vue'
import { buildPreviewUrl } from '../../canvas/preview'
import { PlaybackEngine, type PlaybackClip } from '../audio-editor/PlaybackEngine'

/**
 * 视频导演台主组件 props。
 */
const props = defineProps<{
  /** 项目名（用于资产 URL 与选择器） */
  project: string
  /** 导演台项目数据（由外部持有，如 ScenePanel 从 director.json 加载） */
  director: DirectorProject
  /** 只读模式：禁止一切编辑（含播放除外）与保存 */
  readOnly?: boolean
  /** 是否允许添加资产；非只读且为 false 时隐藏「添加图片/音频」按钮，其余编辑仍可用 */
  allowAddAsset?: boolean
}>()

/**
 * 视频导演台组件事件：
 * - update:director：内部编辑产生的数据变更（v-model 风格）
 * - save：用户点击「保存」，由外部落盘 director.json
 * - generate：用户点击「生成视频」，由外部先保存再触发生成
 */
const emit = defineEmits<{
  'update:director': [p: DirectorProject]
  save: [p: DirectorProject]
  generate: [p: DirectorProject]
}>()

/** 内部是否发生过未保存的编辑（用于禁用「保存」按钮） */
const dirty = ref(false)

/** 复用 useVideoDirector 管理编辑状态；编辑后通过 onChange 上报 */
const {
  imageClips,
  audioClips,
  duration,
  currentTime,
  playState,
  zoom,
  selectedId,
  clipboard,
  syncFromProject,
  toProject,
  addImage,
  addAudio,
  moveClip,
  resizeClip,
  trimClip,
  select,
  copySelected,
  paste,
  removeSelected,
  setCurrentTime,
  setZoom,
} = useVideoDirector({
  onChange: (p) => {
    dirty.value = true
    emit('update:director', p)
  },
})

// ── 外部数据同步（切换分镜/外部更新） ──────────────────────────────
// 用 JSON 相等守卫防止「emit update:director → 父级回传 prop → 深 watch」死循环。
watch(
  () => props.director,
  (p) => {
    if (!p) return
    const cur = toProject()
    if (JSON.stringify(p) === JSON.stringify(cur)) return
    syncFromProject(p)
    dirty.value = false
  },
  { deep: true, immediate: true },
)

// ── 图片预览 URL 映射（按 path） ──────────────────────────────────
const imageUrls = computed(() => {
  const m: Record<string, string> = {}
  for (const c of imageClips.value) {
    m[c.path] = buildPreviewUrl(props.project, c.path)
  }
  return m
})

/** 当前时间点应预览的图片路径 */
const previewPath = computed(() => previewImageAt(imageClips.value, currentTime.value))
/** 当前时间点应预览的图片 URL */
const previewUrl = computed(() => {
  const p = previewPath.value
  return p ? imageUrls.value[p] ?? '' : ''
})

// ── 音频数据（波形 + 解码缓冲，按 path 缓存） ─────────────────────
/** 音频数据缓存：path → { buffer, peaks }；peaks 为 0~1 归一化峰值数组 */
const audioData = reactive<Record<string, { buffer?: AudioBuffer; peaks?: number[] }>>({})

/**
 * 加载并解码单个音频文件，缓存 AudioBuffer 并派生波形峰值。
 *
 * @param path 项目内音频相对路径（assert/ 下）
 */
async function ensureAudioData(path: string): Promise<void> {
  const existing = audioData[path]
  if (existing && (existing.buffer || existing.peaks)) return
  const buf = await loadAudioBuffer(path)
  if (!buf) return
  const peaks = extractPeaks(buf, 200)
  audioData[path] = { buffer: buf, peaks }
}

/**
 * 从 AudioBuffer 降采样出固定数量的归一化峰值（0~1）。
 *
 * @param buffer 解码后的音频缓冲
 * @param count 输出峰值数量
 * @returns 峰值数组
 */
function extractPeaks(buffer: AudioBuffer, count: number): number[] {
  const ch = buffer.getChannelData(0)
  const peaks: number[] = []
  const bucket = Math.max(1, Math.floor(ch.length / count))
  for (let i = 0; i < count; i++) {
    let m = 0
    const s = i * bucket
    for (let j = s; j < Math.min(s + bucket, ch.length); j++) {
      m = Math.max(m, Math.abs(ch[j]))
    }
    peaks.push(m)
  }
  return peaks
}

/**
 * 加载并解码音频文件为 AudioBuffer。
 *
 * @param path 项目内音频相对路径（assert/ 下）
 * @returns 解码结果；解码失败返回 null
 */
async function loadAudioBuffer(path: string): Promise<AudioBuffer | null> {
  try {
    const resp = await fetch(`/api/fs/${props.project}/${path}`)
    const ab = await resp.arrayBuffer()
    const ctx = new AudioContext()
    const buf = await ctx.decodeAudioData(ab)
    ctx.close()
    return buf
  } catch {
    return null
  }
}

/** 波形峰值映射（按 path，供时间轴渲染音频波形） */
const waveforms = computed(() => {
  const m: Record<string, number[]> = {}
  for (const [path, d] of Object.entries(audioData)) {
    if (d.peaks) m[path] = d.peaks
  }
  return m
})

/** 音频块变化时确保其音频数据已加载（新增/切换分镜后触发） */
watch(
  audioClips,
  (clips) => {
    for (const c of clips) {
      void ensureAudioData(c.path)
    }
  },
  { immediate: true },
)

// ── 播放（复用 audio-editor PlaybackEngine） ──────────────────────
const engine = new PlaybackEngine()

/** 是否有可播放的音频素材 */
const canPlay = computed(() => audioClips.value.length > 0)

engine.onStateChange = (s) => {
  playState.value = s
}
engine.onTimeUpdate = (t) => {
  currentTime.value = t
}

/**
 * 将当前音频轨素材块映射为 PlaybackEngine 可用的片段列表。
 *
 * 仅包含已成功解码的音频；index 取数组下标，角色名为空字符串，label 取文件名。
 *
 * @returns 播放片段列表
 */
function buildPlaybackClips(): PlaybackClip[] {
  return audioClips.value
    .map((c, i) => {
      const buffer = audioData[c.path]?.buffer
      if (!buffer) return null
      return {
        state: {
          index: i,
          角色名: '',
          label: c.path.split('/').pop() ?? c.path,
          duration: c.duration,
          startOffset: c.startOffset,
          trimStart: c.trimStart,
          trimEnd: c.trimEnd,
        },
        buffer,
      }
    })
    .filter((c): c is PlaybackClip => c !== null)
}

/**
 * 播放/暂停/继续切换。
 */
function togglePlayback(): void {
  if (playState.value === 'playing') {
    engine.pause()
    return
  }
  if (playState.value === 'paused') {
    engine.resume(buildPlaybackClips())
    return
  }
  engine.play(buildPlaybackClips(), currentTime.value)
}

/**
 * 停止播放并回到时间轴开头。
 */
function stopPlayback(): void {
  engine.stop()
  setCurrentTime(0)
}

/**
 * 跳转到指定时间点（时间轴点击/拖动转跳）。
 *
 * 播放中时从目标时间点重新起播，否则仅移动播放头。
 *
 * @param t 目标时间（秒）
 */
function seekTo(t: number): void {
  const clamped = Math.max(0, Math.min(duration.value, t))
  setCurrentTime(clamped)
  if (playState.value === 'playing') {
    engine.play(buildPlaybackClips(), clamped)
  }
}

// ── 缩放滑块双向绑定 ──────────────────────────────────────────────
const zoomModel = computed({
  get: () => zoom.value,
  set: (v: number) => setZoom(v),
})

// ── 资产选择器 ────────────────────────────────────────────────────
const imagePickerOpen = ref(false)
const audioPickerOpen = ref(false)

/**
 * 图片选择结果：逐个加入图片轨。
 *
 * @param paths 选中图片的相对路径列表
 */
function onImagePicked(paths: string[]): void {
  for (const p of paths) {
    addImage(p)
  }
  imagePickerOpen.value = false
}

/**
 * 音频选择结果：逐个解码获取时长后加入音频轨。
 *
 * 无法解码的文件（非音频）跳过并告警。
 *
 * @param paths 选中音频的相对路径列表
 */
function onAudioPicked(paths: string[]): void {
  for (const p of paths) {
    void (async () => {
      const buf = await loadAudioBuffer(p)
      if (buf) {
        addAudio(p, buf.duration)
      } else {
        console.warn(`无法解码音频，已跳过: ${p}`)
      }
    })()
  }
  audioPickerOpen.value = false
}

// ── 快捷键（复制/粘贴/删除） ──────────────────────────────────────
/**
 * 全局键盘事件：Ctrl+C 复制、Ctrl+V 粘贴、Delete/Backspace 删除。
 *
 * 只读模式或焦点在输入框/文本域时不拦截。
 *
 * @param e 键盘事件
 */
function onKeydown(e: KeyboardEvent): void {
  if (props.readOnly) return
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    copySelected()
    e.preventDefault()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
    paste()
    e.preventDefault()
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    removeSelected()
    e.preventDefault()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/**
 * 格式化时间为 m:ss.d 或 s.d。
 *
 * @param sec 秒
 * @returns 格式化字符串
 */
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const d = Math.floor((sec % 1) * 10)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}.${d}` : `${s}.${d}`
}
</script>

<style scoped>
.video-director {
  height: 100%;
  min-height: 0;
}

.preview-window {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 180px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  background: #0f1020;
}

.preview-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.preview-placeholder {
  font-size: 12px;
}
</style>
