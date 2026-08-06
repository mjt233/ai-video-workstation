<template>
  <div>
    <!-- 3 个子页签（台词音频 / 分镜自定义 / 全局自定义） -->
    <v-tabs
      v-model="audioSection"
      grow
      density="compact"
      class="mb-2"
    >
      <v-tab value="voice">
        台词音频
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

    <!-- 台词音频：集数/分镜选择 + 台词列表（可指定任意分镜） -->
    <div v-show="audioSection === 'voice'">
      <!-- 集数 / 分镜下拉：默认选中上下文，可切换任意分镜 -->
      <div class="d-flex align-center ga-2 mb-2">
        <v-select
          v-model="voiceEp"
          :items="episodeOptions"
          label="集数"
          density="compact"
          hide-details
          style="width: 130px;"
          @update:model-value="onVoiceEpChange"
        />
        <v-select
          v-model="voiceShot"
          :items="shotOptions"
          label="分镜"
          density="compact"
          hide-details
          style="width: 130px;"
        />
        <span
          v-if="!voiceEp || !voiceShot"
          class="text-caption text-grey"
        >
          请选择集数与分镜
        </span>
      </div>
      <VoiceLinesList
        :active="audioSection === 'voice'"
        :reload-key="reloadKey"
        :project="project"
        :episode="voiceEp"
        :shot="voiceShot"
        :selected-paths="selectedPaths"
        @select="$emit('select', $event)"
      />
    </div>

    <!-- 分镜自定义：文件浏览器 -->
    <AudioFileBrowser
      v-if="hasSceneContext"
      v-show="audioSection === 'scene'"
      :active="audioSection === 'scene'"
      :reload-key="reloadKey"
      :project="project"
      :root="sceneRoot"
      label="分镜自定义"
      :exclude="exclude"
      :selected-paths="selectedPaths"
      @select="$emit('select', $event)"
    />

    <!-- 全局自定义：文件浏览器 -->
    <AudioFileBrowser
      v-show="audioSection === 'global'"
      :active="audioSection === 'global'"
      :reload-key="reloadKey"
      :project="project"
      root="assert/custom"
      label="全局自定义"
      :exclude="exclude"
      :selected-paths="selectedPaths"
      @select="$emit('select', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { readFs, type DirEntry, type DirResponse } from '../../api/client'
import VoiceLinesList from './VoiceLinesList.vue'
import AudioFileBrowser from './AudioFileBrowser.vue'
import type { AssetItem } from './types'

/**
 * 音频页签。
 *
 * 内部包含 3 个子页签：台词音频（VoiceLinesList）、
 * 分镜自定义（AudioFileBrowser，根目录 assert/custom/scene/{ep}/{shot}）、
 * 全局自定义（AudioFileBrowser，根目录 assert/custom）。
 * 台词音频子页签提供集数/分镜下拉，可指定任意分镜的台词音频（默认当前上下文）。
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

/** 音频子页签：台词音频 / 分镜自定义 / 全局自定义 */
const audioSection = ref<'voice' | 'scene' | 'global'>('voice')

/** 是否有分镜上下文（决定是否显示「分镜自定义」子页签） */
const hasSceneContext = computed(
  () => !!(props.contextEpisode && props.contextShot),
)

/** 分镜自定义子页签的根目录（相对项目路径） */
const sceneRoot = computed(() => {
  if (!props.contextEpisode || !props.contextShot) return ''
  return `assert/custom/scene/${props.contextEpisode}/${props.contextShot}`
})

/** 台词音频子页签：当前选中的集数与分镜 */
const voiceEp = ref<string | undefined>(undefined)
const voiceShot = ref<string | undefined>(undefined)
/** 集数选项（prompt/scene/ 下的目录名） */
const episodeOptions = ref<string[]>([])
/** 分镜选项（prompt/scene/{ep}/ 下的目录名） */
const shotOptions = ref<string[]>([])

/**
 * 初始化台词音频子页签：默认选中上下文集数/分镜，并加载集数/分镜选项。
 */
async function initVoiceSection() {
  if (props.contextEpisode) voiceEp.value = props.contextEpisode
  if (props.contextShot) voiceShot.value = props.contextShot
  try {
    const res = await readFs(props.project, 'prompt/scene') as DirResponse
    episodeOptions.value = (res?.entries ?? [])
      .filter((e: DirEntry) => e.type === 'dir')
      .map((e: DirEntry) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh', { numeric: true }))
  } catch {
    episodeOptions.value = []
  }
  await onVoiceEpChange()
}

/**
 * 集数变化：刷新分镜选项、校验既有选中（不在新选项里则清空），
 * VoiceLinesList 会随集数/分镜变化自动重新加载。
 */
async function onVoiceEpChange() {
  shotOptions.value = []
  if (voiceEp.value) {
    try {
      const res = await readFs(props.project, `prompt/scene/${voiceEp.value}`) as DirResponse
      shotOptions.value = (res?.entries ?? [])
        .filter((e: DirEntry) => e.type === 'dir')
        .map((e: DirEntry) => e.name)
        .sort((a, b) => a.localeCompare(b, 'zh', { numeric: true }))
    } catch {
      shotOptions.value = []
    }
  }
  // 分镜选项刷新后校验既有选中：不在新选项里则清空，避免幻影值
  if (voiceShot.value && !shotOptions.value.includes(voiceShot.value)) {
    voiceShot.value = undefined
  }
}

/** 弹窗打开（reloadKey 变化）或上下文变化时重新初始化台词音频选择 */
watch(
  () => [props.reloadKey, props.contextEpisode, props.contextShot] as const,
  () => void initVoiceSection(),
  { immediate: true },
)
</script>
