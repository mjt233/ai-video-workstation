<template>
  <div>
    <v-treeview
      v-model:activated="activated"
      v-model:opened="opened"
      :items="treeItems"
      item-title="name"
      item-value="path"
      color="primary"
      hoverable
      open-on-click
      activatable
      density="compact"
      @update:activated="onSelect"
    >
      <template #prepend="{ item }">
        <v-icon
          :color="iconColor(item)"
          size="small"
        >
          {{ item.icon }}
        </v-icon>
      </template>
      <template #append="{ item }">
        <div class="d-flex align-center ga-0">
          <v-btn
            v-if="canCreate(item)"
            icon="mdi-plus"
            size="x-small"
            variant="text"
            color="primary"
            @click.stop="openCreate(item)"
          />
          <v-btn
            v-if="canDelete(item)"
            icon="mdi-delete"
            size="x-small"
            variant="text"
            color="error"
            @click.stop="openDelete(item)"
          />
        </div>
      </template>
    </v-treeview>

    <AssetCreateDialog
      v-model="createDialog.show"
      :project="project"
      :type="createDialog.type"
      :defaults="createDialog.defaults"
      @created="onCreated"
    />

    <v-dialog
      v-model="errorDialog.show"
      max-width="520"
    >
      <v-card>
        <v-card-title class="text-error">
          无法删除
        </v-card-title>
        <v-card-text>
          <div class="mb-2">
            {{ errorDialog.message }}
          </div>
          <div
            v-if="errorDialog.refs.length"
            class="text-body-medium"
          >
            <div class="font-weight-medium mb-1">
              引用位置：
            </div>
            <ul class="pl-4">
              <li
                v-for="(refItem, i) in errorDialog.refs"
                :key="i"
              >
                <template v-if="refItem.canvasPath">
                  {{ refItem.canvasPath.startsWith('prompt/scene') ? '分镜画布' : '场景画布' }}：{{ refItem.canvasPath }}
                  <span v-if="refItem.nodeName">（节点「{{ refItem.nodeName }}」）</span>
                </template>
                <template v-else>
                  第{{ refItem.episode }}集 分镜{{ refItem.shot }} {{ refItem.file }}
                </template>
                <span v-if="refItem.detail">（{{ refItem.detail }}）</span>
              </li>
            </ul>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            color="primary"
            variant="text"
            @click="errorDialog.show = false"
          >
            知道了
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { readFs, type DirResponse } from '../api/client'
import {
  AssetApiError,
  deleteCharacter,
  deleteEpisode,
  deleteProp,
  deletePropCategory,
  deleteScriptEpisode,
  deleteShot,
  deleteStage,
  deleteSubscene,
  type AssetRef,
  type RenamePair,
} from '../api/assets'
import AssetCreateDialog, { type CreateAssetType } from './AssetCreateDialog.vue'
import { confirm } from '../utils/confirm'

type TreeKind =
  | 'project-info'
  | 'root-character'
  | 'character'
  | 'root-stage'
  | 'stage'
  | 'subscene'
  | 'root-prop'
  | 'prop-category'
  | 'prop'
  | 'root-scene'
  | 'episode'
  | 'shot'
  | 'root-script'
  | 'script-outline'
  | 'script-episodes'
  | 'script-episode'
  | 'root-custom'

interface TreeItem {
  name: string
  path: string
  icon: string
  type?: string
  kind: TreeKind
  episode?: string
  shot?: string
  stageName?: string
  label?: string
  /** 道具分类名（道具节点所属分类） */
  category?: string
  children?: TreeItem[]
}

const props = defineProps<{ project: string }>()
const emit = defineEmits<{ refresh: [] }>()
const route = useRoute()
const router = useRouter()

const treeItems = ref<TreeItem[]>([])
const activated = ref<string[]>([])
const opened = ref<string[]>([])
const deleting = ref(false)

const createDialog = reactive({
  show: false,
  type: 'character' as CreateAssetType,
  defaults: {} as Partial<{ name: string; stage: string; category: string; episode: string }>,
})

const errorDialog = reactive({
  show: false,
  message: '',
  refs: [] as AssetRef[],
})

function sortByNameZh<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

function sortNumericNames(names: string[]): string[] {
  return [...names].sort((a, b) => Number(a) - Number(b))
}

function iconColor(item: TreeItem): string {
  if (item.kind === 'project-info') {
    return 'deep-purple'
  }
  if (item.type === 'character' || item.kind === 'character' || item.kind === 'root-character') {
    return 'amber-darken-1'
  }
  if (item.type === 'stage' || item.kind === 'stage' || item.kind === 'subscene' || item.kind === 'root-stage') {
    return 'green-darken-1'
  }
  if (item.kind === 'root-prop' || item.kind === 'prop-category' || item.kind === 'prop') {
    return 'orange-darken-2'
  }
  if (item.kind === 'root-custom') {
    return 'cyan-darken-1'
  }
  if (item.kind === 'root-script' || item.kind === 'script-outline' || item.kind === 'script-episodes' || item.kind === 'script-episode') {
    return 'indigo'
  }
  return 'primary'
}

function canCreate(item: TreeItem): boolean {
  return ['root-character', 'root-stage', 'root-prop', 'prop-category', 'root-scene', 'episode', 'script-episodes'].includes(item.kind)
}

function canDelete(item: TreeItem): boolean {
  return ['character', 'stage', 'subscene', 'prop-category', 'prop', 'episode', 'shot', 'script-episode'].includes(item.kind)
}

interface DirEntrySafe {
  name: string
  type: 'file' | 'dir'
}

async function safeDir(path: string): Promise<DirEntrySafe[]> {
  try {
    const res = await readFs(props.project, path) as DirResponse
    return res.entries ?? []
  } catch {
    return []
  }
}

async function buildTree() {
  const [characters, stages, props, episodes] = await Promise.all([
    safeDir('prompt/character/'),
    safeDir('prompt/stage/'),
    safeDir('prompt/prop/'),
    safeDir('prompt/scene/'),
  ])

  const charDirs = sortByNameZh(
    characters.filter(c => c.type === 'dir').map(c => ({ name: c.name })),
  )
  const charItems: TreeItem[] = charDirs.map(c => ({
    name: c.name,
    path: `character-${c.name}`,
    icon: 'mdi-account',
    type: 'character',
    kind: 'character',
  }))

  const stageDirs = sortByNameZh(
    stages.filter(s => s.type === 'dir').map(s => ({ name: s.name })),
  )
  const stageItems: TreeItem[] = []
  for (const s of stageDirs) {
    const files = await safeDir(`prompt/stage/${s.name}/`)
    const subscenes = sortByNameZh(
      files
        .filter(f => f.type === 'file' && f.name.endsWith('.md'))
        .map(f => ({ name: f.name.replace(/\.md$/, '') })),
    )
    stageItems.push({
      name: s.name,
      path: `stage-${s.name}`,
      icon: 'mdi-city',
      type: 'stage',
      kind: 'stage',
      stageName: s.name,
      children: subscenes.map(sub => ({
        name: sub.name,
        path: `subscene-${s.name}-${sub.name}`,
        icon: 'mdi-image-filter-hdr',
        type: 'stage',
        kind: 'subscene',
        stageName: s.name,
        label: sub.name,
      })),
    })
  }

  // 道具：一级=分类（目录），二级=道具本身
  const propDirs = sortByNameZh(
    props.filter(p => p.type === 'dir').map(p => ({ name: p.name })),
  )
  const propItems: TreeItem[] = []
  for (const cat of propDirs) {
    const propNames = await safeDir(`prompt/prop/${cat.name}/`)
    const children = sortByNameZh(
      propNames.filter(p => p.type === 'dir').map(p => ({ name: p.name })),
    ).map(p => ({
      name: p.name,
      path: `prop-${cat.name}-${p.name}`,
      icon: 'mdi-package-variant',
      type: 'prop',
      kind: 'prop' as const,
      category: cat.name,
    }))
    propItems.push({
      name: cat.name,
      path: `prop-category-${cat.name}`,
      icon: 'mdi-folder-outline',
      type: 'prop',
      kind: 'prop-category',
      category: cat.name,
      children,
    })
  }

  const episodeNames = sortNumericNames(
    episodes.filter(e => e.type === 'dir').map(e => e.name),
  )
  const episodeItems: TreeItem[] = []
  for (const ep of episodeNames) {
    const shots = await safeDir(`prompt/scene/${ep}/`)
    const shotNames = sortNumericNames(
      shots.filter(sh => sh.type === 'dir').map(sh => sh.name),
    )
    episodeItems.push({
      name: `第${ep}集`,
      path: `episode-${ep}`,
      icon: 'mdi-filmstrip',
      kind: 'episode',
      episode: ep,
      children: shotNames.map(sh => ({
        name: `分镜${sh}`,
        path: `scene-${ep}-${sh}`,
        icon: 'mdi-image-multiple',
        type: 'scene',
        kind: 'shot',
        episode: ep,
        shot: sh,
      })),
    })
  }

  // 剧本分集：prompt/script/episodes/{n}.md（数字编号 .md 文件，连续 1..N）
  const scriptFiles = await safeDir('prompt/script/episodes/')
  const scriptEpisodeNames = sortNumericNames(
    scriptFiles
      .filter(f => f.type === 'file' && /^[1-9]\d*\.md$/.test(f.name))
      .map(f => f.name.replace(/\.md$/, '')),
  )
  const scriptEpisodeItems: TreeItem[] = scriptEpisodeNames.map(n => ({
    name: `第${n}集`,
    path: `script-episode-${n}`,
    icon: 'mdi-file-document-outline',
    kind: 'script-episode',
    episode: n,
  }))

  treeItems.value = [
    {
      name: '项目信息',
      path: 'project-info',
      icon: 'mdi-information-outline',
      type: 'project',
      kind: 'project-info',
    },
    {
      name: '角色',
      path: 'root-character',
      icon: 'mdi-account-group',
      kind: 'root-character',
      children: charItems,
    },
    {
      name: '场景',
      path: 'root-stage',
      icon: 'mdi-city',
      kind: 'root-stage',
      children: stageItems,
    },
    {
      name: '道具',
      path: 'root-prop',
      icon: 'mdi-package-variant',
      kind: 'root-prop',
      children: propItems,
    },
    {
      name: '集数分镜',
      path: 'root-scene',
      icon: 'mdi-filmstrip',
      kind: 'root-scene',
      children: episodeItems,
    },
    {
      name: '剧本',
      path: 'root-script',
      icon: 'mdi-book-open-variant',
      kind: 'root-script',
      children: [
        {
          name: '大纲',
          path: 'script-outline',
          icon: 'mdi-file-document-edit-outline',
          kind: 'script-outline',
        },
        {
          name: '分集',
          path: 'script-episodes',
          icon: 'mdi-format-list-numbered',
          kind: 'script-episodes',
          children: scriptEpisodeItems,
        },
      ],
    },
    {
      name: '自定义资产',
      path: 'root-custom',
      icon: 'mdi-folder-multiple-outline',
      kind: 'root-custom',
    },
  ]
}

async function rebuildAndRefresh() {
  await buildTree()
  await nextTick()
  syncTreeSelectionFromRoute()
  emit('refresh')
}

function patchQuery(patch: Record<string, string | undefined>) {
  const query = { ...router.currentRoute.value.query }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '') {
      delete query[k]
    } else {
      query[k] = v
    }
  }
  router.push({ query })
}

function applyShotRenames(renames?: RenamePair[]) {
  if (!renames?.length) return
  const currentShot = router.currentRoute.value.query.shot as string | undefined
  if (!currentShot) return
  const pair = renames.find(r => r.from === currentShot)
  if (pair) {
    patchQuery({ shot: pair.to })
  }
}

/** 剧本分集删除重排后，按重命名映射修正当前 URL 的集数参数 */
function applyScriptEpisodeRenames(renames: RenamePair[]) {
  const current = router.currentRoute.value.query.episode as string | undefined
  if (!current) return
  const pair = renames.find(r => r.from === current)
  if (pair) {
    patchQuery({ episode: pair.to })
  }
}

function findItemByPath(items: TreeItem[], path: string): TreeItem | null {
  for (const item of items) {
    if (item.path === path) return item
    if (item.children) {
      const found = findItemByPath(item.children, path)
      if (found) return found
    }
  }
  return null
}

/** 根据当前 URL 查询参数，计算应激活的节点 path 及其祖先展开 path */
function resolveSelectionFromRoute(): { activePath: string | null; openPaths: string[] } {
  const type = route.query.type as string | undefined
  const name = route.query.name as string | undefined
  const subscene = route.query.subscene as string | undefined
  const category = route.query.category as string | undefined
  const episode = route.query.episode as string | undefined
  const shot = route.query.shot as string | undefined
  const section = route.query.section as string | undefined

  if (type === 'project') {
    return { activePath: 'project-info', openPaths: [] }
  }

  if (type === 'character' && name) {
    return {
      activePath: `character-${name}`,
      openPaths: ['root-character'],
    }
  }

  if (type === 'stage' && name) {
    if (subscene) {
      return {
        activePath: `subscene-${name}-${subscene}`,
        openPaths: ['root-stage', `stage-${name}`],
      }
    }
    return {
      activePath: `stage-${name}`,
      openPaths: ['root-stage'],
    }
  }

  if (type === 'prop' && category) {
    if (name) {
      return {
        activePath: `prop-${category}-${name}`,
        openPaths: ['root-prop', `prop-category-${category}`],
      }
    }
    return {
      activePath: `prop-category-${category}`,
      openPaths: ['root-prop'],
    }
  }

  if (type === 'scene' && episode && shot) {
    return {
      activePath: `scene-${episode}-${shot}`,
      openPaths: ['root-scene', `episode-${episode}`],
    }
  }

  if (type === 'scene' && episode) {
    return {
      activePath: `episode-${episode}`,
      openPaths: ['root-scene'],
    }
  }

  if (type === 'script') {
    if (section === 'outline') {
      return { activePath: 'script-outline', openPaths: ['root-script'] }
    }
    if (section === 'episodes' && episode) {
      return {
        activePath: `script-episode-${episode}`,
        openPaths: ['root-script', 'script-episodes'],
      }
    }
    if (section === 'episodes') {
      return { activePath: 'script-episodes', openPaths: ['root-script'] }
    }
    return { activePath: 'root-script', openPaths: [] }
  }

  if (type === 'custom') {
    return {
      activePath: 'root-custom',
      openPaths: [],
    }
  }

  return { activePath: null, openPaths: [] }
}

function syncTreeSelectionFromRoute() {
  const { activePath, openPaths } = resolveSelectionFromRoute()

  // 合并展开路径，避免用户手动展开的其它分支被强制收起
  const openSet = new Set(opened.value)
  for (const p of openPaths) openSet.add(p)
  opened.value = [...openSet]

  if (activePath && findItemByPath(treeItems.value, activePath)) {
    activated.value = [activePath]
  } else if (!activePath) {
    activated.value = []
  }
}

function onSelect(items: unknown) {
  const selected = (Array.isArray(items) ? items : items ? [items] : []) as string[]
  if (!selected.length) return
  const path = selected[0]
  if (!path) return
  const item = findItemByPath(treeItems.value, path)
  if (!item) return

  if (item.kind === 'project-info') {
    patchQuery({
      type: 'project',
      name: undefined,
      subscene: undefined,
      episode: undefined,
      shot: undefined,
    })
    return
  }

  if (item.kind === 'character') {
    patchQuery({
      type: 'character',
      name: item.name,
      subscene: undefined,
      episode: undefined,
      shot: undefined,
    })
    return
  }

  if (item.kind === 'stage') {
    // 仅选中场景父节点时不指定子场景，详情区提示从树中选择子场景
    patchQuery({
      type: 'stage',
      name: item.stageName ?? item.name,
      subscene: undefined,
      episode: undefined,
      shot: undefined,
    })
    return
  }

  if (item.kind === 'subscene') {
    patchQuery({
      type: 'stage',
      name: item.stageName,
      subscene: item.label,
      episode: undefined,
      shot: undefined,
    })
    return
  }

  if (item.kind === 'prop-category') {
    // 仅选中分类节点时不指定道具，详情区提示从树中选择道具
    patchQuery({
      type: 'prop',
      name: undefined,
      category: item.category,
      subscene: undefined,
      episode: undefined,
      shot: undefined,
    })
    return
  }

  if (item.kind === 'prop') {
    patchQuery({
      type: 'prop',
      name: item.name,
      category: item.category,
      subscene: undefined,
      episode: undefined,
      shot: undefined,
    })
    return
  }

  if (item.kind === 'shot') {
    patchQuery({
      type: 'scene',
      name: undefined,
      subscene: undefined,
      episode: item.episode,
      shot: item.shot,
    })
    return
  }

  if (item.kind === 'root-script') {
    patchQuery({
      type: 'script',
      name: undefined,
      subscene: undefined,
      section: undefined,
      episode: undefined,
      shot: undefined,
    })
    return
  }

  if (item.kind === 'script-outline') {
    patchQuery({
      type: 'script',
      name: undefined,
      subscene: undefined,
      section: 'outline',
      episode: undefined,
      shot: undefined,
    })
    return
  }

  if (item.kind === 'script-episodes') {
    patchQuery({
      type: 'script',
      name: undefined,
      subscene: undefined,
      section: 'episodes',
      episode: undefined,
      shot: undefined,
    })
    return
  }

  if (item.kind === 'script-episode') {
    patchQuery({
      type: 'script',
      name: undefined,
      subscene: undefined,
      section: 'episodes',
      episode: item.episode,
      shot: undefined,
    })
    return
  }

  if (item.kind === 'root-custom') {
    patchQuery({
      type: 'custom',
      name: undefined,
      subscene: undefined,
      episode: undefined,
      shot: undefined,
      path: undefined,
    })
  }
}

function openCreate(item: TreeItem) {
  if (item.kind === 'root-character') {
    createDialog.type = 'character'
    createDialog.defaults = {}
  } else if (item.kind === 'root-stage') {
    createDialog.type = 'stage'
    createDialog.defaults = {}
  } else if (item.kind === 'stage') {
    createDialog.type = 'subscene'
    createDialog.defaults = { stage: item.stageName ?? item.name }
  } else if (item.kind === 'root-prop') {
    createDialog.type = 'prop-category'
    createDialog.defaults = {}
  } else if (item.kind === 'prop-category') {
    createDialog.type = 'prop'
    createDialog.defaults = { category: item.category ?? '' }
  } else if (item.kind === 'root-scene') {
    createDialog.type = 'episode'
    createDialog.defaults = {}
  } else if (item.kind === 'episode') {
    createDialog.type = 'shot'
    createDialog.defaults = { episode: item.episode }
  } else if (item.kind === 'script-episodes') {
    createDialog.type = 'script-episode'
    createDialog.defaults = {}
  } else {
    return
  }
  createDialog.show = true
}

async function openDelete(item: TreeItem) {
  let label = item.name
  if (item.kind === 'subscene') {
    label = `${item.stageName}/${item.label}`
  } else if (item.kind === 'prop-category') {
    label = `道具分类「${item.name}」（含其下全部道具）`
  } else if (item.kind === 'prop') {
    label = `道具「${item.category}/${item.name}」`
  } else if (item.kind === 'shot') {
    label = `第${item.episode}集 分镜${item.shot}`
  } else if (item.kind === 'episode') {
    label = `第${item.episode}集`
  } else if (item.kind === 'script-episode') {
    label = `剧本 第${item.episode}集`
  }
  const ok = await confirm({
    title: '确认删除',
    content: `确定删除「${label}」？此操作不可撤销。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  await doDelete(item)
}

async function onCreated(payload: {
  type: CreateAssetType
  name?: string
  stage?: string
  label?: string
  category?: string
  episode?: string
  shot?: string
  renames?: RenamePair[]
}) {
  await rebuildAndRefresh()

  if (payload.type === 'character' && payload.name) {
    patchQuery({
      type: 'character',
      name: payload.name,
      subscene: undefined,
      episode: undefined,
      shot: undefined,
    })
  } else if (payload.type === 'stage' && payload.name) {
    patchQuery({
      type: 'stage',
      name: payload.name,
      subscene: undefined,
      episode: undefined,
      shot: undefined,
    })
  } else if (payload.type === 'subscene' && payload.stage && payload.label) {
    patchQuery({
      type: 'stage',
      name: payload.stage,
      subscene: payload.label,
      episode: undefined,
      shot: undefined,
    })
  } else if (payload.type === 'prop-category' && payload.name) {
    patchQuery({
      type: 'prop',
      name: undefined,
      category: payload.name,
      subscene: undefined,
      episode: undefined,
      shot: undefined,
    })
  } else if (payload.type === 'prop' && payload.category && payload.name) {
    patchQuery({
      type: 'prop',
      name: payload.name,
      category: payload.category,
      subscene: undefined,
      episode: undefined,
      shot: undefined,
    })
  } else if (payload.type === 'shot' && payload.episode && payload.shot) {
    applyShotRenames(payload.renames)
    patchQuery({
      type: 'scene',
      name: undefined,
      subscene: undefined,
      episode: payload.episode,
      shot: payload.shot,
    })
  } else if (payload.type === 'script-episode' && payload.episode) {
    patchQuery({
      type: 'script',
      name: undefined,
      subscene: undefined,
      section: 'episodes',
      episode: payload.episode,
      shot: undefined,
    })
  }
}

function clearSelectionIfDeleted(item: TreeItem) {
  const q = router.currentRoute.value.query
  const type = q.type as string | undefined
  const name = q.name as string | undefined
  const subscene = q.subscene as string | undefined
  const category = q.category as string | undefined
  const episode = q.episode as string | undefined
  const shot = q.shot as string | undefined

  if (item.kind === 'character' && type === 'character' && name === item.name) {
    patchQuery({ type: undefined, name: undefined, subscene: undefined })
    return
  }
  if (item.kind === 'stage' && type === 'stage' && name === (item.stageName ?? item.name)) {
    patchQuery({ type: undefined, name: undefined, subscene: undefined })
    return
  }
  if (item.kind === 'subscene' && type === 'stage' && name === item.stageName && subscene === item.label) {
    patchQuery({ type: 'stage', name: item.stageName, subscene: undefined })
    return
  }
  if (item.kind === 'prop-category' && type === 'prop' && category === item.category) {
    patchQuery({ type: undefined, name: undefined, category: undefined })
    return
  }
  if (item.kind === 'prop' && type === 'prop' && category === item.category && name === item.name) {
    patchQuery({ type: undefined, name: undefined, category: undefined })
    return
  }
  if (item.kind === 'episode' && episode === item.episode) {
    patchQuery({ type: undefined, name: undefined, subscene: undefined, episode: undefined, shot: undefined })
    return
  }
  if (item.kind === 'shot' && type === 'scene' && episode === item.episode && shot === item.shot) {
    patchQuery({ type: undefined, name: undefined, subscene: undefined, episode: undefined, shot: undefined })
    return
  }
  if (item.kind === 'script-episode' && type === 'script' && episode === item.episode) {
    patchQuery({ type: 'script', section: 'episodes', episode: undefined })
  }
}

async function doDelete(item: TreeItem) {
  deleting.value = true
  try {
    let renames: RenamePair[] | undefined
    if (item.kind === 'character') {
      await deleteCharacter(props.project, item.name)
    } else if (item.kind === 'stage') {
      await deleteStage(props.project, item.stageName ?? item.name)
    } else if (item.kind === 'subscene') {
      await deleteSubscene(props.project, item.stageName!, item.label!)
    } else if (item.kind === 'prop-category') {
      await deletePropCategory(props.project, item.category ?? item.name)
    } else if (item.kind === 'prop') {
      await deleteProp(props.project, item.category!, item.name)
    } else if (item.kind === 'episode') {
      await deleteEpisode(props.project, item.episode!)
    } else if (item.kind === 'shot') {
      const r = await deleteShot(props.project, item.episode!, item.shot!)
      renames = r.renames
    } else if (item.kind === 'script-episode') {
      const r = await deleteScriptEpisode(props.project, item.episode!)
      renames = r.renames
    }

    clearSelectionIfDeleted(item)
    if (renames?.length) {
      const q = router.currentRoute.value.query
      if (q.type === 'scene' && q.episode === item.episode) {
        applyShotRenames(renames)
      }
      if (q.type === 'script' && q.section === 'episodes') {
        applyScriptEpisodeRenames(renames)
      }
    }
    await rebuildAndRefresh()
  } catch (e) {
    if (e instanceof AssetApiError && e.code === 'IN_USE') {
      errorDialog.message = e.message || '资源正在被引用，无法删除'
      errorDialog.refs = e.refs ?? []
      errorDialog.show = true
    } else {
      errorDialog.message = e instanceof AssetApiError ? e.message : '删除失败'
      errorDialog.refs = []
      errorDialog.show = true
    }
  } finally {
    deleting.value = false
  }
}

watch(() => props.project, async () => {
  await buildTree()
  await nextTick()
  syncTreeSelectionFromRoute()
}, { immediate: true })

// URL 变化时（刷新、前进后退、详情内跳转）同步树的展开与高亮
watch(
  () => [
    route.query.type,
    route.query.name,
    route.query.subscene,
    route.query.category,
    route.query.section,
    route.query.episode,
    route.query.shot,
  ],
  () => {
    if (!treeItems.value.length) return
    syncTreeSelectionFromRoute()
  },
)
</script>
