<template>
  <v-dialog
    :model-value="modelValue"
    max-width="1200"
    fullscreen
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card class="audio-editor-dialog">
      <v-toolbar
        color="primary"
        density="compact"
      >
        <v-toolbar-title>分镜音频编辑</v-toolbar-title>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          @click="$emit('update:modelValue', false)"
        />
      </v-toolbar>

      <v-card-text
        class="pa-0 d-flex flex-column"
        style="height: calc(100vh - 64px);"
      >
        <!-- 工具栏 -->
        <div class="toolbar d-flex align-center ga-2 pa-2">
          <v-btn
            :prepend-icon="playState === 'playing' ? 'mdi-pause' : 'mdi-play'"
            :color="playState === 'playing' ? 'warning' : 'primary'"
            variant="tonal"
            :disabled="!canPlay"
            @click="togglePlay"
          >
            {{ playState === 'playing' ? '暂停' : playState === 'paused' ? '继续' : '播放' }}
          </v-btn>
          <v-btn
            icon="mdi-stop"
            variant="text"
            size="small"
            :disabled="playState === 'idle'"
            @click="stopPlay"
          />
          <v-divider
            vertical
            class="mx-1"
          />
          <span class="text-caption text-grey">缩放：</span>
          <v-btn
            icon="mdi-magnify-minus-outline"
            variant="text"
            size="x-small"
            @click="zoomOut"
          />
          <v-slider
            v-model="zoomLocal"
            :min="10"
            :max="500"
            step="10"
            density="compact"
            hide-details
            class="zoom-slider"
            style="width: 120px;"
          />
          <v-btn
            icon="mdi-magnify-plus-outline"
            variant="text"
            size="x-small"
            @click="zoomIn"
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
            总长：{{ formatTime(totalDuration) }}
          </v-chip>
          <v-spacer />
          <v-btn
            v-if="hasEdit"
            variant="text"
            prepend-icon="mdi-restore"
            size="small"
            @click="resetToDefaults"
          >
            重置
          </v-btn>
          <v-btn
            variant="tonal"
            color="secondary"
            prepend-icon="mdi-merge"
            :loading="merging"
            :disabled="loading || !clips.length"
            @click="doMerge"
          >
            合并音频
          </v-btn>
          <v-btn
            color="primary"
            :loading="saving"
            :disabled="loading || !clips.length"
            @click="doSave"
          >
            保存编辑
          </v-btn>
        </div>

        <!-- 时间轴 -->
        <div
          class="flex-grow-1"
          style="min-height: 0; position: relative;"
        >
          <div
            v-if="loading"
            class="d-flex align-center justify-center"
            style="height: 100%;"
          >
            <v-progress-circular indeterminate />
          </div>
          <div
            v-else-if="errorMsg"
            class="d-flex align-center justify-center text-grey"
            style="height: 100%;"
          >
            {{ errorMsg }}
          </div>
          <AudioTimeline
            v-else
            ref="timelineRef"
            :clips="clips"
            :waveforms="waveforms"
            :zoom="zoomLocal"
            :current-time="currentTime"
            :total-duration="totalDuration"
            @update-offset="onUpdateOffset"
            @update-trim="onUpdateTrim"
            @toggle-play="togglePlay"
            @set-zoom="onSetZoom"
            @seek="onSeek"
          />
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAudioEditor } from './useAudioEditor'
import { mergeSceneAudio } from '../../api/assets'
import AudioTimeline from './AudioTimeline.vue'

const props = defineProps<{
  modelValue: boolean
  project: string
  episode: string
  shot: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'refresh': []
}>()

const {
  clips,
  waveforms,
  loading,
  saving,
  playState,
  currentTime,
  zoom,
  hasEdit,
  totalDuration,
  load,
  updateClip,
  save,
  togglePlay,
  stopPlay,
  setZoom,
  seek,
} = useAudioEditor(props.project, props.episode, props.shot)

const merging = ref(false)

const zoomLocal = ref(80)
const errorMsg = ref('')
const timelineRef = ref<InstanceType<typeof AudioTimeline> | null>(null)

const canPlay = computed(() => clips.value.length > 0)

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 10)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}.${ms}` : `${s}.${ms}`
}

function zoomIn() {
  zoomLocal.value = Math.min(500, zoomLocal.value + 20)
  setZoom(zoomLocal.value)
}

function zoomOut() {
  zoomLocal.value = Math.max(10, zoomLocal.value - 20)
  setZoom(zoomLocal.value)
}

function onSetZoom(z: number) {
  zoomLocal.value = z
  setZoom(z)
}

function onUpdateOffset(index: number, offset: number) {
  updateClip(index, { startOffset: offset })
}

function onUpdateTrim(index: number, trimStart: number, trimEnd: number) {
  updateClip(index, { trimStart, trimEnd })
}

function onSeek(time: number) {
  seek(time)
}

function resetToDefaults() {
  let cursor = 0
  for (const c of clips.value) {
    c.startOffset = cursor
    c.trimStart = 0
    c.trimEnd = 0
    cursor += c.duration
  }
  // 触发响应式
  clips.value = [...clips.value]
}

async function doSave() {
  await save()
}

async function doMerge() {
  merging.value = true
  try {
    await doSave()
    const result = await mergeSceneAudio(props.project, props.episode, props.shot)
    alert('音频合并成功：' + result.path)
    emit('refresh')
  } catch (e: unknown) {
    alert('合并失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    merging.value = false
  }
}

// 打开时加载
watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      errorMsg.value = ''
      await load()
      if (!clips.value.length) {
        const scriptRaw = await import('../../api/client').then(m =>
          m.readFs(props.project, `prompt/scene/${props.episode}/${props.shot}/script.json`).catch(() => null)
        )
        if (!scriptRaw || (typeof scriptRaw === 'string' ? JSON.parse(scriptRaw || '[]') : scriptRaw).length === 0) {
          errorMsg.value = '该分镜没有台词'
        } else {
          errorMsg.value = '部分台词尚未生成语音，请先生成所有语音文件'
        }
      }
    } else {
      stopPlay()
    }
  },
  { immediate: false },
)
</script>

<style scoped>
.audio-editor-dialog {
  height: 100vh;
}

.toolbar {
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.zoom-slider {
  margin: 0 8px;
}
</style>
