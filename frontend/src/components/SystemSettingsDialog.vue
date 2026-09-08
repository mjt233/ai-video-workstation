<template>
  <v-dialog
    :model-value="modelValue"
    max-width="1000"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          icon="mdi-cog"
          class="mr-2"
        />
        系统配置
        <v-spacer />
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text class="system-settings">
        <!-- 左侧垂直页签：服务商配置 / 预设提示词 -->
        <v-tabs
          v-model="activeTab"
          direction="vertical"
          class="system-settings__tabs"
        >
          <v-tab
            v-for="tab in TABS"
            :key="tab.key"
            :value="tab.key"
            class="system-settings__tab"
          >
            <v-icon
              :icon="tab.icon"
              size="small"
              class="mr-2"
            />
            {{ tab.label }}
          </v-tab>
        </v-tabs>

        <!-- 右侧：当前页签面板（v-if 懒加载，切换页签时重新拉取最新数据） -->
        <div class="system-settings__content">
          <ProviderSettingsPanel v-if="activeTab === 'providers'" />
          <PresetPromptsPanel v-if="activeTab === 'presets'" />
          <SystemSettingsPanel
            v-if="activeTab === 'system'"
            :initial-section="initialSection"
          />
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import ProviderSettingsPanel from './provider-settings/ProviderSettingsPanel.vue'
import PresetPromptsPanel from './preset-prompts/PresetPromptsPanel.vue'
import SystemSettingsPanel from './system-settings/SystemSettingsPanel.vue'
import type { SystemSettingsSection } from '../composables/useSystemSettings'

const props = defineProps<{
  modelValue: boolean
  /** 打开时要定位的系统设置子类（如 'trash'）；null 表示不改变当前页签 */
  initialSection?: SystemSettingsSection | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

/** 页签定义（功能模块 + 显示名 + 图标） */
const TABS: { key: 'providers' | 'presets' | 'system'; label: string; icon: string }[] = [
  { key: 'providers', label: '服务商配置', icon: 'mdi-server-outline' },
  { key: 'presets', label: '预设提示词', icon: 'mdi-text-box-multiple-outline' },
  { key: 'system', label: '系统设置', icon: 'mdi-tune-variant' },
]

/** 当前激活页签 */
const activeTab = ref<'providers' | 'presets' | 'system'>('providers')

// 外部带子类定位打开对话框时，自动切到「系统设置」页签（如项目存储清理页的「回收站设置」按钮）
watch(
  () => [props.modelValue, props.initialSection] as const,
  ([open, section]) => {
    if (open && section) activeTab.value = 'system'
  },
  { immediate: true },
)
</script>

<style scoped>
.system-settings {
  display: flex;
  gap: 8px;
  min-height: 320px;
  height: 70vh;
  max-height: 70vh;
  overflow: hidden;
}

.system-settings__tabs {
  flex: 0 0 132px;
  border-right: 1px solid rgba(0, 0, 0, 0.12);
}

.system-settings__tab {
  justify-content: flex-start;
  text-transform: none;
  font-size: 14px;
}

.system-settings__content {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

/* 面板统一占满内容区（内部各自滚动） */
.system-settings__content > * {
  height: 100%;
}
</style>
