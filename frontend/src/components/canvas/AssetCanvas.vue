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
      <!-- 工具栏（视图缩放/撤销重做/自动搭画布/添加节点 + 保存状态与版本号） -->
      <CanvasToolbar
        :can-undo="canUndo"
        :can-redo="canRedo"
        :auto-building="autoBuilding"
        :saving="saving"
        :dirty="dirty"
        :version="savedRev"
        :conflicted="!!conflict"
        @fit="onFitView"
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
        :class="{ 'asset-canvas__flow--asset-drag': assetDragOver }"
        @dragover="onCanvasAssetDragover"
        @dragleave="onCanvasAssetDragleave"
        @drop="onCanvasAssetDrop"
      >
        <VueFlow
          :nodes="flowNodes"
          :edges="flowEdges"
          :fit-view-on-init="false"
          :min-zoom="0.2"
          :max-zoom="3"
          :nodes-draggable="true"
          :is-valid-connection="isValidConnection"
          :delete-key-code="null"
          :zoom-on-double-click="false"
          :selection-mode="SelectionMode.Partial"
          @connect="onConnect"
          @edges-change="onEdgesChange"
          @node-click="onNodeClick"
          @edge-click="onEdgeClick"
          @edge-context-menu="onEdgeContextMenu"
          @node-drag-start="onNodeDragStart"
          @node-drag-stop="onNodeDragStop"
          @pane-click="onPaneClick"
          @selection-end="onSelectionEnd"
        >
          <Background :gap="16" />
          <!-- 连线渲染插槽：默认连线保持 BezierEdge 原样渲染（右键/点击/选中行为不变）；
               单选联动高亮的关联连线追加沿数据流向移动的箭头动画（输入侧绿色/输出侧橙色，
               箭头经 CSS offset-path 沿连线几何（bezier d）运动，offset-rotate: auto 随路径切线转向；
               方向即数据流方向：连线路径从 source→target 生成，无需单独定义） -->
          <template #edge-default="edgeProps">
            <BezierEdge v-bind="edgeProps" />
            <path
              v-if="edgeRelatedSide(edgeProps.id)"
              class="canvas-edge__arrow"
              :style="arrowMotionStyle(edgeProps)"
              d="M10,0 L0,-5 L2.5,0 L0,5 Z"
            />
          </template>
          <template #node-canvas="{ id, selected }">
            <CanvasNodeCard
              v-if="nodeMap[id]"
              :node="nodeMap[id]"
              :project="props.project"
              :selected="selected"
              :highlighted="hoveredNodeId === id"
              :adjacent-side="adjacentSideOf(id)"
              :status="statusByNode[id]"
              :is-running="nodeMap[id]?.prototypeId === 'text-ai' ? statusByNode[id]?.status === 'running' : undefined"
              :canvas-target="nodeMap[id]?.prototypeId === 'text-ai' ? canvasTarget : undefined"
              :output="outputOf(nodeMap[id])"
              :upload="upload.stateOf(id)"
              :upstream-updated="isUpstreamUpdated(id)"
              :inputs="nodeMap[id]?.prototypeId === 'text-ai' ? llmMediaInputsOf(id) : undefined"
              :text-inputs="nodeMap[id]?.prototypeId === 'text-ai' ? textInputsOf(id) : undefined"
              :renaming="renamingNodeId === id"
              :rename-value="renameInput"
              @update:config="(patch: Record<string, unknown>) => onUpdateConfig(id, patch)"
              @update:config-quiet="(patch: Record<string, unknown>) => onUpdateConfigQuiet(id, patch)"
              @update:output-view="(patch: Record<string, unknown>) => onUpdateOutputView(id, patch)"
              @stream-state="(nodeId: string, payload: CanvasStreamStatePayload) => onStreamState(nodeId, payload)"
              @open-history="openHistory"
              @disconnect-input="(nodeId: string, sourceNodeId: string) => disconnectInput(nodeId, sourceNodeId)"
              @open-picker="openAssetPicker"
              @upload-file="onUploadFile"
              @retry-upload="(nodeId: string) => void upload.retry(nodeId)"
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
          <!-- 群组虚线框（多选 ≥2 个节点；拖动整组由 Vue Flow 原生节点拖动承接） -->
          <template #node-group-frame>
            <CanvasGroupFrame @context-menu="(e: MouseEvent) => openGroupContextMenu(e)" />
          </template>
          <!-- 群组输出连接点（拖拽成组连接；mousedown 由 useCanvasGroup 承接） -->
          <template #node-group-dot>
            <CanvasGroupDot @mousedown="onDotMouseDown" />
          </template>
        </VueFlow>

        <!-- 成组连接预览线（输出点 → 鼠标；画布容器相对坐标） -->
        <svg
          v-if="connectLine"
          class="asset-canvas__group-connect-line"
        >
          <line
            :x1="connectLine.x1"
            :y1="connectLine.y1"
            :x2="connectLine.x2"
            :y2="connectLine.y2"
            stroke="rgb(25, 118, 210)"
            stroke-width="2"
            stroke-dasharray="6 4"
          />
        </svg>

        <!-- 成组连接拖拽提示（未命中目标时显示） -->
        <div
          v-if="connectDrag.active && !hoveredNodeId"
          class="asset-canvas__group-connect-hint"
          :style="{
            left: `${connectDrag.x - (flowEl?.getBoundingClientRect().left ?? 0) + 14}px`,
            top: `${connectDrag.y - (flowEl?.getBoundingClientRect().top ?? 0) + 14}px`,
          }"
        >
          拖到节点输入口连接；松开未命中节点即可选择新建目标节点
        </div>

        <!-- 节点配置悬浮面板（独立于节点，位于节点正下方，随视图联动；带淡入淡出） -->
        <CanvasEditorPanel
          :visible="editorPanelVisible"
          :project="props.project"
          :node="editorPanel?.node ?? null"
          :editor-component="editorPanel?.editorComponent ?? null"
          :inputs="editorPanel ? inputsOf(editorPanel.node.id) : []"
          :output="editorPanel ? outputOf(editorPanel.node) : null"
          :output-path="editorPanel ? outputPathOf(editorPanel.node) : undefined"
          :upload-state="editorPanel ? upload.stateOf(editorPanel.node.id) ?? null : null"
          :video-input-groups="videoInputGroups"
          :text-inputs="videoTextInputs"
          :is-running="editorPanel ? isNodeRunning(editorPanel.node.id) : false"
          :kind="target.kind"
          :viewport="viewport"
          :flow-width="flowWidth"
          :flow-height="flowHeight"
          @close="selection.dismissPanel()"
          @update:config="(patch: Record<string, unknown>) => editorPanel && onUpdateConfig(editorPanel.node.id, patch)"
          @generate="generateNode"
          @interrupt="onInterrupt"
          @open-history="openHistory"
          @set-as-scene="openSetAsScene"
          @open-picker="openAssetPicker"
          @extract="extractNodeFrame"
          @set-as-video="openSetAsShotVideo"
          @upload-file="onUploadFile"
          @disconnect-input="disconnectEditorInput"
        />

        <!-- 右键菜单（节点 + 连线 + 群组） -->
        <CanvasContextMenu
          :node-menu="contextMenu"
          :can-generate="canGenerateOf(contextMenuNode)"
          :has-history="hasHistoryOf(contextMenuNode)"
          :can-save="canSaveImage(contextMenuNode)"
          :save-targets="saveTargetsOf(contextMenuNode)"
          :has-connections="!!contextMenuNode && nodeHasConnections(contextMenu.nodeId)"
          :edge-menu="edgeMenu"
          :group-menu="groupMenu"
          @generate="contextGenerate"
          @history="contextHistory"
          @save-as="contextSaveAs"
          @disconnect="contextDisconnect"
          @rename="contextRename"
          @copy="contextCopy"
          @delete="contextDelete"
          @disconnect-edge="disconnectEdge"
          @group-copy="groupCopy"
          @group-delete="groupDelete"
        />

        <!-- 添加节点菜单（双击空白处/工具栏「＋」在鼠标处弹出） -->
        <CanvasAddNodeMenu
          :model-value="addMenu.show"
          :x="addMenu.x"
          :y="addMenu.y"
          @update:model-value="addMenu.show = $event"
          @select="addNodeAt"
        />

        <!-- 资产拖放菜单（从左侧资产浏览器拖入角色/子场景/道具后，在释放位置弹出；
             图片/音频/视频各占一行：媒体标签 + 横向滚动条目（缩略图/试听组件 + 条目名），
             点击条目名即在释放位置创建对应加载节点） -->
        <CanvasAssetDropMenu
          :model-value="drop.menu.show"
          :x="drop.menu.x"
          :y="drop.menu.y"
          :title="drop.menu.title"
          :groups="drop.menu.groups"
          :loading="drop.menu.loading"
          :bust="drop.menu.bust"
          :project="props.project"
          @update:model-value="drop.setShow"
          @select-item="drop.selectItem"
        />

        <!-- 群组连接目标选择菜单（输出点拖拽超阈值释放后弹出） -->
        <CanvasGroupConnectMenu
          :model-value="connectMenu.show"
          :x="connectMenu.x"
          :y="connectMenu.y"
          :items="menuItems"
          @update:model-value="connectMenu.show = $event"
          @select="createNodeFromMenu"
        />

        <!-- 保存版本冲突横幅（右上角）：
             自动保存已停止，提示用户手动备份当前画布或强制覆盖保存 -->
        <div
          v-if="conflict"
          class="canvas-conflict-banner"
        >
          <div class="canvas-conflict-banner__title">
            <v-icon
              icon="mdi-alert-octagon"
              size="18"
              class="mr-1"
              color="error"
            />
            画布保存冲突
          </div>
          <div class="canvas-conflict-banner__text">
            画布已被其他人或引用更新修改（当前版本 {{ conflict.currentRev }}，您基于版本 {{ conflict.expectedRev }}
            编辑），自动保存已停止。请手动备份当前画布，或选择强制覆盖保存。
          </div>
          <div class="canvas-conflict-banner__actions">
            <v-btn
              size="small"
              variant="outlined"
              prepend-icon="mdi-download"
              @click="downloadLocalBackup"
            >
              备份当前画布
            </v-btn>
            <v-btn
              size="small"
              color="primary"
              variant="tonal"
              prepend-icon="mdi-content-save-check"
              @click="forceDialog.show = true"
            >
              强制覆盖保存
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-reload"
              @click="reloadFromServerWithConfirm"
            >
              重新加载服务端版本
            </v-btn>
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
        <div class="text-body-medium">
          画布为空
        </div>
        <div class="text-body-small text-medium-emphasis">
          双击空白处或点击工具栏「＋」添加节点
        </div>
      </div>

      <!-- 文本历史版本对话框（AI 文本生成节点：config.outputHistory 纯文本快照，无服务端请求） -->
      <AiTextHistoryDialog
        v-if="historyNode?.prototypeId === 'text-ai'"
        v-model="historyDialog.show"
        :project="props.project"
        :node="historyNode"
        @update:config="(patch: Record<string, unknown>) => historyNode && onUpdateConfig(historyNode.id, patch)"
        @update:config-quiet="(patch: Record<string, unknown>) => historyNode && onUpdateConfigQuiet(historyNode.id, patch)"
        @notify="(text: string, color: 'success' | 'error' | 'primary') => showSnackbar(text, color)"
      />

      <!-- 版本历史对话框（服务端历史 API：列表/激活/删除 + 当前产物预览；适用于有产物文件的生成节点） -->
      <CanvasAssertHistoryDialog
        v-else
        v-model="historyDialog.show"
        :project="props.project"
        :node="historyNode"
        :output="historyNode ? outputOf(historyNode) : null"
        @refresh="(nodeId: string) => void refreshNodeOutput(nodeId)"
        @notify="(text: string, color: 'success' | 'error' | 'primary') => showSnackbar(text, color)"
      />

      <!-- 保存为自定义资产对话框（场景/分镜双根 + 新建目录 + 文件名可编辑） -->
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

      <!-- 保存为（角色设计/角色设计-衍生变体/场景图/场景图-衍生变体）目标选择对话框 -->
      <SaveAsDialog
        v-model="saveAsDialog.show"
        :project="props.project"
        :kind="target.kind"
        :stage="props.stage"
        :label="props.label"
        :episode="props.episode"
        :shot="props.shot"
        :type="saveAsDialog.type"
        :source-path="saveAsSourcePath"
        :node-prompt="saveAsDialogNode ? String(saveAsDialogNode.config?.prompt ?? '') : ''"
        @saved="(p: string) => showSnackbar(`已保存到 ${p}`, 'success')"
        @save-error="(msg: string) => showSnackbar(msg, 'error')"
      />

      <!-- 强制覆盖保存对话框：必须输入「确认覆盖」才可执行 -->
      <v-dialog
        v-model="forceDialog.show"
        max-width="460"
      >
        <v-card>
          <v-card-title>强制覆盖保存</v-card-title>
          <v-card-text>
            <p class="mb-2">
              画布已被其他人或引用更新修改。强制覆盖会把<b>当前画布内容整体写入</b>，
              服务端的最新更新（含分镜引用路径修正）将被你的版本<b>覆盖且不可恢复</b>。
            </p>
            <p class="mb-2">
              请先在冲突横幅中备份需要保留的内容，并在下方输入「确认覆盖」：
            </p>
            <v-text-field
              v-model="forceDialog.input"
              label="输入「确认覆盖」"
              variant="outlined"
              density="comfortable"
              autofocus
            />
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              variant="text"
              :disabled="forceDialog.saving"
              @click="forceDialog.show = false"
            >
              取消
            </v-btn>
            <v-btn
              color="error"
              :disabled="forceDialog.input.trim() !== '确认覆盖'"
              :loading="forceDialog.saving"
              @click="confirmForceSave"
            >
              确定
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <!-- 切换分镜/场景时的保存冲突对话框：强制覆盖 / 放弃本地修改 / 取消 -->
      <v-dialog
        v-model="switchConflict.show"
        max-width="500"
      >
        <v-card>
          <v-card-title>画布保存冲突</v-card-title>
          <v-card-text>
            <p class="mb-2">
              当前画布已被其他人或引用更新修改，自动保存已停止。切换到新画布前请先处理：
            </p>
            <ul class="pl-4 mb-2">
              <li>强制覆盖保存：用当前内容覆盖服务端版本后切换；</li>
              <li>放弃本地修改：放弃当前画布未保存的修改并切换；</li>
              <li>取消：返回当前画布继续处理。</li>
            </ul>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              variant="text"
              @click="cancelSwitchConflict"
            >
              取消
            </v-btn>
            <v-btn
              color="warning"
              variant="tonal"
              :loading="switchConflict.saving"
              @click="discardAndSwitch"
            >
              放弃本地修改并切换
            </v-btn>
            <v-btn
              color="error"
              :loading="switchConflict.saving"
              @click="forceAndSwitch"
            >
              强制覆盖保存并切换
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

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

      <!-- 资产选择器（加载图片/音频/视频节点绑定资产；道具页签按节点类型过滤媒体） -->
      <AssetPickerDialog
        v-model="picker.show"
        :project="props.project"
        :multiple="false"
        :selected="pickerSelected"
        :tabs="pickerTabs"
        :show-voice="picker.showVoice"
        :media-kind="picker.mediaKind"
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
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, BezierEdge, SelectionMode, getBezierPath, Position, useVueFlow, type EdgeMouseEvent, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { useCanvasStore } from '../../canvas/useCanvasStore'
import { useCanvasGeneration } from '../../canvas/useCanvasGeneration'
import { useAutoComputeHeight } from '../../composables/useAutoComputeHeight'
import { confirm } from '../../utils/confirm'
import type { CanvasNodeData } from '../../canvas/types'
import { canvasRelPath, type CanvasTarget } from '../../canvas/api'
import { getNodeCurrentAssetPath } from '../../canvas/generate'
import { getPrototype } from '../../canvas/registry'
import { getCanvasNodeInfo } from '../../canvas/api'
import { extOfAudioPath } from '../../canvas/audioTrim'
import { isSyntheticNodeId } from '../../canvas/groupSelection'
import type { CanvasScope } from '../../canvas/paths'
import { llmSocket, type LlmCanvasTarget, type LlmSessionInfo, type LlmTaskEvent } from '../../canvas/llmSocket'
import { applyLlmEvent, createLlmStreamState, createThrottledCommit, type LlmStreamState, type ThrottledCommit } from '../../canvas/llmEvents'
import type { CanvasStreamStatePayload } from './CanvasNodeCard.vue'
import AssetPickerDialog from '../asset-picker/AssetPickerDialog.vue'
import CanvasAssertHistoryDialog from './CanvasAssertHistoryDialog.vue'
import AiTextHistoryDialog from './AiTextHistoryDialog.vue'
import SaveAssetDialog from './SaveAssetDialog.vue'
import SaveAsDialog from './SaveAsDialog.vue'
import CanvasToolbar from './CanvasToolbar.vue'
import CanvasNodeCard from './CanvasNodeCard.vue'
import CanvasEditorPanel from './CanvasEditorPanel.vue'
import CanvasContextMenu from './CanvasContextMenu.vue'
import CanvasAddNodeMenu from './CanvasAddNodeMenu.vue'
import CanvasAssetDropMenu from './CanvasAssetDropMenu.vue'
import CanvasGroupFrame from './CanvasGroupFrame.vue'
import CanvasGroupDot from './CanvasGroupDot.vue'
import CanvasGroupConnectMenu from './CanvasGroupConnectMenu.vue'
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
import { useCanvasGroup } from './composables/useCanvasGroup'
import { useCanvasUpload, type CanvasUploadFilePayload } from './composables/useCanvasUpload'
import { useCanvasAssetDrop } from './composables/useCanvasAssetDrop'
import { canvasDragPayload } from '../../canvas/assetDrop'

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

/**
 * 画布数据 store：加载/保存（CAS 版本校验）/增删改查/撤销重做。
 * 版本冲突时自动保存停止，由冲突横幅与对话框提示用户处理。
 */
const store = useCanvasStore(props.project, target.value)
/**
 * 资产生成组合式：跑工作流 + 轮询（纯体验层）+ 结果通知 + 运行中任务持久化恢复。
 * onResult 为恢复任务完成后的默认结果回调（正常生成路径仍按调用传入的回调优先）。
 */
const gen = useCanvasGeneration(props.project, target.value, { onResult: handleNodeResult })
const { statusByNode } = gen
const { loaded, nodes, dirty, saving, canUndo, canRedo, undo, redo, conflict, savedRev, forceSave, reloadFromServer } = store
const router = useRouter()
const route = useRoute()

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

/**
 * 裁剪音频节点产物扩展名镜像同步（静默、不入撤销栈）：
 * 成功裁剪（含跨页面恢复收敛）后，把实际落盘扩展名写回 config.outputExt，
 * 供「原格式」下无输入链路上下文的固定产物路径推导使用（画布加载刷新 node-info、
 * 保存为/自定义资产对话框、下游输入收集等），并保证产物存在性/mtime 查询路径正确。
 * 先于乐观展示与 refreshNodeOutput 调用，使刷新按新扩展名推导产物路径。
 *
 * @param nodeId 节点 id
 * @param outputPath 裁剪成功回传的产物相对路径（服务端实际落盘）
 */
function syncAudioTrimOutputMirror(nodeId: string, outputPath: string): void {
  const node = nodeMap.value[nodeId]
  if (!node || node.prototypeId !== 'audio-trim') return
  const ext = extOfAudioPath(outputPath)
  if (!ext || node.config.outputExt === ext) return
  store.updateNodeQuiet(nodeId, { outputExt: ext })
}

/** 生成完成回调：产物已由服务端落盘，刷新该节点展示（先乐观更新，再取真实 mtime） */
function handleNodeResult(nodeId: string, outputPath: string): void {
  syncAudioTrimOutputMirror(nodeId, outputPath)
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

/**
 * 节点固定产物路径（生成类节点按 scope+nodeId+扩展名恒等推导，即使文件尚不存在也有值）。
 * 生成节点编辑器「上传产物」的目标路径（与服务端 /api/canvas/upload 校验一致）。
 *
 * @param node 节点数据
 * @returns 项目内相对路径；加载类/无产物路径的节点返回 undefined
 */
function outputPathOf(node: CanvasNodeData): string | undefined {
  return getNodeCurrentAssetPath(node, scope.value)
}

/** 查询节点产物 mtime（上游更新角标用） */
function getOutputMtime(nodeId: string): number | null | undefined {
  const o = nodeOutputs.value[nodeId]
  return o?.exists ? o.mtime : undefined
}

/** Vue Flow 视图控制：适应/缩放/屏幕坐标换算/程序化选中与取消选中 */
const { fitView, zoomIn, zoomOut, setViewport, setState, getNodes, screenToFlowCoordinate, viewport, findNode, addSelectedNodes, removeSelectedNodes, onNodesInitialized } = useVueFlow()

/**
 * 适应视图参数：把全部节点包围盒放进可视区并居中。
 * maxZoom=1 避免节点很少时被放到超过 100%；padding 留出边缘空隙。
 */
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1, duration: 0 } as const

/** 组件是否已卸载（异步 load / fitView 完成后不再改视口或恢复任务） */
let disposed = false
/** 待执行的适应视图世代号（快速切换分镜时丢弃过期请求） */
let fitViewSeq = 0
/** 是否仍需在节点尺寸就绪 / 画布变为可见后重试适应视图 */
let pendingFitView = false
/** 串行化 fitView，避免过期请求在新画布对准之后又把视口改回旧包围盒 */
let fitViewChain: Promise<void> = Promise.resolve()

/**
 * 工具栏「适应视图」：立即按当前节点包围盒对准视口。
 */
function onFitView(): void {
  void fitView({ ...FIT_VIEW_OPTIONS })
}

/**
 * Vue Flow 内部节点是否已切到当前画布且测出宽高。
 * 切换分镜后 store 已是新节点，但 Vue Flow 可能仍持有旧节点尺寸；此时 fitView 会对准旧包围盒。
 *
 * @returns 空画布视为就绪；否则要求内部节点集合与 store 一致且均已测量
 */
function vueFlowMatchesStore(): boolean {
  const expected = store.nodes.value
  if (expected.length === 0) return true
  // 过滤群组合成节点（多选时临时渲染，不入 store）
  const current = getNodes.value.filter((n) => !isSyntheticNodeId(n.id))
  if (current.length !== expected.length) return false
  const ids = new Set(expected.map((n) => n.id))
  for (const n of current) {
    if (!ids.has(n.id)) return false
    if (!n.dimensions.width || !n.dimensions.height) return false
  }
  return true
}

/**
 * 将画布视口对准当前全部资产节点（居中 + 缩放落入可视区）。
 * Vue Flow 的 fitView 要求节点已测出宽高；测量未完成、节点尚未切到当前画布、或容器尺寸为 0 时保持 pending，
 * 由 onNodesInitialized / 容器 ResizeObserver 再试。快速切换分镜时以世代号丢弃过期请求。
 *
 * @param seq scheduleFitCanvas 分配的世代号
 */
function fitCanvasToNodes(seq: number): Promise<void> {
  const task = async (): Promise<void> => {
    if (!pendingFitView || disposed || seq !== fitViewSeq) return
    if (store.nodes.value.length === 0) {
      pendingFitView = false
      await setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 })
      return
    }
    if ((flowEl.value?.clientWidth ?? 0) <= 0 || (flowEl.value?.clientHeight ?? 0) <= 0) return
    await nextTick()
    if (!pendingFitView || disposed || seq !== fitViewSeq) return
    if (!vueFlowMatchesStore()) return
    const ok = await fitView({ ...FIT_VIEW_OPTIONS })
    if (ok && seq === fitViewSeq && !disposed) pendingFitView = false
  }
  fitViewChain = fitViewChain.then(task).catch((e: unknown) => {
    console.error('[asset-canvas] 适应视图失败', e)
  })
  return fitViewChain
}

/**
 * 在画布数据加载完成后请求适应视图（首次进入与切换分镜/场景）。
 * 节点尚未渲染完时不会丢请求，等尺寸就绪后再对准。
 */
function scheduleFitCanvas(): void {
  pendingFitView = true
  const seq = ++fitViewSeq
  void fitCanvasToNodes(seq)
}

onNodesInitialized(() => {
  if (pendingFitView) void fitCanvasToNodes(fitViewSeq)
})

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

/** 选中状态与配置面板信息（多选主状态；Vue Flow 内部选中态经镜像保持同步） */
const selection = useCanvasSelection({ store })

// ── 选中同步（应用级 ⇄ Vue Flow 内部）：框选/加减选由 Vue Flow 原生承担，应用级是虚线框/整组操作数据源 ──

/** 读取 Vue Flow 内部当前选中的真实节点 id（过滤群组合成节点） */
function getVueFlowSelectedNodeIds(): string[] {
  return getNodes.value
    .filter((n) => n.selected && !isSyntheticNodeId(n.id))
    .map((n) => n.id)
}

/** 把应用级选中列表镜像到 Vue Flow 内部选中态（绝对写入，保证节点选中边框一致） */
function mirrorSelectionToVueFlow(nodeIds: string[]): void {
  const currentSelected = getNodes.value.filter((n) => n.selected)
  if (currentSelected.length > 0) removeSelectedNodes(currentSelected)
  const objs = nodeIds
    .map((id) => findNode(id))
    .filter((n): n is NonNullable<ReturnType<typeof findNode>> => !!n)
  if (objs.length > 0) addSelectedNodes(objs)
}

// 应用级选择变化 → 镜像 Vue Flow（flush post：等新节点进入内部图后再写入选中态）
watch(
  selection.selectedNodeIds,
  (ids) => mirrorSelectionToVueFlow(ids),
  { flush: 'post' },
)

/** 框选结束（Vue Flow 内部已完成选中计算）→ 同步回应用级多选状态 */
function onSelectionEnd(): void {
  selection.syncFromVueFlow(getVueFlowSelectedNodeIds)
}

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

// ── LLM 活跃会话（AI 文本节点；服务端会话列表驱动恢复 + 后端终态落盘 adopt）─────────

/** 当前画布定位（生成请求携带：服务端会话终态落盘定位 + 会话 scope 过滤） */
const canvasTarget = computed<LlmCanvasTarget>(() => ({
  kind: props.kind,
  episode: props.episode,
  shot: props.shot,
  stage: props.stage,
  label: props.label,
}))

/** 恢复订阅的本地状态：taskId → 事件状态 + 节流提交器 + 逐处理器退订函数（流式仅内存显示） */
const llmRestore = new Map<string, { nodeId: string; state: LlmStreamState; commit: ThrottledCommit; unsubscribe: () => void }>()

/** 已采纳的后端终态版本（nodeId → rev）：在线路径与恢复路径可能双订阅同一任务，按 rev 幂等去重 */
const adoptedLlmRevByNode = new Map<string, number>()

/**
 * 终态视图同步统一入口（在线路径 stream-state 与恢复路径 onRestoreTaskEvent 共用）：
 * 后端已完成落盘 → adoptExternalChange（入撤销栈 + savedRev 对齐，不触发写盘）。
 * 同一任务可能被节点与恢复路径双订阅，按 rev 幂等：已采纳过该版本则跳过
 * （避免重复入撤销栈造成「多次撤销才回到生成前状态」）。
 *
 * @param nodeId 节点 id
 * @param patch 后端实际落盘的 config 补丁（output / outputHistory）
 * @param rev 后端写入后的画布新版本号
 */
function adoptLlmResult(nodeId: string, patch: Record<string, unknown>, rev: number): void {
  if (adoptedLlmRevByNode.get(nodeId) === rev) return
  adoptedLlmRevByNode.set(nodeId, rev)
  store.adoptExternalChange(nodeId, patch, rev)
}

/** 清除采纳版本记录（切换画布目标/组件卸载时；各画布各自计数） */
function resetAdoptedLlmRevs(): void {
  adoptedLlmRevByNode.clear()
}

/**
 * AI 文本节点流式输出补丁（纯内存显示）：合入 store 但**不写盘、不入撤销栈**。
 * 终态由后端一次性落盘（result-persist），此处仅保证流式期间下游文本消费者
 * 读取同一 store 数据保持实时联动。
 *
 * @param nodeId 节点 id
 * @param patch 配置补丁（{ output }）
 */
function onUpdateOutputView(nodeId: string, patch: Record<string, unknown>): void {
  store.viewOnlyUpdate(nodeId, patch)
}

/**
 * AI 文本节点生成流状态（在线发起路径经节点上抛）→ 驱动标准 Loading 状态机：
 * - running：beginClientRun（置 statusByNode running + 会话 id，自定义遮罩显示）；
 * - 终态：completed → adoptExternalChange（undo + savedRev 对齐，不触发写盘）+ endClientRun；
 *   failed → adopt（部分输出）+ setLlmError（自定义遮罩红字）；cancelled → adopt + endClientRun。
 *
 * @param nodeId 节点 id
 * @param payload 流状态载荷
 */
function onStreamState(nodeId: string, payload: CanvasStreamStatePayload): void {
  if (payload.running) {
    gen.beginClientRun(nodeId, payload.log ?? 'Thinking…', payload.taskId)
    return
  }
  const r = payload.result
  if (!r) {
    gen.endClientRun(nodeId)
    return
  }
  if (r.status === 'completed') {
    if (r.patch && typeof r.rev === 'number') adoptLlmResult(nodeId, r.patch, r.rev)
    gen.endClientRun(nodeId)
    return
  }
  if (r.status === 'failed') {
    // 后端已写部分输出（若有）→ 内存同步；错误红字由节点响应区 + 自定义遮罩展示
    if (r.patch && typeof r.rev === 'number') adoptLlmResult(nodeId, r.patch, r.rev)
    gen.setLlmError(nodeId, r.errorMsg ?? '生成失败')
    return
  }
  // cancelled：静默结束（后端已写部分输出；单次撤销可回退到生成前状态）
  if (r.patch && typeof r.rev === 'number') adoptLlmResult(nodeId, r.patch, r.rev)
  gen.endClientRun(nodeId)
}

/**
 * 判断会话画布 scope 是否与当前画布一致（项目 + scope 双属性过滤恢复）。
 *
 * @param a 会话画布定位（服务端）
 * @param b 当前画布目标
 * @returns 是否同一张画布
 */
function sameCanvasTarget(a: LlmCanvasTarget, b: CanvasTarget): boolean {
  if (a.kind !== b.kind) return false
  if (b.kind === 'scene') return a.episode === b.episode && a.shot === b.shot
  return a.stage === b.stage && a.label === b.label
}

/**
 * 按服务端活跃会话列表恢复本画布的 AI 文本节点 Loading：
 * 会话 running 且 nodeId 存在于 nodeMap → beginClientRun + 恢复订阅
 * （subscribe → snapshot 补齐 → 增量实时显示 → 终态 adopt 收敛）。
 * 画布加载 / 切换 / WS 重连（sessions 全量刷新）时调用，已订阅任务幂等跳过。
 */
function restoreLlmSessions(): void {
  if (!store.loaded.value) return
  for (const s of llmSocket.sessions.value) {
    if (s.status !== 'running') continue
    if (s.project !== props.project) continue
    if (!sameCanvasTarget(s.canvas, target.value)) continue
    const node = nodeMap.value[s.nodeId]
    if (!node || node.prototypeId !== 'text-ai') continue
    // 节点已在本页面接管该会话（在线路径 stream-state 已置 running + taskId）：跳过恢复订阅
    if (gen.statusByNode.value[s.nodeId]?.taskId === s.taskId) continue
    if (llmRestore.has(s.taskId)) continue
    gen.beginClientRun(s.nodeId, s.phase === 'responding' ? '正在响应…' : 'Thinking…', s.taskId)
    subscribeRestoreTask(s.taskId, s)
  }
  reconcileLlmRestore()
}

/**
 * 恢复订阅单个会话：注册事件处理器（applyLlmEvent 与在线路径同消费器）。
 * 快照/增量 → 节流 viewOnlyUpdate（纯内存显示）；终态 → adopt + endClientRun。
 *
 * @param taskId 会话 id
 * @param session 会话信息（nodeId 等）
 */
function subscribeRestoreTask(taskId: string, session: LlmSessionInfo): void {
  if (llmRestore.has(taskId)) return
  // 流式显示仅内存（viewOnlyUpdate）：最终内容由后端终态落盘，adopt 同步
  const commit = createThrottledCommit((text) => store.viewOnlyUpdate(session.nodeId, { output: text }))
  const entry = { nodeId: session.nodeId, state: createLlmStreamState(), commit, unsubscribe: () => {} }
  // 逐处理器退订：恢复态只退自己的处理器（在线节点路径的订阅不受影响，见 llmSocket.subscribe）
  entry.unsubscribe = llmSocket.subscribe(taskId, (event) => onRestoreTaskEvent(taskId, event))
  llmRestore.set(taskId, entry)
}

/**
 * 恢复订阅的事件处理器（与在线路径共用 applyLlmEvent）：
 * text 增量 → 节流纯内存显示；终态（finished/not-found）→ 后端已落盘，
 * adoptExternalChange 视图同步（入撤销栈 + savedRev 对齐）+ 结束 Loading。
 *
 * @param taskId 会话 id
 * @param event 服务端推送的会话事件
 */
function onRestoreTaskEvent(taskId: string, event: LlmTaskEvent): void {
  const entry = llmRestore.get(taskId)
  if (!entry) return
  entry.state = applyLlmEvent(entry.state, event)
  if (event.type === 'text') {
    entry.commit.push(entry.state.text)
    return
  }
  if (event.type !== 'finished' && event.type !== 'not-found') return
  // 终态：后端已完成落盘 → 视图同步（幂等：节点已被删除时 store 操作安全跳过）
  const status = event.type === 'not-found' ? 'cancelled' : event.info.status
  const info = event.type === 'finished' ? event.info : undefined
  const patch =
    info && (info.output !== undefined || info.outputHistory)
      ? {
          ...(info.output !== undefined ? { output: info.output } : {}),
          ...(info.outputHistory ? { outputHistory: info.outputHistory } : {}),
        }
      : undefined
  if (patch && typeof info?.rev === 'number') {
    adoptLlmResult(entry.nodeId, patch, info.rev) // 入撤销栈 + savedRev 对齐，不触发写盘（按 rev 幂等）
  }
  if (status === 'failed') {
    gen.setLlmError(entry.nodeId, event.type === 'finished' ? (event.info.error ?? '生成失败') : '生成失败')
  } else {
    gen.endClientRun(entry.nodeId)
  }
  entry.commit.flush()
  entry.unsubscribe()
  llmRestore.delete(taskId)
}

/**
 * 重连对账：本端已恢复订阅的任务不在服务端活跃列表 → 结束 Loading
 * （服务重启后注册表为空 → 无 Loading 恢复、无幽灵 Loading；未终态会话的
 * 部分输出丢失为内存方案的既定取舍，结果以文件为准）。
 * 断线期间不做对账（列表可能过期），重连后 sessions 全量刷新时再次执行。
 */
function reconcileLlmRestore(): void {
  if (!llmSocket.connected.value) return
  const activeTaskIds = new Set(
    llmSocket.sessions.value.filter((s) => s.status === 'running').map((s) => s.taskId),
  )
  for (const [taskId, entry] of [...llmRestore]) {
    if (activeTaskIds.has(taskId)) continue
    gen.endClientRun(entry.nodeId)
    entry.unsubscribe()
    llmRestore.delete(taskId)
  }
}

/** 服务端活跃列表变化（begin/update/finish/重连全量刷新）→ 恢复与对账 */
watch(
  () => llmSocket.sessions.value,
  () => restoreLlmSessions(),
)

/** 取消全部恢复订阅（组件卸载时：任务继续，重进画布由会话列表恢复接管） */
function resetLlmRestore(): void {
  for (const entry of llmRestore.values()) entry.unsubscribe()
  llmRestore.clear()
}

/** 加载节点上传组合式：节点级上传进度状态（上传进度/失败遮罩由节点卡片渲染） */
const upload = useCanvasUpload({
  project: props.project,
  onSuccess: (nodeId, path) => {
    const node = nodeMap.value[nodeId]
    // 加载节点：上传到 assert/custom/canvas/，写回 config.assetPath；
    // 生成类节点（产物为固定路径 output.{ext}）：不回写 config（"当前结果"为文件系统事实），
    // 仅刷新产物信息即可。
    if (node && !getPrototype(node.prototypeId)?.outputExt) onUpdateConfig(nodeId, { assetPath: path })
    // 上传落盘后刷新该节点产物信息（mtime）：预览 URL 以源资产 mtime 作缓存键，
    // 同路径覆盖上传（文件名不变）时若不复刷 mtime，下游编辑器会命中旧的缓存 URL
    void refreshNodeOutput(nodeId)
  },
  showSnackbar,
})

/** 加载节点上传入口（节点卡片/编辑器 upload-file 事件 → 组合式上传，成功后写回 assetPath） */
function onUploadFile(payload: CanvasUploadFilePayload): void {
  void upload.uploadForNode(payload.nodeId, payload.file, payload.dest)
}

/** 资产拖放菜单组合式（AssetTree 拖入画布 → 释放位置菜单 → 点击创建加载节点） */
const drop = useCanvasAssetDrop({ store, project: props.project, showSnackbar })

// ── 资产拖放入画布（HTML5 拖放：AssetTree 写共享载荷，画布容器承接 drop）────────

/** 资产拖拽悬停在画布上的高亮标记（dragover 中置位，drop/dragleave/载荷清除时复位） */
const assetDragOver = ref(false)

/** 画布 dragover：存在画布载荷时允许 drop 并高亮画布（目录/分类等无载荷拖拽不响应） */
function onCanvasAssetDragover(event: DragEvent): void {
  if (!canvasDragPayload.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  assetDragOver.value = true
}

/** 画布 dragleave：指针离开画布（含子元素）时清除高亮 */
function onCanvasAssetDragleave(event: DragEvent): void {
  const related = event.relatedTarget as Node | null
  if (related && event.currentTarget instanceof Node && event.currentTarget.contains(related)) return
  assetDragOver.value = false
}

/** 画布 drop：换算释放点为流坐标，在释放位置打开资产拖放菜单 */
function onCanvasAssetDrop(event: DragEvent): void {
  const payload = canvasDragPayload.value
  assetDragOver.value = false
  if (!payload) return
  event.preventDefault()
  const p = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  void drop.openAt(event, payload, p.x, p.y, flowEl.value)
}

// 源头拖拽结束（dragend）清除载荷：同步复位画布高亮
watch(canvasDragPayload, (payload) => {
  if (!payload) assetDragOver.value = false
})

/** 聚焦节点（程序化单选 + 镜像 Vue Flow 选中态 + 抑制配置面板弹出，粘贴/群组新建节点场景复用） */
async function focusNodes(nodeIds: string[]): Promise<void> {
  if (nodeIds.length === 0) return
  await nextTick()
  const objs = nodeIds
    .map((id) => findNode(id))
    .filter((n): n is NonNullable<ReturnType<typeof findNode>> => !!n)
  if (objs.length > 0) addSelectedNodes(objs)
  selection.setSelectedNodes(nodeIds)
  selection.setSuppressPanelOnSelect(true)
}

/** 群组组合式：包围盒/输出点拖拽连接/目标原型菜单（依赖 store/nodeMap/选中/视图工具） */
const group = useCanvasGroup({
  store,
  nodeMap,
  getSelectedNodeIds: () => selection.selectedNodeIds.value,
  screenToFlowCoordinate,
  viewport,
  flowEl,
  showSnackbar,
  focusNode: (ids) => void focusNodes(ids),
})

/** Vue Flow 渲染映射、群组合成节点与连线交互（含单选联动高亮的派生集） */
const flow = useCanvasFlow({
  store,
  nodeMap,
  project: props.project,
  selectedEdgeId: selection.selectedEdgeId,
  selectedNodeIds: selection.selectedNodeIds,
  groupRect: group.groupRect,
})

/** 对话框与资产选择器 */
const dialogs = useCanvasDialogs({ store, nodeMap, project: props.project, target, getScope: () => scope.value, showSnackbar })

/** 右键菜单、群组菜单与添加节点菜单 */
const menus = useCanvasMenus({
  store,
  nodeMap,
  selection: {
    setSelectedNode: selection.setSelectedNode,
    deleteNode: selection.deleteNode,
    deleteSelected: selection.deleteSelected,
    getSelectedNodeIds: () => selection.selectedNodeIds.value,
  },
  rename: { startRename: rename.startRename },
  dialogs: { openHistory: dialogs.openHistory, openSaveAsset: dialogs.openSaveAsset, openSaveAs: dialogs.openSaveAs },
  getScope: () => scope.value,
  generate: (nodeId: string) => void nodeOps.generateNode(nodeId),
})

/** 剪贴板粘贴（文件/文本/画布内复制节点）与 Ctrl+D 复制粘贴整组 */
const paste = useCanvasPaste({
  store,
  flowEl,
  screenToFlowCoordinate,
  findNode,
  addSelectedNodes,
  selection: { setSelectedNodes: selection.setSelectedNodes, setSuppressPanelOnSelect: selection.setSuppressPanelOnSelect },
  getSelectedNodeIds: () => selection.selectedNodeIds.value,
  upload,
  showSnackbar,
})

/** 关闭全部菜单（含群组连接目标菜单） */
function closeAllMenus(): void {
  menus.closeAll()
  group.closeConnectMenu()
}

/** 键盘快捷键 */
const keyboard = useCanvasKeyboard({
  store,
  selection: {
    getSelectedNodeIds: () => selection.selectedNodeIds.value,
    selectedEdgeId: selection.selectedEdgeId,
    deleteSelected: selection.deleteSelected,
  },
  menus: { closeAll: closeAllMenus },
  rename: { cancelRename: rename.cancelRename },
  panel: { close: selection.dismissPanel },
  handleCtrlV: paste.handleCtrlV,
  duplicateSelected: () => void paste.duplicateSelected(),
})

/** 自动搭画布 */
const autobuild = useCanvasAutobuild({ store, nodeMap, project: props.project, target, showSnackbar })

// 组合式导出解构（模板绑定用）
const { renamingNodeId, renameInput, startRename, commitRename, cancelRename } = rename
const { editorPanel, isMultiSelected, onEdgeClick, onNodeDragStart } = selection
const { generateNode, onInterrupt, extractNodeFrame, isNodeRunning, inputsOf, videoInputGroups, videoTextInputs, isUpstreamUpdated, onUpdateConfig, onUpdateConfigQuiet, llmMediaInputsOf, textInputsOf, disconnectInput } = nodeOps
const { flowNodes, flowEdges, relatedInputEdgeIds, relatedOutputEdgeIds, adjacentInputNodeIds, adjacentOutputNodeIds, onNodeDragStop, onNodeResizeEnd, isValidConnection, onConnect, onEdgesChange, edgeMenu, disconnectEdge } = flow
const { historyDialog, historyNode, saveDialog, saveDialogNode, saveSourcePath, saveAsDialog, saveAsDialogNode, saveAsSourcePath, sceneDialog, sceneDialogNode, openSetAsScene, openSetAsShotVideo, picker, pickerTabs, pickerSelected, openAssetPicker, onPickerConfirm, openHistory } = dialogs
const { contextMenu, contextMenuNode, canGenerateOf, hasHistoryOf, canSaveImage, saveTargetsOf, contextGenerate, contextHistory, contextSaveAs, nodeHasConnections, contextDisconnect, contextRename, contextCopy, contextDelete, groupMenu, groupCopy, groupDelete, addMenu, addNodeAt } = menus
const { autoBuilding, autoBuild } = autobuild
// 群组组合式导出（顶层解构：模板内自动解包 ref）
const { connectDrag, connectLine, connectMenu, menuItems, hoveredNodeId, onDotMouseDown, createNodeFromMenu } = group

/**
 * 编辑器输入项右上角红色 x：快捷断开当前选中节点与某来源节点的连线（不弹确认）。
 * 具体断开与 inputOrder 清理在 nodeOps.disconnectInput（store.disconnect 已入撤销栈，
 * Ctrl+Z 可恢复）；无选中节点时忽略。
 *
 * @param sourceNodeId 被断开的输入来源节点 id（编辑器已按输入分组透传）
 */
function disconnectEditorInput(sourceNodeId: string): void {
  const id = editorPanel.value?.node?.id
  if (!id) return
  disconnectInput(id, sourceNodeId)
}

/** 配置面板可见性：单选节点且未被拖拽/程序化选中/手动关闭抑制（多选不显示配置面板） */
const editorPanelVisible = computed(
  () => !!editorPanel.value
    && !isMultiSelected.value
    && !selection.suppressEditor.value
    && !selection.suppressPanelOnSelect.value
    && !selection.panelDismissed.value,
)

/**
 * 节点邻接方向（单选联动高亮）：'input' = 数据流入选中节点的输入邻居，'output' = 输出侧邻居，
 * null = 无关联。供 CanvasNodeCard 邻接边框分色。
 *
 * @param nodeId 节点 id
 * @returns 邻接方向或 null
 */
function adjacentSideOf(nodeId: string): 'input' | 'output' | null {
  if (adjacentInputNodeIds.value.has(nodeId)) return 'input'
  if (adjacentOutputNodeIds.value.has(nodeId)) return 'output'
  return null
}

/**
 * 连线关联方向（单选联动高亮）：'input' = 指向选中节点的输入侧连线，'output' = 选中节点发出的
 * 输出侧连线，null = 无关联。供 #edge-default 插槽决定是否渲染流向箭头。
 *
 * @param edgeId 连线 id
 * @returns 关联方向或 null
 */
function edgeRelatedSide(edgeId: string): 'input' | 'output' | null {
  if (relatedInputEdgeIds.value.has(edgeId)) return 'input'
  if (relatedOutputEdgeIds.value.has(edgeId)) return 'output'
  return null
}

/**
 * 构建流向箭头的 CSS 运动路径样式（#edge-default 插槽内使用）：
 * 按与 BezierEdge 完全一致的参数计算连线贝塞尔路径 d，注入 `offset-path: path(...)`，
 * 配合 .canvas-edge__arrow 的 offset-rotate/动画：箭头从源端（source）滑向目标端（target），
 * 即数据流方向——输入侧（target=选中节点）流向选中节点，输出侧（source=选中节点）流向输出节点。
 *
 * @param edgeProps Vue Flow 连线插槽 props（含连线几何）
 * @returns 内联样式（offset-path）
 */
function arrowMotionStyle(edgeProps: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition?: Position
  targetPosition?: Position
}): Record<string, string> {
  const [pathD] = getBezierPath({
    sourceX: edgeProps.sourceX,
    sourceY: edgeProps.sourceY,
    targetX: edgeProps.targetX,
    targetY: edgeProps.targetY,
    sourcePosition: edgeProps.sourcePosition ?? Position.Bottom,
    targetPosition: edgeProps.targetPosition ?? Position.Top,
  })
  return { 'offset-path': `path('${pathD}')` }
}

/** 内联重命名输入：写入 rename 组合式的临时值（卡片输入框上抛） */
function onRenameInput(value: string): void {
  renameInput.value = value
}

// ── 跨组合式接线（菜单互斥关闭/双击加节点）────────────────

/** 节点右键（卡片事件 → 打开右键菜单） */
function openNodeContextMenu(event: MouseEvent, nodeId: string): void {
  menus.openContextMenu(event, nodeId, flowEl.value)
}

/** 节点点击：选中/Ctrl 加减选 + 关闭全部菜单（允许显示配置面板） */
function onNodeClick(payload: NodeMouseEvent): void {
  selection.onNodeClick(payload)
  menus.closeAll()
}

/** 空白处点击：取消选中/关闭菜单；双击在鼠标处弹出添加节点菜单 */
function onPaneClick(event: MouseEvent): void {
  selection.onPaneClick()
  menus.closeAll()
  group.closeConnectMenu()
  if (event.detail >= 2) {
    const p = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    menus.openAddMenu(event, Math.round(p.x - 60), Math.round(p.y - 40), flowEl.value)
  }
}

/** 群组虚线框右键：打开群组菜单（复制/删除整组），不改变当前多选 */
function openGroupContextMenu(event: MouseEvent): void {
  flow.closeEdgeMenu()
  menus.closeNodeMenu()
  menus.openGroupMenu(event, flowEl.value)
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

// ── 保存版本冲突 UI 状态 ───────────────────────────────────────

/** 强制覆盖保存对话框（输入「确认覆盖」才可确定） */
const forceDialog = reactive({ show: false, input: '', saving: false })

/** 切换画布（分镜/场景）时的保存冲突对话框 */
const switchConflict = reactive({
  show: false,
  /** 用户尝试切换到的目标画布 */
  pending: null as CanvasTarget | null,
  /** 停留的当前画布（冲突归属；取消时回退 URL 与生成目标） */
  previous: null as CanvasTarget | null,
  saving: false,
})

/** 当前已激活的画布目标（成功切换后更新；冲突「取消」时回退用） */
let activeTarget: CanvasTarget = { ...target.value }

/**
 * 下载当前画布（本地未保存内容）为 canvas.json 备份文件。
 */
function downloadLocalBackup(): void {
  const blob = new Blob([JSON.stringify(store.data.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = canvasRelPath(target.value).replace(/\//g, '-')
  a.click()
  URL.revokeObjectURL(url)
}

/** 重新加载服务端版本（放弃本地修改；先经用户确认） */
async function reloadFromServerWithConfirm(): Promise<void> {
  const ok = await confirm({
    title: '重新加载服务端版本',
    content: '将放弃当前画布未保存的修改，重新加载服务端最新版本。确定继续？',
    confirmText: '重新加载',
    confirmColor: 'warning',
  })
  if (!ok) return
  await reloadFromServer()
}

/** 强制覆盖保存（对话框确认后执行；成功后横幅自动消失） */
async function confirmForceSave(): Promise<void> {
  forceDialog.saving = true
  try {
    const ok = await forceSave()
    if (ok) {
      forceDialog.show = false
      forceDialog.input = ''
      showSnackbar('已强制覆盖保存最新版本', 'success')
    } else {
      showSnackbar(store.error.value ?? '强制覆盖保存失败', 'error')
    }
  } finally {
    forceDialog.saving = false
  }
}

/** 把路由恢复到指定画布目标（冲突「取消」时回到原画布，保持一致） */
function restoreRouteForTarget(t: CanvasTarget): void {
  const query = { ...router.currentRoute.value.query } as Record<string, string | undefined>
  if (t.kind === 'scene') {
    query.type = 'scene'
    query.episode = t.episode
    query.shot = t.shot
    delete query.name
    delete query.subscene
    delete query.section
  } else if (t.kind === 'stage') {
    query.type = 'stage'
    query.name = t.stage
    query.subscene = t.label
    delete query.episode
    delete query.shot
    delete query.section
  } else {
    return
  }
  router.push({ query })
}

/** 切换冲突对话框「取消」：回退到原画布（恢复生成的切换目标与 URL） */
async function cancelSwitchConflict(): Promise<void> {
  const previous = switchConflict.previous
  switchConflict.show = false
  if (previous) {
    await gen.switchTarget(previous)
    restoreRouteForTarget(previous)
  }
}

/** 切换冲突对话框「放弃本地修改并切换」 */
async function discardAndSwitch(): Promise<void> {
  const pending = switchConflict.pending
  switchConflict.show = false
  if (!pending) return
  switchConflict.saving = true
  try {
    await applySwitch(pending, { discard: true })
  } finally {
    switchConflict.saving = false
  }
}

/** 切换冲突对话框「强制覆盖保存并切换」 */
async function forceAndSwitch(): Promise<void> {
  const pending = switchConflict.pending
  switchConflict.show = false
  if (!pending) return
  switchConflict.saving = true
  try {
    const ok = await forceSave()
    if (!ok) {
      showSnackbar(store.error.value ?? '强制覆盖保存失败，已停留在当前画布', 'error')
      return
    }
    await applySwitch(pending)
  } finally {
    switchConflict.saving = false
  }
}

// ── 生命周期 ────────────────────────────────────────────

/**
 * 执行一次画布切换（含冲突处理）：
 * 先重置各组合式状态并让 store/生成组合式切换到新目标；若旧画布存在保存版本冲突
 * （未切换），弹出切换冲突对话框由用户决定（强制覆盖 / 放弃修改 / 取消）。
 *
 * @param newTarget 新画布目标
 * @param opts.discard 为 true 时放弃旧画布未保存修改直接切换（对话框「放弃本地修改」）
 */
async function applySwitch(newTarget: CanvasTarget, opts: { discard?: boolean } = {}): Promise<void> {
  const seq = ++fitViewSeq
  pendingFitView = false
  selection.reset()
  rename.reset()
  menus.reset()
  flow.closeEdgeMenu()
  paste.reset()
  group.reset()
  drop.reset()
  dialogs.resetAll()
  upload.reset()
  await gen.switchTarget(newTarget)
  if (disposed || seq !== fitViewSeq) return
  const st = await store.switchTarget(newTarget, opts)
  if (disposed || seq !== fitViewSeq) return
  if (st === 'conflict') {
    // 保存版本冲突：未切换，交由用户决定（数据保留在原画布）
    switchConflict.pending = newTarget
    switchConflict.previous = { ...activeTarget }
    switchConflict.show = true
    return
  }
  activeTarget = { ...newTarget }
  // 切分镜/场景后视口仍停在旧坐标，需重新对准新画布全部节点（不等产物信息，节点坐标已就绪）
  scheduleFitCanvas()
  // 新画布加载后刷新全部节点产物信息（固定路径 + mtime；异步任务已由服务端落盘的结果直接可见）
  await refreshNodeOutputs()
  // 采纳版本记录按画布隔离（新画布重新计数）
  resetAdoptedLlmRevs()
  // 恢复本画布的 LLM 活跃会话（服务端会话列表按 scope 过滤；Loading 跨页面存活）
  if (!disposed && seq === fitViewSeq) restoreLlmSessions()
}

/** 切换分镜/场景时：重置各组合式状态，并让 store/生成组合式切换到新目标加载 */
watch(target, (newTarget) => {
  // 上一个冲突对话框尚未处理时先关闭（保留最新选择的优先级）
  if (switchConflict.show) switchConflict.show = false
  void applySwitch(newTarget)
})

onMounted(() => {
  // Ctrl（Cmd）框选/加减选：Vue Flow 的 selectionKeyCode 运行时 prop 仅接受 Boolean/Null，
  // 传字符串会触发 prop 类型告警，改为经 setState 写入共享状态（语义与传 prop 完全一致）。
  setState({
    selectionKeyCode: 'Control',
    multiSelectionKeyCode: 'Control',
  })
  window.addEventListener('keydown', keyboard.onKeydown)
  window.addEventListener('paste', paste.onPaste)
  window.addEventListener('resize', updateHeight)
  void store.load().then(() => {
    // 首次加载后把视口对准全部节点（fitViewOnInit 只在 Vue Flow 首次初始化时跑一次，这里统一走显式适应）
    scheduleFitCanvas()
    void refreshNodeOutputs()
    // 恢复持久化的运行中任务：离开画布/刷新前未完成的任务继续显示 loading 并跟踪到终态
    if (!disposed) void gen.restore()
    // 恢复 LLM 活跃会话（服务端会话列表按 scope 过滤；刷新后 Loading 保持、终态 adopt）
    if (!disposed) restoreLlmSessions()
  })
})

onUnmounted(() => {
  disposed = true
  pendingFitView = false
  window.removeEventListener('keydown', keyboard.onKeydown)
  window.removeEventListener('paste', paste.onPaste)
  window.removeEventListener('resize', updateHeight)
  flowResizeObserver?.disconnect()
  flowResizeObserver = null
  // 取消进行中的成组连接拖拽（window 监听器清理）
  group.reset()
  // 中止进行中的加载节点上传并清除进度状态
  upload.reset()
  // 取消 LLM 恢复订阅（任务继续在服务端执行；重进画布由会话列表恢复接管）
  resetLlmRestore()
  resetAdoptedLlmRevs()
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
      // 画布 Tab 隐藏时容器尺寸为 0，fitView 会失败；显示后按 pending 重试，不在每次 resize 时抢用户视口
      if (pendingFitView && flowWidth.value > 0 && flowHeight.value > 0) {
        void fitCanvasToNodes(fitViewSeq)
      }
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

/* 资产拖拽悬停画布：虚线主色描边提示可释放（HTML5 drag 事件驱动） */
.asset-canvas__flow--asset-drag {
  outline: 2px dashed rgb(var(--v-theme-primary));
  outline-offset: -2px;
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

/* 隐藏 Vue Flow 原生「多选包围框」：多选交互由内置框选承担，但包围框会遮挡节点点击，
   改由合成节点 __group-frame 渲染虚线框（本组件自定义样式与整组拖动行为） */
:deep(.vue-flow__nodesselection) {
  display: none !important;
}

/* 单选联动高亮：与选中节点直接相连的连线按方向分色显示并加粗（2px）——
   输入侧（指向选中节点）绿色 #2E7D32，输出侧（选中节点发出）橙色 #EF6C00。
   class 由 useCanvasFlow 挂到 edge wrapper（g.vue-flow__edge）上，颜色经 CSS 变量单一来源；
   :deep 带 scoped 属性前缀，特异性高于 Vue Flow 默认规则（.vue-flow__edge.selected 等），确保生效。
   箭头（.canvas-edge__arrow）与连线同色，沿数据流方向移动。 */
:deep(.vue-flow__edge.canvas-edge--input) {
  --edge-related-color: #2e7d32;
}

:deep(.vue-flow__edge.canvas-edge--output) {
  --edge-related-color: #ef6c00;
}

:deep(.vue-flow__edge.canvas-edge--related .vue-flow__edge-path) {
  stroke: var(--edge-related-color);
  stroke-width: 2;
}

:deep(.vue-flow__edge .canvas-edge__arrow) {
  fill: var(--edge-related-color, #b1b1b7);
  pointer-events: none;
  offset-rotate: auto;
  /* 箭头沿连线移动（数据流方向，源→目标）：offset-path 由模板按连线几何注入，
     1.4s 循环，方向随路径切线自动转向 */
  animation: canvas-edge-arrow-flow 1.4s linear infinite;
}

@keyframes canvas-edge-arrow-flow {
  from {
    offset-distance: 0%;
  }
  to {
    offset-distance: 100%;
  }
}

/* 成组连接预览线：覆盖在画布之上、不拦截指针 */
.asset-canvas__group-connect-line {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 30;
}

/* 成组连接拖拽提示（随鼠标浮动，不拦截指针） */
.asset-canvas__group-connect-hint {
  position: absolute;
  z-index: 31;
  padding: 4px 8px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  user-select: none;
}

/* 保存版本冲突横幅（画布右上角，覆盖在画布之上） */
.canvas-conflict-banner {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 40;
  max-width: 420px;
  padding: 10px 12px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-error), 0.45);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}

.canvas-conflict-banner__title {
  display: flex;
  align-items: center;
  font-weight: 600;
  color: rgb(var(--v-theme-error));
  margin-bottom: 4px;
}

.canvas-conflict-banner__text {
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--v-theme-on-surface));
  margin-bottom: 8px;
}

.canvas-conflict-banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>