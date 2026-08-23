<template>
  <div class="mt-2">
    <div class="d-flex align-center mb-2">
      <div class="text-body-medium font-weight-medium">
        {{ label || '工作流配置' }}
      </div>
      <v-spacer />
      <v-btn
        color="secondary"
        variant="tonal"
        size="small"
        prepend-icon="mdi-plus"
        @click="openCreate"
      >
        新增工作流
      </v-btn>
    </div>
    <div
      v-if="description"
      class="text-caption text-medium-emphasis mb-2"
    >
      {{ description }}
    </div>

    <!-- 工作流列表 -->
    <div
      v-if="entries.length === 0"
      class="text-body-2 text-medium-emphasis mb-2"
    >
      尚未添加工作流。点击「新增工作流」配置名称、类型与三段调用代码。
    </div>
    <v-table
      v-else
      density="comfortable"
    >
      <thead>
        <tr>
          <th class="text-left">
            工作流名称
          </th>
          <th class="text-left">
            类型
          </th>
          <th class="text-right">
            操作
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, index) in entries"
          :key="index"
        >
          <td>
            <div class="d-flex align-center">
              <span class="text-body-2">{{ row.name }}</span>
              <v-chip
                v-if="row.async"
                size="x-small"
                variant="tonal"
                color="info"
                class="ml-2"
              >
                异步
              </v-chip>
              <v-chip
                v-if="row.cancelable"
                size="x-small"
                variant="tonal"
                color="warning"
                class="ml-1"
              >
                可取消
              </v-chip>
            </div>
          </td>
          <td>
            <v-chip
              v-for="t in row.types"
              :key="t"
              :color="workflowTypeColor(t)"
              size="x-small"
              variant="tonal"
              class="mr-1"
            >
              {{ workflowTypeLabel(t) }}
            </v-chip>
          </td>
          <td class="text-right">
            <v-btn
              icon="mdi-pencil"
              size="small"
              variant="text"
              :title="'编辑工作流「' + row.name + '」'"
              @click="openEdit(index)"
            />
            <v-btn
              icon="mdi-delete"
              size="small"
              variant="text"
              color="error"
              :title="'删除工作流「' + row.name + '」'"
              @click="removeEntry(index)"
            />
          </td>
        </tr>
      </tbody>
    </v-table>

    <!-- 新增/编辑工作流表单对话框 -->
    <v-dialog
      v-model="dialogOpen"
      max-width="1100"
      scrollable
    >
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon
            icon="mdi-server-network"
            class="mr-2"
          />
          {{ editingIndex === null ? '新增工作流' : '编辑工作流' }}
          <v-spacer />
          <v-btn
            icon="mdi-close"
            size="small"
            variant="text"
            @click="dialogOpen = false"
          />
        </v-card-title>
        <v-card-text>
          <v-alert
            v-if="formError"
            type="error"
            class="mb-3"
            :text="formError"
            closable
            @click:close="formError = ''"
          />

          <!-- 工作流名称 -->
          <v-text-field
            v-model="form.name"
            label="工作流名称"
            placeholder="如 gpt-image-2"
            hint="在提供商侧唯一；用户代码中以该名称作为模型/工作流标识"
            persistent-hint
            density="comfortable"
            variant="outlined"
            class="mb-2"
          />

          <!-- 工作流类型（多选） -->
          <v-select
            v-model="form.types"
            :items="typeOptions"
            item-title="title"
            item-value="value"
            label="工作流类型"
            hint="选择该工作流支持的系统工作流类型（可多选）；ctx.params 按所选类型动态提示"
            persistent-hint
            density="comfortable"
            variant="outlined"
            multiple
            chips
            class="mb-2"
          />

          <!-- 是否异步 / 是否支持取消 -->
          <div class="d-flex ga-6 mb-2">
            <v-switch
              v-model="form.async"
              label="是否异步请求"
              hint="异步：结果提取反复调用直到 isFinish；非异步：结果提取仅调用一次"
              persistent-hint
              color="primary"
              density="comfortable"
            />
            <v-switch
              v-model="form.cancelable"
              label="是否支持取消"
              hint="勾选后需编写「取消调用」代码，任务可被用户中断"
              persistent-hint
              color="warning"
              density="comfortable"
            />
          </div>

          <!-- 用户配置字段：运行工作流时用户填写的自定义字段 -->
          <v-divider class="mb-2" />
          <div class="d-flex align-center mb-1">
            <div class="text-body-medium font-weight-medium">
              用户配置字段
            </div>
            <v-spacer />
            <v-btn
              color="secondary"
              variant="tonal"
              size="small"
              prepend-icon="mdi-plus"
              @click="addUserConfigField"
            >
              新增字段
            </v-btn>
          </div>
          <div class="text-caption text-medium-emphasis mb-2">
            运行工作流时表单按声明渲染，用户填写后可在代码中通过
            <code>ctx.userConfig.字段key</code> 读取（类型按字段声明自动提示）。
          </div>
          <v-table
            v-if="form.userConfigFields.length"
            density="compact"
          >
            <thead>
              <tr>
                <th class="text-left">
                  key
                </th>
                <th class="text-left">
                  显示名
                </th>
                <th class="text-left">
                  类型
                </th>
                <th class="text-left">
                  默认值
                </th>
                <th class="text-left">
                  说明
                </th>
                <th class="text-right" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(field, i) in form.userConfigFields"
                :key="i"
              >
                <td style="min-width: 120px">
                  <v-text-field
                    v-model="field.key"
                    placeholder="如 model"
                    density="compact"
                    variant="outlined"
                    hide-details
                  />
                </td>
                <td style="min-width: 110px">
                  <v-text-field
                    v-model="field.name"
                    placeholder="如 模型名称"
                    density="compact"
                    variant="outlined"
                    hide-details
                  />
                </td>
                <td style="min-width: 100px">
                  <v-select
                    v-model="field.type"
                    :items="userConfigFieldTypeOptions"
                    item-title="title"
                    item-value="value"
                    density="compact"
                    variant="outlined"
                    hide-details
                  />
                </td>
                <td style="min-width: 110px">
                  <v-text-field
                    v-model="field.defaultValue"
                    placeholder="如 gpt-image-2"
                    density="compact"
                    variant="outlined"
                    hide-details
                  />
                </td>
                <td style="min-width: 140px">
                  <v-text-field
                    v-model="field.description"
                    placeholder="表单 hint（可选）"
                    density="compact"
                    variant="outlined"
                    hide-details
                  />
                </td>
                <td class="text-right">
                  <v-btn
                    icon="mdi-delete"
                    size="small"
                    variant="text"
                    color="error"
                    :title="'删除字段「' + (field.key || '未命名') + '」'"
                    @click="removeUserConfigField(i)"
                  />
                </td>
              </tr>
            </tbody>
          </v-table>
          <div
            v-else
            class="text-caption text-medium-emphasis mb-2"
          >
            尚未配置用户配置字段。点击「新增字段」添加运行工作流时需要用户填写的参数。
          </div>

          <!-- 代码编辑页签 -->
          <v-divider class="mb-2" />
          <v-tabs
            v-model="tab"
            density="comfortable"
          >
            <v-tab value="call">
              调用发起
            </v-tab>
            <v-tab value="extract">
              结果提取
            </v-tab>
            <v-tab
              v-if="form.cancelable"
              value="cancel"
            >
              取消调用
            </v-tab>
          </v-tabs>
          <div
            v-if="tab === 'call'"
            class="mt-2"
          >
            <div class="d-flex align-center mb-1">
              <span class="text-caption text-medium-emphasis">
                export default async function(ctx: WorkflowCallContext) —— 返回 http 请求配置（由系统执行该请求）
              </span>
              <v-spacer />
              <v-btn
                color="secondary"
                variant="tonal"
                size="small"
                prepend-icon="mdi-file-code-outline"
                title="插入「调用发起」代码模板"
                @click="insertTabTemplate('call')"
              >
                插入模板
              </v-btn>
            </div>
            <MonacoEditor
              v-model="form.callCode"
              :extra-libs="editorLibs"
              :refresh-key="dialogOpen ? 1 : 0"
              :height="360"
            />
          </div>
          <div
            v-else-if="tab === 'extract'"
            class="mt-2"
          >
            <div class="d-flex align-center mb-1">
              <span class="text-caption text-medium-emphasis">
                export default async function(ctx: WorkflowCallContext, callResult: WorkflowCallResult): Promise&lt;WorkflowResult&gt;
              </span>
              <v-spacer />
              <v-btn
                color="secondary"
                variant="tonal"
                size="small"
                prepend-icon="mdi-file-code-outline"
                title="插入「结果提取」代码模板"
                @click="insertTabTemplate('extract')"
              >
                插入模板
              </v-btn>
            </div>
            <MonacoEditor
              v-model="form.extractCode"
              :extra-libs="editorLibs"
              :refresh-key="dialogOpen ? 1 : 0"
              :height="360"
            />
          </div>
          <div
            v-else-if="tab === 'cancel'"
            class="mt-2"
          >
            <div class="d-flex align-center mb-1">
              <span class="text-caption text-medium-emphasis">
                export default async function(ctx: WorkflowCallContext, callResult: WorkflowCallResult)
              </span>
              <v-spacer />
              <v-btn
                color="secondary"
                variant="tonal"
                size="small"
                prepend-icon="mdi-file-code-outline"
                title="插入「取消调用」代码模板"
                @click="insertTabTemplate('cancel')"
              >
                插入模板
              </v-btn>
            </div>
            <MonacoEditor
              v-model="form.cancelCode"
              :extra-libs="editorLibs"
              :refresh-key="dialogOpen ? 1 : 0"
              :height="360"
            />
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="dialogOpen = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            @click="saveEntry"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import MonacoEditor from '../monaco/MonacoEditor.vue'
import { confirm } from '../../utils/confirm'
import { getWorkflowTypes } from '../../api/providers'
import { workflowTypeColor, workflowTypeLabel, FALLBACK_WORKFLOW_TYPES } from '../../utils/workflow-types'
import {
  buildCommonGlobalsLib,
  buildContextLib,
  CALL_CODE_TEMPLATE,
  CANCEL_CODE_TEMPLATE,
  EXTRACT_CODE_TEMPLATE,
  insertCodeTemplate,
  normalizeWorkflowEntries,
  validateWorkflowEntry,
  type CustomWorkflowFormEntry,
  type UserConfigFieldDef,
  type UserConfigFieldType,
} from '../../utils/custom-provider'

const props = defineProps<{
  /** 当前工作流列表（结构化数组，由父级 v-model 绑定） */
  modelValue?: unknown
  /** 字段中文标签 */
  label?: string
  /** 字段说明 */
  description?: string
  /** 通用代码块文本（用于生成代码提示：导出的函数在工作流代码中可全局调用） */
  commonCode?: unknown
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: CustomWorkflowFormEntry[]): void
}>()

/** 规范化后的工作流条目列表 */
const entries = computed<CustomWorkflowFormEntry[]>(() => normalizeWorkflowEntries(props.modelValue))

/** 系统工作流类型下拉选项（GET /api/workflow-types；失败回退内置 5 类） */
const workflowTypes = ref<string[]>([])
const typesError = ref('')

/**
 * 工作流类型下拉选项（对象形式：value = 类型 id，title = 中文标签）。
 *
 * 必须显式指定 item-value 为类型 id，避免 Vuetify 对纯字符串 items + 函数
 * item-title 时把展示用中文标签写回 v-model，导致保存后服务端校验失败。
 */
const typeOptions = computed(() =>
  workflowTypes.value.map((id) => ({ title: workflowTypeLabel(id), value: id })),
)

/** 用户配置字段类型下拉选项（value 与 WorkflowUserParamType 一致，复用运行表单） */
const userConfigFieldTypeOptions = [
  { title: '字符串', value: 'string' },
  { title: '整数', value: 'integer' },
  { title: '小数', value: 'float' },
  { title: '布尔', value: 'boolean' },
] as Array<{ title: string; value: UserConfigFieldType }>

/** 表单对象类型：userConfigFields 在表单内恒存在（数组） */
type WorkflowFormEntry = CustomWorkflowFormEntry & { userConfigFields: UserConfigFieldDef[] }

/** 表单对话框状态 */
const dialogOpen = ref(false)
/** 正在编辑的条目下标（null = 新增） */
const editingIndex = ref<number | null>(null)
const tab = ref('call')
const formError = ref('')
const form = ref<WorkflowFormEntry>({
  name: '',
  types: [],
  async: false,
  cancelable: false,
  callCode: '',
  extractCode: '',
  cancelCode: '',
  userConfigFields: [],
})

/** 代码编辑器类型库：按所选类型动态组合 ctx.params 类型 + 通用代码导出全局声明 */
const editorLibs = computed(() => {
  const libs: Array<{ content: string; filePath: string }> = [
    { content: buildContextLib(form.value.types, form.value.userConfigFields), filePath: 'custom-context.d.ts' },
  ]
  const common = typeof props.commonCode === 'string' ? props.commonCode : ''
  const globals = buildCommonGlobalsLib(common)
  if (globals.trim()) {
    libs.push({ content: globals, filePath: 'custom-common-globals.d.ts' })
  }
  return libs
})

onMounted(() => {
  void loadWorkflowTypes()
})

/**
 * 拉取系统支持的工作流类型（下拉数据源）；失败回退内置类型并在表单下方提示。
 */
async function loadWorkflowTypes() {
  try {
    workflowTypes.value = await getWorkflowTypes()
  } catch (e) {
    typesError.value = e instanceof Error ? e.message : String(e)
    workflowTypes.value = [...FALLBACK_WORKFLOW_TYPES]
  }
}

/** 回写一份新的工作流列表（保持不可变更新） */
function commit(next: CustomWorkflowFormEntry[]) {
  emit('update:modelValue', next)
}

/** 打开新增表单（代码留空，由用户点击「插入模板」或自行编写） */
function openCreate() {
  editingIndex.value = null
  formError.value = ''
  tab.value = 'call'
  form.value = {
    name: '',
    types: [],
    async: false,
    cancelable: false,
    callCode: '',
    extractCode: '',
    cancelCode: '',
    userConfigFields: [],
  }
  dialogOpen.value = true
}

/**
 * 向当前页签对应代码插入模板（空编辑器直接填充；已有代码在末尾追加）。
 *
 * @param kind 页签种类（call / extract / cancel）
 */
function insertTabTemplate(kind: 'call' | 'extract' | 'cancel') {
  const template = kind === 'call'
    ? CALL_CODE_TEMPLATE
    : kind === 'extract'
      ? EXTRACT_CODE_TEMPLATE
      : CANCEL_CODE_TEMPLATE
  if (kind === 'call') form.value.callCode = insertCodeTemplate(form.value.callCode, template)
  else if (kind === 'extract') form.value.extractCode = insertCodeTemplate(form.value.extractCode, template)
  else form.value.cancelCode = insertCodeTemplate(form.value.cancelCode, template)
}

/** 打开编辑表单（回填选中条目） */
function openEdit(index: number) {
  const row = entries.value[index]
  if (!row) return
  editingIndex.value = index
  formError.value = ''
  tab.value = 'call'
  form.value = {
    name: row.name,
    types: [...row.types],
    async: row.async,
    cancelable: row.cancelable,
    callCode: row.callCode,
    extractCode: row.extractCode,
    cancelCode: row.cancelCode,
    userConfigFields: (row.userConfigFields ?? []).map((field) => ({ ...field })),
  }
  dialogOpen.value = true
}

/** 新增一行用户配置字段（默认字符串类型，key 留空由用户填写） */
function addUserConfigField() {
  form.value.userConfigFields = [
    ...(form.value.userConfigFields ?? []),
    { key: '', name: '', type: 'string', defaultValue: '', description: '' } as UserConfigFieldDef,
  ]
}

/** 删除指定下标的用户配置字段 */
function removeUserConfigField(index: number) {
  form.value.userConfigFields = (form.value.userConfigFields ?? []).filter((_, i) => i !== index)
}

/** 保存表单：校验后新增或更新条目 */
function saveEntry() {
  const errors = validateWorkflowEntry(form.value)
  if (errors.length > 0) {
    formError.value = errors.join('；')
    return
  }
  if (editingIndex.value === null) {
    commit([...entries.value, { ...form.value }])
  } else {
    commit(entries.value.map((row, i) => (i === editingIndex.value ? { ...form.value } : row)))
  }
  dialogOpen.value = false
}

/** 删除条目（弹窗确认后执行） */
async function removeEntry(index: number) {
  const row = entries.value[index]
  const ok = await confirm({
    title: '删除工作流',
    content: '确定删除工作流「' + (row?.name || '未命名') + '」？保存后对应工作流将注销。',
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  commit(entries.value.filter((_, i) => i !== index))
}

/** 取消勾选「支持取消」时若正停留在取消页签，切回「调用发起」 */
watch(
  () => form.value.cancelable,
  (value) => {
    if (!value && tab.value === 'cancel') tab.value = 'call'
  },
)
</script>
