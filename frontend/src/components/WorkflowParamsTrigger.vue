<template>
  <div class="workflow-params-trigger">
    <v-menu
      v-model="menu"
      :close-on-content-click="false"
      offset="4"
      :max-width="420"
    >
      <template #activator="{ props: menuProps }">
        <!-- 类输入框外观的触发行：显示「工作流参数」+ 已配置项数量徽标，点击弹出配置面板 -->
        <div
          v-bind="menuProps"
          class="workflow-params-trigger__trigger"
          role="button"
          title="点击配置工作流参数"
        >
          <v-icon
            size="small"
            class="workflow-params-trigger__icon"
          >
            mdi-tune-variant
          </v-icon>
          <span class="workflow-params-trigger__text">{{ displayText }}</span>
          <v-icon
            size="small"
            class="workflow-params-trigger__caret"
          >
            mdi-chevron-down
          </v-icon>
        </div>
      </template>

      <v-card
        min-width="340"
        max-width="420"
      >
        <v-card-text class="pa-3">
          <!-- 参数表单：声明参数 + ComfyUI 提供商（复用 WorkflowParamsForm） -->
          <WorkflowParamsForm
            v-model="innerValue"
            :declarations="declarations"
            :provider="provider"
            :provider-type="providerType"
            :project="project"
          />
          <div
            v-if="hasNoFormContent"
            class="text-body-small text-grey"
          >
            该工作流无自定义参数
          </div>
        </v-card-text>
      </v-card>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { WorkflowUserParamDeclaration, WorkflowUserParamValue } from '../api/workflow'
import WorkflowParamsForm from './WorkflowParamsForm.vue'

/**
 * 工作流参数菜单配置控件：类输入框触发行点击弹出菜单，菜单内嵌 WorkflowParamsForm
 * （布尔开关 / 数字 / 文本 / ComfyUI 提供商等）。触发行附带「已配置非默认参数数量」
 * 徽标，让用户无需展开即可感知是否做过自定义。
 *
 * 注意：输出尺寸（WorkflowSizePicker）由生成节点编辑器在其参数行内独立提供，
 * 本组件不接收尺寸能力声明，也无需处理尺寸相关 key 的剔除——由编排编辑器在
 * 传入 declarations 前过滤（复用 findSizeParamKeys）。
 *
 * 值同步与各编辑器既有做法一致：本地 ref 与外部 modelValue 双向同步，
 * 相等性守卫避免「本地 → emit → config → 本地」循环。
 */
const props = withDefaults(
  defineProps<{
    /** 工作流参数值（key → 值；与节点 config.workflowParams 双向同步） */
    modelValue?: Record<string, WorkflowUserParamValue>
    /** 工作流参数声明列表（来自所选工作流实现；尺寸 key 已由编排编辑器剔除） */
    declarations?: WorkflowUserParamDeclaration[]
    /** 项目名（透传 WorkflowParamsForm） */
    project?: string
    /** 服务商实例 ID（为 comfyui-bridge 时显示「ComfyUI 提供商」选择） */
    provider?: string
    /** 服务商类型 ID（comfyui-bridge 时显示「ComfyUI 提供商」选择） */
    providerType?: string
  }>(),
  {
    modelValue: () => ({}),
    declarations: () => [],
    project: '',
    provider: '',
    providerType: '',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, WorkflowUserParamValue>): void
}>()

/** 配置菜单是否展开 */
const menu = ref(false)

/** 本地参数值（WorkflowParamsForm 双向绑定目标） */
const innerValue = ref<Record<string, WorkflowUserParamValue>>({})

/** 是否为 ComfyUI Bridge 工作流（含 providerId 表单 — 表单始终有内容可配置） */
const isBridge = computed(() => props.providerType === 'comfyui-bridge')

/** 是否有表单内容（声明参数或 Bridge 提供商选择；空时显示「无自定义参数」占位） */
const hasNoFormContent = computed(
  () => props.declarations.length === 0 && !isBridge.value,
)

/**
 * 已配置的非默认参数数量（触发行徽标）：
 * 每个声明参数的值与默认值不同计 1；Bridge 的 providerId 非空计 1。
 * 为 0 时不显示数量（触发行仅显示「工作流参数」）。
 */
const configuredCount = computed(() => {
  let n = 0
  for (const d of props.declarations) {
    const v = props.modelValue?.[d.key]
    if (v === undefined || v === null) continue
    if (JSON.stringify(v) !== JSON.stringify(d.defaultValue)) n++
  }
  const pid = props.modelValue?.['providerId']
  if (typeof pid === 'string' && pid !== '') n++
  return n
})

/** 触发行显示文案：「工作流参数」+（可选）已配置数量 */
const displayText = computed(() =>
  configuredCount.value > 0 ? `工作流参数 · ${configuredCount.value}` : '工作流参数',
)

// 外部 modelValue → 本地（回显；配置面板重挂载/切换实现后恢复已保存参数）
watch(
  () => props.modelValue,
  (v) => {
    if (v && typeof v === 'object') {
      innerValue.value = { ...(v as Record<string, WorkflowUserParamValue>) }
    }
  },
  { immediate: true, deep: true },
)

// 本地 → 外部（相等性守卫：与外部一致时不再回写，避免循环）
watch(
  innerValue,
  (v) => {
    const cur = props.modelValue
    const same = cur != null && typeof cur === 'object' && JSON.stringify(cur) === JSON.stringify(v)
    if (!same) emit('update:modelValue', v)
  },
)
</script>

<style scoped>
/* 触发行：类输入框外观（与 WorkflowSizePicker 触发行一致），点击打开配置面板 */
.workflow-params-trigger__trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.23);
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  max-width: 100%;
}

.workflow-params-trigger__trigger:hover {
  border-color: rgba(var(--v-theme-primary), 0.7);
}

.workflow-params-trigger__icon {
  opacity: 0.6;
  flex: 0 0 auto;
}

.workflow-params-trigger__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-params-trigger__caret {
  opacity: 0.6;
  flex: 0 0 auto;
}
</style>