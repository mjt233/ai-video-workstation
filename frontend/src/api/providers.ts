import client from './client'

/** Provider 配置字段类型 */
export type ProviderConfigFieldType = 'string' | 'password' | 'number' | 'boolean' | 'select' | 'component'

/**
 * Provider 配置值：标量字段为 string/number/boolean，
 * `type: 'component'` 字段为可 JSON 序列化的对象或数组。
 */
export type ProviderConfigValue = string | number | boolean | object

/** Provider 配置字段声明（服务端 configSchema 透传，驱动设置表单） */
export interface ProviderConfigField {
  /** 配置键，如 baseUrl / password / apiKey */
  key: string
  /** 中文标签 */
  label: string
  /**
   * 字段类型。
   * `component`：按 `component` 名渲染自定义组件，值通过 v-model 绑定结构化对象/数组。
   */
  type: ProviderConfigFieldType
  /** 是否必填 */
  required?: boolean
  /** 默认值（component 字段可为对象/数组） */
  defaultValue?: ProviderConfigValue
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
  /** type=component 时：前端映射表中的组件名，如 OpenAICompatibleModelsEditor */
  component?: string
}

/** Provider 信息（GET /api/providers 返回） */
export interface ProviderInfo {
  id: string
  name: string
  description?: string
  configSchema: ProviderConfigField[]
  /** 当前已保存配置；secret 字段有值时为空串（不回显，保存空串 = 服务端保留原值） */
  config: Record<string, ProviderConfigValue>
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
  config: Record<string, ProviderConfigValue>
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
 * @param input 实例输入（type/name/config）；创建后该类型全部工作流默认可用
 * @returns 创建的实例（config 脱敏）
 */
export async function createProviderInstance(input: {
  type: string
  name: string
  config: Record<string, unknown>
}): Promise<ProviderInstanceInfo> {
  const { data } = await client.post<{ instance: ProviderInstanceInfo }>('/providers/instances', input)
  return data.instance
}

/**
 * PUT /api/providers/instances/:id — 更新服务商实例。
 * @param id 实例 ID
 * @param input 可部分更新的字段（name/config）；secret 字段传空串 = 服务端保留原值
 * @returns 更新后的实例（config 脱敏）
 */
export async function updateProviderInstance(
  id: string,
  input: { name?: string; config?: Record<string, unknown> },
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
 *
 * 编辑模式传入 instanceId 后，服务端会把表单中空白的 secret 字段回填为该实例
 * 已保存值（表单不回显 secret，未修改则沿用已保存值）。
 *
 * @param type 服务商类型 id
 * @param config 当前表单配置参数
 * @param instanceId 编辑模式下实例 id（可选）
 * @returns 测试结果（ok + 提示信息）
 */
export async function testProviderConnection(
  type: string,
  config: Record<string, unknown>,
  instanceId?: string,
): Promise<{ ok: boolean; message: string }> {
  const { data } = await client.post<{ ok: boolean; message: string }>('/providers/test', {
    type,
    config,
    ...(instanceId ? { instanceId } : {}),
  })
  return data
}

/**
 * POST /api/providers/workflows/fetch — 使用当前表单配置获取工作流列表（不落盘）。
 *
 * 新增服务商时直接按表单参数解析；编辑模式传入 instanceId 后，服务端会把表单中
 * 空白的 secret 字段回填为该实例已保存值（表单不回显 secret），保证改完配置后
 * 也能以「手头配置 + 已保存密钥」重新拉取。
 *
 * @param type 服务商类型 id
 * @param config 当前表单配置参数
 * @param instanceId 编辑模式下实例 id（可选）
 * @returns 工作流条目列表
 */
export async function fetchProviderWorkflows(
  type: string,
  config: Record<string, unknown>,
  instanceId?: string,
): Promise<ProviderWorkflowEntry[]> {
  const { data } = await client.post<{ workflows: ProviderWorkflowEntry[] }>('/providers/workflows/fetch', {
    type,
    config,
    ...(instanceId ? { instanceId } : {}),
  })
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

/**
 * GET /api/workflow-types — 系统支持的工作流类型列表（服务端注册表键集合）。
 *
 * 供自定义服务商工作流表单的「工作流类型」下拉选项使用；
 * 调用失败时调用方可回退到内置类型常量。
 *
 * @returns 工作流类型 id 数组，如 ['text-to-image', 'image-edit', ...]
 */
export async function getWorkflowTypes(): Promise<string[]> {
  const { data } = await client.get<{ types: string[] }>('/workflow-types')
  return data.types
}
