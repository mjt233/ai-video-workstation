<template>
  <div class="asset-canvas">
    <div class="asset-canvas__toolbar">
      <v-btn size="small" variant="text" icon="mdi-fit-to-screen-outline" title="适应视图" @click="fitView" />
      <v-btn size="small" variant="text" icon="mdi-plus" title="放大" @click="zoomIn" />
      <v-btn size="small" variant="text" icon="mdi-minus" title="缩小" @click="zoomOut" />
      <v-spacer />
      <v-progress-circular v-if="saving" size="18" indeterminate color="primary" />
      <span v-else-if="dirty" class="text-caption text-medium-emphasis">未保存</span>
      <span v-else class="text-caption text-disabled">已保存</span>
    </div>

    <div class="asset-canvas__flow">
      <VueFlow
        v-model:nodes="flowNodes"
        v-model:edges="flowEdges"
        :fit-view-on-init="true"
        :min-zoom="0.2"
        :max-zoom="3"
        :nodes-draggable="true"
        @node-click="onNodeClick"
        @pane-click="onPaneClick"
      >
        <Background :gap="16" />
        <template #node-default="{ data }">
          <div class="canvas-node">
            <div class="canvas-node__header">
              <span class="text-caption font-weight-medium">{{ data.label }}</span>
            </div>
            <div class="canvas-node__body">
              <span class="text-caption text-medium-emphasis">{{ data.typeLabel }}</span>
            </div>
          </div>
        </template>
      </VueFlow>
    </div>

    <div v-if="!loaded" class="asset-canvas__overlay">加载中…</div>
    <div v-else-if="nodes.length === 0" class="asset-canvas__overlay asset-canvas__empty">
      <div class="text-body-2">画布为空</div>
      <div class="text-caption text-medium-emphasis">双击空白处添加节点</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { VueFlow, useVueFlow, type Node as FlowNode, type Edge as FlowEdge } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { useCanvasStore } from '../../canvas/useCanvasStore'
import { getPrototype } from '../../canvas/registry'
import type { CanvasNodeData } from '../../canvas/types'

/** 组件 props：定位一张画布 */
const props = defineProps<{
  project: string
  kind: 'stage' | 'scene'
  stage?: string
  episode?: string
  shot?: string
}>()

const target = computed(() => ({
  kind: props.kind,
  stage: props.stage,
  episode: props.episode,
  shot: props.shot,
}))

const store = useCanvasStore(props.project, target.value)
const { loaded, nodes, connections, dirty, saving, addNode, removeNode, connect, disconnect } = store

const { fitView, zoomIn, zoomOut } = useVueFlow()

/** 节点 id → 类型标签 */
const typeLabelOf = (node: CanvasNodeData): string => getPrototype(node.prototypeId)?.name ?? node.prototypeId

const flowNodes = computed<FlowNode[]>(() =>
  nodes.value.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.name, typeLabel: typeLabelOf(n) },
    style: { width: `${n.width}px`, height: `${n.height}px` },
  })),
)

const flowEdges = computed<FlowEdge[]>(() =>
  connections.value.map((c) => ({
    id: c.id,
    source: c.fromNodeId,
    sourceHandle: c.fromPortId,
    target: c.toNodeId,
    targetHandle: c.toPortId,
    type: 'default',
  })),
)

/** 节点被拖动后回写坐标（Phase 3 完整接入，此处保证位置持久化） */
watch(
  flowNodes,
  (list) => {
    for (const n of list) {
      const node = nodes.value.find((x) => x.id === n.id)
      if (node && (node.x !== n.position.x || node.y !== n.position.y)) {
        node.x = Math.round(n.position.x)
        node.y = Math.round(n.position.y)
      }
    }
  },
  { deep: true },
)

function onNodeClick({ node }: { node: FlowNode }) {
  void node
}

function onPaneClick() {
  // Phase 3：空白点击关闭选中
}

onMounted(() => {
  void store.load()
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
  width: 100%;
  height: 100%;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  background: #fff;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.canvas-node__header {
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.04);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.canvas-node__body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
