<template>
  <div class="input-preview-node nodrag nowheel">
    <!-- 来源行：显示被观察的上游节点名 + 输入数量 + 用法说明问号 -->
    <div class="input-preview-node__source">
      <v-icon
        icon="mdi-arrow-left-top"
        size="x-small"
        class="input-preview-node__source-icon"
      />
      <span
        class="input-preview-node__source-text"
        :title="sourceTitle"
      >
        {{ sourceText }}
      </span>
      <!-- 用法说明：悬浮显示气泡，澄清「展示的是上游节点的输入，而非本节点自身的输入」 -->
      <v-icon
        :id="helpIconId"
        icon="mdi-help-circle-outline"
        size="x-small"
        class="input-preview-node__help"
      />
      <v-tooltip
        :activator="`#${helpIconId}`"
        location="top"
        max-width="300"
      >
        <div class="input-preview-node__help-body">
          本节点用于观察上游节点的输入：展示的是连到本节点的那一个上游节点自身的全部连线输入（图片/视频/音频/文本），
          不是本节点自己的输入内容。上游节点内容变化时，此处预览会同步刷新。
        </div>
      </v-tooltip>
    </div>

    <!-- 媒体输入预览（统一组件，复用生成图片/生成视频节点的实现；只读，不监听排序/断开） -->
    <div
      v-if="hasMedia"
      class="input-preview-node__media"
    >
      <CanvasInputPreview
        :project="project"
        :images-inputs="mediaByType.images"
        :videos-inputs="mediaByType.videos"
        :audios-inputs="mediaByType.audios"
        :empty-text="''"
      />
    </div>

    <!-- 文本输入（来源节点自身连接的「文本」/「AI文本生成」节点内容）：只读文本块 -->
    <div
      v-if="texts.length > 0"
      class="input-preview-node__texts"
    >
      <div
        v-for="(t, i) in texts"
        :key="i"
        class="input-preview-node__text-item"
      >
        <div class="input-preview-node__text-title">
          文本输入 {{ i + 1 }}
          <span class="text-grey">· {{ t.length }} 字</span>
        </div>
        <div class="input-preview-node__text-body">
          {{ t }}
        </div>
      </div>
    </div>

    <!-- 占位提示：未连接上游节点 / 已连接但上游节点没有输入 -->
    <div
      v-if="!hasAny"
      class="input-preview-node__empty"
    >
      {{ emptyText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import type { LlmMediaInputItem } from '../composables/useCanvasNodeOps'
import CanvasInputPreview from '../editors/CanvasInputPreview.vue'

/**
 * 输入预览节点主体：观察上游（被连接的那一个）节点的全部连线输入。
 *
 * 语义澄清（节点内问号气泡同文案）：展示的是**上游节点自身的输入**，
 * 而非本节点自己的输入——本节点只有一个输入口，连上某个来源节点后，
 * 穿透一层把该来源节点连接的媒体（图片/视频/音频）与文本输入一并预览。
 *
 * 媒体部分复用统一输入预览组件 `CanvasInputPreview`（与生成图片/生成视频/AI文本生成
 * 节点完全同一套 UI 与预览缓存策略）；文本部分因该组件不渲染文本，单独以只读文本块呈现
 * （「文本」节点读 config.text、「AI文本生成」节点读 config.output，由父级
 * `previewInputsOf` 经 collectTextContents 收集）。
 *
 * 本节点为纯展示节点（无输出端口、无生成能力、无配置面板），预览只读：
 * 不做组内拖拽排序与悬浮断开——这两个动作的语义属于来源节点自身的
 * config.inputOrder 与连线，应在来源节点上操作，避免改写错误对象。
 */
const props = defineProps<{
  /** 项目名（构建资产预览 URL） */
  project: string
  /** 当前节点数据（本预览节点自身） */
  node: CanvasNodeData
  /** 上游来源节点的媒体输入（图片/视频/音频，已带产物 mtime 版本号作预览缓存键） */
  inputs?: LlmMediaInputItem[]
  /** 上游来源节点的文本输入内容（空白内容不收集） */
  textInputs?: string[]
  /** 上游来源节点名称（未连接时由父级传空串/undefined） */
  sourceLabel?: string
  /** 上游来源节点的输入总数（媒体 + 文本；未连接时 undefined） */
  sourceInputCount?: number
}>()

/** 稳定的问号图标 id（同一节点内唯一；v-tooltip 以选择器方式绑定 activator） */
const helpIconId = computed(() => `input-preview-help-${props.node.id}`)

/** 是否已连接上游节点（父级传入来源名即视为已连接） */
const connected = computed(() => !!props.sourceLabel)

/** 媒体输入按类型分组（供 CanvasInputPreview 使用） */
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

/** 是否存在媒体输入 */
const hasMedia = computed(() => (props.inputs?.length ?? 0) > 0)

/** 文本输入内容（只读展示；空数组不渲染文本区） */
const texts = computed<string[]>(() => props.textInputs ?? [])

/** 是否存在任何可预览输入（媒体或文本） */
const hasAny = computed(() => hasMedia.value || texts.value.length > 0)

/** 来源行文案（未连接 / 已连接 + 输入数量） */
const sourceText = computed(() => {
  if (!connected.value) return '未连接上游节点'
  const n = props.sourceInputCount ?? 0
  return `上游：${props.sourceLabel}（${n} 个输入）`
})

/** 来源行悬浮提示（长节点名截断后仍可看到全名） */
const sourceTitle = computed(() =>
  connected.value ? `被观察的上游节点：${props.sourceLabel}` : '请把某个节点的输出连到本节点的输入口',
)

/** 占位文案：区分「未连接」与「已连接但上游没有输入」 */
const emptyText = computed(() =>
  connected.value ? '上游节点暂无连线输入' : '未连接上游节点，请连接一个节点以预览其输入',
)
</script>

<style scoped>
/* 节点整体：纵向排布。
   高度策略：**内容按需增高、由节点整体滚动**——不给媒体/文本分区各自设 max-height，
   否则只有媒体（无文本块）时文本区不占位，媒体区仍被压缩而出现多余滚动条。
   `nowheel` 使滚轮滚动本节点内容而非缩放画布（Vue Flow 约定类）。 */
.input-preview-node {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100%;
  padding: 6px;
  box-sizing: border-box;
  overflow-y: auto;
}

/* 来源行：图标 + 上游节点名（省略）+ 问号说明 */
.input-preview-node__source {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 4px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.6);
  background: rgba(0, 0, 0, 0.04);
  border-radius: 3px;
}

.input-preview-node__source-icon {
  flex: 0 0 auto;
  color: rgba(0, 0, 0, 0.45);
}

.input-preview-node__source-text {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 问号说明图标：悬浮弹气泡（指针样式提示可交互） */
.input-preview-node__help {
  flex: 0 0 auto;
  color: rgba(0, 0, 0, 0.45);
  cursor: help;
}

.input-preview-node__help-body {
  font-size: 12px;
  line-height: 1.5;
}

/* 媒体预览区：按内容自然高度（不参与拉伸/收缩，避免被压缩出滚动条） */
.input-preview-node__media {
  flex: 0 0 auto;
}

/* 文本输入区：按内容自然高度；多条文本时由节点整体滚动 */
.input-preview-node__texts {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-preview-node__text-item {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  overflow: hidden;
}

.input-preview-node__text-title {
  padding: 2px 6px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.6);
  background: rgba(0, 0, 0, 0.04);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

/* 只读文本内容：保留换行、长词换行；单块限高，超长文本块内滚动（由节点整体滚动兜底） */
.input-preview-node__text-body {
  padding: 4px 6px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.87);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}

/* 占位提示（未连接 / 上游无输入）：居中弱化显示 */
.input-preview-node__empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  text-align: center;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.4);
}
</style>
