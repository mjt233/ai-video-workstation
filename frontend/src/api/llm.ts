import client from './client'

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

/** SSE 流式事件（服务端 /api/llm/chat 转发） */
export interface LlmStreamEvent {
  type: 'thinking' | 'text' | 'warning' | 'error' | 'done'
  delta?: string
  message?: string
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
 * POST /api/llm/chat — SSE 流式对话（一次性输入/输出）。
 *
 * 用 fetch + ReadableStream 解析 SSE 事件（axios 不便流式）；以异步生成器逐条产出事件，
 * 供 UI 边收边显示。错误响应（非 2xx/无法解析）抛出 Error（含服务端错误文案）。
 *
 * @param req 对话请求
 * @param signal 中止信号（停止按钮/组件卸载）
 * @returns 流式事件生成器
 */
export async function* chatLlmStream(
  req: {
    project: string
    providerInstanceId: string
    modelId: string
    reasoningEffort?: string
    input: string
    media?: { path: string; type: 'image' | 'audio' | 'video' }[]
  },
  signal?: AbortSignal,
): AsyncGenerator<LlmStreamEvent> {
  const res = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  if (!res.ok) {
    let message = `请求失败（HTTP ${res.status}）`
    try {
      const data = (await res.json()) as { error?: unknown }
      if (typeof data.error === 'string' && data.error) message = data.error
    } catch {
      // 响应体非 JSON：保留默认错误文案
    }
    throw new Error(message)
  }
  if (!res.body) throw new Error('服务端未返回流式响应')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload) continue
          try {
            yield JSON.parse(payload) as LlmStreamEvent
          } catch (e) {
            // 单条事件解析失败：跳过（不影响后续事件）
            console.error('[llm] SSE 事件解析失败（已跳过）:', e)
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // 流已结束/释放异常可忽略
    }
  }
}
