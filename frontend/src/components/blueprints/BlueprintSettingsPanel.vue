<template>
  <div class="blueprint-panel">
    <!-- 顶部：作用域切换 + 项目选择 + 搜索 + 操作 -->
    <div class="blueprint-panel__header">
      <v-btn-toggle
        v-model="scope"
        mandatory
        density="comfortable"
        variant="outlined"
        divided
      >
        <v-btn
          value="global"
          prepend-icon="mdi-earth"
        >
          全局
        </v-btn>
        <v-btn
          value="project"
          prepend-icon="mdi-folder-outline"
        >
          项目
        </v-btn>
      </v-btn-toggle>
      <v-select
        v-if="scope === 'project'"
        v-model="project"
        :items="projects"
        label="项目"
        variant="outlined"
        density="comfortable"
        hide-details
        class="blueprint-panel__project"
      />
      <v-text-field
        v-model="keyword"
        label="搜索"
        variant="outlined"
        density="comfortable"
        prepend-inner-icon="mdi-magnify"
        hide-details
        clearable
        class="blueprint-panel__search"
      />
      <v-spacer />
      <v-btn
        variant="tonal"
        prepend-icon="mdi-upload"
        @click="pickImportFile"
      >
        导入蓝图
      </v-btn>
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        @click="onCreate"
      >
        新增蓝图
      </v-btn>
    </div>

    <!-- 说明 -->
    <div class="text-body-small text-medium-emphasis mt-1">
      {{ scope === 'global'
        ? '全局蓝图对所有项目可见；资产上下文（预览/上传/选择资产）在蓝图编辑器中单独指定。'
        : '项目级蓝图保存在该项目下（prompt/blueprint/），仅该项目可见；资产上下文固定为该项目。' }}
    </div>

    <v-alert
      v-if="error"
      type="error"
      class="mt-2"
      :text="error"
      closable
      @click:close="error = ''"
    />

    <!-- 列表 -->
    <div class="blueprint-panel__content">
      <div
        v-if="loading"
        class="d-flex justify-center pa-6"
      >
        <v-progress-circular indeterminate />
      </div>
      <div
        v-else-if="filtered.length === 0"
        class="text-body-2 text-medium-emphasis text-center pa-6"
      >
        {{ keyword.trim() ? '没有匹配的蓝图' : '该作用域下还没有蓝图：在画布中多选节点后点「创建蓝图」，或点击右上角「新增蓝图」。' }}
      </div>
      <v-list
        v-else
        lines="two"
        class="blueprint-panel__list"
      >
        <v-list-item
          v-for="item in filtered"
          :key="item.id"
          @click="openEditor(item)"
        >
          <template #prepend>
            <v-icon icon="mdi-vector-square" />
          </template>
          <v-list-item-title>{{ item.name }}</v-list-item-title>
          <v-list-item-subtitle class="blueprint-panel__subtitle">
            {{ item.nodeCount }} 个节点 · {{ item.connectionCount }} 条连线 · {{ item.groupCount }} 个分组
            <span v-if="item.assetProject"> · 资产项目 {{ item.assetProject }}</span>
            <span class="ml-2">{{ formatTime(item.updatedAt) }}</span>
            <span
              v-if="item.description"
              class="ml-2"
            >· {{ item.description }}</span>
          </v-list-item-subtitle>
          <template #append>
            <v-btn
              icon="mdi-pencil"
              size="small"
              variant="text"
              :title="`编辑蓝图「${item.name}」内容`"
              @click.stop="openEditor(item)"
            />
            <v-btn
              icon="mdi-rename-box"
              size="small"
              variant="text"
              :title="`重命名/修改描述「${item.name}」`"
              @click.stop="openRename(item)"
            />
            <v-btn
              icon="mdi-download"
              size="small"
              variant="text"
              :title="`导出蓝图「${item.name}」为 JSON`"
              @click.stop="onExport(item)"
            />
            <v-btn
              icon="mdi-delete"
              size="small"
              variant="text"
              color="error"
              :title="`删除蓝图「${item.name}」`"
              @click.stop="onDelete(item)"
            />
          </template>
        </v-list-item>
      </v-list>
    </div>

    <!-- 蓝图编辑器（完整画布式；手动保存：关闭后刷新列表以反映最新内容统计/更新时间） -->
    <BlueprintEditDialog
      v-model="editorOpen"
      :blueprint="editing"
      :scope="scope"
      :project="project"
      @update:model-value="onEditorVisibleChange"
      @meta-updated="onEditorMetaUpdated"
    />

    <!-- 新增 / 重命名对话框 -->
    <v-dialog
      v-model="renameOpen"
      max-width="520"
      persistent
    >
      <v-card>
        <v-card-title>{{ renameMode === 'create' ? '新增蓝图' : '重命名蓝图' }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="renameName"
            label="名称"
            variant="outlined"
            density="comfortable"
            :maxlength="BLUEPRINT_NAME_MAX"
            counter
            autofocus
          />
          <v-textarea
            v-model="renameDescription"
            label="描述（可选）"
            variant="outlined"
            density="comfortable"
            rows="2"
            :maxlength="BLUEPRINT_DESC_MAX"
            auto-grow
          />
          <v-alert
            v-if="renameError"
            type="error"
            density="compact"
            class="mt-2"
            :text="renameError"
          />
          <div
            v-if="renameMode === 'create'"
            class="text-body-small text-medium-emphasis mt-2"
          >
            新建后直接进入画布式编辑器：添加节点、连线与分组，点「保存」或 Ctrl+S 落盘；
            关闭时若有未保存的修改会提示是否放弃。
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="renameOpen = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :loading="renameSaving"
            :disabled="!renameName.trim()"
            @click="onRenameSave"
          >
            {{ renameMode === 'create' ? '创建并编辑' : '保存' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 导入文件选择框（隐藏） -->
    <input
      ref="importInputEl"
      type="file"
      accept="application/json,.json"
      class="d-none"
      @change="onImportFilePicked"
    >
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { getProjects } from '../../api/client'
import {
  BlueprintExistsError,
  createBlueprint,
  deleteBlueprint,
  getBlueprint,
  importBlueprint,
  listBlueprints,
  updateBlueprint,
  type BlueprintRef,
  type BlueprintScope,
} from '../../api/blueprints'
import {
  BLUEPRINT_DESC_MAX,
  BLUEPRINT_NAME_MAX,
  migrateBlueprint,
  type BlueprintListItem,
  type CanvasBlueprint,
} from '../../canvas/blueprint'
import { confirm } from '../../utils/confirm'
import BlueprintEditDialog from './BlueprintEditDialog.vue'

/**
 * 系统配置 →「画布蓝图」管理面板。
 *
 * 功能：作用域切换（全局 / 项目）、搜索、新增（空蓝图 + 直接进入画布式编辑器）、
 * 重命名/描述、导出 JSON、导入 JSON、删除（弹窗确认）、进入可视化编辑器。
 */
const scope = ref<BlueprintScope>('global')
const project = ref('')
const projects = ref<string[]>([])
const keyword = ref('')
const list = ref<BlueprintListItem[]>([])
const loading = ref(false)
const error = ref('')

/** 编辑器对话框状态 */
const editorOpen = ref(false)
const editing = ref<CanvasBlueprint | null>(null)

/** 新增/重命名对话框状态 */
const renameOpen = ref(false)
const renameMode = ref<'create' | 'rename'>('create')
const renameTarget = ref<BlueprintListItem | null>(null)
const renameName = ref('')
const renameDescription = ref('')
const renameError = ref('')
const renameSaving = ref(false)

/** 导入文件选择框 */
const importInputEl = ref<HTMLInputElement | null>(null)

/** 当前作用域引用 */
const currentRef = computed<BlueprintRef>(() =>
  scope.value === 'project' ? { scope: 'project', project: project.value } : { scope: 'global' },
)

/** 按关键字过滤后的列表 */
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list.value
  return list.value.filter(
    (b) => b.name.toLowerCase().includes(kw) || b.description.toLowerCase().includes(kw),
  )
})

onMounted(async () => {
  await loadProjects()
  await load()
})

/**
 * 加载项目列表（失败输出日志）。
 */
async function loadProjects(): Promise<void> {
  try {
    const entries = await getProjects()
    projects.value = entries.map((p) => p.name)
    if (!project.value) project.value = projects.value[0] ?? ''
  } catch (e) {
    console.error('[blueprint] 加载项目列表失败', e)
  }
}

/**
 * 加载当前作用域的蓝图列表（失败提示并置空）。
 */
async function load(): Promise<void> {
  if (scope.value === 'project' && !project.value) {
    list.value = []
    return
  }
  loading.value = true
  error.value = ''
  try {
    list.value = await listBlueprints(currentRef.value)
  } catch (e) {
    list.value = []
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// 作用域/项目变化时重新加载
watch([scope, project], () => {
  void load()
})

/** 新增：打开名称对话框（创建空蓝图后直接进入编辑器） */
function onCreate(): void {
  renameMode.value = 'create'
  renameTarget.value = null
  renameName.value = '新蓝图'
  renameDescription.value = ''
  renameError.value = ''
  renameOpen.value = true
}

/**
 * 打开重命名对话框。
 *
 * @param item 目标蓝图摘要
 */
function openRename(item: BlueprintListItem): void {
  renameMode.value = 'rename'
  renameTarget.value = item
  renameName.value = item.name
  renameDescription.value = item.description
  renameError.value = ''
  renameOpen.value = true
}

/**
 * 打开可视化编辑器（先取蓝图详情）。
 *
 * @param item 目标蓝图摘要
 */
async function openEditor(item: BlueprintListItem): Promise<void> {
  error.value = ''
  try {
    editing.value = await getBlueprint(currentRef.value, item.id)
    editorOpen.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

/**
 * 编辑器显隐变化：关闭时重新加载列表（手动保存后内容统计/更新时间/rev 已变化）。
 *
 * @param value 新的显隐值（true = 打开）
 */
function onEditorVisibleChange(value: boolean): void {
  if (value) return
  void load()
}

/**
 * 编辑器内资产项目变更：同步列表项展示（无需重新拉取整表）。
 *
 * @param patch 变更补丁
 */
function onEditorMetaUpdated(patch: { assetProject: string | null }): void {
  const id = editing.value?.id
  if (!id) return
  list.value = list.value.map((b) => (b.id === id ? { ...b, assetProject: patch.assetProject } : b))
}

/**
 * 新增/重命名保存。
 */
async function onRenameSave(): Promise<void> {
  renameSaving.value = true
  renameError.value = ''
  try {
    if (renameMode.value === 'create') {
      const created = await createBlueprint(currentRef.value, {
        name: renameName.value,
        description: renameDescription.value,
        payload: { nodes: [], connections: [], groups: [] },
      })
      renameOpen.value = false
      await load()
      editing.value = created
      editorOpen.value = true
      return
    }
    const target = renameTarget.value
    if (!target) return
    await updateBlueprint(
      currentRef.value,
      target.id,
      { name: renameName.value, description: renameDescription.value },
      { expectedRev: target.rev },
    )
    renameOpen.value = false
    await load()
  } catch (e) {
    if (e instanceof BlueprintExistsError) {
      renameError.value = '同作用域内已存在同名蓝图，请换一个名称'
    } else {
      renameError.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    renameSaving.value = false
  }
}

/**
 * 导出单个蓝图（下载 `{名称}.json`，内容为完整蓝图文件结构）。
 *
 * @param item 目标蓝图摘要
 */
async function onExport(item: BlueprintListItem): Promise<void> {
  error.value = ''
  try {
    const blueprint = await getBlueprint(currentRef.value, item.id)
    const blob = new Blob([`${JSON.stringify(blueprint, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizeFileName(blueprint.name)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

/**
 * 删除蓝图（弹窗确认后执行）。
 *
 * @param item 目标蓝图摘要
 */
async function onDelete(item: BlueprintListItem): Promise<void> {
  const ok = await confirm({
    title: '删除蓝图',
    content: `确定删除蓝图「${item.name}」？该操作不可恢复（已插入画布的内容不受影响）。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  error.value = ''
  try {
    await deleteBlueprint(currentRef.value, item.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

/** 打开系统文件选择框（导入蓝图） */
function pickImportFile(): void {
  importInputEl.value?.click()
}

/**
 * 导入选中文件：读取 → 解析 → 结构校验 → 确认导入到当前作用域 → 同名时询问覆盖。
 *
 * @param event 文件选择框 change 事件
 */
async function onImportFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 允许连续选择同一个文件
  input.value = ''
  if (!file) return
  error.value = ''
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch (e) {
    console.error('[blueprint] 导入文件不是合法 JSON', e)
    error.value = `导入失败：${file.name} 不是合法的 JSON 文件`
    return
  }
  const parsed = migrateBlueprint(raw)
  if (!parsed) {
    error.value = `导入失败：${file.name} 不是合法的蓝图文件`
    return
  }
  if (parsed.nodes.length === 0) {
    error.value = `导入失败：${file.name} 中没有任何节点`
    return
  }
  const targetLabel = scope.value === 'global' ? '全局' : `项目「${project.value}」`
  const ok = await confirm({
    title: '导入蓝图',
    content: `将蓝图「${parsed.name}」（${parsed.nodes.length} 个节点）导入到${targetLabel}？`,
    confirmText: '导入',
    confirmColor: 'primary',
  })
  if (!ok) return
  try {
    await importBlueprint(currentRef.value, raw)
    await load()
  } catch (e) {
    if (e instanceof BlueprintExistsError) {
      const overwrite = await confirm({
        title: '覆盖同名蓝图',
        content: `${targetLabel}已存在名为「${parsed.name}」的蓝图，是否覆盖？原内容不可恢复。`,
        confirmText: '覆盖',
        confirmColor: 'warning',
      })
      if (overwrite) {
        try {
          await importBlueprint(currentRef.value, raw, { overwrite: true })
          await load()
        } catch (err) {
          error.value = err instanceof Error ? err.message : String(err)
        }
      }
    } else {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }
}

/**
 * 文件名安全化（去掉路径分隔符等非法字符）。
 *
 * @param name 原始名称
 * @returns 可用作文件名的字符串
 */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned || 'blueprint'
}

/**
 * 相对时间格式化。
 *
 * @param iso ISO 时间字符串
 * @returns 展示文案
 */
function formatTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const minute = 60000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  return new Date(t).toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.blueprint-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.blueprint-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 0 0 auto;
}

.blueprint-panel__project {
  width: 180px;
}

.blueprint-panel__search {
  width: 200px;
}

.blueprint-panel__content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-top: 8px;
}

.blueprint-panel__list {
  padding-top: 0;
}

.blueprint-panel__subtitle {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
