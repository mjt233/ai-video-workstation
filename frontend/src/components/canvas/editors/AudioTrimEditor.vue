<template>
  <div class="audio-trim-editor">
    <!-- 输入音频 -->
    <div class="text-body-small text-medium-emphasis mb-1">
      输入音频
    </div>
    <div
      v-if="audioInput"
      class="audio-trim-editor__audio-wrap"
    >
      <audio
        ref="audioRef"
        :src="inputUrl"
        controls
        class="audio-trim-editor__audio"
      />
      <div class="audio-trim-editor__audio-bar">
        <span
          class="audio-trim-editor__audio-label text-body-small text-medium-emphasis"
          :title="audioInput.label"
        >
          {{ audioInput.label }}{{ sourceDurationText ? `（${sourceDurationText}）` : '' }}
        </span>
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          :disabled="!canUseCurrentTime"
          title="把预览当前播放位置写入起始位置"
          @click="onUseCurrentTime"
        >
          使用当前播放位置
        </v-btn>
      </div>
    </div>
    <div
      v-else
      class="audio-trim-editor__empty"
    >
      <v-icon
        icon="mdi-music-off-outline"
        size="small"
        class="mr-1"
      />
      <span class="text-body-small text-medium-emphasis">请连接音频输入</span>
    </div>

    <!-- 起始位置（秒） -->
    <v-text-field
      :model-value="startValueText"
      label="起始位置（秒）"
      type="number"
      min="0"
      step="0.1"
      density="compact"
      variant="outlined"
      hide-details
      class="mt-3"
      @update:model-value="onStartValueChange"
    />
    <div class="text-body-small text-disabled mt-1">
      时间点支持小数秒
    </div>

    <!-- 裁剪时长（秒） -->
    <v-text-field
      :model-value="durationText"
      label="裁剪时长（秒）"
      type="number"
      min="0"
      step="0.1"
      density="compact"
      variant="outlined"
      hide-details
      class="mt-3"
      @update:model-value="onDurationChange"
    />
    <div
      v-if="startAndEndOverflow"
      class="text-body-small text-error mt-1"
    >
      起始位置 + 裁剪时长超出音频片尾，将截到剩余时长
    </div>

    <!-- 裁剪 / 重新裁剪 -->
    <div class="d-flex align-center ga-2 mt-3">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
        :disabled="!canTrim"
        @click="emit('generate', node.id)"
      >
        {{ hasOutput ? '重新裁剪' : '裁剪' }}
      </v-btn>
      <span class="text-body-small text-grey">
        超出片尾时自动截到剩余时长
      </span>
    </div>

    <!-- 当前结果 -->
    <div
      v-if="currentAudio"
      class="mt-3"
    >
      <div class="text-body-small text-medium-emphasis mb-1">
        当前结果
      </div>
      <audio
        :src="currentAudio"
        controls
        class="audio-trim-editor__result"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { buildPreviewUrl } from '../../../canvas/preview'
import { getAudioInfo } from '../../../canvas/api'

/**
 * 裁剪音频节点配置组件。
 *
 * 展示输入音频预览（可播放定位）、起始位置（秒）与裁剪时长（秒，支持小数）；
 * 「使用当前播放位置」把预览 currentTime 写入起始位置。
 * 裁剪动作复用父级 @generate，由 AssetCanvas 按原型路由到服务端 ffmpeg。
 *
 * 输入预览 URL 按输入路径缓存（同一路径保持稳定，避免改数字就重载音频）。
 */
const props = defineProps<{
  /** 项目名（用于资产预览 URL） */
  project: string
  /** 当前节点数据（config 为持久化配置） */
  node: CanvasNodeData
  /** 全部输入（构建预览 URL 用，含来源节点） */
  inputs: CanvasInputInfo[]
  /** 节点是否正在裁剪（显示加载态并禁用按钮） */
  isRunning: boolean
  /** 画布类型（父级统一传入，本组件暂不使用） */
  kind: CanvasKind
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
}>()

/**
 * 组件事件：
 * - update:config：配置补丁（起始位置 / 时长等直接写回节点 config）
 * - generate：触发裁剪（参数为节点 id）
 * - 其余为父级统一传入的监听，本组件暂不使用，需显式声明以免警告
 */
const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'open-history', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'set-as-scene', nodeId: string): void
  (e: 'open-picker', nodeId: string): void
  (e: 'extract', nodeId: string): void
  (e: 'set-as-video', nodeId: string): void
  (e: 'upload-file', payload: unknown): void
  (e: 'disconnect-input', sourceNodeId: string): void
}>()

/** 输入音频（本节点输入端口为 audio 类型，取第一个有资产的输入） */
const audioInput = computed<CanvasInputInfo | null>(() => props.inputs[0] ?? null)

/** 输入音频元素引用（读取当前播放位置） */
const audioRef = ref<HTMLAudioElement | null>(null)

/** 输入音频预览 URL：按路径缓存，同一路径保持稳定 URL（避免每次渲染刷新导致音频重载） */
const inputUrl = ref('')

/** 已缓存 URL 对应的输入音频路径（路径变化时才重建 URL） */
let cachedAudioPath = ''

/** 源音频时长（秒；由服务端 ffprobe 探测，用于越界提示） */
const sourceDuration = ref(0)

/**
 * 输入音频路径变化：重建预览 URL（换源刷新）并拉取时长。
 */
watch(
  () => audioInput.value?.path ?? '',
  (p) => {
    sourceDuration.value = 0
    if (!p) {
      cachedAudioPath = ''
      inputUrl.value = ''
      return
    }
    if (p !== cachedAudioPath) {
      cachedAudioPath = p
      inputUrl.value = buildPreviewUrl(props.project, p, audioInput.value?.version)
    }
    void getAudioInfo(props.project, p)
      .then((info) => {
        // 路径可能已切换，旧结果作废
        if (audioInput.value?.path !== p) return
        sourceDuration.value = info.duration || 0
      })
      .catch(() => {
        // 时长不可用时不显示越界提示（不影响裁剪，服务端兜底校验）
      })
  },
  { immediate: true },
)

/** 起始位置（秒，非法值回退 0） */
const startValue = computed(() => {
  const v = props.node.config.startValue
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
})

/** 起始位置输入框展示文本 */
const startValueText = computed(() => String(startValue.value))

/** 裁剪时长（秒，非法值回退 1） */
const duration = computed(() => {
  const v = props.node.config.duration
  return typeof v === 'number' && Number.isFinite(v) ? v : 1
})

/** 裁剪时长输入框展示文本 */
const durationText = computed(() => String(duration.value))

/** 节点当前是否已有裁剪结果（按钮文案用；产物为固定路径文件，由服务端落盘） */
const hasOutput = computed(() => !!(props.output || props.node.config.current))

/** 当前输出音频预览 URL（优先 AssetCanvas 下发的固定路径产物，回落到 config.current 旧数据） */
const currentAudio = computed(() => {
  const out = props.output
  if (out?.path) return buildPreviewUrl(props.project, out.path, out.token)
  const cur = props.node.config.current as { path?: string; version?: number } | undefined
  return cur?.path ? buildPreviewUrl(props.project, cur.path, cur.version) : ''
})

/** 是否可触发裁剪：有音频输入、时长 > 0 且不在运行中 */
const canTrim = computed(() => !!audioInput.value && duration.value > 0 && !props.isRunning)

/** 「使用当前播放位置」仅在有输入且不在运行中可用 */
const canUseCurrentTime = computed(() => !!audioInput.value && !props.isRunning)

/** 源时长展示文本（秒，保留 2 位小数） */
const sourceDurationText = computed(() =>
  sourceDuration.value > 0 ? `${Number(sourceDuration.value.toFixed(2))}s` : '',
)

/** 起始位置 + 时长是否超出源音频片尾（源时长未知时不提示，服务端兜底截断） */
const startAndEndOverflow = computed(
  () => sourceDuration.value > 0 && startValue.value + duration.value > sourceDuration.value + 1e-6,
)

/**
 * 起始位置输入变化：必须是非负有限数字，非法值回退 0。
 *
 * @param v 输入框值（数字字符串或空串）
 */
function onStartValueChange(v: unknown) {
  const n = v === '' || v === null || v === undefined ? 0 : Number(v)
  emit('update:config', { startValue: Number.isFinite(n) && n >= 0 ? n : 0 })
}

/**
 * 裁剪时长输入变化：必须是 > 0 的有限数字，非法值回退 1。
 *
 * @param v 输入框值（数字字符串或空串）
 */
function onDurationChange(v: unknown) {
  const n = v === '' || v === null || v === undefined ? 1 : Number(v)
  emit('update:config', { duration: Number.isFinite(n) && n > 0 ? n : 1 })
}

/**
 * 把预览当前播放时间写入起始位置。
 */
function onUseCurrentTime() {
  const el = audioRef.value
  if (!el) return
  const time = el.currentTime
  if (!Number.isFinite(time) || time < 0) return
  emit('update:config', { startValue: time })
}
</script>

<style scoped>
.audio-trim-editor__audio {
  width: 100%;
  border-radius: 4px;
}

.audio-trim-editor__empty {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border: 1px dashed rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.audio-trim-editor__audio-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}

.audio-trim-editor__audio-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audio-trim-editor__result {
  width: 100%;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.04);
}
</style>
