import { describe, expect, it, vi } from 'vitest'

vi.mock('./OpenAICompatibleModelsEditor.vue', () => ({ default: { name: 'OpenAICompatibleModelsEditor' } }))
vi.mock('./CustomCodeEditorField.vue', () => ({ default: { name: 'CustomCodeEditorField' } }))
vi.mock('./CustomWorkflowsEditorField.vue', () => ({ default: { name: 'CustomWorkflowsEditorField' } }))
vi.mock('./UnknownProviderField.vue', () => ({ default: { name: 'UnknownProviderField' } }))

import {
  isRegisteredProviderFieldComponent,
  PROVIDER_FIELD_COMPONENTS,
  resolveProviderFieldComponent,
} from './index'

describe('provider-fields 映射表', () => {
  it('登记 OpenAICompatibleModelsEditor', () => {
    expect(PROVIDER_FIELD_COMPONENTS.OpenAICompatibleModelsEditor).toEqual({ name: 'OpenAICompatibleModelsEditor' })
    expect(isRegisteredProviderFieldComponent('OpenAICompatibleModelsEditor')).toBe(true)
    expect(resolveProviderFieldComponent('OpenAICompatibleModelsEditor'))
      .toBe(PROVIDER_FIELD_COMPONENTS.OpenAICompatibleModelsEditor)
  })

  it('登记自定义服务商代码/工作流编辑组件', () => {
    expect(PROVIDER_FIELD_COMPONENTS.CustomCodeEditorField).toEqual({ name: 'CustomCodeEditorField' })
    expect(PROVIDER_FIELD_COMPONENTS.CustomWorkflowsEditorField).toEqual({ name: 'CustomWorkflowsEditorField' })
    expect(resolveProviderFieldComponent('CustomCodeEditorField'))
      .toBe(PROVIDER_FIELD_COMPONENTS.CustomCodeEditorField)
    expect(resolveProviderFieldComponent('CustomWorkflowsEditorField'))
      .toBe(PROVIDER_FIELD_COMPONENTS.CustomWorkflowsEditorField)
  })

  it('未登记或空名回退占位组件', () => {
    expect(resolveProviderFieldComponent(undefined)).toEqual({ name: 'UnknownProviderField' })
    expect(resolveProviderFieldComponent('NotExist')).toEqual({ name: 'UnknownProviderField' })
    expect(isRegisteredProviderFieldComponent('NotExist')).toBe(false)
    expect(isRegisteredProviderFieldComponent(undefined)).toBe(false)
  })
})
