import type { Component } from 'vue'
import OpenAICompatibleModelsEditor from './OpenAICompatibleModelsEditor.vue'
import UnknownProviderField from './UnknownProviderField.vue'

/**
 * 服务商 configSchema `type: 'component'` 字段的前端组件映射表。
 *
 * schema.component 必须是本表的键；未登记名称回退为错误占位组件，避免对话框崩溃。
 */
export const PROVIDER_FIELD_COMPONENTS: Record<string, Component> = {
  OpenAICompatibleModelsEditor,
}

/**
 * 按 schema 声明的组件名解析 Vue 组件。
 *
 * @param name schema.component
 * @returns 已登记组件；未登记或空名返回 UnknownProviderField
 */
export function resolveProviderFieldComponent(name: string | undefined): Component {
  if (!name) return UnknownProviderField
  return PROVIDER_FIELD_COMPONENTS[name] ?? UnknownProviderField
}

/**
 * 判断组件名是否已在映射表登记。
 * @param name schema.component
 * @returns 已登记为 true
 */
export function isRegisteredProviderFieldComponent(name: string | undefined): boolean {
  return !!name && !!PROVIDER_FIELD_COMPONENTS[name]
}
