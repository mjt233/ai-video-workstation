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
      <!-- 蓝图信息条（仅蓝图模式）：蓝图名称/作用域 + 资产项目选择器
           资产项目决定预览/上传/选择资产的项目上下文；未设置时资产类入口置灰 -->
      <div
        v-if="isBlueprint"
        class="asset-canvas__blueprint-bar"
      >
        <v-icon
          icon="mdi-vector-square"
          size="small"
          color="primary"
          class="mr-1"
        />
        <span class="text-body-medium">{{ props.blueprintMeta?.name ?? '蓝图' }}</span>
        <v-chip
          size="x-small"
          variant="tonal"
          class="ml-2"
        >
          {{ props.blueprint?.scope === 'project' ? `项目 ${props.blueprint?.project ?? ''}` : '全局' }}
        </v-chip>
        <v-spacer />
        <span class="text-body-small text-medium-emphasis mr-1">资产项目</span>
        <v-select
          :model-value="blueprintAssetProject"
          :items="assetProjectOptions"
          item-title="title"
          item-value="value"
          density="compact"
          variant="outlined"
          hide-details
          :loading="assetProjectLoading"
          :disabled="props.blueprint?.scope === 'project'"
          class="asset-canvas__blueprint-project"
          @update:model-value="onAssetProjectChange"
        />
        <v-tooltip
          v-if="!assetContextReady"
          text="未设置资产项目：无法上传/选择资产，节点内的资产预览也不可用"
          location="bottom"
        >
          <template #activator="{ props: tipProps }">
            <v-icon
              v-bind="tipProps"
              icon="mdi-alert-outline"
              size="small"
              color="warning"
              class="ml-2"
            />
          </template>
        </v-tooltip>
      </div>

      <!-- 工具栏（视图缩放/撤销重做/自动搭画布/添加节点 + 保存状态与版本号；
           蓝图模式隐藏「自动搭画布」与「插入蓝图」） -->
      <CanvasToolbar
        :can-undo="canUndo"
        :can-redo="canRedo"
        :auto-building="autoBuilding"
        :saving="saving"
        :dirty="dirty"
        :version="savedRev"
        :conflicted="!!conflict"
        :blueprint-mode="isBlueprint"
        @fit="onFitView"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @undo="undo"
        @redo="redo"
        @auto-build="onAutoBuild"
        @add="(e: MouseEvent) => openAddMenuAt(e, 80, 80)"
        @insert-blueprint="openBlueprintInsertAtViewport"
      />

      <div
        ref="flowEl"
        class="asset-canvas__flow"
        :class="{ 'asset-canvas__flow--asset-drag': assetDragOver, 'asset-canvas__flow--rewiring': rewireDrag.active }"
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
          @node-drag="onNodeDragFollow"
          @node-drag-stop="onNodeDragStop"
          @pane-click="onPaneClick"
          @pane-context-menu="onPaneContextMenu"
          @selection-start="onSelectionStart"
          @selection-end="onSelectionEnd"
        >
          <Background :gap="16" />
          <!-- 连线渲染插槽：默认连线保持 BezierEdge 原样渲染（右键/点击/选中行为不变）；
               单选联动高亮或运行态高亮的关联连线追加沿数据流向移动的箭头动画（单选输入侧绿色/
               输出侧橙色、运行态主色蓝，箭头经 CSS offset-path 沿连线几何（bezier d）运动，
               offset-rotate: auto 随路径切线转向；
               方向即数据流方向：连线路径从 source→target 生成，无需单独定义。
               箭头数量/时长/延迟由 edgeArrows 按连线弧长推导：恒定线速度（约 110 流坐标 px/s）
               + 等距多箭头（上限 6），使长短连线的视觉速度与箭头密度一致——详见 canvas/edgeFlow.ts -->
          <template #edge-default="edgeProps">
            <BezierEdge v-bind="edgeProps" />
            <path
              v-for="arrow in edgeArrows(edgeProps)"
              :key="arrow.key"
              class="canvas-edge__arrow"
              :style="arrow.style"
              d="M10,0 L0,-5 L2.5,0 L0,5 Z"
            />
          </template>
          <!-- 连线拖拽预览线插槽（从节点端点拖出连接线时由 Vue Flow 挂载，交互结束即销毁）：
               仅高亮预览线本身——统一画布主题色 + 2px 加粗 + 同色光晕，
               明显区别于默认预览线（1px 灰）。**不按输入/输出端点分色**：
               预览线的职责只是「正在连线」，起点端口类型已由鼠标下的端点与 Vue Flow 的
               端点指示器表达，再用颜色编码一次只会引入「按起点还是按落点」的歧义
               （一条连线两端必为一输入一输出，两种规则互为镜像、各有道理却都不直观）。
               几何由 connectionPreview 按与默认预览线（Bezier）完全一致的参数计算，不做换算。
               不影响既有连线高亮：单选联动、运行态高亮、改接虚线的派生集与样式均未改动。 -->
          <template #connection-line="connectionProps">
            <path
              :d="connectionPreview(connectionProps)"
              class="canvas-connection-preview"
              fill="none"
              stroke-linecap="round"
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
              :running-adjacent="isBlueprint ? false : runningInputNodeIds.has(id)"
              :status="isBlueprint ? undefined : statusByNode[id]"
              :is-running="isBlueprint ? undefined : (nodeMap[id]?.prototypeId === 'text-ai' ? statusByNode[id]?.status === 'running' : undefined)"
              :canvas-target="nodeMap[id]?.prototypeId === 'text-ai' ? canvasTarget : undefined"
              :output="isBlueprint ? null : outputOf(nodeMap[id])"
              :upload="isBlueprint ? null : upload.stateOf(id)"
              :upstream-updated="isBlueprint ? false : isUpstreamUpdated(id)"
              :inputs="cardInputsOf(id)"
              :text-inputs="cardTextInputsOf(id)"
              :source-label="nodeMap[id]?.prototypeId === 'input-preview' ? previewInputsOf(id)?.sourceLabel : undefined"
              :source-input-count="nodeMap[id]?.prototypeId === 'input-preview' ? previewInputCountOf(id) : undefined"
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
              @detail="(nodeId: string) => openNodeLog(nodeId, statusByNode[nodeId]?.taskId)"
              @interrupt="onInterrupt"
              @start-rename="startRename"
              @update:rename-value="onRenameInput"
              @commit-rename="commitRename"
              @cancel-rename="cancelRename"
              @resize-end="onNodeResizeEnd"
              @context-menu="(e: MouseEvent) => openNodeContextMenu(e, id)"
            />
          </template>
          <!-- 群组虚线框（多选 ≥2 个节点；纯展示，整框 pointer-events: none —— 不允许成为框内元素的遮罩，
               整体移动选中节点改为拖动任一选中节点/分组标题条） -->
          <template #node-group-frame>
            <CanvasGroupFrame />
          </template>
          <!-- 群组输出连接点（拖拽成组连接；mousedown 由 useCanvasGroup 承接） -->
          <template #node-group-dot>
            <CanvasGroupDot @mousedown="onDotMouseDown" />
          </template>
          <!-- 持久分组框（canvas.json groups[]；标题条/四边拖动、双击改名、色点改色、八向缩放） -->
          <template #node-canvas-group="{ id, selected }">
            <CanvasGroupNode
              v-if="groupMap[id]"
              :group="groupMap[id]"
              :selected="selected || selectedGroupIds.includes(id)"
              :is-empty="emptyGroupIds.has(id)"
              :renaming="renamingGroupId === id"
              :rename-value="groupRenameInput"
              @drag-start="onGroupDragStart"
              @start-rename="startRenameGroup"
              @update:rename-value="onGroupRenameInput"
              @commit-rename="commitRenameGroup"
              @cancel-rename="cancelRenameGroup"
              @open-color="openColorMenu"
              @context-menu="(e: MouseEvent, groupId: string) => openGroupEntityContextMenu(e, groupId)"
              @resize-end="onGroupResizeEnd"
            />
          </template>
        </VueFlow>

        <!-- 连线改接覆盖层（连接转移/连接复制拖拽中）：预览曲线（固定端→鼠标）+ 徽标；均不拦截指针 -->
        <svg
          v-if="rewireDrag.active && rewireCurves.length > 0"
          class="asset-canvas__rewire-line"
        >
          <path
            v-for="(d, index) in rewireCurves"
            :key="index"
            :d="d"
            class="asset-canvas__rewire-curve"
            :class="{ 'asset-canvas__rewire-curve--copy': rewireDrag.mode === 'copy' }"
          />
        </svg>
        <div
          v-if="rewireDrag.active"
          class="asset-canvas__rewire-badge"
          :style="{ left: `${rewireDrag.mouse.x + 14}px`, top: `${rewireDrag.mouse.y + 14}px` }"
        >
          {{ rewireDrag.connectionIds.length }} 条连线 · {{ rewireDrag.mode === 'copy' ? '复制' : '转移' }}
        </div>

        <!-- 多选悬浮工具栏（选中节点数 + 选中分组数 ≥ 2 时在多选框顶部居中；含「创建分组」「创建蓝图」） -->
        <CanvasSelectionToolbar
          :rect="groupRect"
          :viewport="viewport"
          :flow-width="flowWidth"
          :has-group-selected="selectedGroupIds.length > 0"
          :has-node-selected="selectedNodeIds.length > 0"
          @create-group="createGroupFromSelection"
          @create-blueprint="openBlueprintSave"
        />

        <!-- 分组预设色板（标题条色点 / 右键菜单「更改颜色」触发；坐标相对画布容器） -->
        <div
          v-if="colorMenu.show"
          class="canvas-group-color-menu"
          :style="{ left: `${colorMenu.x}px`, top: `${colorMenu.y}px` }"
          @mousedown.stop
        >
          <button
            v-for="color in colorPalette"
            :key="color"
            type="button"
            class="canvas-group-color-menu__swatch"
            :style="{ background: color }"
            :title="color"
            @click="pickGroupColor(color)"
          />
        </div>

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
          :output="isBlueprint ? null : (editorPanel ? outputOf(editorPanel.node) : null)"
          :output-path="isBlueprint ? undefined : (editorPanel ? outputPathOf(editorPanel.node) : undefined)"
          :upload-state="editorPanel ? upload.stateOf(editorPanel.node.id) ?? null : null"
          :video-input-groups="videoInputGroups"
          :text-inputs="editorTextInputs"
          :is-running="editorPanel ? isNodeRunning(editorPanel.node.id) : false"
          :kind="target.kind"
          :viewport="viewport"
          :other-nodes="otherCanvasNodes"
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

        <!-- 右键菜单（节点 + 连线 + 多选群组 + 分组实体）；蓝图模式隐藏执行类入口 -->
        <CanvasContextMenu
          :node-menu="contextMenu"
          :can-generate="isBlueprint ? false : canGenerateOf(contextMenuNode)"
          :has-history="isBlueprint ? false : hasHistoryOf(contextMenuNode)"
          :can-save="isBlueprint ? false : canSaveImage(contextMenuNode)"
          :save-targets="saveTargetsOf(contextMenuNode)"
          :has-connections="!!contextMenuNode && nodeHasConnections(contextMenu.nodeId)"
          :edge-menu="edgeMenu"
          :group-entity-menu="groupEntityMenu"
          @generate="contextGenerate"
          @history="contextHistory"
          @save-as="contextSaveAs"
          @disconnect="contextDisconnect"
          @rename="contextRename"
          @copy="contextCopy"
          @delete="contextDelete"
          @disconnect-edge="disconnectEdge"
          @group-entity-rename="groupEntityRename"
          @group-entity-color="groupEntityColor"
          @group-entity-dissolve="groupEntityDissolve"
        />

        <!-- 添加节点菜单（双击空白处/工具栏「＋」在鼠标处弹出；底部含「插入蓝图…」，蓝图模式隐藏） -->
        <CanvasAddNodeMenu
          :model-value="addMenu.show"
          :x="addMenu.x"
          :y="addMenu.y"
          :blueprint-mode="isBlueprint"
          @update:model-value="addMenu.show = $event"
          @select="addNodeAt"
          @insert-blueprint="openBlueprintInsertAtMenu"
        />

        <!-- 资产拖放菜单（从左侧资产浏览器拖入角色/子场景/道具后，在释放位置弹出；
             图片/音频/视频各占一行：媒体标签 + 横向滚动条目（缩略图/试听组件 + 条目名），
             点击条目名即在释放位置创建对应加载节点） -->
        <CanvasAssetDropMenu
          v-if="!isBlueprint"
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
             自动保存已停止（蓝图编辑器为手动保存），提示用户手动备份当前内容或强制覆盖保存 -->
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
            {{ isBlueprint ? '蓝图保存冲突' : '画布保存冲突' }}
          </div>
          <div class="canvas-conflict-banner__text">
            {{ isBlueprint ? '蓝图' : '画布' }}已被其他人或引用更新修改（当前版本 {{ conflict.currentRev }}，您基于版本 {{ conflict.expectedRev }}
            编辑），保存已停止。请手动备份当前内容，或选择强制覆盖保存。
          </div>
          <div class="canvas-conflict-banner__actions">
            <v-btn
              size="small"
              variant="outlined"
              prepend-icon="mdi-download"
              @click="downloadLocalBackup"
            >
              {{ isBlueprint ? '备份当前蓝图' : '备份当前画布' }}
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
          {{ isBlueprint ? '蓝图为空' : '画布为空' }}
        </div>
        <div class="text-body-small text-medium-emphasis">
          双击空白处或点击工具栏「＋」添加节点
        </div>
      </div>

      <!-- 文本历史版本对话框（AI 文本生成节点：config.outputHistory 纯文本快照，无服务端请求）
           蓝图模式不提供历史查看 -->
      <AiTextHistoryDialog
        v-if="!isBlueprint && historyNode?.prototypeId === 'text-ai'"
        v-model="historyDialog.show"
        :project="props.project"
        :node="historyNode"
        @update:config="(patch: Record<string, unknown>) => historyNode && onUpdateConfig(historyNode.id, patch)"
        @update:config-quiet="(patch: Record<string, unknown>) => historyNode && onUpdateConfigQuiet(historyNode.id, patch)"
        @notify="(text: string, color: 'success' | 'error' | 'primary') => showSnackbar(text, color)"
      />

      <!-- 版本历史对话框（服务端历史 API：列表/激活/删除 + 当前产物预览；适用于有产物文件的生成节点） -->
      <CanvasAssertHistoryDialog
        v-else-if="!isBlueprint"
        v-model="historyDialog.show"
        :project="props.project"
        :node="historyNode"
        :output="historyNode ? outputOf(historyNode) : null"
        @refresh="(nodeId: string) => void refreshNodeOutput(nodeId)"
        @notify="(text: string, color: 'success' | 'error' | 'primary') => showSnackbar(text, color)"
      />

      <!-- 保存为自定义资产对话框（场景/分镜双根 + 新建目录 + 文件名可编辑；蓝图模式不可用） -->
      <SaveAssetDialog
        v-if="!isBlueprint"
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

      <!-- 保存为（角色设计/角色设计-衍生变体/场景图/场景图-衍生变体）目标选择对话框；蓝图模式不可用 -->
      <SaveAsDialog
        v-if="!isBlueprint"
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
              {{ isBlueprint ? '蓝图' : '画布' }}已被其他人或引用更新修改。强制覆盖会把<b>当前{{ isBlueprint ? '蓝图' : '画布' }}内容整体写入</b>，
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

      <!-- 任务详情对话框：节点错误遮罩「详情」按钮打开，展示该任务完整日志（含级别过滤） -->
      <CanvasNodeLogDialog
        v-model="logDialog.show"
        :task-id="logDialog.taskId || null"
        :node-name="logDialog.nodeName"
      />

      <!-- 设为分镜场景图对话框（蓝图模式不可用：蓝图不绑定分镜） -->
      <SetAsSceneDialog
        v-if="!isBlueprint"
        v-model="sceneDialog.show"
        :project="props.project"
        :node="sceneDialogNode ?? null"
        :output="sceneDialogNode ? outputOf(sceneDialogNode) : null"
        :inputs="sceneDialogNode ? inputsOf(sceneDialogNode.id) : []"
        :episode="target.kind === 'scene' ? target.episode : undefined"
        :shot="target.kind === 'scene' ? target.shot : undefined"
        @done="(msg: string, color: 'success' | 'error') => showSnackbar(msg, color)"
      />

      <!-- 资产选择器（加载图片/音频/视频节点绑定资产；道具页签按节点类型过滤媒体）
           蓝图模式同样可用：项目上下文 = 蓝图资产项目（无分镜上下文） -->
      <AssetPickerDialog
        v-model="picker.show"
        :project="props.project"
        :multiple="false"
        :selected="pickerSelected"
        :tabs="pickerTabs"
        :show-voice="picker.showVoice"
        :media-kind="picker.mediaKind"
        :context-episode="!isBlueprint && target.kind === 'scene' ? target.episode : undefined"
        :context-shot="!isBlueprint && target.kind === 'scene' ? target.shot : undefined"
        @update:selected="onPickerConfirm"
      />

      <!-- 创建画布蓝图对话框（多选工具栏「创建蓝图」触发：名称/描述/保存位置；蓝图编辑器内不提供） -->
      <BlueprintSaveDialog
        v-if="!isBlueprint"
        v-model="blueprintSave.show"
        :payload="blueprintSave.payload"
        :default-project="props.project"
        @saved="onBlueprintSaved"
      />

      <!-- 插入画布蓝图对话框（工具栏「插入蓝图」/添加节点菜单底部入口触发；v1 不支持蓝图嵌套） -->
      <BlueprintInsertDialog
        v-if="!isBlueprint"
        v-model="blueprintInsert.show"
        :canvas-project="props.project"
        @insert="onBlueprintInsert"
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
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, BezierEdge, SelectionMode, getBezierPath, Position, useVueFlow, type ConnectionLineProps, type EdgeMouseEvent, type NodeDragEvent, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { useCanvasStore } from '../../canvas/useCanvasStore'
import { createIdleGeneration, useCanvasGeneration } from '../../canvas/useCanvasGeneration'
import { provideCanvasMode, type CanvasModeContext } from '../../canvas/canvasMode'
import { blueprintCanvasPersistence } from '../../api/blueprints'
import { getProjects } from '../../api/client'
import { useAutoComputeHeight } from '../../composables/useAutoComputeHeight'
import { confirm } from '../../utils/confirm'
import type { CanvasGroupData, CanvasNodeData } from '../../canvas/types'
import { canvasRelPath, type CanvasTarget } from '../../canvas/api'
import { getNodeCurrentAssetPath } from '../../canvas/generate'
import { getPrototype } from '../../canvas/registry'
import { createEdgeFlowCache } from '../../canvas/edgeFlow'
import { getCanvasNodeInfo } from '../../canvas/api'
import { extOfAudioPath } from '../../canvas/audioTrim'
import { isImageCropOutputExt } from '../../canvas/imageCrop'
import { isSyntheticNodeId, singleDraggedRealNodeId } from '../../canvas/groupSelection'
import type { RectLike } from '../../canvas/groups'
import type { CanvasScope } from '../../canvas/paths'
import { llmSocket, type LlmCanvasTarget, type LlmFinishedInfo, type LlmSessionInfo, type LlmTaskEvent } from '../../canvas/llmSocket'
import { applyLlmEvent, buildLlmFinishedAdopt, createLlmStreamState, createThrottledCommit, sameCanvasTarget, type LlmStreamState, type ThrottledCommit } from '../../canvas/llmEvents'
import { createSwitchGuard } from '../../canvas/switchGuard'
import type { CanvasStreamStatePayload } from './CanvasNodeCard.vue'
import AssetPickerDialog from '../asset-picker/AssetPickerDialog.vue'
import CanvasAssertHistoryDialog from './CanvasAssertHistoryDialog.vue'
import CanvasNodeLogDialog from './CanvasNodeLogDialog.vue'
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
import CanvasGroupNode from './CanvasGroupNode.vue'
import CanvasGroupConnectMenu from './CanvasGroupConnectMenu.vue'
import CanvasSelectionToolbar from './CanvasSelectionToolbar.vue'
import SetAsSceneDialog from './SetAsSceneDialog.vue'
import { useCanvasFlow } from './composables/useCanvasFlow'
import { useCanvasRewire } from './composables/useCanvasRewire'
import { useCanvasSelection } from './composables/useCanvasSelection'
import { useCanvasMenus } from './composables/useCanvasMenus'
import { useCanvasRename } from './composables/useCanvasRename'
import { useCanvasPaste } from './composables/useCanvasPaste'
import { useCanvasKeyboard } from './composables/useCanvasKeyboard'
import { useCanvasNodeOps, type LlmMediaInputItem } from './composables/useCanvasNodeOps'
import type { CanvasInputInfo } from '../../canvas/generate'
import { useCanvasDialogs } from './composables/useCanvasDialogs'
import { useCanvasAutobuild } from './composables/useCanvasAutobuild'
import { useCanvasGroup } from './composables/useCanvasGroup'
import { useCanvasGroups } from './composables/useCanvasGroups'
import { useCanvasUpload, type CanvasUploadFilePayload } from './composables/useCanvasUpload'
import { useCanvasAssetDrop } from './composables/useCanvasAssetDrop'
import { canvasDragPayload } from '../../canvas/assetDrop'
import { captureBlueprintFromCanvas, instantiateBlueprint, type BlueprintPayload, type CanvasBlueprint } from '../../canvas/blueprint'
import BlueprintSaveDialog from '../blueprints/BlueprintSaveDialog.vue'
import BlueprintInsertDialog from '../blueprints/BlueprintInsertDialog.vue'

/**
 * 资产画布主组件（编排层）：
 * - 组合 store / generation 与各功能组合式（交互/菜单/粘贴/快捷键/生成调度/对话框/自动搭画布）；
 * - 渲染 Vue Flow 画布与子组件（工具栏/节点卡片/配置面板/菜单/对话框）；
 * - 持有 Vue Flow 视图工具与画布容器测量，统一注入各组合式与面板组件。
 * 具体交互行为见 docs/canvas/README.md。
 */

/** 组件 props：定位一张画布（或一张蓝图） */
const props = defineProps<{
  project: string
  kind: 'stage' | 'scene'
  stage?: string
  /** 场景画布时的子场景标签 */
  label?: string
  episode?: string
  shot?: string
  /**
   * 运行模式：
   * - `'canvas'`（默认）：分镜/场景资产画布，具备生成、上传产物、历史、自动搭画布等全部能力；
   * - `'blueprint'`：蓝图编辑器（由 `BlueprintEditDialog` 内嵌），只编辑节点/连线/分组与配置，
   *   执行类动作（生成/上传产物/历史/保存为/设为场景图/自动搭画布/资产拖入）全部关闭。
   */
  mode?: 'canvas' | 'blueprint'
  /** 蓝图定位（mode='blueprint' 时必填） */
  blueprint?: { scope: 'global' | 'project'; project?: string; id: string }
  /**
   * 蓝图模式下资产上下文是否就绪（宿主根据蓝图 assetProject 是否存在且有效计算）。
   * 为 false 时加载节点「上传/选择资产」入口置灰；主画布恒为 true。
   */
  assetProjectReady?: boolean
  /** 蓝图元信息（mode='blueprint' 时由宿主传入：名称/描述/资产项目，用于信息条展示） */
  blueprintMeta?: { name: string; description: string; assetProject: string | null }
}>()

/** 组件事件 */
const emit = defineEmits<{
  /** 蓝图资产项目变更已保存（宿主同步自身状态，避免 props 回写延迟导致选择器跳动） */
  (e: 'blueprint-meta-updated', patch: { assetProject: string | null }): void
}>()

/** 是否蓝图模式（蓝图编辑器：单一画布实现复用，执行类能力关闭） */
const isBlueprint = computed(() => props.mode === 'blueprint')

/** 画布目标（分镜画布需要 episode+shot，场景画布需要 stage+label；蓝图模式为占位值） */
const target = computed(() => ({
  kind: props.kind,
  stage: props.stage,
  label: props.label,
  episode: props.episode,
  shot: props.shot,
}))

/** 场景画布未选择子场景时显示空状态（蓝图模式无子场景概念，不触发该空状态） */
const stageNoLabel = computed(() => !isBlueprint.value && props.kind === 'stage' && !props.label)

/** 画布作用域（生成类节点产物固定路径推导/输入收集需要） */
const scope = computed<CanvasScope>(() => {
  if (props.kind === 'stage') {
    return { kind: 'stage', primary: props.stage ?? '', label: props.label }
  }
  return { kind: 'scene', primary: props.episode ?? '', secondary: props.shot }
})

/**
 * 蓝图资产项目（信息条选择器）的**编辑器内当前值**。
 *
 * 手动保存模式下它只存在于内存：点「保存」/Ctrl+S 时由持久化适配器与内容在同一次
 * CAS 请求中落盘；「不保存退出」时随组件卸载丢弃。主画布不使用该状态。
 */
const blueprintAssetProject = ref<string | null>(props.blueprintMeta?.assetProject ?? null)
/** 蓝图资产项目的**已落盘值**（判断是否存在未保存的元信息改动） */
const blueprintAssetProjectSaved = ref<string | null>(props.blueprintMeta?.assetProject ?? null)

/**
 * 画布数据 store：加载/保存（CAS 版本校验）/增删改查/撤销重做。
 * 版本冲突时自动保存停止，由冲突横幅与对话框提示用户处理。
 *
 * 蓝图模式注入蓝图持久化适配器：同一套 store 能力（含撤销重做、剪贴板、CAS 保存）
 * 直接作用于蓝图文件；rev 同样由服务端维护。
 * 蓝图模式关闭自动保存（`autoSave: false`）：改动只置脏，由编辑器头部「保存」/Ctrl+S 手动落盘。
 */
const blueprintPersistence = isBlueprint.value && props.blueprint
  ? blueprintCanvasPersistence(
      props.blueprint.scope === 'project'
        ? { scope: 'project', project: props.blueprint.project }
        : { scope: 'global' },
      props.blueprint.id,
      { assetProject: () => blueprintAssetProject.value },
    )
  : undefined
const store = useCanvasStore(props.project, target.value, blueprintPersistence, { autoSave: !isBlueprint.value })
/**
 * 资产生成组合式：跑工作流 + 轮询（纯体验层）+ 结果通知 + 运行中任务持久化恢复。
 * onResult 为恢复任务完成后的默认结果回调（正常生成路径仍按调用传入的回调优先）。
 * 蓝图模式使用「空闲」空实现（不订阅 WS / 不轮询 / 不恢复任务：蓝图不产生产物）。
 */
const gen = isBlueprint.value
  ? createIdleGeneration()
  : useCanvasGeneration(props.project, target.value, {
      onResult: handleNodeResult,
      // 中断被服务端拒绝/失败：snackbar 告知原因（节点保持运行态，任务继续到终态）
      onCancelRejected: (_nodeId, reason) => showSnackbar(`中断失败：${reason}`, 'error'),
    })
const { statusByNode } = gen
const { loaded, nodes, dirty, saving, canUndo, canRedo, undo, redo, conflict, savedRev, forceSave, reloadFromServer } = store
const router = useRouter()
const route = useRoute()

/**
 * 画布模式上下文（注入给节点主体 / 编辑器组件）：
 * - 蓝图模式隐藏执行类动作（生成、上传产物、历史、设为场景图等）；
 * - 资产类入口（上传 / 选择资产）在蓝图模式下依赖「资产项目就绪」。
 */
const canvasModeContext = reactive<CanvasModeContext>({
  mode: isBlueprint.value ? 'blueprint' : 'canvas',
  assetProjectReady: true,
  assetProject: '',
})
provideCanvasMode(canvasModeContext)
watchEffect(() => {
  canvasModeContext.mode = isBlueprint.value ? 'blueprint' : 'canvas'
  canvasModeContext.assetProjectReady = isBlueprint.value ? props.assetProjectReady !== false && !!props.project : true
  canvasModeContext.assetProject = isBlueprint.value ? props.project : ''
})

// ── 节点产物展示状态（固定路径 + 服务端 mtime；"当前结果"为文件系统事实）────────

/** nodeId → { 产物路径, mtime, exists }（画布加载与生成完成时从服务端 node-info 刷新） */
const nodeOutputs = ref<Record<string, { path: string; mtime: number | null; exists: boolean }>>({})

/** 刷新单个节点产物信息（存在性/mtime） */
async function refreshNodeOutput(nodeId: string): Promise<void> {
  // 蓝图模式无产物（蓝图不携带产物文件，插入后由画布重新生成）：跳过产物探测
  if (isBlueprint.value) return
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
  // 蓝图模式无产物路径（无画布 scope）：跳过批量探测，避免构造无效产物路径
  if (isBlueprint.value) return
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

/**
 * 图片修剪与扩展节点产物扩展名镜像同步（静默、不入撤销栈）：
 * 应用成功（纯前端 canvas 合成后上传落盘）后，把实际落盘扩展名写回 config.outputExt，
 * 供无输入链路上下文处的固定产物路径推导兜底（画布加载刷新 node-info、保存为/自定义资产
 * 对话框、下游输入收集等），并保证产物存在性/mtime 查询路径与所选格式一致。
 * 先于乐观展示与 refreshNodeOutput 调用，使刷新按新扩展名推导产物路径。
 *
 * @param nodeId 节点 id
 * @param outputPath 上传落盘的产物相对路径（output.png / output.jpg）
 */
function syncImageCropOutputMirror(nodeId: string, outputPath: string): void {
  const node = nodeMap.value[nodeId]
  if (!node || node.prototypeId !== 'image-crop') return
  const ext = outputPath.replace(/\\/g, '/').split('.').pop()?.toLowerCase()
  if (!isImageCropOutputExt(ext) || node.config.outputExt === ext) return
  store.updateNodeQuiet(nodeId, { outputExt: ext })
}

/** 生成完成回调：产物已由服务端落盘，刷新该节点展示（先乐观更新，再取真实 mtime） */
function handleNodeResult(nodeId: string, outputPath: string): void {
  syncAudioTrimOutputMirror(nodeId, outputPath)
  syncImageCropOutputMirror(nodeId, outputPath)
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

/**
 * 节点卡片主体媒体输入（按原型分发，避免模板内重复求值）：
 * - `text-ai`（AI文本生成）：本节点自身的媒体输入；
 * - `input-preview`（输入预览）：**上游来源节点**的媒体输入（穿透一层，见 previewInputsOf）；
 * - 其余原型：undefined（主体组件不接收 inputs）。
 *
 * @param nodeId 节点 id
 * @returns 媒体输入条目；该原型不使用输入预览时 undefined
 */
function cardInputsOf(nodeId: string): LlmMediaInputItem[] | CanvasInputInfo[] | undefined {
  const proto = nodeMap.value[nodeId]?.prototypeId
  if (proto === 'text-ai') return llmMediaInputsOf(nodeId)
  if (proto === 'input-preview') return previewInputsOf(nodeId)?.media
  // 图片修剪与扩展：节点主体只读预览需要本节点自己的图片输入（占位文案与提示用）
  if (proto === 'image-crop') return imageInputsOf(nodeId)
  return undefined
}

/**
 * 节点卡片主体文本输入（按原型分发）：
 * - `text-ai`：本节点自身连接的「文本」节点内容；
 * - `input-preview`：**上游来源节点**连接的文本输入内容（穿透一层）；
 * - 其余原型：undefined。
 *
 * @param nodeId 节点 id
 * @returns 文本输入内容数组；该原型不使用文本输入时 undefined
 */
function cardTextInputsOf(nodeId: string): string[] | undefined {
  const proto = nodeMap.value[nodeId]?.prototypeId
  if (proto === 'text-ai') return textInputsOf(nodeId)
  if (proto === 'input-preview') return previewInputsOf(nodeId)?.texts
  return undefined
}

/**
 * 输入预览节点：上游来源节点的输入总数（媒体 + 文本），用于来源行「N 个输入」展示。
 *
 * @param nodeId 输入预览节点 id
 * @returns 输入总数；未连接上游节点时 undefined
 */
function previewInputCountOf(nodeId: string): number | undefined {
  const data = previewInputsOf(nodeId)
  if (!data) return undefined
  return data.media.length + data.texts.length
}

/** Vue Flow 视图控制：适应/缩放/屏幕坐标换算/程序化选中与取消选中/命令式移动节点 */
const { fitView, zoomIn, zoomOut, setViewport, setState, getNodes, screenToFlowCoordinate, viewport, findNode, addSelectedNodes, removeSelectedNodes, updateNode, onNodesInitialized } = useVueFlow()

/**
 * 适应视图参数：把全部节点包围盒放进可视区并居中。
 * maxZoom=1 避免节点很少时被放到超过 100%；padding 留出边缘空隙。
 */
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1, duration: 0 } as const

/** 组件是否已卸载（异步 load / fitView 完成后不再改视口或恢复任务） */
let disposed = false
/**
 * 画布淘汰守卫：**画布切换**与**视口适应**各自独立的世代号。
 *
 * 二者不可共用计数器——切换流程中途会调用 `scheduleFitCanvas()`（推进视口世代号），
 * 共用时切换自身的守卫会被中途顶掉，收尾步骤（如 AI 文本节点 Loading 恢复）恒不执行；
 * 缺陷记录见 `docs/plans/bug/2026-09-12-ai-text-node-loading-lost-on-canvas-switch.md`。
 */
const guard = createSwitchGuard()
/** 是否仍需在节点尺寸就绪 / 画布变为可见后重试适应视图 */
let pendingFitView = false
/** 当前待完成视口任务的世代号（onNodesInitialized / 容器尺寸就绪后按它重试） */
let fitViewPendingSeq = 0
/** 串行化 fitView，避免过期请求在新画布对准之后又把视口改回旧包围盒 */
let fitViewChain: Promise<void> = Promise.resolve()

/**
 * 工具栏「适应视图」：立即按当前节点包围盒对准视口。
 */
function onFitView(): void {
  void fitView({ ...FIT_VIEW_OPTIONS })
}

/**
 * 读取当前画布可视区矩形（流坐标；供「粘贴副本是否可见」判定）。
 *
 * 用容器 `getBoundingClientRect` + `screenToFlowCoordinate` 把可视区四角换算到流坐标，
 * 容器不存在或尺寸为 0（画布 Tab 隐藏）时返回 null，由调用方跳过视口判定。
 *
 * @returns 可视区矩形（流坐标）；不可用时返回 null
 */
function visibleFlowRect(): RectLike | null {
  const rect = flowEl.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  const a = screenToFlowCoordinate({ x: rect.left, y: rect.top })
  const b = screenToFlowCoordinate({ x: rect.left + rect.width, y: rect.top + rect.height })
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

/** 粘贴副本对准视口时的尺寸等待参数：每次等待毫秒数与最大等待次数 */
const REVEAL_PASTE_WAIT_MS = 40
const REVEAL_PASTE_MAX_TRIES = 8

/**
 * 把视口对准指定实体（粘贴副本完全落在可视区外时调用）。
 *
 * `fitView` 只纳入**已测出宽高**的节点：粘贴后 Vue Flow 需要若干帧才会测量新节点
 * （见 Vue Flow `fitView` 实现的 `!nodesToFit.length` 分支返回 false）。故先轮询等待
 * 目标节点测出尺寸（最多 `REVEAL_PASTE_MAX_TRIES` 次 × `REVEAL_PASTE_WAIT_MS` 毫秒），
 * 仍未就绪时返回 false，由调用方提示用户手动缩小查看，不静默失败。
 *
 * @param nodeIds 目标节点 id 列表（新粘贴的节点）
 * @param groupIds 目标分组 id 列表（新粘贴的分组；分组同样渲染为 Vue Flow 节点）
 * @returns 视口是否成功对准
 */
async function revealPastedEntities(nodeIds: string[], groupIds: string[]): Promise<boolean> {
  const ids = [...nodeIds, ...groupIds]
  if (ids.length === 0) return false
  /** 目标节点是否全部已测出宽高（分组框尺寸经 style 下发，同样计入） */
  const measured = (): boolean =>
    ids.every((id) => {
      const node = findNode(id)
      return !!node && node.dimensions.width > 0 && node.dimensions.height > 0
    })
  for (let attempt = 0; attempt < REVEAL_PASTE_MAX_TRIES; attempt += 1) {
    if (attempt === 0) await nextTick()
    else await new Promise((resolve) => setTimeout(resolve, REVEAL_PASTE_WAIT_MS))
    if (disposed) return false
    if (!measured()) continue
    const ok = await fitView({ ...FIT_VIEW_OPTIONS, nodes: ids })
    if (ok) return true
  }
  return false
}

/**
 * Vue Flow 内部节点是否已切到当前画布且测出宽高。
 * 切换分镜后 store 已是新节点，但 Vue Flow 可能仍持有旧节点尺寸；此时 fitView 会对准旧包围盒。
 *
 * @returns 空画布视为就绪；否则要求内部节点集合与 store 一致且均已测量
 */
function vueFlowMatchesStore(): boolean {
  // 期望集 = 真实节点 + 持久分组框：canvas-group 同样渲染为 Vue Flow 节点，
  // 若不把 store.groups 计入，含分组框的画布 current.length 永远多出分组数 → 适应视图被永久跳过。
  const expectedIds = new Set<string>([
    ...store.nodes.value.map((n) => n.id),
    ...store.groups.value.map((g) => g.id),
  ])
  if (expectedIds.size === 0) return true
  // 过滤群组合成节点（多选时临时渲染，不入 store）
  const current = getNodes.value.filter((n) => !isSyntheticNodeId(n.id))
  if (current.length !== expectedIds.size) return false
  for (const n of current) {
    if (!expectedIds.has(n.id)) return false
    if (!n.dimensions.width || !n.dimensions.height) return false
  }
  return true
}

/**
 * 将画布视口对准当前全部资产节点（居中 + 缩放落入可视区）。
 * Vue Flow 的 fitView 要求节点已测出宽高；测量未完成、节点尚未切到当前画布、或容器尺寸为 0 时保持 pending，
 * 由 onNodesInitialized / 容器 ResizeObserver 再试。快速切换分镜时以世代号丢弃过期请求。
 *
 * @param seq scheduleFitCanvas 分配的视口世代号
 */
function fitCanvasToNodes(seq: number): Promise<void> {
  const task = async (): Promise<void> => {
    if (!pendingFitView || disposed || !guard.isCurrentFit(seq)) return
    if (store.nodes.value.length === 0 && store.groups.value.length === 0) {
      pendingFitView = false
      await setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 })
      return
    }
    if ((flowEl.value?.clientWidth ?? 0) <= 0 || (flowEl.value?.clientHeight ?? 0) <= 0) return
    await nextTick()
    if (!pendingFitView || disposed || !guard.isCurrentFit(seq)) return
    if (!vueFlowMatchesStore()) return
    const ok = await fitView({ ...FIT_VIEW_OPTIONS })
    if (ok && guard.isCurrentFit(seq) && !disposed) pendingFitView = false
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
  fitViewPendingSeq = guard.beginFit()
  void fitCanvasToNodes(fitViewPendingSeq)
}

onNodesInitialized(() => {
  if (pendingFitView) void fitCanvasToNodes(fitViewPendingSeq)
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

/** 分组 id → 分组数据（持久分组节点插槽内直接索引） */
const groupMap = computed<Record<string, CanvasGroupData>>(() => {
  const m: Record<string, CanvasGroupData> = {}
  for (const g of store.groups.value) m[g.id] = g
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

/** 框选开始：记录选框起点（持久分组「完全包含才选中」判定需要，见 useCanvasGroups） */
function onSelectionStart(event: MouseEvent): void {
  canvasGroups.onSelectionStart(event)
}

/**
 * 框选结束（Vue Flow 内部已完成选中计算）：
 * 1. 同步回应用级节点多选状态；
 * 2. 用选框矩形判定「被完全包含的持久分组」并写入分组选中集（FR-7.1 / FR-7.2）。
 */
function onSelectionEnd(event: MouseEvent): void {
  selection.syncFromVueFlow(getVueFlowSelectedNodeIds)
  canvasGroups.onSelectionEnd(event)
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
 * 从 finished 载荷提取后端实际落盘的 config 补丁（output / outputHistory）。
 *
 * @param info finished 载荷（恢复路径事件或全局广播；可能缺省）
 * @returns 补丁对象；无任何落盘内容（写入跳过/降级）返回 null
 */
function llmFinishedPatch(info: LlmFinishedInfo | undefined): Record<string, unknown> | null {
  if (!info || (info.output === undefined && !info.outputHistory)) return null
  return {
    ...(info.output !== undefined ? { output: info.output } : {}),
    ...(info.outputHistory ? { outputHistory: info.outputHistory } : {}),
  }
}

/**
 * 全局终态广播监听（服务端落盘完成后向全部客户端广播，不依赖按任务订阅）：
 * 按 项目 + 画布 scope 过滤，且当前 savedRev === 落盘前版本号（prevRev）时，
 * 仅单独采纳该 AI 文本节点的落盘补丁（入撤销栈 + savedRev 对齐为落盘后 rev，
 * 不触发写盘）。刷新后恢复路径即使已因 sessions 对账退订，版本对齐也不会丢失。
 */
const offLlmFinishedGlobal = llmSocket.onFinished((info) => {
  // 蓝图模式无 AI 文本会话落盘（生成已关闭）：不采纳
  if (isBlueprint.value) return
  // 切换画布进行中（load 未完成）不采纳：target/savedRev 均处于过渡态
  if (!store.loaded.value) return
  const adopt = buildLlmFinishedAdopt(info, props.project, target.value, store.savedRev.value)
  if (!adopt) return
  const node = nodeMap.value[adopt.nodeId]
  if (!node || node.prototypeId !== 'text-ai') return
  adoptLlmResult(adopt.nodeId, adopt.patch, adopt.rev) // 按 rev 幂等（与在线/恢复路径双投递去重）
})
onUnmounted(offLlmFinishedGlobal)

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
 * 按服务端活跃会话列表恢复本画布的 AI 文本节点 Loading：
 * 会话 running 且 nodeId 存在于 nodeMap → beginClientRun + 恢复订阅
 * （subscribe → snapshot 补齐 → 增量实时显示 → 终态 adopt 收敛）。
 * 画布加载 / 切换 / WS 重连（sessions 全量刷新）时调用，已订阅任务幂等跳过。
 */
function restoreLlmSessions(): void {
  // 蓝图模式无 LLM 会话（生成已关闭）：不恢复
  if (isBlueprint.value) return
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
  const patch = llmFinishedPatch(info)
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
 * 重连对账：本端已恢复订阅/在线发起的任务不在服务端活跃列表 → 结束 Loading
 * （服务重启后注册表为空 → 无 Loading 恢复、无幽灵 Loading；未终态会话的
 * 部分输出丢失为内存方案的既定取舍，结果以文件为准）。
 * 断线期间不做对账（列表可能过期），重连后 sessions 全量刷新时再次执行。
 *
 * 对账基准为**统一注册表全量活跃列表**（含 pending，各类型任务混合）：
 * 注册表是运行态唯一事实源，taskId 不在列表 = 已终态收敛（终态即移出活跃区）。
 * 除恢复订阅条目（llmRestore）外，在线发起路径（statusByNode 持 taskId 的 running
 * 条目，含 AI 文本节点）一并兜底——finished/not-found 终态事件丢失（如断线错过/
 * 广播缺失）时本地结束 Loading，防止幽灵 Thinking；ffmpeg/工作流条目同样按此
 * 收敛是安全的：其终态机制（task-update 广播 / 轮询）随后到达时幂等覆盖，
 * 且工作流任务轮询的 SQLite 状态先于注册表收敛，不会出现 running 误闪。
 */
function reconcileLlmRestore(): void {
  if (!llmSocket.connected.value) return
  const activeTaskIds = new Set(llmSocket.tasks.value.map((t) => t.id))
  for (const [taskId, entry] of [...llmRestore]) {
    if (activeTaskIds.has(taskId)) continue
    gen.endClientRun(entry.nodeId)
    entry.unsubscribe()
    llmRestore.delete(taskId)
  }
  // 在线路径兜底：llmRestore 条目已在上方处理，此处跳过避免重复收敛
  for (const [nodeId, s] of Object.entries(statusByNode.value)) {
    if (s.status !== 'running' || !s.taskId || llmRestore.has(s.taskId)) continue
    if (activeTaskIds.has(s.taskId)) continue
    gen.endClientRun(nodeId)
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
  // 蓝图编辑器无左侧资产浏览器：不接受资产拖入
  if (isBlueprint.value) return
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
  // 蓝图编辑器无左侧资产浏览器：不接受资产拖入
  if (isBlueprint.value) return
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
  getSelectedGroupIds: () => selection.selectedGroupIds.value,
  screenToFlowCoordinate,
  viewport,
  flowEl,
  showSnackbar,
  focusNode: (ids) => void focusNodes(ids),
})

/**
 * 持久分组交互组合式：创建/拖动（R2 级联）/缩放/改名/改色/解散/框选完全包含判定/
 * 多选拖动时选中分组跟随。拖动中经 updateNode 命令式移动内部坐标（视图跟随，不写 store）。
 */
const canvasGroups = useCanvasGroups({
  store,
  nodeMap,
  screenToFlowCoordinate,
  viewport,
  flowEl,
  updateNodePosition: (nodeId, position) => updateNode(nodeId, { position }),
  selection: {
    getSelectedNodeIds: () => selection.selectedNodeIds.value,
    getSelectedGroupIds: () => selection.selectedGroupIds.value,
    setSelectedGroups: selection.setSelectedGroups,
    setSelectedNodes: selection.setSelectedNodes,
    selectGroupWithMembers: selection.selectGroupWithMembers,
    toggleGroupWithMembers: selection.toggleGroupWithMembers,
  },
  showSnackbar,
})

/** 创建画布蓝图对话框状态（payload 为捕获到的选中集内容） */
const blueprintSave = reactive<{ show: boolean; payload: BlueprintPayload | null }>({ show: false, payload: null })

/**
 * 多选工具栏「创建蓝图」：把选中节点 + 组内连线 + 选中分组捕获为蓝图内容并打开保存对话框。
 *
 * 捕获规则见 `canvas/blueprint.ts: captureBlueprintFromCanvas`：
 * 分组**必须被显式选中**（只选中组内全部节点时不带分组），且组内成员节点须全部在选中集内；
 * 无选中节点时提示且不打开对话框。
 */
function openBlueprintSave(): void {
  const nodeIds = selection.selectedNodeIds.value
  if (nodeIds.length === 0) {
    showSnackbar('请先选中至少 1 个节点再创建蓝图', 'error')
    return
  }
  blueprintSave.payload = captureBlueprintFromCanvas(
    { nodes: store.nodes.value, connections: store.connections.value, groups: store.groups.value },
    nodeIds,
    selection.selectedGroupIds.value,
  )
  blueprintSave.show = true
}

/**
 * 蓝图保存成功：提示保存位置（全局 / 项目）。
 *
 * @param blueprint 已保存的蓝图（取名称）
 * @param scopeLabel 作用域展示文案（「全局」或「项目 xxx」）
 */
function onBlueprintSaved(blueprint: CanvasBlueprint, scopeLabel: string): void {
  showSnackbar(`已保存蓝图「${blueprint.name}」到 ${scopeLabel}`, 'success')
}

/**
 * 运行中（Loading）节点 id 集合：statusByNode 中 status === 'running' 的节点
 * （工作流/ffmpeg/AI 文本统一状态机；刷新/切画布经 restore 恢复后同样计入）。
 * 运行态高亮数据源：运行节点自身脉冲边框 + 直接输入连线/上游节点联动高亮。
 *
 * 实现说明：用 watch + 内容相等性守卫维护，**不用 computed**——轮询期间每个 tick 都会
 * 整体重写节点状态对象（lastLog 变化），computed 每次重算都返回新 Set 实例，经
 * flowEdgeList 级联使 Vue Flow 触发 setEdges 整体重建边对象，EdgeWrapper 重渲染时
 * 插槽函数引用已变化（AssetCanvas 模板重渲染产生新函数），Vue 按不同组件类型处理而
 * remount 插槽子树，连线箭头动画被反复重置归零。内容相等时保持同一 Set 实例，下游
 * runningInputEdgeIds/flowEdgeList 命中缓存零重算（真正开始/结束运行时集合照常更新）。
 */
const runningNodeIds = ref(new Set<string>())
watch(
  statusByNode,
  () => {
    const next = new Set<string>()
    for (const [id, s] of Object.entries(statusByNode.value)) {
      if (s.status === 'running') next.add(id)
    }
    const prev = runningNodeIds.value
    if (next.size === prev.size && [...next].every((id) => prev.has(id))) return
    runningNodeIds.value = next
  },
  { deep: true, immediate: true },
)

/** 连线改接（连接转移/连接复制）：Shift+左键拖拽批量转移端点上的连线，Ctrl+左键批量复制 */
const rewire = useCanvasRewire({
  store,
  flowEl,
  findNode,
  viewport,
  showSnackbar,
  onConnectionsAdded: (connections) => {
    // flow 在其后创建（函数声明提升），音频来源→生成视频节点联动探测与手动连线一致
    for (const connection of connections) {
      flow.probeDirectorAudioDuration(connection.fromNodeId, connection.toNodeId)
    }
  },
})

/** Vue Flow 渲染映射、群组合成节点、持久分组节点与连线交互（含单选联动高亮与运行态高亮的派生集） */
const flow = useCanvasFlow({
  store,
  nodeMap,
  project: props.project,
  selectedEdgeId: selection.selectedEdgeId,
  selectedNodeIds: selection.selectedNodeIds,
  runningNodeIds,
  groupRect: group.groupRect,
  ctrlHeld: canvasGroups.ctrlHeld,
  // 仅连接转移（拔出原线）显示虚线样式；连接复制原线保持原样
  rewiringEdgeIds: computed(() =>
    rewire.rewireDrag.mode === 'transfer' ? new Set(rewire.rewireDrag.connectionIds) : new Set<string>(),
  ),
})

/** 对话框与资产选择器 */
const dialogs = useCanvasDialogs({ store, nodeMap, project: props.project, target, getScope: () => scope.value, showSnackbar })

/** 右键菜单、群组菜单、分组实体菜单与添加节点菜单 */
const menus = useCanvasMenus({
  store,
  nodeMap,
  selection: {
    setSelectedNode: selection.setSelectedNode,
    deleteNode: selection.deleteNode,
    deleteSelected: selection.deleteSelected,
    getSelectedNodeIds: () => selection.selectedNodeIds.value,
    getSelectedGroupIds: () => selection.selectedGroupIds.value,
  },
  rename: { startRename: rename.startRename },
  groupActions: {
    startRename: canvasGroups.startRenameGroup,
    openColorAt: canvasGroups.openColorMenuAt,
    dissolve: canvasGroups.dissolveGroup,
  },
  dialogs: { openHistory: dialogs.openHistory, openSaveAsset: dialogs.openSaveAsset, openSaveAs: dialogs.openSaveAs },
  getScope: () => scope.value,
  generate: (nodeId: string) => void nodeOps.generateNode(nodeId),
})

/** 剪贴板粘贴（文件/文本/画布内复制节点与分组）与 Ctrl+D 复制粘贴整组 */
const paste = useCanvasPaste({
  store,
  flowEl,
  screenToFlowCoordinate,
  findNode,
  addSelectedNodes,
  selection: {
    setSelectedNodes: selection.setSelectedNodes,
    setSelectedGroups: selection.setSelectedGroups,
    setSuppressPanelOnSelect: selection.setSuppressPanelOnSelect,
  },
  getSelectedNodeIds: () => selection.selectedNodeIds.value,
  getSelectedGroupIds: () => selection.selectedGroupIds.value,
  upload,
  // 粘贴副本完全落在可视区外时把视口对准副本（可见则不动视口，避免打断操作）
  visibleFlowRect,
  revealPastedEntities,
  showSnackbar,
  // 蓝图模式未设置资产项目时阻止媒体粘贴（无项目上下文无法上传资产）
  mediaBlockedReason: () => (isBlueprint.value && !assetContextReady.value ? '请先在蓝图中选择资产项目，再粘贴媒体' : null),
})

/** 关闭全部菜单（含群组连接目标菜单与分组色板菜单） */
function closeAllMenus(): void {
  menus.closeAll()
  group.closeConnectMenu()
  canvasGroups.closeColorMenu()
}

/** 键盘快捷键 */
const keyboard = useCanvasKeyboard({
  store,
  selection: {
    getSelectedNodeIds: () => selection.selectedNodeIds.value,
    getSelectedGroupIds: () => selection.selectedGroupIds.value,
    selectedEdgeId: selection.selectedEdgeId,
    deleteSelected: selection.deleteSelected,
  },
  menus: { closeAll: closeAllMenus },
  rename: { cancelRename: rename.cancelRename },
  groups: { cancelRename: canvasGroups.cancelRenameGroup, closeColorMenu: canvasGroups.closeColorMenu },
  panel: { close: selection.dismissPanel },
  handleCtrlV: paste.handleCtrlV,
  duplicateSelected: () => void paste.duplicateSelected(),
  // Ctrl+S 仅蓝图编辑器（手动保存）接管；主画布自动保存，不拦截
  save: isBlueprint.value ? () => void saveBlueprint() : undefined,
})

/** 自动搭画布 */
const autobuild = useCanvasAutobuild({ store, nodeMap, project: props.project, target, showSnackbar })

// 组合式导出解构（模板绑定用）
const { renamingNodeId, renameInput, startRename, commitRename, cancelRename } = rename
const { editorPanel, isMultiSelected, selectedNodeIds, selectedGroupIds, onEdgeClick, onNodeDragStart: onNodeDragStartBase } = selection
const { generateNode, onInterrupt, extractNodeFrame, isNodeRunning, inputsOf, imageInputsOf, videoInputGroups, isUpstreamUpdated, onUpdateConfig, onUpdateConfigQuiet, llmMediaInputsOf, textInputsOf, previewInputsOf, editorTextInputs, disconnectInput } = nodeOps
const { flowNodes, flowEdges, relatedInputEdgeIds, relatedOutputEdgeIds, selectedEdgeClassId, adjacentInputNodeIds, adjacentOutputNodeIds, runningInputEdgeIds, runningInputNodeIds, onNodeResizeEnd, isValidConnection, onConnect, onEdgesChange, edgeMenu, disconnectEdge } = flow
const { historyDialog, historyNode, saveDialog, saveDialogNode, saveSourcePath, saveAsDialog, saveAsDialogNode, saveAsSourcePath, sceneDialog, sceneDialogNode, openSetAsScene, openSetAsShotVideo, logDialog, openNodeLog, picker, pickerTabs, pickerSelected, openAssetPicker, onPickerConfirm, openHistory } = dialogs
const { contextMenu, contextMenuNode, canGenerateOf, hasHistoryOf, canSaveImage, saveTargetsOf, contextGenerate, contextHistory, contextSaveAs, nodeHasConnections, contextDisconnect, contextRename, contextCopy, contextDelete, groupEntityMenu, groupEntityRename, groupEntityColor, groupEntityDissolve, addMenu, addNodeAt } = menus
const { autoBuilding, autoBuild } = autobuild
// 群组组合式导出（顶层解构：模板内自动解包 ref）
const { groupRect, connectDrag, connectLine, connectMenu, menuItems, hoveredNodeId, onDotMouseDown, createNodeFromMenu } = group

// 连线改接（转移/复制）导出（模板内自动解包 reactive）
const { rewireDrag } = rewire

/** 改接预览曲线 path 列表（各固定端锚点 → 鼠标位置；贝塞尔控制点水平外扩，与默认连线样式一致） */
const rewireCurves = computed<string[]>(() => {
  if (!rewireDrag.active) return []
  const m = rewireDrag.mouse
  return rewireDrag.anchorPoints.map((a) => {
    const dx = Math.max(40, Math.abs(m.x - a.x) / 2)
    return `M ${a.x},${a.y} C ${a.x + dx},${a.y} ${m.x - dx},${m.y} ${m.x},${m.y}`
  })
})
// 持久分组组合式导出（顶层解构：模板内自动解包 ref）
const { emptyGroupIds, colorMenu, colorPalette, renamingGroupId, groupRenameInput, createGroupFromSelection, onGroupDragStart, onGroupResizeEnd, onNodeDragFollow, startRenameGroup, commitRenameGroup, cancelRenameGroup, openColorMenu, pickGroupColor } = canvasGroups

// ── 插入画布蓝图（工具栏 / 添加节点菜单入口 → 对话框 → 实例化落盘）────────

/** 插入蓝图对话框状态（origin = 蓝图内容左上角落点，流坐标） */
const blueprintInsert = reactive<{ show: boolean; origin: { x: number; y: number } }>({
  show: false,
  origin: { x: 0, y: 0 },
})

/**
 * 打开插入蓝图对话框。
 *
 * @param origin 插入锚点（流坐标；蓝图内容包围盒左上角对齐到该点）
 */
function openBlueprintInsert(origin: { x: number; y: number }): void {
  blueprintInsert.origin = { x: Math.round(origin.x), y: Math.round(origin.y) }
  blueprintInsert.show = true
}

// ── 蓝图资产项目（信息条选择器）─────────────────────────────

/** 项目列表加载中 */
const assetProjectLoading = ref(false)
/** 项目下拉选项（首项为「未设置」） */
const assetProjectOptions = ref<{ title: string; value: string | null }[]>([{ title: '未设置', value: null }])

/** 资产上下文是否就绪（蓝图模式要求资产项目非空；主画布恒为 true） */
const assetContextReady = computed(() => !isBlueprint.value || !!blueprintAssetProject.value)

/**
 * 加载项目列表（蓝图信息条下拉；失败输出日志并保留「未设置」选项）。
 */
async function loadAssetProjectOptions(): Promise<void> {
  assetProjectLoading.value = true
  try {
    const entries = await getProjects()
    assetProjectOptions.value = [
      { title: '未设置', value: null },
      ...entries.map((p) => ({ title: p.name, value: p.name })),
    ]
  } catch (e) {
    console.error('[blueprint] 加载项目列表失败', e)
  } finally {
    assetProjectLoading.value = false
  }
}

/**
 * 资产项目变更（信息条下拉）：仅写入编辑器内待保存值 + 上抛宿主同步资产上下文。
 *
 * **不立即落盘**（手动保存模式）：点「保存」/Ctrl+S 时与画布内容在同一次 CAS 请求中写入；
 * 「不保存退出」时该选择一并丢弃。
 *
 * @param value 新的资产项目名（null 表示清除）
 */
function onAssetProjectChange(value: string | null): void {
  if (!isBlueprint.value) return
  const next = value ?? null
  if (next === blueprintAssetProject.value) return
  blueprintAssetProject.value = next
  // 宿主据此更新资产上下文（预览/上传/选择资产的项目），与是否落盘无关
  emit('blueprint-meta-updated', { assetProject: next })
}

// 蓝图模式进入时加载项目列表（仅一次）
if (isBlueprint.value) void loadAssetProjectOptions()

// ── 蓝图手动保存（编辑器头部「保存」/ Ctrl+S）───────────────────

/**
 * 蓝图编辑器的保存状态（经 `defineExpose` 暴露给宿主 `BlueprintEditDialog` 控制头部按钮）。
 *
 * `dirty` 同时涵盖画布内容（节点/连线/分组）与资产项目选择——两者都在同一次保存中落盘。
 */
const blueprintState = reactive({ dirty: false, saving: false, conflict: false })
watchEffect(() => {
  blueprintState.dirty = dirty.value || blueprintAssetProject.value !== blueprintAssetProjectSaved.value
  blueprintState.saving = saving.value
  blueprintState.conflict = !!conflict.value
})

/**
 * 手动保存蓝图（画布内容 + 资产项目，单次 CAS 请求）。
 *
 * 蓝图编辑器关闭了自动保存：本方法是唯一的落盘入口，由编辑器头部「保存」按钮与
 * Ctrl+S 触发；版本冲突时保留本地修改并显示冲突横幅（备份 / 强制覆盖 / 重新加载）。
 *
 * @returns true = 保存成功
 */
async function saveBlueprint(): Promise<boolean> {
  if (!isBlueprint.value) return false
  // 无改动时不写盘：避免无意义地递增 rev / 刷新 updatedAt（列表按更新时间排序）
  const dirtyNow = dirty.value || blueprintAssetProject.value !== blueprintAssetProjectSaved.value
  if (!dirtyNow) return true
  const ok = await store.save()
  if (ok) {
    blueprintAssetProjectSaved.value = blueprintAssetProject.value
    showSnackbar('蓝图已保存', 'success')
  } else if (conflict.value) {
    showSnackbar('蓝图保存冲突：请按画布上的冲突提示处理', 'error')
  } else {
    showSnackbar(store.error.value ?? '蓝图保存失败', 'error')
  }
  return ok
}

defineExpose({
  /** 蓝图模式：手动保存（内容 + 资产项目） */
  saveBlueprint,
  /** 蓝图模式：保存状态（dirty/saving/conflict），供宿主控制头部按钮 */
  blueprintState,
})

/** 工具栏入口：插入到当前视口中心（减去半个默认节点尺寸，使内容大致居中） */
function openBlueprintInsertAtViewport(): void {
  const rect = flowEl.value?.getBoundingClientRect()
  if (!rect) {
    openBlueprintInsert({ x: 80, y: 80 })
    return
  }
  const p = screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  openBlueprintInsert({ x: p.x - 120, y: p.y - 80 })
}

/** 添加节点菜单底部入口：插入到菜单锚点处（右键/双击空白处的位置） */
function openBlueprintInsertAtMenu(): void {
  addMenu.show = false
  openBlueprintInsert({ x: addMenu.flowX, y: addMenu.flowY })
}

/**
 * 确认插入蓝图：实例化（id 重映射 / 坐标归一化 / 可选独立分组）→ 原子写入画布 → 聚焦新节点。
 *
 * 写入经 `store.applyEntities`（单次撤销快照），Ctrl+Z 可整体回退；
 * 新节点聚焦时抑制配置面板弹出（仅用户点击节点才打开面板）。
 *
 * @param blueprint 蓝图详情
 * @param asGroup 是否以独立分组插入（分组名 = 蓝图名，内容嵌套在分组内）
 */
async function onBlueprintInsert(blueprint: CanvasBlueprint, asGroup: boolean): Promise<void> {
  const payload = instantiateBlueprint(
    { nodes: blueprint.nodes, connections: blueprint.connections, groups: blueprint.groups },
    { origin: blueprintInsert.origin, asGroup, groupName: blueprint.name },
  )
  if (payload.nodes.length === 0) {
    showSnackbar('该蓝图没有节点，无法插入', 'error')
    return
  }
  store.applyEntities(payload)
  await focusNodes(payload.nodes.map((n) => n.id))
  showSnackbar(
    `已插入蓝图「${blueprint.name}」（${payload.nodes.length} 个节点${asGroup ? '，含独立分组' : ''}）`,
    'success',
  )
}

/**
 * 节点拖动开始（Vue Flow 原生拖动）：
 * 1. 一律抑制配置面板显示（仅点击节点才显示配置）；
 * 2. **被拖动的真实节点恰好 1 个**时（`singleDraggedRealNodeId` 判定）进入「拖动聚焦」——
 *    应用级选中切为单选该节点，使其输入/输出关联高亮（连线分色 + 流向箭头 + 邻接节点描边）
 *    在拖动过程中即出现（高亮派生集以单选为前置条件；选中态经 mirrorSelectionToVueFlow
 *    镜像回 Vue Flow）；
 * 3. 多选整组拖动（含拖动群组虚线框：合成节点被过滤后仍剩多个真实节点）不改变选中集，
 *    保持原有整组移动语义与「多选不高亮」规则。
 *
 * @param payload Vue Flow 节点拖动开始事件（含被拖动节点列表）
 */
function onNodeDragStart(payload: NodeDragEvent): void {
  onNodeDragStartBase()
  const nodeId = singleDraggedRealNodeId(payload.nodes)
  if (!nodeId) return
  selection.focusNodeForDrag(nodeId)
}

/**
 * 节点拖动结束（Vue Flow 原生拖动）：
 * 先取出「选中分组跟随」的最终位置补丁，再与节点位置经 store.moveEntities 一次性回写（单次撤销）。
 *
 * @param payload Vue Flow 节点拖动结束事件
 */
function onNodeDragStop(payload: NodeDragEvent): void {
  flow.onNodeDragStop(payload, canvasGroups.takeNodeDragFollowPatches())
}

/**
 * 分组右键：打开分组实体菜单（重命名 / 更改颜色 / 解散分组），并关闭其他菜单。
 *
 * @param event 鼠标右键事件
 * @param groupId 分组 id
 */
function openGroupEntityContextMenu(event: MouseEvent, groupId: string): void {
  flow.closeEdgeMenu()
  menus.closeNodeMenu()
  canvasGroups.closeColorMenu()
  menus.openGroupEntityMenu(event, groupId, flowEl.value)
}

/**
 * 分组标题内联编辑输入：写入分组重命名临时值（提交由回车/失焦统一处理）。
 *
 * @param value 输入框当前值
 */
function onGroupRenameInput(value: string): void {
  groupRenameInput.value = value
}

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
 * 除选中节点外的其余真实节点（配置面板定位时作为「尽量不压住」的障碍物）。
 * 仅面板可见时计算，避免无谓重建数组。
 */
const otherCanvasNodes = computed(() => {
  const currentId = editorPanel.value?.node?.id
  if (!currentId) return []
  return store.nodes.value.filter((n) => n.id !== currentId)
})

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
 * 是否为运行态高亮连线（节点 Loading 时）：指向运行中节点的输入侧连线。
 * 供 #edge-default 插槽决定是否渲染流向箭头（箭头经连线 class 的
 * --edge-related-color 变量取主色蓝，动画与单选联动高亮共用）。
 *
 * @param edgeId 连线 id
 * @returns 属于运行态输入连线返回 true
 */
function edgeRunningRelated(edgeId: string): boolean {
  return runningInputEdgeIds.value.has(edgeId)
}

/**
 * 是否为「被点击选中」的连线（蓝，class 优先级高于单选联动）。
 * 供 #edge-default 插槽判定：选中态**不渲染流向箭头**（箭头语义是「数据正在流经」，
 * 属运行态/单选联动高亮）。必须在这里显式判定——连线 class 由 useCanvasFlow 按优先级
 * **互斥**挂载，但箭头是插槽内独立渲染的，若只按 related/running 判定，则在「节点单选 +
 * 该节点的关联连线被点击选中」时会渲染出一条实际不可见的箭头（class 被 selected 顶掉），
 * 既浪费 DOM 又与「选中态无箭头」的语义矛盾。
 *
 * @param edgeId 连线 id
 * @returns 该连线当前为点击选中态返回 true
 */
function edgeSelected(edgeId: string): boolean {
  return selectedEdgeClassId.value === edgeId
}

/**
 * 连线箭头时序缓存（按连线 id 记忆动画参数）。
 * 拖动/缩放节点时连线几何每帧变化，若每帧重算时长会让箭头瞬间跳位；缓存只在弧长
 * 变化超过阈值时重新计时（见 canvas/edgeFlow.ts）。切换画布时清空，避免旧几何残留。
 */
const edgeFlowCache = createEdgeFlowCache()

/** 流向箭头渲染项：DOM key + 内联样式（offset-path 与按弧长推导的时长/延迟） */
interface EdgeArrow {
  /** v-for 索引键：箭头数量变化时已有箭头被 patch 而非 remount，动画不重置 */
  key: number
  /** 内联样式：offset-path 沿连线几何运动，animation-duration/-delay 按弧长推导 */
  style: Record<string, string>
}

/**
 * 构建连线流向箭头列表（#edge-default 插槽内使用）。
 *
 * 未高亮（非单选联动、非运行态关联）或**被点击选中**的连线返回空数组（不渲染箭头）；
 * 高亮连线按与 BezierEdge 完全一致的参数计算连线 d 并注入 `offset-path: path(...)`，
 * 箭头从源端（source）滑向目标端（target），即数据流方向——输入侧（target=选中节点）
 * 流向选中节点，输出侧（source=选中节点）流向输出节点。
 *
 * 动画时长与箭头数量由连线弧长推导（恒定线速度 ≈110 流坐标 px/s + 沿路径等距多箭头，
 * 上限 6 个，见 canvas/edgeFlow.ts）：长短连线的视觉速度与箭头密度一致，长连线不再
 * 快到无法观察；相邻箭头以负 animation-delay 等距预分布，任意时刻都在均匀"流淌"。
 *
 * @param edgeProps Vue Flow 连线插槽 props（含连线 id 与连线几何）
 * @returns 箭头渲染项列表（空数组 = 该连线不渲染箭头）
 */
function edgeArrows(edgeProps: {
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition?: Position
  targetPosition?: Position
}): EdgeArrow[] {
  if (edgeSelected(edgeProps.id)) return []
  if (!edgeRelatedSide(edgeProps.id) && !edgeRunningRelated(edgeProps.id)) return []
  const [pathD] = getBezierPath({
    sourceX: edgeProps.sourceX,
    sourceY: edgeProps.sourceY,
    targetX: edgeProps.targetX,
    targetY: edgeProps.targetY,
    sourcePosition: edgeProps.sourcePosition ?? Position.Bottom,
    targetPosition: edgeProps.targetPosition ?? Position.Top,
  })
  const { duration, count, delayStep } = edgeFlowCache.get(edgeProps.id, pathD)
  const arrows: EdgeArrow[] = []
  for (let i = 0; i < count; i++) {
    arrows.push({
      key: i,
      style: {
        'offset-path': `path('${pathD}')`,
        'animation-duration': `${duration.toFixed(3)}s`,
        'animation-delay': `${(-i * delayStep).toFixed(3)}s`,
      },
    })
  }
  return arrows
}

/**
 * 连接预览线几何（#connection-line 插槽）。
 *
 * 与 Vue Flow 默认预览线（Bezier）逐参数一致——同一坐标系（均为流坐标，无需换算视口）、
 * 同一贝塞尔参数、同一端点位置回退规则（sourcePosition 缺省 Top / targetPosition 缺省 Bottom），
 * 使预览线与既有连线完全同形；配色（主题色）、线宽与光晕由模板类名对应的 scoped 样式决定。
 *
 * 刻意**不区分输入/输出端点**：预览线只表达「正在连线」，起点端口类型由鼠标下的端点与
 * Vue Flow 的端点指示器（connectable 端点圈）表达；若按方向分色，则「按起点」与「按落点」
 * 两种规则互为镜像（一条连线两端必为一输入一输出），怎么选都不直观。
 *
 * @param props Vue Flow 连接线插槽参数（起止坐标与起止端点位置）
 * @returns 预览线 `path` 的 `d` 字符串
 */
function connectionPreview(props: ConnectionLineProps): string {
  const [d] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition ?? Position.Top,
    targetPosition: props.targetPosition ?? Position.Bottom,
  })
  return d
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

/**
 * 空白处右键：弹出添加节点菜单（与双击一致，节点落在右键点击处）。
 * 阻止浏览器原生右键菜单，并先关闭其余菜单（不清理多选状态）。
 *
 * @param event pane 右键事件（VueFlow paneContextMenu，携带原生 MouseEvent）
 */
function onPaneContextMenu(event: MouseEvent): void {
  event.preventDefault()
  menus.closeAll()
  group.closeConnectMenu()
  const p = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  menus.openAddMenu(event, Math.round(p.x - 60), Math.round(p.y - 40), flowEl.value)
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
  // 蓝图模式不提供自动搭画布（不绑定分镜/子场景）：不执行
  if (isBlueprint.value) return
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
 * 下载当前未保存内容为 JSON 备份文件（主画布为 canvas.json，蓝图编辑器为 `蓝图名.json`）。
 */
function downloadLocalBackup(): void {
  const blob = new Blob([JSON.stringify(store.data.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = isBlueprint.value
    ? `blueprint-${(props.blueprintMeta?.name ?? 'blueprint').replace(/[\\/:*?"<>|]/g, '_')}.json`
    : canvasRelPath(target.value).replace(/\//g, '-')
  a.click()
  URL.revokeObjectURL(url)
}

/** 重新加载服务端版本（放弃本地修改；先经用户确认） */
async function reloadFromServerWithConfirm(): Promise<void> {
  const ok = await confirm({
    title: '重新加载服务端版本',
    content: isBlueprint.value
      ? '将放弃当前蓝图未保存的修改，重新加载服务端最新版本。确定继续？'
      : '将放弃当前画布未保存的修改，重新加载服务端最新版本。确定继续？',
    confirmText: '重新加载',
    confirmColor: 'warning',
  })
  if (!ok) return
  await reloadFromServer()
  // 一并放弃未保存的资产项目改动（回到已落盘值），并同步宿主资产上下文
  blueprintAssetProject.value = blueprintAssetProjectSaved.value
  emit('blueprint-meta-updated', { assetProject: blueprintAssetProjectSaved.value })
}

/** 强制覆盖保存（对话框确认后执行；成功后横幅自动消失） */
async function confirmForceSave(): Promise<void> {
  forceDialog.saving = true
  try {
    const ok = await forceSave()
    if (ok) {
      // 强制覆盖同样写入资产项目：同步已落盘基准，避免头部一直显示「未保存」
      blueprintAssetProjectSaved.value = blueprintAssetProject.value
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
  // 画布切换世代号（**独立于视口适应世代号**）：本次切换中途会 scheduleFitCanvas()，
  // 两者共用计数器会让下面每处守卫被自己顶掉，收尾的 Loading 恢复恒不执行（历史缺陷）
  const seq = guard.beginSwitch()
  pendingFitView = false
  // LLM 恢复订阅按画布隔离：本组件跨分镜/场景切换**不卸载**（gen.switchTarget 只重置
  // statusByNode 等展示态），若不清空 llmRestore，切回原画布时残留条目会让
  // 「已订阅 → 跳过恢复」成立，节点 Loading（Thinking）无法重建（历史缺陷）
  resetLlmRestore()
  selection.reset()
  rename.reset()
  menus.reset()
  flow.closeEdgeMenu()
  paste.reset()
  group.reset()
  canvasGroups.reset()
  drop.reset()
  dialogs.resetAll()
  upload.reset()
  // 连线箭头时序缓存按连线 id 记忆几何，切换画布后 id 复用但几何全新 → 清空避免沿用旧时长
  edgeFlowCache.clear()
  await gen.switchTarget(newTarget)
  if (disposed || !guard.isCurrentSwitch(seq)) return
  const st = await store.switchTarget(newTarget, opts)
  if (disposed || !guard.isCurrentSwitch(seq)) return
  // 节点加载完成后再按 scope 恢复运行中的 ffmpeg 任务（需 nodeMap 过滤已删除节点）
  void gen.restore(new Set(Object.keys(nodeMap.value)))
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
  // 恢复本画布的 LLM 活跃会话（服务端会话列表按 scope 过滤；Loading 跨页面存活）。
  // **只受「本切换是否仍是最新」约束**：视口适应世代号（scheduleFitCanvas）与其无关，
  // 不得参与本判断（否则切回画布时 AI 文本节点 Loading 恢复会被静默跳过）
  if (!disposed && guard.isCurrentSwitch(seq)) restoreLlmSessions()
}

/** 切换分镜/场景时：重置各组合式状态，并让 store/生成组合式切换到新目标加载 */
watch(target, (newTarget) => {
  // 蓝图模式不随分镜/场景切换（目标由宿主固定）：不执行切换
  if (isBlueprint.value) return
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
  window.addEventListener('keydown', canvasGroups.onKeyDown)
  window.addEventListener('keyup', canvasGroups.onKeyUp)
  window.addEventListener('blur', canvasGroups.onWindowBlur)
  window.addEventListener('paste', paste.onPaste)
  window.addEventListener('resize', updateHeight)
  void store.load().then(() => {
    // 首次加载后把视口对准全部节点（fitViewOnInit 只在 Vue Flow 首次初始化时跑一次，这里统一走显式适应）
    scheduleFitCanvas()
    void refreshNodeOutputs()
    // 恢复运行中的 ffmpeg 任务（服务端统一任务注册表按 scope 过滤；刷新后 loading 保持到终态）
    if (!disposed) void gen.restore(new Set(Object.keys(nodeMap.value)))
    // 恢复 LLM 活跃会话（服务端会话列表按 scope 过滤；刷新后 Loading 保持、终态 adopt）
    if (!disposed) restoreLlmSessions()
  })
})

onUnmounted(() => {
  disposed = true
  pendingFitView = false
  window.removeEventListener('keydown', keyboard.onKeydown)
  window.removeEventListener('keydown', canvasGroups.onKeyDown)
  window.removeEventListener('keyup', canvasGroups.onKeyUp)
  window.removeEventListener('blur', canvasGroups.onWindowBlur)
  window.removeEventListener('paste', paste.onPaste)
  window.removeEventListener('resize', updateHeight)
  flowResizeObserver?.disconnect()
  flowResizeObserver = null
  // 取消进行中的成组连接拖拽（window 监听器清理）
  group.reset()
  // 取消进行中的分组拖动并清理分组菜单/重命名状态（window 监听器清理）
  canvasGroups.reset()
  // 中止进行中的加载节点上传并清除进度状态
  upload.reset()
  // 取消 LLM 恢复订阅（任务继续在服务端执行；重进画布由会话列表恢复接管）
  resetLlmRestore()
  resetAdoptedLlmRevs()
  // 停止轮询/清理生成状态并退订任务广播（服务端任务继续执行；重进画布由注册表按 scope 恢复）
  gen.dispose()
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
        void fitCanvasToNodes(fitViewPendingSeq)
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

/* 蓝图信息条（仅蓝图模式）：名称/作用域 + 资产项目选择器 */
.asset-canvas__blueprint-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(var(--v-theme-primary), 0.04);
}

.asset-canvas__blueprint-project {
  max-width: 220px;
  flex: 0 0 auto;
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

/* ── 持久分组框（type: canvas-group）关键样式 ──────────────────────────────
   1) 分组节点 wrapper 必须 pointer-events: none（且需 !important：Vue Flow 会为带
      节点点击监听的节点内联 style="pointer-events: all"，普通样式规则压不过内联样式）：
      框选要求指针按下时 event.target 恰为 .vue-flow__pane，而 .vue-flow__node 默认
      pointer-events: all 会拦截框内空白处的指针 → 组内 Ctrl+拖拽完全失效；
   2) 仅标题条 / 四边拖动条 / 缩放控制点恢复 auto（拖动抓取与缩放；子元素显式声明优先于继承值）；
   3) Ctrl 按下时挂 canvas-group-node--passthrough 类，整体穿透 → 「Ctrl+拖拽 = 框选」零例外。 */
:deep(.vue-flow__node-canvas-group) {
  pointer-events: none !important;
}

:deep(.canvas-group__title),
:deep(.canvas-group__edge) {
  pointer-events: auto;
}

/* NodeResizer 控制点位于 pointer-events: none 的容器内，需显式恢复可拖；
   z-index 高于标题条，保证顶部控制点不被标题条遮挡 */
:deep(.vue-flow__resize-control) {
  pointer-events: auto;
  z-index: 3;
}

:deep(.canvas-group-node--passthrough),
:deep(.canvas-group-node--passthrough *) {
  pointer-events: none !important;
}

/* 分组预设色板（标题条色点 / 右键菜单「更改颜色」触发；坐标相对画布容器） */
.canvas-group-color-menu {
  position: absolute;
  z-index: 26;
  display: grid;
  grid-template-columns: repeat(4, 20px);
  gap: 6px;
  padding: 8px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
}

.canvas-group-color-menu__swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  cursor: pointer;
}

.canvas-group-color-menu__swatch:hover {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
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

/* 运行态高亮（节点 Loading 时）：指向运行中节点的输入连线主色蓝显示（加粗复用
   .canvas-edge--related 描边规则），箭头动画与单选联动高亮共用（同经 --edge-related-color 取色）。
   class 由 useCanvasFlow 按优先级挂载（running > 单选输入侧 > 输出侧），互斥不叠加。 */
:deep(.vue-flow__edge.canvas-edge--running) {
  --edge-related-color: #1976d2;
}

:deep(.vue-flow__edge.canvas-edge--related .vue-flow__edge-path) {
  stroke: var(--edge-related-color);
  stroke-width: 2;
}

/* 连线拖拽预览线高亮（#connection-line 插槽渲染的 path）：画布主题色 + 加粗 2px + 同色光晕，
   与默认预览线（1px 灰 `--vf-connection-path`）明显区分。
   **刻意不按输入/输出端点分色**：预览线只表达「正在连线」——起点端口类型由鼠标下的端点与
   Vue Flow 的端点指示器表达；按方向分色时「按起点」与「按落点」互为镜像（一条连线两端必为
   一输入一输出），两种规则都说得通却都不直观，统一主题色消除该歧义。
   与运行态蓝高亮（--edge-related-color: #1976d2）同色不冲突：预览线仅在拖拽中存在、
   始终连着鼠标，形态与「节点 Loading 时指向它的实线 + 流向箭头」判然有别。
   注：插槽内容渲染在 AssetCanvas 自身模板内，scoped 属性直接命中，无需 :deep / :global；
   仅预览线本身被高亮，不联动既有连线、邻接节点或端点描边。 */
.canvas-connection-preview {
  stroke: #1976d2;
  stroke-width: 2;
  filter: drop-shadow(0 0 3px rgba(25, 118, 210, 0.7));
}

/* 被点击选中的连线（class 由 useCanvasFlow 挂到 edge wrapper）：与连线预览线**同一视觉处理**
   （主题色 #1976D2 + 2px 加粗 + 同色光晕），让「单击选中的线」与「正在拖拽的线」看起来
   是同一件事——这条线正处于用户的操作焦点。**不叠加流向箭头动画**：箭头语义是「数据正在
   流经」，属于运行态/单选联动高亮；单击选中若加箭头会被误读为正在生成。
   与单选联动高亮的关系：连线点击不改变节点选中，二者可同屏（选中的那条为蓝、其关联连线
   仍按方向绿/橙）；优先级见 useCanvasFlow（运行态 > 改接 > 单击选中 > 单选联动）。 */
:deep(.vue-flow__edge.canvas-edge--selected .vue-flow__edge-path) {
  stroke: #1976d2;
  stroke-width: 2;
  filter: drop-shadow(0 0 3px rgba(25, 118, 210, 0.7));
}

:deep(.vue-flow__edge .canvas-edge__arrow) {
  fill: var(--edge-related-color, #b1b1b7);
  pointer-events: none;
  offset-rotate: auto;
  /* 箭头沿连线移动（数据流方向，源→目标）：offset-path 由模板按连线几何注入；
     时长与延迟由 edgeArrows 按弧长推导并写入内联 animation-duration/-delay（恒定线速度
     + 等距多箭头），此处 1.4s 仅作默认兜底（内联长属性优先级更高）。 */
  animation: canvas-edge-arrow-flow 1.4s linear infinite;
}

/* 端点淡入淡出：箭头在连线两端渐显/渐隐，消除循环回绕（100% → 0%）的瞬间跳变。
   淡变区占弧长 4%，而箭头数量 ≤6 → 任意时刻最多 1 个箭头处于淡变中，不会出现
   "半透明长尾"（长连线淡变距离虽更长，但同期可见箭头数量同比例增多）。 */
@keyframes canvas-edge-arrow-flow {
  0% {
    offset-distance: 0%;
    opacity: 0;
  }
  4% {
    opacity: 1;
  }
  96% {
    opacity: 1;
  }
  100% {
    offset-distance: 100%;
    opacity: 0;
  }
}

/* 无障碍：系统开启「减少动态效果」时不做位移动画，箭头静止在连线中点保留方向语义 */
@media (prefers-reduced-motion: reduce) {
  :deep(.vue-flow__edge .canvas-edge__arrow) {
    animation: none;
    offset-distance: 50%;
    opacity: 1;
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

/* 连线改接（连接转移/连接复制）拖拽中：
   1) 被拔出的连线虚线半透明（class 由 useCanvasFlow 挂到 edge wrapper，仅转移模式进入该集合）； */
:deep(.vue-flow__edge.canvas-edge--rewiring .vue-flow__edge-path) {
  stroke-dasharray: 6 4;
  opacity: 0.45;
}

/* 2) 端点整体弱高亮 + 可抓取光标（拖拽期间容器挂 --rewiring class）； */
.asset-canvas__flow--rewiring :deep(.vue-flow__handle) {
  cursor: crosshair;
  box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.25);
}

/* 3) 悬停端点强高亮：可落（绿）/ 不可落（红），class 由 useCanvasRewire 命令式标记； */
.asset-canvas__flow--rewiring :deep(.vue-flow__handle.canvas-rewire-target--valid) {
  box-shadow: 0 0 0 5px rgba(46, 125, 50, 0.55);
}

.asset-canvas__flow--rewiring :deep(.vue-flow__handle.canvas-rewire-target--invalid) {
  box-shadow: 0 0 0 5px rgba(198, 40, 40, 0.45);
}

/* 4) 预览曲线（各固定端锚点 → 鼠标）：覆盖在画布之上、不拦截指针；
      转移为实线主色蓝，复制为虚线主色蓝。 */
.asset-canvas__rewire-line {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 30;
}

.asset-canvas__rewire-curve {
  fill: none;
  stroke: rgb(25, 118, 210);
  stroke-width: 2;
}

.asset-canvas__rewire-curve--copy {
  stroke-dasharray: 6 4;
}

/* 5) 随鼠标徽标（模式与条数提示，不拦截指针）。 */
.asset-canvas__rewire-badge {
  position: absolute;
  z-index: 31;
  padding: 4px 10px;
  font-size: 12px;
  color: #fff;
  background: rgba(25, 118, 210, 0.92);
  border-radius: 12px;
  pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
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