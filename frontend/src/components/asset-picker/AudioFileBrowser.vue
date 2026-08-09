<template>
  <div>
    <!-- 路径标签 + 返回上级 -->
    <div class="d-flex align-center ga-2 mb-1">
      <v-btn
        icon="mdi-arrow-up"
        size="small"
        variant="text"
        :disabled="!cwd"
        title="返回上级目录"
        @click="goUp"
      />
      <span class="text-body-small text-truncate">
        {{ cwdLabel }}
      </span>
    </div>
    <div
      v-if="tabLoading"
      class="d-flex align-center justify-center py-8"
    >
      <v-progress-circular
        indeterminate
        size="28"
      />
    </div>
    <div
      v-else-if="dirs.length || files.length"
      class="d-flex flex-column ga-1"
    >
      <div
        v-for="dir in dirs"
        :key="dir"
        class="audio-item d-flex align-center ga-2 px-2 py-1 rounded"
        @click="enterDir(dir)"
      >
        <v-icon
          color="primary"
          size="20"
        >
          mdi-folder
        </v-icon>
        <span class="text-body-small">{{ dir }}/</span>
      </div>
      <div
        v-for="file in files"
        :key="file.path"
        class="audio-item d-flex align-center ga-2 px-2 py-1 rounded"
        :class="{ 'asset-card--selected': isSelected(file.path) }"
        @click="$emit('select', file)"
      >
        <v-icon
          color="secondary"
          size="20"
        >
          {{ fileIcon }}
        </v-icon>
        <span
          class="text-body-small text-truncate"
          :title="file.label"
        >
          {{ file.label }}
        </span>
        <v-spacer />
        <v-icon
          v-if="isSelected(file.path)"
          color="primary"
          size="18"
        >
          mdi-check-circle
        </v-icon>
      </div>
    </div>
    <div
      v-else
      class="text-grey text-body-medium text-center py-8"
    >
      {{ emptyText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { readFs, type DirEntry, type DirResponse } from '../../api/client'
import { isAudioFile, isVideoFile } from './utils'
import type { AssetItem } from './types'

/**
 * 媒体文件浏览器子页签（音频/视频通用）。
 *
 * 以给定根目录（相对项目路径）为起点，支持进入子目录与返回上级目录，
 * 仅展示子目录与受支持的媒体文件（media='audio' 过滤音频、media='video' 过滤视频）。
 * 组件常驻挂载以保留浏览目录状态。
 */
const props = withDefaults(defineProps<{
  /** 项目名 */
  project: string
  /** 根目录（相对项目路径），如 assert/custom 或 assert/custom/scene/{ep}/{shot} */
  root: string
  /** 来源名称（用于路径标签显示），如「分镜自定义」「全局自定义」 */
  label: string
  /** 需要排除的资产路径（不展示） */
  exclude: string[]
  /** 当前已选中的资产路径列表（用于高亮） */
  selectedPaths: string[]
  /** 该子页签是否激活（激活时加载数据） */
  active: boolean
  /** 弹窗打开时递增的重新加载信号 */
  reloadKey: number
  /** 媒体类型：audio 过滤音频 / video 过滤视频（默认 audio） */
  media?: 'audio' | 'video'
}>(), {
  media: 'audio',
})

defineEmits<{
  /** 点击媒体文件，携带该条目 */
  select: [item: AssetItem]
}>()

/** 是否为视频模式 */
const isVideoMode = computed(() => props.media === 'video')

/** 文件行图标（视频/音频） */
const fileIcon = computed(() => (isVideoMode.value ? 'mdi-video-outline' : 'mdi-music-note'))

/** 空目录提示文案 */
const emptyText = computed(() => (isVideoMode.value ? '该目录暂无视频文件' : '该目录暂无音频文件'))

/** 加载中标记 */
const tabLoading = ref(false)
/** 当前目录（相对根目录的路径，空表示根目录） */
const cwd = ref('')
/** 当前目录的子目录名列表 */
const dirs = ref<string[]>([])
/** 当前目录的音频文件条目 */
const files = ref<AssetItem[]>([])

/** 当前完整相对路径（根目录 + cwd） */
const fullCwd = computed(() => (cwd.value ? `${props.root}/${cwd.value}` : props.root))

/** 顶部路径标签（含来源名） */
const cwdLabel = computed(() => (cwd.value ? `${props.label} / ${cwd.value}` : `${props.label} /`))

/**
 * 判断路径是否已被选中。
 *
 * @param path 音频文件相对路径
 * @returns true 表示已选中
 */
function isSelected(path: string): boolean {
  return props.selectedPaths.includes(path)
}

/**
 * 加载当前目录：子目录 + 音频文件。
 */
async function load() {
  tabLoading.value = true
  try {
    let res: DirResponse
    try {
      res = await readFs(props.project, fullCwd.value) as DirResponse
    } catch {
      // 目录不存在（如分镜无自定义资产目录）→ 静默视为空目录
      dirs.value = []
      files.value = []
      return
    }
    const entries = res.entries ?? []
    dirs.value = entries
      .filter((e: DirEntry) => e.type === 'dir')
      .map((e: DirEntry) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh'))
    files.value = entries
      .filter((e: DirEntry) => e.type === 'file' && (isVideoMode.value ? isVideoFile(e.name) : isAudioFile(e.name)))
      .filter((e: DirEntry) => !props.exclude.includes(`${fullCwd.value}/${e.name}`))
      .map((e: DirEntry) => ({
        path: `${fullCwd.value}/${e.name}`,
        label: e.name,
        thumbnail: '',
        depth: 0,
        ...(isVideoMode.value ? { video: true as const } : { audio: true as const }),
      }))
  } finally {
    tabLoading.value = false
  }
}

/**
 * 进入子目录。
 *
 * @param dir 子目录名
 */
async function enterDir(dir: string): Promise<void> {
  cwd.value = cwd.value ? `${cwd.value}/${dir}` : dir
  await load()
}

/** 返回上级目录 */
async function goUp(): Promise<void> {
  if (!cwd.value) return
  const idx = cwd.value.lastIndexOf('/')
  cwd.value = idx >= 0 ? cwd.value.slice(0, idx) : ''
  await load()
}

/** 子页签激活或 reloadKey 变化时重新加载 */
watch(
  () => [props.active, props.reloadKey] as const,
  () => {
    if (props.active) void load()
  },
  { immediate: true },
)
</script>

<style scoped>
/* 音频条目（文件浏览器行） */
.audio-item {
  cursor: pointer;
  transition: background 0.15s ease;
}

.audio-item:hover {
  background: rgba(var(--v-theme-primary), 0.05);
}

.asset-card--selected {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}
</style>
