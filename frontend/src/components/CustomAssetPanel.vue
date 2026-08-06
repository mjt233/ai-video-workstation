<template>
  <div style="flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;">
    <CustomAssetToolbar
      :breadcrumb-items="breadcrumbItems"
      :view-mode="viewMode"
      :uploading="uploading"
      :loading="loading"
      @navigate="navigateTo"
      @update:view-mode="viewMode = $event"
      @create-dir="showCreateDirDialog = true"
      @upload="triggerUpload"
      @refresh="loadDir"
    />

    <input
      ref="uploadInput"
      type="file"
      class="d-none"
      multiple
      @change="onUploadFiles"
    >

    <!-- 状态区 -->
    <div
      v-if="loading"
      class="d-flex align-center justify-center flex-grow-1"
    >
      <v-progress-circular
        indeterminate
        color="primary"
      />
    </div>
    <div
      v-else-if="error"
      class="d-flex align-center justify-center flex-grow-1"
    >
      <div class="text-center">
        <v-icon
          icon="mdi-alert-circle-outline"
          size="48"
          color="error"
        />
        <div class="text-error mt-2">
          {{ error }}
        </div>
      </div>
    </div>
    <div
      v-else-if="!entries.length"
      class="d-flex align-center justify-center flex-grow-1"
    >
      <div class="text-center">
        <v-icon
          icon="mdi-folder-open-outline"
          size="48"
          color="grey-lighten-1"
        />
        <div class="text-grey mt-2">
          当前目录为空
        </div>
        <div class="text-body-small text-grey-lighten-1 mt-1">
          点击上方「新建目录」或「上传」添加文件
        </div>
      </div>
    </div>

    <!-- 列表 / 网格 -->
    <CustomAssetListView
      v-else-if="viewMode === 'list'"
      :entries="entries"
      @open="onEntryClick"
      @preview="openFile"
      @download="downloadFile"
      @rename="startRename"
      @delete="confirmDelete"
    />
    <CustomAssetGridView
      v-else
      :project="project"
      :current-dir="currentDir"
      :entries="entries"
      @open="onEntryClick"
      @preview="openFile"
      @download="downloadFile"
      @rename="startRename"
      @delete="confirmDelete"
    />

    <!-- 对话框 -->
    <CustomAssetPreviewDialog
      v-model="previewDialog.show"
      :file-name="previewDialog.fileName"
      :kind="previewDialog.kind"
      :url="previewDialog.url"
      :text-content="previewDialog.textContent"
      :loading="previewDialog.loading"
    />

    <CustomAssetCreateDirDialog
      v-model="showCreateDirDialog"
      v-model:name="newDirName"
      :error="newDirError"
      :loading="creatingDir"
      @confirm="createDirectory"
    />

    <CustomAssetRenameDialog
      v-model="renameDialog.show"
      v-model:name="renameDialog.newName"
      :is-dir="renameDialog.isDir"
      :error="renameDialog.error"
      :loading="renaming"
      @confirm="doRename"
    />

    <ConfirmDialog
      v-model="deleteDialog.show"
      :title="deleteDialog.title"
      :content="deleteDialog.content"
      confirm-text="删除"
      confirm-color="error"
      @confirm="doDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  readFs,
  deleteFs,
  mkdirFs,
  renameFs,
  uploadFs,
  type DirEntry,
  type DirResponse,
} from '../api/client'
import {
  buildBreadcrumbItems,
  fileUrl,
  getPreviewKind,
  isPreviewable,
  joinPath,
  relFilePath,
  validateEntryName,
  type PreviewKind,
  type ViewMode,
} from '../utils/customAssetFile'
import ConfirmDialog from './ConfirmDialog.vue'
import CustomAssetToolbar from './custom-asset/CustomAssetToolbar.vue'
import CustomAssetListView from './custom-asset/CustomAssetListView.vue'
import CustomAssetGridView from './custom-asset/CustomAssetGridView.vue'
import CustomAssetPreviewDialog from './custom-asset/CustomAssetPreviewDialog.vue'
import CustomAssetCreateDirDialog from './custom-asset/CustomAssetCreateDirDialog.vue'
import CustomAssetRenameDialog from './custom-asset/CustomAssetRenameDialog.vue'

/**
 * 自定义资产面板。
 * 负责目录状态编排，具体 UI 拆分到 custom-asset 子组件。
 */
const props = defineProps<{
  /** 当前项目名称 */
  project: string
}>()

const router = useRouter()
const route = useRoute()

const VIEW_MODE_KEY = 'custom-asset-view-mode'

/** 当前路径（相对于 assert/custom/；空串表示根目录） */
const currentDir = computed(() => (route.query.path as string) || '')

const entries = ref<DirEntry[]>([])
const loading = ref(false)
const error = ref('')

/** 视图模式，默认列表；优先读取本地偏好 */
const viewMode = ref<ViewMode>(loadViewMode())

const uploadInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const showCreateDirDialog = ref(false)
const newDirName = ref('')
const newDirError = ref('')
const creatingDir = ref(false)

const renameDialog = reactive({
  show: false,
  oldName: '',
  newName: '',
  isDir: false,
  error: '',
})
const renaming = ref(false)

const deleteDialog = reactive({
  show: false,
  title: '',
  content: '',
  targetPath: '',
})
const deleting = ref(false)

const previewDialog = reactive({
  show: false,
  fileName: '',
  kind: 'none' as PreviewKind,
  url: '',
  textContent: null as string | null,
  loading: false,
})

/** 面包屑 */
const breadcrumbItems = computed(() => buildBreadcrumbItems(currentDir.value))

/**
 * 从 localStorage 读取视图模式偏好。
 * @returns 合法的视图模式，默认 list
 */
function loadViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_MODE_KEY)
    if (saved === 'list' || saved === 'grid') return saved
  } catch {
    // ignore
  }
  return 'list'
}

/**
 * 加载当前目录内容。
 */
async function loadDir() {
  loading.value = true
  error.value = ''
  try {
    const relPath = currentDir.value ? `assert/custom/${currentDir.value}` : 'assert/custom/'
    const res = await readFs(props.project, relPath) as DirResponse
    entries.value = (res.entries ?? []).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh')
    })
  } catch (e) {
    const axiosErr = e as { response?: { status?: number } }
    if (axiosErr.response?.status === 404) {
      entries.value = []
    } else {
      error.value = '加载失败'
      entries.value = []
    }
  } finally {
    loading.value = false
  }
}

/**
 * 导航到指定子目录。
 * @param dirPath 相对 assert/custom 的路径
 */
function navigateTo(dirPath: string) {
  router.push({
    query: {
      ...route.query,
      path: dirPath || undefined,
    },
  })
}

/**
 * 点击条目：目录进入，可预览文件打开预览，其他文件直接下载。
 * @param entry 目录条目
 */
function onEntryClick(entry: DirEntry) {
  if (entry.type === 'dir') {
    navigateTo(joinPath(currentDir.value, entry.name))
    return
  }
  openFile(entry.name)
}

/**
 * 打开文件：可预览则弹窗，否则直接下载。
 * @param filename 文件名
 */
async function openFile(filename: string) {
  if (isPreviewable(filename)) {
    await previewFile(filename)
  } else {
    downloadFile(filename)
  }
}

/**
 * 在当前目录下创建子目录。
 */
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
    const fullPath = currentDir.value
      ? `assert/custom/${currentDir.value}/${name}`
      : `assert/custom/${name}`
    await mkdirFs(props.project, fullPath)
    showCreateDirDialog.value = false
    newDirName.value = ''
    await loadDir()
  } catch {
    newDirError.value = '创建失败，请重试'
  } finally {
    creatingDir.value = false
  }
}

/**
 * 触发隐藏的文件选择框。
 */
function triggerUpload() {
  uploadInput.value?.click()
}

/**
 * 处理文件选择并上传。
 * @param event input change 事件
 */
async function onUploadFiles(event: Event) {
  const input = event.target as HTMLInputElement
  // FileList 是实时集合：先清空 input 会同步清空 files，必须先拷贝出 File 对象
  const selectedFiles = input.files ? Array.from(input.files) : []
  input.value = ''
  if (!selectedFiles.length) return

  uploading.value = true
  try {
    for (const file of selectedFiles) {
      await uploadFs(props.project, relFilePath(currentDir.value, file.name), file)
    }
    await loadDir()
  } catch {
    alert('上传失败，请重试')
  } finally {
    uploading.value = false
  }
}

/**
 * 下载指定文件。
 * @param filename 文件名
 */
function downloadFile(filename: string) {
  const url = fileUrl(props.project, currentDir.value, filename)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/**
 * 按文件类型打开在线预览。
 * @param filename 文件名
 */
async function previewFile(filename: string) {
  const kind = getPreviewKind(filename)
  if (kind === 'none') {
    downloadFile(filename)
    return
  }

  const fullUrl = fileUrl(props.project, currentDir.value, filename)
  previewDialog.fileName = filename
  previewDialog.kind = kind
  previewDialog.url = fullUrl
  previewDialog.textContent = null
  previewDialog.loading = kind === 'text'
  previewDialog.show = true

  if (kind === 'text') {
    try {
      const res = await fetch(fullUrl)
      if (res.ok) {
        const text = await res.text()
        previewDialog.textContent = text.length > 50000
          ? `${text.slice(0, 50000)}\n\n...（文件过长，已截断）`
          : text
      } else {
        previewDialog.textContent = '加载文本失败'
      }
    } catch {
      previewDialog.textContent = '加载文本失败'
    } finally {
      previewDialog.loading = false
    }
  }
}

/**
 * 打开重命名对话框。
 * @param entry 目标条目
 */
function startRename(entry: DirEntry) {
  renameDialog.show = true
  renameDialog.oldName = entry.name
  renameDialog.newName = entry.name
  renameDialog.isDir = entry.type === 'dir'
  renameDialog.error = ''
}

/**
 * 执行重命名。
 */
async function doRename() {
  const nameError = validateEntryName(renameDialog.newName)
  if (nameError) {
    renameDialog.error = nameError
    return
  }
  const newName = renameDialog.newName.trim()
  renameDialog.error = ''
  renaming.value = true
  try {
    const prefix = currentDir.value ? `assert/custom/${currentDir.value}/` : 'assert/custom/'
    await renameFs(props.project, `${prefix}${renameDialog.oldName}`, `${prefix}${newName}`)
    renameDialog.show = false
    await loadDir()
  } catch {
    renameDialog.error = '重命名失败，请重试'
  } finally {
    renaming.value = false
  }
}

/**
 * 打开删除确认对话框。
 * @param entry 目标条目
 */
function confirmDelete(entry: DirEntry) {
  const prefix = currentDir.value ? `assert/custom/${currentDir.value}/` : 'assert/custom/'
  deleteDialog.targetPath = `${prefix}${entry.name}`
  deleteDialog.title = entry.type === 'dir' ? '确认删除目录' : '确认删除文件'
  deleteDialog.content = entry.type === 'dir'
    ? `确定删除目录「${entry.name}」及其所有内容？此操作不可撤销。`
    : `确定删除文件「${entry.name}」？此操作不可撤销。`
  deleteDialog.show = true
}

/**
 * 执行删除。
 */
async function doDelete() {
  deleting.value = true
  try {
    await deleteFs(props.project, deleteDialog.targetPath)
    deleteDialog.show = false
    await loadDir()
  } catch {
    alert('删除失败，请重试')
  } finally {
    deleting.value = false
  }
}

watch(currentDir, () => {
  loadDir()
}, { immediate: true })

watch(viewMode, (mode) => {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode)
  } catch {
    // ignore
  }
})

watch(showCreateDirDialog, (show) => {
  if (!show) {
    newDirName.value = ''
    newDirError.value = ''
  }
})
</script>
