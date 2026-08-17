<template>
  <v-dialog
    :model-value="modelValue"
    max-width="900"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          icon="mdi-cog"
          class="mr-2"
        />
        服务商配置
        <v-spacer />
        <v-btn
          color="primary"
          prepend-icon="mdi-plus"
          @click="openCreate"
        >
          新增服务商
        </v-btn>
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          class="ml-2"
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
        <div
          v-if="loading"
          class="d-flex justify-center pa-6"
        >
          <v-progress-circular indeterminate />
        </div>
        <template v-else>
          <div class="d-flex flex-wrap">
            <v-card
              v-for="inst in instances"
              :key="inst.id"
              class="d-inline-block ma-1"
              style="max-width: 260px;min-width: 260px;"
              variant="outlined"
              @click="openEdit(inst)"
            >
              <v-card-text class="text-caption">
                <div class="d-flex justify-space-between mb-1">
                  <span>{{ inst.name }}</span>
                  <v-chip
                    size="x-small"
                    variant="tonal"
                    color="secondary"
                    class="mr-1"
                  >
                    {{ typeName(inst.type) }}
                  </v-chip>
                </div>
                <div class="text-medium-emphasis">
                  <div>
                    已启用工作流：{{ inst.enabledWorkflows.length }} 个
                  </div>
                  <div :class="statusColor(inst.id)">
                    {{ statusLabel(inst.id) }}
                  </div>
                </div>
              </v-card-text>
              <v-card-actions>
                <v-spacer />
                <v-btn
                  icon="mdi-delete"
                  size="small"
                  variant="text"
                  color="error"
                  :title="`删除服务商「${inst.name}」`"
                  @click.stop="onDelete(inst)"
                />
              </v-card-actions>
            </v-card>
          </div>
          <v-col
            v-if="instances.length === 0"
            cols="12"
          >
            <div class="text-body-2 text-medium-emphasis text-center pa-6">
              尚未添加服务商，点击左上角「新增服务商」开始配置。
            </div>
          </v-col>
        </template>
      </v-card-text>
    </v-card>
    <ProviderInstanceDialog
      v-model="dialogOpen"
      :types="types"
      :instance="editing"
      @saved="load"
    />
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  deleteProviderInstance,
  getProviders,
  type ProviderInstanceInfo,
  type ProviderTypeInfo,
} from '../api/providers'
import { confirm } from '../utils/confirm'
import ProviderInstanceDialog from './ProviderInstanceDialog.vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const types = ref<ProviderTypeInfo[]>([])
const instances = ref<ProviderInstanceInfo[]>([])
const loading = ref(false)
const error = ref('')

/** 新增/编辑对话框状态 */
const dialogOpen = ref(false)
const editing = ref<ProviderInstanceInfo | null>(null)

/** 最近一次连接测试结果（内存态，不持久化；instanceId → 结果） */
const testStatus = ref<Record<string, { ok: boolean; message: string }>>({})

/** 加载服务商类型与实例列表 */
async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await getProviders()
    types.value = data.types
    instances.value = data.instances
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) load()
  },
)

/** 打开新增对话框 */
function openCreate() {
  editing.value = null
  dialogOpen.value = true
}

/** 打开编辑对话框 */
function openEdit(inst: ProviderInstanceInfo) {
  editing.value = inst
  dialogOpen.value = true
}

/** 删除实例（弹窗确认后执行） */
async function onDelete(inst: ProviderInstanceInfo) {
  const ok = await confirm({
    title: '删除服务商',
    content: `确定删除服务商「${inst.name}」？其提供的工作流将不可用。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  error.value = ''
  try {
    await deleteProviderInstance(inst.id)
    delete testStatus.value[inst.id]
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

/** 类型 id → 类型显示名 */
function typeName(typeId: string): string {
  return types.value.find((t) => t.id === typeId)?.name ?? typeId
}

/** 连接状态标签（未测试过显示「未测试」） */
function statusLabel(instanceId: string): string {
  const s = testStatus.value[instanceId]
  if (!s) return '未测试'
  return s.ok ? '连接正常' : '连接失败'
}

/** 连接状态颜色（成功绿色 / 失败红色 / 未测试默认） */
function statusColor(instanceId: string): string {
  const s = testStatus.value[instanceId]
  if (!s) return ''
  return s.ok ? 'text-success' : 'text-error'
}
</script>
