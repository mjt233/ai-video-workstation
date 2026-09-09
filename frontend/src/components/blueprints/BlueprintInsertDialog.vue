<template>
  <v-dialog
    :model-value="modelValue"
    max-width="760"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          icon="mdi-vector-square"
          class="mr-2"
        />
        插入画布蓝图
        <v-spacer />
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>

      <v-card-text class="blueprint-insert">
        <!-- 作用域 + 项目 + 搜索 -->
        <div class="blueprint-insert__toolbar">
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
            class="blueprint-insert__project"
          />
          <v-text-field
            v-model="keyword"
            label="搜索蓝图"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-magnify"
            hide-details
            clearable
            class="blueprint-insert__search"
          />
        </div>

        <v-alert
          v-if="error"
          type="error"
          density="compact"
          class="mt-2"
          :text="error"
          closable
          @click:close="error = ''"
        />

        <!-- 蓝图列表 -->
        <div class="blueprint-insert__list">
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
            {{ keyword.trim() ? '没有匹配的蓝图' : '该作用域下还没有蓝图（可在画布多选节点后点「创建蓝图」）' }}
          </div>
          <v-list
            v-else
            density="compact"
            nav
            select-strategy="single-independent"
          >
            <v-list-item
              v-for="item in filtered"
              :key="item.id"
              :active="selectedId === item.id"
              color="primary"
              @click="selectedId = item.id"
            >
              <template #prepend>
                <v-icon icon="mdi-vector-square" />
              </template>
              <v-list-item-title>
                {{ item.name }}
                <span
                  v-if="item.description"
                  class="text-body-small text-medium-emphasis ml-2"
                >{{ item.description }}</span>
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ item.nodeCount }} 个节点 · {{ item.connectionCount }} 条连线 · {{ item.groupCount }} 个分组
                <span v-if="item.assetProject"> · 资产项目 {{ item.assetProject }}</span>
                <span class="ml-2">{{ formatTime(item.updatedAt) }}</span>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </div>

        <!-- 资产项目不一致的非阻塞提示 -->
        <v-alert
          v-if="assetProjectMismatch"
          type="info"
          density="compact"
          variant="tonal"
          class="mt-2"
          :text="`该蓝图的资产项目为「${selected?.assetProject}」，当前画布项目为「${canvasProject}」，节点内引用的资产可能不存在（插入后可在画布中重新选择资产）。`"
        />

        <!-- 以独立分组插入 -->
        <v-checkbox
          v-model="asGroup"
          class="mt-2"
          density="comfortable"
          hide-details
          label="以独立分组插入"
        />
        <div class="text-body-small text-medium-emphasis">
          勾选后自动创建名为蓝图名称的分组，蓝图内的全部节点与分组嵌套放置在该分组中。
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="emit('update:modelValue', false)"
        >
          取消
        </v-btn>
        <v-btn
          color="primary"
          :loading="inserting"
          :disabled="!selected"
          prepend-icon="mdi-import"
          @click="onInsert"
        >
          插入
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getProjects } from '../../api/client'
import { getBlueprint, listBlueprints, type BlueprintScope } from '../../api/blueprints'
import type { BlueprintListItem, CanvasBlueprint } from '../../canvas/blueprint'

/**
 * 「插入画布蓝图」对话框：在全局 / 项目级作用域中选择蓝图并插入当前画布。
 *
 * 仅负责选择与取详情；实例化（id 重映射、坐标归一化、独立分组）与写入画布
 * 由父级（AssetCanvas）经 `canvas/blueprint.ts: instantiateBlueprint` + `store.applyEntities` 完成。
 */
const props = defineProps<{
  /** 对话框显隐（v-model） */
  modelValue: boolean
  /** 当前画布项目名（项目级作用域的默认项目 + 资产项目不一致提示） */
  canvasProject: string
}>()

const emit = defineEmits<{
  /** 显隐变化 */
  (e: 'update:modelValue', value: boolean): void
  /** 确认插入（蓝图详情 + 是否以独立分组插入） */
  (e: 'insert', blueprint: CanvasBlueprint, asGroup: boolean): void
}>()

/** 作用域：全局 / 项目 */
const scope = ref<BlueprintScope>('project')
/** 项目级作用域的目标项目 */
const project = ref(props.canvasProject)
/** 项目列表 */
const projects = ref<string[]>([])
/** 搜索关键字 */
const keyword = ref('')
/** 蓝图列表（摘要） */
const list = ref<BlueprintListItem[]>([])
/** 列表加载中 */
const loading = ref(false)
/** 插入中（取详情） */
const inserting = ref(false)
/** 选中的蓝图 id */
const selectedId = ref('')
/** 是否以独立分组插入 */
const asGroup = ref(true)
/** 错误提示 */
const error = ref('')

/** 按关键字过滤后的蓝图列表 */
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list.value
  return list.value.filter(
    (b) => b.name.toLowerCase().includes(kw) || b.description.toLowerCase().includes(kw),
  )
})

/** 当前选中的蓝图摘要 */
const selected = computed(() => list.value.find((b) => b.id === selectedId.value) ?? null)

/** 资产项目与当前画布项目是否不一致（不一致时显示非阻塞提示） */
const assetProjectMismatch = computed(() => {
  const ap = selected.value?.assetProject
  return !!ap && !!props.canvasProject && ap !== props.canvasProject
})

/**
 * 加载项目列表（失败输出日志并保留当前项目）。
 */
async function loadProjects(): Promise<void> {
  try {
    const entries = await getProjects()
    projects.value = entries.map((p) => p.name)
    if (!project.value || !projects.value.includes(project.value)) {
      project.value = props.canvasProject || projects.value[0] || ''
    }
  } catch (e) {
    console.error('[blueprint] 加载项目列表失败', e)
  }
}

/**
 * 按当前作用域加载蓝图摘要列表（失败时提示并置空）。
 */
async function loadList(): Promise<void> {
  if (scope.value === 'project' && !project.value) {
    list.value = []
    return
  }
  loading.value = true
  error.value = ''
  try {
    list.value = await listBlueprints(
      scope.value === 'project' ? { scope: 'project', project: project.value } : { scope: 'global' },
    )
    // 选中项在新列表中不存在时清空（切换作用域/项目后）
    if (!list.value.some((b) => b.id === selectedId.value)) selectedId.value = ''
  } catch (e) {
    list.value = []
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// 打开时初始化并加载
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    scope.value = 'project'
    project.value = props.canvasProject
    keyword.value = ''
    selectedId.value = ''
    asGroup.value = true
    error.value = ''
    void loadProjects()
    void loadList()
  },
)

// 作用域/项目变化时重新加载
watch([scope, project], () => {
  if (props.modelValue) void loadList()
})

/**
 * 确认插入：取蓝图详情后上抛（详情获取失败时提示，不关闭对话框）。
 */
async function onInsert(): Promise<void> {
  const item = selected.value
  if (!item) return
  inserting.value = true
  error.value = ''
  try {
    const ref = scope.value === 'project' ? { scope: 'project' as const, project: project.value } : { scope: 'global' as const }
    const blueprint = await getBlueprint(ref, item.id)
    emit('insert', blueprint, asGroup.value)
    emit('update:modelValue', false)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    inserting.value = false
  }
}

/**
 * 更新时间格式化（相对时间粗粒度展示）。
 *
 * @param iso ISO 时间字符串
 * @returns 展示文案（如「3 分钟前」）
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
.blueprint-insert {
  display: flex;
  flex-direction: column;
}

.blueprint-insert__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.blueprint-insert__project {
  width: 200px;
}

.blueprint-insert__search {
  flex: 1 1 200px;
  min-width: 180px;
}

.blueprint-insert__list {
  max-height: 320px;
  overflow-y: auto;
  margin-top: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 6px;
}
</style>
