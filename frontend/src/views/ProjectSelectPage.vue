<template>
  <v-container
    class="d-flex align-center justify-center"
    style="height: 80vh"
  >
    <v-card
      min-width="420"
      class="pa-2"
      style="overflow: hidden"
    >
      <v-card-title class="d-flex align-center text-primary text-headline-small font-weight-bold">
        <v-icon
          icon="mdi-folder-open"
          class="mr-2"
          color="primary"
        />
        选择项目
        <v-spacer />
        <v-btn
          color="primary"
          variant="tonal"
          size="small"
          prepend-icon="mdi-upload"
          class="mr-2"
          @click="openImportDialog"
        >
          导入项目
        </v-btn>
        <v-btn
          color="primary"
          variant="tonal"
          size="small"
          prepend-icon="mdi-plus"
          :disabled="creating"
          @click="openCreateDialog"
        >
          新建项目
        </v-btn>
      </v-card-title>
      <v-divider class="mb-2" />
      <v-card-text>
        <div
          v-if="loading"
          class="d-flex justify-center pa-4"
        >
          <v-progress-circular
            indeterminate
            color="primary"
          />
        </div>
        <v-list v-else-if="projects.length">
          <v-list-item
            v-for="p in projects"
            :key="p.name"
            class="rounded mb-1"
            @click="openProject(p.name)"
          >
            <template #prepend>
              <v-icon color="primary">
                mdi-folder
              </v-icon>
            </template>
            <v-list-item-title class="font-weight-medium">
              {{ p.name }}
            </v-list-item-title>
          </v-list-item>
        </v-list>
        <v-empty-state
          v-else
          icon="mdi-folder-plus-outline"
          title="暂无项目"
          text="点击右上角「新建项目」创建你的第一个项目"
        />
      </v-card-text>
    </v-card>

    <!-- 新建项目对话框 -->
    <v-dialog
      v-model="createDialog"
      max-width="420"
      persistent
    >
      <v-card>
        <v-card-title class="text-primary font-weight-bold">
          <v-icon
            icon="mdi-plus-circle-outline"
            class="mr-2"
            color="primary"
          />
          新建项目
        </v-card-title>
        <v-divider class="mb-2" />
        <v-card-text>
          <v-text-field
            v-model="newProjectName"
            label="项目名称"
            variant="outlined"
            autofocus
            :rules="nameRules"
            :error-messages="createError"
            :disabled="creating"
            @keyup.enter="submitCreate"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="creating"
            @click="createDialog = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            variant="tonal"
            :loading="creating"
            @click="submitCreate"
          >
            创建
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <!-- 导入项目对话框 -->
    <v-dialog
      v-model="importDialog"
      max-width="480"
      persistent
    >
      <v-card>
        <v-card-title class="text-primary font-weight-bold">
          <v-icon
            icon="mdi-upload"
            class="mr-2"
            color="primary"
          />
          导入项目
        </v-card-title>
        <v-divider class="mb-2" />
        <v-card-text>
          <v-alert
            v-if="importError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-2"
          >
            {{ importError }}
          </v-alert>
          <v-file-input
            v-model="importFile"
            label="选择项目压缩包（.zip）"
            accept=".zip"
            variant="outlined"
            prepend-icon="mdi-file-zip-outline"
            :disabled="importing"
            :rules="[v => !v || (Array.isArray(v) ? v.length : 1) === 1 || '仅支持选择 1 个文件']"
          />
          <v-text-field
            v-model="importName"
            label="项目名称（已预填压缩包内原始项目名，可修改）"
            variant="outlined"
            :disabled="importing"
            :rules="importNameRules"
          />
          <v-progress-linear
            v-if="importing"
            :model-value="importProgress"
            :indeterminate="importProgress >= 100"
            color="primary"
            class="mt-2"
          />
          <div
            v-if="importing"
            class="text-body-small text-medium-emphasis mt-1"
          >
            {{ importProgress >= 100 ? '正在解压并写入项目…' : `正在上传… ${importProgress}%` }}
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="importing"
            @click="importDialog = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            variant="tonal"
            :loading="importing"
            :disabled="!importFile"
            @click="submitImport"
          >
            导入
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getProjects, createProject, importProject, ProjectImportError, type ProjectEntry } from '../api/client'
import { confirm } from '../utils/confirm'
import { detectZipProjectName } from '../utils/detectZipName'

const router = useRouter()

/** 项目列表数据 */
const projects = ref<ProjectEntry[]>([])
/** 项目列表加载中标记（用于区分「加载中」与「空列表」） */
const loading = ref(true)
/** 新建项目对话框是否打开 */
const createDialog = ref(false)
/** 新建项目请求进行中标记 */
const creating = ref(false)
/** 新建项目名称输入 */
const newProjectName = ref('')
/** 新建项目接口返回的错误信息（如重名、非法名称） */
const createError = ref('')
/** 导入项目对话框是否打开 */
const importDialog = ref(false)
/** 导入选中的 zip 文件（v-file-input 可能返回 File 或 File[]，统一按数组处理） */
const importFile = ref<File | File[] | null>(null)
/** 导入项目名称（选择文件后自动预填压缩包内原始项目名，用户可修改） */
const importName = ref('')
/** 导入请求进行中标记 */
const importing = ref(false)
/** 导入上传进度（0-100；达到 100 表示上传完成，进入服务端解压阶段） */
const importProgress = ref(0)
/** 导入接口返回的错误信息（如格式错误、重名） */
const importError = ref('')
/** 文件名称探测序号：防止用户连续选择文件时旧探测结果覆盖新结果 */
let detectSeq = 0

/**
 * 项目名称输入校验规则：必填、不得包含 / 或 \（与后端保持一致）、长度不超过 64。
 * 返回字符串时作为错误提示展示在输入框下方。
 */
const nameRules = [
  (v: string) => !!v?.trim() || '请输入项目名称',
  (v: string) => !/[\\/]/.test(v) || '项目名称不能包含 / 或 \\',
  (v: string) => (v?.trim()?.length ?? 0) <= 64 || '项目名称长度不能超过 64 个字符',
]

/**
 * 导入名称校验规则：允许为空（由服务端自动识别兜底），
 * 非空时格式须与新建项目一致（不含 / 或 \、长度不超过 64）。
 */
const importNameRules = [
  (v: string) => !v?.trim() || !/[\\/]/.test(v) || '项目名称不能包含 / 或 \\',
  (v: string) => !v?.trim() || (v?.trim()?.length ?? 0) <= 64 || '项目名称长度不能超过 64 个字符',
]

// 选择 zip 文件后，探测压缩包内原始项目名并预填到名称输入框
watch(importFile, async (value) => {
  const file = Array.isArray(value) ? value?.[0] : value
  const seq = ++detectSeq
  if (!file) {
    importName.value = ''
    return
  }
  const name = await detectZipProjectName(file)
  if (seq === detectSeq) importName.value = name
})

onMounted(loadProjects)

/**
 * 加载项目列表；无论成功失败都结束 loading，保证空列表时能显示引导文案。
 */
async function loadProjects() {
  loading.value = true
  try {
    projects.value = await getProjects()
  } catch (e) {
    console.error('加载项目列表失败:', e)
  } finally {
    loading.value = false
  }
}

/**
 * 打开指定项目（URL 查询参数形式，项目名做编码避免特殊字符破坏路由）。
 * @param name 项目名
 */
function openProject(name: string) {
  router.push('/project?project=' + encodeURIComponent(name))
}

/** 打开新建项目对话框并清空上次输入与错误信息 */
function openCreateDialog() {
  createError.value = ''
  newProjectName.value = ''
  createDialog.value = true
}

/**
 * 提交创建空项目：调用后端接口创建目录骨架，成功后刷新列表并直接进入新项目。
 * 失败时把后端返回的错误信息展示在输入框下方。
 */
async function submitCreate() {
  const name = newProjectName.value.trim()
  if (!name) return
  createError.value = ''
  creating.value = true
  try {
    await createProject(name)
    createDialog.value = false
    newProjectName.value = ''
    await loadProjects()
    openProject(name)
  } catch (e) {
    console.error('创建项目失败:', e)
    const err = e as { response?: { data?: { error?: string } } }
    createError.value = err.response?.data?.error || '创建失败，请稍后重试'
  } finally {
    creating.value = false
  }
}

/** 打开导入项目对话框并清空上次输入、文件与错误信息 */
function openImportDialog() {
  importError.value = ''
  importName.value = ''
  importFile.value = null
  importProgress.value = 0
  importDialog.value = true
}

/** 取 v-file-input 选中的第一个文件（v-model 可能是 File 或 File[]） */
function pickedFile(): File | null {
  const v = importFile.value
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/** 去掉文件名 .zip 后缀（大小写不敏感），用于冲突确认弹窗的兜底项目名 */
function stripZipSuffix(filename: string): string {
  return filename.replace(/\.zip$/i, '')
}

/**
 * 展示导入错误信息。
 * @param e 未知错误；ProjectImportError 时展示服务端文案，其余展示通用提示
 */
function handleImportError(e: unknown) {
  console.error('导入项目失败:', e)
  importError.value = e instanceof ProjectImportError ? e.message : '导入失败，请稍后重试'
}

/**
 * 执行一次导入请求（支持覆盖模式）。
 * 同名冲突（409）且未覆盖时弹出确认对话框，用户确认后自动以覆盖模式重试；
 * 成功时关闭对话框、刷新列表并进入新项目。
 *
 * @param overwrite 是否允许覆盖同名项目
 * @returns 是否导入成功
 */
async function performImport(overwrite: boolean): Promise<boolean> {
  const file = pickedFile()
  if (!file) return false
  try {
    const res = await importProject(file, {
      name: importName.value.trim() || undefined,
      overwrite,
      onProgress: (p) => { importProgress.value = p },
    })
    importDialog.value = false
    importFile.value = null
    await loadProjects()
    openProject(res.name)
    return true
  } catch (e) {
    if (e instanceof ProjectImportError && e.status === 409) {
      const target = e.conflictName || importName.value.trim() || stripZipSuffix(file.name)
      const ok = await confirm({
        title: '覆盖导入',
        content: `项目「${target}」已存在，覆盖导入将删除现有项目数据，是否继续？`,
        confirmText: '覆盖导入',
        confirmColor: 'error',
      })
      if (ok) return performImport(true)
    }
    handleImportError(e)
    return false
  }
}

/**
 * 提交导入：显示上传进度，冲突时经确认后覆盖，成功进入新项目。
 */
async function submitImport() {
  if (!pickedFile() || importing.value) return
  importError.value = ''
  importProgress.value = 0
  importing.value = true
  try {
    await performImport(false)
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.project-item {
  transition: background-color 0.2s;
}
.project-item:hover {
  background-color: #E3F2FD !important;
}
</style>
