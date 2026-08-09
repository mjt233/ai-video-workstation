<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    @update:model-value="onDialogUpdate"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          class="mr-2"
          size="small"
        >
          mdi-content-save-outline
        </v-icon>
        <span>保存为自定义资产</span>
      </v-card-title>
      <v-card-text>
        <!-- 双根切换：场景 / 分镜自定义资产 -->
        <v-tabs
          v-model="activeRoot"
          density="compact"
          class="mb-2"
        >
          <v-tab value="stage">
            场景自定义资产
          </v-tab>
          <v-tab value="scene">
            分镜自定义资产
          </v-tab>
        </v-tabs>

        <!-- 工具栏：面包屑 + 新建目录 -->
        <div class="d-flex align-center ga-2 mb-2">
          <div
            class="d-flex align-center flex-grow-1"
            style="min-width: 0; overflow-x: auto;"
          >
            <template
              v-for="(crumb, i) in breadcrumbs"
              :key="i"
            >
              <v-btn
                v-if="i > 0"
                icon="mdi-chevron-right"
                size="x-small"
                variant="text"
                density="compact"
                disabled
              />
              <v-btn
                variant="text"
                size="small"
                density="compact"
                class="text-none"
                :class="{ 'text-primary font-weight-medium': !crumb.disabled }"
                :disabled="crumb.disabled"
                @click="navigateTo(crumb.path)"
              >
                {{ crumb.title }}
              </v-btn>
            </template>
          </div>
          <v-btn
            size="small"
            variant="text"
            prepend-icon="mdi-folder-plus-outline"
            @click="showCreateDir = true"
          >
            新建目录
          </v-btn>
        </div>

        <!-- 目录/文件网格 -->
        <div
          v-if="loading"
          class="d-flex align-center justify-center pa-6"
        >
          <v-progress-circular
            indeterminate
            size="24"
            color="primary"
          />
        </div>
        <div
          v-else-if="!entries.length"
          class="text-grey text-body-medium pa-4 text-center"
        >
          当前目录为空
        </div>
        <div
          v-else
          class="save-dialog-grid"
        >
          <div
            v-for="entry in entries"
            :key="entry.name"
            class="save-dialog-item"
            :class="{ 'is-dir': entry.type === 'dir' }"
            @click="entry.type === 'dir' && enterDir(entry.name)"
          >
            <v-icon
              :icon="entry.type === 'dir' ? 'mdi-folder' : fileIcon(entry.name)"
              :color="entry.type === 'dir' ? 'amber-darken-1' : 'grey-darken-1'"
              size="28"
            />
            <div
              class="save-dialog-name text-body-small"
              :title="entry.name"
            >
              {{ entry.name }}
            </div>
          </div>
        </div>

        <!-- 保存目标提示 -->
        <div class="d-flex align-center ga-2 mt-3">
          <div class="text-body-small text-medium-emphasis">
            将保存为：
          </div>
          <div
            class="text-body-small save-dialog-target"
            :title="targetRelPath"
          >
            {{ targetRelPath }}
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="saving"
          @click="closeDialog"
        >
          取消
        </v-btn>
        <v-btn
          color="primary"
          :loading="saving"
          :disabled="!sourcePath"
          @click="save"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- 新建目录对话框 -->
    <v-dialog
      v-model="showCreateDir"
      max-width="400"
    >
      <v-card>
        <v-card-title>新建目录</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="newDirName"
            label="目录名"
            variant="outlined"
            density="comfortable"
            autofocus
            :error-messages="newDirError"
            @keyup.enter="createDirectory"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="creatingDir"
            @click="showCreateDir = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :loading="creatingDir"
            @click="createDirectory"
          >
            创建
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  readFs,
  mkdirFs,
  copyFs,
  existsFs,
  type DirEntry,
  type DirResponse,
} from '../../api/client'
import { extname, fileIcon, validateEntryName } from '../../utils/customAssetFile'

/**
 * 保存为自定义资产对话框。
 *
 * 把画布节点的当前输出资产（图片/音频/视频）复制到自定义资产目录：
 * - 双根切换：场景（assert/custom/stage/…）与分镜（assert/custom/scene/…）自定义资产；
 * - 支持目录导航（面包屑 + 网格进入）与「新建目录」（mkdirFs）；
 * - 目标文件名 = 节点名 + 源扩展名，重名自动追加 (1)、(2)… 后缀。
 *
 * 默认定位当前画布所属实体：分镜画布 → 分镜根 scene/{集数}/{分镜} 且场景根尽力推导当前场景；
 * 场景画布 → 场景根 stage/{场景}。
 */
const props = defineProps<{
  /** 显隐控制 */
  modelValue: boolean
  /** 项目名 */
  project: string
  /** 画布类型（决定默认选中的根与初始路径） */
  kind: 'stage' | 'scene'
  /** 场景画布时的场景名 */
  stage?: string
  /** 分镜画布时的集数 */
  episode?: string
  /** 分镜画布时的分镜号 */
  shot?: string
  /** 节点名称（用作保存文件名主体） */
  nodeName: string
  /** 源资产相对路径（待复制文件） */
  sourcePath: string
}>()

/** 组件事件：显隐同步、保存成功（目标路径）、保存失败（错误信息） */
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved', targetPath: string): void
  (e: 'save-error', message: string): void
}>()

/** 保存根类型：场景 / 分镜 */
type Root = 'stage' | 'scene'

/** 当前选中的根（v-tabs 绑定） */
const activeRoot = ref<Root>('stage')
/** 场景根下的当前子目录（相对 stage/，空串=根） */
const stageSub = ref('')
/** 分镜根下的当前子目录（相对 scene/，空串=根） */
const sceneSub = ref('')

/** 当前根下的子目录（随根切换取值） */
const subDir = computed(() => (activeRoot.value === 'stage' ? stageSub.value : sceneSub.value))

/** 目录条目与加载态 */
const entries = ref<DirEntry[]>([])
const loading = ref(false)
const saving = ref(false)

/** 新建目录状态 */
const showCreateDir = ref(false)
const newDirName = ref('')
const newDirError = ref('')
const creatingDir = ref(false)

/** 当前根对应的 assert/custom/ 下前缀（stage/ 或 scene/） */
const baseRel = computed(() => (activeRoot.value === 'stage' ? 'stage' : 'scene'))

/** 相对 assert/custom/ 的完整目录路径（含根，如 stage/商场/内景） */
const customRelPath = computed(() => {
  const sub = subDir.value
  return sub ? `${baseRel.value}/${sub}` : baseRel.value
})

/** 面包屑（相对 assert/custom/，含根） */
const breadcrumbs = computed(() => {
  const items: { title: string; path: string; disabled: boolean }[] = [
    {
      title: activeRoot.value === 'stage' ? '场景自定义资产' : '分镜自定义资产',
      path: baseRel.value,
      disabled: subDir.value === '',
    },
  ]
  let acc = ''
  for (const part of subDir.value.split('/').filter(Boolean)) {
    acc = acc ? `${acc}/${part}` : part
    items.push({ title: part, path: `${baseRel.value}/${acc}`, disabled: acc === subDir.value })
  }
  return items
})

/** 目标文件名：节点名（清洗非法字符）+ 源资产扩展名 */
const targetFileName = computed(() => {
  const ext = extname(props.sourcePath)
  const base = props.nodeName.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+$/, '')
  return `${base || '未命名'}${ext}`
})

/** 目标相对项目路径（展示用，如 assert/custom/stage/商场/门口.png） */
const targetRelPath = computed(() => `assert/custom/${customRelPath.value}/${targetFileName.value}`)

/** 加载当前目录内容（目录读取路径须带 assert/custom/ 前缀） */
async function loadDir() {
  loading.value = true
  try {
    const res = await readFs(props.project, `assert/custom/${customRelPath.value}`) as DirResponse
    entries.value = (res.entries ?? []).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh')
    })
  } catch {
    entries.value = []
  } finally {
    loading.value = false
  }
}

/** 面包屑导航到指定路径（含根，如 stage/商场） */
function navigateTo(path: string) {
  const sub = path.replace(new RegExp(`^${baseRel.value}/?`), '')
  if (activeRoot.value === 'stage') stageSub.value = sub
  else sceneSub.value = sub
}

/** 点击目录进入 */
function enterDir(name: string) {
  const sub = subDir.value ? `${subDir.value}/${name}` : name
  if (activeRoot.value === 'stage') stageSub.value = sub
  else sceneSub.value = sub
}

/** 在当前目录下创建子目录（路径须带 assert/custom/ 前缀） */
async function createDirectory() {
  const nameError = validateEntryName(newDirName.value)
  if (nameError) {
    newDirError.value = nameError === '名称不能为空' ? '目录名不能为空' : nameError
    return
  }
  const name = newDirName.value.trim()
  newDirError.value = ''
  creatingDir.value = true
  try {
    await mkdirFs(props.project, `assert/custom/${customRelPath.value}/${name}`)
    showCreateDir.value = false
    newDirName.value = ''
    await loadDir()
  } catch {
    newDirError.value = '创建失败，请重试'
  } finally {
    creatingDir.value = false
  }
}

/**
 * 保存：把源资产复制到当前选中目录，文件名重名时自动追加 (1)、(2)… 后缀。
 */
async function save() {
  if (!props.sourcePath) return
  saving.value = true
  try {
    let filename = targetFileName.value
    let candidate = `assert/custom/${customRelPath.value}/${filename}`
    let i = 1
    while (await existsFs(props.project, candidate)) {
      const ext = extname(filename)
      const stem = ext ? filename.slice(0, -ext.length) : filename
      filename = `${stem} (${i})${ext}`
      candidate = `assert/custom/${customRelPath.value}/${filename}`
      i++
    }
    await copyFs(props.project, props.sourcePath, candidate)
    emit('saved', candidate)
    closeDialog()
  } catch (e) {
    emit('save-error', e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

/**
 * 打开时初始化：按画布类型设置默认根与初始路径。
 * 分镜画布的场景根尽力从 stage.json 推导当前场景（取首帧基础场景的场景名）。
 */
async function initDefaults() {
  activeRoot.value = props.kind === 'scene' ? 'scene' : 'stage'
  stageSub.value = ''
  sceneSub.value = ''
  if (props.kind === 'stage') {
    stageSub.value = props.stage ?? ''
  } else {
    sceneSub.value = props.episode && props.shot ? `${props.episode}/${props.shot}` : ''
    try {
      const res = await readFs(props.project, `prompt/scene/${props.episode}/${props.shot}/stage.json`)
      const frames = Array.isArray(res) ? (res as { 基础场景?: string }[]) : []
      const first = frames.find((f) => f.基础场景 && f.基础场景.trim())
      const stageName = first?.基础场景?.trim().split('/')[0]
      if (stageName) stageSub.value = stageName
    } catch {
      // stage.json 缺失/解析失败：场景根保持根目录（best-effort）
    }
  }
  await loadDir()
}

/** 根或子目录变化时重新加载目录 */
watch([activeRoot, subDir], () => {
  void loadDir()
})

/** 对话框打开时初始化默认路径 */
watch(
  () => props.modelValue,
  (open) => {
    if (open) void initDefaults()
  },
)

/** 内部 v-dialog 显隐变化 → 透传父组件 */
function onDialogUpdate(v: unknown) {
  emit('update:modelValue', Boolean(v))
}

/** 关闭对话框 */
function closeDialog() {
  emit('update:modelValue', false)
}
</script>

<style scoped>
.save-dialog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  align-content: start;
}

.save-dialog-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 6px;
  cursor: pointer;
  overflow: hidden;
}

.save-dialog-item.is-dir:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-primary), 0.04);
}

.save-dialog-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.save-dialog-target {
  color: rgba(0, 0, 0, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
