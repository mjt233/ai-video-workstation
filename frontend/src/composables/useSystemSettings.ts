import { ref } from 'vue'

/**
 * 系统设置对话框的全局开关与定位状态。
 *
 * 系统设置对话框挂在 App.vue 上，任意页面/组件都可经 `openSystemSettings()`
 * 打开并直接定位到指定子类（例如项目「存储清理」页签的「回收站设置」按钮
 * 跳转到「系统设置 → 系统设置 → 回收站」）。
 */

/** 系统设置子类 key（用于外部跳转定位） */
export type SystemSettingsSection = 'trash'

/** 对话框是否打开 */
const dialogOpen = ref(false)

/** 打开时要定位的子类（null = 保持上次/默认） */
const targetSection = ref<SystemSettingsSection | null>(null)

/**
 * 系统设置对话框状态与操作。
 *
 * @returns dialogOpen（v-model 绑定）、targetSection（定位子类）、openSystemSettings（打开方法）
 *
 * @example
 * ```ts
 * const { openSystemSettings } = useSystemSettings()
 * openSystemSettings('trash')
 * ```
 */
export function useSystemSettings() {
  /**
   * 打开系统设置对话框。
   *
   * @param section 要定位的子类（默认不改变当前定位）
   */
  function openSystemSettings(section: SystemSettingsSection | null = null): void {
    targetSection.value = section
    dialogOpen.value = true
  }

  return { dialogOpen, targetSection, openSystemSettings }
}
