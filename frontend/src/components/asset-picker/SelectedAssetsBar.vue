<template>
  <div
    class="pa-3"
    style="min-height: 84px;"
  >
    <div class="text-body-small text-medium-emphasis mb-2">
      已选资产（按序）：
    </div>
    <div
      v-if="items.length"
      class="d-flex flex-wrap align-center ga-1"
    >
      <div
        v-for="(item, idx) in items"
        :key="item.path"
        class="selected-item d-flex align-center ga-1"
        draggable="true"
        @dragstart="onDragStart($event, idx)"
        @dragover.prevent="onDragOver($event, idx)"
        @drop="onDrop($event, idx)"
        @dragend="onDragEnd"
      >
        <v-chip
          closable
          @click:close="$emit('remove', idx)"
        >
          <v-avatar
            left
            size="20"
          >
            <v-img
              v-if="item.thumbnail"
              :src="item.thumbnail"
              cover
            />
            <v-icon
              v-else
              size="16"
              color="secondary"
            >
              mdi-music-note
            </v-icon>
          </v-avatar>
          <span class="text-body-small">{{ item.label }}</span>
        </v-chip>
        <div class="d-flex flex-column ga-0">
          <v-btn
            icon="mdi-chevron-up"
            size="x-small"
            variant="text"
            density="compact"
            :disabled="idx === 0"
            @click="$emit('move', idx, 'up')"
          />
          <v-btn
            icon="mdi-chevron-down"
            size="x-small"
            variant="text"
            density="compact"
            :disabled="idx === items.length - 1"
            @click="$emit('move', idx, 'down')"
          />
        </div>
      </div>
    </div>
    <div
      v-else
      class="text-body-small text-grey"
    >
      暂无选择，点击上方资产添加
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AssetItem } from './types'

/**
 * 已选资产排序栏。
 *
 * 以 chip 形式展示已选资产列表，支持关闭移除、上下移动与拖拽排序，
 * 通过事件将操作上抛给父组件处理（父组件持有真正的选中列表状态）。
 */
const props = defineProps<{
  /** 已选资产条目列表（父组件持有） */
  items: AssetItem[]
}>()

const emit = defineEmits<{
  /** 移除指定下标的条目 */
  remove: [idx: number]
  /** 将指定下标的条目向上/下移动 */
  move: [idx: number, dir: 'up' | 'down']
  /** 拖拽排序：将 from 下标的条目移动到 to 下标 */
  reorder: [from: number, to: number]
}>()

/** 当前正在拖拽的条目下标（null 表示未在拖拽） */
let dragIdx: number | null = null

/**
 * 开始拖拽：记录被拖拽条目下标。
 *
 * @param e 拖拽事件
 * @param idx 被拖拽条目的下标
 */
function onDragStart(e: DragEvent, idx: number) {
  dragIdx = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}

/**
 * 拖拽经过占位处理（无需额外逻辑）。
 *
 * @param _e 拖拽事件（未使用）
 * @param idx 经过条目的下标（用于校验）
 */
function onDragOver(_e: DragEvent, idx: number) {
  if (dragIdx === null || dragIdx === idx) return
}

/**
 * 拖拽放置：将记录的下标移动到目标下标。
 *
 * @param _e 拖拽事件（未使用）
 * @param idx 目标下标
 */
function onDrop(_e: DragEvent, idx: number) {
  if (dragIdx === null || dragIdx === idx) return
  emit('reorder', dragIdx, idx)
  dragIdx = null
}

/** 拖拽结束：清除记录的下标 */
function onDragEnd() {
  dragIdx = null
}
</script>

<style scoped>
.selected-item {
  position: relative;
}
</style>
