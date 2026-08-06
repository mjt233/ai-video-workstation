<template>
  <div>
    <!-- 集数 / 分镜下拉 -->
    <div class="d-flex align-center ga-2 mb-3">
      <v-select
        v-model="sceneEp"
        :items="episodeOptions"
        label="集数"
        density="compact"
        hide-details
        style="width: 120px;"
        @update:model-value="onSceneEpChange"
      />
      <v-select
        v-model="sceneShot"
        :items="shotOptions"
        label="分镜"
        density="compact"
        hide-details
        style="width: 120px;"
        @update:model-value="loadSceneStages"
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
    <v-row
      v-else-if="sceneStages.length"
      dense
    >
      <v-col
        v-for="item in sceneStages"
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
            :title="item.label"
          >
            {{ item.label }}
          </div>
        </v-card>
      </v-col>
    </v-row>
    <div
      v-else
      class="text-grey text-body-medium text-center py-8"
    >
      该分镜暂无场景图（请先在「场景图片」页签生成）
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { readFs, type DirEntry, type DirResponse } from '../../api/client'
import { thumbUrl } from './utils'
import AssetThumb from './AssetThumb.vue'
import type { AssetItem } from './types'

/**
 * 分镜场景图页签。
 *
 * 通过集数/分镜下拉选择任意分镜，展示其已生成的场景帧
 * （assert/scene/{ep}/{shot}/stage/{i}.jpg）。默认选中上下文集数/分镜。
 */
const props = withDefaults(defineProps<{
  /** 项目名 */
  project: string
  /** 上下文集数（默认选中的集数） */
  contextEpisode?: string
  /** 上下文分镜（默认选中的分镜） */
  contextShot?: string
  /** 当前已选中的资产路径列表（用于高亮） */
  selectedPaths: string[]
  /** 弹窗是否打开（仅在打开时加载） */
  active: boolean
  /** 弹窗打开时递增的重新加载信号 */
  reloadKey: number
}>(), {
  contextEpisode: undefined,
  contextShot: undefined,
})

defineEmits<{
  /** 点击场景帧条目，携带该条目 */
  select: [item: AssetItem]
}>()

/** 分镜场景图条目列表（assert/scene/{ep}/{shot}/stage/{i}.jpg） */
const sceneStages = ref<AssetItem[]>([])
/** 当前选中的集数与分镜 */
const sceneEp = ref<string | null>(null)
const sceneShot = ref<string | null>(null)
/** 集数选项（prompt/scene/ 下的目录名） */
const episodeOptions = ref<string[]>([])
/** 分镜选项（prompt/scene/{ep}/ 下的目录名） */
const shotOptions = ref<string[]>([])
/** 加载中标记 */
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
 * 初始化分镜场景图页签：默认选中上下文集数/分镜，并加载集数选项。
 */
async function initSceneStageTab() {
  if (props.contextEpisode) sceneEp.value = props.contextEpisode
  if (props.contextShot) sceneShot.value = props.contextShot
  try {
    const res = (await readFs(props.project, 'prompt/scene')) as DirResponse
    episodeOptions.value = (res?.entries ?? [])
      .filter((e: DirEntry) => e.type === 'dir')
      .map((e: DirEntry) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh', { numeric: true }))
  } catch {
    episodeOptions.value = []
  }
  await onSceneEpChange()
}

/**
 * 集数变化：刷新分镜选项、校验既有选中，并加载场景帧。
 */
async function onSceneEpChange() {
  shotOptions.value = []
  if (sceneEp.value) {
    try {
      const res = (await readFs(props.project, `prompt/scene/${sceneEp.value}`)) as DirResponse
      shotOptions.value = (res?.entries ?? [])
        .filter((e: DirEntry) => e.type === 'dir')
        .map((e: DirEntry) => e.name)
        .sort((a, b) => a.localeCompare(b, 'zh', { numeric: true }))
    } catch {
      shotOptions.value = []
    }
  }
  // 分镜选项刷新后校验既有选中：不在新选项里则清空，避免幻影值
  if (sceneShot.value && !shotOptions.value.includes(sceneShot.value)) {
    sceneShot.value = null
  }
  await loadSceneStages()
}

/**
 * 加载「分镜场景图」页签数据。
 *
 * 读取选中的 assert/scene/{集数}/{分镜}/stage/ 目录下的 {i}.jpg 场景帧，
 * 按帧序号展示为「分镜场景图 N」；未选集数/分镜或目录不存在时为空。
 */
async function loadSceneStages() {
  tabLoading.value = true
  sceneStages.value = []
  try {
    const ep = sceneEp.value
    const shot = sceneShot.value
    if (!ep || !shot) return
    const dir = `assert/scene/${ep}/${shot}/stage`
    const res = await readFs(props.project, dir).catch(() => null) as DirResponse | null
    const entries = res?.entries ?? []
    const images = entries
      .filter((e: DirEntry) => e.type === 'file' && /\.jpe?g$/i.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }))
    sceneStages.value = images.map((e: DirEntry) => {
      const idx = Number(e.name.replace(/\.[^.]+$/, ''))
      return {
        path: `${dir}/${e.name}`,
        label: Number.isFinite(idx) ? `分镜场景图 ${idx + 1}` : e.name,
        thumbnail: thumbUrl(props.project, `${dir}/${e.name}`),
        depth: 0,
      }
    })
  } finally {
    tabLoading.value = false
  }
}

/** 弹窗打开或 reloadKey 变化时初始化 */
watch(
  () => [props.active, props.reloadKey] as const,
  () => {
    if (props.active) void initSceneStageTab()
  },
  { immediate: true },
)
</script>

<style scoped>
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
</style>
