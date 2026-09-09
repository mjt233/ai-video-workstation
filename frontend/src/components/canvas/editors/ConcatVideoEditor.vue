<template>
  <div class="concat-video-editor">
    <div class="text-body-small text-medium-emphasis mb-1">
      拼接顺序（拖拽调整）：按顺序首尾相连
    </div>

    <!-- 视频输入分组：组内拖拽排序写 config.inputOrder -->
    <VideoRefInputGroup
      title="视频"
      prefix="视"
      :inputs="videosInputs"
      @reorder="(ids) => emit('update:config', { inputOrder: mergeInputOrder(ids) })"
      @remove="onRemoveInput"
    >
      <template #thumb="{ input }">
        <video
          class="canvas-input-item__thumb"
          :src="previewUrls[input.nodeId]"
          muted
          draggable="false"
        />
      </template>
      <template #zoom="{ input }">
        <video
          class="canvas-input-zoom"
          :src="previewUrls[input.nodeId]"
          controls
          muted
        />
      </template>
    </VideoRefInputGroup>

    <!-- 输入规格（服务端 ffprobe；copy 模式一致性预检与尺寸策略展示用） -->
    <div
      v-if="videosInputs.length > 0"
      class="concat-video-editor__specs"
    >
      <div
        v-for="inp in videosInputs"
        :key="inp.nodeId"
        class="concat-video-editor__spec"
      >
        <span class="concat-video-editor__spec-name">{{ inp.label }}</span>
        <template v-if="specOf(inp.nodeId)">
          <span class="concat-video-editor__spec-value">
            {{ specOf(inp.nodeId)!.width }}×{{ specOf(inp.nodeId)!.height }}
            · {{ specOf(inp.nodeId)!.fps.toFixed(2).replace(/\.00$/, '') }}fps
            · {{ specOf(inp.nodeId)!.codec || '未知编码' }}
            · {{ specOf(inp.nodeId)!.hasAudio ? '有音轨' : '无音轨' }}
          </span>
        </template>
        <span
          v-else
          class="concat-video-editor__spec-value text-medium-emphasis"
        >
          规格探测中…
        </span>
      </div>
    </div>

    <!-- 参数行：编码方式 / 输出尺寸 -->
    <div class="concat-video-editor__params">
      <v-select
        :model-value="mode"
        :items="modeOptions"
        item-title="title"
        item-value="value"
        label="编码方式"
        density="compact"
        variant="outlined"
        hide-details
        class="concat-video-editor__param"
        @update:model-value="(v: ConcatMode) => emit('update:config', { mode: v })"
      />
      <v-select
        :model-value="sizeMode"
        :items="sizeOptions"
        item-title="title"
        item-value="value"
        label="输出尺寸"
        density="compact"
        variant="outlined"
        hide-details
        :disabled="mode === 'copy'"
        :hint="mode === 'copy' ? '仅重编码可用' : undefined"
        persistent-hint
        class="concat-video-editor__param"
        @update:model-value="(v: ConcatSizeMode) => emit('update:config', { sizeMode: v })"
      />
    </div>

    <!-- 自定义宽高（仅重编码 + 自定义） -->
    <div
      v-if="mode === 'reencode' && sizeMode === 'custom'"
      class="concat-video-editor__params mt-1"
    >
      <v-text-field
        :model-value="String(width ?? '')"
        type="number"
        label="宽度（像素）"
        density="compact"
        variant="outlined"
        hide-details
        min="2"
        step="2"
        class="concat-video-editor__param"
        @update:model-value="(v: string) => emit('update:config', { width: toPositiveInt(v, width) })"
      />
      <v-text-field
        :model-value="String(height ?? '')"
        type="number"
        label="高度（像素）"
        density="compact"
        variant="outlined"
        hide-details
        min="2"
        step="2"
        class="concat-video-editor__param"
        @update:model-value="(v: string) => emit('update:config', { height: toPositiveInt(v, height) })"
      />
    </div>

    <!-- 自然过渡（仅重编码可用）：视频 xfade + 音频 acrossfade 交叉淡化 -->
    <div class="concat-video-editor__params mt-1">
      <v-switch
        :model-value="transition"
        label="自然过渡"
        color="primary"
        density="compact"
        :disabled="mode === 'copy'"
        :hint="mode === 'copy' ? '仅重编码可用' : undefined"
        persistent-hint
        class="concat-video-editor__transition"
        @update:model-value="(v: boolean | null) => emit('update:config', { transition: v === true })"
      />
      <v-text-field
        v-if="transition"
        :model-value="String(crossfadeDuration)"
        type="number"
        label="交叉过渡时长（秒）"
        density="compact"
        variant="outlined"
        hide-details
        min="0.1"
        max="5"
        step="0.1"
        class="concat-video-editor__param"
        @update:model-value="(v: string) => emit('update:config', { crossfadeDuration: toPositiveNum(v, crossfadeDuration) })"
      />
    </div>

    <!-- 目标尺寸提示（重编码）与 copy 预检提示 -->
    <div
      v-if="mode === 'reencode' && targetSize && sizeMode !== 'custom'"
      class="text-body-small text-medium-emphasis mt-1"
    >
      目标尺寸：{{ targetSize.width }}×{{ targetSize.height }}
      （{{ sizeMode === 'max' ? '取最大的一段' : '取最小的一段' }}，按像素面积）
    </div>
    <div
      v-if="copyMismatch"
      class="text-body-small text-error mt-1"
    >
      各段规格不一致（{{ copyMismatch }}），无法无损拼接，请改用「重编码」。
    </div>

    <!-- 拼接 / 重新拼接 -->
    <div class="d-flex align-center ga-2 mt-2">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
        :disabled="videosInputs.length < 2 || copyMismatch !== ''"
        @click="emit('generate', node.id)"
      >
        {{ hasOutput ? '重新拼接' : '拼接' }}
      </v-btn>
      <span class="text-body-small text-grey">
        至少连接 2 段视频
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
        class="concat-video-editor__result"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { mergeInputOrder as mergeGlobalInputOrder } from '../../../canvas/generate'
import { buildPreviewUrl } from '../../../canvas/preview'
import { getVideoInfo, type VideoInfo } from '../../../canvas/api'
import VideoRefInputGroup from './VideoRefInputGroup.vue'

/** 拼接编码方式 */
type ConcatMode = 'copy' | 'reencode'
/** 输出尺寸策略 */
type ConcatSizeMode = 'custom' | 'max' | 'min'

/**
 * 拼接视频节点配置组件。
 *
 * 展示全部视频输入（VideoRefInputGroup，组内拖拽排序写 config.inputOrder，顺序即拼接顺序），
 * 提供三个用户参数：
 * - **编码方式**：`copy`（无损流拷贝，各段规格须一致）/ `reencode`（重编码，允许异构规格）；
 * - **输出尺寸**（仅重编码可用）：`custom`（自定义宽高）/ `max`（按像素面积取最大段）/ `min`（取最小段）；
 * - **自然过渡**（仅重编码可用）：`transition` 开关 + `crossfadeDuration`（秒，0.1~5），相邻视频段间
 *   做视频 xfade + 音频 acrossfade 交叉淡化；copy 模式下开关禁用并提示。
 *
 * 输入规格经服务端 ffprobe 探测后展示（分辨率/帧率/编码/音轨），copy 模式下规格不一致时
 * 给出红色提示并禁用「拼接」按钮（服务端仍会兜底报错）。
 */
const props = defineProps<{
  /** 项目名（用于资产预览 URL 与规格探测） */
  project: string
  /** 当前节点数据（config 为持久化配置） */
  node: CanvasNodeData
  /** 全部输入（编辑器统一传入，本组件未直接使用） */
  inputs: CanvasInputInfo[]
  /** 视频端口输入，已按 config.inputOrder 排序 */
  videosInputs: CanvasInputInfo[]
  /** 节点是否正在拼接（显示加载态并禁用按钮） */
  isRunning: boolean
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
}>()

/**
 * 组件事件：
 * - update:config：配置补丁（直接写回节点 config）
 * - generate：触发拼接（参数为节点 id；复用父级 @generate，由 generateNode 按原型路由）
 * - disconnect-input：点击输入项右上角红色 x，请求断开该输入来源节点与本节点的连线
 */
const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'disconnect-input', sourceNodeId: string): void
}>()

/** 编码方式选项 */
const modeOptions: Array<{ title: string; value: ConcatMode }> = [
  { title: '重编码（支持异构规格）', value: 'reencode' },
  { title: 'copy（无损，规格须一致）', value: 'copy' },
]

/** 输出尺寸策略选项 */
const sizeOptions: Array<{ title: string; value: ConcatSizeMode }> = [
  { title: '取最大的一段', value: 'max' },
  { title: '取最小的一段', value: 'min' },
  { title: '自定义', value: 'custom' },
]

/** 编码方式（缺省重编码） */
const mode = computed<ConcatMode>(() => (props.node.config.mode === 'copy' ? 'copy' : 'reencode'))
/** 输出尺寸策略（缺省取最大的一段） */
const sizeMode = computed<ConcatSizeMode>(() => {
  const v = props.node.config.sizeMode
  return v === 'custom' || v === 'min' ? v : 'max'
})
/** 自定义宽度（像素） */
const width = computed(() => numberOrUndefined(props.node.config.width))
/** 自定义高度（像素） */
const height = computed(() => numberOrUndefined(props.node.config.height))
/** 是否开启自然过渡（相邻段交叉淡化；仅重编码生效，copy 模式下开关禁用并提示） */
const transition = computed<boolean>(() => props.node.config.transition === true)
/** 交叉过渡时长（秒，0.1~5，缺省 0.5） */
const crossfadeDuration = computed<number>(() => numberOrUndefined(props.node.config.crossfadeDuration) ?? 0.5)

/** 全部视频输入的预览 URL（nodeId → URL；输入或项目变化时重建） */
const previewUrls = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  // 用源视频 mtime 作缓存键：只有源资产实际变化才刷新 URL，避免配置修改等
  // 重渲染每次重建 Date.now() 缓存键导致输入视频反复重新加载（浪费带宽+闪烁）
  for (const inp of props.videosInputs) m[inp.nodeId] = buildPreviewUrl(props.project, inp.path, inp.version)
  return m
})

/** nodeId → 输入视频规格（服务端 ffprobe；探测中为空） */
const specs = ref<Record<string, VideoInfo>>({})

/**
 * 取某输入的规格。
 *
 * @param nodeId 来源节点 id
 * @returns 视频规格或 undefined（探测中/失败）
 */
function specOf(nodeId: string): VideoInfo | undefined {
  return specs.value[nodeId]
}

/**
 * 探测全部输入视频的规格（按 path + version 去重，避免重复请求）。
 */
async function probeSpecs(): Promise<void> {
  const next: Record<string, VideoInfo> = {}
  await Promise.all(
    props.videosInputs.map(async (inp) => {
      const cached = specs.value[inp.nodeId]
      try {
        const info = await getVideoInfo(props.project, inp.path)
        next[inp.nodeId] = info
      } catch (e) {
        // 探测失败不阻断编辑（仅不展示该段规格）：保留旧值便于对比，日志便于排查
        console.warn(`[concat-editor] 视频规格探测失败（${inp.path}）: ${e instanceof Error ? e.message : String(e)}`)
        if (cached) next[inp.nodeId] = cached
      }
    }),
  )
  specs.value = next
}

// 输入变化（连接/断开/换源）时重新探测规格
watch(
  () => props.videosInputs.map((i) => `${i.nodeId}:${i.path}:${i.version ?? ''}`).join('|'),
  () => void probeSpecs(),
  { immediate: true },
)

/**
 * 数值化配置字段（非有限数返回 undefined）。
 *
 * @param v 原始配置值
 * @returns 数值或 undefined
 */
function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * 输入框字符串 → 正整数（非法/空值时保留原值，避免输入过程被清空）。
 *
 * @param v 输入框值
 * @param fallback 当前配置值
 * @returns 正整数或原值
 */
function toPositiveInt(v: string, fallback: number | undefined): number | undefined {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.round(n)
}

/**
 * 输入框字符串 → 正数（秒，支持小数）：非法/空值保留原值；合法值规整到 0.1 步长并夹在 0.1~5 秒。
 *
 * @param v 输入框值
 * @param fallback 当前配置值（非法输入时保留，避免输入过程被清空）
 * @returns 0.1~5 之间的数值
 */
function toPositiveNum(v: string, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(5, Math.max(0.1, Math.round(n * 10) / 10))
}

/**
 * 按像素面积推算目标尺寸（重编码 max/min 策略）。
 *
 * @returns 目标宽高（偶数化前原值）；输入不足或探测未完成返回 null
 */
const targetSize = computed<{ width: number; height: number } | null>(() => {
  const infos = props.videosInputs.map((i) => specs.value[i.nodeId]).filter((s): s is VideoInfo => !!s)
  if (infos.length < 2) return null
  let picked = infos[0]
  for (const s of infos) {
    const area = s.width * s.height
    const pickedArea = picked.width * picked.height
    if (sizeMode.value === 'max' ? area > pickedArea : area < pickedArea) picked = s
  }
  return { width: picked.width, height: picked.height }
})

/**
 * copy 模式的规格一致性预检：返回不一致项描述（空串表示一致或无法判定）。
 */
const copyMismatch = computed<string>(() => {
  if (mode.value !== 'copy') return ''
  const infos = props.videosInputs.map((i) => specs.value[i.nodeId])
  if (infos.length < 2 || infos.some((s) => !s)) return ''
  const first = infos[0] as VideoInfo
  for (let i = 1; i < infos.length; i++) {
    const s = infos[i] as VideoInfo
    const mismatches: string[] = []
    if (s.codec !== first.codec) mismatches.push('编码')
    if (s.width !== first.width || s.height !== first.height) mismatches.push('分辨率')
    if (Math.abs(s.fps - first.fps) > 0.01) mismatches.push('帧率')
    if (s.hasAudio !== first.hasAudio) mismatches.push('音轨结构')
    if (mismatches.length > 0) return `第 ${i + 1} 段：${mismatches.join('、')}`
  }
  return ''
})

/** 节点当前是否已有拼接结果（按钮文案用；产物为固定路径文件，由服务端落盘） */
const hasOutput = computed(() => !!(props.output || props.node.config.current))

/** 当前输出视频预览 URL（优先 AssetCanvas 下发的固定路径产物，回落到 config.current 旧数据） */
const currentVideo = computed(() => {
  const out = props.output
  if (out?.path) return buildPreviewUrl(props.project, out.path, out.token)
  const cur = props.node.config.current as { path?: string; version?: number } | undefined
  return cur?.path ? buildPreviewUrl(props.project, cur.path, cur.version) : ''
})

/**
 * 组内重排后合并回全局 inputOrder（共享纯函数 generate.mergeInputOrder）。
 *
 * @param orderedIds 本组重排后的 nodeId 顺序
 * @returns 新的全局 inputOrder
 */
function mergeInputOrder(orderedIds: string[]): string[] {
  const inputOrder = Array.isArray(props.node.config.inputOrder) ? (props.node.config.inputOrder as string[]) : []
  return mergeGlobalInputOrder(inputOrder, orderedIds)
}

/**
 * 点击输入项右上角红色 x：请求断开该输入来源节点与本节点的连线。
 * 快捷断开不弹确认（与右键「断开连接」一致）；由父级经 store.disconnect 入撤销栈，Ctrl+Z 可恢复。
 *
 * @param input 被请求断开的输入项（含来源节点 id）
 */
function onRemoveInput(input: CanvasInputInfo): void {
  emit('disconnect-input', input.nodeId)
}
</script>

<style scoped>
/* 视频缩略样式（供 VideoRefInputGroup 插槽内容使用；插槽内容带本组件 scope） */
.canvas-input-item__thumb {
  width: 64px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(0, 0, 0, 0.04);
}

.canvas-input-zoom {
  max-width: 320px;
  max-height: 240px;
}

.concat-video-editor__specs {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.concat-video-editor__spec {
  display: flex;
  gap: 6px;
  font-size: 11px;
  line-height: 1.4;
}

.concat-video-editor__spec-name {
  flex: 0 0 auto;
  font-weight: 600;
}

.concat-video-editor__spec-value {
  color: rgba(0, 0, 0, 0.6);
}

.concat-video-editor__params {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.concat-video-editor__param {
  flex: 1 1 140px;
  min-width: 120px;
}

/* 自然过渡开关（与时长输入同排；copy 模式下禁用并展示 hint） */
.concat-video-editor__transition {
  flex: 0 0 auto;
  align-self: center;
}

.concat-video-editor__result {
  width: 100%;
  max-height: 180px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.04);
}
</style>
