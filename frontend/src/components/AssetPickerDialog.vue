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
        @update:model-value="onTabChange"
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
          v-if="visibleTabs.includes('custom')"
          value="custom"
        >
          自定义资产
        </v-tab>
      </v-tabs>

      <v-divider />

      <!-- 资产区域 -->
      <v-card-text style="min-height: 360px; max-height: 480px; overflow-y: auto;">
        <!-- Parent 模式：变体卡片网格 -->
        <template v-if="parentMode">
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
            v-else-if="!parentVariants.length"
            class="text-grey text-body-2 text-center py-8"
          >
            暂无可用变体
          </div>
          <v-row
            v-else
            dense
          >
            <v-col
              v-for="v in parentVariants"
              :key="v.id"
              cols="4"
              sm="3"
              md="2"
            >
              <v-card
                variant="outlined"
                class="asset-card"
                @click="selectParent(v)"
              >
                <v-img
                  :src="parentVariantThumb(v)"
                  height="140"
                  cover
                  class="bg-grey-lighten-3"
                >
                  <template #placeholder>
                    <div class="d-flex align-center justify-center fill-height text-caption text-grey">
                      加载中
                    </div>
                  </template>
                </v-img>
                <div class="pa-1">
                  <div class="text-caption text-truncate font-weight-medium">
                    {{ v.id }}
                  </div>
                  <div class="text-caption text-truncate text-grey">
                    {{ v.desc }}
                  </div>
                  <v-chip
                    size="x-small"
                    :color="v.hasImage ? 'success' : 'grey'"
                    variant="tonal"
                  >
                    {{ v.hasImage ? '有图' : '未生成' }}
                  </v-chip>
                </div>
              </v-card>
            </v-col>
          </v-row>
        </template>

        <!-- 加载中（refs 模式） -->
        <div
          v-else-if="tabLoading"
          class="d-flex align-center justify-center py-8"
        >
          <v-progress-circular
            indeterminate
            size="28"
          />
        </div>

        <!-- 角色 / 场景：左右分栏（refs 模式，仅当该页签可见时渲染） -->
        <template v-else-if="(activeTab === 'character' || activeTab === 'stage') && visibleTabs.includes(activeTab)">
          <div
            class="d-flex"
            style="min-height: 300px;"
          >
            <!-- 左侧：实体列表 -->
            <div
              class="entity-list"
              style="width: 140px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid rgba(0,0,0,0.08);"
            >
              <div
                v-for="ent in entityList"
                :key="ent.key"
                class="entity-item pa-2 text-caption cursor-pointer"
                :class="{ 'entity-item--active': selectedEntity === ent.key }"
                @click="selectEntity(ent.key)"
              >
                {{ ent.name }}
              </div>
              <div
                v-if="!entityList.length"
                class="text-grey text-caption pa-2 text-center"
              >
                暂无
              </div>
            </div>

            <!-- 右侧：树形资产列表 -->
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
                v-else-if="!selectedEntity"
                class="text-grey text-caption pa-4 text-center"
              >
                请从左侧选择
              </div>
              <div
                v-else-if="!currentTree.length"
                class="text-grey text-caption pa-4 text-center"
              >
                该{{ activeTab === 'character' ? '角色' : '场景' }}暂无可用资产
              </div>
              <template v-else>
                <div
                  v-for="item in currentTree"
                  :key="item.path"
                  class="asset-tree-item ma-1 pa-2 rounded cursor-pointer"
                  :class="{ 'asset-tree-item--selected': isSelected(item.path) }"
                  :title="item.label"
                  @click="selectItem(item)"
                >
                  <v-img
                    v-if="!imgErrors.has(item.path)"
                    :src="item.thumbnail"
                    width="128"
                    height="128"
                    cover
                    class="rounded flex-shrink-0"
                    @error="onImgError(item.path)"
                  />
                  <div
                    v-else
                    class="d-flex align-center justify-center bg-grey-lighten-3 rounded flex-shrink-0"
                    style="width:128px;height:128px;"
                  >
                    <v-icon
                      color="grey"
                      size="40"
                    >
                      mdi-image-off-outline
                    </v-icon>
                  </div>
                  <div class="d-flex">
                    <v-icon
                      :color="isSelected(item.path) ? 'primary' : 'grey'"
                      size="small"
                    >
                      {{ isSelected(item.path) ? 'mdi-check-circle' : 'mdi-circle-outline' }}
                    </v-icon>
                    <span class="text-caption text-truncate ml-1">{{ item.label }}</span>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>

        <!-- 自定义资产：平铺网格（仅当该页签可见时渲染） -->
        <template v-else-if="activeTab === 'custom' && visibleTabs.includes('custom')">
          <v-row
            v-if="tabItems.length"
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
                @click="selectItem(item)"
              >
                <div class="asset-thumb-wrap">
                  <v-img
                    v-if="!imgErrors.has(item.path)"
                    :src="item.thumbnail"
                    height="120"
                    cover
                    class="bg-grey-lighten-3"
                    @error="onImgError(item.path)"
                  >
                    <template #placeholder>
                      <div class="d-flex align-center justify-center fill-height text-caption text-grey">
                        加载中
                      </div>
                    </template>
                  </v-img>
                  <div
                    v-else
                    class="d-flex align-center justify-center bg-grey-lighten-3"
                    style="height:120px;"
                  >
                    <v-icon
                      color="grey"
                      size="40"
                    >
                      mdi-image-off-outline
                    </v-icon>
                  </div>
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
          <div
            v-else
            class="text-grey text-body-2 text-center py-8"
          >
            暂无可用资产
          </div>
        </template>
      </v-card-text>

      <v-divider v-if="!parentMode" />

      <!-- 已选资产排序栏（parent 模式不显示） -->
      <div
        v-if="!parentMode"
        class="pa-3"
        style="min-height: 84px;"
      >
        <div
          class="text-caption text-medium-emphasis mb-2"
        >
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
/**
 * 通用资产选择器对话框。
 *
 * 提供按分类浏览、多选、拖拽排序的资产选择能力。
 * 用于 VariantPanel 等需要引用图片资产的场景。
 *
 * 角色和场景标签采用左右分栏布局：
 * 左侧列出实体（角色名/场景名），右侧以树形展示该实体的资产及变体。
 * 自定义资产标签保留原来的平铺网格布局。
 */
import { computed, ref, watch } from 'vue'
import client, { readFs, type DirEntry, type DirResponse } from '../api/client'
import { listCharacterVariants, listStageVariants, type VariantInfo } from '../api/assets'

/** 资产分类标签 */
type AssetTab = 'character' | 'stage' | 'custom'

/** 树形资产条目 */
interface AssetItem {
  /** 资产相对路径（project 根） */
  path: string
  /** 显示标签 */
  label: string
  /** 缩略图直链 */
  thumbnail: string
  /** 缩进层级（0 = 根） */
  depth: number
}

/** 左侧实体列表条目 */
interface EntityItem {
  key: string
  name: string
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  project: string
  selected?: string[]
  exclude?: string[]
  mode?: 'refs' | 'parent'
  /** 自定义标题，未指定时根据 mode 自动生成 */
  title?: string
  /** 可见的资产分类页签，未指定时显示全部；parent 模式忽略此 prop */
  tabs?: AssetTab[]
  /** 是否允许多选（默认 true）。false 时替换选中项，仍需确认提交 */
  multiple?: boolean
  /** 最大可选数量，默认 -1 无限制。仅在 multiple=true 时生效 */
  max?: number
  contextKind?: 'character' | 'stage'
  contextOwner?: string
  contextBaseLabel?: string
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
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:selected': [paths: string[]]
}>()

/** 是否为父变体选择模式 */
const parentMode = computed(() => props.mode === 'parent')

/** 当前可见的页签列表 */
const visibleTabs = computed(() => props.tabs)

// ── 状态 ───────────────────────────────────────────────

const activeTab = ref<AssetTab>('character')
const tabLoading = ref(false)
const treeLoading = ref(false)
const entityList = ref<EntityItem[]>([])
const selectedEntity = ref('')
const currentTree = ref<AssetItem[]>([])
const tabItems = ref<AssetItem[]>([])
const localSelected = ref<AssetItem[]>([])
const parentVariants = ref<VariantInfo[]>([])

/** 记录缩略图加载失败的路径，用于显示 fallback 图标 */
const imgErrors = ref(new Set<string>())

function onImgError(path: string) {
  imgErrors.value.add(path)
}

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

function onConfirm() {
  emit('update:selected', localSelected.value.map((item) => item.path))
  emit('update:modelValue', false)
}

/**
 * 点击资产条目：单选模式直接确认，多选模式切换选中。
 */
function selectItem(item: AssetItem) {
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

function onUpdate(open: boolean) {
  if (!open) emit('update:modelValue', false)
}

// ── 工具函数 ───────────────────────────────────────────

const ts = () => Date.now()

/**
 * 根据路径生成可读的显示标签，用于初始化 selected 条目的显示。
 */
function getPathLabel(path: string): string {
  if (path.startsWith('assert/custom/')) {
    return '自定义/' + path.slice('assert/custom/'.length)
  }
  if (path.startsWith('assert/character/')) {
    const rest = path.slice('assert/character/'.length)
    return rest.replace('/appearance.jpg', '/外观').replace('/variants/', '/').replace(/\.jpg$/, '')
  }
  if (path.startsWith('assert/stage/')) {
    const rest = path.slice('assert/stage/'.length)
    return rest.replace('/variants/', '/').replace(/\.jpg$/, '')
  }
  return path.split('/').pop() ?? path
}

/**
 * 递归将 VariantInfo 列表拍平为带缩进层级的树形 AssetItem 数组。
 */
function flattenVariantTree(
  variants: VariantInfo[],
  project: string,
  parentId?: string,
  startDepth: number = 1,
): AssetItem[] {
  const items: AssetItem[] = []
  const children = variants.filter(
    (v) => (v.parentId ?? undefined) === (parentId ?? undefined) && !props.exclude.includes(v.imagePath),
  )
  for (const v of children) {
    items.push({
      path: v.imagePath,
      label: v.id,
      thumbnail: `/api/fs/${project}/${v.imagePath}?t=${ts()}`,
      depth: startDepth,
    })
    items.push(...flattenVariantTree(variants, project, v.id, startDepth + 1))
  }
  return items
}

// ── Parent 模式 ──────────────────────────────────────

/** 获取父变体缩略图 URL（无图时返回空白占位符） */
function parentVariantThumb(v: VariantInfo): string | undefined {
  if (!v.hasImage) return undefined
  return `/api/fs/${props.project}/${v.imagePath}?t=${Date.now()}`
}

/** 选择父变体（立即确认） */
function selectParent(v: VariantInfo) {
  emit('update:selected', [v.id])
  emit('update:modelValue', false)
}

/** 加载父变体列表 */
async function loadParentVariants() {
  if (!props.contextKind || !props.contextOwner) return
  tabLoading.value = true
  parentVariants.value = []
  try {
    if (props.contextKind === 'character') {
      const res = await listCharacterVariants(props.project, props.contextOwner)
      parentVariants.value = res.variants
    } else if (props.contextKind === 'stage' && props.contextBaseLabel) {
      const res = await listStageVariants(props.project, props.contextOwner, props.contextBaseLabel)
      parentVariants.value = res.variants
    }
  } catch {
    // ignore
  } finally {
    tabLoading.value = false
  }
}

// ── 数据加载 ───────────────────────────────────────────

/**
 * 根据当前标签加载左侧实体列表。
 */
async function loadEntityList() {
  selectedEntity.value = ''
  currentTree.value = []
  const project = props.project
  const prefix = activeTab.value === 'character' ? 'prompt/character/' : 'prompt/stage/'
  try {
    const res = await readFs(project, prefix) as DirResponse
    entityList.value = (res.entries ?? [])
      .filter((e: DirEntry) => e.type === 'dir')
      .map((e: DirEntry) => ({ key: e.name, name: e.name }))
  } catch {
    entityList.value = []
  }
}

/**
 * 选中左侧实体后，构建右侧树形资产列表。
 */
async function selectEntity(key: string) {
  selectedEntity.value = key
  treeLoading.value = true
  try {
    const project = props.project
    if (activeTab.value === 'character') {
      currentTree.value = await buildCharacterTree(project, key)
    } else {
      currentTree.value = await buildStageTree(project, key)
    }
  } finally {
    treeLoading.value = false
  }
}

/**
 * 构建角色的树形资产列表：外观图片为根，变体按 parentId 递归嵌套。
 */
async function buildCharacterTree(project: string, name: string): Promise<AssetItem[]> {
  const tree: AssetItem[] = []

  const appearancePath = `assert/character/${name}/appearance.jpg`
  if (!props.exclude.includes(appearancePath)) {
    tree.push({
      path: appearancePath,
      label: `${name}/外观`,
      thumbnail: `/api/fs/${project}/${appearancePath}?t=${ts()}`,
      depth: 0,
    })
  }

  try {
    const { variants } = await listCharacterVariants(project, name)
    tree.push(...flattenVariantTree(variants, project, undefined, 1))
  } catch {
    // 单个角色加载失败不影响
  }

  return tree
}

/**
 * 构建场景的树形资产列表：每个子场景为一棵子树，变体递归嵌套。
 */
async function buildStageTree(project: string, stage: string): Promise<AssetItem[]> {
  const tree: AssetItem[] = []
  const labels = await listStageLabels(project, stage)

  for (const label of labels) {
    const stagePath = `assert/stage/${stage}/${label}.jpg`
    if (!props.exclude.includes(stagePath)) {
      tree.push({
        path: stagePath,
        label: `${stage}/${label}`,
        thumbnail: `/api/fs/${project}/${stagePath}?t=${ts()}`,
        depth: 0,
      })
    }

    try {
      const { variants } = await listStageVariants(project, stage, label)
      tree.push(...flattenVariantTree(variants, project, undefined, 1))
    } catch {
      // 单个子场景加载失败不影响
    }
  }

  return tree
}

/**
 * 列出 prompt/stage/{stage}/ 下作为场景标签的 .md 文件（排除 overview.md）。
 */
async function listStageLabels(project: string, stage: string): Promise<string[]> {
  try {
    const res = await readFs(project, `prompt/stage/${stage}`) as DirResponse
    const entries = res.entries ?? []
    return entries
      .filter((e: DirEntry) => e.type === 'file' && e.name.endsWith('.md') && e.name !== 'overview.md')
      .map((e: DirEntry) => e.name.replace(/\.md$/, ''))
  } catch {
    return []
  }
}

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
 * 加载「自定义资产」标签数据（平铺网格）。
 */
async function loadCustomTabInternal() {
  tabLoading.value = true
  tabItems.value = []
  try {
    const project = props.project
    const imagePaths = await listImageFilesRecursive(project, 'assert/custom/')
    for (const p of imagePaths) {
      if (props.exclude.includes(p)) continue
      const relPath = p.replace(/^assert\/custom\//, '')
      tabItems.value.push({
        path: p,
        label: relPath,
        thumbnail: `/api/fs/${project}/${p}?t=${ts()}`,
        depth: 0,
      })
    }
  } finally {
    tabLoading.value = false
  }
}

/** 切换标签页时加载数据，并自动展开第一个实体 */
async function onTabChange() {
  if (activeTab.value === 'custom') {
    await loadCustomTabInternal()
  } else {
    tabLoading.value = true
    try {
      await loadEntityList()
      // 自动选中左侧第一个实体，直接展示其资产树
      if (entityList.value.length > 0 && !selectedEntity.value) {
        selectedEntity.value = entityList.value[0].key
        await selectEntity(selectedEntity.value)
      }
    } finally {
      tabLoading.value = false
    }
  }
}

// ── 生命周期 ───────────────────────────────────────────

/** 当 visibleTabs 变化时，确保 activeTab 处于可见范围 */
watch(visibleTabs, (tabs) => {
  if (!parentMode.value && tabs.length > 0 && !tabs.includes(activeTab.value)) {
    activeTab.value = tabs[0]
  }
})

/** 对话框打开时重置状态并加载数据 */
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      if (parentMode.value) {
        void loadParentVariants()
      } else {
        // 确保 activeTab 是可见页签
        if (!visibleTabs.value.includes(activeTab.value)) {
          activeTab.value = visibleTabs.value[0] || 'character'
        }
        // 从 props.selected 初始化已选列表
        localSelected.value = props.selected.map((path) => ({
          path,
          label: getPathLabel(path),
          thumbnail: `/api/fs/${props.project}/${path}?t=${ts()}`,
          depth: 0,
        }))
        selectedEntity.value = ''
        void onTabChange()
      }
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

.entity-item {
  cursor: pointer;
  border-radius: 4px;
}

.entity-item:hover {
  background: rgba(var(--v-theme-primary), 0.06);
}

.entity-item--active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
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
</style>
