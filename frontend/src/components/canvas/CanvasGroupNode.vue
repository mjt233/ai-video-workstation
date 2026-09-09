<template>
  <!-- 持久分组框（Vue Flow 节点 type: canvas-group）：
       半透明圆角矩形 + 顶部标题条（双击改名 / 右侧色点改色）+ 四边拖动条 + 八向缩放控制点。
       指针事件约定（关键，见 docs/canvas/interactions.md）：
       - 根元素与主体填充 pointer-events: none，使框内空白穿透到 Vue Flow pane（组内可继续框选/双击加节点）；
       - 标题条、四边拖动条 pointer-events: auto（拖动抓取）；
       - 按住 Ctrl 时节点 wrapper 挂 canvas-group-node--passthrough 类整体穿透（Ctrl+拖拽 = 框选，零例外）。 -->
  <div
    class="canvas-group"
    :class="{ 'canvas-group--selected': selected, 'canvas-group--empty': isEmpty }"
    :style="cssVars"
    @mouseover="onMouseOver"
    @mouseout="onMouseOut"
  >
    <!-- 主体填充 + 边框（不拦截指针） -->
    <div class="canvas-group__body" />

    <!-- 四边拖动条（8px；顶部条位于标题条下方，避免与标题条重叠） -->
    <div
      class="canvas-group__edge canvas-group__edge--t"
      title="拖动移动分组"
      @mousedown="onDragStart"
    />
    <div
      class="canvas-group__edge canvas-group__edge--b"
      title="拖动移动分组"
      @mousedown="onDragStart"
    />
    <div
      class="canvas-group__edge canvas-group__edge--l"
      title="拖动移动分组"
      @mousedown="onDragStart"
    />
    <div
      class="canvas-group__edge canvas-group__edge--r"
      title="拖动移动分组"
      @mousedown="onDragStart"
    />

    <!-- 顶部标题条（拖动抓取 + 双击改名 + 色点改色） -->
    <div
      class="canvas-group__title"
      :title="`${group.name}（拖动移动，双击改名）`"
      @mousedown="onDragStart"
      @dblclick.stop="emit('start-rename', group.id)"
      @contextmenu.prevent="emit('context-menu', $event, group.id)"
    >
      <input
        v-if="renaming"
        ref="nameInputEl"
        :value="renameValue"
        class="canvas-group__name-input nodrag nowheel"
        @mousedown.stop
        @dblclick.stop
        @click.stop
        @keyup.enter="emit('commit-rename', group.id)"
        @keyup.esc="emit('cancel-rename')"
        @blur="emit('commit-rename', group.id)"
        @input="onRenameInput"
      >
      <span
        v-else
        class="canvas-group__name"
      >{{ group.name }}</span>
      <span
        v-if="isEmpty"
        class="canvas-group__empty-badge"
      >空</span>
      <span class="canvas-group__spacer" />
      <button
        type="button"
        class="canvas-group__color nodrag"
        title="更改颜色"
        @mousedown.stop
        @click.stop="emit('open-color', group.id, $event)"
      />
    </div>

    <!-- 八向缩放控制点：选中/悬浮/缩放中显示；缩放不移动组内节点（成员关系由几何重叠实时派生） -->
    <NodeResizer
      :node-id="group.id"
      :is-visible="selected || hovering || resizing"
      :min-width="GROUP_MIN_SIZE.width"
      :min-height="GROUP_MIN_SIZE.height"
      color="#1976d2"
      @resize-start="resizing = true"
      @resize-end="onResizeEnd"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { NodeResizer } from '@vue-flow/node-resizer'
import type { OnResizeEnd } from '@vue-flow/node-resizer'
import '@vue-flow/node-resizer/dist/style.css'
import type { CanvasGroupData } from '../../canvas/types'
import { GROUP_MIN_SIZE, hexToRgba } from '../../canvas/groups'

/**
 * 持久分组框渲染组件（纯展示 + 事件上抛）。
 *
 * 交互逻辑（拖动 / 缩放回写 / 重命名 / 改色 / 解散）由 useCanvasGroups 组合式持有，
 * 本组件只负责视觉与指针事件转发。
 */
const props = defineProps<{
  /** 分组数据（位置/尺寸由 Vue Flow 节点决定，名称与颜色取此处） */
  group: CanvasGroupData
  /** 是否选中（选中态描边高亮） */
  selected: boolean
  /** 组内是否没有任何节点（标题条显示「空」标记并降低不透明度；不自动删除） */
  isEmpty: boolean
  /** 是否处于内联重命名状态 */
  renaming: boolean
  /** 内联重命名输入框的临时值（父级持有） */
  renameValue: string
}>()

const emit = defineEmits<{
  /** 开始拖动分组（标题条 / 四边按下；父级安装 window 监听并处理 Ctrl 穿透与位移阈值） */
  (e: 'drag-start', groupId: string, event: MouseEvent): void
  /** 双击标题进入内联重命名 */
  (e: 'start-rename', groupId: string): void
  /** 内联重命名输入值变化 */
  (e: 'update:rename-value', value: string): void
  /** 提交内联重命名（回车 / 失焦） */
  (e: 'commit-rename', groupId: string): void
  /** 取消内联重命名（Esc） */
  (e: 'cancel-rename'): void
  /** 点击色点按钮（父级打开预设色板菜单） */
  (e: 'open-color', groupId: string, event: MouseEvent): void
  /** 分组右键（父级打开分组实体菜单） */
  (e: 'context-menu', event: MouseEvent, groupId: string): void
  /** 缩放结束（携带最终尺寸/坐标，父级回写 store） */
  (e: 'resize-end', groupId: string, payload: OnResizeEnd): void
}>()

/** 鼠标悬浮中（悬浮时显示缩放控制点） */
const hovering = ref(false)
/** 缩放进行中（拖出分组边界后仍保持控制点可见，防止 mouseout 卸载控制点中断缩放） */
const resizing = ref(false)
/** 内联编辑输入框 DOM（用于聚焦与全选） */
const nameInputEl = ref<HTMLInputElement | null>(null)

/**
 * 主题色 CSS 变量（单一颜色来源，三档透明度 + 选中光环）：
 * 填充 8%、边框 70%、标题条 90%、选中光环 35%。
 */
const cssVars = computed<Record<string, string>>(() => {
  const color = props.group.color
  return {
    '--canvas-group-fill': hexToRgba(color, 0.08),
    '--canvas-group-border': hexToRgba(color, 0.7),
    '--canvas-group-title-bg': hexToRgba(color, 0.9),
    '--canvas-group-ring': hexToRgba(color, 0.35),
    '--canvas-group-color': color,
  }
})

/**
 * 鼠标移入分组内任意可交互子元素（事件冒泡到根元素，根元素自身 pointer-events: none 不影响冒泡）。
 */
function onMouseOver(): void {
  hovering.value = true
}

/**
 * 鼠标移出：relatedTarget 仍在分组内时保持悬浮（子元素间移动不闪烁）。
 *
 * @param event 鼠标事件
 */
function onMouseOut(event: MouseEvent): void {
  const related = event.relatedTarget as Node | null
  const root = event.currentTarget as Node | null
  if (related && root?.contains(related)) return
  hovering.value = false
}

/** 标题条 / 四边按下：上抛拖动起点（父级负责 preventDefault、Ctrl 穿透与位移阈值判定） */
function onDragStart(event: MouseEvent): void {
  emit('drag-start', props.group.id, event)
}

/** 内联编辑输入：上抛临时值（父级持有状态，回车/失焦统一提交） */
function onRenameInput(event: Event): void {
  emit('update:rename-value', (event.target as HTMLInputElement).value)
}

/** 缩放结束：清缩放中标记并上抛最终尺寸/坐标（父级回写 store，单次撤销） */
function onResizeEnd(payload: OnResizeEnd): void {
  resizing.value = false
  emit('resize-end', props.group.id, payload)
}

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
</script>

<style scoped>
.canvas-group {
  position: relative;
  width: 100%;
  height: 100%;
  /* 关键：根元素不拦截指针，框内空白穿透到 Vue Flow pane（组内可框选/双击加节点） */
  pointer-events: none;
  user-select: none;
}

/* 主体填充 + 圆角边框（不拦截指针） */
.canvas-group__body {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  border: 2px solid var(--canvas-group-border);
  border-radius: 8px;
  background: var(--canvas-group-fill);
  pointer-events: none;
  transition: box-shadow 0.12s ease;
}

/* 选中态：主色光环描边（与节点选中态视觉区分） */
.canvas-group--selected .canvas-group__body {
  box-shadow: 0 0 0 3px var(--canvas-group-ring);
}

/* 空分组：整体降低不透明度（提示已被拖空，不自动删除） */
.canvas-group--empty .canvas-group__body,
.canvas-group--empty .canvas-group__title {
  opacity: 0.55;
}

/* 四边拖动条（8px，透明；命中即拖动分组） */
.canvas-group__edge {
  position: absolute;
  pointer-events: auto;
  cursor: move;
}

/* 顶部拖动条：位于标题条（28px）下方，避免与标题条重叠 */
.canvas-group__edge--t {
  top: 28px;
  left: 8px;
  right: 8px;
  height: 8px;
}

.canvas-group__edge--b {
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 8px;
}

.canvas-group__edge--l {
  top: 0;
  bottom: 0;
  left: 0;
  width: 8px;
}

.canvas-group__edge--r {
  top: 0;
  bottom: 0;
  right: 0;
  width: 8px;
}

/* 顶部标题条（28px）：主题色 90% 透明度背景 + 白字，可拖动 */
.canvas-group__title {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  box-sizing: border-box;
  border-radius: 8px 8px 0 0;
  background: var(--canvas-group-title-bg);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  cursor: move;
  pointer-events: auto;
  overflow: hidden;
}

.canvas-group__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 内联重命名输入框（nodrag nowheel：避免触发节点拖拽与画布滚轮缩放） */
.canvas-group__name-input {
  flex: 1;
  min-width: 0;
  height: 20px;
  padding: 0 4px;
  border: none;
  border-radius: 3px;
  outline: none;
  background: rgba(255, 255, 255, 0.92);
  color: #212121;
  font-size: 12px;
  font-family: inherit;
}

/* 空分组标记 */
.canvas-group__empty-badge {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.25);
  font-size: 10px;
}

/* 标题与色点之间的弹性占位（不依赖 Vuetify 组件，节点插槽内保持纯样式实现） */
.canvas-group__spacer {
  flex: 1;
  min-width: 0;
}

/* 色点按钮（打开预设色板） */
.canvas-group__color {
  flex: none;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 50%;
  background: var(--canvas-group-color);
  cursor: pointer;
}
</style>
