<template>
  <div class="text-generate-node">
    <!-- 顶部：工作流实现回显 + 运行状态 -->
    <div class="text-generate-node__top">
      <v-icon
        icon="mdi-text-box-edit-outline"
        size="x-small"
        class="mr-1"
      />
      <span class="text-generate-node__impl">
        {{ implLabel }}
      </span>
      <v-spacer />
      <span
        v-if="active"
        class="text-generate-node__running"
      >
        <v-progress-circular
          :size="12"
          :width="2"
          indeterminate
          color="primary"
        />
        <span class="ml-1">生成中…</span>
      </span>
    </div>

    <!-- 媒体输入预览（复用统一输入预览组件；无输入时不渲染） -->
    <div
      v-if="mediaCount > 0"
      class="text-generate-node__media nodrag nowheel"
    >
      <CanvasInputPreview
        :project="project"
        :images-inputs="mediaByType.images"
        :videos-inputs="mediaByType.videos"
        :audios-inputs="mediaByType.audios"
        empty-text=""
        drag-hint="拖拽调整顺序"
        @reorder="onMediaReorder"
        @remove="(input) => emit('disconnect-input', input.nodeId)"
      />
    </div>

    <!-- 提示词（连线文本输入时以外部文本为准） -->
    <div class="text-generate-node__prompt">
      <span class="text-generate-node__label">提示词</span>
      <div
        class="text-generate-node__prompt-text"
        :class="{ 'text-generate-node__prompt-text--linked': textInputCount > 0 }"
        :title="promptText"
      >
        {{ promptText || (textInputCount > 0 ? '（已连接外部输入）' : '（未填写，可在配置面板编辑）') }}
      </div>
    </div>

    <!-- 生成结果（服务端单写者落盘 → 此处只读展示；完整内容与历史见配置面板「历史」） -->
    <div class="text-generate-node__result">
      <span class="text-generate-node__label">结果</span>
      <textarea
        class="text-generate-node__output nodrag nowheel"
        :value="outputText"
        readonly
        spellcheck="false"
        :class="{ 'text-generate-node__output--error': !outputText && !!errorMsg }"
        :placeholder="placeholder"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { mergeInputOrder as mergeGlobalInputOrder } from '../../../canvas/generate'
import { textGenerationImplLabel, IMPL_NOT_SELECTED_LABEL } from '../../../canvas/textGenerate'
import type { LlmMediaInputItem } from '../composables/useCanvasNodeOps'
import CanvasInputPreview from '../editors/CanvasInputPreview.vue'

/**
 * 【文本生成】节点主体。
 *
 * 与 AI 文本生成节点的分工：本节点走**工作流**（自定义服务商 / ComfyUI Bridge 的
 * 文本生成类型），产物是文本、**不落 assert/ 文件**（服务端把结果写进节点 config）。
 *
 * 主体只做展示与输入操作（与其他生成节点一致）：
 * - 工作流实现回显（实际配置在配置面板）；
 * - 媒体输入预览（统一组件：分组、拖拽排序、悬浮断开）；
 * - 提示词与结果只读展示（结果由服务端落盘后经 config 同步，编辑入口在配置面板）。
 */
const props = defineProps<{
  /** 项目名（构建输入预览 URL） */
  project: string
  /** 节点数据 */
  node: CanvasNodeData
  /** 媒体输入（来源节点输出类型为图片/音频/视频；单一输入口按来源类型归类） */
  inputs?: unknown[]
  /** 文本输入内容（来源为「文本」/「AI文本生成」/本类节点的输出） */
  textInputs?: string[]
  /** 是否在运行（父级按 statusByNode 下发） */
  isRunning?: boolean
  /** 运行失败原因（父级按节点状态下发；本节点无默认状态遮罩，需在主体内展示） */
  errorMsg?: string
}>()

const emit = defineEmits<{
  /** 配置补丁（媒体输入排序写回 config.inputOrder） */
  (e: 'update:config', patch: Record<string, unknown>): void
  /** 请求断开某个输入来源连线（悬浮缩略图右上角红色 x） */
  (e: 'disconnect-input', sourceNodeId: string): void
}>()

/** 节点配置（对象） */
const config = computed(() => props.node.config as Record<string, unknown>)

/** 是否运行中（父级下发的恢复态或本地状态） */
const active = computed(() => props.isRunning === true)

/** 节点配置的提示词 */
const configPrompt = computed(() =>
  typeof config.value.prompt === 'string' ? config.value.prompt : '',
)

/** 文本连线输入数量 */
const textInputCount = computed(() => props.textInputs?.length ?? 0)

/** 生效提示词（连线文本优先，与生成请求取值一致） */
const promptText = computed(() =>
  textInputCount.value > 0 ? (props.textInputs?.[0] ?? '') : configPrompt.value,
)

/** 生成结果文本（服务端写回 config.output） */
const outputText = computed(() =>
  typeof config.value.output === 'string' ? config.value.output : '',
)

/** 工作流实现展示名（未选择时给出配置提示） */
const implLabel = computed(() => textGenerationImplLabel(config.value.workflowImpl))

/** 无结果时的占位文案：失败原因优先 > 未选实现提示 > 尚未生成 */
const placeholder = computed(() => {
  if (props.errorMsg) return props.errorMsg
  return implLabel.value === IMPL_NOT_SELECTED_LABEL ? '请先在配置面板选择工作流实现' : '尚未生成'
})

/** 媒体输入总数（> 0 时渲染输入预览） */
const mediaCount = computed(() => props.inputs?.length ?? 0)

/** 媒体输入按类型分组（供 CanvasInputPreview 使用；携带 version 作预览缓存键） */
const mediaByType = computed<{ images: CanvasInputInfo[]; videos: CanvasInputInfo[]; audios: CanvasInputInfo[] }>(() => {
  const images: CanvasInputInfo[] = []
  const videos: CanvasInputInfo[] = []
  const audios: CanvasInputInfo[] = []
  // 卡片 props 为 unknown[]（节点主体泛型容器）：此处按 LlmMediaInputItem 约定收敛类型
  for (const it of (props.inputs ?? []) as LlmMediaInputItem[]) {
    const info: CanvasInputInfo = { nodeId: it.nodeId, path: it.path, label: it.label, version: it.version }
    if (it.type === 'image') images.push(info)
    else if (it.type === 'video') videos.push(info)
    else audios.push(info)
  }
  return { images, videos, audios }
})

/**
 * 媒体输入组内拖拽排序：合并回全局 config.inputOrder
 * （与生成图片/视频/AI 文本节点一致：mergeInputOrder 只影响本组相对顺序）。
 *
 * @param orderedIds 本组重排后的 nodeId 顺序
 */
function onMediaReorder(orderedIds: string[]): void {
  const cur = Array.isArray(config.value.inputOrder) ? (config.value.inputOrder as string[]) : []
  emit('update:config', { inputOrder: mergeGlobalInputOrder(cur, orderedIds) })
}
</script>

<style scoped>
.text-generate-node {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  height: 100%;
  overflow: auto;
}

/* 顶部：实现名 + 运行状态（单行省略） */
.text-generate-node__top {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
  min-height: 18px;
}

.text-generate-node__impl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text-generate-node__running {
  display: inline-flex;
  align-items: center;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}

.text-generate-node__media {
  max-height: 120px;
  overflow: auto;
}

.text-generate-node__label {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.5);
}

/* 提示词块：只读展示（最多两行，超出省略） */
.text-generate-node__prompt-text {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.8);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-all;
}

.text-generate-node__prompt-text--linked {
  color: rgba(0, 0, 0, 0.5);
}

/* 结果区：占满剩余高度（只读） */
.text-generate-node__result {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
}

.text-generate-node__output {
  flex: 1 1 0;
  min-height: 60px;
  width: 100%;
  resize: none;
  font-size: 12px;
  line-height: 1.4;
  padding: 4px 6px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.02);
  color: rgba(0, 0, 0, 0.85);
  white-space: pre-wrap;
  word-break: break-all;
}

/* 失败且无结果：占位文案即错误原因，用错误色突出 */
.text-generate-node__output--error::placeholder {
  color: rgb(var(--v-theme-error));
  opacity: 1;
}
</style>
