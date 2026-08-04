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
        <v-tab
          v-if="visibleTabs.includes('scene-stage') && hasSceneContext"
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
                  <div
                    v-else
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

        <!-- 分镜场景图：分镜已生成的场景帧（assert/scene/{ep}/{shot}/stage/{i}.jpg） -->
        <template v-else-if="activeTab === 'scene-stage' && visibleTabs.includes('scene-stage') && hasSceneContext">
          <v-row
            v-if="sceneStages.length"
            dense
          >
            <v-col
              v-for="item in sceneStages"
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
            该分镜暂无场景图（请先在「场景图片」页签生成）
          </div>
        </template>

        <!-- 音频：3 个子页签（台词音频 / 分镜自定义 / 全局自定义） -->
        <template v-else-if="activeTab === 'audio' && visibleTabs.includes('audio')">
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

          <!-- 台词音频：台词列表（未生成语音的台词禁用） -->
          <template v-if="audioSection === 'voice'">
            <div
              v-if="voiceLines.length"
              class="d-flex flex-column ga-1"
            >
              <div
                v-for="line in voiceLines"
                :key="line.index"
                class="audio-item d-flex align-center ga-2 px-2 py-1 rounded"
                :class="{
                  'audio-item--disabled': !line.hasFile,
                  'asset-card--selected': line.hasFile && isSelected(line.path),
                }"
                @click="line.hasFile && selectItem(line.item)"
              >
                <v-icon
                  :color="line.hasFile ? 'secondary' : 'grey'"
                  size="20"
                >
                  mdi-account-voice
                </v-icon>
                <div
                  class="flex-grow-1"
                  style="min-width: 0;"
                >
                  <div class="text-caption text-truncate">
                    <strong>{{ line.index + 1 }}. {{ line.角色名 }}</strong>
                    <span class="text-grey ml-1">{{ line.台词 }}</span>
                  </div>
                </div>
                <v-chip
                  v-if="!line.hasFile"
                  size="x-small"
                  variant="tonal"
                  color="grey"
                >
                  未生成语音
                </v-chip>
                <v-icon
                  v-else-if="isSelected(line.path)"
                  color="primary"
                  size="18"
                >
                  mdi-check-circle
                </v-icon>
              </div>
            </div>
            <div
              v-else
              class="text-grey text-body-2 text-center py-8"
            >
              该分镜暂无台词
            </div>
          </template>

          <!-- 分镜/全局自定义：文件浏览器 -->
          <template v-else>
            <div class="d-flex align-center ga-2 mb-1">
              <v-btn
                icon="mdi-arrow-up"
                size="small"
                variant="text"
                :disabled="!audioCwd"
                title="返回上级目录"
                @click="goUpAudio"
              />
              <span class="text-caption text-truncate">
                {{ audioCwdLabel }}
              </span>
            </div>
            <div
              v-if="audioDirs.length || audioFiles.length"
              class="d-flex flex-column ga-1"
            >
              <div
                v-for="dir in audioDirs"
                :key="dir"
                class="audio-item d-flex align-center ga-2 px-2 py-1 rounded"
                @click="enterAudioDir(dir)"
              >
                <v-icon
                  color="primary"
                  size="20"
                >
                  mdi-folder
                </v-icon>
                <span class="text-caption">{{ dir }}/</span>
              </div>
              <div
                v-for="file in audioFiles"
                :key="file.path"
                class="audio-item d-flex align-center ga-2 px-2 py-1 rounded"
                :class="{ 'asset-card--selected': isSelected(file.path) }"
                @click="selectItem(file)"
              >
                <v-icon
                  color="secondary"
                  size="20"
                >
                  mdi-music-note
                </v-icon>
                <span
                  class="text-caption text-truncate"
                  :title="file.label"
                >
                  {{ file.label }}
                </span>
                <v-spacer />
                <v-icon
                  v-if="isSelected(file.path)"
                  color="primary"
                  size="18"
                >
                  mdi-check-circle
                </v-icon>
              </div>
            </div>
            <div
              v-else
              class="text-grey text-body-2 text-center py-8"
            >
              该目录暂无音频文件
            </div>
          </template>
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
                  v-if="item.thumbnail"
                  :src="item.thumbnail"
                  cover
                />
                <v-icon
                  v-else
                  size="16"
                  color="secondary"
                >
                  mdi-music-note
                </v-icon>
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
import client, { readFs, existsFs, type DirEntry, type DirResponse } from '../api/client'
import { listCharacterVariants, listStageVariants, type VariantInfo } from '../api/assets'

/** 资产分类标签 */
type AssetTab = 'character' | 'stage' | 'custom' | 'audio' | 'scene-stage'

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
  /** 分区标题（如「自定义资产」）；仅 header 条目使用 */
  section?: string
  /** 是否为分区标题条目（不可选择、不渲染缩略图） */
  header?: boolean
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
  /** 集数（audio 页签：定位分镜台词音频与分镜自定义资产；可选） */
  contextEpisode?: string
  /** 分镜编号（audio 页签：定位分镜台词音频与分镜自定义资产；可选） */
  contextShot?: string
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

// ── 音频页签状态 ─────────────────────────────────────────

/** 音频子页签：台词音频 / 分镜自定义 / 全局自定义 */
const audioSection = ref<'voice' | 'scene' | 'global'>('voice')

/** 台词音频条目：一条台词 + 其语音文件是否存在 */
interface VoiceLineItem {
  /** script.json 中的下标 */
  index: number
  /** 角色名 */
  角色名: string
  /** 台词内容 */
  台词: string
  /** 对应语音文件是否存在（仅存在的可选） */
  hasFile: boolean
  /** 语音文件相对路径 */
  path: string
  /** 可加入已选列表的资产条目 */
  item: AssetItem
}

/** 台词列表（读 script.json，未生成语音的台词禁用） */
const voiceLines = ref<VoiceLineItem[]>([])

/** 分镜场景图条目列表（assert/scene/{ep}/{shot}/stage/{i}.jpg） */
const sceneStages = ref<AssetItem[]>([])

/** 是否有分镜上下文（决定是否显示「分镜自定义」子页签） */
const hasSceneContext = computed(
  () => !!(props.contextEpisode && props.contextShot),
)

/** 文件浏览器：当前目录的子目录名列表 */
const audioDirs = ref<string[]>([])
/** 文件浏览器：当前目录的音频文件条目 */
const audioFiles = ref<AssetItem[]>([])
/** 文件浏览器：分镜自定义子页签当前相对路径（相对 assert/custom/scene/{ep}/{shot}） */
const sceneCwd = ref('')
/** 文件浏览器：全局自定义子页签当前相对路径（相对 assert/custom） */
const globalCwd = ref('')
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
  if (path.startsWith('assert/scene/')) {
    const m = path.match(/\/stage\/(\d+)\.jpg$/)
    if (m) return `分镜场景图 ${Number(m[1]) + 1}`
    return path.split('/').pop() ?? path
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
 * 构建角色的树形资产列表：外观图片为根，变体按 parentId 递归嵌套，
 * 自定义资产（assert/custom/character/{name}/）单独分区显示。
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

  // 自定义资产分区：在普通资产与衍生变体之下单独换行显示
  tree.push(...(await buildCustomSection(project, `assert/custom/character/${name}`)))

  return tree
}

/**
 * 构建场景的树形资产列表：每个子场景为一棵子树，变体递归嵌套，
 * 自定义资产（assert/custom/stage/{stage}/）单独分区显示。
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

  // 自定义资产分区：在普通资产与衍生变体之下单独换行显示
  tree.push(...(await buildCustomSection(project, `assert/custom/stage/${stage}`)))

  return tree
}

/**
 * 构建自定义资产分区条目。
 * 仅在目录存在且包含图片时返回分区标题 + 资产条目，否则返回空数组。
 *
 * @param project 项目名
 * @param customRootDir assert/custom/ 下的实体映射目录（如 assert/custom/character/陈书文）
 */
async function buildCustomSection(project: string, customRootDir: string): Promise<AssetItem[]> {
  const items: AssetItem[] = []
  const imagePaths = await listImageFilesRecursive(project, customRootDir)
  const visible = imagePaths.filter((p) => !props.exclude.includes(p))
  if (!visible.length) return items

  // 分区标题（不可选择，单独换行）
  items.push({
    path: '',
    label: '',
    thumbnail: '',
    depth: 0,
    section: '自定义资产',
    header: true,
  })
  for (const p of visible) {
    items.push({
      path: p,
      label: `自定义/${p.replace(/^assert\/custom\//, '')}`,
      thumbnail: `/api/fs/${project}/${p}?t=${ts()}`,
      depth: 1,
    })
  }
  return items
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

/**
 * 判断文件名是否为支持的音频文件。
 *
 * @param name 文件名
 * @returns true 表示音频文件
 */
function isAudioFile(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop()
  return !!ext && new Set(['flac', 'mp3', 'wav', 'm4a', 'ogg', 'opus']).has(ext)
}

/**
 * 加载「台词音频」子页签数据。
 *
 * 读取 script.json 的台词列表，逐条探测对应语音文件
 * （assert/scene/{ep}/{shot}/voice/{index}-{角色名}.flac）是否存在；
 * 无论是否已生成都展示，仅存在语音文件的台词可选。
 */
async function loadVoiceLines() {
  const { contextEpisode: ep, contextShot: shot } = props
  if (!ep || !shot) {
    voiceLines.value = []
    return
  }
  tabLoading.value = true
  try {
    const scriptRaw = await readFs(props.project, `prompt/scene/${ep}/${shot}/script.json`).catch(() => null)
    let script: Array<{ 角色名?: string; 台词?: string }> = []
    if (typeof scriptRaw === 'string') {
      const text = scriptRaw.trim()
      if (text) script = JSON.parse(text) as Array<{ 角色名?: string; 台词?: string }>
    } else if (Array.isArray(scriptRaw)) {
      script = scriptRaw as Array<{ 角色名?: string; 台词?: string }>
    }

    const lines: VoiceLineItem[] = []
    for (let i = 0; i < script.length; i++) {
      const role = (script[i]?.角色名 ?? '').trim()
      const text = (script[i]?.台词 ?? '').trim()
      if (!role) continue
      const path = `assert/scene/${ep}/${shot}/voice/${i}-${role}.flac`
      const hasFile = await existsFs(props.project, path)
      lines.push({
        index: i,
        角色名: role,
        台词: text,
        hasFile,
        path,
        item: {
          path,
          label: `${i + 1}. ${role}`, // 已选区域用简短标签
          thumbnail: '',
          depth: 0,
        },
      })
    }
    voiceLines.value = lines
  } finally {
    tabLoading.value = false
  }
}

/**
 * 加载「分镜场景图」页签数据。
 *
 * 读取 assert/scene/{ep}/{shot}/stage/ 目录下的 {i}.jpg 场景帧，
 * 按帧序号展示为「分镜场景图 N」；无分镜上下文或目录不存在时为空。
 */
async function loadSceneStages() {
  const { contextEpisode: ep, contextShot: shot } = props
  tabLoading.value = true
  sceneStages.value = []
  try {
    if (!ep || !shot) return
    const dir = `assert/scene/${ep}/${shot}/stage`
    const res = await readFs(props.project, dir).catch(() => null) as DirResponse | null
    const entries = res?.entries ?? []
    const images = entries
      .filter((e: DirEntry) => e.type === 'file' && /\.jpe?g$/i.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }))
    sceneStages.value = images.map((e: DirEntry) => {
      const idx = Number(e.name.replace(/\.[^.]+$/, ''))
      return {
        path: `${dir}/${e.name}`,
        label: Number.isFinite(idx) ? `分镜场景图 ${idx + 1}` : e.name,
        thumbnail: `/api/fs/${props.project}/${dir}/${e.name}?t=${ts()}`,
        depth: 0,
      }
    })
  } finally {
    tabLoading.value = false
  }
}

/**
 * 获取当前文件浏览器子页签的根目录（相对项目路径）。
 */
function audioRoot(): string {
  if (audioSection.value === 'scene' && hasSceneContext.value) {
    return `assert/custom/scene/${props.contextEpisode}/${props.contextShot}`
  }
  return 'assert/custom'
}

/** 当前文件浏览器子页签的 cwd ref */
function audioCwdRef(): { value: string } {
  return audioSection.value === 'scene' ? sceneCwd : globalCwd
}

/** 文件浏览器当前相对路径（相对各自根目录） */
const audioCwd = computed(() => audioCwdRef().value)

/** 文件浏览器当前完整相对路径（用于 readFs） */
const audioFullCwd = computed(() => {
  const root = audioRoot()
  const cwd = audioCwd.value
  return cwd ? `${root}/${cwd}` : root
})

/** 文件浏览器顶部路径标签（含来源名） */
const audioCwdLabel = computed(() => {
  const name = audioSection.value === 'scene' ? '分镜自定义' : '全局自定义'
  return audioCwd.value ? `${name} / ${audioCwd.value}` : `${name} /`
})

/**
 * 加载文件浏览器当前目录：子目录 + 音频文件。
 */
async function loadAudioBrowser() {
  tabLoading.value = true
  try {
    let res: DirResponse
    try {
      res = await readFs(props.project, audioFullCwd.value) as DirResponse
    } catch {
      // 目录不存在（如分镜无自定义资产目录）→ 静默视为空目录
      audioDirs.value = []
      audioFiles.value = []
      return
    }
    const entries = res.entries ?? []
    audioDirs.value = entries
      .filter((e: DirEntry) => e.type === 'dir')
      .map((e: DirEntry) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh'))
    audioFiles.value = entries
      .filter((e: DirEntry) => e.type === 'file' && isAudioFile(e.name))
      .filter((e: DirEntry) => !props.exclude.includes(`${audioFullCwd.value}/${e.name}`))
      .map((e: DirEntry) => ({
        path: `${audioFullCwd.value}/${e.name}`,
        label: e.name,
        thumbnail: '',
        depth: 0,
      }))
  } finally {
    tabLoading.value = false
  }
}

/**
 * 进入文件浏览器的子目录。
 *
 * @param dir 子目录名
 */
async function enterAudioDir(dir: string): Promise<void> {
  audioCwdRef().value = audioCwd.value ? `${audioCwd.value}/${dir}` : dir
  await loadAudioBrowser()
}

/**
 * 文件浏览器返回上级目录。
 */
async function goUpAudio(): Promise<void> {
  const cwd = audioCwd.value
  if (!cwd) return
  const idx = cwd.lastIndexOf('/')
  audioCwdRef().value = idx >= 0 ? cwd.slice(0, idx) : ''
  await loadAudioBrowser()
}

/**
 * 音频子页签变化：加载对应内容。
 */
async function onAudioSectionChange() {
  if (audioSection.value === 'voice') {
    await loadVoiceLines()
  } else {
    await loadAudioBrowser()
  }
}

/** 切换标签页时加载数据，并自动展开第一个实体 */
async function onTabChange() {
  if (activeTab.value === 'custom') {
    await loadCustomTabInternal()
  } else if (activeTab.value === 'audio') {
    await onAudioSectionChange()
  } else if (activeTab.value === 'scene-stage') {
    await loadSceneStages()
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

/** 音频子页签切换时加载对应内容（仅当音频页签激活时） */
watch(audioSection, () => {
  if (activeTab.value === 'audio') {
    void onAudioSectionChange()
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

/* 音频条目（台词/文件浏览器行） */
.audio-item {
  cursor: pointer;
  transition: background 0.15s ease;
}

.audio-item:hover {
  background: rgba(var(--v-theme-primary), 0.05);
}

/* 未生成语音的台词：禁用态 */
.audio-item--disabled {
  cursor: not-allowed;
  opacity: 0.5;
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
