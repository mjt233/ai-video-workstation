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
  /** 敏感字段：已保存时服务端返回空串（不回显真实值，也不使用占位符） */
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
  /** 当前已保存配置；secret 字段有值时为空串（不回显，保存空串 = 服务端保留原值） */
  config: Record<string, string | number | boolean>
}

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

/** ComfyUI Easy Bridge 的提供商实例摘要（工作流「ComfyUI 提供商」下拉选项） */
export interface ComfyuiBridgeProviderInfo {
  /** 实例 ID（作为执行接口保留键 providerId 的值） */
  id: string
  /** 实例显示名，如「本地 ComfyUI」 */
  name: string
  /** 实例类型：comfyui（ComfyUI 原生）或 runninghub（RunningHub 云端） */
  type: string
  /** 是否启用（禁用实例不能作为执行目标） */
  enabled?: boolean
}

/**
 * GET /api/comfyui-bridge/providers — 实时获取 Easy Bridge 的提供商实例列表。
 *
 * 服务端转发 Bridge 的 GET /api/providers（不落盘）；前端每次表单挂载时重新请求，
 * 不做缓存，保证选项与 Bridge 侧实时一致。
 *
 * @returns 提供商实例摘要列表（Bridge 不可达时后端返回 502，调用方应捕获并提示）
 */
export async function getComfyuiBridgeProviders(): Promise<ComfyuiBridgeProviderInfo[]> {
  const { data } = await client.get<{ providers: ComfyuiBridgeProviderInfo[] }>('/comfyui-bridge/providers')
  return data.providers
}
