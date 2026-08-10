<template>
  <div class="extract-frame-editor">
    <!-- 输入视频 -->
    <div class="text-body-small text-medium-emphasis mb-1">
      输入视频
    </div>
    <div
      v-if="videoInput"
      class="extract-frame-editor__video-wrap"
    >
      <video
        ref="videoRef"
        :src="videoUrl"
        controls
        muted
        class="extract-frame-editor__video"
      />
      <div class="extract-frame-editor__video-bar">
        <span class="extract-frame-editor__video-label text-body-small text-medium-emphasis">
          {{ videoInput.label }}
        </span>
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          :loading="isRunning"
          :disabled="!canExtractCurrentFrame"
          title="按预览当前播放位置提取（记录时间点并立即提取）"
          @click="onExtractCurrentFrame"
        >
          <v-icon
            icon="mdi-camera"
            size="small"
            class="mr-1"
          />
          提取当前帧
        </v-btn>
      </div>
    </div>
    <div
      v-else
      class="extract-frame-editor__empty"
    >
      <v-icon
        icon="mdi-video-off-outline"
        size="small"
        class="mr-1"
      />
      <span class="text-body-small text-medium-emphasis">请连接视频输入</span>
    </div>

    <!-- 帧索引（右侧内置提取按钮） -->
    <v-text-field
      :model-value="String(frameIndex)"
      label="帧索引"
      type="number"
      density="compact"
      variant="outlined"
      hide-details
      class="mt-3"
      @update:model-value="onFrameIndexChange"
    >
      <template #append-inner>
        <v-btn
          color="primary"
          size="small"
          variant="flat"
          :loading="isRunning"
          :disabled="!canExtract"
          @click="emit('extract', node.id)"
        >
          {{ node.config.current ? '重新提取' : '提取' }}
        </v-btn>
      </template>
    </v-text-field>
    <div class="text-body-small text-disabled mt-1">
      0=首帧、1=第二帧、-1=尾帧、-2=倒数第二帧，以此类推
    </div>

    <!-- 当前结果 -->
    <div
      v-if="currentImage"
      class="mt-3"
    >
      <div class="text-body-small text-medium-emphasis mb-1">
        当前结果
      </div>
      <v-img
        :src="currentImage"
        contain
        max-height="120"
        class="extract-frame-editor__result"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { buildPreviewUrl } from '../../../canvas/preview'
import { getVideoInfo } from '../../../canvas/api'

/**
 * 获取视频帧节点配置组件。
 *
 * 展示输入视频预览、帧索引设置（0=首帧、1=第二帧、-1=尾帧…）与手动「提取」按钮；
 * 预览视频下方提供「提取当前帧」按钮（按预览当前播放位置记录时间点并立即提取，免手工定位；
 * 服务端按时间精确选帧，拖拽进度条后也与画面一致）；
 * 提取动作由父级（AssetCanvas）调用服务端 ffmpeg 接口并回写 current/history。
 *
 * 预览 URL 按输入路径缓存（同一路径保持稳定，避免编辑器每次渲染——如修改帧索引——刷新视频）。
 */
const props = defineProps<{
  /** 项目名（用于资产预览 URL） */
  project: string
  /** 当前节点数据（config 为持久化配置） */
  node: CanvasNodeData
  /** 全部输入（构建预览 URL 用，含来源节点） */
  inputs: CanvasInputInfo[]
  /** 节点是否正在提取（显示加载态与禁用按钮） */
  isRunning: boolean
  /** 画布类型（父级统一传入，本组件暂不使用） */
  kind: CanvasKind
}>()

/**
 * 组件事件：
 * - update:config：配置补丁（帧索引等直接写回节点 config）
 * - extract：触发帧提取（参数为节点 id）
 * - open-history / generate / interrupt / set-as-scene / open-picker：父级（AssetCanvas）统一传入的监听，
 *   本组件暂不使用（本节点已移除历史功能），但需显式声明（避免「Extraneous non-emits event listeners」警告）
 */
const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'extract', nodeId: string): void
  (e: 'open-history', nodeId: string): void
  (e: 'generate', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'set-as-scene', nodeId: string): void
  (e: 'open-picker', nodeId: string): void
}>()

/** 输入视频（本节点输入端口为 video 类型，取第一个有资产的输入） */
const videoInput = computed<CanvasInputInfo | null>(() => props.inputs[0] ?? null)

/** 输入视频元素引用（读取当前播放位置） */
const videoRef = ref<HTMLVideoElement | null>(null)

/** 输入视频预览 URL：按路径缓存，同一路径保持稳定 URL（避免每次渲染刷新导致视频重载） */
const videoUrl = ref('')

/** 已缓存 URL 对应的输入视频路径（路径变化时才重建 URL） */
let cachedVideoPath = ''

/** 视频帧率（服务端 ffprobe；仅用于「提取当前帧」后回显近似的帧索引） */
const videoFps = ref(0)

/**
 * 输入视频路径变化：重建预览 URL（换源刷新）并拉取帧率。
 */
watch(
  () => videoInput.value?.path ?? '',
  (p) => {
    videoFps.value = 0
    if (!p) {
      cachedVideoPath = ''
      videoUrl.value = ''
      return
    }
    // URL 按路径缓存：同一路径保持稳定，避免编辑器每次渲染（如改帧索引）刷新视频
    if (p !== cachedVideoPath) {
      cachedVideoPath = p
      videoUrl.value = buildPreviewUrl(props.project, p)
    }
    // 拉取帧率：仅用于「提取当前帧」后回显近似帧索引（精确提取按时间走服务端）
    void getVideoInfo(props.project, p)
      .then((info) => {
        // 路径可能已切换，旧结果作废
        if (videoInput.value?.path !== p) return
        videoFps.value = info.fps || 0
      })
      .catch(() => {
        // 帧率不可用时不回显近似帧索引（不影响按时间提取）
      })
  },
  { immediate: true },
)

/** 是否可「提取当前帧」：有视频输入且不在运行中（按当前播放时间提取，无需帧率） */
const canExtractCurrentFrame = computed(() => !!videoInput.value && !props.isRunning)

/**
 * 「提取当前帧」：把预览当前播放时间写入 config.frameTime 并立即提取。
 *
 * 服务端按时间点精确选帧（ffmpeg -ss，按呈现时间定位，与预览画面一致）；
 * 拖拽进度条后 currentTime 即画面所在时间，比帧索引换算更可靠。
 * 先 update:config（同步回写节点），再 emit extract 让父级执行 ffmpeg。
 */
function onExtractCurrentFrame() {
  const el = videoRef.value
  if (!el || !videoInput.value) return
  const time = el.currentTime
  if (!Number.isFinite(time)) return
  const patch: Record<string, unknown> = { frameTime: time }
  if (videoFps.value > 0) {
    // 展示用近似帧索引（精确提取按时间走服务端）
    patch.frameIndex = Math.max(0, Math.round(time * videoFps.value))
  }
  emit('update:config', patch)
  emit('extract', props.node.id)
}

/** 当前帧索引（config.frameIndex；非法值回退 0） */
const frameIndex = computed(() => {
  const v = props.node.config.frameIndex
  return typeof v === 'number' && Number.isInteger(v) ? v : 0
})

/** 当前提取结果图片 URL（config.current.path） */
const currentImage = computed(() => {
  const cur = props.node.config.current as { path?: string; version?: number } | undefined
  return cur?.path ? buildPreviewUrl(props.project, cur.path, cur.version) : ''
})

/** 是否可触发提取：有视频输入且不在运行中 */
const canExtract = computed(() => !!videoInput.value && !props.isRunning)

/**
 * 帧索引输入变化：整数直接写回 config.frameIndex，非法值回退 0。
 *
 * @param v 输入框值（数字字符串或空串）
 */
function onFrameIndexChange(v: unknown) {
  const n = v === '' || v === null || v === undefined ? 0 : Number(v)
  const value = Number.isInteger(n) ? n : 0
  // 手工指定帧索引后清除 frameTime（改回按帧索引提取）
  emit('update:config', { frameIndex: value, frameTime: undefined })
}
</script>

<style scoped>
.extract-frame-editor__video {
  width: 100%;
  max-height: 160px;
  border-radius: 4px;
  background: #000;
}

.extract-frame-editor__empty {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border: 1px dashed rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.extract-frame-editor__video-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}

.extract-frame-editor__video-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extract-frame-editor__result {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
}
</style>
