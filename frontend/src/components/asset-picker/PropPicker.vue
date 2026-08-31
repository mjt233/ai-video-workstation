<template>
  <div
    class="d-flex"
    style="min-height: 300px;"
  >
    <!-- 左侧：分类列表 -->
    <div
      class="prop-picker-col"
      style="width: 130px; border-right: 1px solid rgba(0,0,0,0.08);"
    >
      <div
        v-for="cat in categoryList"
        :key="cat.key"
        class="entity-item pa-2 text-body-small cursor-pointer"
        :class="{ 'entity-item--active': selectedCategory === cat.key }"
        @click="selectCategory(cat.key)"
      >
        {{ cat.name }}
      </div>
      <div
        v-if="!categoryList.length"
        class="text-grey text-body-small pa-2 text-center"
      >
        暂无分类
      </div>
    </div>

    <!-- 中间：道具列表（选中分类后加载） -->
    <div
      class="prop-picker-col"
      style="width: 130px; border-right: 1px solid rgba(0,0,0,0.08);"
    >
      <div
        v-if="!selectedCategory"
        class="text-grey text-body-small pa-2 text-center"
      >
        请先选择分类
      </div>
      <template v-else>
        <div
          v-for="p in propList"
          :key="p.key"
          class="entity-item pa-2 text-body-small cursor-pointer"
          :class="{ 'entity-item--active': selectedProp === p.key }"
          @click="selectProp(p.key)"
        >
          {{ p.name }}
        </div>
        <div
          v-if="!propList.length"
          class="text-grey text-body-small pa-2 text-center"
        >
          该分类暂无道具
        </div>
      </template>
    </div>

    <!-- 右侧：资产列表（选中道具后加载，按媒体类型过滤） -->
    <div
      class="flex-grow-1"
      style="overflow-y: auto; padding-left: 8px;"
    >
      <div
        v-if="treeLoading"
        class="d-flex align-center justify-center py-8"
      >
        <v-progress-circular
          indeterminate
          size="20"
        />
      </div>
      <div
        v-else-if="!selectedProp"
        class="text-grey text-body-small pa-4 text-center"
      >
        请从左侧选择道具
      </div>
      <div
        v-else-if="!currentTree.length"
        class="text-grey text-body-small pa-4 text-center"
      >
        该道具暂无{{ mediaFilter === 'image' ? '图片' : mediaFilter === 'video' ? '视频' : '音频' }}资产
      </div>
      <template v-else>
        <!-- 音频条目：整行音频图标 + 标签 -->
        <div
          v-for="item in currentTree"
          :key="item.path"
          class="audio-tree-item d-flex align-center ga-2 px-2 py-1 rounded cursor-pointer ma-1"
          :class="{ 'asset-tree-item--selected': isSelected(item.path) }"
          :title="item.label"
          @click="$emit('select', item)"
        >
          <v-icon
            :color="mediaFilter === 'video' ? 'info' : 'secondary'"
            size="20"
          >
            {{ mediaFilter === 'video' ? 'mdi-video' : 'mdi-music-note' }}
          </v-icon>
          <span class="text-body-small text-truncate">{{ item.label }}</span>
          <v-spacer />
          <v-icon
            v-if="isSelected(item.path)"
            color="primary"
            size="18"
          >
            mdi-check-circle
          </v-icon>
        </div>
        <!-- 图片条目：缩略图卡片 -->
        <div
          v-for="item in currentTree"
          :key="item.path"
          class="asset-tree-item ma-1 pa-2 rounded cursor-pointer"
          :class="{ 'asset-tree-item--selected': isSelected(item.path) }"
          :title="item.label"
          @click="$emit('select', item)"
        >
          <AssetThumb
            :src="item.thumbnail"
            :width="128"
            :height="128"
            rounded
          />
          <div class="d-flex">
            <v-icon
              :color="isSelected(item.path) ? 'primary' : 'grey'"
              size="small"
            >
              {{ isSelected(item.path) ? 'mdi-check-circle' : 'mdi-circle-outline' }}
            </v-icon>
            <span class="text-body-small text-truncate ml-1">{{ item.label }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { readFs, type DirEntry, type DirResponse } from '../../api/client'
import {
  listAudioFilesRecursive,
  listImageFilesRecursive,
  listVideoFilesRecursive,
  thumbUrl,
} from './utils'
import AssetThumb from './AssetThumb.vue'
import type { AssetItem, EntityItem, PropMediaFilter } from './types'

/**
 * 道具页签：分类 → 道具 → 资产 三级选择。
 *
 * 左侧列出道具分类（prompt/prop/ 下目录），中间列出该分类下的道具，
 * 右侧按 mediaFilter 过滤展示所选道具的产物：
 * - image：道具图片产物（assert/prop/{分类}/{道具}/ 下图片文件）
 * - video：道具视频产物（目录下视频文件）
 * - audio：道具音频产物（目录下音频文件）
 *
 * 点击资产条目 emit select 事件交由父组件处理选中。
 */
const props = defineProps<{
  /** 项目名 */
  project: string
  /** 需要排除的资产路径（不展示） */
  exclude: string[]
  /** 当前已选中的资产路径列表（用于高亮） */
  selectedPaths: string[]
  /** 弹窗是否打开（仅在打开时加载） */
  active: boolean
  /** 弹窗打开时递增的重新加载信号 */
  reloadKey: number
  /** 媒体类型过滤：image / video / audio */
  mediaFilter: PropMediaFilter
}>()

defineEmits<{
  /** 点击资产条目，携带该条目 */
  select: [item: AssetItem]
}>()

/** 右侧资产树加载中标记 */
const treeLoading = ref(false)
/** 左侧分类列表 */
const categoryList = ref<EntityItem[]>([])
/** 中间道具列表 */
const propList = ref<EntityItem[]>([])
/** 当前选中的分类键 */
const selectedCategory = ref('')
/** 当前选中的道具键 */
const selectedProp = ref('')
/** 当前道具的资产列表 */
const currentTree = ref<AssetItem[]>([])

/**
 * 判断路径是否已被选中。
 *
 * @param path 资产相对路径
 * @returns true 表示已选中
 */
function isSelected(path: string): boolean {
  return props.selectedPaths.includes(path)
}

/** 根据当前媒体过滤类型加载左侧分类列表 */
async function loadCategories() {
  selectedCategory.value = ''
  selectedProp.value = ''
  currentTree.value = []
  try {
    const res = await readFs(props.project, 'prompt/prop/') as DirResponse
    categoryList.value = (res.entries ?? [])
      .filter((e: DirEntry) => e.type === 'dir')
      .map((e: DirEntry) => ({ key: e.name, name: e.name }))
  } catch {
    categoryList.value = []
  }
}

/**
 * 选中分类后加载其下道具列表。
 *
 * @param key 分类键
 */
async function selectCategory(key: string) {
  selectedCategory.value = key
  selectedProp.value = ''
  currentTree.value = []
  try {
    const res = await readFs(props.project, `prompt/prop/${key}/`) as DirResponse
    propList.value = (res.entries ?? [])
      .filter((e: DirEntry) => e.type === 'dir')
      .map((e: DirEntry) => ({ key: e.name, name: e.name }))
  } catch {
    propList.value = []
  }
}

/**
 * 选中道具后按媒体过滤类型加载资产列表。
 *
 * @param key 道具键
 */
async function selectProp(key: string) {
  selectedProp.value = key
  treeLoading.value = true
  try {
    const project = props.project
    const category = selectedCategory.value
    const dir = `assert/prop/${category}/${key}`
    const items: AssetItem[] = []

    if (props.mediaFilter === 'image') {
      const paths = (await listImageFilesRecursive(project, dir)).filter((p) => !props.exclude.includes(p))
      for (const p of paths) {
        items.push({
          path: p,
          label: propAssetLabel(category, key, p),
          thumbnail: thumbUrl(project, p),
          depth: 1,
        })
      }
    } else if (props.mediaFilter === 'video') {
      const paths = (await listVideoFilesRecursive(project, dir)).filter((p) => !props.exclude.includes(p))
      for (const p of paths) {
        items.push({
          path: p,
          label: propAssetLabel(category, key, p),
          thumbnail: '',
          depth: 1,
          video: true,
        })
      }
    } else {
      const paths = (await listAudioFilesRecursive(project, dir)).filter((p) => !props.exclude.includes(p))
      for (const p of paths) {
        items.push({
          path: p,
          label: propAssetLabel(category, key, p),
          thumbnail: '',
          depth: 1,
          audio: true,
        })
      }
    }
    currentTree.value = items
  } finally {
    treeLoading.value = false
  }
}

/**
 * 生成道具资产条目标签：固定产物显示「图片/视频」，其余显示文件名。
 *
 * @param category 分类名
 * @param propName 道具名
 * @param assetPath 资产相对路径
 * @returns 显示标签
 */
function propAssetLabel(category: string, propName: string, assetPath: string): string {
  const file = assetPath.split('/').pop() ?? assetPath
  if (file === 'image.jpg') return `${category}/${propName}/图片`
  if (file === 'video.mp4') return `${category}/${propName}/视频`
  return `${category}/${propName}/${file}`
}

/**
 * 弹窗打开、reloadKey 变化或 mediaFilter 切换时重新加载，并自动选中第一个分类。
 */
watch(
  () => [props.active, props.reloadKey, props.mediaFilter] as const,
  async () => {
    if (!props.active) return
    await loadCategories()
    // 自动选中左侧第一个分类，直接展示其道具列表
    if (categoryList.value.length > 0 && !selectedCategory.value) {
      await selectCategory(categoryList.value[0].key)
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.entity-item {
  cursor: pointer;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entity-item:hover {
  background: rgba(var(--v-theme-primary), 0.06);
}

.entity-item--active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}

.prop-picker-col {
  flex-shrink: 0;
  overflow-y: auto;
}

.asset-tree-item {
  border-radius: 4px;
  width: 128px;
  height: 164px;
  overflow: hidden;
  display: inline-block;
}

.asset-tree-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.asset-tree-item--selected {
  background: rgba(var(--v-theme-primary), 0.06);
}

/* 视频/音频条目（整行显示：图标 + 标签 + 选中勾） */
.audio-tree-item {
  border-radius: 4px;
  min-width: 0;
  transition: background 0.15s ease;
}

.audio-tree-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
</style>
