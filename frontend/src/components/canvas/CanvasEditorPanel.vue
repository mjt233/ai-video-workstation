<template>
  <!-- 节点配置悬浮面板：固定大小不随缩放，位置随节点/视图联动，带淡入淡出；
       右上角 X 可关闭面板（仅隐藏，保留节点选中与关联高亮），再次点击节点重新打开 -->
  <Transition name="editor-panel">
    <div
      v-if="visible && node"
      ref="panelEl"
      class="canvas-node-editor-panel"
      :style="panelStyle"
    >
      <v-btn
        icon
        size="x-small"
        variant="text"
        class="canvas-node-editor-panel__close"
        title="关闭面板（保留节点选中）"
        aria-label="关闭配置面板"
        @click="emit('close')"
      >
        <v-icon
          icon="mdi-close"
          size="16"
        />
      </v-btn>
      <div
        class="canvas-node-editor-panel__body"
        :style="bodyStyle"
      >
        <component
          :is="editorComponent"
          :project="project"
          :node="node"
          :inputs="inputs"
          :output="output"
          :output-path="outputPath"
          :uploading="isUploading"
          :images-inputs="videoInputGroups.images"
          :videos-inputs="videoInputGroups.videos"
          :audios-inputs="videoInputGroups.audios"
          :text-inputs="textInputs"
          :is-running="isRunning"
          :kind="kind"
          @update:config="(patch: Record<string, unknown>) => emit('update:config', patch)"
          @generate="(nodeId: string) => emit('generate', nodeId)"
          @interrupt="(nodeId: string) => emit('interrupt', nodeId)"
          @open-history="(nodeId: string) => emit('open-history', nodeId)"
          @set-as-scene="(nodeId: string) => emit('set-as-scene', nodeId)"
          @open-picker="(nodeId: string) => emit('open-picker', nodeId)"
          @extract="(nodeId: string) => emit('extract', nodeId)"
          @set-as-video="(nodeId: string) => emit('set-as-video', nodeId)"
          @upload-file="(payload: CanvasUploadFilePayload) => emit('upload-file', payload)"
          @disconnect-input="(sourceNodeId: string) => emit('disconnect-input', sourceNodeId)"
        />
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { Component } from 'vue'
import type { CanvasKind, CanvasNodeData } from '../../canvas/types'
import type { CanvasInputInfo } from '../../canvas/generate'
import {
  PANEL_GAP,
  PANEL_HEADER_FALLBACK_HEIGHT,
  PANEL_VIEWPORT_MARGIN,
  computePanelPlacement,
  type PanelPlacementSide,
} from '../../canvas/panelPlacement'
import type { CanvasUploadFilePayload, CanvasUploadState } from './composables/useCanvasUpload'

/**
 * 节点配置悬浮面板：独立于节点渲染（优先正下方，空间不足时智能换向/收窄），
 * 固定屏幕像素大小不随画布缩放，仅位置随节点/视图联动。
 *
 * 定位算法见 `canvas/panelPlacement.ts`（纯几何，含单测）：保证面板**永不遮挡整个节点**——
 * 优先「完整可见且不遮挡节点（含标题条）」的位置，上下放不下时贴靠左右侧并自适应收窄宽度，
 * 极端场景收窄高度（内容区内部滚动），最终始终保证节点标题条可见。
 *
 * 组件常驻挂载（visible 为假时不渲染内容），离开动画由内部 Transition 播放；
 * 定位样式最近值缓存在 watch 中（离开淡出期间沿用，避免跳位）。
 */
const props = defineProps<{
  /** 面板可见性（选中且未被拖拽/程序化选中抑制） */
  visible: boolean
  /** 项目名（透传给编辑器组件） */
  project: string
  /** 选中节点（面板主体） */
  node: CanvasNodeData | null
  /** 编辑器组件（原型 editorComponent） */
  editorComponent: Component | null
  /** 节点输入资产信息（编辑器预览/拖拽排序） */
  inputs: CanvasInputInfo[]
  /** 节点当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
  /**
   * 节点固定产物路径（生成类节点按 scope+nodeId+扩展名推导，文件不存在也有值）。
   * 生成节点编辑器「上传产物」的目标路径；仅生成图片/视频编辑器使用。
   */
  outputPath?: string
  /**
   * 节点是否正在上传产物（由父级 useCanvasUpload 状态推导）。
   * 生成节点编辑器据此给「上传产物」按钮加 loading 并禁用（上传中防重复点击）。
   */
  uploadState?: CanvasUploadState | null
  /** 视频节点三组输入（非视频节点为空数组） */
  videoInputGroups: {
    images: CanvasInputInfo[]
    videos: CanvasInputInfo[]
    audios: CanvasInputInfo[]
  }
  /** 视频生成节点连线文本输入内容（「文本」节点；非视频节点为空数组，供 prompt 字段禁用/报错） */
  textInputs?: string[]
  /** 节点生成中标记 */
  isRunning: boolean
  /** 画布类型（生成图片编辑器用它控制「设为分镜场景图」按钮显隐） */
  kind: CanvasKind
  /** Vue Flow 视口（位置联动） */
  viewport: { x: number; y: number; zoom: number }
  /**
   * 其他节点矩形（流坐标；用于「尽量不压住其他节点」的择优，缺省为空数组）。
   * 由 AssetCanvas 传入除选中节点外的全部真实节点。
   */
  otherNodes?: CanvasNodeData[]
  /** 画布可视区宽度（边界钳制，由父级 ResizeObserver 测量） */
  flowWidth: number
  /** 画布可视区高度（边界钳制，由父级 ResizeObserver 测量） */
  flowHeight: number
}>()

const emit = defineEmits<{
  /** 用户点击右上角 X（或 Esc）关闭面板：仅隐藏面板、保留节点选中与关联高亮 */
  (e: 'close'): void
  /** 编辑器配置补丁（合并写入节点 config） */
  (e: 'update:config', patch: Record<string, unknown>): void
  /** 触发生成 */
  (e: 'generate', nodeId: string): void
  /** 中断生成 */
  (e: 'interrupt', nodeId: string): void
  /** 打开版本历史 */
  (e: 'open-history', nodeId: string): void
  /** 设为分镜场景图 */
  (e: 'set-as-scene', nodeId: string): void
  /** 打开资产选择器 */
  (e: 'open-picker', nodeId: string): void
  /** 提取视频帧 */
  (e: 'extract', nodeId: string): void
  /** 设为分镜视频 */
  (e: 'set-as-video', nodeId: string): void
  /** 加载节点上传文件（进度显示在节点卡片遮罩上） */
  (e: 'upload-file', payload: CanvasUploadFilePayload): void
  /** 输入项右上角红色 x：请求断开该输入来源节点与当前节点的连线 */
  (e: 'disconnect-input', sourceNodeId: string): void
}>()

/** 节点是否正在上传产物（编辑器「上传产物」按钮 loading/禁用） */
const isUploading = computed(() => props.uploadState?.status === 'uploading')

/** 配置面板固定宽度（像素，屏幕坐标，不随缩放变化） */
const EDITOR_PANEL_WIDTH = 440
/** 生成图片节点配置面板固定宽度（更宽，屏幕坐标，不随缩放变化） */
const EDITOR_PANEL_WIDTH_GENERATE = 560
/** 生成视频节点配置面板固定宽度（导演台嵌入与参数行需要，屏幕坐标，不随缩放变化） */
const EDITOR_PANEL_WIDTH_VIDEO = 720
/** 面板内容区高度上限占视口高度的比例（与样式表 `.canvas-node-editor-panel__body` 的 65vh 保持一致） */
const EDITOR_PANEL_MAX_HEIGHT_RATIO = 0.65
/**
 * 节点标题条 DOM 选择器（模板字符串，`%s` 替换为节点 id）。
 * 与 `CanvasNodeCard.vue` 的 `.canvas-node__header` 结构耦合，仅用于测量标题条高度。
 */
const NODE_HEADER_SELECTOR = '[data-id="%s"] .canvas-node__header'

/** 配置面板 DOM（用于测量实际高度以做边界钳制） */
const panelEl = ref<HTMLDivElement | null>(null)
/** 配置面板最近一次定位样式（离开动画期间沿用，避免跳位） */
const lastPanelStyle = ref<{ nodeId: string; style: Record<string, string> } | null>(null)
/** 配置面板当前实际高度（像素，屏幕坐标） */
const panelHeight = ref(0)
/** 节点标题条高度（流坐标像素；测量失败时为兜底估算值） */
const nodeHeaderHeight = ref(PANEL_HEADER_FALLBACK_HEIGHT)
/** 上一次采用的贴靠方向（滞回：仍可行时保持不动，避免平移/缩放中来回跳位） */
const lastSide = ref<PanelPlacementSide | null>(null)
let panelResizeObserver: ResizeObserver | null = null
let headerResizeObserver: ResizeObserver | null = null
/** 自然高度测量进行中（防止测量期间临时移除 max-height 触发的 ResizeObserver 重入） */
let measuringPanel = false

/** 当前节点面板的设计宽度（普通 440 / 生成图片 560 / 生成视频 720，屏幕像素） */
const designWidth = computed(() => {
  const proto = props.node?.prototypeId
  if (proto === 'image-generate') return EDITOR_PANEL_WIDTH_GENERATE
  if (proto === 'video-generate') return EDITOR_PANEL_WIDTH_VIDEO
  return EDITOR_PANEL_WIDTH
})

/** 面板高度上限（屏幕像素，与 CSS 65vh 同源，参与可用空间判定） */
function maxPanelHeight(): number {
  return Math.max(window.innerHeight * EDITOR_PANEL_MAX_HEIGHT_RATIO, 0)
}

/**
 * 测量面板「自然高度」时使用的宽度（屏幕像素）：设计宽度与可视区可用宽度的较小值。
 *
 * **必须与贴靠方向无关**。若按面板当前渲染宽度测量，会形成反馈死循环：
 * 贴靠右侧 → 宽度收窄 → 内容换行变高 → 实测高度变大 → 判定上下放不下 → 改到上方 →
 * 恢复设计宽度 → 内容变矮 → 又判定右侧可行……面板便在节点右侧与上方之间以帧级频率闪动。
 * 按设计宽度测量后，实测高度只由内容决定，定位函数成为纯几何函数，结果稳定收敛。
 */
const measureWidth = computed(() => {
  const available = props.flowWidth > 0
    ? Math.max(props.flowWidth - PANEL_VIEWPORT_MARGIN * 2, 1)
    : Number.POSITIVE_INFINITY
  return Math.min(designWidth.value, available)
})

/**
 * 面板定位结果（纯几何计算，算法见 `canvas/panelPlacement.ts`）。
 *
 * 全部输入都与「本次采用的贴靠方向」无关（节点矩形、标题条高度、可视区尺寸、设计宽度、
 * 按设计宽度实测的自然高度、其他节点矩形），因此同一几何下重复计算得到同一结果——
 * 不会出现「定位决定宽度 → 宽度决定实测高度 → 高度决定定位」的反馈抖动。
 */
const placement = computed(() => {
  const node = props.node
  if (!node) return null
  const vp = props.viewport
  const zoom = vp.zoom > 0 ? vp.zoom : 1
  const toScreen = (rect: { x: number; y: number; width: number; height: number }) => ({
    x: rect.x * zoom + vp.x,
    y: rect.y * zoom + vp.y,
    width: rect.width * zoom,
    height: rect.height * zoom,
  })
  return computePanelPlacement({
    nodeRect: toScreen(node),
    headerHeight: nodeHeaderHeight.value,
    viewWidth: props.flowWidth,
    viewHeight: props.flowHeight,
    designWidth: designWidth.value,
    panelHeight: panelHeight.value,
    maxHeight: maxPanelHeight(),
    zoom,
    // 其他节点作为「尽量不压住」的障碍物（同级排序项，不影响可行性判定）
    obstacles: (props.otherNodes ?? []).map(toScreen),
    previousSide: lastSide.value,
  })
})

/**
 * 面板定位样式（left/top/width/max-height）。
 *
 * 位置与尺寸全部由 `computePanelPlacement` 给出：优先节点正下方，空间不足时换向、
 * 贴靠左右侧自适应收窄宽度、必要时收窄高度（内容区滚动），始终不遮挡整个节点。
 * 高度尚未测量时返回 null（面板整体透明），等测量完成后再定位；
 * 面板关闭/不可见时沿用最近一次定位样式（`lastPanelStyle`），避免淡出期间跳位。
 */
const panelStyle = computed<Record<string, string> | null>(() => {
  const result = placement.value
  if (!result) return lastPanelStyle.value?.style ?? null
  // 高度未测量：不定位（面板整体透明），等测量完成后重算（避免用乐观估计闪现错误位置）
  if (result.unmeasured) return null
  return {
    left: `${result.left}px`,
    top: `${result.top}px`,
    width: `${result.width}px`,
    maxHeight: `${result.maxHeight}px`,
  }
})

// 记录本次实际采用的贴靠方向，作为下次计算的滞回依据（同分时不改向，避免平移/缩放中来回跳位）。
// 不能写在 computed 内（eslint vue/no-side-effects-in-computed-properties）；写回同值不会触发重算。
watch(placement, (result) => {
  if (result && !result.unmeasured) lastSide.value = result.side
})

/** 面板内容区样式：宽度与高度上限跟随定位结果（贴靠时收窄，超出内部滚动） */
const bodyStyle = computed<Record<string, string>>((): Record<string, string> => {
  const style = panelStyle.value
  if (!style) return {}
  // 高度上限同时下发到内容区：面板高度 = 内容区高度，避免面板因内容变化长高后越出定位位置
  return { width: style.width, maxHeight: style.maxHeight }
})

// 缓存最近一次面板定位（离开动画期间沿用，避免跳位；缓存绑定节点 id，切换节点立即失效）
watch(panelStyle, (style) => {
  const nodeId = props.node?.id
  if (style && nodeId) lastPanelStyle.value = { nodeId, style: { ...style } }
})

// 贴靠方向滞回：面板隐藏（关闭/拖拽）时复位，下次打开按当前位置重新择优
watch(() => props.visible, (visible) => {
  if (!visible) lastSide.value = null
})

/**
 * 读取当前节点标题条高度（流坐标像素）。
 * 通过 Vue Flow 节点 wrapper 的 `data-id` 定位标题条；测不到时保持兜底估算值。
 */
function measureHeaderHeight(): void {
  const node = props.node
  if (!node) {
    nodeHeaderHeight.value = PANEL_HEADER_FALLBACK_HEIGHT
    return
  }
  const el = document.querySelector<HTMLElement>(NODE_HEADER_SELECTOR.replace('%s', node.id))
  if (!el) {
    // 节点尚未渲染（如切画布瞬间）：保留上一次测量值，等节点出现后由 watch 重测
    return
  }
  const zoom = props.viewport.zoom > 0 ? props.viewport.zoom : 1
  const height = el.getBoundingClientRect().height / zoom
  if (height > 0) nodeHeaderHeight.value = height
}

/**
 * 读取配置面板的**自然高度**（屏幕像素，不受定位下发的高度上限与宽度约束），用于判断上下空间是否足够。
 *
 * 两处临时改写都必须还原：
 * - 移除面板与内容区的内联 `max-height`——直接读 `offsetHeight` 会读到被钳制后的高度，导致
 *   「面板被压缩 → 测量值变小 → 认为空间足够 → 继续压缩」的反馈锁死（面板明明下方有空间却一直很矮）；
 * - 把面板与内容区宽度临时置为 `measureWidth`（设计宽度）——否则贴靠左右侧时面板被收窄、
 *   内容换行变高，实测高度随贴靠方向变化，与定位结果互为因果，形成帧级闪动（见 `measureWidth`）。
 *
 * 两次改写均在同一个同步任务内完成并还原，浏览器不会绘制中间态；
 * 面板尚未渲染时置 0（定位函数据此返回 `unmeasured`，面板隐藏等测量）。
 */
function measurePanelHeight(): void {
  const panel = panelEl.value
  if (!panel) {
    panelHeight.value = 0
    return
  }
  if (measuringPanel) return
  measuringPanel = true
  const body = panel.querySelector<HTMLElement>('.canvas-node-editor-panel__body')
  const prevPanelMaxHeight = panel.style.maxHeight
  const prevPanelWidth = panel.style.width
  const prevBodyMaxHeight = body?.style.maxHeight ?? ''
  const prevBodyWidth = body?.style.width ?? ''
  const width = `${measureWidth.value}px`
  panel.style.maxHeight = 'none'
  panel.style.width = width
  if (body) {
    body.style.maxHeight = 'none'
    body.style.width = width
  }
  const height = panel.offsetHeight
  panel.style.maxHeight = prevPanelMaxHeight
  panel.style.width = prevPanelWidth
  if (body) {
    body.style.maxHeight = prevBodyMaxHeight
    body.style.width = prevBodyWidth
  }
  measuringPanel = false
  panelHeight.value = height
}

// 切换选中节点：复位面板高度与贴靠方向，并在 DOM 更新后测量标题条高度 + 绑定观察目标
// （标题条重命名/字号变化会改变高度，需实时重测以正确避让）
watch(() => props.node?.id, (id) => {
  lastSide.value = null
  panelHeight.value = 0
  headerResizeObserver?.disconnect()
  if (!id) {
    nodeHeaderHeight.value = PANEL_HEADER_FALLBACK_HEIGHT
    return
  }
  void nextTick(() => {
    measureHeaderHeight()
    // 面板内容换成新节点后重新测量高度（复位为 0 期间面板隐藏，测完再定位）
    measurePanelHeight()
    const el = document.querySelector<HTMLElement>(NODE_HEADER_SELECTOR.replace('%s', id))
    if (!el) return
    headerResizeObserver ??= new ResizeObserver(() => measureHeaderHeight())
    headerResizeObserver.observe(el)
  })
}, { immediate: true, flush: 'post' })

// 面板为条件渲染：动态监听自身尺寸用于定位（内容变化 → 高度变化 → 重新定位）
watch(panelEl, (panel) => {
  panelResizeObserver?.disconnect()
  if (panel) {
    panelResizeObserver ??= new ResizeObserver(() => measurePanelHeight())
    panelResizeObserver.observe(panel)
    measurePanelHeight()
  } else {
    panelHeight.value = 0
  }
})

// 缩放变化时标题条屏幕高度随之变化：重新测量（视口平移不影响标题条高度）
watch(() => props.viewport.zoom, () => measureHeaderHeight())

onUnmounted(() => {
  panelResizeObserver?.disconnect()
  panelResizeObserver = null
  headerResizeObserver?.disconnect()
  headerResizeObserver = null
})
</script>

<style scoped>
.canvas-node-editor-panel {
  position: absolute;
  z-index: 15;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  box-sizing: border-box;
  /* 首次测量完成前的透明态淡入（换向/换节点时的位置切换同样平滑） */
  transition: opacity 0.15s ease;
}

/* 内容滚动区（原根节点样式迁移至此：面板滚动不影响右上角关闭按钮固定定位）；
   宽度由定位结果下发（贴靠节点左右侧时收窄），高度上限由面板 max-height 约束 */
.canvas-node-editor-panel__body {
  max-height: 65vh;
  overflow-y: auto;
  padding: 8px;
  padding-top: 21px;
  box-sizing: border-box;
}

/* 关闭按钮：固定在面板右上角（位于滚动内容之上） */
.canvas-node-editor-panel__close {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
  background: rgba(255, 255, 255, 0.92);
}

/* 配置面板淡入淡出：透明度 + Y 轴位移 */
.editor-panel-enter-active,
.editor-panel-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.editor-panel-enter-from,
.editor-panel-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
