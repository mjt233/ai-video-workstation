<template>
  <v-card
    variant="tonal"
    color="grey-lighten-4"
    class="cleanup-summary mb-2"
  >
    <div class="d-flex align-center flex-wrap ga-2 py-1 px-2">
      <v-chip
        size="small"
        variant="flat"
        color="primary"
        prepend-icon="mdi-format-list-bulleted"
      >
        共 {{ totalCount }} 项 · {{ formatBytes(totalSize) }}
      </v-chip>
      <v-chip
        size="small"
        variant="flat"
        :color="selectedCount > 0 ? 'success' : 'grey'"
        prepend-icon="mdi-checkbox-marked-outline"
      >
        已选 {{ selectedCount }} 项 · {{ formatBytes(selectedSize) }}
      </v-chip>

      <v-divider
        vertical
        class="mx-1"
      />

      <v-btn
        size="small"
        variant="text"
        prepend-icon="mdi-select-all"
        :disabled="totalCount === 0"
        @click="emit('select-all')"
      >
        全选
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        prepend-icon="mdi-select-off"
        :disabled="selectedCount === 0"
        @click="emit('select-none')"
      >
        全不选
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        prepend-icon="mdi-swap-horizontal"
        :disabled="totalCount === 0"
        @click="emit('invert')"
      >
        反选
      </v-btn>

      <v-spacer />

      <v-btn
        color="error"
        variant="flat"
        size="small"
        prepend-icon="mdi-delete-outline"
        :loading="moving"
        :disabled="selectedCount === 0"
        @click="emit('move')"
      >
        清理选中项
      </v-btn>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { formatBytes } from '../../utils/formatBytes'

/**
 * 清理扫描结果汇总条：总项数 / 总大小、已选项数 / 已选大小、全选与清理操作。
 */
defineProps<{
  /** 扫描结果总条数 */
  totalCount: number
  /** 扫描结果总大小（字节） */
  totalSize: number
  /** 已勾选条数 */
  selectedCount: number
  /** 已勾选总大小（字节） */
  selectedSize: number
  /** 是否正在移入回收站 */
  moving: boolean
}>()

const emit = defineEmits<{
  (e: 'select-all'): void
  (e: 'select-none'): void
  (e: 'invert'): void
  (e: 'move'): void
}>()
</script>

<style scoped>
.cleanup-summary {
  position: sticky;
  top: 0;
  z-index: 2;
}
</style>
