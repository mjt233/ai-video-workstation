<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
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

        <!-- 编辑时：工作流列表（默认全选） -->
        <template v-if="isEdit">
          <v-divider class="my-3" />
          <div class="text-body-medium mb-2 font-weight-medium">
            可用工作流
            <span class="text-caption text-medium-emphasis ml-1">
              （默认全选；Bridge 工作流随远程配置实时刷新）
            </span>
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
          <v-checkbox
            v-for="wf in workflowEntries"
            :key="wf.key"
            v-model="form.enabledWorkflows"
            :value="wf.key"
            :label="wf.name"
            :hint="wf.description"
            density="compact"
            hide-details
          />
          <div
            v-if="!workflowsLoading && !workflowsError && workflowEntries.length === 0"
            class="text-body-2 text-medium-emphasis"
          >
            该服务商暂无可用的工作流。
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
  getInstanceWorkflows,
  testProviderConnection,
  updateProviderInstance,
  type ProviderConfigField,
  type ProviderInstanceInfo,
  type ProviderTypeInfo,
  type ProviderWorkflowEntry,
} from '../api/providers'

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
  config: Record<string, string | number | boolean>
  enabledWorkflows: string[]
}>({
  type: '',
  name: '',
  config: {},
  enabledWorkflows: [],
})

const error = ref('')
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const showSecret = ref<Record<string, boolean>>({})

/** 工作流列表状态（编辑模式） */
const workflowsLoading = ref(false)
const workflowsError = ref('')
const workflowEntries = ref<ProviderWorkflowEntry[]>([])

/** 构建表单初始值：secret 字段恒为空；其余用已保存值或 defaultValue */
function buildForm(type: string, config: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const t = props.types.find((x) => x.id === type)
  const formConfig: Record<string, string | number | boolean> = {}
  for (const f of t?.configSchema ?? []) {
    if (f.secret) {
      formConfig[f.key] = ''
    } else if (config[f.key] !== undefined) {
      formConfig[f.key] = config[f.key]
    } else if (f.defaultValue !== undefined) {
      formConfig[f.key] = f.defaultValue
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
        enabledWorkflows: [...props.instance.enabledWorkflows],
      }
      void loadWorkflows()
    } else {
      // 新增模式：重置
      form.value = { type: '', name: '', config: {}, enabledWorkflows: [] }
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
}

/** 拉取该实例当前工作流列表（Bridge 实时 / 静态返回） */
async function loadWorkflows() {
  if (!props.instance) return
  workflowsLoading.value = true
  workflowsError.value = ''
  try {
    const entries = await getInstanceWorkflows(props.instance.id)
    workflowEntries.value = entries
    // 合并已保存的启用集合：新增项默认勾选（默认全选），消失项从启用集合清理
    const saved = new Set(form.value.enabledWorkflows)
    const current = new Set(entries.map((e) => e.key))
    const merged = entries.filter((e) => saved.has(e.key) || true).map((e) => e.key)
    // 保留仍存在的已启用项 + 新增项（默认全选）；消失项自动剔除
    form.value.enabledWorkflows = merged.filter((k) => current.has(k))
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
    testResult.value = await testProviderConnection(form.value.type, { ...form.value.config })
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
        enabledWorkflows: form.value.enabledWorkflows,
      })
    } else {
      await createProviderInstance({
        type: form.value.type,
        name: form.value.name,
        config: { ...form.value.config },
        enabledWorkflows: form.value.enabledWorkflows,
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
</script>