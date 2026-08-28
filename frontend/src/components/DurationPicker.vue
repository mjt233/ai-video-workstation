<template>
  <div class="duration-picker">
    <v-menu
      v-model="menu"
      offset="4"
      :close-on-content-click="false"
    >
      <template #activator="{ props: menuProps }">
        <!-- 类输入框外观的触发行：显示当前时长，点击弹出配置菜单 -->
        <div
          v-bind="menuProps"
          class="duration-picker__trigger"
          role="button"
          title="点击配置时长"
        >
          <v-icon
            size="small"
            class="duration-picker__icon"
          >
            mdi-timer-outline
          </v-icon>
          <span class="duration-picker__text">{{ displayText }}</span>
          <v-icon
            size="small"
            class="duration-picker__caret"
          >
            mdi-chevron-down
          </v-icon>
        </div>
      </template>

      <v-card
        min-width="300"
        max-width="320"
      >
        <v-card-text class="pa-3">
          <!-- 1~15 秒快捷按钮组（点击即选择并关闭菜单） -->
          <div class="duration-picker__label">
            时长（秒）
          </div>
          <div class="duration-picker__grid">
            <v-btn
              v-for="s in quickSeconds"
              :key="s"
              size="small"
              :variant="s === props.modelValue ? 'flat' : 'tonal'"
              :color="s === props.modelValue ? 'primary' : undefined"
              @click="selectQuick(s)"
            >
              {{ s }}
            </v-btn>
          </div>

          <!-- 手动输入秒数（支持小数；回车或「应用」确认） -->
          <div class="duration-picker__label duration-picker__label--manual">
            手动输入
          </div>
          <div class="d-flex ga-2 align-center">
            <v-text-field
              v-model="manualValue"
              label="秒数"
              type="number"
              min="0.1"
              step="any"
              density="compact"
              variant="outlined"
              hide-details
              @keydown.enter="applyManual"
            />
            <v-btn
              size="small"
              color="primary"
              variant="tonal"
              @click="applyManual"
            >
              应用
            </v-btn>
          </div>
          <div class="duration-picker__hint">
            支持小数秒；非法输入将保持原值。
          </div>
        </v-card-text>
      </v-card>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * 时长菜单配置控件：类输入框触发行点击弹出菜单，
 * 提供 1~15 秒快捷按钮组与手动输入（支持小数秒）两种配置方式。
 *
 * 使用方式（生成视频节点编辑器）：
 * ```
 * <DurationPicker
 *   :model-value="duration"
 *   @update:model-value="onDurationChange"
 * />
 * ```
 * 选中/输入合法后立即 emit update:modelValue 并关闭菜单，由编排编辑器按当前
 * 生成模式写回 config（config.director.duration / config.duration）。
 */
const props = defineProps<{
  /** 当前时长（秒）；非法/缺失值在触发行显示「未设置」 */
  modelValue?: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: number): void
}>()

/** 配置菜单是否展开 */
const menu = ref(false)
/** 手动输入框内容（字符串，打开菜单时预填当前时长） */
const manualValue = ref('')

/** 快捷按钮组：1~15 秒 */
const quickSeconds = Array.from({ length: 15 }, (_, i) => i + 1)

/** 触发行显示文案（如「时长 · 5 秒」；非法值显示「未设置」） */
const displayText = computed(() => {
  const v = props.modelValue
  return Number.isFinite(v) && (v as number) > 0 ? `时长 · ${v} 秒` : '时长 · 未设置'
})

// 打开菜单时把当前时长预填进手动输入框（便于微调）
watch(menu, (open) => {
  if (!open) return
  const v = props.modelValue
  manualValue.value = Number.isFinite(v) && (v as number) > 0 ? String(v) : ''
})

/**
 * 点击快捷按钮：立即回传并关闭菜单。
 *
 * @param s 选中的秒数（1~15）
 */
function selectQuick(s: number) {
  emit('update:modelValue', s)
  menu.value = false
}

/**
 * 应用手动输入：合法（正数）时回传并关闭菜单，非法输入忽略（保持菜单打开与原值）。
 */
function applyManual() {
  const n = Number(manualValue.value)
  if (!Number.isFinite(n) || n <= 0) return
  emit('update:modelValue', n)
  menu.value = false
}
</script>

<style scoped>
/* 触发行：类输入框外观（与 WorkflowSizePicker 触发行一致），点击打开配置面板 */
.duration-picker__trigger {
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

.duration-picker__trigger:hover {
  border-color: rgba(var(--v-theme-primary), 0.7);
}

.duration-picker__icon {
  opacity: 0.6;
  flex: 0 0 auto;
}

.duration-picker__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.duration-picker__caret {
  opacity: 0.6;
  flex: 0 0 auto;
}

/* 面板内分区标题 */
.duration-picker__label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 4px;
}

.duration-picker__label--manual {
  margin-top: 12px;
}

/* 1~15 秒按钮组：5 列网格 */
.duration-picker__grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
}

.duration-picker__hint {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-top: 6px;
}
</style>