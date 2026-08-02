<template>
  <textarea
    class="text-node"
    :value="text"
    placeholder="输入文本…"
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
.text-node {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 8px;
  font-size: 13px;
  background: transparent;
  font-family: inherit;
}
</style>
