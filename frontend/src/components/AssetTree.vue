<template>
  <div>
    <!-- 资产树：自定义行渲染（支持 HTML5 拖拽调整角色分类层级） -->
    <div class="asset-tree">
      <template
        v-for="row in flatRows"
        :key="row.item.path"
      >
        <div
          class="tree-row"
          :class="{
            'tree-row--active': activated.includes(row.item.path),
            'tree-row--drop-target': dropTargetPath === row.item.path,
            'tree-row--dragging': dragItem?.path === row.item.path,
          }"
          :style="{ paddingLeft: `${10 + row.depth * 18}px` }"
          :draggable="isDraggable(row.item)"
          @click="onRowClick(row.item)"
          @dragstart="onDragStart($event, row.item)"
          @dragover="onDragOver($event, row.item)"
          @dragleave="onDragLeave($event, row.item)"
          @drop="onDrop($event, row.item)"
          @dragend="onDragEnd"
        >
          <v-btn
            v-if="row.item.children?.length"
            :icon="opened.includes(row.item.path) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
            size="x-small"
            variant="text"
            density="comfortable"
            class="tree-row__toggle"
            @click.stop="toggle(row.item)"
          />
          <span
            v-else
            class="tree-row__toggle"
          />

          <v-icon
            :color="iconColor(row.item)"
            size="small"
          >
            {{ row.item.icon }}
          </v-icon>

          <span class="tree-row__title">{{ row.item.name }}</span>

          <v-spacer />

          <div class="tree-row__actions">
            <!-- 角色根：新建角色 / 新建一级分类 -->
            <template v-if="row.item.kind === 'root-character'">
              <v-btn
                icon="mdi-plus"
                title="新建角色"
                size="x-small"
                variant="text"
                color="primary"
                @click.stop="openCreate(row.item)"
              />
              <v-btn
                icon="mdi-folder-plus-outline"
                title="新建一级分类"
                size="x-small"
                variant="text"
                color="primary"
                @click.stop="openCreateCategory(row.item)"
              />
            </template>

            <!-- 角色分类：新建角色 / 新建子分类 / 重命名 / 删除 -->
            <template v-else-if="row.item.kind === 'character-category'">
              <v-btn
                icon="mdi-account-plus-outline"
                title="在分类下新建角色"
                size="x-small"
                variant="text"
                color="primary"
                @click.stop="openCreate(row.item)"
              />
              <v-btn
                icon="mdi-folder-plus-outline"
                title="新建子分类"
                size="x-small"
                variant="text"
                color="primary"
                @click.stop="openCreateCategory(row.item)"
              />
              <v-btn
                icon="mdi-pencil-outline"
                title="重命名分类"
                size="x-small"
                variant="text"
                @click.stop="openRenameCategory(row.item)"
              />
              <v-btn
                icon="mdi-delete-outline"
                title="删除分类"
                size="x-small"
                variant="text"
                color="error"
                @click.stop="openDeleteCategory(row.item)"
              />
            </template>

            <!-- 角色 -->
            <template v-else-if="row.item.kind === 'character'">
              <v-btn
                icon="mdi-delete-outline"
                title="删除角色"
                size="x-small"
                variant="text"
                color="error"
                @click.stop="openDelete(row.item)"
              />
            </template>

            <!-- 场景根 / 场景 / 子场景 -->
            <template v-else-if="row.item.kind === 'root-stage'">
              <v-btn
                icon="mdi-plus"
                title="新建场景"
                size="x-small"
                variant="text"
                color="primary"
                @click.stop="openCreate(row.item)"
              />
            </template>
            <template v-else-if="row.item.kind === 'stage'">
              <v-btn
                icon="mdi-plus"
                title="新建子场景"
                size="x-small"
                variant="text"
                color="primary"
                @click.stop="openCreate(row.item)"
              />
              <v-btn
                icon="mdi-delete-outline"
                title="删除场景"
                size="x-small"
                variant="text"
                color="error"
                @click.stop="openDelete(row.item)"
              />
            </template>
            <template v-else-if="row.item.kind === 'subscene'">
              <v-btn
                icon="mdi-delete-outline"
                title="删除子场景"
                size="x-small"
                variant="text"
                color="error"
                @click.stop="openDelete(row.item)"
              />
            </template>

            <!-- 道具根 / 分类 / 道具 -->
            <template v-else-if="row.item.kind === 'root-prop'">
              <v-btn
                icon="mdi-plus"
                title="新建道具分类"
                size="x-small"
                variant="text"
                color="primary"
                @click.stop="openCreate(row.item)"
              />
            </template>
            <template v-else-if="row.item.kind === 'prop-category'">
              <v-btn
                icon="mdi-plus"
                title="新建道具"
                size="x-small"
                variant="text"
                color="primary"
                @click.stop="openCreate(row.item)"
              />
              <v-btn
                icon="mdi-delete-outline"
                title="删除道具分类"
                size="x-small"
                variant="text"
                color="error"
                @click.stop="openDelete(row.item)"
              />
            </template>
            <template v-else-if="row.item.kind === 'prop'">
              <v-btn
                icon="mdi-delete-outline"
                title="删除道具"
                size="x-small"
                variant="text"
                color="error"
                @click.stop="openDelete(row.item)"
              />
            </template>

            <!-- 集数分镜根 / 集数 / 分镜 -->
            <template v-else-if="row.item.kind === 'root-scene'">
              <v-btn
                icon="mdi-plus"
                title="新建集数"
                size="x-small"
                variant="text"
                color="primary"
                @click.stop="openCreate(row.item)"
              />
            </template>
            <template v-else-if="row.item.kind === 'episode'">
              <v-btn
                icon="mdi-plus"
                title="新建分镜"
                size="x-small"
                variant="text"
                color="primary"
                @click.stop="openCreate(row.item)"
              />
              <v-btn
                icon="mdi-pencil-outline"
                title="编辑集数别名"
                size="x-small"
                variant="text"
                @click.stop="openAlias(row.item)"
              />
              <v-btn
                icon="mdi-delete-outline"
                title="删除集数"
                size="x-small"
                variant="text"
                color="error"
                @click.stop="openDelete(row.item)"
              />
            </template>
            <template v-else-if="row.item.kind === 'shot'">
              <v-btn
                icon="mdi-pencil-outline"
                title="编辑分镜别名"
                size="x-small"
                variant="text"
                @click.stop="openAlias(row.item)"
              />
              <v-btn
                icon="mdi-delete-outline"
                title="删除分镜"
                size="x-small"
                variant="text"
                color="error"
                @click.stop="openDelete(row.item)"
              />
            </template>

            <!-- 剧本 -->
            <template v-else-if="row.item.kind === 'script-episodes'">
              <v-btn
                icon="mdi-plus"
                title="新建剧本分集"
                size="x-small"
                variant="text"
                color="primary"
                @click.stop="openCreate(row.item)"
              />
            </template>
            <template v-else-if="row.item.kind === 'script-episode'">
              <v-btn
                icon="mdi-delete-outline"
                title="删除剧本分集"
                size="x-small"
                variant="text"
                color="error"
                @click.stop="openDelete(row.item)"
              />
            </template>
          </div>
        </div>
      </template>
    </div>

    <AssetCreateDialog
      v-model="createDialog.show"
      :project="project"
      :type="createDialog.type"
      :mode="createDialog.mode"
      :move-source="createDialog.moveSource"
      :meta="meta"
      :shots-by-episode="shotsByEpisode"
      :defaults="createDialog.defaults"
      @created="onCreated"
    />

    <!-- 集数/分镜别名编辑 -->
    <v-dialog
      v-model="aliasDialog.show"
      max-width="420"
    >
      <v-card>
        <v-card-title>编辑别名</v-card-title>
        <v-card-text>
          <div class="text-body-medium mb-2">
            对象：{{ aliasDialog.label }}
          </div>
          <v-alert
            v-if="aliasDialog.error"
            type="error"
            density="compact"
            class="mb-3"
          >
            {{ aliasDialog.error }}
          </v-alert>
          <AliasFormFields
            :alias="aliasDialog.value"
            :show-prefix="aliasDialog.showPrefix"
            @update:alias="aliasDialog.value = $event"
            @update:show-prefix="aliasDialog.showPrefix = $event"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="aliasDialog.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            @click="saveAliasDialog"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 分类新建/重命名 -->
    <v-dialog
      v-model="categoryDialog.show"
      max-width="420"
    >
      <v-card>
        <v-card-title>{{ categoryDialog.mode === 'create' ? '新建分类' : '重命名分类' }}</v-card-title>
        <v-card-text>
          <div
            v-if="categoryDialog.parentLabel"
            class="text-body-medium mb-2"
          >
            父分类：{{ categoryDialog.parentLabel }}
          </div>
          <v-alert
            v-if="categoryDialog.error"
            type="error"
            density="compact"
            class="mb-3"
          >
            {{ categoryDialog.error }}
          </v-alert>
          <v-text-field
            v-model="categoryDialog.value"
            label="分类名"
            variant="outlined"
            :maxlength="50"
            @keyup.enter="saveCategoryDialog"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="categoryDialog.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            @click="saveCategoryDialog"
          >
            确定
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="errorDialog.show"
      max-width="520"
    >
      <v-card>
        <v-card-title class="text-error">
          操作失败
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
import { computed, nextTick, reactive, ref, watch } from 'vue'
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
  getBrowserMeta,
  putCharacterCategories,
  putEpisodeMeta,
  putShotMeta,
  type AssetRef,
  type BrowserMeta,
  type CharacterCategoriesMeta,
  type CharacterCategoryNode,
  type RenamePair,
} from '../api/assets'
import AssetCreateDialog, { type CreateAssetType } from './AssetCreateDialog.vue'
import AliasFormFields from './AliasFormFields.vue'
import { confirm } from '../utils/confirm'
import { epDisplay, epFull, shotDisplay, shotFull } from '../utils/aliasDisplay'

type TreeKind =
  | 'project-info'
  | 'root-character'
  | 'character'
  | 'character-category'
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
  /** 角色分类节点：从分类树根到该节点的路径 */
  charCategoryPath?: string[]
  children?: TreeItem[]
}

/** 扁平化展示行（深度用于缩进） */
interface FlatRow {
  item: TreeItem
  depth: number
}

/** 分类路径内部分隔符（仅用于 join/比较，不落盘） */
const CAT_SEP = '\u0001'

const props = defineProps<{ project: string }>()
const emit = defineEmits<{ refresh: [] }>()
const route = useRoute()
const router = useRouter()

const treeItems = ref<TreeItem[]>([])
const activated = ref<string[]>([])
const opened = ref<string[]>([])

/** 浏览器元数据（别名 + 角色分类），buildTree 时刷新 */
const meta = ref<BrowserMeta | null>(null)

const createDialog = reactive({
  show: false,
  type: 'character' as CreateAssetType,
  /** 对话框模式：create = 新增；move = 移动分镜 */
  mode: 'create' as 'create' | 'move',
  /** 移动分镜的源位置（mode=move 时有效） */
  moveSource: null as { episode: string; shot: string } | null,
  defaults: {} as Partial<{
    name: string
    stage: string
    category: string
    episode: string
    /** 新建角色后自动归入的分类路径（[] 或 undefined = 未分类） */
    characterCategory: string[]
  }>,
})

/** 集数 → 分镜选项（label 已按别名规则生成；供「插入位置」下拉展示） */
const shotsByEpisode = computed<Record<string, { shot: string; label: string }[]>>(() => {
  const map: Record<string, { shot: string; label: string }[]> = {}
  for (const item of treeItems.value) {
    if (item.kind !== 'episode' || !item.episode || !item.children) continue
    map[item.episode] = item.children
      .filter((c): c is TreeItem & { shot: string } => c.kind === 'shot' && !!c.shot)
      .map((c) => ({ shot: c.shot, label: c.name }))
  }
  return map
})

const aliasDialog = reactive({
  show: false,
  kind: 'episode' as 'episode' | 'shot',
  episode: '',
  shot: '',
  label: '',
  value: '',
  /** 是否显示编号前缀（默认勾选） */
  showPrefix: true,
  error: '',
})

const categoryDialog = reactive({
  show: false,
  mode: 'create' as 'create' | 'rename',
  /** 父分类路径（mode=create 时有效；[] = 一级分类） */
  parentPath: [] as string[],
  /** 被重命名分类的路径（mode=rename 时有效） */
  targetPath: [] as string[],
  parentLabel: '',
  value: '',
  error: '',
})

/** 当前拖拽的树节点（角色/角色分类） */
const dragItem = ref<TreeItem | null>(null)
/** 当前高亮的放置目标路径（整行级） */
const dropTargetPath = ref<string | null>(null)

const errorDialog = reactive({
  show: false,
  message: '',
  refs: [] as AssetRef[],
})

// ── 展示辅助 ──────────────────────────────────────────────────────────

/** 分类节点的树路径 id（path 全局唯一：分类名逐级编码后拼 '/'） */
function charCatId(catPath: string[]): string {
  return `charcat:${catPath.map(encodeURIComponent).join('/')}`
}

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
  if (item.type === 'character' || item.kind === 'character' || item.kind === 'root-character' || item.kind === 'character-category') {
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

/** 集数显示名（带别名）：第3集 · 觉醒；勾选隐藏编号时仅显示「觉醒」 */
function epDisplayOf(ep: string): string {
  return epDisplay(meta.value, ep)
}

/** 分镜显示名（带别名）：分镜2 · 初遇；勾选隐藏编号时仅显示「初遇」 */
function shotDisplayOf(ep: string, shot: string): string {
  return shotDisplay(meta.value, ep, shot)
}

/** 集数删除确认等提示文案：恒带编号（避免别名重复造成歧义） */
function epFullOf(ep: string): string {
  return epFull(meta.value, ep)
}

/** 分镜删除确认等提示文案：恒带编号 */
function shotFullOf(ep: string, shot: string): string {
  return shotFull(meta.value, ep, shot)
}

// ── 树构建（含分类树与别名） ──────────────────────────────────────────

interface DirEntrySafe {
  name: string
  type: 'file' | 'dir'
}

async function safeDir(path: string): Promise<DirEntrySafe[]> {
  try {
    const res = await readFs(props.project, path) as DirResponse
    return res.entries ?? []
  } catch {
    // 目录不存在/不可读：按空目录处理（与既有行为一致）
    return []
  }
}

/**
 * 由分类树递归构建角色分类树节点，并把归属于各分类路径的角色挂到对应分类下。
 * 子分类在前、角色在后；未分类角色由调用方平铺到根级。
 *
 * @param nodes 当前层分类节点
 * @param parentPath 父分类路径
 * @param assignedByPath 分类路径 → 角色节点列表
 * @returns 树节点数组
 */
function buildCategoryItems(
  nodes: CharacterCategoryNode[],
  parentPath: string[],
  assignedByPath: Map<string, TreeItem[]>,
): TreeItem[] {
  const result: TreeItem[] = []
  for (const node of nodes) {
    const catPath = [...parentPath, node.name]
    const key = catPath.join(CAT_SEP)
    const children = [
      ...buildCategoryItems(node.children, catPath, assignedByPath),
      ...(assignedByPath.get(key) ?? []),
    ]
    result.push({
      name: node.name,
      path: charCatId(catPath),
      icon: 'mdi-folder-outline',
      kind: 'character-category',
      charCategoryPath: catPath,
      children,
    })
  }
  return result
}

async function buildTree() {
  // 元数据一次请求；失败时回退空态（旧项目/服务端异常时树仍可加载，仅无别名/分类）
  let browserMeta: BrowserMeta = {
    episodes: {},
    shots: {},
    characters: { categories: [], assignments: {} },
  }
  try {
    browserMeta = await getBrowserMeta(props.project)
  } catch (err) {
    console.error('加载资产浏览器元数据失败，回退为空态：', err)
  }
  meta.value = browserMeta

  const [characters, stages, propDirs, episodes] = await Promise.all([
    safeDir('prompt/character/'),
    safeDir('prompt/stage/'),
    safeDir('prompt/prop/'),
    safeDir('prompt/scene/'),
  ])

  // 角色：按分类分组（物理目录仍为 prompt/character/{角色名}/，只有 metadata.json 记录归属）
  const charDirs = sortByNameZh(
    characters.filter(c => c.type === 'dir').map(c => ({ name: c.name })),
  )
  const assignments = browserMeta.characters.assignments
  const assignedByPath = new Map<string, TreeItem[]>()
  const uncategorizedChars: TreeItem[] = []
  for (const c of charDirs) {
    const item: TreeItem = {
      name: c.name,
      path: `character-${c.name}`,
      icon: 'mdi-account',
      type: 'character',
      kind: 'character',
    }
    const catPath = assignments[c.name] ?? []
    if (catPath.length) {
      const key = catPath.join(CAT_SEP)
      const list = assignedByPath.get(key) ?? []
      list.push(item)
      assignedByPath.set(key, list)
    } else {
      uncategorizedChars.push(item)
    }
  }
  const categoryItems = buildCategoryItems(browserMeta.characters.categories, [], assignedByPath)
  const charItems: TreeItem[] = [...categoryItems, ...uncategorizedChars]

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
  const propDirNames = sortByNameZh(
    propDirs.filter(p => p.type === 'dir').map(p => ({ name: p.name })),
  )
  const propItems: TreeItem[] = []
  for (const cat of propDirNames) {
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
      name: epDisplayOf(ep),
      path: `episode-${ep}`,
      icon: 'mdi-filmstrip',
      kind: 'episode',
      episode: ep,
      children: shotNames.map(sh => ({
        name: shotDisplayOf(ep, sh),
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

// ── 扁平渲染（展开状态 → 行列表） ────────────────────────────────────

const flatRows = computed<FlatRow[]>(() => {
  const rows: FlatRow[] = []
  const openSet = new Set(opened.value)
  const walk = (items: TreeItem[], depth: number) => {
    for (const item of items) {
      rows.push({ item, depth })
      if (item.children?.length && openSet.has(item.path)) {
        walk(item.children, depth + 1)
      }
    }
  }
  walk(treeItems.value, 0)
  return rows
})

function toggle(item: TreeItem) {
  if (!item.children?.length) return
  const index = opened.value.indexOf(item.path)
  if (index >= 0) {
    opened.value.splice(index, 1)
  } else {
    opened.value.push(item.path)
  }
}

/** 行点击：激活 + 有子节点时同时展开（与既有 open-on-click 行为一致） */
function onRowClick(item: TreeItem) {
  activated.value = [item.path]
  if (item.children?.length) toggle(item)
  onSelect(item)
}

async function rebuildAndRefresh() {
  await buildTree()
  await nextTick()
  syncTreeSelectionFromRoute()
  emit('refresh')
}

/**
 * 重新加载资产树（供父组件调用）：重建树后保持展开/激活状态
 * （路径不变的分支自然保留；重编号的分支由调用方先 remapTreePaths 平移）。
 */
async function reload(): Promise<void> {
  await buildTree()
  await nextTick()
  syncTreeSelectionFromRoute()
}

defineExpose({ reload })

// ── 分类树纯函数（结构化操作，供拖拽/增删/重命名复用） ────────────────

/**
 * 深拷贝纯 JSON 数据（分类树/归属映射）。
 * 不用 structuredClone：ref 深层响应式后的对象是 Proxy，structuredClone 无法克隆。
 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 数组前缀判断：path 是否以 prefix 开头 */
function pathStartsWith(path: string[], prefix: string[]): boolean {
  if (prefix.length > path.length) return false
  return prefix.every((seg, i) => path[i] === seg)
}

/**
 * 定位路径对应的分类节点。
 *
 * @param nodes 分类树顶层数组
 * @param path 节点路径（必须非空）
 * @returns 父级数组/索引/节点；未找到返回 null
 */
function locateNode(
  nodes: CharacterCategoryNode[],
  path: string[],
): { parent: CharacterCategoryNode[]; index: number; node: CharacterCategoryNode } | null {
  if (!path.length) return null
  let level = nodes
  for (let i = 0; i < path.length - 1; i++) {
    const found = level.find(n => n.name === path[i])
    if (!found) return null
    level = found.children
  }
  const index = level.findIndex(n => n.name === path[path.length - 1])
  if (index < 0) return null
  return { parent: level, index, node: level[index] }
}

/** 在父路径（[]=根）下追加分类节点 */
function appendCategory(nodes: CharacterCategoryNode[], parentPath: string[], node: CharacterCategoryNode): boolean {
  if (!parentPath.length) {
    nodes.push(node)
    return true
  }
  const loc = locateNode(nodes, parentPath)
  if (!loc) return false
  loc.node.children.push(node)
  return true
}

/** 删除路径对应的分类节点（返回被删除的节点；未找到返回 null） */
function removeCategory(nodes: CharacterCategoryNode[], path: string[]): CharacterCategoryNode | null {
  const loc = locateNode(nodes, path)
  if (!loc) return null
  loc.parent.splice(loc.index, 1)
  return loc.node
}

/** 重命名路径对应的分类节点（成功返回 true） */
function renameCategory(nodes: CharacterCategoryNode[], path: string[], newName: string): boolean {
  const loc = locateNode(nodes, path)
  if (!loc) return false
  loc.node.name = newName
  return true
}

/** 移动分类节点：从原路径摘下，挂到目标路径（[]=根）末尾，并同步改写归属映射 */
function moveCategory(
  metaValue: CharacterCategoriesMeta,
  dragPath: string[],
  targetPath: string[],
): CharacterCategoriesMeta | null {
  const nodes = deepClone(metaValue.categories)
  const node = removeCategory(nodes, dragPath)
  if (!node) return null
  if (!appendCategory(nodes, targetPath, node)) return null
  const newPrefix = [...targetPath, node.name]
  const assignments: Record<string, string[]> = {}
  for (const [key, p] of Object.entries(metaValue.assignments)) {
    assignments[key] = pathStartsWith(p, dragPath) ? [...newPrefix, ...p.slice(dragPath.length)] : p
  }
  return { categories: nodes, assignments }
}

/** 移动角色：设置/清除其归属分类路径（[]=未分类） */
function moveCharacter(
  metaValue: CharacterCategoriesMeta,
  name: string,
  targetPath: string[],
): CharacterCategoriesMeta {
  return {
    categories: deepClone(metaValue.categories),
    assignments: { ...metaValue.assignments, [name]: [...targetPath] },
  }
}

/** 删除分类节点：其下所有角色（含子孙分类中的）转为未分类（移除归属键） */
function deleteCategoryAndDetach(
  metaValue: CharacterCategoriesMeta,
  path: string[],
): CharacterCategoriesMeta {
  const nodes = deepClone(metaValue.categories)
  removeCategory(nodes, path)
  const assignments: Record<string, string[]> = {}
  for (const [key, p] of Object.entries(metaValue.assignments)) {
    if (!pathStartsWith(p, path)) assignments[key] = p
  }
  return { categories: nodes, assignments }
}

/** 重命名分类节点并同步改写归属映射中的路径 */
function renameCategoryAndUpdateAssignments(
  metaValue: CharacterCategoriesMeta,
  path: string[],
  newName: string,
): CharacterCategoriesMeta {
  const nodes = deepClone(metaValue.categories)
  renameCategory(nodes, path, newName)
  const assignments: Record<string, string[]> = {}
  for (const [key, p] of Object.entries(metaValue.assignments)) {
    assignments[key] = pathStartsWith(p, path) ? [...p.slice(0, -1), newName] : p
  }
  return { categories: nodes, assignments }
}

// ── 拖拽 ─────────────────────────────────────────────────────────────

/**
 * 可拖拽节点：角色/角色分类（调整分类层级）+ 分镜（拖到其他集数或本集进行移动/重排）。
 */
function isDraggable(item: TreeItem): boolean {
  return item.kind === 'character' || item.kind === 'character-category' || item.kind === 'shot'
}

/**
 * 判断拖拽项是否允许放到目标节点上：
 * - 分镜 → 目标为集数行（含本集 = 同集重排）；
 * - 角色 → 根/分类；
 * - 分类 → 根/分类（拖入自身/子孙无效）。
 */
function isValidDropTarget(drag: TreeItem, target: TreeItem): boolean {
  if (drag.kind === 'shot') return target.kind === 'episode'
  if (target.kind === 'root-character') return true
  if (target.kind !== 'character-category') return false
  if (drag.kind === 'character') return true
  // 分类不能拖入自己或自己的子孙
  const dragPath = drag.charCategoryPath ?? []
  const targetPath = target.charCategoryPath ?? []
  return !pathStartsWith(targetPath, dragPath) && !pathStartsWith(dragPath, targetPath)
}

function onDragStart(e: DragEvent, item: TreeItem) {
  if (!isDraggable(item)) return
  dragItem.value = item
  dropTargetPath.value = null
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // 部分浏览器要求 setData 才会启动拖拽
    e.dataTransfer.setData('text/plain', item.path)
  }
}

function onDragEnd() {
  dragItem.value = null
  dropTargetPath.value = null
}

function onDragOver(e: DragEvent, item: TreeItem) {
  const drag = dragItem.value
  if (!drag || !isValidDropTarget(drag, item)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropTargetPath.value = item.path
}

function onDragLeave(e: DragEvent, item: TreeItem) {
  // relatedTarget 在目标外部时清除高亮（忽略子元素触发的事件）
  const related = e.relatedTarget as Node | null
  if (related && e.currentTarget instanceof Node && e.currentTarget.contains(related)) return
  if (dropTargetPath.value === item.path) dropTargetPath.value = null
}

async function onDrop(e: DragEvent, item: TreeItem) {
  e.preventDefault()
  const drag = dragItem.value
  if (!drag) {
    onDragEnd()
    return
  }
  // 分镜拖拽：拖到集数行 → 打开「移动分镜」对话框（跨集数移动或同集重排）
  if (drag.kind === 'shot') {
    if (item.kind === 'episode') {
      openMoveShotDialog(drag, item)
    }
    onDragEnd()
    return
  }
  const current = meta.value?.characters
  if (!current) {
    onDragEnd()
    return
  }
  try {
    const targetPath = item.kind === 'root-character' ? [] : (item.charCategoryPath ?? [])
    const next = drag.kind === 'character'
      ? moveCharacter(current, drag.name ?? '', targetPath)
      : moveCategory(current, drag.charCategoryPath ?? [], targetPath)
    // 无变化（如拖回原分类）时不请求
    if (next && JSON.stringify(next) !== JSON.stringify(current)) {
      const saved = await putCharacterCategories(props.project, next)
      meta.value = { ...meta.value!, characters: saved }
      await rebuildAndRefresh()
    }
  } catch (err) {
    showError(err, '保存分类失败')
  } finally {
    onDragEnd()
  }
}

/** 打开「移动分镜」对话框（复用新增分镜表单；mode=move，目标集数固定为拖放集数） */
function openMoveShotDialog(drag: TreeItem, targetEpisode: TreeItem) {
  createDialog.mode = 'move'
  createDialog.type = 'shot'
  createDialog.moveSource = { episode: drag.episode ?? '', shot: drag.shot ?? '' }
  createDialog.defaults = { episode: targetEpisode.episode ?? '' }
  createDialog.show = true
}

// ── 别名编辑 ─────────────────────────────────────────────────────────

function openAlias(item: TreeItem) {
  const isEpisode = item.kind === 'episode'
  const episode = item.episode ?? ''
  const shot = item.shot ?? ''
  const info = isEpisode
    ? meta.value?.episodes[episode]
    : meta.value?.shots[episode]?.[shot]
  aliasDialog.kind = isEpisode ? 'episode' : 'shot'
  aliasDialog.episode = episode
  aliasDialog.shot = shot
  aliasDialog.label = isEpisode ? epDisplayOf(episode) : `${epDisplayOf(episode)} ${shotDisplayOf(episode, shot)}`
  aliasDialog.value = info?.alias ?? ''
  aliasDialog.showPrefix = info?.showPrefix ?? true
  aliasDialog.error = ''
  aliasDialog.show = true
}

async function saveAliasDialog() {
  const value = aliasDialog.value.trim()
  try {
    if (aliasDialog.kind === 'episode') {
      await putEpisodeMeta(props.project, aliasDialog.episode, {
        alias: value || null,
        showPrefix: aliasDialog.showPrefix,
      })
    } else {
      await putShotMeta(props.project, aliasDialog.episode, aliasDialog.shot, {
        alias: value || null,
        showPrefix: aliasDialog.showPrefix,
      })
    }
    aliasDialog.show = false
    await rebuildAndRefresh()
  } catch (err) {
    aliasDialog.error = err instanceof AssetApiError ? err.message : '保存别名失败'
  }
}

// ── 分类新建/重命名/删除 ─────────────────────────────────────────────

function openCreateCategory(item: TreeItem) {
  categoryDialog.mode = 'create'
  categoryDialog.parentPath = item.kind === 'root-character' ? [] : (item.charCategoryPath ?? [])
  categoryDialog.parentLabel = item.kind === 'root-character' ? '一级分类' : (item.charCategoryPath?.join(' / ') ?? '')
  categoryDialog.targetPath = []
  categoryDialog.value = ''
  categoryDialog.error = ''
  categoryDialog.show = true
}

function openRenameCategory(item: TreeItem) {
  categoryDialog.mode = 'rename'
  categoryDialog.parentPath = item.charCategoryPath?.slice(0, -1) ?? []
  categoryDialog.parentLabel = ''
  categoryDialog.targetPath = item.charCategoryPath ?? []
  categoryDialog.value = item.charCategoryPath?.length
    ? item.charCategoryPath[item.charCategoryPath.length - 1]
    : ''
  categoryDialog.error = ''
  categoryDialog.show = true
}

async function saveCategoryDialog() {
  const value = categoryDialog.value.trim()
  if (!value) {
    categoryDialog.error = '分类名不能为空'
    return
  }
  const current = meta.value?.characters
  if (!current) {
    categoryDialog.error = '角色分类数据未加载，请刷新后重试'
    return
  }
  // 同层同名先做前端提示（基于当前树，重命名需排除自身；服务端同样校验）
  if (siblingPathExists(
    current,
    categoryDialog.parentPath,
    value,
    categoryDialog.mode === 'rename' ? categoryDialog.targetPath : null,
  )) {
    categoryDialog.error = `同层已存在分类「${value}」`
    return
  }
  const next = categoryDialog.mode === 'create'
    ? createCategoryMeta(current, categoryDialog.parentPath, value)
    : renameCategoryAndUpdateAssignments(current, categoryDialog.targetPath, value)
  if (!next) {
    categoryDialog.error = '父分类不存在（数据可能已变更），请刷新后重试'
    return
  }
  try {
    const saved = await putCharacterCategories(props.project, next)
    meta.value = { ...meta.value!, characters: saved }
    // 重命名分类：把展开/激活路径中新旧分类前缀平移，重建后保持展开状态
    if (categoryDialog.mode === 'rename' && categoryDialog.targetPath.length) {
      const oldPrefix = charCatId(categoryDialog.targetPath)
      const newPrefix = charCatId([...categoryDialog.parentPath, value])
      if (oldPrefix !== newPrefix) {
        opened.value = opened.value.map((p) =>
          p.startsWith(oldPrefix) ? newPrefix + p.slice(oldPrefix.length) : p,
        )
        activated.value = activated.value.map((p) =>
          p.startsWith(oldPrefix) ? newPrefix + p.slice(oldPrefix.length) : p,
        )
      }
    }
    categoryDialog.show = false
    await rebuildAndRefresh()
  } catch (err) {
    categoryDialog.error = err instanceof AssetApiError ? err.message : '保存分类失败'
  }
}

/**
 * 创建分类：在父路径（[]=根）下追加新节点。
 *
 * @param metaValue 当前元数据
 * @param parentPath 父分类路径
 * @param name 新分类名
 * @returns 新元数据；父路径不存在返回 null
 */
function createCategoryMeta(metaValue: CharacterCategoriesMeta, parentPath: string[], name: string): CharacterCategoriesMeta | null {
  const categories = deepClone(metaValue.categories)
  if (!appendCategory(categories, parentPath, { name, children: [] })) return null
  return { categories, assignments: deepClone(metaValue.assignments) }
}

/**
 * 判断父分类路径下是否已存在同名分类。
 *
 * @param metaValue 元数据
 * @param parentPath 父分类路径（[]=根）
 * @param name 待检查的分类名
 * @param excludePath 重命名场景下排除自身的路径（其余场景传 null）
 * @returns true = 同层已存在同名
 */
function siblingPathExists(
  metaValue: CharacterCategoriesMeta,
  parentPath: string[],
  name: string,
  excludePath: string[] | null,
): boolean {
  const siblings = parentPath.length === 0
    ? metaValue.categories
    : (locateNode(metaValue.categories, parentPath)?.node.children ?? [])
  return siblings.some(n => {
    if (n.name !== name) return false
    if (!excludePath) return true
    return !(excludePath.length === parentPath.length + 1 && excludePath[excludePath.length - 1] === n.name)
  })
}

/** 统计某分类路径下（含子孙分类）的角色数量 */
function countCharactersUnder(assignments: Record<string, string[]>, path: string[]): number {
  return Object.values(assignments).filter(p => pathStartsWith(p, path)).length
}

async function openDeleteCategory(item: TreeItem) {
  const catPath = item.charCategoryPath ?? []
  const affected = countCharactersUnder(meta.value?.characters.assignments ?? {}, catPath)
  const ok = await confirm({
    title: '确认删除',
    content: `确定删除分类「${catPath.join(' / ')}」？其下全部角色（${affected} 个）将变为未分类，子分类将一并删除。此操作不可撤销。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  try {
    const current = meta.value?.characters
    if (!current) return
    const next = deleteCategoryAndDetach(current, catPath)
    const saved = await putCharacterCategories(props.project, next)
    meta.value = { ...meta.value!, characters: saved }
    await rebuildAndRefresh()
  } catch (err) {
    showError(err, '删除分类失败')
  }
}

// ── URL 同步 ─────────────────────────────────────────────────────────

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

/**
 * 按集内重编号映射修正当前 URL 的分镜号（分镜移动后源/目标集内分镜编号可能变化）。
 * @param renames 各集内重编号映射（如 [{ episode: '1', from: '4', to: '3' }]）
 */
function applyEpisodeRenames(renames?: { episode: string; from: string; to: string }[]) {
  if (!renames?.length) return
  const q = router.currentRoute.value.query
  if (q.type !== 'scene' || !q.episode) return
  const pair = renames.find(r => r.episode === q.episode && r.from === q.shot)
  if (pair) {
    patchQuery({ shot: pair.to })
  }
}

/**
 * 按分镜重编号映射平移树的展开/激活路径，重建后保持展开状态：
 * - 集内重编号：`scene-{ep}-{旧号}` → `scene-{ep}-{新号}`（插入/删除/移动的移位）；
 * - 移动映射：被移动分镜 `scene-{源集}-{源号}` → `scene-{目标集}-{目标号}`。
 *
 * @param renames 各集内重编号映射
 * @param move 被移动分镜的旧→新位置（分镜移动时提供）
 */
function remapTreePaths(
  renames: { episode: string; from: string; to: string }[],
  move?: { fromEpisode: string; fromShot: string; toEpisode: string; toShot: string },
): void {
  const map = new Map<string, string>()
  for (const r of renames) map.set(`scene-${r.episode}-${r.from}`, `scene-${r.episode}-${r.to}`)
  if (move) map.set(`scene-${move.fromEpisode}-${move.fromShot}`, `scene-${move.toEpisode}-${move.toShot}`)
  if (map.size === 0) return
  opened.value = opened.value.map((p) => map.get(p) ?? p)
  activated.value = activated.value.map((p) => map.get(p) ?? p)
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
    // 角色可能位于分类中：展开整条分类链
    const catPath = meta.value?.characters.assignments[name] ?? []
    const catOpenPaths = catPath.map((_, i) => charCatId(catPath.slice(0, i + 1)))
    return {
      activePath: `character-${name}`,
      openPaths: ['root-character', ...catOpenPaths],
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

function onSelect(item: TreeItem) {
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
  // 角色分类/角色根等节点仅高亮与展开，不改 URL
}

// ── 创建 / 删除 ──────────────────────────────────────────────────────

function openCreate(item: TreeItem) {
  createDialog.mode = 'create'
  createDialog.moveSource = null
  if (item.kind === 'root-character') {
    createDialog.type = 'character'
    createDialog.defaults = {}
  } else if (item.kind === 'character-category') {
    // 分类下新建角色：创建成功后自动归入该分类
    createDialog.type = 'character'
    createDialog.defaults = { characterCategory: [...(item.charCategoryPath ?? [])] }
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

async function onCreated(payload: {
  type: CreateAssetType
  name?: string
  stage?: string
  label?: string
  category?: string
  episode?: string
  shot?: string
  /** 新增分镜（插入/末尾）：集内重编号映射 */
  renames?: RenamePair[]
  /** 移动分镜：各集内重编号映射（含 episode 字段） */
  episodeRenames?: { episode: string; from: string; to: string }[]
  /** 移动分镜：源位置（mode=move 时由对话框回传） */
  from?: { episode: string; shot: string }
}) {
  // 在分类下新建角色：创建成功后立即归入该分类（失败仅提示，不阻断）
  if (payload.type === 'character' && payload.name && meta.value) {
    const catPath = createDialog.defaults.characterCategory
    if (catPath && catPath.length > 0) {
      try {
        const next = moveCharacter(meta.value.characters, payload.name, catPath)
        const saved = await putCharacterCategories(props.project, next)
        meta.value = { ...meta.value, characters: saved }
      } catch (err) {
        showError(err, '角色创建成功，但归类到分类失败')
      }
    }
  }

  // 重建前先按重编号映射平移展开/激活路径（重建后保持展开状态）
  if (payload.type === 'shot' && payload.from) {
    remapTreePaths(payload.episodeRenames ?? [], {
      fromEpisode: payload.from.episode,
      fromShot: payload.from.shot,
      toEpisode: payload.episode ?? '',
      toShot: payload.shot ?? '',
    })
  } else if (payload.type === 'shot' && payload.renames && payload.episode) {
    remapTreePaths(payload.renames.map(r => ({ episode: payload.episode!, from: r.from, to: r.to })))
  }

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
    if (payload.from) {
      // 移动分镜：当前打开的就是被移动分镜 → 跳转到新位置；
      // 否则按源/目标集的重编号映射修正当前 URL 的分镜号
      const q = router.currentRoute.value.query
      if (q.type === 'scene' && q.episode === payload.from.episode && q.shot === payload.from.shot) {
        patchQuery({
          type: 'scene',
          name: undefined,
          subscene: undefined,
          episode: payload.episode,
          shot: payload.shot,
        })
      } else {
        applyEpisodeRenames(payload.episodeRenames)
      }
    } else {
      applyShotRenames(payload.renames)
      patchQuery({
        type: 'scene',
        name: undefined,
        subscene: undefined,
        episode: payload.episode,
        shot: payload.shot,
      })
    }
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

function showError(err: unknown, fallback: string) {
  if (err instanceof AssetApiError) {
    errorDialog.message = err.message || fallback
    errorDialog.refs = err.refs ?? []
  } else {
    errorDialog.message = fallback
    errorDialog.refs = []
  }
  errorDialog.show = true
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
    label = `${epFullOf(item.episode ?? '')} ${shotFullOf(item.episode ?? '', item.shot ?? '')}`
  } else if (item.kind === 'episode') {
    label = epFullOf(item.episode ?? '')
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

async function doDelete(item: TreeItem) {
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
    // 重建前按重编号映射平移展开/激活路径（重建后保持展开状态）
    if (item.kind === 'shot' && renames?.length && item.episode) {
      remapTreePaths(renames.map(r => ({ episode: item.episode!, from: r.from, to: r.to })))
    } else if (item.kind === 'script-episode' && renames?.length) {
      const map = new Map(renames.map(r => [`script-episode-${r.from}`, `script-episode-${r.to}`]))
      opened.value = opened.value.map(p => map.get(p) ?? p)
      activated.value = activated.value.map(p => map.get(p) ?? p)
    }
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
    showError(e, '删除失败')
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

<style scoped>
.asset-tree {
  padding-bottom: 8px;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 2px;
  padding-bottom: 2px;
  padding-right: 4px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}

.tree-row:hover {
  background: rgba(127, 127, 127, 0.14);
}

.tree-row--active {
  background: rgba(63, 81, 181, 0.16);
}

.tree-row--drop-target {
  background: rgba(76, 175, 80, 0.22);
  outline: 1px dashed rgba(76, 175, 80, 0.7);
}

.tree-row--dragging {
  opacity: 0.45;
}

.tree-row__toggle {
  min-width: 24px !important;
  width: 24px !important;
  height: 24px !important;
  flex-shrink: 0;
}

.tree-row__title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.tree-row__actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.tree-row:hover .tree-row__actions {
  opacity: 1;
}
</style>
