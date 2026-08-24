<template>
  <!-- 全屏时把整个编辑器 Teleport 到 body 顶层渲染，避免受画布/面板定位与裁剪影响 -->
  <Teleport
    to="body"
    :disabled="!isFullscreen"
  >
    <div
      :class="['video-generate-editor', { 'video-generate-editor--fullscreen': isFullscreen }]"
    >
      <!-- 工作流 + 生成模式 + 全屏切换（同一行显示；全屏按钮位于组件右上角） -->
      <div class="d-flex ga-2 mb-2 align-center">
        <v-select
          :model-value="workflowImpl"
          :items="workflowItems"
          item-title="label"
          item-value="value"
          label="工作流"
          placeholder="请选择工作流实现"
          density="compact"
          variant="outlined"
          :disabled="workflowsLoaded && impls.length === 0"
          :error="!!implError"
          :error-messages="implError ? [implError] : []"
          class="flex-grow-1"
          @update:model-value="onWorkflowChange"
        >
          <!-- 下拉选项最右侧显示提供商 chip（v-bind="itemProps" 保留 title 与选中态） -->
          <template #item="{ item, props: itemProps }">
            <v-list-item v-bind="itemProps">
              <template #append>
                <v-chip
                  v-if="providerLabel(item)"
                  size="x-small"
                  label
                  variant="tonal"
                  color="secondary"
                  class="ml-1"
                >
                  {{ providerLabel(item) }}
                </v-chip>
              </template>
            </v-list-item>
          </template>
        </v-select>

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
          class="flex-grow-1"
          @update:model-value="onModeChange"
        />

        <!-- 全屏切换按钮（组件右上角；全屏时变为退出） -->
        <v-btn
          class="video-generate-editor__fullscreen-btn"
          :icon="isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'"
          size="small"
          variant="text"
          :title="isFullscreen ? '退出全屏' : '全屏显示'"
          @click="toggleFullscreen"
        />
      </div>

      <!-- 输出规格：时长 + 尺寸（统一放在生成模式下方，所有模式共用） -->
      <div class="d-flex ga-2 mb-1">
        <v-text-field
          :model-value="String(duration)"
          label="时长(秒)"
          type="number"
          min="1"
          density="compact"
          variant="outlined"
          hide-details
          style="height: 32px;max-width: 120px;"
          @update:model-value="onDurationChange"
        />

        <WorkflowSizePicker
          :size-capabilities="currentImpl?.capabilities?.size"
          :model-value="sizeConfigState"
          class="flex-grow-1"
          @update:model-value="onSizeConfigChange"
        />
      </div>

      <!-- 自定义工作流参数：所选实现声明 params 时展示（尺寸类参数已剔除，由上方 WorkflowSizePicker 处理） -->
      <WorkflowParamsForm
        v-model="workflowParams"
        :declarations="currentDeclarations"
        :provider="currentImpl?.providerInstanceId"
        :provider-type="currentImpl?.provider"
        :project="props.project"
        class="mb-2"
      />

      <!-- 导演台模式：嵌入导演台（仅导演台加载 VideoDirector，内含 prompt 输入） -->
      <template v-if="mode === 'director'">
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

      <!-- 首尾帧 / 参考模式：输入分组 + 输出规格 + 提示词 -->
      <template v-else>
        <!-- 首尾帧模式：按顺序排列帧图片（首帧 0、尾帧 1，中间均匀分布；上限由实现能力决定） -->
        <VideoRefInputGroup
          v-if="mode === 'first-last-frame'"
          title="帧图片"
          prefix="帧"
          :inputs="imagesInputs"
          :max="flfMaxFrames"
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

        <!-- 首尾帧模式：音频输入（仅所选实现支持音频输入时显示；提交时取第一条音频） -->
        <VideoRefInputGroup
          v-if="mode === 'first-last-frame' && audioEnabled"
          title="音频"
          prefix="音"
          :inputs="audiosInputs"
          @reorder="(ids) => emit('update:config', { inputOrder: mergeInputOrder(ids) })"
        >
          <template #thumb>
            <div class="canvas-input-item__audio">
              <v-icon icon="mdi-music-note" />
            </div>
          </template>
          <template #zoom="{ input }">
            <audio
              class="canvas-input-zoom"
              :src="previewUrls[input.nodeId]"
              controls
            />
          </template>
        </VideoRefInputGroup>

        <!-- 参考模式：图片 / 视频 / 音频分组预览 -->
        <template v-if="mode === 'reference'">
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
            <template #thumb>
              <div class="canvas-input-item__audio">
                <v-icon icon="mdi-music-note" />
              </div>
            </template>
            <template #zoom="{ input }">
              <audio
                class="canvas-input-zoom"
                :src="previewUrls[input.nodeId]"
                controls
              />
            </template>
          </VideoRefInputGroup>
        </template>

        <div
          v-if="refLimitHint"
          class="text-body-small text-warning mb-2"
        >
          {{ refLimitHint }}
        </div>

        <!-- 提示词（导演台模式由导演台内 prompt 输入承载） -->
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
      </template>

      <!-- 生成 / 中断 / 历史 -->
      <div class="d-flex align-center ga-2">
        <v-btn
          color="primary"
          size="small"
          :loading="isRunning"
          :disabled="!canGenerate"
          @click="requestGenerate"
        >
          {{ hasOutput ? '重新生成' : '生成' }}
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
          v-if="hasOutput"
          size="small"
          variant="text"
          @click="emit('open-history', node.id)"
        >
          历史
        </v-btn>
        <v-btn
          v-if="kind === 'scene' && hasOutput && !isRunning"
          size="small"
          variant="tonal"
          color="primary"
          @click="emit('set-as-video', node.id)"
        >
          设为分镜视频
        </v-btn>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getWorkflows, type WorkflowInfo } from '../../../api/workflow'
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { buildPreviewUrl } from '../../../canvas/preview'
import { mergeInputOrder as mergeGlobalInputOrder } from '../../../canvas/generate'
import { canvasDirectorToProject, projectToCanvasDirector } from '../../../canvas/videoDirectorBridge'
import type { CanvasDirectorConfig, VideoGenerateMode } from '../../../canvas/videoTypes'
import type { WorkflowUserParamDeclaration, WorkflowUserParamValue, WorkflowSizeConfig } from '../../../api/workflow'
import { findSizeParamKeys, inferSizeConfigFromWidthHeight } from '../../../utils/workflowSize'
import WorkflowParamsForm from '../../WorkflowParamsForm.vue'
import WorkflowSizePicker from '../../WorkflowSizePicker.vue'
import VideoDirector from '../../video-director/VideoDirector.vue'
import VideoRefInputGroup from './VideoRefInputGroup.vue'
import type { CanvasUploadFilePayload } from '../composables/useCanvasUpload'

/**
 * 视频生成节点配置组件。
 *
 * 支持三种生成模式（由所选工作流实现的能力声明决定）：
 * - director：仅此模式加载 VideoDirector 导演台（编辑结果实时写回 config.director，内含 prompt 输入）
 * - first-last-frame：按 config.inputOrder 排列帧图片（首帧 0、尾帧 1，中间均匀分布），
 *   编辑输出规格（时长/尺寸）与提示词；所选实现支持音频输入（video.audio）时额外显示
 *   音频分组（提交时取第一条音频输入）
 * - reference：参考模式，按图片/视频/音频三组展示输入并支持组内拖拽排序，
 *   可编辑输出规格（时长/尺寸）并校验参考素材数量上限
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
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
}>()

/**
 * 组件事件：
 * - update:config：配置补丁（直接写回节点 config）
 * - generate：触发生成（参数为节点 id）
 * - interrupt：中断生成（参数为节点 id）
 * - open-history：打开历史对话框（参数为节点 id）
 * - upload-file：视频生成节点无上传入口，仅随父级统一下发的监听显式声明，
 *   避免 Teleport 根节点无法自动继承外部监听产生警告（本组件不使用）
 * - set-as-scene / open-picker / extract / set-as-video：父级（AssetCanvas）对所有
 *   编辑器统一传入的监听，本组件暂不使用，但需显式声明（Teleport 根节点无法自动
 *   继承外部监听，避免「Extraneous non-emits event listeners」警告）
 */
const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'open-history', nodeId: string): void
  (e: 'set-as-scene', nodeId: string): void
  (e: 'open-picker', nodeId: string): void
  (e: 'extract', nodeId: string): void
  (e: 'set-as-video', nodeId: string): void
  (e: 'upload-file', payload: CanvasUploadFilePayload): void
}>()

// ── 全屏显示 ─────────────────────────────────────────────

/** 是否全屏显示（true 时整个编辑器通过 Teleport 渲染到 body 顶层覆盖整个视口） */
const isFullscreen = ref(false)

/**
 * 切换全屏显示状态：由组件右上角图标按钮触发。
 * 全屏时编辑器经 Teleport 移至 body，以 fixed 浮层覆盖视口（见 --fullscreen 样式）。
 */
function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

/** 全屏时锁定 body 滚动，退出/卸载时恢复（避免背景页面跟随全屏浮层滚动） */
watch(isFullscreen, (fs) => {
  document.body.style.overflow = fs ? 'hidden' : ''
})

/**
 * Esc 键退出全屏（仅在编辑器处于全屏状态时生效）。
 *
 * @param e 键盘事件
 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isFullscreen.value) {
    isFullscreen.value = false
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})

/** 已加载的视频工作流列表（image-to-video 类） */
const workflows = ref<WorkflowInfo[]>([])
/** 工作流列表是否已加载完成（区分「加载中」与「类型下没有可用实现」的校验提示） */
const workflowsLoaded = ref(false)
/** 工作流实现校验错误（未选择实现时点击生成显示，选择后清除） */
const implError = ref('')

/** 节点当前是否已有产物（生成按钮文案/历史/设为分镜视频入口用；产物为固定路径文件，由服务端落盘） */
const hasOutput = computed(() => !!(props.output || props.node.config.current))

/** 图生视频工作流类型（配置面板固定使用 image-to-video 类型） */
const imageToVideoType = computed(() => workflows.value.find((w) => w.type === 'image-to-video'))

/** 图生视频类型下的所有实现（如 LTX-2.3 / MiniMax H2V） */
const impls = computed(() => imageToVideoType.value?.implementations ?? [])

/** 当前选择的工作流实现标识（仅回显 config.workflowImpl；缺失/非法时为空，不展示虚假默认值） */
const workflowImpl = computed(() => {
  const impl = props.node.config.workflowImpl
  if (typeof impl === 'string' && impls.value.some((i) => i.impl === impl)) return impl
  return ''
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

/** 当前选择的工作流实现（未选择/找不到时为 undefined） */
const currentImpl = computed(() =>
  impls.value.find((i) => i.impl === workflowImpl.value),
)

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
/** 首尾帧模式最大帧数（能力未声明时默认 3，如 LTX 3 帧 / MiniMax H3 2 帧） */
const flfMaxFrames = computed(() => currentImpl.value?.capabilities?.video?.firstLastFrame?.maxFrames ?? 3)

/** 当前实现是否支持音频输入（video.audio；首尾帧模式据此显示音频输入分组） */
const audioEnabled = computed(() => currentImpl.value?.capabilities?.video?.audio === true)

/** 工作流下拉选项（图生视频类型下的所有实现，直接选择实现；providerName 用于选项 chip） */
const workflowItems = computed(() =>
  impls.value.map((i) => ({ value: i.impl, label: i.name, providerName: i.providerName, provider: i.provider })),
)

/**
 * 解析工作流实现条目的服务商显示名。
 *
 * 优先展示服务商实例名（providerName，来自 /api/workflows）；未提供时回退显示
 * provider 类型 ID；均缺失返回空串（下拉选项不渲染 chip）。
 *
 * @param raw 下拉原始条目（含可选 providerName / provider 字段）
 * @returns 服务商显示名；未声明时为空串
 */
function providerLabel(raw: { providerName?: string; provider?: string }): string {
  return raw?.providerName ?? raw?.provider ?? ''
}

/** 自定义工作流参数（key → 值；与 config.workflowParams 双向同步） */
const workflowParams = ref<Record<string, WorkflowUserParamValue>>({})

/**
 * 当前实现的自定义参数声明（剔除尺寸相关 key：本编辑器尺寸由上方专用 WorkflowSizePicker 处理，
 * 避免与 WorkflowParamsForm 内置的尺寸组件重复展示）。
 */
const currentDeclarations = computed<WorkflowUserParamDeclaration[]>(() => {
  const params = currentImpl.value?.params ?? []
  const sizeKeys = findSizeParamKeys(params)
  if (!sizeKeys) return params
  const excluded = new Set([sizeKeys.widthKey, sizeKeys.heightKey])
  if (sizeKeys.enableKey) excluded.add(sizeKeys.enableKey)
  return params.filter((d) => !excluded.has(d.key))
})

/** 生成模式下拉选项（按当前实现支持的模式生成中文标签） */
const modeItems = computed(() =>
  currentModes.value.map((m) => ({
    value: m,
    label: m === 'director' ? '导演台' : m === 'first-last-frame' ? '首尾帧' : '参考',
  })),
)

/**
 * 切换工作流实现：直接选择图生视频类型下的某个实现，重置工作流参数为默认。
 * 模式由「模式回退」watch 收敛到新实现支持的第一个模式。
 *
 * @param v 实现标识（impl）
 */
function onWorkflowChange(v: string) {
  implError.value = ''
  emit('update:config', { workflowImpl: v, workflowParams: {} })
}

/**
 * 点击「生成」：未选择工作流实现时展示校验错误且不触发生成，
 * 保证实际提交的实现与界面显示一致。
 */
function requestGenerate() {
  if (!workflowImpl.value) {
    implError.value = !workflowsLoaded.value
      ? '工作流列表加载中，请稍候再试'
      : impls.value.length === 0
        ? '当前工作流类型没有可用实现，请先在服务商设置中配置实例'
        : '请先选择工作流实现'
    return
  }
  implError.value = ''
  emit('generate', props.node.id)
}

// config.workflowParams → 本地（外部初始化/回显，如画布配置面板重挂载后恢复已保存参数）
watch(
  () => props.node.config.workflowParams,
  (v) => {
    if (v && typeof v === 'object') {
      workflowParams.value = { ...(v as Record<string, WorkflowUserParamValue>) }
    }
  },
  { immediate: true, deep: true },
)

// 本地 → config.workflowParams（相等性守卫：与 config 一致时不再回写，避免「本地 → emit → config → 本地」循环）
watch(
  workflowParams,
  (v) => {
    const cur = props.node.config.workflowParams
    const same = cur != null && typeof cur === 'object' && JSON.stringify(cur) === JSON.stringify(v)
    if (!same) emit('update:config', { workflowParams: v })
  },
)

/**
 * 切换生成模式（director / first-last-frame / reference）。
 *
 * @param v 目标模式
 */
function onModeChange(v: VideoGenerateMode) {
  emit('update:config', { mode: v })
}

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
 * 切入导演台模式时初始化时长：config.director.duration 为 0/缺失时，
 * 继承其它模式设定的 config.duration（>0 用其值，否则回退 5），保持导演台
 * 「总长」与「时长(秒)」输入框一致。不 immediate——节点直接以导演台模式
 * 新建/加载时只靠显示层回退，不自动写盘；用户编辑导演台后才持久化。
 */
watch(mode, (m) => {
  if (m !== 'director') return
  const dur = directorConfig.value.duration
  if (typeof dur === 'number' && dur > 0) return
  const inherit = Number(props.node.config.duration)
  const target = Number.isFinite(inherit) && inherit > 0 ? inherit : 5
  emit('update:config', { director: { ...directorConfig.value, duration: target } })
})

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

/**
 * 导演台项目数据（供 VideoDirector 渲染；素材路径由 sourceToPath 解析，缺失时为空串）。
 * 时长缺省回退 5：与「时长(秒)」输入框（同为 || 5 回退）保持一致，避免
 * config.director.duration 为 0 时导演台「总长」显示 0.0s 而输入框显示 5s 的割裂。
 */
const directorProject = computed(() =>
  canvasDirectorToProject(
    { ...directorConfig.value, duration: Number(directorConfig.value.duration) || 5 },
    sourceToPath.value,
  ),
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
 * 组内重排后合并回全局 inputOrder（共享纯函数 generate.mergeInputOrder 的薄封装，
 * 自动带入当前全局 inputOrder）。
 *
 * @param orderedIds 本组重排后的 nodeId 顺序
 * @returns 新的全局 inputOrder
 */
function mergeInputOrder(orderedIds: string[]): string[] {
  return mergeGlobalInputOrder(inputOrder.value, orderedIds)
}

/** 当前输出时长（秒）：导演台存 config.director.duration；首尾帧/参考存 config.duration，缺省 5 */
const duration = computed(() => {
  if (mode.value === 'director') return Number(directorConfig.value.duration) || 5
  return Number(props.node.config.duration) || 5
})

/**
 * 当前输出尺寸（按模式读取）：
 * - director：config.director.width/height
 * - first-last-frame / reference：config.resolution.width/height
 * 未设置时宽高为 0（对应 WorkflowSizePicker「不指定」，提交时回退默认尺寸）。
 */
const currentResolution = computed(() => {
  if (mode.value === 'director') {
    return { width: directorConfig.value.width || 0, height: directorConfig.value.height || 0 }
  }
  const r = props.node.config.resolution as { width?: number; height?: number } | undefined
  return { width: r?.width || 0, height: r?.height || 0 }
})

/**
 * 统一尺寸配置（WorkflowSizePicker 外部回显值）：
 * 优先节点已保存的 config.sizeConfig；缺省时从当前输出尺寸（宽高）反推
 * （旧节点只存了 resolution/director 宽高，无比例/尺寸概念）。
 */
const sizeConfigState = computed<WorkflowSizeConfig | null>(() => {
  const saved = props.node.config.sizeConfig as Record<string, unknown> | undefined
  if (saved && typeof saved === 'object' && typeof saved.ratio === 'string' && typeof saved.size === 'string') {
    const w = Number(saved.width)
    const h = Number(saved.height)
    return {
      ratio: saved.ratio,
      size: saved.size,
      ...(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0 ? { width: w, height: h } : {}),
    }
  }
  const { width, height } = currentResolution.value
  if (width > 0 && height > 0) {
    const inferred = inferSizeConfigFromWidthHeight(width, height)
    return {
      ratio: inferred.ratio,
      size: inferred.size,
      ...(inferred.width != null && inferred.height != null
        ? { width: inferred.width, height: inferred.height }
        : {}),
    }
  }
  return null
})

/**
 * 尺寸变化（WorkflowSizePicker 输出）回写配置：
 * - 持久化 config.sizeConfig（含比例/尺寸档与最终宽高），供视频 wire 提交给引擎；
 * - 按当前模式同步写宽高到 director.width/height 或 resolution（后端 resolution 链路兼容）；
 * - 「自动 / 自动」→ 宽高清 0（提交时回退默认尺寸）。
 *
 * @param v 组件输出的统一尺寸配置（ratio/size + 可选 width/height）
 */
function onSizeConfigChange(v: WorkflowSizeConfig) {
  const w = Number(v.width)
  const h = Number(v.height)
  const has = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
  const patch: Record<string, unknown> = {
    sizeConfig: {
      ratio: v.ratio,
      size: v.size,
      ...(has ? { width: w, height: h } : {}),
    },
  }
  if (mode.value === 'director') {
    patch.director = { ...directorConfig.value, width: has ? w : 0, height: has ? h : 0 }
  } else {
    // first-last-frame / reference
    patch.resolution = has ? { width: w, height: h } : { width: 0, height: 0 }
  }
  emit('update:config', patch)
}

/**
 * 输出时长变化，按当前模式回写：
 * - director：config.director.duration
 * - first-last-frame / reference：config.duration
 *
 * @param v 输入值（数字字符串或空串）
 */
function onDurationChange(v: unknown) {
  const n = v === '' || v === null || v === undefined ? 0 : Number(v)
  const value = Number.isFinite(n) ? n : 0
  if (mode.value === 'director') {
    emit('update:config', {
      director: { ...directorConfig.value, duration: value },
    })
  } else {
    emit('update:config', { duration: value })
  }
}

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

/** 是否可触发生成：导演台需有图片块；首尾帧需有帧图片；参考需至少一个输入且不超上限 */
const canGenerate = computed(() => {
  if (mode.value === 'director') {
    return directorConfig.value.imageClips.length > 0
  }
  if (mode.value === 'first-last-frame') {
    return props.imagesInputs.length > 0
  }
  // reference
  const total = props.imagesInputs.length + props.videosInputs.length + props.audiosInputs.length
  return total > 0 && !refLimitHint.value
})

// 加载工作流列表（初始化一次）
getWorkflows()
  .then((list) => { workflows.value = list })
  .catch(() => { workflows.value = [] })
  .finally(() => { workflowsLoaded.value = true })
</script>

<style scoped>
/* 全屏切换按钮：位于首行最右侧（组件右上角），垂直居中 */
.video-generate-editor__fullscreen-btn {
  align-self: center;
  flex: 0 0 auto;
}

/* 全屏显示：Teleport 到 body 后覆盖整个视口。
   z-index 取 1200：高于页面内容（最高 1000），低于 Vuetify 浮层（默认 2400），
   保证全屏内的下拉/菜单仍正常显示在最上层。 */
.video-generate-editor--fullscreen {
  position: fixed;
  inset: 0;
  z-index: 1200;
  padding: 16px 20px 24px;
  overflow-y: auto;
  background: rgb(var(--v-theme-surface));
}

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

/* 参考音频缩略：图标占位（悬浮时由 tooltip 提供 audio 播放器） */
.canvas-input-item__audio {
  width: 64px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(0, 0, 0, 0.04);
}

.canvas-input-zoom {
  max-width: 320px;
  max-height: 240px;
}
</style>
