<template>
  <div>
    <!-- 3 个子页签（分镜视频 / 分镜自定义 / 全局自定义） -->
    <v-tabs
      v-model="videoSection"
      grow
      density="compact"
      class="mb-2"
    >
      <v-tab value="shot">
        分镜视频
      </v-tab>
      <v-tab
        v-if="hasSceneContext"
        value="scene"
      >
        分镜自定义
      </v-tab>
      <v-tab value="global">
        全局自定义
      </v-tab>
    </v-tabs>

    <!-- 分镜视频：集数/分镜选择 + 该分镜 video/ 目录下的视频列表 -->
    <div v-show="videoSection === 'shot'">
      <div class="d-flex align-center ga-2 mb-2">
        <v-select
          v-model="shotEp"
          :items="episodeOptions"
          label="集数"
          density="compact"
          hide-details
          style="width: 130px;"
          @update:model-value="onShotEpChange"
        />
        <v-select
          v-model="shotNo"
          :items="shotOptions"
          label="分镜"
          density="compact"
          hide-details
          style="width: 130px;"
        />
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
        <div
          v-for="video in shotVideos"
          :key="video.path"
          class="video-item d-flex align-center ga-2 px-2 py-1 rounded"
          :class="{ 'asset-card--selected': isSelected(video.path) }"
          @click="$emit('select', video)"
        >
          <v-icon
            color="secondary"
            size="20"
          >
            mdi-video-outline
          </v-icon>
          <span
            class="text-body-small text-truncate"
            :title="video.label"
          >
            {{ video.label }}
          </span>
          <v-spacer />
          <v-icon
            v-if="isSelected(video.path)"
            color="primary"
            size="18"
          >
            mdi-check-circle
          </v-icon>
        </div>
        <div
          v-if="!shotEp || !shotNo"
          class="text-grey text-body-medium text-center py-8"
        >
          请选择集数与分镜
        </div>
        <div
          v-else-if="shotVideos.length === 0"
          class="text-grey text-body-medium text-center py-8"
        >
          该分镜暂无视频
        </div>
      </template>
    </div>

    <!-- 分镜自定义：视频文件浏览器 -->
    <AudioFileBrowser
      v-if="hasSceneContext"
      v-show="videoSection === 'scene'"
      :active="videoSection === 'scene'"
      :reload-key="reloadKey"
      :project="project"
      :root="sceneRoot"
      label="分镜自定义"
      media="video"
      :exclude="exclude"
      :selected-paths="selectedPaths"
      @select="$emit('select', $event)"
    />

    <!-- 全局自定义：视频文件浏览器 -->
    <AudioFileBrowser
      v-show="videoSection === 'global'"
      :active="videoSection === 'global'"
      :reload-key="reloadKey"
      :project="project"
      root="assert/custom"
      label="全局自定义"
      media="video"
      :exclude="exclude"
      :selected-paths="selectedPaths"
      @select="$emit('select', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { existsFs, readFs, type DirEntry, type DirResponse } from '../../api/client'
import AudioFileBrowser from './AudioFileBrowser.vue'
import type { AssetItem } from './types'
import { isVideoFile } from './utils'

/**
 * 分镜视频页签（视频加载节点资产选择器）。
 *
 * 内部包含 3 个子页签：
 * - 分镜视频：集数/分镜下拉，展示所选分镜 video/ 目录下的全部视频（兼容旧版 video.mp4）；
 * - 分镜自定义：视频文件浏览器（根目录 assert/custom/scene/{ep}/{shot}）；
 * - 全局自定义：视频文件浏览器（根目录 assert/custom）。
 * 子区段通过 v-show 常驻挂载以保留各自的浏览目录状态，数据在激活时重新加载。
 */
const props = withDefaults(defineProps<{
  /** 项目名 */
  project: string
  /** 上下文集数（默认选中的集数；可选） */
  contextEpisode?: string
  /** 上下文分镜（默认选中的分镜与分镜自定义根目录；可选） */
  contextShot?: string
  /** 需要排除的资产路径（不展示） */
  exclude: string[]
  /** 当前已选中的资产路径列表（用于高亮） */
  selectedPaths: string[]
  /** 弹窗打开时递增的重新加载信号 */
  reloadKey: number
}>(), {
  contextEpisode: undefined,
  contextShot: undefined,
})

defineEmits<{
  /** 点击资产条目，携带该条目 */
  select: [item: AssetItem]
}>()

/** 子页签：分镜视频 / 分镜自定义 / 全局自定义 */
const videoSection = ref<'shot' | 'scene' | 'global'>('shot')

/** 是否有分镜上下文（决定是否显示「分镜自定义」子页签） */
const hasSceneContext = computed(
  () => !!(props.contextEpisode && props.contextShot),
)

/** 分镜自定义子页签的根目录（相对项目路径） */
const sceneRoot = computed(() => {
  if (!props.contextEpisode || !props.contextShot) return ''
  return `assert/custom/scene/${props.contextEpisode}/${props.contextShot}`
})

/** 分镜视频子页签：当前选中的集数与分镜 */
const shotEp = ref<string | undefined>(undefined)
const shotNo = ref<string | undefined>(undefined)
/** 集数选项（prompt/scene/ 下的目录名） */
const episodeOptions = ref<string[]>([])
/** 分镜选项（prompt/scene/{ep}/ 下的目录名） */
const shotOptions = ref<string[]>([])

/** 当前所选分镜的视频条目列表（video/ 目录下全部视频；目录为空时回退旧版 video.mp4） */
const shotVideos = ref<AssetItem[]>([])
const tabLoading = ref(false)

/**
 * 判断路径是否已被选中。
 *
 * @param path 资产相对路径
 * @returns true 表示已选中
 */
function isSelected(path: string): boolean {
  return props.selectedPaths.includes(path)
}

/**
 * 加载所选分镜的视频资产列表：
 * - 优先列出 assert/scene/{集}/{分镜}/video/ 目录下的全部视频文件（按序号排序）；
 * - 目录不存在或为空时回退检查旧版单文件路径 video.mp4（兼容历史批量生成数据）。
 */
async function loadShotVideos() {
  tabLoading.value = true
  shotVideos.value = []
  try {
    if (shotEp.value && shotNo.value) {
      const ep = shotEp.value
      const shot = shotNo.value
      const videos: AssetItem[] = []
      try {
        const res = await readFs(props.project, `assert/scene/${ep}/${shot}/video`) as DirResponse
        videos.push(
          ...(res?.entries ?? [])
            .filter((e: DirEntry) => e.type === 'file' && isVideoFile(e.name))
            .map((e: DirEntry): AssetItem => ({
              path: `assert/scene/${ep}/${shot}/video/${e.name}`,
              label: `分镜视频（第${ep}集 分镜${shot}）#${e.name.replace(/\.[^.]+$/, '')}`,
              thumbnail: '',
              depth: 0,
              video: true,
            }))
            .sort((a, b) => a.path.localeCompare(b.path, 'zh', { numeric: true })),
        )
      } catch {
        // video/ 目录不存在时忽略，走旧版 video.mp4 回退
      }
      if (videos.length === 0) {
        const legacy = `assert/scene/${ep}/${shot}/video.mp4`
        if (await existsFs(props.project, legacy)) {
          videos.push({
            path: legacy,
            label: `分镜视频（第${ep}集 分镜${shot}）`,
            thumbnail: '',
            depth: 0,
            video: true,
          })
        }
      }
      shotVideos.value = videos
    }
  } finally {
    tabLoading.value = false
  }
}

/**
 * 初始化分镜视频子页签：默认选中上下文集数/分镜，并加载集数/分镜选项。
 */
async function initShotSection() {
  if (props.contextEpisode) shotEp.value = props.contextEpisode
  if (props.contextShot) shotNo.value = props.contextShot
  try {
    const res = await readFs(props.project, 'prompt/scene') as DirResponse
    episodeOptions.value = (res?.entries ?? [])
      .filter((e: DirEntry) => e.type === 'dir')
      .map((e: DirEntry) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh', { numeric: true }))
  } catch {
    episodeOptions.value = []
  }
  await onShotEpChange()
}

/**
 * 集数变化：刷新分镜选项、校验既有选中（不在新选项里则清空），
 * 并加载所选分镜的视频。
 */
async function onShotEpChange() {
  shotOptions.value = []
  if (shotEp.value) {
    try {
      const res = await readFs(props.project, `prompt/scene/${shotEp.value}`) as DirResponse
      shotOptions.value = (res?.entries ?? [])
        .filter((e: DirEntry) => e.type === 'dir')
        .map((e: DirEntry) => e.name)
        .sort((a, b) => a.localeCompare(b, 'zh', { numeric: true }))
    } catch {
      shotOptions.value = []
    }
  }
  // 分镜选项刷新后校验既有选中：不在新选项里则清空，避免幻影值
  if (shotNo.value && !shotOptions.value.includes(shotNo.value)) {
    shotNo.value = undefined
  }
  await loadShotVideos()
}

/** 分镜变化：加载该分镜视频 */
watch(shotNo, () => {
  void loadShotVideos()
})

/** 弹窗打开（reloadKey 变化）或上下文变化时重新初始化分镜视频选择 */
watch(
  () => [props.reloadKey, props.contextEpisode, props.contextShot] as const,
  () => void initShotSection(),
  { immediate: true },
)
</script>

<style scoped>
.video-item {
  cursor: pointer;
  transition: background 0.15s ease;
}

.video-item:hover {
  background: rgba(var(--v-theme-primary), 0.05);
}

.asset-card--selected {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}
</style>
