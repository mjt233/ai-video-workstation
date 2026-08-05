<template>
  <div class="video-generate-editor">
    <!-- 工作流选择（仅视频类工作流） -->
    <v-select
      :model-value="workflowId"
      :items="workflowItems"
      item-title="label"
      item-value="id"
      label="工作流"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="onWorkflowChange"
    />

    <!-- 模式切换（所选实现声明多种模式时显示） -->
    <v-select
      v-if="currentModes.length > 1"
      :model-value="mode"
      :items="modeItems"
      item-title="label"
      item-value="value"
      label="生成模式"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="onModeChange"
    />

    <!-- 导演台 / 首尾帧模式：嵌入导演台 -->
    <template v-if="mode === 'director' || mode === 'first-last-frame'">
      <VideoDirector
        :project="props.project"
        :director="directorProject"
        :prompt="prompt"
        :read-only="false"
        :allow-add-asset="false"
        :standalone="true"
        @update:director="onDirectorUpdate"
        @update:prompt="onPromptUpdate"
      />
    </template>

    <!-- 参考模式：分组预览 + 提示词 + 规格 -->
    <template v-else>
      <VideoRefInputGroup
        title="图片"
        prefix="图"
        :inputs="imagesInputs"
        :max="refImageMax"
        @reorder="(ids) => emit('update:config', { inputOrder: mergeInputOrder(ids) })"
      >
        <template #thumb="{ input }">
          <img
            class="canvas-input-item__thumb"
            :src="previewUrls[input.nodeId]"
            :alt="input.label"
            draggable="false"
          >
        </template>
        <template #zoom="{ input }">
          <img
            class="canvas-input-zoom"
            :src="previewUrls[input.nodeId]"
            :alt="input.label"
          >
        </template>
      </VideoRefInputGroup>

      <VideoRefInputGroup
        title="视频"
        prefix="视"
        :inputs="videosInputs"
        :max="refVideoMax"
        @reorder="(ids) => emit('update:config', { inputOrder: mergeInputOrder(ids) })"
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

      <VideoRefInputGroup
        title="音频"
        prefix="音"
        :inputs="audiosInputs"
        :max="refAudioMax"
        @reorder="(ids) => emit('update:config', { inputOrder: mergeInputOrder(ids) })"
      >
        <template #thumb="{ input }">
          <audio
            class="canvas-input-item__thumb"
            :src="previewUrls[input.nodeId]"
            controls
            draggable="false"
          />
        </template>
        <template #zoom="{ input }">
          <audio
            class="canvas-input-zoom"
            :src="previewUrls[input.nodeId]"
            controls
          />
        </template>
      </VideoRefInputGroup>

      <div
        v-if="refLimitHint"
        class="text-caption text-warning mb-2"
      >
        {{ refLimitHint }}
      </div>

      <!-- 参考模式输出规格 -->
      <div class="d-flex ga-2 mb-2">
        <v-text-field
          :model-value="String(specDuration)"
          label="时长(秒)"
          type="number"
          density="compact"
          variant="outlined"
          hide-details
          @update:model-value="(v) => emit('update:config', { duration: Number(v) || 0 })"
        />
        <v-text-field
          :model-value="String(specWidth)"
          label="宽"
          type="number"
          density="compact"
          variant="outlined"
          hide-details
          @update:model-value="(v) => emit('update:config', { resolution: { width: Number(v) || 0, height: specHeight } })"
        />
        <v-text-field
          :model-value="String(specHeight)"
          label="高"
          type="number"
          density="compact"
          variant="outlined"
          hide-details
          @update:model-value="(v) => emit('update:config', { resolution: { width: specWidth, height: Number(v) || 0 } })"
        />
      </div>
    </template>

    <!-- 提示词 -->
    <v-textarea
      :model-value="prompt"
      label="提示词 Prompt"
      rows="3"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="(v) => emit('update:config', { prompt: v })"
    />

    <!-- 生成 / 中断 / 历史 -->
    <div class="d-flex align-center ga-2">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
        :disabled="!canGenerate"
        @click="emit('generate', node.id)"
      >
        {{ node.config.current ? '重新生成' : '生成' }}
      </v-btn>
      <v-btn
        v-if="isRunning"
        size="small"
        variant="tonal"
        @click="emit('interrupt', node.id)"
      >
        中断
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
import { computed, ref, watch } from 'vue'
import { getWorkflows, type WorkflowInfo } from '../../../api/workflow'
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { buildPreviewUrl } from '../../../canvas/preview'
import { canvasDirectorToProject, projectToCanvasDirector } from '../../../canvas/videoDirectorBridge'
import type { CanvasDirectorConfig, VideoGenerateMode } from '../../../canvas/videoTypes'
import VideoDirector from '../../video-director/VideoDirector.vue'
import VideoRefInputGroup from './VideoRefInputGroup.vue'

/**
 * 视频生成节点配置组件。
 *
 * 支持三种生成模式（由所选工作流实现的能力声明决定）：
 * - director / first-last-frame：嵌入 VideoDirector 导演台，编辑结果实时写回 config.director
 * - reference：参考模式，按图片/视频/音频三组展示输入并支持组内拖拽排序，
 *   可编辑输出规格（时长/宽/高）并校验参考素材数量上限
 */
const props = defineProps<{
  /** 项目名（用于资产预览 URL 与导演台素材） */
  project: string
  /** 当前节点数据（config 为持久化配置） */
  node: CanvasNodeData
  /** 全部输入（构建预览 URL 用，含来源节点） */
  inputs: CanvasInputInfo[]
  /** 图片端口（images）输入，已按 config.inputOrder 排序 */
  imagesInputs: CanvasInputInfo[]
  /** 视频端口（videos）输入，已按 config.inputOrder 排序 */
  videosInputs: CanvasInputInfo[]
  /** 音频端口（audios）输入，已按 config.inputOrder 排序 */
  audiosInputs: CanvasInputInfo[]
  /** 节点是否正在生成（显示加载态与「中断」按钮） */
  isRunning: boolean
  /** 画布类型 */
  kind: CanvasKind
}>()

/**
 * 组件事件：
 * - update:config：配置补丁（直接写回节点 config）
 * - generate：触发生成（参数为节点 id）
 * - interrupt：中断生成（参数为节点 id）
 * - open-history：打开历史对话框（参数为节点 id）
 */
const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'open-history', nodeId: string): void
}>()

/** 已加载的视频工作流列表（image-to-video 类） */
const workflows = ref<WorkflowInfo[]>([])

/** 当前选择的工作流 id（config.workflowId，缺省回退 image-to-video） */
const workflowId = computed(() => {
  const explicit = props.node.config.workflowId
  return typeof explicit === 'string' && explicit ? explicit : 'image-to-video'
})

/** 当前提示词（config.prompt） */
const prompt = computed(() => (typeof props.node.config.prompt === 'string' ? props.node.config.prompt : ''))

/** 当前生成模式（config.mode；非法值回退导演台） */
const mode = computed<VideoGenerateMode>(() => {
  const m = props.node.config.mode
  if (m === 'director' || m === 'first-last-frame' || m === 'reference') return m
  return 'director'
})

/** 当前导演台配置（config.director；缺失时返回空轨配置） */
const directorConfig = computed<CanvasDirectorConfig>(() => {
  const d = props.node.config.director
  if (d && typeof d === 'object') return d as CanvasDirectorConfig
  return { duration: 0, width: 0, height: 0, fps: 0, imageClips: [], audioClips: [] }
})

/** 当前选择的工作流信息 */
const currentWorkflow = computed(() => workflows.value.find((w) => w.id === workflowId.value))

/** 当前选择的工作流实现（config.workflowImpl，缺省 default） */
const currentImpl = computed(() => {
  const impl = (props.node.config.workflowImpl as string | undefined) || 'default'
  return currentWorkflow.value?.implementations.find((i) => i.impl === impl)
})

/** 当前实现支持的生成模式列表（能力未声明 video.modes 时默认仅导演台） */
const currentModes = computed<VideoGenerateMode[]>(() => {
  const modes = currentImpl.value?.capabilities?.video?.modes
  if (Array.isArray(modes)) return modes as VideoGenerateMode[]
  return ['director']
})

/** 参考模式图片数量上限（能力未声明时不限） */
const refImageMax = computed(() => currentImpl.value?.capabilities?.video?.reference?.types?.image?.max)
/** 参考模式视频数量上限（能力未声明时不限） */
const refVideoMax = computed(() => currentImpl.value?.capabilities?.video?.reference?.types?.video?.max)
/** 参考模式音频数量上限（能力未声明时不限） */
const refAudioMax = computed(() => currentImpl.value?.capabilities?.video?.reference?.types?.audio?.max)

/** 工作流下拉选项（仅视频类工作流 image-to-video） */
const workflowItems = computed(() =>
  workflows.value
    .filter((w) => w.id === 'image-to-video')
    .map((w) => ({ id: w.id, label: w.name })),
)

/** 生成模式下拉选项（按当前实现支持的模式生成中文标签） */
const modeItems = computed(() =>
  currentModes.value.map((m) => ({
    value: m,
    label: m === 'director' ? '导演台' : m === 'first-last-frame' ? '首尾帧' : '参考',
  })),
)

/** 当前模式不在所选实现支持范围内时，回退到第一个支持的模式（工作流列表加载后触发） */
watch(
  [currentModes, mode],
  ([modes, m]) => {
    if (modes.length > 0 && !modes.includes(m)) {
      emit('update:config', { mode: modes[0] })
    }
  },
)

/**
 * 切换工作流：重置实现与参数为所选工作流的第一个实现。
 *
 * @param v 工作流 id
 */
function onWorkflowChange(v: string) {
  const wf = workflows.value.find((w) => w.id === v)
  const firstImpl = wf?.implementations[0]
  emit('update:config', {
    workflowId: v,
    workflowImpl: firstImpl?.impl,
    workflowParams: {},
  })
}

/**
 * 切换生成模式（director / first-last-frame / reference）。
 *
 * @param v 目标模式
 */
function onModeChange(v: VideoGenerateMode) {
  emit('update:config', { mode: v })
}

/** 全部输入的预览 URL（nodeId → URL；输入或项目变化时重建） */
const previewUrls = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.inputs) m[inp.nodeId] = buildPreviewUrl(props.project, inp.path)
  return m
})

// ── 导演台数据桥 ─────────────────────────────────────────────

/** sourceNodeId → 资产相对路径（config.director 转 DirectorProject 渲染用） */
const sourceToPath = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.inputs) m[inp.nodeId] = inp.path
  return m
})

/** 资产相对路径 → sourceNodeId（DirectorProject 回写 config.director 用） */
const pathToSource = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.inputs) m[inp.path] = inp.nodeId
  return m
})

/** 导演台项目数据（供 VideoDirector 渲染；素材路径由 sourceToPath 解析，缺失时为空串） */
const directorProject = computed(() =>
  canvasDirectorToProject(directorConfig.value, sourceToPath.value),
)

/**
 * 用户编辑导演台后回写 config.director（素材 path 反查 sourceNodeId）。
 *
 * @param project VideoDirector 上报的最新导演台项目数据
 */
function onDirectorUpdate(project: ReturnType<typeof canvasDirectorToProject>) {
  emit('update:config', { director: projectToCanvasDirector(project, pathToSource.value) })
}

/**
 * 导演台 prompt 文本域输入回写 config.prompt。
 *
 * @param v 最新提示词
 */
function onPromptUpdate(v: string) {
  emit('update:config', { prompt: v })
}

// ── 参考模式输入顺序（复用全局 inputOrder，按组过滤） ─────────

/** 全局输入顺序（config.inputOrder；非数组时为空列表） */
const inputOrder = computed<string[]>(() =>
  Array.isArray(props.node.config.inputOrder) ? (props.node.config.inputOrder as string[]) : [],
)

/**
 * 组内重排后合并回全局 inputOrder：保持其他组相对顺序不变，仅调整本组顺序。
 *
 * @param orderedIds 本组重排后的 nodeId 顺序
 * @returns 新的全局 inputOrder
 */
function mergeInputOrder(orderedIds: string[]): string[] {
  const groupIds = new Set(orderedIds)
  const rest = inputOrder.value.filter((id) => !groupIds.has(id))
  return [...rest, ...orderedIds]
}

/** 参考模式输出时长（秒；config.duration，缺省 5） */
const specDuration = computed(() => Number(props.node.config.duration) || 5)

/** 参考模式输出分辨率（config.resolution，缺省 1280×720） */
const specResolution = computed(() => {
  const r = props.node.config.resolution as { width?: number; height?: number } | undefined
  return { width: r?.width || 1280, height: r?.height || 720 }
})

/** 参考模式输出宽度（像素） */
const specWidth = computed(() => specResolution.value.width)
/** 参考模式输出高度（像素） */
const specHeight = computed(() => specResolution.value.height)

/** 参考模式限制提示（各类型输入超出能力上限时提示；非参考模式为空串） */
const refLimitHint = computed(() => {
  if (mode.value !== 'reference') return ''
  const parts: string[] = []
  if (refImageMax.value != null && props.imagesInputs.length > refImageMax.value) {
    parts.push(`图片最多 ${refImageMax.value} 个`)
  }
  if (refVideoMax.value != null && props.videosInputs.length > refVideoMax.value) {
    parts.push(`视频最多 ${refVideoMax.value} 个`)
  }
  if (refAudioMax.value != null && props.audiosInputs.length > refAudioMax.value) {
    parts.push(`音频最多 ${refAudioMax.value} 个`)
  }
  return parts.join('；')
})

/** 是否可触发生成：参考模式需至少一个输入且不超上限；导演台/首尾帧需有图片块 */
const canGenerate = computed(() => {
  if (mode.value === 'reference') {
    const total = props.imagesInputs.length + props.videosInputs.length + props.audiosInputs.length
    return total > 0 && !refLimitHint.value
  }
  return directorConfig.value.imageClips.length > 0
})

// 加载工作流列表（初始化一次）
getWorkflows()
  .then((list) => { workflows.value = list })
  .catch(() => { workflows.value = [] })
</script>

<style scoped>
/* 参考素材缩略样式（供 VideoRefInputGroup 插槽内容使用；插槽内容带本组件 scope，
   因此用本组件 scoped 规则即可命中缩略图/放大内容类名） */
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
</style>
