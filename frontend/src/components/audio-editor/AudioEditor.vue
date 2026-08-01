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
            color="primary"
            prepend-icon="mdi-content-save-check"
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

  <!-- 保存/合并结果反馈对话框 -->
  <v-dialog
    v-model="saveFeedback.show"
    max-width="420"
  >
    <v-card>
      <v-card-title class="d-flex align-center ga-2">
        <v-icon :color="saveFeedback.success ? 'success' : 'error'">
          {{ saveFeedback.success ? 'mdi-check-circle' : 'mdi-alert-circle' }}
        </v-icon>
        {{ saveFeedback.success ? '保存成功' : '保存失败' }}
      </v-card-title>
      <v-card-text>
        {{ saveFeedback.message }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          color="primary"
          variant="text"
          @click="saveFeedback.show = false"
        >
          确定
        </v-btn>
      </v-card-actions>
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
} = useAudioEditor(() => ({
  project: props.project,
  episode: props.episode,
  shot: props.shot,
}))

const zoomLocal = ref(80)
const errorMsg = ref('')
const timelineRef = ref<InstanceType<typeof AudioTimeline> | null>(null)

/**
 * 保存/合并结果反馈（Vuetify 对话框状态）。
 */
const saveFeedback = ref<{ show: boolean; success: boolean; message: string }>({
  show: false,
  success: true,
  message: '',
})

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

/**
 * 保存编辑状态并合并生成分镜音频。
 * 成功后通过 Vuetify 对话框提示用户，并通知父组件刷新。
 */
async function doSave() {
  if (!clips.value.length) return
  saving.value = true
  try {
    await save()
    await mergeSceneAudio(props.project, props.episode, props.shot)
    saveFeedback.value = {
      show: true,
      success: true,
      message: '音频编辑已保存，并已合并生成分镜音频。',
    }
    emit('refresh')
  } catch (e: unknown) {
    saveFeedback.value = {
      show: true,
      success: false,
      message: '保存失败：' + (e instanceof Error ? e.message : String(e)),
    }
  } finally {
    saving.value = false
  }
}

// 打开时加载；切换分镜后重新加载当前分镜的音频
watch(
  [() => props.modelValue, () => props.project, () => props.episode, () => props.shot],
  async () => {
    if (props.modelValue) {
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
)
</script>

<style scoped>
.audio-editor-dialog {
  height: 100vh;
}

.toolbar {
  background: #f0f4fa;
  border-bottom: 1px solid #d0d7e0;
  flex-shrink: 0;
}

.zoom-slider {
  margin: 0 8px;
}
</style>
