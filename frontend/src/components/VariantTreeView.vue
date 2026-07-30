<template>
  <div
    ref="containerRef"
    class="variant-tree-container"
  >
    <svg
      ref="svgRef"
      class="variant-tree-svg"
      :width="svgWidth"
      :height="svgHeight"
    >
      <path
        v-for="(d, i) in linePaths"
        :key="i"
        :d="d"
        stroke="rgba(var(--v-theme-on-surface), 0.2)"
        stroke-width="1.5"
        fill="none"
      />
    </svg>
    <div class="variant-tree-roots">
      <div
        v-for="root in roots"
        :key="root.id"
        class="variant-tree-root-wrapper"
      >
        <VariantTreeNode
          :node="root"
          :depth="0"
          :image-urls="imageUrls"
          @preview="$emit('preview', $event)"
          @generate="$emit('generate', $event)"
          @history="$emit('history', $event)"
          @edit="$emit('edit', $event)"
          @delete="$emit('delete', $event)"
        >
          <template #upload-btn="{ node }">
            <slot
              name="upload-btn"
              :node="node"
            />
          </template>
        </VariantTreeNode>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import type { VariantTreeNode as TreeNode } from '../composables/useVariantTree'
import VariantTreeNode from './VariantTreeNode.vue'

defineOptions({ name: 'VariantTreeView' })

const props = defineProps<{
  roots: TreeNode[]
  imageUrls: Record<string, string>
}>()

defineEmits<{
  preview: [node: TreeNode]
  generate: [node: TreeNode]
  history: [node: TreeNode]
  edit: [node: TreeNode]
  delete: [node: TreeNode]
}>()

const containerRef = ref<HTMLElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)
const linePaths = ref<string[]>([])
const svgWidth = ref(0)
const svgHeight = ref(0)

function collectAllNodes(): Map<string, { top: number; bottom: number; left: number; width: number }> {
  const cardMap = new Map<string, { top: number; bottom: number; left: number; width: number }>()
  const container = containerRef.value
  if (!container) return cardMap
  const containerRect = container.getBoundingClientRect()
  const cards = container.querySelectorAll('.variant-node-card')
  for (const card of cards) {
    const titleEl = card.querySelector('.text-body-2') as HTMLElement | null
    if (!titleEl) continue
    const id = titleEl.title
    const rect = card.getBoundingClientRect()
    cardMap.set(id, {
      top: rect.top - containerRect.top,
      bottom: rect.bottom - containerRect.top,
      left: rect.left - containerRect.left,
      width: rect.width,
    })
  }
  return cardMap
}

function computeLines() {
  nextTick(() => {
    const container = containerRef.value
    if (!container) return

    const cardRects = collectAllNodes()
    const paths: string[] = []

    function walk(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (node.children?.length) {
          for (const child of node.children) {
            const parentRect = cardRects.get(node.id)
            const childRect = cardRects.get(child.id)
            if (parentRect && childRect) {
              const px = parentRect.left + parentRect.width / 2
              const py = parentRect.bottom
              const cx = childRect.left + childRect.width / 2
              const cy = childRect.top
              const midY = (py + cy) / 2
              paths.push(`M ${px},${py} C ${px},${midY} ${cx},${midY} ${cx},${cy}`)
            }
            walk(node.children)
          }
        }
      }
    }
    walk(props.roots)

    linePaths.value = paths
    svgWidth.value = container.scrollWidth
    svgHeight.value = container.scrollHeight
  })
}

watch(
  () => props.roots,
  computeLines,
  { deep: true },
)

onMounted(() => {
  computeLines()

  const container = containerRef.value
  if (!container) return
  const ro = new ResizeObserver(() => {
    computeLines()
  })
  ro.observe(container)
})
</script>

<style scoped>
.variant-tree-container {
  position: relative;
  width: 100%;
  overflow-x: auto;
}
.variant-tree-svg {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 0;
}
.variant-tree-roots {
  position: relative;
  z-index: 1;
}
.variant-tree-root-wrapper {
  margin-bottom: 24px;
}
</style>
