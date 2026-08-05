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
  <div
    ref="rootEl"
    class="video-director d-flex flex-column"
  >
    <!-- 第一行：播放控制 + 缩放 + 时间信息 -->
    <div class="d-flex align-center ga-2 pa-2 pb-1">
      <v-btn
        :prepend-icon="playState === 'playing' ? 'mdi-pause' : 'mdi-play'"
        :color="playState === 'playing' ? 'warning' : 'primary'"
        variant="tonal"
        size="small"
        :disabled="!canPlay"
        @click="togglePlayback"
      >
        {{ playState === 'playing' ? '暂停' : playState === 'paused' ? '继续' : '播放' }}
      </v-btn>
      <v-btn
        icon="mdi-stop"
        variant="text"
        size="small"
        :disabled="playState === 'idle'"
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
    </div>

    <!-- 第二行：操作按钮 -->
    <div class="d-flex align-center ga-2 pa-2 pt-0">
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

      <v-spacer />

      <v-btn
        v-if="!readOnly && !standalone"
        color="primary"
        prepend-icon="mdi-content-save-check"
        size="small"
        :disabled="!dirty"
        @click="onSave"
      >
        保存
      </v-btn>
      <v-btn
        v-if="!standalone"
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
        @resize-shared="applyImageBoundary"
        @trim="trimClip"
        @seek="seekTo"
        @zoom="setZoom"
      />
    </div>

    <!-- prompt：与分镜-视频生成的 prompt 集成（同一来源 prompt.md） -->
    <div class="pt-4">
      <v-textarea
        :model-value="prompt"
        label="prompt"
        variant="outlined"
        density="compact"
        rows="3"
        auto-grow
        hide-details
        :readonly="readOnly"
        placeholder="视频生成 prompt（与分镜-视频生成的 prompt 同步）"
        @update:model-value="onPromptInput"
      />
    </div>

    <!-- 图片资产选择器：场景/角色/自定义/分镜场景图 -->
    <AssetPickerDialog
      v-model="imagePickerOpen"
      :project="project"
      :tabs="['stage', 'character', 'custom', 'scene-stage']"
      :context-episode="episode"
      :context-shot="shot"
      title="添加图片素材"
      @update:selected="onImagePicked"
    />

    <!-- 音频资产选择器：支持分镜台词音频、分镜/全局自定义资产 -->
    <AssetPickerDialog
      v-model="audioPickerOpen"
      :project="project"
      :tabs="['audio']"
      :context-episode="episode"
      :context-shot="shot"
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
import { DEFAULT_IMAGE_CLIP_DURATION, type DirectorProject } from './types'
import DirectorTimeline from './DirectorTimeline.vue'
import AssetPickerDialog from '../asset-picker/AssetPickerDialog.vue'
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
  /** 集数（用于音频选择器定位分镜台词音频与分镜自定义资产；可选） */
  episode?: string
  /** 分镜编号（用于音频选择器定位分镜台词音频与分镜自定义资产；可选） */
  shot?: string
  /** 只读模式：禁止一切编辑（含播放除外）与保存 */
  readOnly?: boolean
  /** 独立模式（画布节点嵌入）：隐藏「保存/生成视频」按钮，数据实时写回外部 */
  standalone?: boolean
  /** 是否允许添加资产；非只读且为 false 时隐藏「添加图片/音频」按钮，其余编辑仍可用 */
  allowAddAsset?: boolean
  /** 视频生成 prompt（与分镜-视频生成的 prompt 集成，同一来源 prompt.md） */
  prompt?: string
}>()

/**
 * 视频导演台组件事件：
 * - update:director：内部编辑产生的数据变更（v-model 风格）
 * - update:prompt：prompt 文本域输入的最新值（由外部同步到分镜-视频生成的 prompt）
 * - save：用户点击「保存」，由外部落盘 director.json 与 prompt.md
 * - generate：用户点击「生成视频」，由外部先保存再触发生成
 */
const emit = defineEmits<{
  'update:director': [p: DirectorProject]
  'update:prompt': [v: string]
  save: [p: DirectorProject]
  generate: [p: DirectorProject]
}>()

/** 内部是否发生过未保存的编辑（用于禁用「保存」按钮） */
const dirty = ref(false)

/**
 * 播放是否已自然走到音频结尾（引擎自动停止）。
 *
 * 引擎在音频末尾自动停止时，其内部时长（按音频块计算）可能小于项目总时长，
 * 仅凭 currentTime >= duration 无法判断，因此单独用该标记记录，
 * 供再次播放时从头开始。
 */
let reachedEnd = false

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
  addImageAt,
  addAudio,
  moveClip,
  resizeClip,
  applyImageBoundary,
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
    // 切换项目后清除「已播放到结尾」标记，避免影响新项目的播放行为
    reachedEnd = false
  },
  { deep: true, immediate: true },
)

// ── 图片预览 URL 映射（按 path） ──────────────────────────────────
/** 图片 URL 缓存：path → URL，避免拖拽高频重算时用 Date.now() 生成全新 URL 导致图片反复重载 */
const imageUrlCache = new Map<string, string>()
const imageUrls = computed(() => {
  const m: Record<string, string> = {}
  for (const c of imageClips.value) {
    let url = imageUrlCache.get(c.path)
    if (!url) {
      url = buildPreviewUrl(props.project, c.path)
      imageUrlCache.set(c.path, url)
    }
    m[c.path] = url
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
  if (audioData[path]) return
  const buf = await loadAudioBuffer(path)
  if (!buf) {
    // 解码失败：写入失败标记，避免每次音频块变化都重复请求
    audioData[path] = {}
    return
  }
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

// ── 播放（有音频走 PlaybackEngine；纯图片走 rAF 计时器） ──────────
const engine = new PlaybackEngine()

/**
 * 是否有可播放的素材（图片或音频）。
 *
 * 纯图片时也能播放：用计时器推进播放头预览关键帧切换。
 */
const canPlay = computed(() => imageClips.value.length > 0 || audioClips.value.length > 0)

/** 是否有已解码可播放的音频（决定播放用引擎还是计时器） */
const hasPlayableAudio = computed(() => audioClips.value.some((c) => !!audioData[c.path]?.buffer))

/** 纯图片（无音频）播放：rAF 计时器 id（0 表示未在播放） */
let silentRaf = 0
/** 纯图片播放：起始时间戳（performance.now） */
let silentStartTime = 0
/** 纯图片播放：起始位置（秒） */
let silentFromTime = 0

/**
 * 纯图片（无音频）播放：用 rAF 推进播放头直到结尾。
 *
 * 无音频时 PlaybackEngine 无法推进时间（其时长按音频块计算为 0），
 * 故单独用计时器驱动 currentTime，到达项目总长后自动停止。
 */
function startSilentPlayback(): void {
  stopSilentPlayback()
  silentFromTime = currentTime.value
  silentStartTime = performance.now()
  playState.value = 'playing'
  const tick = () => {
    const t = silentFromTime + (performance.now() - silentStartTime) / 1000
    if (t >= duration.value) {
      currentTime.value = duration.value
      reachedEnd = true
      playState.value = 'idle'
      silentRaf = 0
      return
    }
    currentTime.value = t
    silentRaf = requestAnimationFrame(tick)
  }
  silentRaf = requestAnimationFrame(tick)
}

/** 停止纯图片播放计时器（不改变播放状态） */
function stopSilentPlayback(): void {
  if (silentRaf) {
    cancelAnimationFrame(silentRaf)
    silentRaf = 0
  }
}

engine.onStateChange = (s) => {
  playState.value = s
}
engine.onTimeUpdate = (t) => {
  currentTime.value = t
  // 播放头到达引擎内部时长（音频结尾，即将自动停止）时记录标记
  if (engine.duration > 0 && t >= engine.duration) {
    reachedEnd = true
  }
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
 *
 * 若播放头已停在末尾（播放到结尾自动停止，或手动 seek 到末尾），
 * 再次播放时从时间轴开头重新起播。有音频用 PlaybackEngine，
 * 纯图片用 rAF 计时器。
 */
function togglePlayback(): void {
  if (playState.value === 'playing') {
    if (hasPlayableAudio.value) {
      engine.pause()
    } else {
      stopSilentPlayback()
      playState.value = 'paused'
    }
    return
  }
  if (playState.value === 'paused') {
    // 从当前播放头位置起播（覆盖暂停后 seek 的场景），避免 resume 回到旧的暂停位置
    if (hasPlayableAudio.value) {
      engine.play(buildPlaybackClips(), currentTime.value)
    } else {
      startSilentPlayback()
    }
    return
  }
  // idle：已播放到结尾或播放头在末尾时从头播放，否则从当前位置起播
  if (reachedEnd || currentTime.value >= duration.value) {
    reachedEnd = false
    setCurrentTime(0)
  }
  if (hasPlayableAudio.value) {
    engine.play(buildPlaybackClips(), currentTime.value)
  } else {
    startSilentPlayback()
  }
}

/**
 * 停止播放并回到时间轴开头。
 */
function stopPlayback(): void {
  reachedEnd = false
  stopSilentPlayback()
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
  // 手动转跳后清除「已播放到结尾」标记，使下次播放从转跳位置起播
  reachedEnd = false
  setCurrentTime(clamped)
  if (playState.value === 'playing') {
    if (hasPlayableAudio.value) {
      engine.play(buildPlaybackClips(), clamped)
    } else {
      startSilentPlayback()
    }
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
 * 保存：重置未保存标记并通知外部落盘 director.json 与 prompt.md。
 */
function onSave(): void {
  dirty.value = false
  emit('save', toProject())
}

/**
 * prompt 文本域输入：上报最新值（由外部同步到分镜-视频生成的 prompt）。
 *
 * 修改 prompt 视为未保存编辑（启用「保存」按钮），保存时由外部连同
 * director.json 一并落盘 prompt.md。
 *
 * @param v 最新 prompt 文本
 */
function onPromptInput(v: string): void {
  dirty.value = true
  emit('update:prompt', v)
}

/**
 * 图片选择结果：逐个加入图片轨。
 *
 * 从播放头位置开始，每张图依次间隔 DEFAULT_IMAGE_CLIP_DURATION 排开，
 * 避免多图堆叠在同一位置。
 *
 * @param paths 选中图片的相对路径列表
 */
function onImagePicked(paths: string[]): void {
  let cursor = Math.max(0, currentTime.value)
  for (const p of paths) {
    addImageAt(p, cursor)
    cursor += DEFAULT_IMAGE_CLIP_DURATION
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

// ── 快捷键（播放/复制/粘贴/删除） ────────────────────────────────
/** 导演台根元素引用（用于判断用户操作焦点是否在导演台内） */
const rootEl = ref<HTMLElement | null>(null)

/**
 * 用户操作焦点是否在导演台内。
 *
 * 通过全局 `pointerdown`/`focusin`（捕获阶段）同步：点击或聚焦发生在导演台
 * 根元素内部置 true、外部置 false。仅在 true 时才响应导演台快捷键
 * （空格播放、复制/粘贴/删除），避免用户操作页面其他区域时误触发。
 */
let directorActive = false

/**
 * 根据事件目标是否落在导演台根元素内更新 directorActive。
 *
 * @param e 全局 pointerdown / focusin 事件
 */
function updateDirectorActive(e: Event): void {
  directorActive = rootEl.value?.contains(e.target as Node) ?? false
}

/**
 * 全局键盘事件：空格 播放/暂停、Ctrl+C 复制、Ctrl+V 粘贴、Delete/Backspace 删除。
 *
 * 仅在用户操作焦点位于导演台内时响应；焦点在输入框/文本域时不拦截；
 * 只读模式仅允许空格播放/暂停，编辑类快捷键（复制/粘贴/删除）仍被拦截。
 *
 * @param e 键盘事件
 */
function onKeydown(e: KeyboardEvent): void {
  // 操作焦点不在导演台内时，不响应任何导演台快捷键
  if (!directorActive) return
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
    return
  }
  // 空格：播放/暂停（与「播放」按钮行为一致，无可播放音频时忽略）
  if (e.key === ' ') {
    if (canPlay.value) {
      togglePlayback()
      e.preventDefault()
    }
    return
  }
  if (props.readOnly) return
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

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointerdown', updateDirectorActive, true)
  window.addEventListener('focusin', updateDirectorActive, true)
})
onBeforeUnmount(() => {
  stopSilentPlayback()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointerdown', updateDirectorActive, true)
  window.removeEventListener('focusin', updateDirectorActive, true)
})

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
