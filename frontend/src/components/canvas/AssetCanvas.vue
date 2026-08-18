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
      <!-- 工具栏（视图缩放/撤销重做/自动搭画布/添加节点 + 保存状态） -->
      <CanvasToolbar
        :can-undo="canUndo"
        :can-redo="canRedo"
        :auto-building="autoBuilding"
        :saving="saving"
        :dirty="dirty"
        @fit="fitView"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @undo="undo"
        @redo="redo"
        @auto-build="onAutoBuild"
        @add="(e: MouseEvent) => openAddMenuAt(e, 80, 80)"
      />

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
            <CanvasNodeCard
              v-if="nodeMap[id]"
              :node="nodeMap[id]"
              :project="props.project"
              :selected="selected"
              :status="statusByNode[id]"
              :output="outputOf(nodeMap[id])"
              :upstream-updated="isUpstreamUpdated(id)"
              :renaming="renamingNodeId === id"
              :rename-value="renameInput"
              @update:config="(patch: Record<string, unknown>) => onUpdateConfig(id, patch)"
              @open-picker="openAssetPicker"
              @retry="generateNode"
              @interrupt="onInterrupt"
              @start-rename="startRename"
              @update:rename-value="onRenameInput"
              @commit-rename="commitRename"
              @cancel-rename="cancelRename"
              @resize-end="onNodeResizeEnd"
              @context-menu="(e: MouseEvent) => openNodeContextMenu(e, id)"
            />
          </template>
        </VueFlow>

        <!-- 节点配置悬浮面板（独立于节点，位于节点正下方，随视图联动；带淡入淡出） -->
        <CanvasEditorPanel
          :visible="editorPanelVisible"
          :project="props.project"
          :node="editorPanel?.node ?? null"
          :editor-component="editorPanel?.editorComponent ?? null"
          :inputs="editorPanel ? inputsOf(editorPanel.node.id) : []"
          :output="editorPanel ? outputOf(editorPanel.node) : null"
          :video-input-groups="videoInputGroups"
          :is-running="editorPanel ? isNodeRunning(editorPanel.node.id) : false"
          :kind="target.kind"
          :viewport="viewport"
          :flow-width="flowWidth"
          :flow-height="flowHeight"
          @update:config="(patch: Record<string, unknown>) => editorPanel && onUpdateConfig(editorPanel.node.id, patch)"
          @generate="generateNode"
          @interrupt="onInterrupt"
          @open-history="openHistory"
          @set-as-scene="openSetAsScene"
          @open-picker="openAssetPicker"
          @extract="extractNodeFrame"
          @set-as-video="openSetAsShotVideo"
        />

        <!-- 右键菜单（节点 + 连线） -->
        <CanvasContextMenu
          :node-menu="contextMenu"
          :can-generate="canGenerateOf(contextMenuNode)"
          :has-history="hasHistoryOf(contextMenuNode)"
          :can-save="canSaveAsAsset(contextMenuNode)"
          :has-connections="!!contextMenuNode && nodeHasConnections(contextMenu.nodeId)"
          :edge-menu="edgeMenu"
          @generate="contextGenerate"
          @history="contextHistory"
          @save-asset="contextSaveAsset"
          @disconnect="contextDisconnect"
          @rename="contextRename"
          @copy="contextCopy"
          @delete="contextDelete"
          @disconnect-edge="disconnectEdge"
        />

        <!-- 添加节点菜单（双击空白处/工具栏「＋」在鼠标处弹出） -->
        <CanvasAddNodeMenu
          :model-value="addMenu.show"
          :x="addMenu.x"
          :y="addMenu.y"
          @update:model-value="addMenu.show = $event"
          @select="addNodeAt"
        />
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
        <div class="text-body-medium">
          画布为空
        </div>
        <div class="text-body-small text-medium-emphasis">
          双击空白处或点击工具栏「＋」添加节点
        </div>
      </div>

      <!-- 版本历史对话框（服务端历史 API：列表/激活/删除 + 当前产物预览） -->
      <CanvasAssertHistoryDialog
        v-model="historyDialog.show"
        :project="props.project"
        :node="historyNode"
        :output="historyNode ? outputOf(historyNode) : null"
        @refresh="(nodeId: string) => void refreshNodeOutput(nodeId)"
        @notify="(text: string, color: 'success' | 'error' | 'primary') => showSnackbar(text, color)"
      />

      <!-- 保存为自定义资产对话框（场景/分镜双根 + 新建目录） -->
      <SaveAssetDialog
        v-model="saveDialog.show"
        :project="props.project"
        :kind="target.kind"
        :stage="props.stage"
        :episode="props.episode"
        :shot="props.shot"
        :node-name="saveDialogNode?.name ?? ''"
        :source-path="saveSourcePath"
        @saved="(p: string) => showSnackbar(`已保存到 ${p}`, 'success')"
        @save-error="(msg: string) => showSnackbar(msg, 'error')"
      />

      <!-- 设为分镜场景图对话框 -->
      <SetAsSceneDialog
        v-model="sceneDialog.show"
        :project="props.project"
        :node="sceneDialogNode ?? null"
        :output="sceneDialogNode ? outputOf(sceneDialogNode) : null"
        :inputs="sceneDialogNode ? inputsOf(sceneDialogNode.id) : []"
        :episode="target.kind === 'scene' ? target.episode : undefined"
        :shot="target.kind === 'scene' ? target.shot : undefined"
        @done="(msg: string, color: 'success' | 'error') => showSnackbar(msg, color)"
      />

      <!-- 资产选择器（加载图片/音频/视频节点绑定资产） -->
      <AssetPickerDialog
        v-model="picker.show"
        :project="props.project"
        :multiple="false"
        :tabs="pickerTabs"
        :show-voice="picker.showVoice"
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
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { VueFlow, useVueFlow, type EdgeMouseEvent, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { useCanvasStore } from '../../canvas/useCanvasStore'
import { useCanvasGeneration } from '../../canvas/useCanvasGeneration'
import { useAutoComputeHeight } from '../../composables/useAutoComputeHeight'
import type { CanvasNodeData } from '../../canvas/types'
import { getNodeCurrentAssetPath } from '../../canvas/generate'
import { getCanvasNodeInfo } from '../../canvas/api'
import type { CanvasScope } from '../../canvas/paths'
import AssetPickerDialog from '../asset-picker/AssetPickerDialog.vue'
import CanvasAssertHistoryDialog from './CanvasAssertHistoryDialog.vue'
import SaveAssetDialog from './SaveAssetDialog.vue'
import CanvasToolbar from './CanvasToolbar.vue'
import CanvasNodeCard from './CanvasNodeCard.vue'
import CanvasEditorPanel from './CanvasEditorPanel.vue'
import CanvasContextMenu from './CanvasContextMenu.vue'
import CanvasAddNodeMenu from './CanvasAddNodeMenu.vue'
import SetAsSceneDialog from './SetAsSceneDialog.vue'
import { useCanvasFlow } from './composables/useCanvasFlow'
import { useCanvasSelection } from './composables/useCanvasSelection'
import { useCanvasMenus } from './composables/useCanvasMenus'
import { useCanvasRename } from './composables/useCanvasRename'
import { useCanvasPaste } from './composables/useCanvasPaste'
import { useCanvasKeyboard } from './composables/useCanvasKeyboard'
import { useCanvasNodeOps } from './composables/useCanvasNodeOps'
import { useCanvasDialogs } from './composables/useCanvasDialogs'
import { useCanvasAutobuild } from './composables/useCanvasAutobuild'

/**
 * 资产画布主组件（编排层）：
 * - 组合 store / generation 与各功能组合式（交互/菜单/粘贴/快捷键/生成调度/对话框/自动搭画布）；
 * - 渲染 Vue Flow 画布与子组件（工具栏/节点卡片/配置面板/菜单/对话框）；
 * - 持有 Vue Flow 视图工具与画布容器测量，统一注入各组合式与面板组件。
 * 具体交互行为见 docs/asset-canvas.md。
 */

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

/** 画布作用域（生成类节点产物固定路径推导/输入收集需要） */
const scope = computed<CanvasScope>(() => {
  if (props.kind === 'stage') {
    return { kind: 'stage', primary: props.stage ?? '', label: props.label }
  }
  return { kind: 'scene', primary: props.episode ?? '', secondary: props.shot }
})

/** 画布数据 store：加载/保存/增删改查/撤销重做 */
const store = useCanvasStore(props.project, target.value)
/**
 * 资产生成组合式：跑工作流 + 轮询（纯体验层）+ 结果通知 + 运行中任务持久化恢复。
 * onResult 为恢复任务完成后的默认结果回调（正常生成路径仍按调用传入的回调优先）。
 */
const gen = useCanvasGeneration(props.project, target.value, { onResult: handleNodeResult })
const { statusByNode } = gen
const { loaded, nodes, dirty, saving, canUndo, canRedo, undo, redo } = store

// ── 节点产物展示状态（固定路径 + 服务端 mtime；"当前结果"为文件系统事实）────────

/** nodeId → { 产物路径, mtime, exists }（画布加载与生成完成时从服务端 node-info 刷新） */
const nodeOutputs = ref<Record<string, { path: string; mtime: number | null; exists: boolean }>>({})

/** 刷新单个节点产物信息（存在性/mtime） */
async function refreshNodeOutput(nodeId: string): Promise<void> {
  const node = nodeMap.value[nodeId]
  if (!node) return
  const path = getNodeCurrentAssetPath(node, scope.value)
  if (!path) return
  const info = await getCanvasNodeInfo(props.project, path).catch(
    () => ({ exists: false, mtime: null, size: null }) as { exists: boolean; mtime: number | null; size: number | null },
  )
  nodeOutputs.value = { ...nodeOutputs.value, [nodeId]: { path, mtime: info.mtime, exists: info.exists } }
}

/** 刷新整张画布全部节点的产物信息（加载/切换目标后调用） */
async function refreshNodeOutputs(): Promise<void> {
  const scopeVal = scope.value
  const next: Record<string, { path: string; mtime: number | null; exists: boolean }> = {}
  await Promise.all(
    store.nodes.value.map(async (n) => {
      const path = getNodeCurrentAssetPath(n, scopeVal)
      if (!path) return
      const info = await getCanvasNodeInfo(props.project, path).catch(
        () => ({ exists: false, mtime: null, size: null }) as { exists: boolean; mtime: number | null; size: number | null },
      )
      next[n.id] = { path, mtime: info.mtime, exists: info.exists }
    }),
  )
  nodeOutputs.value = next
}

/** 生成完成回调：产物已由服务端落盘，刷新该节点展示（先乐观更新，再取真实 mtime） */
function handleNodeResult(nodeId: string, outputPath: string): void {
  nodeOutputs.value = { ...nodeOutputs.value, [nodeId]: { path: outputPath, mtime: Date.now(), exists: true } }
  void refreshNodeOutput(nodeId)
}

/**
 * 节点当前产物（供节点卡片/编辑器/对话框展示预览）。
 * 生成类节点按固定产物路径推导；加载类读 assetPath；均以服务端 mtime 作缓存键。
 * 产物文件不存在（exists=false）时返回 null（调用方按 null 显示「生成」占位态）。
 *
 * @param node 节点数据
 * @returns { path, token } 或 null（无产物）
 */
function outputOf(node: CanvasNodeData): { path: string; token?: number } | null {
  const o = nodeOutputs.value[node.id]
  if (o?.exists) return { path: o.path, token: o.mtime ?? undefined }
  return null
}

/** 查询节点产物 mtime（上游更新角标用） */
function getOutputMtime(nodeId: string): number | null | undefined {
  const o = nodeOutputs.value[nodeId]
  return o?.exists ? o.mtime : undefined
}

/** Vue Flow 视图控制：适应/缩放/屏幕坐标换算/程序化选中 */
const { fitView, zoomIn, zoomOut, screenToFlowCoordinate, viewport, findNode, addSelectedNodes } = useVueFlow()

/** 画布根节点 DOM（用于自动计算高度铺满页面） */
const canvasRef = ref<HTMLElement | null>(null)

/** 画布高度自适应：铺满页面剩余空间（随窗口/布局变化自动更新） */
const { targetHeight, updateHeight } = useAutoComputeHeight({
  autoComputeHeight: true,
  computeTarget: () => canvasRef.value,
  observeTarget: () => canvasRef.value ?? document.body,
  offset: 0,
})

/** 画布容器 DOM（用于右键菜单/添加节点菜单定位与可视区测量） */
const flowEl = ref<HTMLDivElement | null>(null)

/** 画布可视区当前尺寸（像素，配置面板边界钳制用） */
const flowHeight = ref(0)
const flowWidth = ref(0)

// ── 操作反馈（snackbar 由主组件持有并注入各组合式）────────

/** 操作反馈提示状态 */
const snackbar = reactive({ show: false, text: '', color: 'primary' })

/** 显示操作反馈提示 */
function showSnackbar(text: string, color: 'success' | 'error' | 'primary' = 'primary'): void {
  snackbar.text = text
  snackbar.color = color
  snackbar.show = true
}

// ── 节点索引（各组合式共享）──────────────────────────────

/** 节点 id → 节点数据（模板内直接索引） */
const nodeMap = computed<Record<string, CanvasNodeData>>(() => {
  const m: Record<string, CanvasNodeData> = {}
  for (const n of store.nodes.value) m[n.id] = n
  return m
})

// ── 组合式组装（依赖顺序：rename → selection → nodeOps → flow → dialogs → menus → paste → keyboard → autobuild）──

/** 节点名称内联重命名 */
const rename = useCanvasRename({ store, nodeMap })

/** 选中状态与配置面板信息 */
const selection = useCanvasSelection({ store })

/** 生成调度与输入收集 */
const nodeOps = useCanvasNodeOps({
  store,
  gen,
  nodeMap,
  showSnackbar,
  getSelectedNode: () => selection.editorPanel.value?.node ?? null,
  getScope: () => scope.value,
  onNodeResult: handleNodeResult,
  getOutputMtime,
})

/** Vue Flow 渲染映射与连线交互 */
const flow = useCanvasFlow({ store, nodeMap, project: props.project, selectedEdgeId: selection.selectedEdgeId })

/** 对话框与资产选择器 */
const dialogs = useCanvasDialogs({ store, nodeMap, project: props.project, target, getScope: () => scope.value, showSnackbar })

/** 右键菜单与添加节点菜单 */
const menus = useCanvasMenus({
  store,
  nodeMap,
  selection: { setSelectedNode: selection.setSelectedNode, deleteNode: selection.deleteNode },
  rename: { startRename: rename.startRename },
  dialogs: { openHistory: dialogs.openHistory, openSaveAsset: dialogs.openSaveAsset },
  generate: (nodeId: string) => void nodeOps.generateNode(nodeId),
})

/** 剪贴板粘贴（文件/文本/画布内复制节点） */
const paste = useCanvasPaste({
  store,
  project: props.project,
  flowEl,
  screenToFlowCoordinate,
  findNode,
  addSelectedNodes,
  selection: { setSelectedNode: selection.setSelectedNode, setSuppressPanelOnSelect: selection.setSuppressPanelOnSelect },
  showSnackbar,
})

/** 键盘快捷键 */
const keyboard = useCanvasKeyboard({
  store,
  selection: { selectedNodeId: selection.selectedNodeId, selectedEdgeId: selection.selectedEdgeId, deleteNode: selection.deleteNode },
  menus: { closeAll: menus.closeAll },
  rename: { cancelRename: rename.cancelRename },
  handleCtrlV: paste.handleCtrlV,
})

/** 自动搭画布 */
const autobuild = useCanvasAutobuild({ store, nodeMap, project: props.project, target, showSnackbar })

// 组合式导出解构（模板绑定用）
const { renamingNodeId, renameInput, startRename, commitRename, cancelRename } = rename
const { editorPanel, suppressEditor, suppressPanelOnSelect, onEdgeClick, onNodeDragStart } = selection
const { generateNode, onInterrupt, extractNodeFrame, isNodeRunning, inputsOf, videoInputGroups, isUpstreamUpdated, onUpdateConfig } = nodeOps
const { flowNodes, flowEdges, onNodeDragStop, onNodeResizeEnd, isValidConnection, onConnect, onEdgesChange, edgeMenu, disconnectEdge } = flow
const { historyDialog, historyNode, saveDialog, saveDialogNode, saveSourcePath, sceneDialog, sceneDialogNode, openSetAsScene, openSetAsShotVideo, picker, pickerTabs, openAssetPicker, onPickerConfirm, openHistory } = dialogs
const { contextMenu, contextMenuNode, canGenerateOf, hasHistoryOf, canSaveAsAsset, contextGenerate, contextHistory, contextSaveAsset, nodeHasConnections, contextDisconnect, contextRename, contextCopy, contextDelete, addMenu, addNodeAt } = menus
const { autoBuilding, autoBuild } = autobuild

/** 配置面板可见性：选中且未被拖拽/程序化选中抑制 */
const editorPanelVisible = computed(
  () => !!editorPanel.value && !suppressEditor.value && !suppressPanelOnSelect.value,
)

/** 内联重命名输入：写入 rename 组合式的临时值（卡片输入框上抛） */
function onRenameInput(value: string): void {
  renameInput.value = value
}

// ── 跨组合式接线（菜单互斥关闭/双击加节点）────────────────

/** 节点右键（卡片事件 → 打开右键菜单） */
function openNodeContextMenu(event: MouseEvent, nodeId: string): void {
  menus.openContextMenu(event, nodeId, flowEl.value)
}

/** 节点点击：选中 + 关闭全部菜单（允许显示配置面板） */
function onNodeClick(payload: NodeMouseEvent): void {
  selection.onNodeClick(payload)
  menus.closeAll()
}

/** 空白处点击：取消选中/关闭菜单；双击在鼠标处弹出添加节点菜单 */
function onPaneClick(event: MouseEvent): void {
  selection.onPaneClick()
  menus.closeAll()
  if (event.detail >= 2) {
    const p = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    menus.openAddMenu(event, Math.round(p.x - 60), Math.round(p.y - 40), flowEl.value)
  }
}

/** 连线右键：记录选中 + 打开连线菜单（同时关闭节点右键菜单） */
function onEdgeContextMenu(payload: EdgeMouseEvent): void {
  flow.onEdgeContextMenu(payload, flowEl.value)
  menus.closeNodeMenu()
}

/** 工具栏「＋」：在固定流坐标弹出添加节点菜单 */
function openAddMenuAt(event: MouseEvent, flowX: number, flowY: number): void {
  menus.openAddMenu(event, flowX, flowY, flowEl.value)
}

/** 自动搭画布：完成后刷新节点产物展示（复制既有图片到固定产物路径后立即可见） */
async function onAutoBuild(): Promise<void> {
  await autoBuild()
  await refreshNodeOutputs()
}

// ── 生命周期 ────────────────────────────────────────────

/** 切换分镜/场景时：重置各组合式状态，并让 store/生成组合式切换到新目标加载 */
watch(target, async (newTarget) => {
  selection.reset()
  rename.reset()
  menus.reset()
  flow.closeEdgeMenu()
  paste.reset()
  dialogs.resetAll()
  await gen.switchTarget(newTarget)
  await store.switchTarget(newTarget)
  // 新画布加载后刷新全部节点产物信息（固定路径 + mtime；异步任务已由服务端落盘的结果直接可见）
  await refreshNodeOutputs()
})

/** 组件是否已卸载（异步 load 完成后不再恢复任务，避免卸载后残留轮询定时器） */
let disposed = false

onMounted(() => {
  window.addEventListener('keydown', keyboard.onKeydown)
  window.addEventListener('paste', paste.onPaste)
  window.addEventListener('resize', updateHeight)
  void store.load().then(() => {
    void refreshNodeOutputs()
    // 恢复持久化的运行中任务：离开画布/刷新前未完成的任务继续显示 loading 并跟踪到终态
    if (!disposed) void gen.restore()
  })
})

onUnmounted(() => {
  disposed = true
  window.removeEventListener('keydown', keyboard.onKeydown)
  window.removeEventListener('paste', paste.onPaste)
  window.removeEventListener('resize', updateHeight)
  flowResizeObserver?.disconnect()
  flowResizeObserver = null
  // 停止轮询/清理生成状态（localStorage 记录保留：重新进入画布时由 restore 恢复）
  gen.reset()
})

// 画布容器尺寸变化 → 更新可视区尺寸（配置面板边界钳制用；面板自身高度由面板组件自测）
let flowResizeObserver: ResizeObserver | null = null
watch(flowEl, (flow) => {
  flowResizeObserver?.disconnect()
  if (flow) {
    flowResizeObserver ??= new ResizeObserver(() => {
      flowHeight.value = flowEl.value?.clientHeight ?? 0
      flowWidth.value = flowEl.value?.clientWidth ?? 0
    })
    flowResizeObserver.observe(flow)
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
</style>