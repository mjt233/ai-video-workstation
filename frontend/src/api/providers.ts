import client from './client'

/** Provider 配置字段类型 */
export type ProviderConfigFieldType = 'string' | 'password' | 'number' | 'boolean' | 'select'

/** Provider 配置字段声明（服务端 configSchema 透传，驱动设置表单） */
export interface ProviderConfigField {
  /** 配置键，如 baseUrl / password / apiKey */
  key: string
  /** 中文标签 */
  label: string
  /** 字段类型 */
  type: ProviderConfigFieldType
  /** 是否必填 */
  required?: boolean
  /** 默认值 */
  defaultValue?: string | number | boolean
  /** 输入框占位文案 */
  placeholder?: string
  /** 敏感字段：已保存时服务端返回 '__set__' 占位 */
  secret?: boolean
  /** select 类型可选项 */
  options?: { label: string; value: string }[]
  /** 字段说明（表单 hint） */
  description?: string
  /** 环境变量兜底名 */
  envVar?: string
}

/** Provider 信息（GET /api/providers 返回） */
export interface ProviderInfo {
  id: string
  name: string
  description?: string
  configSchema: ProviderConfigField[]
  /** 当前已保存配置；secret 字段有值时为 '__set__' 占位 */
  config: Record<string, string | number | boolean>
}

/** 敏感字段占位符（与服务端 MASKED_SECRET 对齐） */
export const MASKED_SECRET = '__set__'

/** GET /api/providers — 列出所有 provider 及其配置（secret 脱敏） */
export async function getProviders(): Promise<ProviderInfo[]> {
  const { data } = await client.get<{ providers: ProviderInfo[] }>('/providers')
  return data.providers
}

/**
 * PUT /api/providers/:id — 保存 provider 配置。
 * @param id provider id
 * @param config 配置键值；secret 字段传空串或不传 = 服务端保留原值
 */
export async function saveProviderConfig(
  id: string,
  config: Record<string, unknown>,
): Promise<{ success: boolean }> {
  const { data } = await client.put<{ success: boolean }>(`/providers/${id}`, { config })
  return data
}
