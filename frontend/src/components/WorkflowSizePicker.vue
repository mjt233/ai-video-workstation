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

/** 组件内部状态（比例/尺寸档 + 可选自定义宽高） */
const state = ref<SizeConfigState>({ ratio: 'auto', size: 'auto', width: null, height: null })

/** 自触发标记：emit 后跳过下一次回显，避免反馈循环 */
const skipNextEcho = ref(false)

/** 单行显示文案（如 `16:9 / 1K`、`自动 / 自动 / 1024x1024`） */
const displayText = computed(() => formatSizeConfigText(state.value, caps.value))

/** 比例选项：自适应（auto/adaptive）放首位，其余按声明顺序去重 */
const ratioOptions = computed(() => {
  const values = [...new Set(caps.value.ratio)]
  const auto = values.filter((v) => v === 'auto' || v === 'adaptive')
  const rest = values.filter((v) => v !== 'auto' && v !== 'adaptive')
  return [...auto, ...rest].map((v) => ({
    value: v,
    // 自适应档按钮文案（区分 display 行使用的「自动」）
    label: v === 'auto' || v === 'adaptive' ? '自适应' : v,
  }))
})

/** 尺寸选项：自动放首位，其余按声明顺序去重 */
const sizeOptions = computed(() => {
  const values = [...new Set(caps.value.size)]
  const auto = values.filter((v) => v === 'auto')
  const rest = values.filter((v) => v !== 'auto')
  return [...auto, ...rest].map((v) => ({
    value: v,
    label: v === 'auto' ? AUTO_SIZE_LABEL : v,
  }))
})

/**
 * 把当前内部状态按能力声明钳制到合法选项：
 * 持久化值可能来自旧数据（如 "auto" 而声明不含 auto），回退到声明的第一个选项。
 * 注意：「auto」（自动）视为「未选择」状态，不参与钳制——
 * 部分工作流（如 Bridge）声明清单不含 auto，未选择时仍应保持 自动/自动 默认。
 *
 * @param s 当前内部状态
 * @returns 钳制后的状态（不修改入参）
 */
function clampToCapabilities(s: SizeConfigState): SizeConfigState {
  const next = { ...s }
  if (
    next.ratio !== 'auto' &&
    next.ratio !== 'adaptive' &&
    caps.value.ratio.length > 0 &&
    !caps.value.ratio.includes(next.ratio)
  ) {
    next.ratio = caps.value.ratio[0]
  }
  if (
    next.size !== 'auto' &&
    caps.value.size.length > 0 &&
    !caps.value.size.includes(next.size)
  ) {
    next.size = caps.value.size[0]
  }
  return next
}

/**
 * 输出当前内部状态为尺寸配置并通知父级（跳过下一次回显）。
 */
function emitChange() {
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

// 外部回显（持久化 sizeConfig / 表单重置）：归一化 + 按能力钳制后应用到内部状态
watch(
  () => props.modelValue,
  (v) => {
    if (skipNextEcho.value) {
      skipNextEcho.value = false
      return
    }
    state.value = clampToCapabilities(normalizeSizeConfig(v ?? undefined))
  },
  { immediate: true, deep: true },
)

// 能力声明变化（切换工作流实现）：把当前选择钳制到新声明的合法选项并回写
watch(
  caps,
  () => {
    const next = clampToCapabilities(state.value)
    if (next.ratio !== state.value.ratio || next.size !== state.value.size) {
      state.value = next
      emitChange()
    }
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