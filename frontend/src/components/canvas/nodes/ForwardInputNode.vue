<template>
  <div class="forward-node nodrag nowheel">
    <!-- 头部行：转发类型徽标（= 下游看到的实际输出类型）+ 用法说明问号 -->
    <div class="forward-node__header">
      <v-icon
        icon="mdi-swap-horizontal"
        size="x-small"
        class="forward-node__header-icon"
      />
      <span class="forward-node__header-label">转发</span>
      <span
        class="forward-node__badge"
        :class="`forward-node__badge--${badgeKind}`"
      >
        {{ outputLabel }}
      </span>
      <v-icon
        :id="helpIconId"
        icon="mdi-help-circle-outline"
        size="x-small"
        class="forward-node__help"
      />
      <v-tooltip
        :activator="`#${helpIconId}`"
        location="top"
        max-width="300"
      >
        <div class="forward-node__help-body">
          本节点把接入的输入「原样向下游输出」：收到什么就输出什么，不加工、不复制、不落盘，自身也没有产物文件。
          上游产物更新时下游自动取到新内容。输出类型随上游来源实时解析（徽标即下游看到的类型）：
          未接入输入时为「任意类型」（下游可自由连线），接入后收敛为实际类型（多种媒体混合时为「任意媒体」，
          此时只接受特定类型输入的下游会被拒绝）。图片/视频/音频可在分组内拖拽调整转发顺序，
          悬浮缩略图右上角 ⨯ 可断开该输入。
        </div>
      </v-tooltip>
    </div>

    <!-- 媒体输入预览：统一组件（图片/视频/音频分组；支持组内拖拽排序与悬浮断开） -->
    <CanvasInputPreview
      :project="project"
      :images-inputs="mediaByType.images"
      :videos-inputs="mediaByType.videos"
      :audios-inputs="mediaByType.audios"
      :empty-text="''"
      @reorder="onReorder"
      @remove="(input) => emit('disconnect-input', input.nodeId)"
    />

    <!-- 文本输入（「文本」/「AI文本生成」节点内容）：只读文本块，可在下游作为外部提示词 -->
    <div
      v-if="texts.length > 0"
      class="forward-node__texts"
    >
      <div
        v-for="(t, i) in texts"
        :key="i"
        class="forward-node__text-item"
      >
        <div class="forward-node__text-title">
          文本输入 {{ i + 1 }}
          <span class="text-grey">· {{ t.length }} 字</span>
        </div>
        <div class="forward-node__text-body">
          {{ t }}
        </div>
      </div>
    </div>

    <!-- 多文本告警：下游生成类节点只接受 1 个文本来源（本节点保持「原样转发」，不做拦截） -->
    <div
      v-if="texts.length > 1"
      class="forward-node__warn"
    >
      已接入 {{ texts.length }} 个文本输入：下游生成节点只接受 1 个文本来源，请只保留一个
    </div>

    <!-- 排序/断开提示：仅在有媒体输入时显示（无输入时的空态已包含操作说明） -->
    <div
      v-if="mediaCount > 0"
      class="forward-node__hint"
    >
      分组内可拖拽调整转发顺序，悬浮缩略图右上角 ⨯ 可断开输入
    </div>

    <!-- 空态：未接入任何输入 -->
    <div
      v-if="!hasAny"
      class="forward-node__empty"
    >
      未接入输入：把媒体或文本连到左侧输入口，本节点即原样转发（可按分组拖拽调整顺序）
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasNodeData, PortType } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { mergeInputOrder } from '../../../canvas/generate'
import type { LlmMediaInputItem } from '../composables/useCanvasNodeOps'
import CanvasInputPreview from '../editors/CanvasInputPreview.vue'

/**
 * 输入转发节点主体：**收到什么输入就输出什么**（不加工、不复制、不落盘）。
 *
 * 数据流语义（由 `NodePrototype.passThrough` 驱动，本组件只负责展示与操作）：
 * - 输出资产 = 上游来源资产（`generate.getNodeCurrentAssetPath` 穿透整条转发链），
 *   下游 `collectInputs` 拿到的条目 nodeId/path 都指向**最终上游节点**；
 * - 输出类型 = 上游来源类型（`connection.getEffectiveOutputType` 实时解析），
 *   由父级经 `outputType` prop 下发，仅用于此处徽标展示；
 * - 文本同样透传（下游作为外部提示词取值）。
 *
 * 交互（全部在本组件内，本节点无配置面板）：
 * - 媒体分组复用统一输入预览组件 `CanvasInputPreview`：组内拖拽排序 → `reorder` 经
 *   `mergeInputOrder` 合并回 `config.inputOrder`（只影响本组相对顺序）后 `update:config` 提交
 *   （单次撤销）；悬浮缩略图右上角 ⨯ → 上抛 `disconnect-input` 由父级断线；
 * - 文本只读展示（该组件不渲染文本），因而不参与排序；文本 ≥ 2 时给出橙色告警
 *   （下游生成节点只接受单个文本来源，本节点保持「原样转发」语义不做拦截）。
 *
 * 根元素带 `nodrag nowheel`：预览区内的 HTML5 拖拽排序/滚动不得触发 Vue Flow 的
 * 节点拖拽与画布滚轮缩放（AGENTS.md 约定）。渲染布局：各分区按内容自然高度、
 * 内容超出节点高度时由节点整体滚动。
 */
const props = defineProps<{
  /** 项目名（构建资产预览 URL） */
  project: string
  /** 当前节点数据（本转发节点自身） */
  node: CanvasNodeData
  /** 本节点接入的媒体输入（图片/视频/音频，已带来源产物 mtime 作预览缓存键） */
  inputs?: LlmMediaInputItem[]
  /** 本节点接入的文本输入内容（「文本」/「AI文本生成」节点，空白内容不收集） */
  textInputs?: string[]
  /** 本节点解析出的实际输出类型（未接输入时为原型占位声明 'media'） */
  outputType?: PortType
}>()

/**
 * 组件事件：
 * - update:config：写回本节点配置（媒体输入排序 → config.inputOrder）
 * - disconnect-input：请求断开某个输入来源连线（悬浮缩略图右上角红色 x）
 */
const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'disconnect-input', sourceNodeId: string): void
}>()

/** 稳定的问号图标 id（同一节点内唯一；v-tooltip 以选择器方式绑定 activator） */
const helpIconId = computed(() => `forward-input-help-${props.node.id}`)

/** 媒体输入按类型分组（供 CanvasInputPreview 使用；组内顺序即转发顺序） */
const mediaByType = computed<{
  images: CanvasInputInfo[]
  videos: CanvasInputInfo[]
  audios: CanvasInputInfo[]
}>(() => {
  const images: CanvasInputInfo[] = []
  const videos: CanvasInputInfo[] = []
  const audios: CanvasInputInfo[] = []
  for (const it of props.inputs ?? []) {
    const info: CanvasInputInfo = { nodeId: it.nodeId, path: it.path, label: it.label, version: it.version }
    if (it.type === 'image') images.push(info)
    else if (it.type === 'video') videos.push(info)
    else audios.push(info)
  }
  return { images, videos, audios }
})

/** 媒体输入总数（用于排序提示显隐与空态判定） */
const mediaCount = computed(() => props.inputs?.length ?? 0)

/** 文本输入内容（只读展示；空数组不渲染文本区） */
const texts = computed<string[]>(() => props.textInputs ?? [])

/** 是否存在任何输入（媒体或文本） */
const hasAny = computed(() => mediaCount.value > 0 || texts.value.length > 0)

/**
 * 输出类型徽标文案：徽标即「下游看到的类型」，与连线校验口径完全一致。
 *
 * - 空数组 = 尚未接入输入（类型待定）→「任意类型」（此时连线校验放行任意下游）；
 * - `media` = 已知是媒体但不确定哪一种（多路媒体混合 / 媒体与文本混合）→「任意媒体」；
 * - 具体类型 → 对应中文名。
 */
const outputLabel = computed(() => {
  const t = props.outputType
  if (Array.isArray(t)) return t.length === 0 ? '任意类型' : '任意媒体'
  if (t === 'image') return '图片'
  if (t === 'video') return '视频'
  if (t === 'audio') return '音频'
  if (t === 'text') return '文本'
  return '任意媒体'
})

/** 徽标配色分支：未接入输入为中性灰；media（混合/未定）为灰蓝；具体类型各自配色 */
const badgeKind = computed(() => {
  const t = props.outputType
  if (Array.isArray(t)) return t.length === 0 ? 'none' : 'media'
  return t ?? 'none'
})

/**
 * 媒体分组内拖拽排序：把本组新顺序合并回 `config.inputOrder` 后提交。
 *
 * `mergeInputOrder` 语义为「只影响本组相对顺序」（其余组顺序不变），与生成图片/
 * 生成视频/AI文本生成节点的输入排序完全一致。
 *
 * @param orderedIds 本组重排后的来源节点 id 顺序
 */
function onReorder(orderedIds: string[]): void {
  const order = Array.isArray(props.node.config.inputOrder)
    ? (props.node.config.inputOrder as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  emit('update:config', { inputOrder: mergeInputOrder(order, orderedIds) })
}
</script>

<style scoped>
/* 节点整体：纵向排布；内容超出高度时整体滚动（nowheel 使滚轮滚动内容而非缩放画布） */
.forward-node {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100%;
  padding: 6px;
  box-sizing: border-box;
  overflow-y: auto;
}

/* 头部行：图标 + 「转发」+ 类型徽标 + 问号说明 */
.forward-node__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.6);
}

.forward-node__header-icon {
  flex: 0 0 auto;
  color: rgba(0, 0, 0, 0.45);
}

.forward-node__header-label {
  flex: 0 0 auto;
}

/* 输出类型徽标（下游实际看到的类型） */
.forward-node__badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 9px;
  font-size: 10px;
  line-height: 16px;
  color: #fff;
  background: #9e9e9e;
}

/* 未接输入（占位声明）：中性灰，表示「尚未解析出具体类型」 */
.forward-node__badge--none {
  background: #9e9e9e;
}

/* 任意媒体/文本（多类型混合）：中性深灰蓝，区别于具体类型色 */
.forward-node__badge--media {
  background: #546e7a;
}

.forward-node__badge--image {
  background: #1976d2;
}

.forward-node__badge--video {
  background: #7b1fa2;
}

.forward-node__badge--audio {
  background: #00796b;
}

.forward-node__badge--text {
  background: #ef6c00;
}

.forward-node__help {
  flex: 0 0 auto;
  margin-left: auto;
  color: rgba(0, 0, 0, 0.45);
  cursor: help;
}

.forward-node__help-body {
  font-size: 12px;
  line-height: 1.5;
}

/* 文本输入区：按内容自然高度（多条文本时由节点整体滚动） */
.forward-node__texts {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.forward-node__text-item {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  overflow: hidden;
}

.forward-node__text-title {
  padding: 2px 6px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.6);
  background: rgba(0, 0, 0, 0.04);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

/* 只读文本内容：保留换行、长词换行；单块限高，超长文本块内滚动（由节点整体滚动兜底） */
.forward-node__text-body {
  padding: 4px 6px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.87);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}

/* 多文本输入告警（下游生成节点只接受 1 个文本来源） */
.forward-node__warn {
  flex: 0 0 auto;
  padding: 3px 6px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 1.4;
  color: #e65100;
  background: rgba(255, 152, 0, 0.12);
}

/* 排序/断开操作提示（灰色弱化） */
.forward-node__hint {
  flex: 0 0 auto;
  padding: 0 2px;
  font-size: 10px;
  line-height: 1.4;
  color: rgba(0, 0, 0, 0.4);
}

/* 空态：未接入任何输入（占满剩余高度居中） */
.forward-node__empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.4);
}
</style>
