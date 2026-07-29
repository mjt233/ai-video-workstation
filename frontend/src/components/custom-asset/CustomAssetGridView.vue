<template>
  <div class="custom-grid flex-grow-1">
    <div
      v-for="entry in entries"
      :key="entry.name"
      class="custom-grid-item"
      :class="{ 'is-dir': entry.type === 'dir' }"
      @click="emit('open', entry)"
    >
      <div class="custom-grid-thumb">
        <img
          v-if="entry.type === 'file' && isImageFile(entry.name)"
          :src="resolveFileUrl(entry.name)"
          :alt="entry.name"
          loading="lazy"
          class="custom-grid-image"
        >
        <div
          v-else
          class="custom-grid-icon-wrap"
        >
          <v-icon
            :icon="entry.type === 'dir' ? 'mdi-folder' : fileIcon(entry.name)"
            :color="entry.type === 'dir' ? 'amber-darken-1' : fileIconColor(entry.name)"
            size="40"
          />
        </div>
        <div
          v-if="entry.type === 'file' && isVideoFile(entry.name)"
          class="custom-grid-badge"
        >
          <v-icon
            icon="mdi-play-circle"
            size="18"
            color="white"
          />
        </div>
        <div
          v-else-if="entry.type === 'file' && isAudioFile(entry.name)"
          class="custom-grid-badge"
        >
          <v-icon
            icon="mdi-music"
            size="16"
            color="white"
          />
        </div>
      </div>
      <div
        class="custom-grid-name text-caption"
        :title="entry.name"
      >
        {{ entry.name }}
      </div>
      <div class="custom-grid-actions">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DirEntry } from '../../api/client'
import {
  fileIcon,
  fileIconColor,
  fileUrl,
  isAudioFile,
  isImageFile,
  isPreviewable,
  isVideoFile,
} from '../../utils/customAssetFile'

/**
 * 自定义资产网格视图，适合大量图片浏览。
 */
const props = defineProps<{
  /** 当前项目名称 */
  project: string
  /** 当前目录（相对 assert/custom，根为空串） */
  currentDir: string
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

/**
 * 解析文件访问 URL。
 * @param filename 文件名
 */
function resolveFileUrl(filename: string): string {
  return fileUrl(props.project, props.currentDir, filename)
}
</script>

<style scoped>
.custom-grid {
  overflow-y: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  align-content: start;
}

.custom-grid-item {
  position: relative;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  overflow: hidden;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}

.custom-grid-item:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.custom-grid-item:hover .custom-grid-actions {
  opacity: 1;
}

.custom-grid-thumb {
  position: relative;
  height: 110px;
  background: rgba(0, 0, 0, 0.03);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.custom-grid-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.custom-grid-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.custom-grid-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}

.custom-grid-name {
  padding: 6px 8px 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}

.custom-grid-actions {
  display: flex;
  justify-content: center;
  gap: 0;
  padding: 0 4px 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
</style>
