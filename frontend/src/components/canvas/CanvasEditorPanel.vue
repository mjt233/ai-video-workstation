<template>
  <!-- 节点配置悬浮面板：固定大小不随缩放，位置随节点/视图联动，带淡入淡出 -->
  <Transition name="editor-panel">
    <div
      v-if="visible && node"
      ref="panelEl"
      class="canvas-node-editor-panel"
      :style="panelStyle"
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
  </Transition>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { Component } from 'vue'
import type { CanvasKind, CanvasNodeData } from '../../canvas/types'
import type { CanvasInputInfo } from '../../canvas/generate'
import type { CanvasUploadFilePayload, CanvasUploadState } from './composables/useCanvasUpload'

/**
 * 节点配置悬浮面板：独立于节点渲染在其下方（空间不足时翻转/钳制），
 * 固定屏幕像素大小不随画布缩放，仅位置随节点/视图联动。
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
  /** 节点生成中标记 */
  isRunning: boolean
  /** 画布类型（生成图片编辑器用它控制「设为分镜场景图」按钮显隐） */
  kind: CanvasKind
  /** Vue Flow 视口（位置联动） */
  viewport: { x: number; y: number; zoom: number }
  /** 画布可视区宽度（边界钳制，由父级 ResizeObserver 测量） */
  flowWidth: number
  /** 画布可视区高度（边界钳制，由父级 ResizeObserver 测量） */
  flowHeight: number
}>()

const emit = defineEmits<{
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
/** 配置面板与节点底部之间的垂直间距（像素，屏幕坐标，不随缩放变化） */
const EDITOR_PANEL_GAP = 12

/** 配置面板 DOM（用于测量实际高度以做边界钳制） */
const panelEl = ref<HTMLDivElement | null>(null)
/** 配置面板最近一次定位样式（离开动画期间沿用，避免跳位） */
const lastPanelStyle = ref<Record<string, string> | null>(null)
/** 配置面板当前实际高度（像素，屏幕坐标） */
const panelHeight = ref(0)
let panelResizeObserver: ResizeObserver | null = null

/** 配置面板定位：与节点水平居中对称（节点本体位于面板上方中间）；大小固定，不随缩放变化 */
const panelStyle = computed<Record<string, string> | null>(() => {
  const node = props.node
  if (!node) return lastPanelStyle.value
  const vp = props.viewport
  const width = node.prototypeId === 'image-generate'
    ? EDITOR_PANEL_WIDTH_GENERATE
    : node.prototypeId === 'video-generate'
      ? EDITOR_PANEL_WIDTH_VIDEO
      : EDITOR_PANEL_WIDTH
  // 面板水平中心 = 节点水平中心，保证节点在面板上方正中
  const nodeCenterX = (node.x + node.width / 2) * vp.zoom + vp.x
  const left = nodeCenterX - width / 2
  const gap = EDITOR_PANEL_GAP
  const belowTop = (node.y + node.height) * vp.zoom + vp.y + gap
  // 优先放在节点下方；若底部超出可视区（且面板高度已知），则放到节点上方
  let top = belowTop
  if (panelHeight.value > 0 && belowTop + panelHeight.value > props.flowHeight) {
    const aboveTop = node.y * vp.zoom + vp.y - gap - panelHeight.value
    if (aboveTop >= 0) top = aboveTop
  }
  // 最终钳制：面板底部不超出画布可视区（必要时与节点重叠），顶部不小于留白
  if (panelHeight.value > 0 && props.flowHeight > 0) {
    top = Math.min(top, Math.max(props.flowHeight - panelHeight.value - 8, 8))
    top = Math.max(top, 8)
  }
  // 水平方向：左侧不超出画布，右侧不超出画布（按可视区钳制）
  const clampedLeft = Math.min(Math.max(left, 8), Math.max(props.flowWidth - width - 8, 8))
  return { left: `${clampedLeft}px`, top: `${top}px`, width: `${width}px` }
})

// 缓存最近一次面板定位（离开动画期间沿用，避免跳位）
watch(panelStyle, (style) => {
  if (style) lastPanelStyle.value = style
})

// 面板为条件渲染：动态监听自身尺寸用于边界钳制
watch(panelEl, (panel) => {
  panelResizeObserver?.disconnect()
  if (panel) {
    panelResizeObserver ??= new ResizeObserver(() => {
      panelHeight.value = panelEl.value?.offsetHeight ?? 0
    })
    panelResizeObserver.observe(panel)
  } else {
    panelHeight.value = 0
  }
})

onUnmounted(() => {
  panelResizeObserver?.disconnect()
  panelResizeObserver = null
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
  padding: 8px;
  box-sizing: border-box;
  max-height: 65vh;
  overflow-y: auto;
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
