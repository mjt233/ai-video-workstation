<template>
  <div class="trim-video-editor">
    <!-- 输入视频 -->
    <div class="text-body-small text-medium-emphasis mb-1">
      输入视频
    </div>
    <div
      v-if="videoInput"
      class="trim-video-editor__video-wrap"
    >
      <video
        ref="videoRef"
        :src="videoUrl"
        controls
        muted
        class="trim-video-editor__video"
      />
      <div class="trim-video-editor__video-bar">
        <span class="trim-video-editor__video-label text-body-small text-medium-emphasis">
          {{ videoInput.label }}
        </span>
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          :disabled="!canUseCurrentTime"
          title="把预览当前播放位置写入起始时间"
          @click="onUseCurrentTime"
        >
          使用当前播放位置
        </v-btn>
      </div>
    </div>
    <div
      v-else
      class="trim-video-editor__empty"
    >
      <v-icon
        icon="mdi-video-off-outline"
        size="small"
        class="mr-1"
      />
      <span class="text-body-small text-medium-emphasis">请连接视频输入</span>
    </div>

    <!-- 起始位置：数字 + 秒/帧切换 -->
    <v-text-field
      :model-value="startValueText"
      :label="startMode === 'frame' ? '起始位置（帧）' : '起始位置（秒）'"
      type="number"
      density="compact"
      variant="outlined"
      hide-details
      class="mt-3"
      @update:model-value="onStartValueChange"
    >
      <template #append-inner>
        <v-btn-toggle
          :model-value="startMode"
          density="compact"
          variant="outlined"
          divided
          mandatory
          class="trim-video-editor__mode"
          @update:model-value="onStartModeChange"
        >
          <v-btn
            value="time"
            size="x-small"
          >
            秒
          </v-btn>
          <v-btn
            value="frame"
            size="x-small"
          >
            帧
          </v-btn>
        </v-btn-toggle>
      </template>
    </v-text-field>
    <div class="text-body-small text-disabled mt-1">
      {{ startMode === 'frame' ? '帧索引从 0 起（整数）；切换单位不自动换算' : '时间点支持小数秒；切换单位不自动换算' }}
    </div>

    <!-- 持续时长 -->
    <v-text-field
      :model-value="durationText"
      label="持续时长（秒）"
      type="number"
      density="compact"
      variant="outlined"
      hide-details
      class="mt-3"
      @update:model-value="onDurationChange"
    />

    <!-- 裁剪 / 重新裁剪 -->
    <div class="d-flex align-center ga-2 mt-3">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
        :disabled="!canTrim"
        @click="emit('generate', node.id)"
      >
        {{ node.config.current ? '重新裁剪' : '裁剪' }}
      </v-btn>
      <span class="text-body-small text-grey">
        超出片尾时自动截到剩余时长
      </span>
    </div>

    <!-- 当前结果 -->
    <div
      v-if="currentVideo"
      class="mt-3"
    >
      <div class="text-body-small text-medium-emphasis mb-1">
        当前结果
      </div>
      <video
        :src="currentVideo"
        controls
        muted
        class="trim-video-editor__result"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { buildPreviewUrl } from '../../../canvas/preview'

/**
 * 裁剪视频节点配置组件。
 *
 * 展示输入视频预览、起始位置（秒 / 帧二选一，切换不自动换算）与持续时长；
 * 「使用当前播放位置」仅在秒模式下把预览 currentTime 写入 startValue。
 * 裁剪动作复用父级 @generate，由 AssetCanvas 按原型路由到服务端 ffmpeg。
 *
 * 预览 URL 按输入路径缓存（同一路径保持稳定，避免改数字就重载视频）。
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
}>()

/** 输入视频（本节点输入端口为 video 类型，取第一个有资产的输入） */
const videoInput = computed<CanvasInputInfo | null>(() => props.inputs[0] ?? null)

/** 输入视频元素引用（读取当前播放位置） */
const videoRef = ref<HTMLVideoElement | null>(null)

/** 输入视频预览 URL：按路径缓存，同一路径保持稳定 URL */
const videoUrl = ref('')

/** 已缓存 URL 对应的输入视频路径 */
let cachedVideoPath = ''

/**
 * 输入视频路径变化：重建预览 URL（换源刷新）。
 */
watch(
  () => videoInput.value?.path ?? '',
  (p) => {
    if (!p) {
      cachedVideoPath = ''
      videoUrl.value = ''
      return
    }
    if (p !== cachedVideoPath) {
      cachedVideoPath = p
      videoUrl.value = buildPreviewUrl(props.project, p)
    }
  },
  { immediate: true },
)

/** 起始模式：time=秒 / frame=帧索引 */
const startMode = computed<'time' | 'frame'>(() =>
  props.node.config.startMode === 'frame' ? 'frame' : 'time',
)

/** 起始数值（非法值回退 0） */
const startValue = computed(() => {
  const v = props.node.config.startValue
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
})

/** 起始位置输入框展示文本 */
const startValueText = computed(() => String(startValue.value))

/** 持续时长（秒，非法值回退 1） */
const duration = computed(() => {
  const v = props.node.config.duration
  return typeof v === 'number' && Number.isFinite(v) ? v : 1
})

/** 持续时长输入框展示文本 */
const durationText = computed(() => String(duration.value))

/** 当前输出视频预览 URL（config.current.path，带版本号防缓存） */
const currentVideo = computed(() => {
  const cur = props.node.config.current as { path?: string; version?: number } | undefined
  return cur?.path ? buildPreviewUrl(props.project, cur.path, cur.version) : ''
})

/** 是否可触发裁剪：有视频输入、时长 > 0 且不在运行中 */
const canTrim = computed(() => !!videoInput.value && duration.value > 0 && !props.isRunning)

/** 「使用当前播放位置」仅秒模式可用 */
const canUseCurrentTime = computed(
  () => !!videoInput.value && startMode.value === 'time' && !props.isRunning,
)

/**
 * 起始位置输入变化：秒模式允许小数，帧模式取整。
 *
 * @param v 输入框值（数字字符串或空串）
 */
function onStartValueChange(v: unknown) {
  const n = v === '' || v === null || v === undefined ? 0 : Number(v)
  if (!Number.isFinite(n)) {
    emit('update:config', { startValue: 0 })
    return
  }
  const value = startMode.value === 'frame' ? Math.trunc(n) : n
  emit('update:config', { startValue: value < 0 ? 0 : value })
}

/**
 * 切换起始单位：只改 startMode，保留数值不换算。
 *
 * @param v 新模式（time / frame）；取消选中时忽略
 */
function onStartModeChange(v: unknown) {
  if (v !== 'time' && v !== 'frame') return
  const patch: Record<string, unknown> = { startMode: v }
  if (v === 'frame') {
    // 切到帧时把当前数值取整，避免把小数秒当成帧索引提交
    patch.startValue = Math.max(0, Math.trunc(startValue.value))
  }
  emit('update:config', patch)
}

/**
 * 持续时长输入变化：必须是 > 0 的有限数字，非法值回退 1。
 *
 * @param v 输入框值（数字字符串或空串）
 */
function onDurationChange(v: unknown) {
  const n = v === '' || v === null || v === undefined ? 1 : Number(v)
  emit('update:config', { duration: Number.isFinite(n) && n > 0 ? n : 1 })
}

/**
 * 把预览当前播放时间写入 startValue（仅秒模式）。
 */
function onUseCurrentTime() {
  const el = videoRef.value
  if (!el || startMode.value !== 'time') return
  const time = el.currentTime
  if (!Number.isFinite(time) || time < 0) return
  emit('update:config', { startMode: 'time', startValue: time })
}
</script>

<style scoped>
.trim-video-editor__video {
  width: 100%;
  max-height: 160px;
  border-radius: 4px;
  background: #000;
}

.trim-video-editor__empty {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border: 1px dashed rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.trim-video-editor__video-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}

.trim-video-editor__video-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trim-video-editor__mode {
  flex: 0 0 auto;
}

.trim-video-editor__result {
  width: 100%;
  max-height: 180px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.04);
}
</style>
