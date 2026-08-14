<template>
  <textarea
    class="text-node nodrag nowheel"
    :value="text"
    placeholder="输入文本…"
    spellcheck="false"
    @input="onInput"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'

const props = defineProps<{
  node: CanvasNodeData
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
}>()

const text = computed(() => (typeof props.node.config.text === 'string' ? props.node.config.text : ''))

function onInput(e: Event) {
  emit('update:config', { text: (e.target as HTMLTextAreaElement).value })
}
</script>

<style scoped>
/* nodrag/nowheel 为 Vue Flow 约定类名：
   - nodrag：在文本框内拖拽选择文本时不触发节点移动；
   - nowheel：在文本框上滚动滚轮时滚动文本内容，而不是缩放画布。 */
.text-node {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 8px;
  font-size: 13px;
  line-height: 1.5;
  background: transparent;
  font-family: inherit;
  overflow-y: auto;
  box-sizing: border-box;
}

/* 细滚动条：提示内容溢出可滚动（滚动由 nowheel 类接管，不被画布缩放截获） */
.text-node::-webkit-scrollbar {
  width: 8px;
}

.text-node::-webkit-scrollbar-track {
  background: transparent;
}

.text-node::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.text-node::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.35);
}
</style>
