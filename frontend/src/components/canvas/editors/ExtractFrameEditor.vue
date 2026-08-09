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
        :src="videoUrl"
        controls
        muted
        class="extract-frame-editor__video"
      />
      <div class="text-body-small text-medium-emphasis mt-1">
        {{ videoInput.label }}
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

    <!-- 帧索引 -->
    <v-text-field
      :model-value="String(frameIndex)"
      label="帧索引"
      type="number"
      density="compact"
      variant="outlined"
      hide-details
      class="mt-3"
      @update:model-value="onFrameIndexChange"
    />
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

    <!-- 提取 / 历史 -->
    <div class="d-flex align-center ga-2 mt-3">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
        :disabled="!canExtract"
        @click="emit('extract', node.id)"
      >
        {{ node.config.current ? '重新提取' : '提取' }}
      </v-btn>
      <v-spacer />
      <v-btn
        v-if="node.config.current"
        size="small"
        variant="text"
        @click="emit('open-history', node.id)"
      >
        历史
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { buildPreviewUrl } from '../../../canvas/preview'

/**
 * 获取视频帧节点配置组件。
 *
 * 展示输入视频预览、帧索引设置（0=首帧、1=第二帧、-1=尾帧…）与手动「提取」按钮；
 * 提取动作由父级（AssetCanvas）调用服务端 ffmpeg 接口并回写 current/history。
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
 * - open-history：打开历史对话框（参数为节点 id）
 * - generate / interrupt / set-as-scene / open-picker：父级（AssetCanvas）统一传入的监听，
 *   本组件暂不使用，但需显式声明（避免「Extraneous non-emits event listeners」警告）
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

/** 输入视频预览 URL */
const videoUrl = computed(() => (videoInput.value ? buildPreviewUrl(props.project, videoInput.value.path) : ''))

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
  emit('update:config', { frameIndex: value })
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

.extract-frame-editor__result {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
}
</style>
