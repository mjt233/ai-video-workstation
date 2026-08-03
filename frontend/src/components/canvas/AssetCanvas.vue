<template>
  <div
    ref="canvasRef"
    class="asset-canvas"
    :style="{ height: `${targetHeight}px` }"
  >
    <!-- 工具栏 -->
    <div class="asset-canvas__toolbar">
      <v-btn
        size="small"
        variant="text"
        icon="mdi-fit-to-screen-outline"
        title="适应视图"
        @click="fitView"
      />
      <v-btn
        size="small"
        variant="text"
        icon="mdi-plus"
        title="放大"
        @click="zoomIn"
      />
      <v-btn
        size="small"
        variant="text"
        icon="mdi-minus"
        title="缩小"
        @click="zoomOut"
      />
      <v-divider
        vertical
        class="mx-1"
      />
      <v-btn
        size="small"
        variant="text"
        icon="mdi-undo"
        title="撤销 (Ctrl+Z)"
        :disabled="!canUndo"
        @click="undo"
      />
      <v-btn
        size="small"
        variant="text"
        icon="mdi-redo"
        title="重做 (Ctrl+Shift+Z)"
        :disabled="!canRedo"
        @click="redo"
      />
      <v-divider
        vertical
        class="mx-1"
      />
      <v-btn
        size="small"
        prepend-icon="mdi-auto-fix"
        variant="tonal"
        :loading="autoBuilding"
        title="根据分镜/子场景自动搭建画布"
        @click="autoBuild"
      >
        自动搭画布
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        icon="mdi-plus-thick"
        title="添加节点（或双击空白处）"
        @click="openAddDialogAt(80, 80)"
      />
      <v-spacer />
      <v-progress-circular
        v-if="saving"
        size="18"
        indeterminate
        color="primary"
      />
      <span
        v-else-if="dirty"
        class="text-caption text-medium-emphasis"
      >未保存</span>
      <span
        v-else
        class="text-caption text-disabled"
      >已保存</span>
    </div>

    <div
      ref="flowEl"
      class="asset-canvas__flow"
    >
      <VueFlow
        :nodes="flowNodes"
        :edges="flowEdges"
        :fit-view-on-init="true"
        :min-zoom="0.2"
        :max-zoom="3"
        :nodes-draggable="true"
        :is-valid-connection="isValidConnection"
        :delete-key-code="null"
        :zoom-on-double-click="false"
        @connect="onConnect"
        @edges-change="onEdgesChange"
        @node-click="onNodeClick"
        @edge-click="onEdgeClick"
        @node-drag-start="onNodeDragStart"
        @node-drag-stop="onNodeDragStop"
        @pane-click="onPaneClick"
      >
        <Background :gap="16" />
        <template #node-canvas="{ id, selected }">
          <div
            v-if="nodeMap[id]"
            class="canvas-node"
            :class="{ 'canvas-node--selected': selected }"
            @contextmenu.prevent="openContextMenu($event, id)"
          >
            <!-- 节点名称头部 -->
            <div class="canvas-node__header">
              <span class="text-caption font-weight-medium canvas-node__name">
                {{ nodeMap[id].name }}
              </span>
            </div>
            <Handle
              v-if="protoOf(id)?.inputPorts.length"
              :id="protoOf(id)?.inputPorts[0]?.id"
              type="target"
              :position="Position.Left"
            />
            <div class="canvas-node__body">
              <component
                :is="protoOf(id)?.bodyComponent"
                :project="props.project"
                :node="nodeMap[id]"
                :status="statusByNode[id]"
                :upstream-updated="isUpstreamUpdated(id)"
                @update:config="(patch: Record<string, unknown>) => onUpdateConfig(id, patch)"
                @open-picker="openAssetPicker"
                @retry="(nid: string) => generateNode(nid)"
              />
            </div>
            <Handle
              v-if="protoOf(id)?.outputPorts.length"
              :id="protoOf(id)?.outputPorts[0]?.id"
              type="source"
              :position="Position.Right"
            />
          </div>
        </template>
      </VueFlow>

      <!-- 节点配置悬浮面板（独立于节点，位于节点正下方，随视图联动） -->
      <div
        v-if="editorPanel && !suppressEditor"
        ref="panelEl"
        class="canvas-node-editor-panel"
        :style="editorPanelStyle"
      >
        <component
          :is="editorPanel?.editorComponent"
          :project="props.project"
          :node="editorPanel?.node"
          :input-paths="editorPanel ? inputPathsOf(editorPanel.node.id) : []"
          :is-running="editorPanel ? isNodeRunning(editorPanel.node.id) : false"
          @update:config="(patch: Record<string, unknown>) => editorPanel && onUpdateConfig(editorPanel.node.id, patch)"
          @generate="generateNode"
          @interrupt="onInterrupt"
          @open-history="openHistory"
          @set-as-scene="setAsScene"
        />
      </div>

      <!-- 右键菜单 -->
      <div
        v-if="contextMenu.show"
        class="canvas-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      >
        <div
          v-if="contextMenuNode?.prototypeId === 'image-generate'"
          class="canvas-context-menu__item"
          @click="contextGenerate"
        >
          <v-icon
            size="small"
            class="mr-2"
          >
            mdi-refresh
          </v-icon>
          重新生成
        </div>
        <div
          v-if="contextMenuNode?.prototypeId === 'image-generate'"
          class="canvas-context-menu__item"
          @click="contextHistory"
        >
          <v-icon
            size="small"
            class="mr-2"
          >
            mdi-history
          </v-icon>
          历史
        </div>
        <div
          class="canvas-context-menu__item"
          @click="contextRename"
        >
          <v-icon
            size="small"
            class="mr-2"
          >
            mdi-pencil-outline
          </v-icon>
          重命名
        </div>
        <div
          class="canvas-context-menu__item"
          @click="contextCopy"
        >
          <v-icon
            size="small"
            class="mr-2"
          >
            mdi-content-copy
          </v-icon>
          复制
        </div>
        <div
          class="canvas-context-menu__item canvas-context-menu__item--danger"
          @click="contextDelete"
        >
          <v-icon
            size="small"
            class="mr-2"
          >
            mdi-delete-outline
          </v-icon>
          删除
        </div>
      </div>
    </div>

    <!-- 加载中 / 空画布引导 -->
    <div
      v-if="!loaded"
      class="asset-canvas__overlay"
    >
      加载中…
    </div>
    <div
      v-else-if="nodes.length === 0"
      class="asset-canvas__overlay asset-canvas__empty"
    >
      <div class="text-body-2">
        画布为空
      </div>
      <div class="text-caption text-medium-emphasis">
        双击空白处或点击工具栏「＋」添加节点
      </div>
    </div>

    <!-- 添加节点对话框 -->
    <v-dialog
      v-model="addDialog.show"
      max-width="360"
    >
      <v-card>
        <v-card-title class="text-body-1">
          添加节点
        </v-card-title>
        <v-card-text class="pa-2">
          <v-list
            density="compact"
            nav
          >
            <v-list-item
              v-for="p in NODE_PROTOTYPES"
              :key="p.id"
              :title="p.name"
              @click="addNodeAt(p.id)"
            />
          </v-list>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- 重命名对话框 -->
    <v-dialog
      v-model="renameDialog.show"
      max-width="420"
    >
      <v-card>
        <v-card-title class="text-body-1">
          重命名节点
        </v-card-title>
        <v-card-text>
          <v-text-field
            v-model="renameDialog.name"
            label="节点名称"
            density="compact"
            variant="outlined"
            hide-details
            @keyup.enter="doRename"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="renameDialog.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            @click="doRename"
          >
            确定
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 版本历史对话框 -->
    <v-dialog
      v-model="historyDialog.show"
      max-width="640"
    >
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon
            class="mr-2"
            size="small"
          >
            mdi-history
          </v-icon>
          <span>版本历史</span>
        </v-card-title>
        <v-card-text>
          <v-list
            v-if="historyEntries.length"
            density="compact"
          >
            <v-list-item
              v-for="h in historyEntries"
              :key="h.version"
            >
              <v-list-item-title class="text-body-2">
                v{{ h.version }}
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ h.path }} · {{ formatDate(h.date) }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <div
            v-else
            class="text-grey text-body-2"
          >
            暂无历史版本
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="historyDialog.show = false"
          >
            关闭
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 资产选择器（加载图片节点绑定资产） -->
    <AssetPickerDialog
      v-model="picker.show"
      :project="props.project"
      :multiple="false"
      @update:selected="onPickerConfirm"
    />

    <!-- 操作反馈 -->
    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      :timeout="3000"
      location="bottom"
    >
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  VueFlow,
  useVueFlow,
  Handle,
  Position,
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type EdgeMouseEvent,
  type Node as FlowNode,
  type NodeDragEvent,
  type NodeMouseEvent,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { useCanvasStore } from '../../canvas/useCanvasStore'
import { useCanvasGeneration } from '../../canvas/useCanvasGeneration'
import { getPrototype, NODE_PROTOTYPES, type NodePrototype } from '../../canvas/registry'
import { canConnectNodes } from '../../canvas/connection'
import { collectInputPaths, getHistory, getNodeCurrentAssetPath } from '../../canvas/generate'
import { buildAutoCanvas, buildShotRefsFromStage, type AutoBuildRef } from '../../canvas/autobuild'
import { copyFs, readFs, type DirResponse } from '../../api/client'
import { useAutoComputeHeight } from '../../composables/useAutoComputeHeight'
import type { CanvasNodeData } from '../../canvas/types'
import { confirm } from '../../utils/confirm'
import AssetPickerDialog from '../AssetPickerDialog.vue'

/** 组件 props：定位一张画布 */
const props = defineProps<{
  project: string
  kind: 'stage' | 'scene'
  stage?: string
  episode?: string
  shot?: string
}>()

/** 画布目标（分镜画布需要 episode+shot，场景画布需要 stage） */
const target = computed(() => ({
  kind: props.kind,
  stage: props.stage,
  episode: props.episode,
  shot: props.shot,
}))

/** 画布数据 store：加载/保存/增删改查/撤销重做 */
const store = useCanvasStore(props.project, target.value)
/** 资产生成组合式：跑工作流 + 轮询 + 历史回写 */
const gen = useCanvasGeneration(props.project, target.value)
const { statusByNode } = gen
const { loaded, nodes, dirty, saving, canUndo, canRedo, undo, redo } = store

/** Vue Flow 视图控制：适应/缩放/屏幕坐标换算 */
const { fitView, zoomIn, zoomOut, screenToFlowCoordinate, viewport } = useVueFlow()

/** 画布根节点 DOM（用于自动计算高度铺满页面） */
const canvasRef = ref<HTMLElement | null>(null)

/** 画布高度自适应：铺满页面剩余空间（随窗口/布局变化自动更新） */
const { targetHeight, updateHeight } = useAutoComputeHeight({
  autoComputeHeight: true,
  computeTarget: () => canvasRef.value,
  observeTarget: () => canvasRef.value ?? document.body,
  offset: 0,
})

/** 画布容器 DOM（用于右键菜单定位） */
const flowEl = ref<HTMLDivElement | null>(null)

// ── 节点/连线渲染 ───────────────────────────────────────

/** 节点 id → 节点数据（模板内直接索引） */
const nodeMap = computed<Record<string, CanvasNodeData>>(() => {
  const m: Record<string, CanvasNodeData> = {}
  for (const n of store.nodes.value) m[n.id] = n
  return m
})

/** 查询节点原型 */
function protoOf(nodeId: string): NodePrototype | undefined {
  const node = nodeMap.value[nodeId]
  return node ? getPrototype(node.prototypeId) : undefined
}

/** Vue Flow 节点列表（type 固定 canvas，走自定义 slot 渲染） */
const flowNodes = computed<FlowNode[]>(() =>
  store.nodes.value.map((n) => ({
    id: n.id,
    type: 'canvas',
    position: { x: n.x, y: n.y },
    data: { label: n.name },
    style: { width: `${n.width}px`, height: `${n.height}px` },
  })),
)

/** Vue Flow 连线列表 */
const flowEdges = computed<FlowEdge[]>(() =>
  store.connections.value.map((c) => ({
    id: c.id,
    source: c.fromNodeId,
    sourceHandle: c.fromPortId,
    target: c.toNodeId,
    targetHandle: c.toPortId,
    type: 'default',
  })),
)

/** 节点被拖动后回写坐标（Phase 2 行为保持；与 node-drag-stop 双保险） */
watch(
  flowNodes,
  (list) => {
    for (const n of list) {
      const node = store.nodes.value.find((x) => x.id === n.id)
      if (node && (node.x !== n.position.x || node.y !== n.position.y)) {
        node.x = Math.round(n.position.x)
        node.y = Math.round(n.position.y)
      }
    }
  },
  { deep: true },
)

/** 拖动结束：通过 store.updateNode 持久化位置（置脏并保存） */
function onNodeDragStop({ nodes: dragged }: NodeDragEvent) {
  for (const n of dragged) {
    store.updateNode(n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) })
  }
}

// ── 连线交互 ────────────────────────────────────────────

/**
 * 校验临时连接是否可建立（source/target 可能为空需防御）。
 *
 * @param conn Vue Flow 临时连接
 * @returns 可建立返回 true
 */
function isValidConnection(conn: Connection): boolean {
  if (!conn.source || !conn.target) return false
  return canConnectNodes(store.connections.value, conn.source, conn.target, store.nodes.value)
}

/** 连接成功：写入 store（store 内部再次校验，失败忽略） */
function onConnect(conn: Connection) {
  if (!conn.source || !conn.target) return
  store.connect(conn.source, conn.target)
}

/**
 * 连线被移除时同步删除 store 中的连线。
 * 注：本版本 @vue-flow/core 无 @edges-delete 事件，改用 @edges-change 的 remove 变更。
 *
 * @param changes 连线变更列表
 */
function onEdgesChange(changes: EdgeChange[]) {
  for (const ch of changes) {
    if (ch.type === 'remove') {
      store.disconnect(ch.id)
    }
  }
}

/** 记录当前选中的连线（供 Delete 键删除） */
function onEdgeClick({ edge }: EdgeMouseEvent) {
  selectedEdgeId.value = edge.id
}

// ── 选择与删除 ──────────────────────────────────────────

/** 当前选中节点 id（驱动复制/删除/右键菜单） */
const selectedNodeId = ref('')
/** 当前选中连线 id（驱动 Delete 键删除连线） */
const selectedEdgeId = ref('')
/** 拖拽进行中：抑制配置面板显示（拖拽不触发配置） */
const suppressEditor = ref(false)

/** 当前选中的节点数据 */
const selectedNode = computed(() => store.nodes.value.find((n) => n.id === selectedNodeId.value) ?? null)

/** 当前选中节点的编辑器组件（无配置组件时为空） */
const editorPanel = computed(() => {
  const node = selectedNode.value
  if (!node) return null
  const proto = getPrototype(node.prototypeId)
  return proto?.editorComponent ? { node, editorComponent: proto.editorComponent } : null
})

/** 配置面板固定宽度（像素，按画布坐标系，随缩放缩放），窄节点时也保持足够宽度 */
const EDITOR_PANEL_WIDTH = 400
/** 配置面板与节点底部之间的垂直间距（像素，按画布坐标系） */
const EDITOR_PANEL_GAP = 12

/** 配置面板 DOM（用于测量实际高度以做边界钳制） */
const panelEl = ref<HTMLDivElement | null>(null)
/** 配置面板当前实际高度（像素，屏幕坐标） */
const panelHeight = ref(0)
/** 画布可视区当前尺寸（像素） */
const flowHeight = ref(0)
const flowWidth = ref(0)
let panelResizeObserver: ResizeObserver | null = null

/** 配置面板定位：节点正下方（随平移/缩放联动）；若超出画布可视区底部则翻转到节点上方 */
const editorPanelStyle = computed(() => {
  const node = selectedNode.value
  if (!node) return null
  const vp = viewport.value
  const left = node.x * vp.zoom + vp.x
  const width = Math.max(EDITOR_PANEL_WIDTH * vp.zoom, node.width * vp.zoom)
  const gap = EDITOR_PANEL_GAP * vp.zoom
  const belowTop = (node.y + node.height) * vp.zoom + vp.y + gap
  // 优先放在节点下方；若底部超出可视区（且面板高度已知），则放到节点上方
  let top = belowTop
  if (panelHeight.value > 0 && belowTop + panelHeight.value > flowHeight.value) {
    const aboveTop = node.y * vp.zoom + vp.y - gap - panelHeight.value
    if (aboveTop >= 0) top = aboveTop
  }
  // 最终钳制：面板底部不超出画布可视区（必要时与节点重叠），顶部不小于留白
  if (panelHeight.value > 0 && flowHeight.value > 0) {
    top = Math.min(top, Math.max(flowHeight.value - panelHeight.value - 8, 8))
    top = Math.max(top, 8)
  }
  // 水平方向：左侧不超出画布，右侧不超出画布（按可视区钳制）
  const clampedLeft = Math.min(Math.max(left, 8), Math.max(flowWidth.value - width - 8, 8))
  return { left: `${clampedLeft}px`, top: `${top}px`, width: `${width}px` }
})

/** 点击节点：选中并关闭右键菜单（允许显示配置面板） */
function onNodeClick({ node }: NodeMouseEvent) {
  suppressEditor.value = false
  selectedNodeId.value = node.id
  contextMenu.show = false
}

/** 节点开始拖拽：抑制配置面板显示（仅点击节点才显示配置） */
function onNodeDragStart(_event: NodeDragEvent) {
  suppressEditor.value = true
}

/**
 * 删除节点（弹窗确认）。
 *
 * @param nodeId 节点 id
 */
async function deleteNode(nodeId: string) {
  const node = store.nodes.value.find((n) => n.id === nodeId)
  if (!node) return
  const ok = await confirm({
    title: '删除节点',
    content: `确定删除节点「${node.name}」？`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  store.removeNode(nodeId)
  if (selectedNodeId.value === nodeId) selectedNodeId.value = ''
}

// ── 右键菜单 ────────────────────────────────────────────

const contextMenu = reactive({ show: false, x: 0, y: 0, nodeId: '' })

/** 当前右键菜单对应的节点 */
const contextMenuNode = computed(() => (contextMenu.nodeId ? nodeMap.value[contextMenu.nodeId] : undefined))

/**
 * 打开节点右键菜单（相对画布容器定位）。
 *
 * @param event 鼠标右键事件
 * @param nodeId 节点 id
 */
function openContextMenu(event: MouseEvent, nodeId: string) {
  selectedNodeId.value = nodeId
  contextMenu.nodeId = nodeId
  const rect = flowEl.value?.getBoundingClientRect()
  contextMenu.x = Math.round(event.clientX - (rect?.left ?? 0))
  contextMenu.y = Math.round(event.clientY - (rect?.top ?? 0))
  contextMenu.show = true
}

/** 菜单：重新生成 */
function contextGenerate() {
  const id = contextMenu.nodeId
  contextMenu.show = false
  if (id) void generateNode(id)
}

/** 菜单：查看历史 */
function contextHistory() {
  const id = contextMenu.nodeId
  contextMenu.show = false
  if (id) openHistory(id)
}

/** 菜单：重命名 */
function contextRename() {
  const id = contextMenu.nodeId
  contextMenu.show = false
  if (id) openRename(id)
}

/** 菜单：复制 */
function contextCopy() {
  const id = contextMenu.nodeId
  contextMenu.show = false
  if (id) store.copyNode(id)
}

/** 菜单：删除 */
function contextDelete() {
  const id = contextMenu.nodeId
  contextMenu.show = false
  if (id) void deleteNode(id)
}

// ── 键盘快捷键 ──────────────────────────────────────────

/**
 * 全局键盘快捷键：撤销/重做/复制/粘贴/复制粘贴/删除。
 * 焦点在输入框/textarea 内时跳过（保留原生编辑行为）。
 *
 * @param e 键盘事件
 */
function onKeydown(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  const tag = el?.tagName
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true
  if (inInput) return

  const mod = e.ctrlKey || e.metaKey

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) store.redo()
    else store.undo()
    return
  }
  if (mod && e.key.toLowerCase() === 'c') {
    e.preventDefault()
    if (selectedNodeId.value) store.copyNode(selectedNodeId.value)
    return
  }
  if (mod && e.key.toLowerCase() === 'v') {
    e.preventDefault()
    store.pasteNode()
    return
  }
  if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault()
    if (selectedNodeId.value) {
      store.copyNode(selectedNodeId.value)
      store.pasteNode()
    }
    return
  }
  if (e.key === 'Escape') {
    contextMenu.show = false
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
    e.preventDefault()
    if (selectedNodeId.value) {
      void deleteNode(selectedNodeId.value)
    } else if (selectedEdgeId.value) {
      store.disconnect(selectedEdgeId.value)
    }
  }
}

// ── 添加节点 ────────────────────────────────────────────

const addDialog = reactive({ show: false, x: 80, y: 80 })

/** 打开添加节点对话框（指定初始坐标） */
function openAddDialogAt(x: number, y: number) {
  addDialog.x = x
  addDialog.y = y
  addDialog.show = true
}

/** 按原型添加节点 */
function addNodeAt(prototypeId: string) {
  store.addNode(prototypeId, addDialog.x, addDialog.y)
  addDialog.show = false
}

/** 空白处点击：单击关闭右键菜单，双击打开添加节点对话框 */
function onPaneClick(event: MouseEvent) {
  contextMenu.show = false
  suppressEditor.value = false
  selectedNodeId.value = ''
  selectedEdgeId.value = ''
  if (event.detail >= 2) {
    const p = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    openAddDialogAt(Math.round(p.x - 60), Math.round(p.y - 40))
  }
}

// ── 重命名 ──────────────────────────────────────────────

const renameDialog = reactive({ show: false, nodeId: '', name: '' })

/** 打开重命名对话框 */
function openRename(nodeId: string) {
  const node = nodeMap.value[nodeId]
  if (!node) return
  renameDialog.nodeId = nodeId
  renameDialog.name = node.name
  renameDialog.show = true
}

/** 提交重命名 */
function doRename() {
  const name = renameDialog.name.trim()
  if (!name || !renameDialog.nodeId) return
  store.updateNode(renameDialog.nodeId, { name })
  renameDialog.show = false
}

// ── 版本历史 ────────────────────────────────────────────

const historyDialog = reactive({ show: false, nodeId: '' })

/** 历史对话框的版本列表 */
const historyEntries = computed(() => {
  const node = nodeMap.value[historyDialog.nodeId]
  return node ? getHistory(node.config) : []
})

/** 打开版本历史对话框 */
function openHistory(nodeId: string) {
  historyDialog.nodeId = nodeId
  historyDialog.show = true
}

/** 格式化 ISO 时间为本地可读文本 */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return iso
  }
}

// ── 生成联动 ────────────────────────────────────────────

/**
 * 触发生成节点：收集输入路径 → 注入 → 跑工作流，并把 current/history 回写节点配置。
 *
 * @param nodeId 生成节点 id
 */
async function generateNode(nodeId: string) {
  const node = nodeMap.value[nodeId]
  if (!node || node.prototypeId !== 'image-generate') return
  gen.clearStatus(nodeId)
  const paths = collectInputPaths(nodeId, store.connections.value, store.nodes.value)
  gen.setInputPaths(nodeId, paths)
  await gen.generate(node, (config) => {
    store.updateNode(nodeId, { config })
  })
}

/** 中断生成 */
function onInterrupt(nodeId: string) {
  void gen.interrupt(nodeId)
}

/** 节点当前是否在生成中（供编辑器显示） */
function isNodeRunning(nodeId: string): boolean {
  return statusByNode.value[nodeId]?.status === 'running'
}

/** 节点当前输入资产路径（供编辑器展示） */
function inputPathsOf(nodeId: string): string[] {
  return collectInputPaths(nodeId, store.connections.value, store.nodes.value)
}

/** 上游更新角标：生成节点任一输入节点资产比本节点新（current.date 更大）则显示 */
function isUpstreamUpdated(nodeId: string): boolean {
  const node = nodeMap.value[nodeId]
  if (!node || node.prototypeId !== 'image-generate') return false
  const cur = node.config.current as { date?: string } | undefined
  if (!cur?.date) return false
  const incoming = store.connections.value.filter((c) => c.toNodeId === nodeId)
  for (const c of incoming) {
    const src = nodeMap.value[c.fromNodeId]
    if (!getNodeCurrentAssetPath(src)) continue
    const srcCur = src.config.current as { date?: string } | undefined
    if (srcCur?.date && srcCur.date > cur.date) return true
  }
  return false
}

// ── 设为分镜场景图 ──────────────────────────────────────

/**
 * 把生成节点的当前产物复制为分镜场景图（assert/scene/{ep}/{shot}/stage/0.jpg）。
 *
 * @param nodeId 生成节点 id
 */
async function setAsScene(nodeId: string) {
  if (target.value.kind !== 'scene') return
  const node = nodeMap.value[nodeId]
  const cur = node?.config.current as { path?: string } | undefined
  if (!node || !cur?.path) return
  const dest = `assert/scene/${target.value.episode}/${target.value.shot}/stage/0.jpg`
  try {
    await copyFs(props.project, cur.path, dest)
    showSnackbar('已设为分镜场景图', 'success')
  } catch (e) {
    showSnackbar(e instanceof Error ? e.message : '设为分镜场景图失败', 'error')
  }
}

// ── 配置回写 ────────────────────────────────────────────

/**
 * 节点 body/editor 的 update:config → 合并写入节点 config。
 *
 * @param nodeId 节点 id
 * @param patch 配置补丁
 */
function onUpdateConfig(nodeId: string, patch: Record<string, unknown>) {
  const node = nodeMap.value[nodeId]
  if (!node) return
  store.updateNode(nodeId, { config: { ...node.config, ...patch } })
}

// ── 资产选择器（加载图片节点）────────────────────────────

const picker = reactive({ show: false, nodeId: '' })

/** 打开资产选择器（绑定到某加载图片节点） */
function openAssetPicker(nodeId: string) {
  picker.nodeId = nodeId
  picker.show = true
}

/** 资产选择器确认：把选中的资产路径写入节点 config.assetPath */
function onPickerConfirm(paths: string[]) {
  const p = paths[0]
  const nodeId = picker.nodeId
  if (!p || !nodeId) return
  const node = nodeMap.value[nodeId]
  if (node) {
    store.updateNode(nodeId, { config: { ...node.config, assetPath: p } })
  }
  picker.show = false
}

// ── 自动搭画布 ──────────────────────────────────────────

const autoBuilding = ref(false)

/** 触发自动搭画布：收集引用与 prompt → 生成画布结构 → 应用到 store */
async function autoBuild() {
  if (autoBuilding.value) return
  autoBuilding.value = true
  try {
    const refs = await collectRefs()
    const prompt = await collectPrompt()
    const result = buildAutoCanvas(store.data.value, refs, prompt)
    store.applyNodes(result.nodes, result.connections)
    const g = nodeMap.value[result.generateNodeId]
    if (g) {
      store.updateNode(g.id, { config: { ...g.config, prompt: result.prompt } })
    }
    const anchorCount = result.nodes.filter((n) => n.prototypeId === 'image-loader').length
    showSnackbar(`已搭建 ${anchorCount} 个锚点节点`, 'success')
  } catch (e) {
    showSnackbar(e instanceof Error ? e.message : '自动搭画布失败', 'error')
  } finally {
    autoBuilding.value = false
  }
}

/**
 * 收集自动搭画布的资产引用：
 * - 分镜画布：读 stage.json 提取角色/场景引用
 * - 场景画布：读 prompt/stage/{stage} 下的 *.md 子场景文件
 *
 * @returns 锚点引用列表
 */
async function collectRefs(): Promise<AutoBuildRef[]> {
  const t = target.value
  if (t.kind === 'scene') {
    if (!t.episode || !t.shot) return []
    const raw = await readFs(props.project, `prompt/scene/${t.episode}/${t.shot}/stage.json`)
    const defs = Array.isArray(raw) ? (raw as unknown[]) : []
    return buildShotRefsFromStage(defs)
  }
  if (!t.stage) return []
  const dir = (await readFs(props.project, `prompt/stage/${t.stage}`)) as DirResponse
  const mdFiles = (dir?.entries ?? []).filter((e) => e.type === 'file' && e.name.endsWith('.md'))
  return mdFiles.map((f) => ({
    assetPath: `assert/stage/${t.stage}/${f.name.replace(/\.md$/, '')}.jpg`,
    label: f.name.replace(/\.md$/, ''),
  }))
}

/**
 * 收集生成节点 prompt 初稿：
 * - 分镜画布：读 overview.json 的 visual 字段
 * - 场景画布：取第一个子场景 md 文件内容
 *
 * @returns prompt 文本
 */
async function collectPrompt(): Promise<string> {
  const t = target.value
  if (t.kind === 'scene') {
    if (!t.episode || !t.shot) return ''
    try {
      const raw = (await readFs(props.project, `prompt/scene/${t.episode}/${t.shot}/overview.json`)) as {
        visual?: unknown
      }
      return typeof raw?.visual === 'string' ? raw.visual : ''
    } catch {
      return ''
    }
  }
  if (!t.stage) return ''
  try {
    const dir = (await readFs(props.project, `prompt/stage/${t.stage}`)) as DirResponse
    const mdFiles = (dir?.entries ?? []).filter((e) => e.type === 'file' && e.name.endsWith('.md'))
    if (mdFiles.length === 0) return ''
    const content = await readFs(props.project, `prompt/stage/${t.stage}/${mdFiles[0].name}`)
    return typeof content === 'string' ? content : ''
  } catch {
    return ''
  }
}

// ── Snackbar 反馈 ───────────────────────────────────────

const snackbar = reactive({ show: false, text: '', color: 'primary' })

/** 显示操作反馈提示 */
function showSnackbar(text: string, color: 'success' | 'error' | 'primary' = 'primary') {
  snackbar.text = text
  snackbar.color = color
  snackbar.show = true
}

// ── 生命周期 ────────────────────────────────────────────

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', updateHeight)
  void store.load()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', updateHeight)
  panelResizeObserver?.disconnect()
  panelResizeObserver = null
})

// 配置面板为条件渲染、画布容器可能变化尺寸：动态监听两者尺寸用于边界钳制
watch([panelEl, flowEl], ([panel, flow]) => {
  panelResizeObserver?.disconnect()
  if (panel || flow) {
    panelResizeObserver ??= new ResizeObserver(() => {
      panelHeight.value = panelEl.value?.offsetHeight ?? 0
      flowHeight.value = flowEl.value?.clientHeight ?? 0
      flowWidth.value = flowEl.value?.clientWidth ?? 0
    })
    if (panel) panelResizeObserver.observe(panel)
    if (flow) panelResizeObserver.observe(flow)
  } else {
    panelHeight.value = 0
  }
  flowHeight.value = flowEl.value?.clientHeight ?? 0
  flowWidth.value = flowEl.value?.clientWidth ?? 0
})
</script>

<style scoped>
.asset-canvas {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.asset-canvas__toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}

.asset-canvas__flow {
  flex: 1;
  min-height: 0;
  position: relative;
}

.asset-canvas__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  pointer-events: none;
}

.asset-canvas__empty {
  pointer-events: none;
}

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
}

.canvas-node__body {
  flex: 1;
  min-height: 0;
  position: relative;
}

.canvas-node-editor-panel {
  position: absolute;
  z-index: 15;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  padding: 8px;
  box-sizing: border-box;
  max-height: 45vh;
  overflow-y: auto;
}

.canvas-context-menu {
  position: absolute;
  z-index: 20;
  min-width: 140px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
}

.canvas-context-menu__item {
  display: flex;
  align-items: center;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.canvas-context-menu__item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.canvas-context-menu__item--danger {
  color: rgb(176, 0, 32);
}

.canvas-context-menu__item--danger:hover {
  background: rgba(176, 0, 32, 0.08);
}
</style>
