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

    <!-- 台词音频：台词列表 -->
    <VoiceLinesList
      v-show="audioSection === 'voice'"
      :active="audioSection === 'voice'"
      :reload-key="reloadKey"
      :project="project"
      :context-episode="contextEpisode"
      :context-shot="contextShot"
      :selected-paths="selectedPaths"
      @select="$emit('select', $event)"
    />

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
import { computed, ref } from 'vue'
import VoiceLinesList from './VoiceLinesList.vue'
import AudioFileBrowser from './AudioFileBrowser.vue'
import type { AssetItem } from './types'

/**
 * 音频页签。
 *
 * 内部包含 3 个子页签：台词音频（VoiceLinesList）、
 * 分镜自定义（AudioFileBrowser，根目录 assert/custom/scene/{ep}/{shot}）、
 * 全局自定义（AudioFileBrowser，根目录 assert/custom）。
 * 子区段通过 v-show 常驻挂载以保留各自的浏览目录状态，数据在激活时重新加载。
 */
const props = withDefaults(defineProps<{
  /** 项目名 */
  project: string
  /** 上下文集数（定位分镜台词音频与分镜自定义资产；可选） */
  contextEpisode?: string
  /** 上下文分镜（定位分镜台词音频与分镜自定义资产；可选） */
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
</script>
