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

/** 服务商类型信息（GET /api/providers 返回的 types 元素） */
export interface ProviderTypeInfo {
  id: string
  name: string
  description?: string
  configSchema: ProviderConfigField[]
}

/** 服务商实例信息（GET /api/providers 返回的 instances 元素；config 已脱敏） */
export interface ProviderInstanceInfo {
  id: string
  type: string
  name: string
  config: Record<string, string | number | boolean>
  enabledWorkflows: string[]
}

/** 实例工作流条目（GET /api/providers/instances/:id/workflows 返回） */
export interface ProviderWorkflowEntry {
  key: string
  name: string
  type?: string
  description?: string
}

/** GET /api/providers — 服务商类型列表 + 实例列表（config 脱敏） */
export async function getProviders(): Promise<{ types: ProviderTypeInfo[]; instances: ProviderInstanceInfo[] }> {
  const { data } = await client.get<{ types: ProviderTypeInfo[]; instances: ProviderInstanceInfo[] }>('/providers')
  return data
}

/**
 * POST /api/providers/instances — 新增服务商实例。
 * @param input 实例输入（type/name/config/enabledWorkflows）
 * @returns 创建的实例（config 脱敏）
 */
export async function createProviderInstance(input: {
  type: string
  name: string
  config: Record<string, unknown>
  enabledWorkflows?: string[]
}): Promise<ProviderInstanceInfo> {
  const { data } = await client.post<{ instance: ProviderInstanceInfo }>('/providers/instances', input)
  return data.instance
}

/**
 * PUT /api/providers/instances/:id — 更新服务商实例。
 * @param id 实例 ID
 * @param input 可部分更新的字段（name/config/enabledWorkflows）；secret 字段传空串 = 服务端保留原值
 * @returns 更新后的实例（config 脱敏）
 */
export async function updateProviderInstance(
  id: string,
  input: { name?: string; config?: Record<string, unknown>; enabledWorkflows?: string[] },
): Promise<ProviderInstanceInfo> {
  const { data } = await client.put<{ instance: ProviderInstanceInfo }>(`/providers/instances/${id}`, input)
  return data.instance
}

/** DELETE /api/providers/instances/:id — 删除服务商实例（注销其全部工作流） */
export async function deleteProviderInstance(id: string): Promise<{ success: boolean }> {
  const { data } = await client.delete<{ success: boolean }>(`/providers/instances/${id}`)
  return data
}

/**
 * POST /api/providers/test — 连接测试（用当前表单参数，不落盘）。
 * @param type 服务商类型 id
 * @param config 当前表单配置参数
 * @returns 测试结果（ok + 提示信息）
 */
export async function testProviderConnection(
  type: string,
  config: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  const { data } = await client.post<{ ok: boolean; message: string }>('/providers/test', { type, config })
  return data
}

/**
 * GET /api/providers/instances/:id/workflows — 该实例当前工作流列表。
 * @param id 实例 ID
 * @returns 工作流条目列表（Bridge 实时拉取 / 静态返回）
 */
export async function getInstanceWorkflows(id: string): Promise<ProviderWorkflowEntry[]> {
  const { data } = await client.get<{ workflows: ProviderWorkflowEntry[] }>(`/providers/instances/${id}/workflows`)
  return data.workflows
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
 * @param instanceId 可选：指定 Bridge 服务商实例 ID（多 Bridge 实例场景）；缺省取第一个
 * @returns 提供商实例摘要列表（Bridge 不可达时后端返回 502，调用方应捕获并提示）
 */
export async function getComfyuiBridgeProviders(instanceId?: string): Promise<ComfyuiBridgeProviderInfo[]> {
  const { data } = await client.get<{ providers: ComfyuiBridgeProviderInfo[] }>('/comfyui-bridge/providers', {
    params: instanceId ? { instanceId } : undefined,
  })
  return data.providers
}
