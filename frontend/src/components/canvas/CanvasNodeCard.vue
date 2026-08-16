<template>
  <!-- Vue Flow 自定义节点卡片：名称头部（双击内联重命名）+ 端口 + 主体组件 + 缩放控制点 -->
  <div
    class="canvas-node"
    :class="{ 'canvas-node--selected': selected }"
    @contextmenu.prevent="emit('context-menu', $event)"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <!-- 节点名称头部（双击名称进入内联编辑） -->
    <div class="canvas-node__header">
      <span
        v-if="!renaming"
        class="text-body-small font-weight-medium canvas-node__name"
        title="双击重命名"
        @dblclick.stop="emit('start-rename', node.id)"
      >
        {{ node.name }}
      </span>
      <input
        v-else
        ref="nameInputEl"
        :value="renameValue"
        class="canvas-node__name-input"
        @click.stop
        @dblclick.stop
        @keyup.enter="emit('commit-rename', node.id)"
        @keyup.esc="emit('cancel-rename')"
        @blur="emit('commit-rename', node.id)"
        @input="onRenameInput"
      >
    </div>
    <template
      v-for="(port, idx) in proto?.inputPorts ?? []"
      :key="port.id"
    >
      <Handle
        :id="port.id"
        type="target"
        :position="Position.Left"
        class="canvas-node__handle"
        :style="handleStyle(proto?.inputPorts.length ?? 1, idx)"
      />
    </template>
    <div class="canvas-node__body">
      <component
        :is="proto?.bodyComponent"
        :project="project"
        :node="node"
        :status="status"
        :output="output"
        :upstream-updated="upstreamUpdated"
        @update:config="(patch: Record<string, unknown>) => emit('update:config', patch)"
        @open-picker="emit('open-picker', node.id)"
        @retry="(nid: string) => emit('retry', nid)"
      />
    </div>
    <template
      v-for="(port, idx) in proto?.outputPorts ?? []"
      :key="port.id"
    >
      <Handle
        :id="port.id"
        type="source"
        :position="Position.Right"
        class="canvas-node__handle"
        :style="handleStyle(proto?.outputPorts.length ?? 1, idx)"
      />
    </template>
    <!-- 缩放控制点：悬浮/选中/缩放中显示，拖拽边缘或四角调整节点大小（全部节点类型） -->
    <NodeResizer
      v-if="proto?.resizeable"
      :node-id="node.id"
      :is-visible="selected || hovered || resizing"
      :min-width="MIN_NODE_WIDTH"
      :min-height="MIN_NODE_HEIGHT"
      color="#1976d2"
      @resize-start="resizing = true"
      @resize-end="onResizeEnd"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'
import type { OnResizeEnd } from '@vue-flow/node-resizer'
import '@vue-flow/node-resizer/dist/style.css'
import { getPrototype } from '../../canvas/registry'
import type { CanvasNodeData } from '../../canvas/types'
import type { GenerateStatus } from '../../canvas/useCanvasGeneration'

/**
 * 资产画布节点卡片：渲染单个节点的头部（名称/内联重命名）、输入/输出端口、
 * 原型主体组件与缩放控制点。
 *
 * 悬浮与缩放中状态为组件内部状态（仅驱动缩放控制点显隐）；
 * 内联重命名状态由父级（useCanvasRename）持有，通过 renaming/renameValue props 驱动，
 * 输入框聚焦/全选由本组件在 renaming 变真后自动执行。
 */
const props = defineProps<{
  /** 节点数据 */
  node: CanvasNodeData
  /** 项目名（透传给主体组件） */
  project: string
  /** Vue Flow 选中态（选中边框 + 缩放控制点） */
  selected: boolean
  /** 生成状态（透传给主体组件展示进度/错误遮罩） */
  status?: GenerateStatus
  /** 节点当前产物（固定路径 + 防缓存 token；生成类节点由 AssetCanvas 按固定产物路径推导） */
  output?: { path: string; token?: number } | null
  /** 上游已更新角标 */
  upstreamUpdated: boolean
  /** 是否处于名称内联编辑 */
  renaming: boolean
  /** 内联编辑输入框临时值 */
  renameValue: string
}>()

const emit = defineEmits<{
  /** 主体组件配置补丁（合并写入节点 config） */
  (e: 'update:config', patch: Record<string, unknown>): void
  /** 主体组件打开资产选择器 */
  (e: 'open-picker', nodeId: string): void
  /** 主体组件重试生成 */
  (e: 'retry', nodeId: string): void
  /** 双击名称进入内联编辑 */
  (e: 'start-rename', nodeId: string): void
  /** 内联编辑输入值变化 */
  (e: 'update:rename-value', value: string): void
  /** 提交内联重命名（回车/失焦） */
  (e: 'commit-rename', nodeId: string): void
  /** 取消内联重命名（Esc） */
  (e: 'cancel-rename'): void
  /** 缩放结束（携带最终尺寸/坐标） */
  (e: 'resize-end', nodeId: string, payload: OnResizeEnd): void
  /** 节点右键（父级打开右键菜单） */
  (e: 'context-menu', event: MouseEvent): void
}>()

/** 节点最小宽度（像素，拖拽缩放的下限） */
const MIN_NODE_WIDTH = 120
/** 节点最小高度（像素，拖拽缩放的下限） */
const MIN_NODE_HEIGHT = 80

/** 节点原型（端口/主体组件/可缩放性） */
const proto = computed(() => getPrototype(props.node.prototypeId))

/** 鼠标悬浮中（悬浮时显示缩放控制点） */
const hovered = ref(false)
/** 缩放进行中（拖出节点边界后仍保持控制点可见，防止 mouseleave 卸载控制点中断缩放） */
const resizing = ref(false)

/** 内联编辑输入框 DOM（用于聚焦与全选） */
const nameInputEl = ref<HTMLInputElement | null>(null)

// 进入内联编辑模式时聚焦并全选输入框
watch(
  () => props.renaming,
  async (renaming) => {
    if (!renaming) return
    await nextTick()
    nameInputEl.value?.focus()
    nameInputEl.value?.select()
  },
)

/** 内联编辑输入：上抛临时值（父级持有状态，回车/失焦统一提交） */
function onRenameInput(event: Event): void {
  emit('update:rename-value', (event.target as HTMLInputElement).value)
}

/** 缩放结束：清缩放中标记并上抛最终尺寸/坐标（父级回写 store） */
function onResizeEnd(payload: OnResizeEnd): void {
  resizing.value = false
  emit('resize-end', props.node.id, payload)
}

/**
 * 多端口时按顺序垂直分布连接点；单端口保持默认 50% 位置。
 *
 * @param count 端口数量
 * @param index 端口序号（0 起）
 * @returns handle 定位样式（单端口返回空对象）
 */
function handleStyle(count: number, index: number): Record<string, string> {
  if (count <= 1) return {}
  const top = ((index + 1) * 100) / (count + 1)
  return { top: `${top}%` }
}
</script>

<style scoped>
.canvas-node {
  position: relative;
  width: 100%;
  height: 100%;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  background: #fff;
  display: flex;
  flex-direction: column;
  overflow: visible;
  box-sizing: border-box;
}

.canvas-node--selected {
  border-color: rgb(25, 118, 210);
  box-shadow: 0 0 0 1px rgb(25, 118, 210);
}

.canvas-node__header {
  flex: 0 0 auto;
  padding: 3px 8px;
  background: rgba(0, 0, 0, 0.04);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.canvas-node__name {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* 悬浮显示普通指针；文字编辑光标仅在内联重命名输入框（.canvas-node__name-input）出现 */
  cursor: default;
}

.canvas-node__name-input {
  width: 100%;
  box-sizing: border-box;
  font-size: 12px;
  line-height: 1.4;
  font-family: inherit;
  color: inherit;
  border: 1px solid rgb(25, 118, 210);
  border-radius: 3px;
  outline: none;
  padding: 0 2px;
}

.canvas-node__body {
  flex: 1;
  min-height: 0;
  position: relative;
}

/* 连接点：默认小尺寸；鼠标在附近悬浮时放大（带过渡动画），便于抓取拖拽连接。
   注：放大通过 width/height 实现，避免覆盖库自带的 translate 居中变换。
   需 z-index 提升到节点内容之上：左侧输入连接点在 DOM 中位于 .canvas-node__body
   之前（同 z-auto 按 DOM 顺序绘制，body 会盖住其 ::before 命中区），
   加 z-index 后节点卡片内侧（靠近边缘）也能触发附近悬浮放大。 */
.canvas-node__handle {
  z-index: 10;
  width: 6px;
  height: 6px;
  min-width: 6px;
  min-height: 6px;
  transition:
    width 0.1s,
    height 0.1s,
    min-width 0.1s,
    min-height 0.1s,
    background-color 0.1s;
}

/* 扩大连接点命中区域：悬浮（或拖动连线靠近）即可触发放大，且该区域可直接抓取 */
.canvas-node__handle::before {
  content: '';
  position: absolute;
  top: -10px;
  right: -10px;
  bottom: -10px;
  left: -10px;
  border-radius: 50%;
}

/* 悬浮放大；拖动连线时的起点（connecting）同步放大 */
.canvas-node__handle:hover,
.canvas-node__handle.connecting {
  width: 20px;
  height: 20px;
  min-width: 20px;
  min-height: 20px;
}

/* ── 节点缩放控制点（@vue-flow/node-resizer）──
   控制点渲染在节点内部（绝对定位），提升到节点内容之上但仍低于连接点（z-index 10），
   保证视频控件等主体内容不遮挡缩放交互；四角控制点加大尺寸并用 ::after 扩大命中区域。 */
.canvas-node :deep(.vue-flow__resize-control) {
  z-index: 5;
}

.canvas-node :deep(.vue-flow__resize-control.handle) {
  width: 9px;
  height: 9px;
  border: 1.5px solid #fff;
  border-radius: 50%;
  background-color: #1976d2;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.18);
  transform: translate(-50%, -50%);
}

/* 扩大控制点命中区域（伪元素命中同样归属于控制点元素，缩放拖拽可直接抓取） */
.canvas-node :deep(.vue-flow__resize-control.handle)::after {
  content: '';
  position: absolute;
  inset: -7px;
}
</style>
