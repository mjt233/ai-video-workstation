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
        <span>选择引用资产</span>
        <v-spacer />
        <v-chip
          v-if="localSelected.length"
          size="small"
          variant="tonal"
          color="primary"
        >
          已选 {{ localSelected.length }}
        </v-chip>
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          @click="onUpdate(false)"
        />
      </v-card-title>

      <!-- 分类标签 -->
      <v-tabs
        v-model="activeTab"
        grow
        density="compact"
        @update:model-value="onTabChange"
      >
        <v-tab value="character">
          角色外观
        </v-tab>
        <v-tab value="characterVariant">
          角色变体
        </v-tab>
        <v-tab value="stage">
          场景设定
        </v-tab>
        <v-tab value="stageVariant">
          场景变体
        </v-tab>
        <v-tab value="custom">
          自定义资产
        </v-tab>
      </v-tabs>

      <v-divider />

      <!-- 资产网格 -->
      <v-card-text style="min-height: 280px; max-height: 400px; overflow-y: auto;">
        <!-- 加载中 -->
        <div
          v-if="tabLoading"
          class="d-flex align-center justify-center py-8"
        >
          <v-progress-circular
            indeterminate
            size="28"
          />
        </div>

        <!-- 空状态 -->
        <div
          v-else-if="!tabItems.length"
          class="text-grey text-body-2 text-center py-8"
        >
          暂无可用资产
        </div>

        <!-- 缩略图网格 -->
        <v-row
          v-else
          dense
        >
          <v-col
            v-for="item in tabItems"
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
              @click="toggle(item)"
            >
              <div class="asset-thumb-wrap">
                <v-img
                  :src="item.thumbnail"
                  aspect-ratio="1"
                  cover
                  class="bg-grey-lighten-3"
                >
                  <template #placeholder>
                    <div class="d-flex align-center justify-center fill-height text-caption text-grey">
                      加载中
                    </div>
                  </template>
                </v-img>
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
                class="pa-1 text-caption text-truncate text-center"
                :title="item.label"
              >
                {{ item.label }}
              </div>
            </v-card>
          </v-col>
        </v-row>
      </v-card-text>

      <v-divider />

      <!-- 已选资产排序栏 -->
      <div class="pa-3">
        <div class="text-caption text-medium-emphasis mb-2">
          已选资产（按序）：
        </div>
        <div
          v-if="localSelected.length"
          class="d-flex flex-wrap align-center ga-1"
        >
          <div
            v-for="(item, idx) in localSelected"
            :key="item.path"
            class="selected-item d-flex align-center ga-1"
            draggable="true"
            @dragstart="onDragStart($event, idx)"
            @dragover.prevent="onDragOver($event, idx)"
            @drop="onDrop($event, idx)"
            @dragend="onDragEnd"
          >
            <v-chip
              closable
              @click:close="removeItem(idx)"
            >
              <v-avatar
                left
                size="20"
              >
                <v-img
                  :src="item.thumbnail"
                  cover
                />
              </v-avatar>
              <span class="text-caption">{{ item.label }}</span>
            </v-chip>
            <div class="d-flex flex-column ga-0">
              <v-btn
                icon="mdi-chevron-up"
                size="x-small"
                variant="text"
                density="compact"
                :disabled="idx === 0"
                @click="moveItem(idx, 'up')"
              />
              <v-btn
                icon="mdi-chevron-down"
                size="x-small"
                variant="text"
                density="compact"
                :disabled="idx === localSelected.length - 1"
                @click="moveItem(idx, 'down')"
              />
            </div>
          </div>
        </div>
        <div
          v-else
          class="text-caption text-grey"
        >
          暂无选择，点击上方资产添加
        </div>
      </div>

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
/**
 * 通用资产选择器对话框。
 *
 * 提供按分类浏览、多选、拖拽排序的资产选择能力。
 * 用于 VariantPanel 等需要引用图片资产的场景。
 */
import { ref, watch } from 'vue'
import client, { readFs, type DirEntry, type DirResponse } from '../api/client'
import { listCharacterVariants, listStageVariants } from '../api/assets'

/** 资产分类标签 */
type AssetTab = 'character' | 'characterVariant' | 'stage' | 'stageVariant' | 'custom'

/** 网格中的资产条目 */
interface AssetItem {
  /** 资产相对路径（project 根） */
  path: string
  /** 显示标签 */
  label: string
  /** 缩略图直链 */
  thumbnail: string
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  project: string
  selected?: string[]
  exclude?: string[]
}>(), {
  selected: () => [],
  exclude: () => [],
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:selected': [paths: string[]]
}>()

// ── 状态 ───────────────────────────────────────────────

const activeTab = ref<AssetTab>('character')
const tabLoading = ref(false)
const tabItems = ref<AssetItem[]>([])
const localSelected = ref<AssetItem[]>([])
const allItems = ref<Record<AssetTab, AssetItem[]>>({
  character: [],
  characterVariant: [],
  stage: [],
  stageVariant: [],
  custom: [],
})

// ── 拖动排序 ───────────────────────────────────────────

let dragIdx: number | null = null

function onDragStart(e: DragEvent, idx: number) {
  dragIdx = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onDragOver(e: DragEvent, idx: number) {
  if (dragIdx === null || dragIdx === idx) return
  // 视觉反馈：可加 hover 样式
}

function onDrop(e: DragEvent, idx: number) {
  if (dragIdx === null || dragIdx === idx) return
  const items = [...localSelected.value]
  const [moved] = items.splice(dragIdx, 1)
  items.splice(idx, 0, moved)
  localSelected.value = items
  dragIdx = null
}

function onDragEnd() {
  dragIdx = null
}

function moveItem(idx: number, dir: 'up' | 'down') {
  const items = [...localSelected.value]
  const target = dir === 'up' ? idx - 1 : idx + 1
  if (target < 0 || target >= items.length) return
  const [moved] = items.splice(idx, 1)
  items.splice(target, 0, moved)
  localSelected.value = items
}

function removeItem(idx: number) {
  localSelected.value = localSelected.value.filter((_, i) => i !== idx)
}

// ── 选择逻辑 ───────────────────────────────────────────

function isSelected(path: string): boolean {
  return localSelected.value.some((item) => item.path === path)
}

function toggle(item: AssetItem) {
  const idx = localSelected.value.findIndex((i) => i.path === item.path)
  if (idx >= 0) {
    localSelected.value = localSelected.value.filter((_, i) => i !== idx)
  } else {
    localSelected.value = [...localSelected.value, item]
  }
}

function onConfirm() {
  emit('update:selected', localSelected.value.map((item) => item.path))
  emit('update:modelValue', false)
}

function onUpdate(open: boolean) {
  if (!open) emit('update:modelValue', false)
}

// ── 数据加载 ───────────────────────────────────────────

const ts = () => Date.now()

/**
 * 递归列出目录下的所有图片文件路径。
 * 服务端目前不支持 recursive 参数，故客户端递归实现。
 */
async function listImageFilesRecursive(project: string, dirRelPath: string): Promise<string[]> {
  const results: string[] = []
  const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

  async function walk(relPath: string) {
    const res = await readFs(project, relPath) as DirResponse
    const entries = res.entries ?? []
    for (const entry of entries) {
      const childRel = relPath.endsWith('/') ? `${relPath}${entry.name}` : `${relPath}/${entry.name}`
      if (entry.type === 'dir') {
        await walk(childRel)
      } else {
        const ext = entry.name.toLowerCase().split('.').pop()
        if (ext && IMAGE_EXTS.has(`.${ext}`)) {
          results.push(childRel)
        }
      }
    }
  }

  try {
    await walk(dirRelPath)
  } catch {
    // 目录不存在时静默处理
  }
  return results
}

/**
 * 列出 prompt/stage/{stage}/ 下作为场景标签的 .md 文件（排除 overview.md）。
 */
async function listStageLabels(project: string, stage: string): Promise<string[]> {
  try {
    const res = await readFs(project, `prompt/stage/${stage}`) as DirResponse
    const entries = res.entries ?? []
    return entries
      .filter((e) => e.type === 'file' && e.name.endsWith('.md') && e.name !== 'overview.md')
      .map((e) => e.name.replace(/\.md$/, ''))
  } catch {
    return []
  }
}

/** 加载「角色外观」标签数据 */
async function loadCharacterTab(project: string): Promise<AssetItem[]> {
  const items: AssetItem[] = []
  try {
    const res = await readFs(project, 'prompt/character/') as DirResponse
    const dirs = (res.entries ?? []).filter((e) => e.type === 'dir')
    for (const dir of dirs) {
      const name = dir.name
      const path = `assert/character/${name}/appearance.jpg`
      // 排除已选择或排除列表中的路径
      if (props.exclude.includes(path)) continue
      items.push({
        path,
        label: name,
        thumbnail: `/api/fs/${project}/${path}?t=${ts()}`,
      })
    }
  } catch {
    // ignore
  }
  return items
}

/** 加载「角色变体」标签数据 */
async function loadCharacterVariantTab(project: string): Promise<AssetItem[]> {
  const items: AssetItem[] = []
  try {
    const res = await readFs(project, 'prompt/character/') as DirResponse
    const dirs = (res.entries ?? []).filter((e) => e.type === 'dir')
    for (const dir of dirs) {
      try {
        const { variants } = await listCharacterVariants(project, dir.name)
        for (const v of variants) {
          if (!v.hasImage) continue
          if (props.exclude.includes(v.imagePath)) continue
          items.push({
            path: v.imagePath,
            label: `${dir.name} / ${v.id}`,
            thumbnail: `/api/fs/${project}/${v.imagePath}?t=${ts()}`,
          })
        }
      } catch {
        // 单个角色加载失败不影响其他角色
      }
    }
  } catch {
    // ignore
  }
  return items
}

/** 加载「场景设定」标签数据 */
async function loadStageTab(project: string): Promise<AssetItem[]> {
  const items: AssetItem[] = []
  try {
    const res = await readFs(project, 'prompt/stage/') as DirResponse
    const dirs = (res.entries ?? []).filter((e) => e.type === 'dir')
    for (const dir of dirs) {
      const labels = await listStageLabels(project, dir.name)
      for (const label of labels) {
        const path = `assert/stage/${dir.name}/${label}.jpg`
        if (props.exclude.includes(path)) continue
        items.push({
          path,
          label: `${dir.name} / ${label}`,
          thumbnail: `/api/fs/${project}/${path}?t=${ts()}`,
        })
      }
    }
  } catch {
    // ignore
  }
  return items
}

/** 加载「场景变体」标签数据 */
async function loadStageVariantTab(project: string): Promise<AssetItem[]> {
  const items: AssetItem[] = []
  try {
    const res = await readFs(project, 'prompt/stage/') as DirResponse
    const dirs = (res.entries ?? []).filter((e) => e.type === 'dir')
    for (const dir of dirs) {
      const labels = await listStageLabels(project, dir.name)
      for (const label of labels) {
        try {
          const { variants } = await listStageVariants(project, dir.name, label)
          for (const v of variants) {
            if (!v.hasImage) continue
            if (props.exclude.includes(v.imagePath)) continue
            items.push({
              path: v.imagePath,
              label: `${dir.name} / ${label} / ${v.id}`,
              thumbnail: `/api/fs/${project}/${v.imagePath}?t=${ts()}`,
            })
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return items
}

/** 加载「自定义资产」标签数据 */
async function loadCustomTab(project: string): Promise<AssetItem[]> {
  const items: AssetItem[] = []
  const imagePaths = await listImageFilesRecursive(project, 'assert/custom/')
  for (const p of imagePaths) {
    if (props.exclude.includes(p)) continue
    // 从路径中提取相对 assert/custom/ 的显示名
    const relPath = p.replace(/^assert\/custom\//, '')
    items.push({
      path: p,
      label: relPath,
      thumbnail: `/api/fs/${project}/${p}?t=${ts()}`,
    })
  }
  return items
}

/** 切换标签页时加载数据 */
async function onTabChange() {
  const tab = activeTab.value
  // 如果该标签数据已缓存，直接使用
  if (allItems.value[tab]?.length) {
    tabItems.value = allItems.value[tab]
    return
  }

  tabLoading.value = true
  tabItems.value = []
  try {
    const project = props.project
    let items: AssetItem[] = []
    switch (tab) {
      case 'character':
        items = await loadCharacterTab(project)
        break
      case 'characterVariant':
        items = await loadCharacterVariantTab(project)
        break
      case 'stage':
        items = await loadStageTab(project)
        break
      case 'stageVariant':
        items = await loadStageVariantTab(project)
        break
      case 'custom':
        items = await loadCustomTab(project)
        break
    }
    allItems.value[tab] = items
    tabItems.value = items
  } finally {
    tabLoading.value = false
  }
}

// ── 生命周期 ───────────────────────────────────────────

/** 对话框打开时重置状态并加载首个标签 */
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      // 重置内部选择
      localSelected.value = []
      // 清除缓存以便重新加载
      allItems.value = { character: [], characterVariant: [], stage: [], stageVariant: [], custom: [] }
      activeTab.value = 'character'
      void onTabChange()
    }
  },
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

.selected-item {
  position: relative;
}
</style>
