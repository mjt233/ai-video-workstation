<template>
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
        class="entity-item pa-2 text-body-small cursor-pointer"
        :class="{
          'entity-item--active': selectedEntity === ent.key,
          'entity-item--category': ent.category,
        }"
        :style="{ paddingLeft: `${8 + (ent.depth ?? 0) * 12}px` }"
        @click="!ent.category && selectEntity(ent.key)"
      >
        <v-icon
          v-if="ent.category"
          icon="mdi-folder-outline"
          size="x-small"
          class="mr-1"
        />
        {{ ent.name }}
      </div>
      <div
        v-if="!entityList.length"
        class="text-grey text-body-small pa-2 text-center"
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
        class="text-grey text-body-small pa-4 text-center"
      >
        请从左侧选择
      </div>
      <div
        v-else-if="!currentTree.length"
        class="text-grey text-body-small pa-4 text-center"
      >
        该{{ kind === 'character' ? '角色' : '场景' }}暂无可用资产
      </div>
      <template v-else>
        <template
          v-for="item in currentTree"
          :key="item.header ? `header-${item.section}` : item.path"
        >
          <!-- 分区标题：单独换行显示 -->
          <div
            v-if="item.header"
            class="tree-section-header"
          >
            <v-icon
              icon="mdi-folder-star-outline"
              size="small"
              class="mr-1"
            />
            {{ item.section }}
          </div>
          <!-- 音频条目：整行音频图标 + 标签 -->
          <div
            v-else-if="item.audio"
            class="audio-tree-item d-flex align-center ga-2 px-2 py-1 rounded cursor-pointer ma-1"
            :class="{ 'asset-tree-item--selected': isSelected(item.path) }"
            :title="item.label"
            @click="$emit('select', item)"
          >
            <v-icon
              color="secondary"
              size="20"
            >
              mdi-music-note
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
            v-else
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
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { existsFs, readFs, type DirEntry, type DirResponse } from '../../api/client'
import {
  getCharacterCategories,
  listCharacterVariants,
  listCharacterVoiceVariants,
  listStageVariants,
  type CharacterCategoryNode,
} from '../../api/assets'
import { flattenVariantTree, listAudioFilesRecursive, listImageFilesRecursive, thumbUrl } from './utils'
import AssetThumb from './AssetThumb.vue'
import type { AssetItem, EntityItem } from './types'

/**
 * 角色/场景页签：左右分栏资产树。
 *
 * 左侧列出实体（角色名/场景名），右侧以树形展示该实体的资产及变体，
 * 并附「自定义资产」分区。点击资产条目 emit select 事件交由父组件处理选中。
 * 当 showVoice 为 true（音频选择场景）时，角色树额外展示「音色」分区
 * （角色设计音色 voice.flac 与自定义音频）。
 */
const props = defineProps<{
  /** 项目名 */
  project: string
  /** 实体类型：角色或场景 */
  kind: 'character' | 'stage'
  /** 需要排除的资产路径（不展示） */
  exclude: string[]
  /** 当前已选中的资产路径列表（用于高亮） */
  selectedPaths: string[]
  /** 弹窗是否打开（仅在打开时加载） */
  active: boolean
  /** 弹窗打开时递增的重新加载信号 */
  reloadKey: number
  /** 是否为音频选择场景：为 true 时角色树额外展示「音色」分区（默认 false） */
  showVoice?: boolean
}>()

defineEmits<{
  /** 点击资产条目，携带该条目 */
  select: [item: AssetItem]
}>()

/** 右侧树加载中标记 */
const treeLoading = ref(false)
/** 左侧实体列表 */
const entityList = ref<EntityItem[]>([])
/** 当前选中的实体键 */
const selectedEntity = ref('')
/** 当前实体的树形资产列表 */
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

/**
 * 根据当前页签加载左侧实体列表。
 * 角色页签按自定义多层分类分组展示（分类节点仅分组不可选，角色条目可选中）；
 * 场景页签保持原有平铺。
 */
async function loadEntityList() {
  selectedEntity.value = ''
  currentTree.value = []
  const project = props.project
  const prefix = props.kind === 'character' ? 'prompt/character/' : 'prompt/stage/'
  try {
    const res = await readFs(project, prefix) as DirResponse
    const dirs = (res.entries ?? [])
      .filter((e: DirEntry) => e.type === 'dir')
      .map((e: DirEntry) => ({ key: e.name, name: e.name }))
    if (props.kind === 'character') {
      entityList.value = await buildGroupedCharacterList(project, dirs)
    } else {
      entityList.value = dirs
    }
  } catch {
    entityList.value = []
  }
}

/** 分类路径内部分隔符（仅用于 join/比较，不落盘） */
const CAT_SEP = '\u0001'

/**
 * 构建角色页签的分组实体列表：分类树平铺（全展开）+ 各分类下的角色。
 *
 * 分类节点 category=true 不可选中，仅作分组展示（与资产浏览器主树保持一致）；
 * 未分类角色平铺在根级。分类元数据读取失败时按未分类平铺（不影响选择功能）。
 *
 * @param project 项目名
 * @param dirs prompt/character/ 下的角色目录
 * @returns 带缩进的分组实体列表
 */
async function buildGroupedCharacterList(
  project: string,
  dirs: { key: string; name: string }[],
): Promise<EntityItem[]> {
  let categories: CharacterCategoryNode[] = []
  let assignments: Record<string, string[]> = {}
  try {
    const meta = await getCharacterCategories(project)
    categories = meta.categories
    assignments = meta.assignments
  } catch (err) {
    console.error('读取角色分类失败，按未分类平铺展示：', err)
  }

  const byPath = new Map<string, { key: string; name: string }[]>()
  const uncategorized: { key: string; name: string }[] = []
  for (const d of dirs) {
    const catPath = assignments[d.key] ?? []
    if (catPath.length) {
      const key = catPath.join(CAT_SEP)
      const list = byPath.get(key) ?? []
      list.push(d)
      byPath.set(key, list)
    } else {
      uncategorized.push(d)
    }
  }

  const result: EntityItem[] = []
  const walk = (nodes: CharacterCategoryNode[], parentPath: string[], depth: number) => {
    for (const node of nodes) {
      const catPath = [...parentPath, node.name]
      result.push({ key: `cat:${catPath.join(CAT_SEP)}`, name: node.name, depth, category: true })
      walk(node.children, catPath, depth + 1)
      for (const d of byPath.get(catPath.join(CAT_SEP)) ?? []) {
        result.push({ key: d.key, name: d.name, depth: depth + 1 })
      }
    }
  }
  walk(categories, [], 0)
  for (const d of uncategorized) {
    result.push({ key: d.key, name: d.name, depth: 0 })
  }
  return result
}

/**
 * 选中左侧实体后，构建右侧树形资产列表。
 *
 * @param key 实体键（角色名/场景名）
 */
async function selectEntity(key: string) {
  selectedEntity.value = key
  treeLoading.value = true
  try {
    const project = props.project
    if (props.kind === 'character') {
      currentTree.value = await buildCharacterTree(project, key)
    } else {
      currentTree.value = await buildStageTree(project, key)
    }
  } finally {
    treeLoading.value = false
  }
}

/**
 * 构建角色的树形资产列表：外观图片为根，变体按 parentId 递归嵌套，
 * 自定义资产（assert/custom/character/{name}/）单独分区显示。
 * showVoice 为 true 时额外展示「音色」分区（角色设计音色 + 自定义音频）。
 *
 * @param project 项目名
 * @param name 角色名
 * @returns 树形条目数组
 */
async function buildCharacterTree(project: string, name: string): Promise<AssetItem[]> {
  const tree: AssetItem[] = []

  const appearancePath = `assert/character/${name}/appearance.jpg`
  if (!props.exclude.includes(appearancePath)) {
    tree.push({
      path: appearancePath,
      label: `${name}/外观`,
      thumbnail: thumbUrl(project, appearancePath),
      depth: 0,
    })
  }

  try {
    const { variants } = await listCharacterVariants(project, name)
    tree.push(...flattenVariantTree(variants, project, props.exclude, undefined, 1))
  } catch {
    // 单个角色加载失败不影响
  }

  // 音色分区：仅在选择音频（showVoice）时展示角色的音色资产
  if (props.showVoice) {
    tree.push(...(await buildVoiceSection(project, name)))
  }

  // 自定义资产分区：在普通资产与衍生变体之下单独换行显示
  tree.push(...(await buildCustomSection(project, `assert/custom/character/${name}`, props.showVoice)))

  return tree
}

/**
 * 构建角色的「音色」分区条目：角色设计音色（assert/character/{name}/voice.flac）
 * 与声音变体音频（assert/character/{name}/voice-variants/{id}.flac）。
 * 仅在该文件已生成且未被排除时返回分区标题 + 音频条目，否则返回空数组。
 *
 * @param project 项目名
 * @param name 角色名
 * @returns 音色分区标题与音频条目数组
 */
async function buildVoiceSection(project: string, name: string): Promise<AssetItem[]> {
  const items: AssetItem[] = []

  // 角色设计音色（基础）
  const voicePath = `assert/character/${name}/voice.flac`
  const voiceExists = !props.exclude.includes(voicePath) && (await existsFs(project, voicePath))
  if (voiceExists) {
    items.push({ path: voicePath, label: `${name}/音色`, thumbnail: '', depth: 1, audio: true })
  }

  // 声音变体（单层）：仅列出已生成音频的变体
  try {
    const { variants } = await listCharacterVoiceVariants(project, name)
    for (const v of variants) {
      if (!v.hasAudio || props.exclude.includes(v.audioPath)) continue
      items.push({
        path: v.audioPath,
        label: `${name}/音色/${v.id}`,
        thumbnail: '',
        depth: 1,
        audio: true,
      })
    }
  } catch {
    // 单个角色加载失败不影响
  }

  if (!items.length) return []
  return [
    {
      path: '',
      label: '',
      thumbnail: '',
      depth: 0,
      section: '音色',
      header: true,
    },
    ...items,
  ]
}

/**
 * 构建场景的树形资产列表：每个子场景为一棵子树，变体递归嵌套，
 * 自定义资产（assert/custom/stage/{stage}/）单独分区显示。
 *
 * @param project 项目名
 * @param stage 场景名
 * @returns 树形条目数组
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
        thumbnail: thumbUrl(project, stagePath),
        depth: 0,
      })
    }

    try {
      const { variants } = await listStageVariants(project, stage, label)
      tree.push(...flattenVariantTree(variants, project, props.exclude, undefined, 1))
    } catch {
      // 单个子场景加载失败不影响
    }
  }

  // 自定义资产分区：在普通资产与衍生变体之下单独换行显示
  tree.push(...(await buildCustomSection(project, `assert/custom/stage/${stage}`)))

  return tree
}

/**
 * 构建自定义资产分区条目。
 * 仅在目录存在且包含图片（或 includeAudio 时含音频）时返回分区标题 + 资产条目，否则返回空数组。
 *
 * @param project 项目名
 * @param customRootDir assert/custom/ 下的实体映射目录（如 assert/custom/character/陈书文）
 * @param includeAudio 是否同时列出音频文件（音频条目标记 audio=true，默认 false）
 * @returns 分区标题与资产条目数组
 */
async function buildCustomSection(project: string, customRootDir: string, includeAudio = false): Promise<AssetItem[]> {
  const items: AssetItem[] = []
  const imagePaths = await listImageFilesRecursive(project, customRootDir)
  const audioPaths = includeAudio ? await listAudioFilesRecursive(project, customRootDir) : []
  const visibleImages = imagePaths.filter((p) => !props.exclude.includes(p))
  const visibleAudio = audioPaths.filter((p) => !props.exclude.includes(p))
  if (!visibleImages.length && !visibleAudio.length) return items

  // 分区标题（不可选择，单独换行）
  items.push({
    path: '',
    label: '',
    thumbnail: '',
    depth: 0,
    section: '自定义资产',
    header: true,
  })
  for (const p of visibleImages) {
    items.push({
      path: p,
      label: `自定义/${p.replace(/^assert\/custom\//, '')}`,
      thumbnail: thumbUrl(project, p),
      depth: 1,
    })
  }
  for (const p of visibleAudio) {
    items.push({
      path: p,
      label: `自定义/${p.replace(/^assert\/custom\//, '')}`,
      thumbnail: '',
      depth: 1,
      audio: true,
    })
  }
  return items
}

/**
 * 列出 prompt/stage/{stage}/ 下作为场景标签的 .md 文件（排除 overview.md）。
 *
 * @param project 项目名
 * @param stage 场景名
 * @returns 子场景标签名列表
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
 * 弹窗打开、reloadKey 变化、kind 切换（角色/场景页签互切）或 showVoice
 * 变化（音频/图片选择场景互切）时加载，并自动选中第一个实体。
 */
watch(
  () => [props.active, props.reloadKey, props.kind, props.showVoice] as const,
  async () => {
    if (!props.active) return
    await loadEntityList()
    // 自动选中左侧第一个实体，直接展示其资产树
    if (entityList.value.length > 0 && !selectedEntity.value) {
      selectedEntity.value = entityList.value[0].key
      await selectEntity(selectedEntity.value)
    }
  },
  { immediate: true },
)
</script>

<style scoped>
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

/* 音频条目（整行显示：音频图标 + 标签 + 选中勾） */
.audio-tree-item {
  border-radius: 4px;
  min-width: 0;
  transition: background 0.15s ease;
}

.audio-tree-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* 分区标题：在普通资产与衍生变体之下单独换行显示 */
.tree-section-header {
  width: 100%;
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  padding: 10px 4px 6px;
  margin-top: 10px;
  border-top: 1px dashed rgba(var(--v-theme-primary), 0.35);
}
</style>
