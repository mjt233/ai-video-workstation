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
            class="text-body-2"
          >
            <div class="font-weight-medium mb-1">
              引用位置：
            </div>
            <ul class="pl-4">
              <li
                v-for="(refItem, i) in errorDialog.refs"
                :key="i"
              >
                第{{ refItem.episode }}集 分镜{{ refItem.shot }} {{ refItem.file }}
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
  | 'root-scene'
  | 'episode'
  | 'shot'

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
  defaults: {} as Partial<{ name: string; stage: string; episode: string }>,
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
  return 'primary'
}

function canCreate(item: TreeItem): boolean {
  return ['root-character', 'root-stage', 'stage', 'root-scene', 'episode'].includes(item.kind)
}

function canDelete(item: TreeItem): boolean {
  return ['character', 'stage', 'subscene', 'episode', 'shot'].includes(item.kind)
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
  const [characters, stages, episodes] = await Promise.all([
    safeDir('prompt/character/'),
    safeDir('prompt/stage/'),
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
      name: '集数分镜',
      path: 'root-scene',
      icon: 'mdi-filmstrip',
      kind: 'root-scene',
      children: episodeItems,
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
  const episode = route.query.episode as string | undefined
  const shot = route.query.shot as string | undefined

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

  if (item.kind === 'shot') {
    patchQuery({
      type: 'scene',
      name: undefined,
      subscene: undefined,
      episode: item.episode,
      shot: item.shot,
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
  } else if (item.kind === 'root-scene') {
    createDialog.type = 'episode'
    createDialog.defaults = {}
  } else if (item.kind === 'episode') {
    createDialog.type = 'shot'
    createDialog.defaults = { episode: item.episode }
  } else {
    return
  }
  createDialog.show = true
}

async function openDelete(item: TreeItem) {
  let label = item.name
  if (item.kind === 'subscene') {
    label = `${item.stageName}/${item.label}`
  } else if (item.kind === 'shot') {
    label = `第${item.episode}集 分镜${item.shot}`
  } else if (item.kind === 'episode') {
    label = `第${item.episode}集`
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
  } else if (payload.type === 'shot' && payload.episode && payload.shot) {
    applyShotRenames(payload.renames)
    patchQuery({
      type: 'scene',
      name: undefined,
      subscene: undefined,
      episode: payload.episode,
      shot: payload.shot,
    })
  }
}

function clearSelectionIfDeleted(item: TreeItem) {
  const q = router.currentRoute.value.query
  const type = q.type as string | undefined
  const name = q.name as string | undefined
  const subscene = q.subscene as string | undefined
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
  if (item.kind === 'episode' && episode === item.episode) {
    patchQuery({ type: undefined, name: undefined, subscene: undefined, episode: undefined, shot: undefined })
    return
  }
  if (item.kind === 'shot' && type === 'scene' && episode === item.episode && shot === item.shot) {
    patchQuery({ type: undefined, name: undefined, subscene: undefined, episode: undefined, shot: undefined })
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
    } else if (item.kind === 'episode') {
      await deleteEpisode(props.project, item.episode!)
    } else if (item.kind === 'shot') {
      const r = await deleteShot(props.project, item.episode!, item.shot!)
      renames = r.renames
    }

    clearSelectionIfDeleted(item)
    if (renames?.length) {
      const q = router.currentRoute.value.query
      if (q.type === 'scene' && q.episode === item.episode) {
        applyShotRenames(renames)
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
    route.query.episode,
    route.query.shot,
  ],
  () => {
    if (!treeItems.value.length) return
    syncTreeSelectionFromRoute()
  },
)
</script>
