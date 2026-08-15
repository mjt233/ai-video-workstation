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
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getProjects, createProject, type ProjectEntry } from '../api/client'

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

/**
 * 项目名称输入校验规则：必填、不得包含 / 或 \（与后端保持一致）、长度不超过 64。
 * 返回字符串时作为错误提示展示在输入框下方。
 */
const nameRules = [
  (v: string) => !!v?.trim() || '请输入项目名称',
  (v: string) => !/[\\/]/.test(v) || '项目名称不能包含 / 或 \\',
  (v: string) => (v?.trim()?.length ?? 0) <= 64 || '项目名称长度不能超过 64 个字符',
]

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
</script>

<style scoped>
.project-item {
  transition: background-color 0.2s;
}
.project-item:hover {
  background-color: #E3F2FD !important;
}
</style>
