<template>
  <div
    v-if="declarations.length || isBridgeProvider || showSizePicker"
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

    <!-- 统一尺寸配置（capabilities.size 或 width/height 声明存在时渲染）：
         单行文字 + v-menu 面板，输出 WorkflowSizeConfig，同时兼容回写 enable/width/height 标量 -->
    <WorkflowSizePicker
      v-if="showSizePicker"
      :size-capabilities="sizeCapabilities"
      :model-value="sizeConfig"
      class="mb-2"
      @update:model-value="onSizeConfigChange"
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

      <!-- 下拉候选参数（string 类型且候选项非空）—— 多选：combobox 多选，选中项 value 以英文逗号拼接提交 -->
      <v-combobox
        v-else-if="isCandidateField(d) && isMultipleCandidate(d)"
        :model-value="candidateValues(d)"
        :items="candidateItems(d)"
        item-title="label"
        item-value="value"
        :return-object="true"
        multiple
        chips
        closable-chips
        :label="d.name"
        :hint="d.description"
        persistent-hint
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => setCandidateValue(d, v)"
      />

      <!-- 下拉候选参数 —— 单选且允许自定义输入：combobox（可输入候选项之外的值，原样提交） -->
      <v-combobox
        v-else-if="isCandidateField(d) && allowCustomInput(d)"
        :model-value="candidateSingleValue(d)"
        :items="candidateItems(d)"
        item-title="label"
        item-value="value"
        :return-object="true"
        :label="d.name"
        :hint="d.description"
        persistent-hint
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => setCandidateValue(d, v)"
      />

      <!-- 下拉候选参数 —— 单选严格下拉（不允许自定义输入）：select -->
      <v-select
        v-else-if="isCandidateField(d)"
        :model-value="candidateSingleValue(d)"
        :items="candidateItems(d)"
        item-title="label"
        item-value="value"
        :label="d.name"
        :hint="d.description"
        persistent-hint
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => setCandidateValue(d, v)"
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
import { findSizeParamKeys, inferSizeConfigFromWidthHeight, mergeSizeValues } from '../utils/workflowSize'
import {
  allowCustomInput,
  candidateSubmitValue,
  cleanCandidateSavedValue,
  hasCandidates,
  joinMultiValue,
  normalizeCandidates,
  splitMultiValue,
} from '../utils/userParamOptions'
import { getComfyuiBridgeProviders, type ComfyuiBridgeProviderInfo } from '../api/providers'
import { buildComfyuiProviderOptions, type ComfyuiProviderOption } from '../utils/comfyuiProviderOptions'
import type {
  WorkflowSizeConfig,
  WorkflowUserParamCandidate,
  WorkflowUserParamDeclaration,
  WorkflowUserParamValue,
} from '../api/workflow'

const props = defineProps<{
  /** 工作流参数声明列表（来自所选工作流实现） */
  declarations: WorkflowUserParamDeclaration[]
  /** 当前参数值（key → 值），仅用于外部初始化/回显 */
  modelValue: Record<string, WorkflowUserParamValue>
  /** 项目名（预留：尺寸组件未来可能的项目尺寸模式） */
  project?: string
  /** 服务商实例 ID（为 comfyui-bridge 类型实例时显示「ComfyUI 提供商」选择，并按实例拉取 Bridge 侧提供商） */
  provider?: string
  /** 服务商类型 ID（如 comfyui-bridge / volcengine-ark；决定是否显示「ComfyUI 提供商」选择） */
  providerType?: string
  /** 工作流输出尺寸能力声明（capabilities.size；存在时渲染统一尺寸配置组件） */
  sizeCapabilities?: { ratio?: string[]; size?: string[]; supportCustomSize?: boolean }
  /** 外部回显的统一尺寸配置（已持久化的 sizeConfig；缺省时从保存的 width/height 标量反推） */
  modelSizeConfig?: WorkflowSizeConfig | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, WorkflowUserParamValue>): void
  (e: 'update:sizeConfig', v: WorkflowSizeConfig): void
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

/** 尺寸相关 key（检测到 width + height 声明时非 null；兼容未声明 capabilities.size 的旧工作流） */
const sizeKeys = computed(() => findSizeParamKeys(props.declarations))

/** 是否渲染统一尺寸组件：工作流声明了 capabilities.size，或声明了 width/height 参数（旧约定） */
const showSizePicker = computed(() => !!(sizeKeys.value || props.sizeCapabilities))

/** 剔除尺寸相关 key 后的声明列表（其余参数仍走通用渲染） */
const sizeFilteredDeclarations = computed(() => {
  if (!showSizePicker.value) return props.declarations
  const excluded = new Set<string>()
  for (const key of ['width', 'height', 'enable_specified_size']) {
    if (props.declarations.some((d) => d.key === key)) excluded.add(key)
  }
  return props.declarations.filter((d) => !excluded.has(d.key))
})

/** 当前统一尺寸配置（组件双向；初始来自 props.modelSizeConfig 或保存的宽高标量反推） */
const sizeConfig = ref<WorkflowSizeConfig>({ ratio: 'auto', size: 'auto' })

/**
 * 统一尺寸组件值变化时：
 * 1. 更新内部 sizeConfig 并通知父级（父级持久化/提交 params.sizeConfig）；
 * 2. 兼容回写 enable_specified_size / width / height 标量进表单值
 *    （仅写入已声明的 key，保证旧 vars 读取链路与任务回显不中断）。
 *
 * @param v 组件输出的统一尺寸配置
 */
function onSizeConfigChange(v: WorkflowSizeConfig) {
  sizeConfig.value = v
  if (sizeKeys.value) {
    const w = Number(v.width)
    const h = Number(v.height)
    const has = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
    const incoming: Record<string, WorkflowUserParamValue> = {}
    if (sizeKeys.value.enableKey) incoming[sizeKeys.value.enableKey] = has
    incoming[sizeKeys.value.widthKey] = has ? w : ''
    incoming[sizeKeys.value.heightKey] = has ? h : ''
    values.value = mergeSizeValues(values.value, sizeKeys.value, incoming)
  }
  emit('update:sizeConfig', v)
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
 * - 统一尺寸配置：优先外部传入的已保存 sizeConfig（props.modelSizeConfig）；
 *   否则从保存的 width/height 标量反推（旧数据兼容），反推不出则自动/自动。
 *
 * @param decls 参数声明列表
 */
function initFromDefaults(decls: WorkflowUserParamDeclaration[]) {
  // 统一尺寸配置回显独立于参数声明：优先已保存的 sizeConfig，否则从 width/height 标量反推
  const saved = props.modelValue
  if (props.modelSizeConfig && (props.modelSizeConfig.ratio || props.modelSizeConfig.size)) {
    sizeConfig.value = props.modelSizeConfig
  } else if (saved && typeof saved === 'object') {
    const inferred = inferSizeConfigFromWidthHeight(saved['width'], saved['height'])
    sizeConfig.value = {
      ratio: inferred.ratio,
      size: inferred.size,
      ...(inferred.width != null && inferred.height != null
        ? { width: inferred.width, height: inferred.height }
        : {}),
    }
  }
  if (!decls.length && !isBridgeProvider.value) return
  const next: Record<string, WorkflowUserParamValue> = {}
  for (const d of decls) next[d.key] = d.defaultValue
  if (saved && typeof saved === 'object') {
    for (const d of decls) {
      const v = saved[d.key]
      if (v === undefined || v === null) continue
      // 下拉字段清洗历史脏值：早期版本把 v-combobox 选中的候选对象直接持久化，
      // 产生对象值或 "[object Object]" 串（单值/拼接段），无法与候选项对应 → 回退声明默认值
      if (hasCandidates(d)) {
        const cleaned = cleanCandidateSavedValue(v, d.multiple === true)
        if (cleaned !== null) next[d.key] = cleaned
        continue
      }
      next[d.key] = v
    }
  }
  if (isBridgeProvider.value) {
    const savedProviderId = saved?.['providerId']
    next['providerId'] = typeof savedProviderId === 'string' && savedProviderId !== '' ? savedProviderId : ''
  }
  values.value = next
  emit('update:modelValue', { ...next })
  emit('update:sizeConfig', sizeConfig.value)
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

// ── 下拉候选参数（string 类型且候选项非空） ─────────────────────────────────

/**
 * 判断声明是否按下拉控件渲染（string 类型且存在有效候选项）。
 * @param d 参数声明
 */
function isCandidateField(d: WorkflowUserParamDeclaration): boolean {
  return hasCandidates(d)
}

/**
 * 判断下拉声明是否为多选（多选时选中项 value 以英文逗号拼接为一个字符串提交）。
 * @param d 参数声明
 */
function isMultipleCandidate(d: WorkflowUserParamDeclaration): boolean {
  return d.multiple === true
}

/**
 * 取规范化后的下拉候选项（过滤非法项、label 缺省回退 value）。
 * @param d 参数声明
 * @returns 候选项数组（label 展示 / value 提交）
 */
function candidateItems(d: WorkflowUserParamDeclaration) {
  return normalizeCandidates(d.candidates)
}

/**
 * 取字段的当前生效值（未填写时回退声明默认值）。
 * @param d 参数声明
 * @returns 字符串形式的当前值
 */
function candidateRawValue(d: WorkflowUserParamDeclaration): string {
  const v = values.value[d.key]
  return v !== undefined && v !== null && v !== '' ? String(v) : String(d.defaultValue ?? '')
}

/**
 * 把已存的提交值字符串映射为下拉 model：命中候选项时传候选对象
 * （combobox returnObject 模式按 itemTitle 显示 label），未命中按自由输入字符串原样显示。
 *
 * @param d 参数声明
 * @param raw 已存的提交值字符串
 * @returns 候选对象或原始字符串
 */
function candidateModelValue(d: WorkflowUserParamDeclaration, raw: string): string | WorkflowUserParamCandidate {
  return candidateItems(d).find((o) => o.value === raw) ?? raw
}

/**
 * 多选下拉的当前 model：逗号拼接串 → 值数组，并反查为候选对象（显示 label）。
 * @param d 参数声明
 */
function candidateValues(d: WorkflowUserParamDeclaration): Array<string | WorkflowUserParamCandidate> {
  return splitMultiValue(candidateRawValue(d)).map((v) => candidateModelValue(d, v))
}

/**
 * 单选下拉的当前 model：已存值反查候选对象（显示 label），自由输入值原样字符串显示。
 * @param d 参数声明
 */
function candidateSingleValue(d: WorkflowUserParamDeclaration): string | WorkflowUserParamCandidate {
  return candidateModelValue(d, candidateRawValue(d))
}

/**
 * 把下拉的单个更新值解析为提交值：先经 candidateSubmitValue 还原（对象/字符串），
 * 再反查候选项——命中 value 直接用；恰好等于某候选项 label（用户手打展示名）时
 * 解析为该候选项的 value；都不是则按自由输入原样保留。
 *
 * @param d 参数声明
 * @param v 下拉更新值（候选对象 / 字符串）
 * @returns 提交值字符串
 */
function resolveCandidateValue(d: WorkflowUserParamDeclaration, v: unknown): string {
  const s = candidateSubmitValue(v)
  if (s === '') return ''
  const items = candidateItems(d)
  return (items.find((o) => o.value === s) ?? items.find((o) => o.label === s))?.value ?? s
}

/**
 * 下拉值变化时写回表单：v-combobox 默认 returnObject，更新值可能是候选对象
 * （选中项）或字符串（自由输入），统一解析为提交值——多选用英文逗号拼接为一个
 * 字符串，单选直存（清空时空串 = 不提交）；随后通知父组件。
 *
 * @param d 参数声明
 * @param v combobox / select 的 model 值（多选为数组，单选为单个值）
 */
function setCandidateValue(d: WorkflowUserParamDeclaration, v: unknown) {
  if (isMultipleCandidate(d)) {
    const arr = (Array.isArray(v) ? v : [v]).map((x) => resolveCandidateValue(d, x))
    setValue(d.key, joinMultiValue(arr))
  } else {
    setValue(d.key, resolveCandidateValue(d, v))
  }
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
