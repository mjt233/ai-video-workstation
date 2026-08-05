<template>
  <div
    ref="canvasRef"
    class="asset-canvas"
    :style="{ height: `${targetHeight}px` }"
  >
    <div
      v-if="stageNoLabel"
      class="d-flex align-center justify-center text-grey"
      style="min-height: 200px;"
    >
      请从左侧资产浏览器选择子场景
    </div>
    <template v-else>
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
          @click="openAddMenu($event, 80, 80)"
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
          @edge-context-menu="onEdgeContextMenu"
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
              <!-- 节点名称头部（双击名称进入内联编辑） -->
              <div class="canvas-node__header">
                <span
                  v-if="renamingNodeId !== id"
                  class="text-caption font-weight-medium canvas-node__name"
                  title="双击重命名"
                  @dblclick.stop="startRename(id)"
                >
                  {{ nodeMap[id].name }}
                </span>
                <input
                  v-else
                  ref="nameInputEl"
                  v-model="renameInput"
                  class="canvas-node__name-input"
                  @click.stop
                  @dblclick.stop
                  @keyup.enter="commitRename(id)"
                  @keyup.esc="cancelRename"
                  @blur="commitRename(id)"
                >
              </div>
              <template
                v-for="(port, idx) in (protoOf(id)?.inputPorts ?? [])"
                :key="port.id"
              >
                <Handle
                  :id="port.id"
                  type="target"
                  :position="Position.Left"
                  class="canvas-node__handle"
                  :style="handleStyle(protoOf(id)?.inputPorts.length ?? 1, idx)"
                />
              </template>
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
              <template
                v-for="(port, idx) in (protoOf(id)?.outputPorts ?? [])"
                :key="port.id"
              >
                <Handle
                  :id="port.id"
                  type="source"
                  :position="Position.Right"
                  class="canvas-node__handle"
                  :style="handleStyle(protoOf(id)?.outputPorts.length ?? 1, idx)"
                />
              </template>
            </div>
          </template>
        </VueFlow>

        <!-- 节点配置悬浮面板（独立于节点，位于节点正下方，随视图联动；带淡入淡出） -->
        <Transition name="editor-panel">
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
              :inputs="editorPanel ? inputsOf(editorPanel.node.id) : []"
              :images-inputs="videoInputGroups.images"
              :videos-inputs="videoInputGroups.videos"
              :audios-inputs="videoInputGroups.audios"
              :is-running="editorPanel ? isNodeRunning(editorPanel.node.id) : false"
              :kind="target.kind"
              @update:config="(patch: Record<string, unknown>) => editorPanel && onUpdateConfig(editorPanel.node.id, patch)"
              @generate="generateNode"
              @interrupt="onInterrupt"
              @open-history="openHistory"
              @set-as-scene="openSetAsScene"
              @open-picker="openAssetPicker"
            />
          </div>
        </Transition>

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
            v-if="contextMenuNode && nodeHasConnections(contextMenu.nodeId)"
            class="canvas-context-menu__item"
            @click="contextDisconnect"
          >
            <v-icon
              size="small"
              class="mr-2"
            >
              mdi-link-off
            </v-icon>
            断开连接
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

        <!-- 连线右键菜单（断开连接） -->
        <div
          v-if="edgeMenu.show"
          class="canvas-context-menu"
          :style="{ left: `${edgeMenu.x}px`, top: `${edgeMenu.y}px` }"
        >
          <div
            class="canvas-context-menu__item canvas-context-menu__item--danger"
            @click="disconnectEdge"
          >
            <v-icon
              size="small"
              class="mr-2"
            >
              mdi-link-off
            </v-icon>
            断开连接
          </div>
        </div>

        <!-- 添加节点菜单锚点：0×0 隐藏定位点，供 VMenu 在鼠标双击处定位 -->
        <div
          ref="addMenuAnchorEl"
          class="add-menu-anchor"
          :style="{ left: `${addMenu.x}px`, top: `${addMenu.y}px` }"
        />
        <!-- 添加节点菜单：双击空白处/工具栏「＋」在鼠标处弹出，选择要添加的节点原型 -->
        <v-menu
          v-model="addMenu.show"
          :activator="addMenuActivator"
          location="bottom start"
          :open-on-click="false"
          min-width="180"
        >
          <v-list
            density="compact"
            nav
          >
            <v-list-subheader class="add-menu__title">
              添加节点
            </v-list-subheader>
            <v-list-item
              v-for="p in NODE_PROTOTYPES"
              :key="p.id"
              :title="p.name"
              :prepend-icon="p.icon"
              @click="addNodeAt(p.id)"
            />
          </v-list>
        </v-menu>
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

      <!-- 重命名对话框：已由节点名称双击内联编辑取代 -->

      <!-- 版本历史对话框（大图预览 + 激活为当前） -->
      <CanvasAssertHistoryDialog
        v-model="historyDialog.show"
        :project="props.project"
        :node="historyNode"
        @activate="onActivateHistory"
        @delete="onDeleteHistory"
      />

      <!-- 设为分镜场景图对话框 -->
      <v-dialog
        v-model="sceneDialog.show"
        max-width="620"
      >
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon
              class="mr-2"
              size="small"
            >
              mdi-image-multiple
            </v-icon>
            <span>设为分镜场景图</span>
          </v-card-title>
          <v-card-text>
            <div
              v-if="sceneDialog.loading"
              class="text-grey text-body-2"
            >
              加载中…
            </div>
            <template v-else>
              <div class="text-caption text-medium-emphasis mb-2">
                点击场景帧进入选中状态，再点击「确认」设为场景图（共 {{ sceneDialog.frames.length }} 帧）：
              </div>
              <div
                v-if="sceneDialog.frames.length"
                class="d-flex flex-wrap ga-2 mb-2"
              >
                <div
                  v-for="f in sceneDialog.frames"
                  :key="f.index"
                  class="scene-frame-option"
                  :class="{ 'scene-frame-option--selected': sceneDialog.selectedIndex === f.index }"
                  @click="sceneDialog.selectedIndex = sceneDialog.selectedIndex === f.index ? null : f.index"
                >
                  <div class="scene-frame-option__img-wrap">
                    <v-icon
                      v-if="sceneDialog.selectedIndex === f.index"
                      class="scene-frame-option__check"
                      icon="mdi-check-circle"
                      size="small"
                    />
                    <img
                      v-if="!f.broken"
                      :src="f.imageUrl"
                      class="scene-frame-option__img"
                      @error="f.broken = true"
                    >
                    <div
                      v-else
                      class="scene-frame-option__img scene-frame-option__img--empty"
                    >
                      <v-icon icon="mdi-image-off-outline" />
                    </div>
                  </div>
                  <div
                    class="scene-frame-option__label"
                    :title="f.label"
                  >
                    场景{{ f.index + 1 }}：{{ f.label }}
                  </div>
                </div>
              </div>
              <div
                v-else
                class="text-grey text-body-2 mb-2"
              >
                当前分镜还没有场景图定义（stage.json 为空）
              </div>
              <div class="d-flex align-center ga-2">
                <v-btn
                  size="small"
                  color="primary"
                  variant="tonal"
                  prepend-icon="mdi-plus"
                  :disabled="!sceneDialog.canAdd"
                  @click="applySetAsScene(null)"
                >
                  新增场景图
                </v-btn>
                <span
                  v-if="!sceneDialog.canAdd"
                  class="text-caption text-grey"
                >
                  无可用的基础场景引用，可先在「场景图片」页签添加场景帧
                </span>
              </div>
            </template>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              variant="text"
              @click="sceneDialog.show = false"
            >
              取消
            </v-btn>
            <v-btn
              color="primary"
              variant="tonal"
              prepend-icon="mdi-check"
              :disabled="sceneDialog.selectedIndex === null"
              @click="confirmSetAsScene"
            >
              确认
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <!-- 资产选择器（加载图片节点绑定资产） -->
      <AssetPickerDialog
        v-model="picker.show"
        :project="props.project"
        :multiple="false"
        :tabs="['stage', 'character', 'custom', 'scene-stage']"
        :context-episode="target.kind === 'scene' ? target.episode : undefined"
        :context-shot="target.kind === 'scene' ? target.shot : undefined"
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
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
import { activateHistory, collectInputPaths, collectInputs, getNodeCurrentAssetPath, removeHistoryEntry, type CanvasInputInfo, type HistoryEntry } from '../../canvas/generate'
import { buildVideoSubmitParams } from '../../canvas/videoSubmit'
import {
  buildAutoCanvas,
  buildShotRefsFromStage,
  buildSubSceneAutoCanvas,
  deriveStageRefFromAssetPath,
  normalizeLegacyVariantPath,
  type AutoBuildRef,
  type StageVariantRef,
} from '../../canvas/autobuild'
import { copyFs, deleteFs, existsFs, readFs, type DirResponse } from '../../api/client'
import { createSceneStageFrame } from '../../api/assets'
import { useAutoComputeHeight } from '../../composables/useAutoComputeHeight'
import type { CanvasNodeData } from '../../canvas/types'
import { confirm } from '../../utils/confirm'
import AssetPickerDialog from '../asset-picker/AssetPickerDialog.vue'
import CanvasAssertHistoryDialog from './CanvasAssertHistoryDialog.vue'

/** 组件 props：定位一张画布 */
const props = defineProps<{
  project: string
  kind: 'stage' | 'scene'
  stage?: string
  /** 场景画布时的子场景标签 */
  label?: string
  episode?: string
  shot?: string
}>()

/** 画布目标（分镜画布需要 episode+shot，场景画布需要 stage+label） */
const target = computed(() => ({
  kind: props.kind,
  stage: props.stage,
  label: props.label,
  episode: props.episode,
  shot: props.shot,
}))

/** 场景画布未选择子场景时显示空状态 */
const stageNoLabel = computed(() => props.kind === 'stage' && !props.label)

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
 * 指定目标端口时按端口类型校验，否则回退到节点第一输入端口。
 *
 * @param conn Vue Flow 临时连接
 * @returns 可建立返回 true
 */
function isValidConnection(conn: Connection): boolean {
  if (!conn.source || !conn.target) return false
  return canConnectNodes(
    store.connections.value,
    conn.source,
    conn.target,
    store.nodes.value,
    conn.targetHandle ?? undefined,
  )
}

/** 连接成功：写入 store（记录端口 id；store 内部再次校验，失败忽略） */
function onConnect(conn: Connection) {
  if (!conn.source || !conn.target) return
  store.connect(conn.source, conn.target, conn.sourceHandle ?? undefined, conn.targetHandle ?? undefined)
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

/** 记录当前选中的连线（供 Delete 键/连线右键菜单断开） */
function onEdgeClick({ edge }: EdgeMouseEvent) {
  selectedEdgeId.value = edge.id
}

/** 连线右键菜单状态（断开连接） */
const edgeMenu = reactive({ show: false, x: 0, y: 0 })

/**
 * 打开连线右键菜单（相对画布容器定位）。
 *
 * @param payload Vue Flow 连线右键事件（含事件与连线）
 */
function onEdgeContextMenu({ event, edge }: EdgeMouseEvent) {
  // 阻止浏览器默认右键菜单，避免与自定义菜单叠加遮挡
  event.preventDefault()
  selectedEdgeId.value = edge.id
  contextMenu.show = false
  edgeMenu.show = true
  const rect = flowEl.value?.getBoundingClientRect()
  const clientX = 'clientX' in event ? event.clientX : 0
  const clientY = 'clientY' in event ? event.clientY : 0
  edgeMenu.x = Math.round(clientX - (rect?.left ?? 0))
  edgeMenu.y = Math.round(clientY - (rect?.top ?? 0))
}

/** 菜单：断开选中的连线 */
function disconnectEdge() {
  const id = selectedEdgeId.value
  edgeMenu.show = false
  if (id) store.disconnect(id)
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

/** 配置面板固定宽度（像素，屏幕坐标，不随缩放变化） */
const EDITOR_PANEL_WIDTH = 400
/** 生成图片节点配置面板固定宽度（更宽，屏幕坐标，不随缩放变化） */
const EDITOR_PANEL_WIDTH_GENERATE = 500
/** 生成视频节点配置面板固定宽度（导演台嵌入需要，屏幕坐标，不随缩放变化） */
const EDITOR_PANEL_WIDTH_VIDEO = 640
/** 配置面板与节点底部之间的垂直间距（像素，屏幕坐标，不随缩放变化） */
const EDITOR_PANEL_GAP = 12

/** 配置面板 DOM（用于测量实际高度以做边界钳制） */
const panelEl = ref<HTMLDivElement | null>(null)
/** 配置面板最近一次定位样式（离开动画期间沿用，避免跳位） */
const lastPanelStyle = ref<Record<string, string> | null>(null)
/** 配置面板当前实际高度（像素，屏幕坐标） */
const panelHeight = ref(0)
/** 画布可视区当前尺寸（像素） */
const flowHeight = ref(0)
const flowWidth = ref(0)
let panelResizeObserver: ResizeObserver | null = null

/** 配置面板定位：与节点水平居中对称（节点本体位于面板上方中间）；大小固定，不随缩放变化 */
const editorPanelStyle = computed(() => {
  const node = selectedNode.value
  if (!node) return lastPanelStyle.value
  const vp = viewport.value
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

// 缓存最近一次面板定位（离开动画期间沿用，避免跳位）
watch(editorPanelStyle, (style) => {
  if (style) lastPanelStyle.value = style
})

/** 点击节点：选中并关闭右键菜单/添加节点菜单（允许显示配置面板） */
function onNodeClick({ node }: NodeMouseEvent) {
  suppressEditor.value = false
  selectedNodeId.value = node.id
  contextMenu.show = false
  edgeMenu.show = false
  addMenu.show = false
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
  edgeMenu.show = false
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

/** 菜单：重命名（双击节点名称也可进入内联编辑） */
function contextRename() {
  const id = contextMenu.nodeId
  contextMenu.show = false
  if (id) startRename(id)
}

/** 节点是否关联了连线（驱动右键菜单「断开连接」显隐） */
function nodeHasConnections(nodeId: string): boolean {
  return store.connections.value.some((c) => c.fromNodeId === nodeId || c.toNodeId === nodeId)
}

/** 菜单：断开节点的所有连接 */
function contextDisconnect() {
  const id = contextMenu.nodeId
  contextMenu.show = false
  if (!id) return
  for (const c of store.connections.value.filter((x) => x.fromNodeId === id || x.toNodeId === id)) {
    store.disconnect(c.id)
  }
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
    edgeMenu.show = false
    renamingNodeId.value = ''
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

/** 添加节点菜单状态：show 控制显隐；x/y 为菜单锚点坐标（相对画布容器）；flowX/flowY 为新建节点放置的流坐标 */
const addMenu = reactive({ show: false, x: 0, y: 0, flowX: 80, flowY: 80 })
/** 添加节点菜单锚点元素（0×0 隐藏定位点，VMenu 依此在鼠标处弹出） */
const addMenuAnchorEl = ref<HTMLElement | null>(null)
/** VMenu 的定位锚点：去掉 null（activator 类型不接受 null，undefined 可接受），元素挂载后即可用 */
const addMenuActivator = computed(() => addMenuAnchorEl.value ?? undefined)

/**
 * 打开添加节点菜单：锚点定位到鼠标位置，并指定新建节点放置的流坐标。
 *
 * @param event 触发打开的鼠标事件（提供菜单弹出位置）
 * @param flowX 新建节点在画布流坐标系中的 x
 * @param flowY 新建节点在画布流坐标系中的 y
 */
function openAddMenu(event: MouseEvent, flowX: number, flowY: number) {
  const rect = flowEl.value?.getBoundingClientRect()
  addMenu.x = Math.round(event.clientX - (rect?.left ?? 0))
  addMenu.y = Math.round(event.clientY - (rect?.top ?? 0))
  addMenu.flowX = flowX
  addMenu.flowY = flowY
  addMenu.show = true
}

/** 按原型添加节点（关闭菜单） */
function addNodeAt(prototypeId: string) {
  store.addNode(prototypeId, addMenu.flowX, addMenu.flowY)
  addMenu.show = false
}

/** 空白处点击：单击关闭菜单，双击在鼠标处弹出添加节点菜单 */
function onPaneClick(event: MouseEvent) {
  contextMenu.show = false
  edgeMenu.show = false
  addMenu.show = false
  suppressEditor.value = false
  selectedNodeId.value = ''
  selectedEdgeId.value = ''
  if (event.detail >= 2) {
    const p = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    openAddMenu(event, Math.round(p.x - 60), Math.round(p.y - 40))
  }
}

// ── 节点名称内联重命名（双击节点名称编辑）──────────────────

/** 正在内联编辑名称的节点 id（空表示未在编辑） */
const renamingNodeId = ref('')
/** 内联编辑输入框的临时值 */
const renameInput = ref('')
/** 内联编辑输入框 DOM（用于聚焦与全选） */
const nameInputEl = ref<HTMLInputElement | null>(null)

/**
 * 进入节点名称内联编辑模式（双击节点名称触发）。
 *
 * @param nodeId 节点 id
 */
async function startRename(nodeId: string) {
  renamingNodeId.value = nodeId
  renameInput.value = nodeMap.value[nodeId]?.name ?? ''
  await nextTick()
  nameInputEl.value?.focus()
  nameInputEl.value?.select()
}

/**
 * 提交内联重命名（回车或失焦触发）；空名则放弃修改。
 *
 * @param nodeId 节点 id
 */
function commitRename(nodeId: string) {
  if (renamingNodeId.value !== nodeId) return
  const name = renameInput.value.trim()
  if (name) store.updateNode(nodeId, { name })
  renamingNodeId.value = ''
}

/** 取消内联重命名（Esc 触发） */
function cancelRename() {
  renamingNodeId.value = ''
}

// ── 版本历史 ────────────────────────────────────────────

const historyDialog = reactive({ show: false, nodeId: '' })

/** 历史对话框对应节点（store 更新后自动刷新，激活后「当前」标记随之更新） */
const historyNode = computed(() => nodeMap.value[historyDialog.nodeId] ?? null)

/** 打开版本历史对话框 */
function openHistory(nodeId: string) {
  historyDialog.nodeId = nodeId
  historyDialog.show = true
}

/**
 * 历史对话框「设为当前」：把选中历史版本激活为节点当前图片。
 * 仅改写 current 指针（history 不变），原当前图自动保留在历史中。
 *
 * @param entry 要激活的历史条目
 */
function onActivateHistory(entry: HistoryEntry) {
  const node = nodeMap.value[historyDialog.nodeId]
  if (!node) return
  store.updateNode(node.id, { config: activateHistory(node.config, entry) })
}

/**
 * 历史对话框「删除」：确认后删除该历史版本的图片文件，并从节点 history 中移除该条目。
 * 当前版本不可删除（对话框已禁用）；删除后对话框保持打开。
 *
 * @param entry 要删除的历史条目
 */
async function onDeleteHistory(entry: HistoryEntry) {
  const node = nodeMap.value[historyDialog.nodeId]
  if (!node) return
  const ok = await confirm({
    title: '删除历史版本',
    content: `确定删除历史版本 v${entry.version} 的图片文件吗？此操作不可撤销。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  try {
    await deleteFs(props.project, entry.path)
    store.updateNode(node.id, { config: removeHistoryEntry(node.config, entry.version) })
    showSnackbar(`已删除历史版本 v${entry.version}`, 'success')
  } catch (e) {
    showSnackbar(e instanceof Error ? e.message : '删除历史版本失败', 'error')
  }
}

// ── 生成联动 ────────────────────────────────────────────

/**
 * 触发生成节点：收集输入路径 → 注入 → 跑工作流，并把 current/history 回写节点配置。
 * 视频节点（video-generate）额外组装自包含提交参数后传给 generate。
 *
 * @param nodeId 生成节点 id
 */
async function generateNode(nodeId: string) {
  const node = nodeMap.value[nodeId]
  if (!node) return
  gen.clearStatus(nodeId)
  if (node.prototypeId === 'video-generate') {
    const videoParams = buildVideoSubmitParams(node, {
      images: videoInputsOf(nodeId, 'images'),
      videos: videoInputsOf(nodeId, 'videos'),
      audios: videoInputsOf(nodeId, 'audios'),
    })
    await gen.generate(
      node,
      (config) => {
        store.updateNode(nodeId, { config })
      },
      videoParams,
    )
    return
  }
  if (node.prototypeId !== 'image-generate') return
  const paths = collectInputPaths(nodeId, store.connections.value, store.nodes.value, node.config)
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

/** 节点当前输入资产信息（含来源节点，供编辑器预览/拖拽排序） */
function inputsOf(nodeId: string): CanvasInputInfo[] {
  const node = nodeMap.value[nodeId]
  return collectInputs(nodeId, store.connections.value, store.nodes.value, node?.config)
}

/**
 * 收集视频生成节点指定端口的输入资产（图片/视频/音频，按 config.inputOrder 排序）。
 *
 * @param nodeId 目标节点 id
 * @param portId 目标输入端口 id（images/videos/audios）
 * @returns 该端口输入资产信息数组
 */
function videoInputsOf(nodeId: string, portId: string): CanvasInputInfo[] {
  const node = nodeMap.value[nodeId]
  return collectInputs(nodeId, store.connections.value, store.nodes.value, node?.config, portId)
}

/** 视频生成节点三组端口输入（非 video-generate 节点为空数组；按 config.inputOrder 排序） */
const videoInputGroups = computed(() => {
  if (!editorPanel.value || editorPanel.value.node.prototypeId !== 'video-generate') {
    return { images: [] as CanvasInputInfo[], videos: [] as CanvasInputInfo[], audios: [] as CanvasInputInfo[] }
  }
  const id = editorPanel.value.node.id
  return {
    images: videoInputsOf(id, 'images'),
    videos: videoInputsOf(id, 'videos'),
    audios: videoInputsOf(id, 'audios'),
  }
})

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

/** 分镜场景帧选项（设为分镜场景图对话框） */
interface SceneFrameOption {
  index: number
  label: string
  imageUrl: string
  broken: boolean
}

/** 设为分镜场景图对话框状态 */
const sceneDialog = reactive<{
  show: boolean
  nodeId: string
  loading: boolean
  frames: SceneFrameOption[]
  canAdd: boolean
  newFrameBody: { 基础场景: string; 登场角色: string[]; prompt: string } | null
  /** 当前选中的场景帧下标；null 表示未选中 */
  selectedIndex: number | null
}>({
  show: false,
  nodeId: '',
  loading: false,
  frames: [],
  canAdd: false,
  newFrameBody: null,
  selectedIndex: null,
})

/**
 * 从生成节点的输入推导新场景帧的 stage.json 定义（无可用基础场景时返回 null）。
 * 基础场景优先取输入图中的 `assert/stage/{场景}/{标签}`，否则复用现有帧的基础场景。
 *
 * @param node 生成节点数据
 * @param stageDefs 现有场景帧定义
 * @returns 新帧定义或 null
 */
function deriveStageFrameBody(
  node: CanvasNodeData,
  stageDefs: { 基础场景?: string }[],
): { 基础场景: string; 登场角色: string[]; prompt: string } | null {
  const inputs = inputsOf(node.id)
  let baseScene = ''
  const characters: string[] = []
  for (const inp of inputs) {
    if (inp.path.startsWith('assert/stage/')) {
      const ref = deriveStageRefFromAssetPath(inp.path)
      if (ref && !baseScene) baseScene = ref
    } else if (inp.path.startsWith('assert/character/')) {
      const name = inp.path.slice('assert/character/'.length).split('/')[0]
      if (name && !characters.includes(name)) characters.push(name)
    }
  }
  if (!baseScene) {
    const first = stageDefs.find((d) => d.基础场景 && d.基础场景.trim())
    baseScene = first?.基础场景?.trim() ?? ''
  }
  if (!baseScene) return null
  const prompt = typeof node.config.prompt === 'string' ? node.config.prompt : ''
  // 有登场角色时必须提供 prompt，否则清空角色（服务端校验约束）
  const chars = characters.length > 0 && !prompt.trim() ? [] : characters
  return { 基础场景: baseScene, 登场角色: chars, prompt }
}

/**
 * 打开「设为分镜场景图」对话框：列出分镜现有场景帧供选择覆盖，或新增场景图。
 *
 * @param nodeId 生成节点 id
 */
async function openSetAsScene(nodeId: string) {
  if (target.value.kind !== 'scene') return
  const node = nodeMap.value[nodeId]
  if (!node) return
  sceneDialog.nodeId = nodeId
  sceneDialog.show = true
  sceneDialog.loading = true
  sceneDialog.frames = []
  sceneDialog.canAdd = false
  sceneDialog.newFrameBody = null
  sceneDialog.selectedIndex = null
  try {
    const raw = await readFs(props.project, `prompt/scene/${target.value.episode}/${target.value.shot}/stage.json`)
    let defs: { 基础场景?: string; prompt?: string }[] = []
    if (Array.isArray(raw)) {
      defs = raw as { 基础场景?: string; prompt?: string }[]
    } else if (typeof raw === 'string' && raw.trim()) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) defs = parsed as { 基础场景?: string; prompt?: string }[]
    }
    const ts = Date.now()
    sceneDialog.frames = defs.map((d, i) => {
      const label = d.基础场景 || (typeof d.prompt === 'string' && d.prompt ? d.prompt : `分镜场景图 ${i + 1}`)
      return {
        index: i,
        label,
        imageUrl: `/api/fs/${props.project}/assert/scene/${target.value.episode}/${target.value.shot}/stage/${i}.jpg?t=${ts}`,
        broken: false,
      }
    })
    sceneDialog.newFrameBody = deriveStageFrameBody(node, defs)
    sceneDialog.canAdd = sceneDialog.newFrameBody !== null
  } catch {
    // stage.json 不存在：按空帧处理，仅可新增（若有可用基础场景）
    sceneDialog.newFrameBody = deriveStageFrameBody(node, [])
    sceneDialog.canAdd = sceneDialog.newFrameBody !== null
  } finally {
    sceneDialog.loading = false
  }
}

/**
 * 确认「设为分镜场景图」：把当前选中的场景帧应用为分镜场景图。
 */
function confirmSetAsScene() {
  if (sceneDialog.selectedIndex === null) return
  const frame = sceneDialog.frames[sceneDialog.selectedIndex]
  if (frame) applySetAsScene(frame)
}

/**
 * 应用「设为分镜场景图」：覆盖选中帧，或新增场景图帧并复制当前产物。
 *
 * @param frame 要覆盖的帧；null 表示新增场景图
 */
async function applySetAsScene(frame: SceneFrameOption | null) {
  const node = nodeMap.value[sceneDialog.nodeId]
  const cur = node?.config.current as { path?: string } | undefined
  if (!node || !cur?.path) {
    sceneDialog.show = false
    return
  }
  const ep = target.value.episode
  const shot = target.value.shot
  try {
    if (frame) {
      await copyFs(props.project, cur.path, `assert/scene/${ep}/${shot}/stage/${frame.index}.jpg`)
    } else if (sceneDialog.newFrameBody) {
      const res = await createSceneStageFrame(props.project, ep ?? '', shot ?? '', sceneDialog.newFrameBody)
      await copyFs(props.project, cur.path, `assert/scene/${ep}/${shot}/stage/${res.index}.jpg`)
    }
    showSnackbar('已设为分镜场景图', 'success')
  } catch (e) {
    showSnackbar(e instanceof Error ? e.message : '设为分镜场景图失败', 'error')
  } finally {
    sceneDialog.show = false
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

/**
 * 修复旧版自动搭画布产生的错误变体路径加载节点（历史数据迁移）。
 * 旧代码把 `场景/标签@变体` 拼成 `assert/stage/{场景}/{标签}@{变体}.jpg`，
 * 规范路径为 `assert/stage/{场景}/variants/{标签}/{变体}.jpg`。
 * 仅当规范路径未被其他节点占用时修复，避免重复。
 */
function repairLegacyVariantLoaders(): void {
  for (const node of [...store.nodes.value]) {
    const ap = typeof node.config.assetPath === 'string' ? node.config.assetPath : ''
    const legacy = normalizeLegacyVariantPath(ap)
    if (!legacy) continue
    const alreadyPresent = store.nodes.value.some(
      (n) => n.id !== node.id && n.config.assetPath === legacy.canonical,
    )
    if (alreadyPresent) continue
    store.updateNode(node.id, { config: { ...node.config, assetPath: legacy.canonical } })
  }
}

/** 触发自动搭画布：分镜画布按 stage.json 引用；场景画布按子场景变体结构 */
async function autoBuild() {
  if (autoBuilding.value) return
  autoBuilding.value = true
  try {
    if (target.value.kind === 'stage') {
      const t = target.value
      const { baseAssetPath, variants } = await collectStageBuild()
      const outputBase = `assert/stage/${t.stage ?? ''}/canvas/${t.label ?? ''}`
      const result = buildSubSceneAutoCanvas(
        store.data.value,
        t.label ?? '',
        baseAssetPath,
        variants,
        80,
        80,
        outputBase,
      )
      // 变体已有生成图：把既有图片复制到节点产物目录（复制失败不阻塞搭画布）
      for (const node of result.nodes) {
        if (node.prototypeId !== 'image-generate') continue
        const autoRef = typeof node.config.autoRef === 'string' ? node.config.autoRef : ''
        const vId = autoRef.slice(autoRef.lastIndexOf('@') + 1)
        const cur = node.config.current as { path?: string } | undefined
        if (!vId || !cur?.path) continue
        try {
          await copyFs(
            props.project,
            `assert/stage/${t.stage ?? ''}/variants/${t.label ?? ''}/${vId}.jpg`,
            cur.path,
          )
        } catch {
          // 复制失败忽略（节点仍保留，用户可自行重新生成）
        }
      }
      store.applyNodes(result.nodes, result.connections)
      const anchorCount = result.nodes.filter((n) => n.prototypeId === 'image-loader').length
      showSnackbar(`已搭建 ${anchorCount} 个锚点节点`, 'success')
      return
    }
    const refs = await collectRefs()
    const prompt = await collectPrompt()
    // 修复旧版错误路径的加载节点（历史数据），避免与新规范路径重复
    repairLegacyVariantLoaders()
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
 * - 分镜画布：读 stage.json 提取角色/场景引用（含变体/custom），并异步解析 prev
 * - 场景画布：见 collectStageBuild
 *
 * @returns 锚点引用列表
 */
async function collectRefs(): Promise<AutoBuildRef[]> {
  const t = target.value
  if (t.kind === 'scene') {
    if (!t.episode || !t.shot) return []
    const raw = await readFs(props.project, `prompt/scene/${t.episode}/${t.shot}/stage.json`)
    const defs = Array.isArray(raw) ? (raw as unknown[]) : []
    const refs = buildShotRefsFromStage(defs)
    // prev：同集上一分镜最后一项 → assert/scene/{ep}/{shot-1}/stage/{last}.jpg
    const shotNum = Number(t.shot)
    const hasPrev = defs.some((d) => {
      const base = (d as { 基础场景?: string })?.基础场景
      return typeof base === 'string' && base.trim() === 'prev'
    })
    if (hasPrev && Number.isInteger(shotNum) && shotNum > 1) {
      const prevShot = String(shotNum - 1)
      try {
        const prevRaw = await readFs(props.project, `prompt/scene/${t.episode}/${prevShot}/stage.json`)
        if (Array.isArray(prevRaw) && prevRaw.length > 0) {
          refs.push({
            assetPath: `assert/scene/${t.episode}/${prevShot}/stage/${prevRaw.length - 1}.jpg`,
            label: '上一分镜场景图',
          })
        }
      } catch {
        // 读不到上一分镜定义则跳过 prev
      }
    }
    return refs
  }
  return []
}

/**
 * 收集场景画布自动搭所需数据：子场景基础图路径 + 该子场景全部衍生变体元数据。
 * 变体元数据：prompt/stage/{stage}/variants/{label}/{id}.json（desc/parentId/refs）。
 *
 * @returns 基础图路径与变体列表（variants 目录不存在时为空的变体列表）
 */
async function collectStageBuild(): Promise<{ baseAssetPath: string; variants: StageVariantRef[] }> {
  const t = target.value
  const stage = t.stage ?? ''
  const label = t.label ?? ''
  const baseAssetPath = `assert/stage/${stage}/${label}.jpg`
  const variants: StageVariantRef[] = []
  const variantsDir = `prompt/stage/${stage}/variants/${label}`
  try {
    const dir = (await readFs(props.project, variantsDir)) as DirResponse
    const metaFiles = (dir?.entries ?? []).filter((e) => e.type === 'file' && e.name.endsWith('.json'))
    for (const f of metaFiles) {
      const id = f.name.replace(/\.json$/, '')
      try {
        const meta = (await readFs(props.project, `${variantsDir}/${f.name}`)) as {
          desc?: string
          parentId?: string
          refs?: string[]
        }
        // 变体是否已有生成图（决定自动搭画布时是否复制既有图片作为节点当前产物）
        const hasImage = await existsFs(
          props.project,
          `assert/stage/${stage}/variants/${label}/${id}.jpg`,
        )
        variants.push({
          id,
          desc: String(meta?.desc ?? ''),
          parentId: typeof meta?.parentId === 'string' ? meta.parentId : undefined,
          refs: Array.isArray(meta?.refs) ? (meta.refs as string[]) : [],
          hasImage,
        })
      } catch {
        // 单个变体元数据读取失败则跳过
      }
    }
  } catch {
    // variants 目录不存在 → 无变体，只搭基础图
  }
  return { baseAssetPath, variants }
}

/**
 * 收集生成节点 prompt 初稿（仅分镜画布；场景画布由各变体 desc 提供）。
 *
 * @returns prompt 文本
 */
async function collectPrompt(): Promise<string> {
  const t = target.value
  if (t.kind !== 'scene' || !t.episode || !t.shot) return ''
  try {
    const raw = (await readFs(props.project, `prompt/scene/${t.episode}/${t.shot}/overview.json`)) as {
      visual?: unknown
    }
    return typeof raw?.visual === 'string' ? raw.visual : ''
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

/** 切换分镜/场景时：重置选中与菜单状态，并让 store/生成组合式切换到新目标加载 */
watch(target, async (newTarget) => {
  suppressEditor.value = false
  selectedNodeId.value = ''
  selectedEdgeId.value = ''
  renamingNodeId.value = ''
  contextMenu.show = false
  edgeMenu.show = false
  gen.switchTarget(newTarget)
  await store.switchTarget(newTarget)
})

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
  cursor: text;
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
    width .1s,
    height .1s,
    min-width .1s,
    min-height .1s,
    background-color .1s;
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

/* 添加节点菜单锚点：0×0 隐藏定位点，供 VMenu 在鼠标处弹出（不拦截画布交互） */
.add-menu-anchor {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
  visibility: hidden;
}

/* 添加节点菜单标题：加粗 + 底部细分隔线，与选项列表区分 */
.add-menu__title {
  font-weight: 500;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  margin-bottom: 2px;
  padding-bottom: 6px;
}

.scene-frame-option {
  width: 150px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.scene-frame-option:hover {
  border-color: rgb(25, 118, 210);
  box-shadow: 0 0 0 1px rgb(25, 118, 210);
}

.scene-frame-option--selected {
  border-color: rgb(25, 118, 210);
  box-shadow: 0 0 0 2px rgb(25, 118, 210);
}

.scene-frame-option__img-wrap {
  height: 100px;
  background: rgba(0, 0, 0, 0.04);
  position: relative;
}

.scene-frame-option__check {
  position: absolute;
  top: 4px;
  right: 4px;
  color: rgb(25, 118, 210);
  background: #fff;
  border-radius: 50%;
}

.scene-frame-option__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.scene-frame-option__img--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.38);
}

.scene-frame-option__label {
  padding: 4px 6px;
  font-size: 12px;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: #fff;
}
</style>
