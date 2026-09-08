<template>
  <div class="system-settings-panel">
    <v-expansion-panels
      v-model="opened"
      multiple
    >
      <v-expansion-panel
        v-for="section in SECTIONS"
        :key="section.key"
        :value="section.key"
      >
        <v-expansion-panel-title>
          <v-icon
            :icon="section.icon"
            size="small"
            color="primary"
            class="mr-2"
          />
          <span class="font-weight-medium">{{ section.label }}</span>
          <span class="text-body-small text-medium-emphasis ml-2">{{ section.hint }}</span>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <TrashSettingsSection v-if="section.key === 'trash'" />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { SystemSettingsSection } from '../../composables/useSystemSettings'
import TrashSettingsSection from './TrashSettingsSection.vue'

/**
 * 系统设置面板：系统属性配置容器，按**子类**分组。
 *
 * 当前子类：回收站（自动清理配置 + 全局回收站管理）。
 * 后续新增系统属性时在 `SECTIONS` 注册子类并在模板中挂载对应子组件即可。
 */
const props = defineProps<{
  /** 打开时要定位（展开）的子类；null 表示不改变当前展开状态 */
  initialSection?: SystemSettingsSection | null
}>()

/** 子类注册表（key 与 useSystemSettings 的 SystemSettingsSection 对应） */
const SECTIONS: Array<{ key: SystemSettingsSection; label: string; icon: string; hint: string }> = [
  {
    key: 'trash',
    label: '回收站',
    icon: 'mdi-delete-outline',
    hint: '系统全局 · 自动清理与回收站管理',
  },
]

/** 当前展开的子类 */
const opened = ref<SystemSettingsSection[]>(['trash'])

watch(
  () => props.initialSection,
  (section) => {
    if (section && !opened.value.includes(section)) {
      opened.value = [...opened.value, section]
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.system-settings-panel {
  height: 100%;
  overflow-y: auto;
  padding-right: 4px;
}
</style>
