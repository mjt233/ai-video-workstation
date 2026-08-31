<template>
  <div class="workflow-size-picker">
    <v-menu
      v-model="menu"
      :close-on-content-click="false"
      offset="4"
      :max-width="400"
    >
      <template #activator="{ props: menuProps }">
        <!-- 单行显示文案（如 `16:9 / 1K`、`自动 / 自动`、`1:1 / 2K / 1024x1024`），点击打开配置面板 -->
        <div
          v-bind="menuProps"
          class="workflow-size-picker__trigger"
          role="button"
          :title="'点击配置输出尺寸'"
        >
          <span class="workflow-size-picker__text">{{ displayText }}</span>
          <v-icon
            size="small"
            class="workflow-size-picker__caret"
          >
            mdi-chevron-down
          </v-icon>
        </div>
      </template>

      <v-card
        min-width="340"
        max-width="400"
      >
        <v-card-text class="pa-3">
          <!-- 比例：动态按钮组（声明含 auto 时「自适应」放首位） -->
          <div class="workflow-size-picker__label">
            比例
          </div>
          <v-btn-toggle
            :model-value="state.ratio"
            mandatory
            divided
            variant="outlined"
            density="compact"
            class="workflow-size-picker__group"
            @update:model-value="selectRatio"
          >
            <v-btn
              v-for="opt in ratioOptions"
              :key="opt.value"
              :value="opt.value"
              size="small"
            >
              {{ opt.label }}
            </v-btn>
          </v-btn-toggle>

          <!-- 分辨率：动态按钮组（声明含 auto 时「自动」放首位） -->
          <div class="workflow-size-picker__label">
            分辨率
          </div>
          <v-btn-toggle
            :model-value="state.size"
            mandatory
            divided
            variant="outlined"
            density="compact"
            class="workflow-size-picker__group"
            @update:model-value="selectSize"
          >
            <v-btn
              v-for="opt in sizeOptions"
              :key="opt.value"
              :value="opt.value"
              size="small"
            >
              {{ opt.label }}
            </v-btn>
          </v-btn-toggle>

          <!-- 自定义宽高：仅工作流支持指定任意高宽时显示 -->
          <template v-if="caps.supportCustomSize">
            <div class="workflow-size-picker__label">
              宽度 / 高度（像素）
            </div>
            <div class="d-flex ga-2">
              <v-text-field
                :model-value="state.width"
                label="宽度"
                type="number"
                min="1"
                density="compact"
                variant="outlined"
                hide-details
                @update:model-value="setWidth"
              />
              <v-text-field
                :model-value="state.height"
                label="高度"
                type="number"
                min="1"
                density="compact"
                variant="outlined"
                hide-details
                @update:model-value="setHeight"
              />
            </div>
            <div class="workflow-size-picker__hint">
              选择比例/分辨率后自动填入对应宽高；手动修改宽高后按钮组保持不变。
            </div>
          </template>
        </v-card-text>
      </v-card>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { WorkflowSizeConfig } from '../api/workflow'
import {
  AUTO_SIZE_LABEL,
  clampSizeConfigState,
  formatSizeConfigText,
  normalizeSizeCapabilities,
  normalizeSizeConfig,
  resolvePresetSize,
  toSizeConfig,
  type SizeConfigState,
  type WorkflowSizeCapabilities,
} from '../utils/workflowSize'

const props = defineProps<{
  /** 工作流输出尺寸能力声明（capabilities.size；未传使用默认全量） */
  sizeCapabilities?: { ratio?: string[]; size?: string[]; supportCustomSize?: boolean }
  /** 外部回显值（持久化的 sizeConfig；null / 缺省 = 自动 / 自动） */
  modelValue?: WorkflowSizeConfig | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: WorkflowSizeConfig): void
}>()

/** 配置面板是否展开 */
const menu = ref(false)

/** 归一化后的尺寸能力（决定可选按钮组与是否显示自定义宽高） */
const caps = computed<WorkflowSizeCapabilities>(() => normalizeSizeCapabilities(props.sizeCapabilities))

/**
 * 工作流的尺寸能力声明是否已真实到达。
 *
 * 工作流列表由调用方异步拉取（`getWorkflows()`），拉取完成前 `props.sizeCapabilities`
 * 为 undefined，此时 `caps` 是**默认全量清单**而非该工作流的真实清单——用它钳制
 * 已保存值会把合法档位改成错值（如 Seedream 的 `3:2` 被改成 `16:9`），
 * 因此能力未知时一律不钳制，原样回显用户已保存的配置。
 */
const capsKnown = computed(() => props.sizeCapabilities != null)

/** 组件内部状态（比例/尺寸档 + 可选自定义宽高） */
const state = ref<SizeConfigState>({ ratio: 'auto', size: 'auto', width: null, height: null })

/**
 * 最近一次「用户意图」的未钳制原值：外部回显值（props.modelValue）或用户主动选择的值。
 *
 * 能力声明异步到达后据此**重新推导**内部状态，而不是在已钳制过的 state 上二次钳制，
 * 否则加载前用默认清单钳出的错值会被固化下来（比例/尺寸与保存值不一致的根因）。
 */
const echoState = ref<SizeConfigState>({ ratio: 'auto', size: 'auto', width: null, height: null })

/** 自触发标记：emit 后跳过下一次回显，避免反馈循环 */
const skipNextEcho = ref(false)

/**
 * 按当前能力声明重新推导内部状态：能力已知时钳制到合法档位，未知时原样展示回显原值。
 * 宽高不参与钳制，恒沿用回显原值。
 */
function applyEcho() {
  state.value = capsKnown.value
    ? clampSizeConfigState(echoState.value, caps.value)
    : { ...echoState.value }
}

/** 单行显示文案（如 `16:9 / 1K`、`自动 / 自动 / 1024x1024`） */
const displayText = computed(() => formatSizeConfigText(state.value, caps.value))

/**
 * 比例选项：自适应（auto/adaptive）放首位，其余按声明顺序去重。
 *
 * 能力声明未知（异步加载中或工作流未声明 capabilities.size）时不做钳制，
 * 当前值可能不在清单内——此时把它补进选项末尾，保证按钮组恒能高亮当前选择。
 */
const ratioOptions = computed(() => {
  const values = [...new Set(caps.value.ratio)]
  const auto = values.filter((v) => v === 'auto' || v === 'adaptive')
  const rest = values.filter((v) => v !== 'auto' && v !== 'adaptive')
  const ordered = [...auto, ...rest]
  if (state.value.ratio !== 'auto' && state.value.ratio !== 'adaptive' && !ordered.includes(state.value.ratio)) {
    ordered.push(state.value.ratio)
  }
  return ordered.map((v) => ({
    value: v,
    // 自适应档按钮文案（区分 display 行使用的「自动」）
    label: v === 'auto' || v === 'adaptive' ? '自适应' : v,
  }))
})

/**
 * 尺寸选项：自动放首位，其余按声明顺序去重；
 * 当前值不在清单内（能力未知时不钳制）同样补进末尾，保证按钮组恒有高亮项。
 */
const sizeOptions = computed(() => {
  const values = [...new Set(caps.value.size)]
  const auto = values.filter((v) => v === 'auto')
  const rest = values.filter((v) => v !== 'auto')
  const ordered = [...auto, ...rest]
  if (state.value.size !== 'auto' && !ordered.includes(state.value.size)) {
    ordered.push(state.value.size)
  }
  return ordered.map((v) => ({
    value: v,
    label: v === 'auto' ? AUTO_SIZE_LABEL : v,
  }))
})

/**
 * 输出当前内部状态为尺寸配置并通知父级（跳过下一次回显）。
 *
 * 用户主动选择的值同时成为新的回显原值（`echoState`），
 * 否则后续能力声明变化时会按旧回显值把用户刚做的选择回滚掉。
 */
function emitChange() {
  echoState.value = { ...state.value }
  skipNextEcho.value = true
  emit('update:modelValue', toSizeConfig(state.value, caps.value.supportCustomSize))
}

/**
 * 选择比例档：更新状态；支持自定义宽高时若比例×尺寸可换算，自动填入对应宽高。
 *
 * @param v 按钮值（比例档）
 */
function selectRatio(v: unknown) {
  const value = String(v ?? '')
  if (!value || value === state.value.ratio) return
  state.value = { ...state.value, ratio: value }
  applyPresetToSize()
}

/**
 * 选择尺寸档：更新状态；支持自定义宽高时若比例×尺寸可换算，自动填入对应宽高。
 *
 * @param v 按钮值（尺寸档）
 */
function selectSize(v: unknown) {
  const value = String(v ?? '')
  if (!value || value === state.value.size) return
  state.value = { ...state.value, size: value }
  applyPresetToSize()
}

/**
 * 按「比例 × 尺寸」预设自动设置宽高（仅支持自定义宽高的工作流且两档均已知时）。
 * 任一项为自适应/未注册档时保持现有宽高不变（由用户自定义或留空）。
 */
function applyPresetToSize() {
  if (caps.value.supportCustomSize) {
    const preset = resolvePresetSize(state.value.ratio, state.value.size)
    if (preset) {
      state.value = { ...state.value, width: preset.width, height: preset.height }
    }
  }
  emitChange()
}

/**
 * 手动修改宽度：仅更新宽高，不触碰比例/尺寸按钮组。
 * 非法（空/非正数）置 null（对应「不指定」）。
 *
 * @param v 输入值（数字字符串或空串）
 */
function setWidth(v: unknown) {
  const n = v === '' || v === null || v === undefined ? null : Number(v)
  const width = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : null
  state.value = { ...state.value, width }
  emitChange()
}

/**
 * 手动修改高度：仅更新宽高，不触碰比例/尺寸按钮组。
 * 非法（空/非正数）置 null（对应「不指定」）。
 *
 * @param v 输入值（数字字符串或空串）
 */
function setHeight(v: unknown) {
  const n = v === '' || v === null || v === undefined ? null : Number(v)
  const height = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : null
  state.value = { ...state.value, height }
  emitChange()
}

// 外部回显（持久化 sizeConfig / 表单重置）：记录未钳制原值，再按当前能力推导内部状态
watch(
  () => props.modelValue,
  (v) => {
    if (skipNextEcho.value) {
      skipNextEcho.value = false
      return
    }
    echoState.value = normalizeSizeConfig(v ?? undefined)
    applyEcho()
  },
  { immediate: true, deep: true },
)

// 能力声明变化（工作流列表异步加载完成 / 切换工作流实现）：
// 始终以回显原值重新推导，避免加载完成前用默认清单钳出的错值被固化。
// 仅更新展示，**不自动回写父级**——静默改写用户已保存的配置会造成数据被悄悄篡改，
// 只有用户主动点选档位或改宽高时才 emit 持久化。
watch(
  [caps, capsKnown],
  () => {
    applyEcho()
  },
)
</script>

<style scoped>
/* 触发行：类输入框外观（圆角描边 + 可点击），点击打开配置面板 */
.workflow-size-picker__trigger {
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

.workflow-size-picker__trigger:hover {
  border-color: rgba(var(--v-theme-primary), 0.7);
}

.workflow-size-picker__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-size-picker__caret {
  opacity: 0.6;
  flex: 0 0 auto;
}

/* 面板内分区标题 */
.workflow-size-picker__label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 4px;
}

.workflow-size-picker__label:not(:first-child) {
  margin-top: 12px;
}

/* 按钮组：允许换行 */
.workflow-size-picker__group {
  flex-wrap: wrap;
  row-gap: 4px;
}

.workflow-size-picker__hint {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-top: 6px;
}
</style>