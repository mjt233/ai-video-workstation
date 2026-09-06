import { ref, type Ref } from 'vue'
import { getProviders } from '../api/providers'
import type { LlmConfiguredModel } from '../api/llm'

/**
 * 大语言模型服务商选项（AI 文本生成节点模型下拉用）。
 */
export interface LlmProviderOption {
  /** 服务商实例 id */
  instanceId: string
  /** 服务商显示名 */
  instanceName: string
  /** 协议类型 id */
  protocol: string
  /** 已配置模型列表 */
  models: LlmConfiguredModel[]
}

/**
 * 大语言模型服务商选项缓存（整个会话共享一次加载；保存/编辑后调用 refreshLlmProviders 刷新）。
 */
const cache: Ref<LlmProviderOption[]> = ref([])

/** 是否已发起过加载（无论成败，避免并发重复请求） */
let loaded = false

/** 加载中（并发去重） */
let inflight: Promise<void> | null = null

/**
 * 从 GET /api/providers 拉取大语言模型分类的服务商实例与模型列表。
 * 失败时保留旧值并记录日志（调用方显示空列表）。
 */
async function load(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const { types, instances } = await getProviders()
      const llmTypeIds = new Set(types.filter((t) => t.category === 'llm').map((t) => t.id))
      cache.value = instances
        .filter((i) => llmTypeIds.has(i.type))
        .map((i) => ({
          instanceId: i.id,
          instanceName: i.name,
          protocol: typeof i.config.protocol === 'string' ? i.config.protocol : '',
          models: Array.isArray(i.config.models) ? (i.config.models as LlmConfiguredModel[]) : [],
        }))
    } catch (e) {
      console.error('[llm] 加载大语言模型服务商列表失败:', e)
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * 获取大语言模型服务商选项（共享缓存，首次调用自动加载）。
 *
 * @returns 响应式服务商选项数组（空数组 = 尚未配置或加载失败）
 */
export function useLlmProviders(): Ref<LlmProviderOption[]> {
  if (!loaded) {
    loaded = true
    void load()
  }
  return cache
}

/**
 * 强制刷新大语言模型服务商选项（服务商配置保存/删除后调用）。
 *
 * @returns 加载 Promise（失败不抛出，内部记录日志）
 */
export function refreshLlmProviders(): Promise<void> {
  loaded = true
  return load()
}
