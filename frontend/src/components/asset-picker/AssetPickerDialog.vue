<template>
  <v-dialog
    :model-value="modelValue"
    max-width="800"
    persistent
    @update:model-value="onUpdate"
  >
    <v-card>
      <!-- 标题栏 -->
      <v-card-title class="d-flex align-center">
        <span>{{ title || (mode === 'parent' ? '选择父变体' : '选择引用资产') }}</span>
        <v-spacer />
        <v-chip
          v-if="!parentMode && localSelected.length"
          size="small"
          variant="tonal"
          color="primary"
        >
          已选 {{ localSelected.length }}{{ max >= 0 ? ` / ${max}` : '' }}
        </v-chip>
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          @click="onUpdate(false)"
        />
      </v-card-title>

      <!-- 分类标签（parent 模式不显示；仅一个可见页签时隐藏） -->
      <v-tabs
        v-if="!parentMode && visibleTabs.length > 1"
        v-model="activeTab"
        grow
        density="compact"
      >
        <v-tab
          v-if="visibleTabs.includes('character')"
          value="character"
        >
          角色
        </v-tab>
        <v-tab
          v-if="visibleTabs.includes('stage')"
          value="stage"
        >
          场景
        </v-tab>
        <v-tab
          v-if="visibleTabs.includes('prop')"
          value="prop"
        >
          道具
        </v-tab>
        <v-tab
          v-if="visibleTabs.includes('custom')"
          value="custom"
        >
          自定义资产
        </v-tab>
        <v-tab
          v-if="visibleTabs.includes('scene-stage')"
          value="scene-stage"
        >
          分镜场景图
        </v-tab>
        <v-tab
          v-if="visibleTabs.includes('audio')"
          value="audio"
        >
          音频
        </v-tab>
        <v-tab
          v-if="visibleTabs.includes('video')"
          value="video"
        >
          分镜视频
        </v-tab>
      </v-tabs>

      <v-divider />

      <!-- 资产区域：各页签内容由子组件承载，仅挂载当前页签 -->
      <v-card-text style="min-height: 360px; max-height: 480px; overflow-y: auto;">
        <!-- Parent 模式：父变体卡片网格 -->
        <ParentVariantGrid
          v-if="parentMode"
          :active="modelValue"
          :reload-key="reloadKey"
          :project="project"
          :context-kind="contextKind"
          :context-owner="contextOwner"
          :context-base-label="contextBaseLabel"
          @select="onParentSelect"
          @close="onUpdate(false)"
        />

        <!-- 角色 / 场景：左右分栏资产树 -->
        <EntityAssetTree
          v-else-if="(activeTab === 'character' || activeTab === 'stage') && visibleTabs.includes(activeTab)"
          :active="modelValue"
          :reload-key="reloadKey"
          :project="project"
          :kind="entityKind"
          :exclude="exclude"
          :selected-paths="selectedPaths"
          :show-voice="showVoice"
          @select="onSelect"
        />

        <!-- 道具：分类 → 道具 → 资产 三级选择（按 mediaKind 过滤图片/视频/音频） -->
        <PropPicker
          v-else-if="activeTab === 'prop' && visibleTabs.includes('prop')"
          :active="modelValue"
          :reload-key="reloadKey"
          :project="project"
          :exclude="exclude"
          :selected-paths="selectedPaths"
          :media-filter="mediaKind ?? 'image'"
          @select="onSelect"
        />

        <!-- 自定义资产：目录浏览器（可按 mediaKind 扩展名过滤，默认图片） -->
        <CustomAssetsGrid
          v-else-if="activeTab === 'custom' && visibleTabs.includes('custom')"
          :active="modelValue"
          :reload-key="reloadKey"
          :project="project"
          :exclude="exclude"
          :selected-paths="selectedPaths"
          :accept-exts="customAcceptExts"
          @select="onSelect"
        />

        <!-- 分镜场景图：集数/分镜下拉 + 场景帧网格 -->
        <SceneStagePicker
          v-else-if="activeTab === 'scene-stage' && visibleTabs.includes('scene-stage')"
          :active="modelValue"
          :reload-key="reloadKey"
          :project="project"
          :context-episode="contextEpisode"
          :context-shot="contextShot"
          :selected-paths="selectedPaths"
          @select="onSelect"
        />

        <!-- 音频：台词音频 / 分镜自定义 / 全局自定义 -->
        <AudioPicker
          v-else-if="activeTab === 'audio' && visibleTabs.includes('audio')"
          :reload-key="reloadKey"
          :project="project"
          :context-episode="contextEpisode"
          :context-shot="contextShot"
          :exclude="exclude"
          :selected-paths="selectedPaths"
          @select="onSelect"
        />

        <!-- 分镜视频：分镜视频 / 分镜自定义 / 全局自定义 -->
        <VideoPicker
          v-else-if="activeTab === 'video' && visibleTabs.includes('video')"
          :reload-key="reloadKey"
          :project="project"
          :context-episode="contextEpisode"
          :context-shot="contextShot"
          :exclude="exclude"
          :selected-paths="selectedPaths"
          @select="onSelect"
        />
      </v-card-text>

      <v-divider v-if="!parentMode" />

      <!-- 已选资产排序栏（parent 模式不显示） -->
      <SelectedAssetsBar
        v-if="!parentMode"
        :items="localSelected"
        @remove="removeItem"
        @move="moveItem"
        @reorder="reorder"
      />

      <!-- 操作按钮 -->
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="onUpdate(false)"
        >
          取消
        </v-btn>
        <v-btn
          v-if="!parentMode"
          color="primary"
          @click="onConfirm"
        >
          确认
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getPathLabel, acceptExtsForMedia, thumbUrl } from './utils'
import type { AssetItem, AssetTab, PropMediaFilter } from './types'
import ParentVariantGrid from './ParentVariantGrid.vue'
import EntityAssetTree from './EntityAssetTree.vue'
import PropPicker from './PropPicker.vue'
import CustomAssetsGrid from './CustomAssetsGrid.vue'
import SceneStagePicker from './SceneStagePicker.vue'
import AudioPicker from './AudioPicker.vue'
import VideoPicker from './VideoPicker.vue'
import SelectedAssetsBar from './SelectedAssetsBar.vue'

/**
 * 通用资产选择器对话框（容器组件）。
 *
 * 负责弹窗壳、页签切换、选中列表状态与确认/取消；
 * 各页签内容分别由子组件承载（EntityAssetTree、CustomAssetsGrid、
 * SceneStagePicker、AudioPicker、ParentVariantGrid），
 * 已选资产排序栏由 SelectedAssetsBar 承载。
 *
 * 角色和场景标签采用左右分栏布局：左侧列出实体（角色名/场景名），
 * 右侧以树形展示该实体的资产及变体。自定义资产标签为平铺网格布局。
 *
 * 数据加载策略：各页签子组件仅在弹窗打开（active）且 reloadKey
 * 变化时加载；切换页签通过 v-if 重新挂载实现自动重新加载。
 */
const props = withDefaults(defineProps<{
  /** 弹窗是否打开 */
  modelValue: boolean
  /** 项目名 */
  project: string
  /** 初始已选资产路径列表 */
  selected?: string[]
  /** 需要排除的资产路径（不展示为可选） */
  exclude?: string[]
  /** 模式：refs（引用资产多选/单选）或 parent（父变体单选） */
  mode?: 'refs' | 'parent'
  /** 自定义标题，未指定时根据 mode 自动生成 */
  title?: string
  /** 可见的资产分类页签，未指定时显示全部；parent 模式忽略此 prop */
  tabs?: AssetTab[]
  /** 是否允许多选（默认 true）。false 时替换选中项，仍需确认提交 */
  multiple?: boolean
  /** 最大可选数量，默认 -1 无限制。仅在 multiple=true 时生效 */
  max?: number
  /** 上下文实体类型（parent 模式与 audio 页签使用） */
  contextKind?: 'character' | 'stage'
  /** 上下文实体名（parent 模式使用） */
  contextOwner?: string
  /** 上下文场景子场景标签（parent 模式、场景类型时使用） */
  contextBaseLabel?: string
  /** 集数（audio 页签：定位分镜台词音频与分镜自定义资产；可选） */
  contextEpisode?: string
  /** 分镜编号（audio 页签：定位分镜台词音频与分镜自定义资产；可选） */
  contextShot?: string
  /** 是否为音频选择场景：为 true 时「角色」页签额外展示角色音色（默认 false） */
  showVoice?: boolean
  /** 道具页签媒体过滤：image / video / audio（未指定默认 image） */
  mediaKind?: PropMediaFilter
}>(), {
  selected: () => [],
  exclude: () => [],
  mode: 'refs',
  title: undefined,
  tabs: () => ['character', 'stage', 'custom'],
  multiple: true,
  max: -1,
  contextKind: undefined,
  contextOwner: undefined,
  contextBaseLabel: undefined,
  contextEpisode: undefined,
  contextShot: undefined,
  showVoice: false,
  mediaKind: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:selected': [paths: string[]]
}>()

/** 是否为父变体选择模式 */
const parentMode = computed(() => props.mode === 'parent')

/** 当前可见的页签列表 */
const visibleTabs = computed(() => props.tabs)

/** 当前激活的页签 */
const activeTab = ref<AssetTab>('character')

/** 本地已选资产条目列表（确认时上抛路径） */
const localSelected = ref<AssetItem[]>([])

/** 弹窗打开时递增的重新加载信号，驱动各页签子组件重新加载 */
const reloadKey = ref(0)

/** 已选资产路径列表（供子组件高亮） */
const selectedPaths = computed(() => localSelected.value.map((item) => item.path))

/** 角色/场景页签对应的实体类型（仅当 activeTab 为二者之一时有效） */
const entityKind = computed<'character' | 'stage'>(() =>
  activeTab.value === 'stage' ? 'stage' : 'character',
)

/** 自定义资产页签可接受扩展名列表（由 mediaKind 映射，忽略大小写；未指定时默认图片扩展名） */
const customAcceptExts = computed<string[]>(() => acceptExtsForMedia(props.mediaKind ?? 'image'))

/**
 * 处理页签子组件的选中事件：
 * 多选时切换选中（达到上限则忽略），单选时替换选中项。
 *
 * @param item 被点击的资产条目
 */
function onSelect(item: AssetItem) {
  if (props.multiple) {
    const idx = localSelected.value.findIndex((i) => i.path === item.path)
    if (idx >= 0) {
      localSelected.value = localSelected.value.filter((_, i) => i !== idx)
    } else {
      // 达到上限时不再增加
      if (props.max >= 0 && localSelected.value.length >= props.max) return
      localSelected.value = [...localSelected.value, item]
    }
  } else {
    // 单选：替换选中项，仍需用户点击确认按钮提交
    localSelected.value = [item]
  }
}

/**
 * 父变体选择：立即确认并关闭弹窗。
 *
 * @param id 选中的父变体 id
 */
function onParentSelect(id: string) {
  emit('update:selected', [id])
  emit('update:modelValue', false)
}

/**
 * 移除指定下标的已选条目。
 *
 * @param idx 下标
 */
function removeItem(idx: number) {
  localSelected.value = localSelected.value.filter((_, i) => i !== idx)
}

/**
 * 将指定下标的已选条目向上/下移动。
 *
 * @param idx 下标
 * @param dir 移动方向
 */
function moveItem(idx: number, dir: 'up' | 'down') {
  const items = [...localSelected.value]
  const target = dir === 'up' ? idx - 1 : idx + 1
  if (target < 0 || target >= items.length) return
  const [moved] = items.splice(idx, 1)
  items.splice(target, 0, moved)
  localSelected.value = items
}

/**
 * 拖拽排序：将 from 下标的条目移动到 to 下标。
 *
 * @param from 起始下标
 * @param to 目标下标
 */
function reorder(from: number, to: number) {
  if (from === to) return
  const items = [...localSelected.value]
  const [moved] = items.splice(from, 1)
  items.splice(to, 0, moved)
  localSelected.value = items
}

/** 确认选择：上抛已选路径并关闭弹窗 */
function onConfirm() {
  emit('update:selected', selectedPaths.value)
  emit('update:modelValue', false)
}

/**
 * 弹窗打开状态变化处理（仅处理关闭）。
 *
 * @param open 是否打开
 */
function onUpdate(open: boolean) {
  if (!open) emit('update:modelValue', false)
}

/** 当 visibleTabs 变化时，确保 activeTab 处于可见范围 */
watch(visibleTabs, (tabs) => {
  if (!parentMode.value && tabs.length > 0 && !tabs.includes(activeTab.value)) {
    activeTab.value = tabs[0]
  }
})

/** 对话框打开时重置选中状态并触发各页签子组件重新加载 */
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      if (!parentMode.value) {
        // 确保 activeTab 是可见页签
        if (!visibleTabs.value.includes(activeTab.value)) {
          activeTab.value = visibleTabs.value[0] || 'character'
        }
        // 从 props.selected 初始化已选列表
        localSelected.value = props.selected.map((path) => ({
          path,
          label: getPathLabel(path),
          thumbnail: thumbUrl(props.project, path),
          depth: 0,
        }))
      }
      // 递增重新加载信号，驱动当前挂载的页签子组件重新加载
      reloadKey.value++
    }
  },
)
</script>
