<template>
  <div
    v-if="declarations.length || isBridgeProvider"
    class="workflow-params-form"
  >
    <!-- ComfyUI 提供商选择（provider=comfyui-bridge 的工作流显示；选项每次挂载实时从 Bridge 拉取，不缓存） -->
    <v-select
      v-if="isBridgeProvider"
      :model-value="providerValue"
      :items="providerOptions"
      item-title="label"
      item-value="value"
      :item-props="providerItemProps"
      :loading="providersLoading"
      label="ComfyUI 提供商"
      :hint="providerHint"
      persistent-hint
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="(v) => setProviderValue(v)"
    />

    <!-- 尺寸参数（width/height）→ 通用尺寸选择组件 -->
    <WorkflowSizePicker
      v-if="sizeKeys"
      :project="project"
      :model-value="sizeModelValue"
      class="mb-2"
      @update:model-value="onSizeChange"
    />

    <template
      v-for="d in sizeFilteredDeclarations"
      :key="d.key"
    >
      <!-- 布尔参数：开关 -->
      <v-switch
        v-if="d.type === 'boolean'"
        :model-value="values[d.key] ?? d.defaultValue"
        :label="d.name"
        :hint="d.description"
        persistent-hint
        density="compact"
        hide-details
        color="primary"
        class="mb-2"
        @update:model-value="(v) => setValue(d.key, v)"
      />

      <!-- 整数 / 小数参数：数字输入框 -->
      <v-text-field
        v-else-if="d.type === 'integer' || d.type === 'float'"
        :model-value="values[d.key] ?? d.defaultValue"
        :label="d.name"
        :hint="d.description"
        persistent-hint
        type="number"
        :step="d.type === 'integer' ? '1' : 'any'"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => setValue(d.key, v)"
      />

      <!-- 字符串参数：文本输入框 -->
      <v-text-field
        v-else
        :model-value="values[d.key] ?? d.defaultValue"
        :label="d.name"
        :hint="d.description"
        persistent-hint
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => setValue(d.key, v)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import WorkflowSizePicker from './WorkflowSizePicker.vue'
import { findSizeParamKeys, mergeSizeValues } from '../utils/workflowSize'
import { getComfyuiBridgeProviders, type ComfyuiBridgeProviderInfo } from '../api/providers'
import { buildComfyuiProviderOptions, type ComfyuiProviderOption } from '../utils/comfyuiProviderOptions'
import type {
  WorkflowUserParamDeclaration,
  WorkflowUserParamValue,
} from '../api/workflow'

const props = defineProps<{
  /** 工作流参数声明列表（来自所选工作流实现） */
  declarations: WorkflowUserParamDeclaration[]
  /** 当前参数值（key → 值），仅用于外部初始化/回显 */
  modelValue: Record<string, WorkflowUserParamValue>
  /** 项目名（用于尺寸组件「使用项目尺寸」读取 project.json） */
  project?: string
  /** 服务商实例 ID（为 comfyui-bridge 类型实例时显示「ComfyUI 提供商」选择，并按实例拉取 Bridge 侧提供商） */
  provider?: string
  /** 服务商类型 ID（如 comfyui-bridge / volcengine-ark；决定是否显示「ComfyUI 提供商」选择） */
  providerType?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, WorkflowUserParamValue>): void
}>()

/** 表单内部值（key → 值） */
const values = ref<Record<string, WorkflowUserParamValue>>({})

// ── ComfyUI 提供商选择（providerType=comfyui-bridge 时显示） ─────────────────

/** 是否为 ComfyUI Easy Bridge 工作流（决定是否显示提供商下拉） */
const isBridgeProvider = computed(() => props.providerType === 'comfyui-bridge')

/** Easy Bridge 提供商实例列表（组件内本地状态，每次挂载实时拉取，不缓存） */
const bridgeProviders = ref<ComfyuiBridgeProviderInfo[]>([])
/** 提供商列表加载中标志（下拉 loading 态） */
const providersLoading = ref(false)
/** 提供商列表加载错误信息（非空时展示在 hint 中） */
const providersError = ref('')

/**
 * 拉取 Easy Bridge 提供商实例列表。
 * 每次表单挂载（对话框/面板打开）实时请求，不做任何缓存，保证选项与 Bridge 侧一致；
 * 按当前服务商实例（props.provider）拉取对应 Bridge 的提供商列表（多 Bridge 实例场景）；
 * 失败时仅记录错误（hint 展示），保留「默认」选项与已保存值回显，不阻断提交。
 */
async function loadComfyuiProviders() {
  providersLoading.value = true
  providersError.value = ''
  try {
    bridgeProviders.value = await getComfyuiBridgeProviders(props.provider)
  } catch (e) {
    providersError.value = e instanceof Error ? e.message : String(e)
  } finally {
    providersLoading.value = false
  }
}

/** 「ComfyUI 提供商」当前值（空串 = 不指定，走 Easy Bridge 默认解析） */
const providerValue = computed<string>({
  get: () => {
    const v = values.value['providerId']
    return typeof v === 'string' ? v : ''
  },
  set: (v: string) => setValue('providerId', v),
})

/** 下拉选项：默认项 + 启用实例 + （必要时）已保存但已禁用实例的回显项 */
const providerOptions = computed<ComfyuiProviderOption[]>(() =>
  buildComfyuiProviderOptions(bridgeProviders.value, providerValue.value),
)

/** 下拉 hint：加载失败时展示错误原因，否则展示选择说明 */
const providerHint = computed(() =>
  providersError.value
    ? `提供商列表加载失败：${providersError.value}`
    : '选择本次执行使用的 ComfyUI 提供商实例；留空使用 Easy Bridge 默认',
)

/**
 * v-select 的 item-props：禁用项不可选（已禁用/不存在的实例仅作已保存值回显）。
 * @param item 下拉选项
 * @returns 应用到选项上的 props（禁用项传 disabled: true）
 */
function providerItemProps(item: ComfyuiProviderOption): Record<string, unknown> {
  return item.disabled ? { disabled: true } : {}
}

/**
 * 更新提供商选择值（空串 = 不指定）。
 * @param v 实例 ID 或空串
 */
function setProviderValue(v: string | null) {
  setValue('providerId', typeof v === 'string' ? v : '')
}

// 挂载（对话框/面板打开）时实时拉取；运行中从非 Bridge 工作流切换到 Bridge 工作流时补拉
onMounted(() => {
  if (isBridgeProvider.value) void loadComfyuiProviders()
})
watch(isBridgeProvider, (isBridge) => {
  if (isBridge) void loadComfyuiProviders()
})

/** 尺寸相关 key（检测到 width + height 声明时非 null） */
const sizeKeys = computed(() => findSizeParamKeys(props.declarations))

/** 剔除尺寸相关 key 后的声明列表（其余参数仍走通用渲染） */
const sizeFilteredDeclarations = computed(() => {
  if (!sizeKeys.value) return props.declarations
  const excluded = new Set([sizeKeys.value.widthKey, sizeKeys.value.heightKey])
  if (sizeKeys.value.enableKey) excluded.add(sizeKeys.value.enableKey)
  return props.declarations.filter((d) => !excluded.has(d.key))
})

/** 尺寸组件的外部值（仅含 width/height/enable_specified_size 三个 key 的现值） */
const sizeModelValue = computed(() => {
  if (!sizeKeys.value) return {}
  const out: Record<string, WorkflowUserParamValue> = {}
  for (const k of [sizeKeys.value.widthKey, sizeKeys.value.heightKey, sizeKeys.value.enableKey]) {
    if (k && values.value[k] !== undefined) out[k] = values.value[k]
  }
  return out
})

/**
 * 尺寸组件值变化时合并进表单值。
 * 复用纯函数 `mergeSizeValues`：先清除旧的尺寸相关值，
 * 再并入组件输出中属于已声明尺寸 key 的新值。
 *
 * @param v 组件输出的尺寸值（enable_specified_size/width/height）
 */
function onSizeChange(v: Record<string, WorkflowUserParamValue>) {
  if (!sizeKeys.value) return
  values.value = mergeSizeValues(values.value, sizeKeys.value, v)
  emit('update:modelValue', { ...values.value })
}

/**
 * 根据声明初始化表单值（取各参数默认值），并回填外部已保存的值（modelValue），
 * 然后通知父组件。
 *
 * 说明：
 * - 声明为空且非 ComfyUI Bridge 工作流（如画布节点的工作流列表尚未异步加载完成）时
 *   不初始化也不回写父级，避免用空对象覆盖父级已保存的配置（如节点 config.workflowParams
 *   里的输出尺寸）；Bridge 工作流恒含 providerId 键，照常初始化。
 * - modelValue 仅用于「外部初始化/回显」——挂载或声明变化时，把其中属于已声明
 *   key 的非空值覆盖到默认值之上。这样画布节点等场景在配置面板重挂载后能正确
 *   回显已保存的配置组合（如输出尺寸），不会退化为默认值；modelValue 为空对象时
 *   则与旧行为一致（全部使用默认值）。
 * - ComfyUI 提供商选择（保留键 providerId）不属于工作流参数声明：Bridge 工作流表单
 *   额外恢复 modelValue.providerId（非空字符串）或置空串（不指定，Bridge 默认解析）。
 *
 * @param decls 参数声明列表
 */
function initFromDefaults(decls: WorkflowUserParamDeclaration[]) {
  if (!decls.length && !isBridgeProvider.value) return
  const next: Record<string, WorkflowUserParamValue> = {}
  for (const d of decls) next[d.key] = d.defaultValue
  const saved = props.modelValue
  if (saved && typeof saved === 'object') {
    for (const d of decls) {
      const v = saved[d.key]
      if (v !== undefined && v !== null) next[d.key] = v
    }
  }
  if (isBridgeProvider.value) {
    const savedProviderId = saved?.['providerId']
    next['providerId'] = typeof savedProviderId === 'string' && savedProviderId !== '' ? savedProviderId : ''
  }
  values.value = next
  emit('update:modelValue', { ...next })
}

// 声明变化（如切换工作流实现）时，按新默认值重置表单
// immediate：组件挂载即初始化；父组件必须传入稳定的声明数组引用，避免重复触发
watch(
  () => props.declarations,
  (decls) => initFromDefaults(decls ?? []),
  { immediate: true, deep: true },
)

/**
 * 更新单个参数值并通知父组件。
 *
 * @param key 参数字段 key
 * @param val 用户输入的原生值（boolean / number / string）
 */
function setValue(key: string, val: unknown) {
  values.value = { ...values.value, [key]: val as WorkflowUserParamValue }
  emit('update:modelValue', { ...values.value })
}

/**
 * 重置表单为声明默认值。
 * 父组件可在打开对话框等需要“恢复默认”的场景调用。
 */
function reset() {
  initFromDefaults(props.declarations)
}

defineExpose({ reset })
</script>
