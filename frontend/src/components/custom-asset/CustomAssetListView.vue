<template>
  <v-list
    lines="one"
    density="compact"
    class="flex-grow-1"
    style="overflow-y: auto;"
  >
    <v-list-item
      v-for="entry in entries"
      :key="entry.name"
      :value="entry.name"
      class="custom-file-item"
      :class="{ 'is-dir': entry.type === 'dir' }"
      @click="emit('open', entry)"
    >
      <template #prepend>
        <v-icon
          :color="entry.type === 'dir' ? 'amber-darken-1' : fileIconColor(entry.name)"
          size="small"
        >
          {{ entry.type === 'dir' ? 'mdi-folder' : fileIcon(entry.name) }}
        </v-icon>
      </template>
      <template #title>
        <span class="text-body-2">{{ entry.name }}</span>
      </template>
      <template #append>
        <div class="d-flex align-center ga-1">
          <v-btn
            v-if="entry.type === 'file' && isPreviewable(entry.name)"
            icon="mdi-eye-outline"
            size="x-small"
            variant="text"
            title="预览"
            @click.stop="emit('preview', entry.name)"
          />
          <v-btn
            v-if="entry.type === 'file'"
            icon="mdi-download"
            size="x-small"
            variant="text"
            title="下载"
            @click.stop="emit('download', entry.name)"
          />
          <v-btn
            icon="mdi-pencil-outline"
            size="x-small"
            variant="text"
            title="重命名"
            @click.stop="emit('rename', entry)"
          />
          <v-btn
            icon="mdi-delete-outline"
            size="x-small"
            variant="text"
            color="error"
            title="删除"
            @click.stop="emit('delete', entry)"
          />
        </div>
      </template>
    </v-list-item>
  </v-list>
</template>

<script setup lang="ts">
import type { DirEntry } from '../../api/client'
import {
  fileIcon,
  fileIconColor,
  isPreviewable,
} from '../../utils/customAssetFile'

/**
 * 自定义资产列表视图。
 */
defineProps<{
  /** 当前目录条目 */
  entries: DirEntry[]
}>()

const emit = defineEmits<{
  /** 打开条目（目录进入 / 文件打开） */
  open: [entry: DirEntry]
  /** 预览文件 */
  preview: [filename: string]
  /** 下载文件 */
  download: [filename: string]
  /** 重命名条目 */
  rename: [entry: DirEntry]
  /** 删除条目 */
  delete: [entry: DirEntry]
}>()
</script>

<style scoped>
.custom-file-item {
  cursor: pointer;
}

.custom-file-item:hover {
  background-color: rgba(0, 0, 0, 0.04);
}
</style>
