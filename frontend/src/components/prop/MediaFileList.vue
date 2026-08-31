<template>
  <div>
    <div
      v-for="file in props.files"
      :key="file.path"
      class="media-file-item d-flex align-center ga-2 pa-2 rounded"
    >
      <v-icon
        :color="props.isAudio ? 'secondary' : 'info'"
        size="20"
      >
        {{ props.isAudio ? 'mdi-music-note' : 'mdi-video' }}
      </v-icon>
      <span
        class="text-body-small text-truncate"
        style="max-width: 180px;"
        :title="file.name"
      >
        {{ file.name }}
      </span>
      <audio
        v-if="props.isAudio"
        :src="fileUrl(file.path)"
        controls
        preload="metadata"
        style="max-width: 240px; height: 32px;"
      />
      <video
        v-else
        :src="fileUrl(file.path)"
        controls
        preload="metadata"
        style="max-width: 240px; height: 60px;"
      />
      <v-spacer />
      <a
        :href="fileUrl(file.path)"
        download
      >
        <v-btn
          icon="mdi-download"
          size="x-small"
          variant="text"
          title="下载"
        />
      </a>
      <v-btn
        icon="mdi-history"
        size="x-small"
        variant="text"
        title="历史版本"
        @click="openHistory(file.path)"
      />
      <v-btn
        icon="mdi-delete"
        size="x-small"
        variant="text"
        color="error"
        title="删除"
        @click="removeFile(file)"
      />
    </div>
    <div
      v-if="!props.files.length"
      class="text-grey text-body-small pa-2"
    >
      暂无{{ props.isAudio ? '音频' : '视频' }}文件
    </div>

    <!-- 历史版本对话框（与道具详情页共用机制：列表/激活/删除由服务端管理） -->
    <AssetHistoryDialog
      v-model="historyDialog.show"
      :project="props.project"
      :asset-path="historyDialog.path"
      @activated="emit('refresh')"
    />
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { deleteFs } from '../../api/client'
import { confirm } from '../../utils/confirm'
import AssetHistoryDialog from '../AssetHistoryDialog.vue'

/**
 * 道具详情页上传媒体文件列表（音频/视频通用）。
 *
 * 每行：类型图标 + 文件名 + 内联播放器 + 下载 / 历史版本 / 删除。
 * 删除需二次确认（confirm，删除类操作约定）；删除与历史激活成功后 emit refresh
 * 通知父级重新加载目录文件列表。
 */
const props = defineProps<{
  /** 项目名 */
  project: string
  /** 文件列表（name 文件名 / path 项目内相对路径） */
  files: Array<{ name: string; path: string }>
  /** 是否为音频列表（true 渲染 <audio>，false 渲染 <video>） */
  isAudio?: boolean
}>()

const emit = defineEmits<{
  /** 文件列表变化（删除/历史激活）后通知父级刷新 */
  refresh: []
}>()

/** 历史版本对话框状态（每次打开记录目标文件路径） */
const historyDialog = reactive({ show: false, path: '' })

/**
 * 生成文件预览/下载直链（带缓存破坏参数，覆盖上传后立即生效）。
 *
 * @param path 资产相对路径
 * @returns /api/fs/ 直链
 */
function fileUrl(path: string): string {
  return `/api/fs/${props.project}/${path}?t=${Date.now()}`
}

/**
 * 打开历史版本对话框。
 *
 * @param path 资产相对路径
 */
function openHistory(path: string): void {
  historyDialog.path = path
  historyDialog.show = true
}

/**
 * 删除上传的媒体文件（二次确认后调用服务端删除）。
 *
 * @param file 待删除文件
 */
async function removeFile(file: { name: string; path: string }): Promise<void> {
  const ok = await confirm({
    title: '确认删除',
    content: `确定删除「${file.name}」？此操作不可撤销。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  try {
    await deleteFs(props.project, file.path)
    emit('refresh')
  } catch (e) {
    console.error('[prop-media] 删除文件失败', e)
  }
}
</script>

<style scoped>
.media-file-item {
  transition: background 0.15s ease;
}

.media-file-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
</style>
