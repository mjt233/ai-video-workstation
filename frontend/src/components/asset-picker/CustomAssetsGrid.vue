<template>
  <div class="custom-assets-grid">
    <!-- 导航：返回上级 + 面包屑（根目录 assert/custom 可点击回根） -->
    <div class="d-flex align-center ga-1 mb-1">
      <v-btn
        icon="mdi-arrow-up"
        size="small"
        variant="text"
        :disabled="!cwd"
        title="返回上级目录"
        @click="goUp"
      />
      <div class="d-flex align-center text-body-small text-truncate">
        <span
          class="crumb"
          :class="{ 'crumb--disabled': !cwd }"
          title="返回自定义资产根目录"
          @click="goRoot"
        >
          assert/custom
        </span>
        <template
          v-for="(seg, i) in cwdSegments"
          :key="`${seg}-${i}`"
        >
          <v-icon
            size="14"
            class="mx-1"
            color="grey"
          >
            mdi-chevron-right
          </v-icon>
          <span
            class="crumb"
            :class="{ 'crumb--disabled': i === cwdSegments.length - 1 }"
            :title="`assert/custom/${cwdSegments.slice(0, i + 1).join('/')}`"
            @click="jumpToSegment(i)"
          >
            {{ seg }}
          </span>
        </template>
      </div>
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
    <template v-else>
      <!-- 子目录：点击进入 -->
      <div
        v-if="dirs.length"
        class="d-flex flex-column ga-1 mb-1"
      >
        <div
          v-for="dir in dirs"
          :key="dir"
          class="custom-row d-flex align-center ga-2 px-2 py-1 rounded"
          @click="enterDir(dir)"
        >
          <v-icon
            color="primary"
            size="20"
          >
            mdi-folder
          </v-icon>
          <span class="text-body-small text-truncate">{{ dir }}/</span>
        </div>
      </div>

      <!-- 图片模式：缩略图卡片网格 -->
      <v-row
        v-if="isImageMode && files.length"
        density="compact"
      >
        <v-col
          v-for="item in files"
          :key="item.path"
          cols="4"
          sm="3"
          md="2"
        >
          <v-card
            variant="outlined"
            :class="{ 'asset-card--selected': isSelected(item.path) }"
            class="asset-card"
            ripple
            @click="$emit('select', item)"
          >
            <div class="asset-thumb-wrap">
              <AssetThumb :src="item.thumbnail" />
              <v-icon
                v-if="isSelected(item.path)"
                class="asset-check-icon"
                color="primary"
                size="28"
              >
                mdi-check-circle
              </v-icon>
            </div>
            <div
              class="pa-1 text-body-small text-truncate text-center"
              :title="item.path"
            >
              {{ item.label }}
            </div>
          </v-card>
        </v-col>
      </v-row>

      <!-- 行模式（音频/视频等非图片媒体）：图标行列表 -->
      <div
        v-else-if="files.length"
        class="d-flex flex-column ga-1"
      >
        <div
          v-for="item in files"
          :key="item.path"
          class="custom-row d-flex align-center ga-2 px-2 py-1 rounded"
          :class="{ 'asset-card--selected': isSelected(item.path) }"
          @click="$emit('select', item)"
        >
          <v-icon
            color="secondary"
            size="20"
          >
            {{ rowIconOf(item.label) }}
          </v-icon>
          <span
            class="text-body-small text-truncate"
            :title="item.path"
          >
            {{ item.label }}
          </span>
          <v-spacer />
          <v-icon
            v-if="isSelected(item.path)"
            color="primary"
            size="18"
          >
            mdi-check-circle
          </v-icon>
        </div>
      </div>

      <!-- 空状态（无子目录且无文件时） -->
      <div
        v-if="!dirs.length && !files.length"
        class="text-grey text-body-medium text-center py-8"
      >
        {{ emptyText }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { readFs, type DirEntry, type DirResponse } from '../../api/client'
import {
  AUDIO_EXTS,
  IMAGE_EXTS,
  VIDEO_EXTS,
  hasAcceptExt,
  isAudioFile,
  isImageFile,
  isVideoFile,
  thumbUrl,
} from './utils'
import AssetThumb from './AssetThumb.vue'
import type { AssetItem } from './types'

/**
 * 自定义资产页签：目录浏览器。
 *
 * 以 assert/custom/ 为根：可逐层进入子目录、经顶部面包屑/返回上级跳回任意层级。
 * 目录内仅展示扩展名命中 acceptExts（忽略大小写）的文件：全部为图片时展示缩略图
 * 网格，其余（音频/视频等）以图标行展示。点击资产条目 emit select 交由父组件处理选中；
 * 弹窗打开时若已选路径位于 assert/custom/ 内，自动定位到其所在目录并高亮。
 */
const props = withDefaults(defineProps<{
  /** 项目名 */
  project: string
  /** 需要排除的资产路径（不展示） */
  exclude: string[]
  /** 当前已选中的资产路径列表（用于高亮与初始目录定位） */
  selectedPaths: string[]
  /** 弹窗是否打开（仅在打开时加载） */
  active: boolean
  /** 弹窗打开时递增的重新加载信号 */
  reloadKey: number
  /** 可选择的文件扩展名列表（不含点、忽略大小写；默认仅图片扩展名） */
  acceptExts?: string[]
}>(), {
  acceptExts: () => [...IMAGE_EXTS],
})

const emit = defineEmits<{
  /** 点击媒体文件，携带该条目 */
  select: [item: AssetItem]
}>()

/** 自定义资产根目录（相对项目路径） */
const CUSTOM_ROOT = 'assert/custom'

/** 加载中标记 */
const tabLoading = ref(false)
/** 当前目录（相对自定义资产根目录的路径，空表示根目录） */
const cwd = ref('')
/** 当前目录的子目录名列表 */
const dirs = ref<string[]>([])
/** 当前目录的媒体文件条目 */
const files = ref<AssetItem[]>([])

/** 面包屑分段（cwd 按 / 拆分；空数组表示位于根目录） */
const cwdSegments = computed(() => (cwd.value ? cwd.value.split('/') : []))

/** 当前目录的完整相对路径（自定义资产根 + cwd） */
const fullCwd = computed(() => (cwd.value ? `${CUSTOM_ROOT}/${cwd.value}` : CUSTOM_ROOT))

/** 是否全部为图片扩展名（true 用缩略图网格；false 用图标行） */
const isImageMode = computed(() => {
  const imageExts = IMAGE_EXTS as readonly string[]
  return props.acceptExts.length > 0 && props.acceptExts.every((ext) => imageExts.includes(ext.toLowerCase()))
})

/** 空目录提示文案（按扩展名集合描述媒体类型） */
const emptyText = computed(() => {
  if (props.acceptExts.length === 0) return '该目录暂无可用文件'
  const lower = props.acceptExts.map((ext) => ext.toLowerCase())
  const allOf = (exts: readonly string[]) => lower.every((ext) => exts.includes(ext))
  if (allOf(IMAGE_EXTS)) return '该目录暂无可用图片'
  if (allOf(AUDIO_EXTS)) return '该目录暂无可用音频'
  if (allOf(VIDEO_EXTS)) return '该目录暂无可用视频'
  return '该目录暂无匹配的文件'
})

/**
 * 判断路径是否已被选中。
 *
 * @param path 资产相对路径
 * @returns true 表示已选中
 */
function isSelected(path: string): boolean {
  return props.selectedPaths.includes(path)
}

/** 行模式图标：按文件扩展名区分音频/视频/其他 */
function rowIconOf(name: string): string {
  if (isAudioFile(name)) return 'mdi-music-note'
  if (isVideoFile(name)) return 'mdi-video-outline'
  return 'mdi-file-outline'
}

/** 由目录下的文件名构建可点击的资产条目 */
function toFileItem(name: string, dirFull: string): AssetItem {
  const path = `${dirFull}/${name}`
  return {
    path,
    label: name,
    thumbnail: isImageFile(name) ? thumbUrl(props.project, path) : '',
    depth: 0,
    ...(isAudioFile(name) ? { audio: true as const } : {}),
    ...(isVideoFile(name) ? { video: true as const } : {}),
  }
}

/**
 * 加载当前目录：子目录 + 命中 acceptExts 的媒体文件。
 */
async function load(): Promise<void> {
  tabLoading.value = true
  try {
    const full = fullCwd.value
    let res: DirResponse
    try {
      res = await readFs(props.project, full) as DirResponse
    } catch {
      // 目录不存在（如尚未创建的自定义目录）→ 静默视为空目录
      dirs.value = []
      files.value = []
      return
    }
    const entries = res?.entries ?? []
    dirs.value = entries
      .filter((e: DirEntry) => e.type === 'dir')
      .map((e: DirEntry) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh'))
    files.value = entries
      .filter((e: DirEntry) => e.type === 'file' && hasAcceptExt(e.name, props.acceptExts))
      .filter((e: DirEntry) => !props.exclude.includes(`${full}/${e.name}`))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }))
      .map((e: DirEntry) => toFileItem(e.name, full))
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

/** 返回上级目录（根目录时无操作） */
async function goUp(): Promise<void> {
  if (!cwd.value) return
  const idx = cwd.value.lastIndexOf('/')
  cwd.value = idx >= 0 ? cwd.value.slice(0, idx) : ''
  await load()
}

/** 返回自定义资产根目录 */
async function goRoot(): Promise<void> {
  if (!cwd.value) return
  cwd.value = ''
  await load()
}

/**
 * 点击面包屑第 i 段：跳转到该级目录。
 *
 * @param i 分段下标（0 起）
 */
async function jumpToSegment(i: number): Promise<void> {
  const segs = cwdSegments.value
  if (i < 0 || i >= segs.length) return
  cwd.value = segs.slice(0, i + 1).join('/')
  await load()
}

/**
 * 从已选路径推导初始目录：取第一个 assert/custom/ 内资产所在目录（根目录时为 ''）。
 */
function initialCwdFromSelection(): string {
  for (const p of props.selectedPaths) {
    if (p.startsWith(`${CUSTOM_ROOT}/`)) {
      const rel = p.slice(CUSTOM_ROOT.length + 1)
      const idx = rel.lastIndexOf('/')
      return idx >= 0 ? rel.slice(0, idx) : ''
    }
  }
  return ''
}

/** 弹窗打开或 reloadKey 变化时：定位初始目录后加载 */
watch(
  () => [props.active, props.reloadKey] as const,
  () => {
    if (props.active) {
      cwd.value = initialCwdFromSelection()
      void load()
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.crumb {
  cursor: pointer;
  white-space: nowrap;
}

.crumb:hover {
  text-decoration: underline;
}

/* 当前所在层级（不可再点击跳转） */
.crumb--disabled {
  cursor: default;
  color: rgb(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  pointer-events: none;
}

.asset-card {
  cursor: pointer;
  transition: box-shadow 0.15s ease;
  position: relative;
}

.asset-card:hover {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-primary));
}

.asset-card--selected {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}

.asset-thumb-wrap {
  position: relative;
}

.asset-check-icon {
  position: absolute;
  top: 4px;
  right: 4px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}

/* 目录行 / 非图片媒体行 */
.custom-row {
  cursor: pointer;
  transition: background 0.15s ease;
}

.custom-row:hover {
  background: rgba(var(--v-theme-primary), 0.05);
}
</style>
