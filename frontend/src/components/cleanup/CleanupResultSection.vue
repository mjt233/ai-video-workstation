<template>
  <v-card
    variant="outlined"
    class="mb-3"
  >
    <div class="d-flex align-center flex-wrap ga-1 pa-2">
      <v-checkbox-btn
        :model-value="allSelected"
        :indeterminate="someSelected && !allSelected"
        density="compact"
        hide-details
        @update:model-value="emit('toggle-group', category, !!$event)"
      />
      <v-icon
        :icon="icon"
        size="small"
        color="primary"
      />
      <span class="font-weight-medium ml-1">{{ label }}</span>
      <v-chip
        size="x-small"
        variant="tonal"
        class="ml-2"
      >
        {{ items.length }} 项
      </v-chip>
      <v-chip
        size="x-small"
        variant="tonal"
        color="grey-darken-1"
        class="ml-1"
      >
        {{ formatBytes(groupSize) }}
      </v-chip>
    </div>
    <v-divider />
    <v-list
      density="compact"
      class="py-0"
    >
      <v-list-item
        v-for="item in items"
        :key="item.id"
        :title="baseName(item.path)"
        class="cleanup-row"
      >
        <template #prepend>
          <v-checkbox-btn
            :model-value="selectedIds.has(item.id)"
            density="compact"
            class="mr-1"
            @update:model-value="emit('toggle', item)"
          />
        </template>

        <v-list-item-subtitle class="d-flex align-center flex-wrap ga-2">
          <span
            class="text-truncate cleanup-path"
            :title="item.path"
          >
            {{ item.path }}
          </span>
          <span class="text-grey">·</span>
          <span>{{ formatBytes(item.size) }}</span>
          <span class="text-grey">·</span>
          <v-tooltip
            :text="formatDateTime(item.time)"
            location="top"
          >
            <template #activator="{ props: tip }">
              <span v-bind="tip">{{ formatRelativeTime(item.time) }}</span>
            </template>
          </v-tooltip>
          <template v-if="item.ownerPath">
            <span class="text-grey">·</span>
            <span
              class="text-truncate cleanup-path"
              :title="`所属资产：${item.ownerPath}`"
            >
              所属：{{ item.ownerPath }}
            </span>
          </template>
        </v-list-item-subtitle>

        <template #append>
          <v-btn
            v-if="item.previewKind !== 'none'"
            icon="mdi-eye-outline"
            size="x-small"
            variant="text"
            title="预览"
            @click.stop="emit('preview', item)"
          />
          <v-btn
            icon="mdi-download"
            size="x-small"
            variant="text"
            title="下载"
            @click.stop="emit('download', item)"
          />
        </template>
      </v-list-item>
    </v-list>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CleanupCategory, CleanupItem } from '../../api/cleanup'
import { formatBytes } from '../../utils/formatBytes'
import { formatDateTime, formatRelativeTime } from '../../utils/relativeTime'

/**
 * 清理扫描结果分组：分组标题（数量 / 大小 / 组内全选）与条目行。
 */
const props = defineProps<{
  /** 分组 key */
  category: CleanupCategory
  /** 分组显示名 */
  label: string
  /** 该分组条目 */
  items: CleanupItem[]
  /** 已勾选条目 id 集合 */
  selectedIds: Set<string>
}>()

const emit = defineEmits<{
  /** 勾选/取消单条 */
  (e: 'toggle', item: CleanupItem): void
  /** 组内全选 / 全不选 */
  (e: 'toggle-group', category: CleanupCategory, checked: boolean): void
  /** 预览 */
  (e: 'preview', item: CleanupItem): void
  /** 下载 */
  (e: 'download', item: CleanupItem): void
}>()

/** 分组图标 */
const icon = computed(() => {
  switch (props.category) {
    case 'custom-orphan': return 'mdi-file-question-outline'
    case 'canvas-history': return 'mdi-image-multiple-outline'
    case 'character-history': return 'mdi-account-outline'
    case 'stage-history': return 'mdi-map-outline'
    default: return 'mdi-package-variant-closed'
  }
})

/** 分组总大小 */
const groupSize = computed(() => props.items.reduce((sum, item) => sum + item.size, 0))

/** 组内是否全部勾选 */
const allSelected = computed(() => props.items.length > 0 && props.items.every((i) => props.selectedIds.has(i.id)))

/** 组内是否存在勾选 */
const someSelected = computed(() => props.items.some((i) => props.selectedIds.has(i.id)))

/**
 * 取路径末段作为行标题。
 *
 * @param relPath 项目内相对路径
 * @returns 文件名
 */
function baseName(relPath: string): string {
  const parts = relPath.split('/')
  return parts[parts.length - 1] ?? relPath
}
</script>

<style scoped>
.cleanup-row {
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.cleanup-path {
  max-width: 520px;
}
</style>
