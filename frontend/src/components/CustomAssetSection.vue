<template>
  <div>
    <!-- 工具栏：面包屑 + 新建目录 + 上传 + 刷新 -->
    <div class="d-flex align-center ga-2 mb-2 flex-wrap">
      <div
        class="d-flex align-center flex-grow-1"
        style="min-width: 0; overflow-x: auto;"
      >
        <template
          v-for="(crumb, i) in breadcrumbItems"
          :key="i"
        >
          <v-btn
            v-if="i > 0"
            icon="mdi-chevron-right"
            size="x-small"
            variant="text"
            density="compact"
            class="breadcrumb-sep"
            disabled
          />
          <v-btn
            variant="text"
            size="small"
            density="compact"
            class="breadcrumb-btn text-none"
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
        @click="showCreateDirDialog = true"
      >
        新建目录
      </v-btn>
      <v-btn
        size="small"
        color="primary"
        variant="tonal"
        prepend-icon="mdi-upload"
        :loading="uploading"
        :disabled="uploading"
        @click="triggerUpload"
      >
        上传
      </v-btn>
      <v-btn
        size="small"
        icon="mdi-refresh"
        variant="text"
        :disabled="loading"
        title="刷新"
        @click="loadDir"
      />
    </div>

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
      class="d-flex align-center justify-center pa-8"
    >
      <v-progress-circular
        indeterminate
        size="24"
        color="primary"
      />
    </div>
    <div
      v-else-if="!entries.length"
      class="text-grey text-body-2 pa-4 text-center"
    >
      暂无自定义资产，点击「上传」添加文件
    </div>

    <!-- 条目网格 -->
    <div
      v-else
      class="custom-grid"
    >
      <div
        v-for="entry in entries"
        :key="entry.name"
        class="custom-grid-item"
        :class="{ 'is-dir': entry.type === 'dir' }"
        @click="onEntryClick(entry)"
      >
        <div class="custom-grid-thumb">
          <img
            v-if="entry.type === 'file' && isImageFile(entry.name)"
            :src="fileUrl(props.project, relSubPath, entry.name)"
            :alt="entry.name"
            loading="lazy"
            class="custom-grid-image"
          >
          <div
            v-else
            class="custom-grid-icon-wrap"
          >
            <v-icon
              :icon="entry.type === 'dir' ? 'mdi-folder' : fileIcon(entry.name)"
              :color="entry.type === 'dir' ? 'amber-darken-1' : fileIconColor(entry.name)"
              size="40"
            />
          </div>
          <div
            v-if="entry.type === 'file' && isVideoFile(entry.name)"
            class="custom-grid-badge"
          >
            <v-icon
              icon="mdi-play-circle"
              size="18"
              color="white"
            />
          </div>
          <div
            v-else-if="entry.type === 'file' && isAudioFile(entry.name)"
            class="custom-grid-badge"
          >
            <v-icon
              icon="mdi-music"
              size="16"
              color="white"
            />
          </div>
        </div>
        <div
          class="custom-grid-name text-caption"
          :title="entry.name"
        >
          {{ entry.name }}
        </div>
        <div class="custom-grid-actions">
          <v-btn
            v-if="entry.type === 'file' && isPreviewable(entry.name)"
            icon="mdi-eye-outline"
            size="x-small"
            variant="text"
            title="预览"
            @click.stop="openFile(entry.name)"
          />
          <v-btn
            v-if="entry.type === 'file'"
            icon="mdi-download"
            size="x-small"
            variant="text"
            title="下载"
            @click.stop="downloadFile(entry.name)"
          />
          <v-btn
            icon="mdi-delete-outline"
            size="x-small"
            variant="text"
            color="error"
            title="删除"
            @click.stop="confirmDelete(entry)"
          />
        </div>
      </div>
    </div>

    <!-- 新建目录对话框 -->
    <v-dialog
      v-model="showCreateDirDialog"
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
            @click="showCreateDirDialog = false"
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

    <!-- 预览对话框 -->
    <CustomAssetPreviewDialog
      v-model="previewDialog.show"
      :file-name="previewDialog.fileName"
      :kind="previewDialog.kind"
      :url="previewDialog.url"
      :text-content="previewDialog.textContent"
      :loading="previewDialog.loading"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  readFs,
  deleteFs,
  mkdirFs,
  uploadFs,
  type DirEntry,
  type DirResponse,
} from '../api/client'
import {
  fileIcon,
  fileIconColor,
  fileUrl,
  getPreviewKind,
  isAudioFile,
  isImageFile,
  isPreviewable,
  isVideoFile,
  validateEntryName,
  type PreviewKind,
} from '../utils/customAssetFile'
import { confirm } from '../utils/confirm'
import CustomAssetPreviewDialog from './custom-asset/CustomAssetPreviewDialog.vue'

/**
 * 自定义资产分区组件。
 *
 * 为角色 / 场景 / 分镜等实体提供「自定义资产」上传与管理能力：
 * - 资产直接映射到 `assert/custom/{dirRelPath}/` 下存储读写
 * - 支持多文件上传、目录导航、预览、下载与删除（删除需二次确认）
 *
 * @example
 * ```vue
 * <CustomAssetSection :project="project" dir-rel-path="character/陈书文" />
 * ```
 */
const props = defineProps<{
  /** 当前项目名称 */
  project: string
  /** 相对 assert/custom/ 的映射目录，如 character/陈书文、stage/便利店、scene/1/2 */
  dirRelPath: string
}>()

/** 相对 assert/custom/ 的根目录路径（规范化，去掉首尾斜杠） */
const rootRelPath = computed(() => props.dirRelPath.replace(/^\/+|\/+$/g, ''))

/** 当前子目录（相对根目录，空串表示根） */
const subDir = ref('')

/** 相对 assert/custom/ 的完整目录路径 */
const relSubPath = computed(() =>
  subDir.value ? `${rootRelPath.value}/${subDir.value}` : rootRelPath.value,
)

const entries = ref<DirEntry[]>([])
const loading = ref(false)
const uploading = ref(false)

const uploadInput = ref<HTMLInputElement | null>(null)

const showCreateDirDialog = ref(false)
const newDirName = ref('')
const newDirError = ref('')
const creatingDir = ref(false)

const previewDialog = reactive({
  show: false,
  fileName: '',
  kind: 'none' as PreviewKind,
  url: '',
  textContent: null as string | null,
  loading: false,
})

/** 面包屑项（相对 assert/custom/） */
const breadcrumbItems = computed(() => {
  const parts = subDir.value ? subDir.value.split('/') : []
  const items: { title: string; disabled: boolean; path: string }[] = [
    { title: '自定义资产', disabled: subDir.value === '', path: '' },
  ]
  let accumulated = ''
  for (const part of parts) {
    accumulated = accumulated ? `${accumulated}/${part}` : part
    items.push({
      title: part,
      disabled: accumulated === subDir.value,
      path: accumulated,
    })
  }
  return items
})

/**
 * 加载当前目录内容。
 */
async function loadDir() {
  loading.value = true
  try {
    // 目录读取路径须带 assert/custom/ 前缀
    const res = await readFs(props.project, `assert/custom/${relSubPath.value}`) as DirResponse
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

/**
 * 导航到面包屑指定目录。
 * @param path 相对根目录的子路径（空串回到根）
 */
function navigateTo(path?: string) {
  subDir.value = path ?? ''
}

/**
 * 点击条目：目录进入，文件打开（可预览则预览，否则下载）。
 * @param entry 目录条目
 */
function onEntryClick(entry: DirEntry) {
  if (entry.type === 'dir') {
    subDir.value = subDir.value ? `${subDir.value}/${entry.name}` : entry.name
    return
  }
  openFile(entry.name)
}

/**
 * 触发隐藏的文件选择框。
 */
function triggerUpload() {
  uploadInput.value?.click()
}

/**
 * 处理文件选择并上传到当前目录。
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
      // 上传路径须带 assert/custom/ 前缀（服务端限制）
      const destPath = `assert/custom/${relSubPath.value}/${file.name}`
      await uploadFs(props.project, destPath, file)
    }
    await loadDir()
  } catch {
    alert('上传失败，请重试')
  } finally {
    uploading.value = false
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
    // 创建目录路径须带 assert/custom/ 前缀（服务端限制）
    const fullPath = `assert/custom/${relSubPath.value}/${name}`
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
 * 删除条目（目录递归 / 文件）。删除前弹窗确认。
 * @param entry 要删除的条目
 */
async function confirmDelete(entry: DirEntry) {
  const ok = await confirm({
    title: '确认删除',
    content: `确定删除「${entry.name}」吗？${entry.type === 'dir' ? '目录及其全部内容将被删除，' : ''}此操作不可撤销。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  try {
    // 删除路径须带 assert/custom/ 前缀（服务端限制）
    const fullPath = `assert/custom/${relSubPath.value}/${entry.name}`
    await deleteFs(props.project, fullPath)
    await loadDir()
  } catch {
    alert('删除失败，请重试')
  }
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
 * 下载指定文件。
 * @param filename 文件名
 */
function downloadFile(filename: string) {
  const url = fileUrl(props.project, relSubPath.value, filename)
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
  const fullUrl = fileUrl(props.project, relSubPath.value, filename)
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

/** 根目录或子目录变化时重新加载 */
watch([rootRelPath, subDir], () => {
  void loadDir()
}, { immediate: true })

/** 重置子目录状态（目录映射变化时） */
watch(rootRelPath, () => {
  subDir.value = ''
})

/** 目录名输入时清除错误 */
watch(newDirName, () => {
  if (newDirError.value) newDirError.value = ''
})
</script>

<style scoped>
.breadcrumb-btn {
  min-width: 0;
  letter-spacing: normal;
}

.breadcrumb-sep {
  pointer-events: none;
}

.custom-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  align-content: start;
}

.custom-grid-item {
  position: relative;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  overflow: hidden;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}

.custom-grid-item:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.custom-grid-item:hover .custom-grid-actions {
  opacity: 1;
}

.custom-grid-thumb {
  position: relative;
  height: 100px;
  background: rgba(0, 0, 0, 0.03);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.custom-grid-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.custom-grid-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.custom-grid-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}

.custom-grid-name {
  padding: 6px 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}

.custom-grid-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 6px;
  padding: 2px;
}
</style>
