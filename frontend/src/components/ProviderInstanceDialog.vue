<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          icon="mdi-server"
          class="mr-2"
        />
        {{ isEdit ? '编辑服务商' : '新增服务商' }}
        <v-spacer />
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text>
        <v-alert
          v-if="error"
          type="error"
          class="mb-3"
          :text="error"
          closable
          @click:close="error = ''"
        />

        <!-- 新增时第一步：选服务商类型 -->
        <v-select
          v-if="!isEdit"
          v-model="form.type"
          :items="types"
          item-title="name"
          item-value="id"
          label="服务商类型"
          hint="选择服务商类型后按对应参数配置"
          persistent-hint
          density="comfortable"
          variant="outlined"
          class="mb-2"
          @update:model-value="onTypeChange"
        />

        <!-- 实例名称 -->
        <v-text-field
          v-model="form.name"
          label="实例名称"
          placeholder="如：火山方舟-主账号"
          hint="用于区分多个同类型服务商，展示在卡片与工作流下拉中"
          persistent-hint
          density="comfortable"
          variant="outlined"
          class="mb-2"
        />

        <!-- 参数表单（configSchema 驱动） -->
        <template v-if="schemaFields.length">
          <v-switch
            v-for="f in booleanFields"
            :key="f.key"
            v-model="form.config[f.key]"
            :label="f.label"
            :hint="f.description"
            persistent-hint
            color="primary"
            class="mt-0"
          />
          <v-select
            v-for="f in selectFields"
            :key="f.key"
            v-model="form.config[f.key]"
            :label="f.label"
            :items="f.options ?? []"
            item-title="label"
            item-value="value"
            :hint="f.description"
            persistent-hint
            density="comfortable"
            class="mt-2"
            variant="outlined"
          />
          <v-text-field
            v-for="f in textFields"
            :key="f.key"
            v-model="form.config[f.key]"
            :label="f.label"
            :type="fieldInputType(f)"
            :append-inner-icon="f.type === 'password' ? (showSecret[f.key] ? 'mdi-eye-off' : 'mdi-eye') : undefined"
            :placeholder="f.placeholder"
            :hint="f.description"
            persistent-hint
            density="comfortable"
            class="mt-2"
            variant="outlined"
            @click:append-inner="toggleSecret(f)"
          />
          <component
            :is="resolveProviderFieldComponent(f.component)"
            v-for="f in componentFields"
            :key="f.key"
            :model-value="form.config[f.key]"
            :label="f.label"
            :description="f.description"
            :name="f.component || ''"
            v-bind="componentExtraProps(f)"
            @update:model-value="form.config[f.key] = $event"
          />
        </template>

        <!-- 自定义服务商：配置导入 / 导出（导出包含 API Key，注意保管） -->
        <template v-if="form.type === CUSTOM_PROVIDER_TYPE_ID">
          <v-divider class="my-3" />
          <div class="d-flex align-center">
            <div class="text-body-medium font-weight-medium">
              配置导入 / 导出
            </div>
            <v-spacer />
            <v-btn
              color="secondary"
              variant="tonal"
              size="small"
              prepend-icon="mdi-export"
              title="导出为 JSON 配置文件（包含 API Key）"
              @click="exportConfig"
            >
              导出配置
            </v-btn>
            <v-btn
              color="secondary"
              variant="tonal"
              size="small"
              prepend-icon="mdi-import"
              class="ml-2"
              title="从 JSON 配置文件导入"
              @click="importInput?.click()"
            >
              导入配置
            </v-btn>
            <input
              ref="importInput"
              type="file"
              accept="application/json,.json"
              class="d-none"
              @change="onImportFile"
            >
          </div>
          <div class="text-caption text-medium-emphasis mt-1">
            导出文件包含 API Key 等全部配置，请妥善保管。
          </div>
          <v-alert
            v-if="importNotice"
            type="success"
            class="mt-2 mb-0"
            :text="importNotice"
            density="compact"
            closable
            @click:close="importNotice = ''"
          />
        </template>

        <!-- 连接测试 -->
        <div class="d-flex align-center mt-3">
          <v-btn
            color="secondary"
            variant="tonal"
            :loading="testing"
            :disabled="!form.type"
            @click="onTest"
          >
            测试连接
          </v-btn>
          <v-alert
            v-if="testResult"
            :type="testResult.ok ? 'success' : 'error'"
            class="ml-3 flex-grow-1 mb-0"
            :text="testResult.message"
            density="compact"
          />
        </div>

        <!-- 工作流预览：获取按钮 + 类型标识（只读；该服务商全部工作流默认可用） -->
        <template v-if="form.type">
          <v-divider class="my-3" />
          <div class="d-flex align-center mb-2">
            <div class="text-body-medium font-weight-medium">
              工作流预览
            </div>
            <v-spacer />
            <v-btn
              color="secondary"
              variant="tonal"
              size="small"
              :loading="workflowsLoading"
              @click="loadWorkflows"
            >
              <v-icon
                icon="mdi-refresh"
                size="small"
                class="mr-1"
              />
              获取工作流列表
            </v-btn>
          </div>
          <div
            v-if="workflowsLoading"
            class="d-flex justify-center pa-4"
          >
            <v-progress-circular
              indeterminate
              size="small"
            />
          </div>
          <v-alert
            v-else-if="workflowsError"
            type="warning"
            class="mb-2"
            :text="workflowsError"
            density="compact"
          />
          <div
            v-for="wf in workflowEntries"
            :key="wf.key"
            class="d-flex align-center py-1"
          >
            <v-chip
              v-if="wf.type"
              :color="workflowTypeColor(wf.type)"
              size="x-small"
              variant="tonal"
              class="mr-2"
            >
              {{ workflowTypeLabel(wf.type) }}
            </v-chip>
            <span class="text-body-2">{{ wf.name }}</span>
          </div>
          <div
            v-if="!workflowsLoading && !workflowsError && workflowEntries.length === 0"
            class="text-body-2 text-medium-emphasis"
          >
            尚未获取工作流，点击「获取工作流列表」查看当前配置下的可用工作流。
          </div>
        </template>
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
          :loading="saving"
          :disabled="!form.type || !form.name"
          @click="onSave"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  createProviderInstance,
  fetchProviderWorkflows,
  testProviderConnection,
  updateProviderInstance,
  type ProviderConfigField,
  type ProviderConfigValue,
  type ProviderInstanceInfo,
  type ProviderTypeInfo,
  type ProviderWorkflowEntry,
} from '../api/providers'
import { resolveProviderFieldComponent } from './provider-fields'
import { workflowTypeColor, workflowTypeLabel } from '../utils/workflow-types'

const props = defineProps<{
  modelValue: boolean
  /** 服务商类型列表（新增时选择） */
  types: ProviderTypeInfo[]
  /** 编辑目标实例；null = 新增模式 */
  instance: ProviderInstanceInfo | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}>()

/** 是否为编辑模式 */
const isEdit = computed(() => !!props.instance)

/** 当前类型对应的 configSchema */
const schemaFields = computed<ProviderConfigField[]>(() => {
  const t = props.types.find((x) => x.id === form.value.type)
  return t?.configSchema ?? []
})

/** 表单状态 */
const form = ref<{
  type: string
  name: string
  config: Record<string, ProviderConfigValue>
}>({
  type: '',
  name: '',
  config: {},
})

const error = ref('')
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const showSecret = ref<Record<string, boolean>>({})

/** 工作流列表状态（获取按钮 / 编辑自动加载共用） */
const workflowsLoading = ref(false)
const workflowsError = ref('')
const workflowEntries = ref<ProviderWorkflowEntry[]>([])

/** 自定义服务商类型 id（命中时显示配置导入/导出） */
const CUSTOM_PROVIDER_TYPE_ID = 'custom'
/** 配置导入文件选择器 */
const importInput = ref<HTMLInputElement | null>(null)
/** 导入成功提示 */
const importNotice = ref('')

/**
 * 深拷贝 component 字段默认值 / 已保存值，避免多个实例共享同一引用。
 * @param value 原始值
 * @returns 拷贝后的值；无法序列化时原样返回
 */
function cloneConfigValue(value: ProviderConfigValue): ProviderConfigValue {
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value)) as ProviderConfigValue
    } catch {
      return value
    }
  }
  return value
}

/**
 * 计算 component 字段的额外 props：
 * 一律传入 schema 字段本身（供代码编辑器按字段 key 选模板）；
 * 工作流配置组件额外注入通用代码文本（供 Monaco 生成通用代码导出提示）。
 *
 * @param f schema 字段
 * @returns 附加 props
 */
function componentExtraProps(f: ProviderConfigField): Record<string, unknown> {
  const out: Record<string, unknown> = { field: f }
  // 工作流编辑器注入通用代码（生成导出函数提示）；测试代码编辑器同样注入；
  // 通用代码块自身不注入（编辑时无需提示自己的导出）
  if (f.component === 'CustomWorkflowsEditorField'
    || (f.component === 'CustomCodeEditorField' && f.key !== 'commonCode')) {
    out.commonCode = form.value.config.commonCode
  }
  return out
}

/** 构建表单初始值：secret 字段恒为空；其余用已保存值或 defaultValue */
function buildForm(type: string, config: Record<string, ProviderConfigValue>): Record<string, ProviderConfigValue> {
  const t = props.types.find((x) => x.id === type)
  const formConfig: Record<string, ProviderConfigValue> = {}
  for (const f of t?.configSchema ?? []) {
    if (f.secret) {
      formConfig[f.key] = ''
    } else if (config[f.key] !== undefined) {
      formConfig[f.key] = cloneConfigValue(config[f.key])
    } else if (f.defaultValue !== undefined) {
      formConfig[f.key] = cloneConfigValue(f.defaultValue)
    } else if (f.type === 'component') {
      formConfig[f.key] = []
    } else {
      formConfig[f.key] = f.type === 'boolean' ? false : ''
    }
  }
  return formConfig
}

/** 打开时初始化表单 */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    error.value = ''
    testResult.value = null
    if (props.instance) {
      // 编辑模式：用实例数据初始化
      form.value = {
        type: props.instance.type,
        name: props.instance.name,
        config: buildForm(props.instance.type, props.instance.config),
      }
      void loadWorkflows()
    } else {
      // 新增模式：重置
      form.value = { type: '', name: '', config: {} }
      workflowEntries.value = []
      workflowsError.value = ''
    }
  },
)

/** 切换类型时重建配置表单（保留已填的非冲突字段） */
function onTypeChange() {
  const prev = form.value.config
  form.value.config = buildForm(form.value.type, prev)
  testResult.value = null
  // 类型切换后清空工作流预览，避免残留上一类型的条目
  workflowEntries.value = []
  workflowsError.value = ''
}

/**
 * 拉取工作流预览：使用当前表单配置调用后端（新增模式无实例；编辑模式携带
 * instanceId，服务端对空白的 secret 字段回填已保存值）。结果仅作展示，
 * 服务商全部工作流默认可用，与预览勾选无关。
 */
async function loadWorkflows() {
  const type = form.value.type
  if (!type) return
  workflowsLoading.value = true
  workflowsError.value = ''
  try {
    workflowEntries.value = await fetchProviderWorkflows(type, { ...form.value.config }, props.instance?.id)
  } catch (e) {
    workflowsError.value = e instanceof Error ? e.message : String(e)
  } finally {
    workflowsLoading.value = false
  }
}

/** 连接测试：用当前表单参数调用后端（不落盘） */
async function onTest() {
  if (!form.value.type) return
  testing.value = true
  testResult.value = null
  error.value = ''
  try {
    testResult.value = await testProviderConnection(form.value.type, { ...form.value.config }, props.instance?.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    testing.value = false
  }
}

/** 保存：新增或更新实例 */
async function onSave() {
  saving.value = true
  error.value = ''
  try {
    if (props.instance) {
      await updateProviderInstance(props.instance.id, {
        name: form.value.name,
        config: { ...form.value.config },
      })
    } else {
      await createProviderInstance({
        type: form.value.type,
        name: form.value.name,
        config: { ...form.value.config },
      })
    }
    emit('saved')
    emit('update:modelValue', false)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

function toggleSecret(f: ProviderConfigField) {
  showSecret.value[f.key] = !showSecret.value[f.key]
}

function fieldInputType(f: ProviderConfigField): string {
  if (f.type === 'number') return 'number'
  if (f.type === 'password') {
    return showSecret.value[f.key] ? 'text' : 'password'
  }
  return 'text'
}

const booleanFields = computed(() => schemaFields.value.filter((f) => f.type === 'boolean'))
const selectFields = computed(() => schemaFields.value.filter((f) => f.type === 'select'))
const textFields = computed(() =>
  schemaFields.value.filter((f) => f.type === 'string' || f.type === 'password' || f.type === 'number'),
)
/** type=component 的自定义字段（按映射表渲染） */
const componentFields = computed(() => schemaFields.value.filter((f) => f.type === 'component'))

/**
 * 导出配置：把当前表单（type/name/config，含 API Key）序列化为 JSON 文件下载。
 */
function exportConfig() {
  const payload = {
    type: form.value.type,
    name: form.value.name,
    config: { ...form.value.config },
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'custom-provider-' + (form.value.name.trim() || 'config') + '.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * 导入配置：读取 JSON 文件并回填表单（name + config；API Key 直接恢复）。
 *
 * 校验 type 必须为 custom；config 中已存在的 schema 键回填，其余键并入。
 *
 * @param event 文件输入 change 事件
 */
function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result)) as {
        type?: unknown
        name?: unknown
        config?: unknown
      }
      if (parsed.type !== CUSTOM_PROVIDER_TYPE_ID) {
        error.value = '导入失败：文件不是自定义服务商配置（type 必须为 custom）'
        importNotice.value = ''
        return
      }
      if (typeof parsed.name === 'string' && parsed.name.trim()) {
        form.value.name = parsed.name.trim()
      }
      if (parsed.config && typeof parsed.config === 'object' && !Array.isArray(parsed.config)) {
        const rec = parsed.config as Record<string, unknown>
        for (const [key, value] of Object.entries(rec)) {
          form.value.config[key] = value as ProviderConfigValue
        }
      }
      error.value = ''
      testResult.value = null
      importNotice.value = '已导入配置：' + file.name
    } catch {
      error.value = '导入失败：文件不是合法的 JSON'
      importNotice.value = ''
    }
  }
  reader.readAsText(file)
}
</script>