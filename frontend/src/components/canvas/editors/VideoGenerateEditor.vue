<template>
  <!-- 全屏时把整个编辑器 Teleport 到 body 顶层渲染，避免受画布/面板定位与裁剪影响 -->
  <Teleport
    to="body"
    :disabled="!isFullscreen"
  >
    <div
      :class="['video-generate-editor', { 'video-generate-editor--fullscreen': isFullscreen }]"
    >
      <!-- 导演台模式：VideoDirector 主体（含 prompt）在上，统一参数行紧随其下 -->
      <template v-if="mode === 'director'">
        <!-- 多个文本连线输入：报错并禁止生成（仅保留一个） -->
        <div
          v-if="multiTextInput"
          class="text-error text-body-small mb-2"
        >
          存在多个文本连线输入（{{ textInputCount }} 个），生成已禁用，请仅保留一个
        </div>

        <!-- 导演台（内含 prompt 输入；连线文本输入时 prompt 字段只读并显示「（已连接外部输入）」） -->
        <VideoDirector
          :project="props.project"
          :director="directorProject"
          :prompt="externalPrompt ? '（已连接外部输入）' : prompt"
          :prompt-readonly="externalPrompt"
          :read-only="false"
          :allow-add-asset="false"
          :standalone="true"
          @update:director="onDirectorUpdate"
          @update:prompt="onPromptUpdate"
        />
      </template>

      <!-- 首尾帧 / 参考模式：输入预览 → 提示词（参数行两种模式共用，见下方） -->
      <template v-else>
        <!-- 输入预览（统一组件）：图片/视频/音频按类型分组，无对应的输入不显示该组 -->
        <CanvasInputPreview
          :project="props.project"
          :images-inputs="imagesInputs"
          :videos-inputs="mode === 'reference' ? videosInputs : []"
          :audios-inputs="mode === 'reference' || audioEnabled ? audiosInputs : []"
          :images-title="mode === 'first-last-frame' ? '帧图片' : '图片'"
          :images-prefix="mode === 'first-last-frame' ? '帧' : '图'"
          :images-max="mode === 'first-last-frame' ? flfMaxFrames : refImageMax"
          :videos-max="refVideoMax"
          :audios-max="refAudioMax"
          :empty-text="mode === 'first-last-frame' ? '暂无帧图片输入' : '暂无参考素材输入'"
          @reorder="(ids) => emit('update:config', { inputOrder: mergeInputOrder(ids) })"
          @remove="onRemoveInput"
        />

        <!-- 参考模式限制提示 -->
        <div
          v-if="refLimitHint"
          class="text-body-small text-warning mb-2"
        >
          {{ refLimitHint }}
        </div>

        <!-- 多个文本连线输入：报错并禁止生成（仅保留一个） -->
        <div
          v-if="multiTextInput"
          class="text-error text-body-small mb-2"
        >
          存在多个文本连线输入（{{ textInputCount }} 个），生成已禁用，请仅保留一个
        </div>

        <!-- 提示词 Prompt（连线文本输入时禁用并显示「（已连接外部输入）」，实际使用外部文本） -->
        <v-textarea
          :model-value="externalPrompt ? '（已连接外部输入）' : prompt"
          label="提示词 Prompt"
          rows="5"
          density="compact"
          variant="outlined"
          hide-details
          :disabled="externalPrompt"
          class="mb-2"
          @update:model-value="(v) => emit('update:config', { prompt: v })"
        />
      </template>

      <!-- 统一参数行：生成模式 + 工作流 + 时长 + 输出尺寸 + 工作流参数 + 全屏（两种布局共用同一组件） -->
      <VideoGenerateParamsRow
        class="mb-2"
        :class="{ 'mt-2': mode === 'director' }"
        :mode="mode"
        :modes="currentModes"
        :workflow-impl="workflowImpl"
        :workflow-items="workflowItems"
        :workflows-loaded="workflowsLoaded"
        :impl-error="implError"
        :size-capabilities="currentImpl?.capabilities?.size"
        :duration="duration"
        :size-config="sizeConfigState"
        :declarations="currentDeclarations"
        :workflow-params="workflowParams"
        :provider="currentImpl?.providerInstanceId"
        :provider-type="currentImpl?.provider"
        :project="props.project"
        :is-fullscreen="isFullscreen"
        @update:mode="onModeChange"
        @update:workflow="onWorkflowChange"
        @update:duration="onDurationChange"
        @update:size="onSizeConfigChange"
        @update:workflow-params="onWorkflowParamsChange"
        @toggle-fullscreen="toggleFullscreen"
      />

      <!-- 生成 / 中断 / 历史 / 设为分镜视频（蓝图模式全部隐藏：蓝图不产生产物） -->
      <div
        v-if="!isBlueprint"
        class="d-flex align-center ga-2"
      >
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
        <v-btn
          size="small"
          variant="tonal"
          :loading="uploading"
          :disabled="isRunning || uploading"
          @click="pickUploadFile"
        >
          上传产物
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

      <!-- 上传产物文件选择框（隐藏；点「上传产物」触发；类型校验由服务端完成） -->
      <input
        ref="uploadInputEl"
        type="file"
        accept="video/mp4,.mp4"
        class="d-none"
        @change="onUploadFilePicked"
      >
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  getWorkflows,
  type WorkflowInfo,
  type WorkflowSizeConfig,
  type WorkflowUserParamDeclaration,
  type WorkflowUserParamValue,
} from '../../../api/workflow'
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import { mergeInputOrder as mergeGlobalInputOrder, type CanvasInputInfo } from '../../../canvas/generate'
import { canvasDirectorToProject, projectToCanvasDirector } from '../../../canvas/videoDirectorBridge'
import { readVideoSpec, VIDEO_DURATION_FALLBACK } from '../../../canvas/videoSpec'
import type {
  CanvasDirectorAudioClip,
  CanvasDirectorClips,
  CanvasDirectorImageClip,
  VideoGenerateMode,
} from '../../../canvas/videoTypes'
import { findSizeParamKeys, inferSizeConfigFromWidthHeight } from '../../../utils/workflowSize'
import VideoDirector from '../../video-director/VideoDirector.vue'
import CanvasInputPreview from './CanvasInputPreview.vue'
import VideoGenerateParamsRow from './VideoGenerateParamsRow.vue'
import { useCanvasMode } from '../../../canvas/canvasMode'
import type { CanvasUploadFilePayload } from '../composables/useCanvasUpload'

/**
 * 视频生成节点配置组件。
 *
 * 支持三种生成模式（由所选工作流实现的能力声明决定），**两种布局**：
 * - director（导演台）：`VideoDirector` 主体（时间轴素材 + prompt）在上，
 *   统一参数行紧随其下；
 * - first-last-frame / reference：输入预览（`CanvasInputPreview` 按图片/视频/音频分组）
 *   → 提示词 → 统一参数行。首尾帧按 config.inputOrder 排列帧图片（首帧 0、尾帧 1，
 *   中间均匀分布），所选实现支持音频输入（video.audio）时额外显示音频分组；
 *   参考模式按图片/视频/音频三组展示输入并支持组内拖拽排序，校验参考素材数量上限。
 *
 * 两种布局共用同一个参数行组件（`VideoGenerateParamsRow`：生成模式 + 工作流 + 时长 +
 * 输出尺寸 + 工作流参数 + 全屏），保证交互与视觉一致。
 *
 * 输出规格（时长/宽高/帧率）以 `config.duration / config.resolution / config.sizeConfig /
 * config.fps` 为唯一权威（统一经 `readVideoSpec` 读取；`config.director` 的
 * duration/width/height/fps 为遗留字段，仅作旧画布回退且不再写入），因此导演台时间轴的
 * 「总长」与其它模式的「时长」天然同源，无需任何双向同步逻辑。
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
  /** 连线文本输入内容（来源为「文本」节点；存在时 prompt 字段禁用并使用外部文本，多个时禁止生成） */
  textInputs?: string[]
  /** 节点是否正在生成（显示加载态与「中断」按钮） */
  isRunning: boolean
  /** 画布类型 */
  kind: CanvasKind
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
  /** 节点固定产物路径（由 AssetCanvas 按 scope+nodeId+扩展名推导；「上传产物」的目标路径） */
  outputPath?: string
  /** 节点是否正在上传产物（上传中按钮 loading 并禁用，防重复点击） */
  uploading?: boolean
}>()

/**
 * 组件事件：
 * - update:config：配置补丁（直接写回节点 config）
 * - generate：触发生成（参数为节点 id）
 * - interrupt：中断生成（参数为节点 id）
 * - open-history：打开历史对话框（参数为节点 id）
 * - upload-file：上传产物到固定路径 output.mp4（进度遮罩由节点卡片渲染；
 *   服务端归档旧产物后覆盖固定路径）
 * - set-as-scene / open-picker / extract / set-as-video：父级（AssetCanvas）对所有
 *   编辑器统一传入的监听，本组件暂不使用，但需显式声明（Teleport 根节点无法自动
 *   继承外部监听，避免「Extraneous non-emits event listeners」警告）
 * - disconnect-input：点击输入项右上角红色 x，请求断开该输入来源节点与本节点的连线
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
  (e: 'disconnect-input', sourceNodeId: string): void
}>()

// ── 全屏显示 ─────────────────────────────────────────────

/** 是否全屏显示（true 时整个编辑器通过 Teleport 渲染到 body 顶层覆盖整个视口） */
const isFullscreen = ref(false)

/**
 * 切换全屏显示状态：由参数行内全屏图标按钮触发。
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

/** 画布模式上下文：蓝图模式下隐藏生成/中断/上传产物/历史/设为分镜视频等执行类入口 */
const canvasMode = useCanvasMode()
/** 是否蓝图模式 */
const isBlueprint = computed(() => canvasMode.mode === 'blueprint')

/** 上传产物文件选择框 DOM（隐藏；点「上传产物」触发 click） */
const uploadInputEl = ref<HTMLInputElement | null>(null)

/** 点击「上传产物」：打开系统文件选择框 */
function pickUploadFile(): void {
  uploadInputEl.value?.click()
}

/**
 * 选择上传文件：校验节点固定产物路径可用后上抛 upload-file 事件。
 * 上传进度/失败遮罩由父级 useCanvasUpload 渲染在节点卡片上；
 * 服务端负责把旧产物归档进历史目录后再覆盖固定产物路径。
 *
 * @param event 文件输入 change 事件
 */
function onUploadFilePicked(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!props.outputPath) {
    // 理论上不会发生：生成类节点产物路径由 scope+nodeId+扩展名恒等推导
    console.error('[canvas-upload] 生成视频节点缺少产物路径，无法上传', { nodeId: props.node.id })
    return
  }
  emit('upload-file', { nodeId: props.node.id, file, dest: props.outputPath })
}

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

/** 连线文本输入内容（来源为「文本」节点；未连接时为空数组） */
const textInputs = computed<string[]>(() => props.textInputs ?? [])

/** 连线文本输入数量 */
const textInputCount = computed(() => textInputs.value.length)

/** 是否已连接文本输入（存在单个/多个：prompt 字段禁用并使用外部文本） */
const externalPrompt = computed(() => textInputCount.value > 0)

/** 是否连接了多个文本输入（报错并禁止生成，仅保留一个） */
const multiTextInput = computed(() => textInputCount.value > 1)

/** 当前生成模式（config.mode；非法值回退导演台） */
const mode = computed<VideoGenerateMode>(() => {
  const m = props.node.config.mode
  if (m === 'director' || m === 'first-last-frame' || m === 'reference') return m
  return 'director'
})

/** 节点 config.director 原对象（保留遗留规格字段，回写时原样带过；缺失时为 {}） */
const directorRaw = computed<Record<string, unknown>>(() => {
  const d = props.node.config.director
  return d && typeof d === 'object' ? (d as Record<string, unknown>) : {}
})

/** 当前导演台时间轴素材（config.director 的 imageClips/audioClips；缺失时为空轨） */
const directorClips = computed<CanvasDirectorClips>(() => ({
  imageClips: Array.isArray(directorRaw.value.imageClips)
    ? (directorRaw.value.imageClips as CanvasDirectorImageClip[])
    : [],
  audioClips: Array.isArray(directorRaw.value.audioClips)
    ? (directorRaw.value.audioClips as CanvasDirectorAudioClip[])
    : [],
}))

/** 当前输出规格（时长/宽高/帧率；统一读取，config.* 优先、director.* 仅旧画布回退） */
const videoSpec = computed(() => readVideoSpec(props.node.config))

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

/** 自定义工作流参数（key → 值；与 config.workflowParams 双向同步） */
const workflowParams = ref<Record<string, WorkflowUserParamValue>>({})

/**
 * 当前实现的自定义参数声明（剔除尺寸相关 key：本编辑器尺寸由参数行内
 * 专用 WorkflowSizePicker 处理，避免与 WorkflowParamsForm 内置尺寸组件重复展示）。
 */
const currentDeclarations = computed<WorkflowUserParamDeclaration[]>(() => {
  const params = currentImpl.value?.params ?? []
  const sizeKeys = findSizeParamKeys(params)
  if (!sizeKeys) return params
  const excluded = new Set([sizeKeys.widthKey, sizeKeys.heightKey])
  if (sizeKeys.enableKey) excluded.add(sizeKeys.enableKey)
  return params.filter((d) => !excluded.has(d.key))
})

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
 * 工作流参数变更（参数行菜单内编辑）：写入本地 ref，
 * 由下方 watch 同步进 config.workflowParams。
 *
 * @param v 最新参数值（key → 值）
 */
function onWorkflowParamsChange(v: Record<string, WorkflowUserParamValue>) {
  workflowParams.value = v
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

// ── 导演台数据桥（仅时间轴素材；输出规格由 readVideoSpec 统一读取） ─────

/** sourceNodeId → 资产相对路径（config.director 素材转 DirectorProject 渲染用） */
const sourceToPath = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.inputs) m[inp.nodeId] = inp.path
  return m
})

/** 资产相对路径 → sourceNodeId（DirectorProject 回写素材用） */
const pathToSource = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const inp of props.inputs) m[inp.path] = inp.nodeId
  return m
})

/**
 * 导演台项目数据（供 VideoDirector 渲染；素材路径由 sourceToPath 解析，缺失时为空串）。
 * 时长取统一规格（`duration` 计算属性），避免规格未设置时时间轴「总长」显示 0.0s
 * 而参数行「时长」控件显示 5s 的割裂。
 */
const directorProject = computed(() =>
  canvasDirectorToProject(directorClips.value, sourceToPath.value, {
    ...videoSpec.value,
    duration: duration.value,
  }),
)

/**
 * 用户编辑导演台后回写 config.director 素材（path 反查 sourceNodeId）。
 *
 * 只回写 imageClips/audioClips：时间轴编辑不产生输出规格变更（规格只由参数行的
 * 时长/尺寸控件修改），因此不会把陈旧的 duration/width/height 写回节点配置；
 * 遗留规格字段原样保留、不参与读取。
 *
 * @param project VideoDirector 上报的最新导演台项目数据
 */
function onDirectorUpdate(project: ReturnType<typeof canvasDirectorToProject>) {
  emit('update:config', {
    director: { ...directorRaw.value, ...projectToCanvasDirector(project, pathToSource.value) },
  })
}

/**
 * 导演台 prompt 文本域输入回写 config.prompt。
 *
 * @param v 最新提示词
 */
function onPromptUpdate(v: string) {
  emit('update:config', { prompt: v })
}

// ── 输入顺序（复用全局 inputOrder，按组过滤） ─────────

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

/**
 * 点击输入项右上角红色 x：请求断开该输入来源节点与本节点的连线。
 * 快捷断开不弹确认（与右键「断开连接」一致）；由父级经 store.disconnect 入撤销栈，Ctrl+Z 可恢复。
 *
 * @param input 被请求断开的输入项（含来源节点 id）
 */
function onRemoveInput(input: CanvasInputInfo): void {
  emit('disconnect-input', input.nodeId)
}

/** 当前输出时长（秒；统一规格，未设置时回退 5；三种模式同源） */
const duration = computed(() => videoSpec.value.duration || VIDEO_DURATION_FALLBACK)

/** 当前输出尺寸（统一规格读取；未设置时宽高为 0，对应 WorkflowSizePicker「不指定」） */
const currentResolution = computed(() => ({ width: videoSpec.value.width, height: videoSpec.value.height }))

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
 * - 同步写 config.resolution（后端 resolution 链路兼容）；
 * - 「自动 / 自动」→ 宽高清 0（提交时回退默认尺寸）。
 *
 * 三种模式共用同一份规格字段（config.director 的遗留宽高不再写入）。
 *
 * @param v 组件输出的统一尺寸配置（ratio/size + 可选 width/height）
 */
function onSizeConfigChange(v: WorkflowSizeConfig) {
  const w = Number(v.width)
  const h = Number(v.height)
  const has = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
  emit('update:config', {
    sizeConfig: {
      ratio: v.ratio,
      size: v.size,
      ...(has ? { width: w, height: h } : {}),
    },
    resolution: has ? { width: w, height: h } : { width: 0, height: 0 },
  })
}

/**
 * 输出时长变化（统一写入 config.duration，三种模式同源）。
 *
 * @param v 新时长（秒；菜单控件保证为合法正数）
 */
function onDurationChange(v: number) {
  const value = Number.isFinite(v) ? v : 0
  emit('update:config', { duration: value })
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

/** 是否可触发生成：多个文本连线输入禁止生成；导演台需有图片块；首尾帧需有帧图片；参考需至少一个输入且不超上限 */
const canGenerate = computed(() => {
  if (multiTextInput.value) return false
  if (mode.value === 'director') {
    return directorClips.value.imageClips.length > 0
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
</style>
