import client from './client'
import type { LlmCanvasTarget } from '../canvas/llmSocket'

/** 大语言模型协议类型（与服务端 protocol.ts 一致） */
export type LlmProtocol = 'openai-chat' | 'openai-responses' | 'anthropic' | 'grok' | 'gemini'

/** 模型元信息（与服务端 LlmModelMeta 一致） */
export interface LlmModelMeta {
  /** 上下文窗口（token 数字字符串；未知为空串） */
  contextWindow?: string
  /** 支持的输入模态（text/image/audio/video） */
  inputModalities?: string[]
  /** 思考强度挡位（逗号分割；空 = 不支持思考/调整） */
  reasoningLevels?: string
  /** 是否支持 tool call */
  toolCall?: boolean
}

/** 模型列表条目（一键获取返回） */
export interface LlmCatalogModel {
  modelId: string
  name: string
  meta?: LlmModelMeta
}

/** 已配置的模型条目（服务商配置 config.models） */
export interface LlmConfiguredModel {
  /** 模型 id（服务商接口的模型标识） */
  modelId: string
  /** 显示名称（用户自定义） */
  name: string
  /** 模型元信息 */
  meta?: LlmModelMeta
}

/** 创建 LLM 会话的请求（POST /api/llm/chat） */
export interface StartLlmTaskRequest {
  /** 项目名 */
  project: string
  /** 服务商实例 id */
  providerInstanceId: string
  /** 模型 id */
  modelId: string
  /** 思考强度挡位（模型不支持时省略） */
  reasoningEffort?: string
  /** 用户输入文本（预设提示词替换后的最终发送内容） */
  input: string
  /** 媒体输入（来源节点产物相对路径 + 类型；服务端按能力过滤） */
  media?: { path: string; type: 'image' | 'audio' | 'video' }[]
  /** 发起节点 id（画布恢复过滤与终态落盘定位用） */
  nodeId: string
  /** 节点名（会话列表展示） */
  label: string
  /** 画布定位（CanvasDefTarget） */
  canvas: LlmCanvasTarget
  /** 终态历史归档凭据快照（模型名/预设名/媒体标签/用户原始输入） */
  snapshot: { modelName?: string; presetName?: string; mediaLabels?: string[]; userInput?: string }
}

/**
 * POST /api/llm/models/fetch — 一键获取模型列表（附 OpenRouter 元数据，best-effort）。
 *
 * @param input 协议 + 凭据（编辑模式 apiKey 可为空，仅传 instanceId 由服务端回填已保存值）
 * @returns 模型列表
 */
export async function fetchLlmModels(input: {
  protocol: string
  baseUrl?: string
  apiKey?: string
  instanceId?: string
}): Promise<LlmCatalogModel[]> {
  const { data } = await client.post<{ models: LlmCatalogModel[] }>('/llm/models/fetch', input)
  return data.models
}

/**
 * POST /api/llm/chat — 创建 LLM 活跃会话（服务端登记后立即返回 taskId，不等结果）。
 *
 * 后续流式事件（thinking/text/warning/error/finished）经 WebSocket（/llm-ws）
 * 按 taskId 订阅广播，见 canvas/llmSocket.ts。
 *
 * @param req 会话创建请求
 * @returns 会话 id（订阅/取消凭据）
 */
export async function startLlmTask(req: StartLlmTaskRequest): Promise<{ taskId: string }> {
  const { data } = await client.post<{ taskId: string }>('/llm/chat', req)
  return data
}

/**
 * POST /api/llm/chat/tasks/:taskId/cancel — HTTP 兜底取消（WS 断连时停止仍可用）。
 *
 * 幂等：会话不存在/已终态返回 404，调用方视为已终态即可（不抛错）。
 *
 * @param taskId 会话 id
 */
export async function cancelLlmTask(taskId: string): Promise<void> {
  try {
    await client.post(`/llm/chat/tasks/${encodeURIComponent(taskId)}/cancel`)
  } catch (e) {
    // 404 = 会话已结束（终态由服务端落盘），符合取消预期；其余异常向上抛出
    if ((e as { response?: { status?: number } }).response?.status === 404) return
    throw e
  }
}
