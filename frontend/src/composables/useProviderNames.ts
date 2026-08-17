import { ref, type Ref } from 'vue'
import { getProviders } from '../api/providers'

/**
 * 服务商实例 ID → 显示名称 的全局共享映射（整个会话只加载一次，
 * 所有调用 useProviderNames 的组件复用同一份数据）。
 */
const providerNameMap: Ref<Map<string, string>> = ref(new Map())

/** 是否已发起过加载请求（无论成败，避免重复请求 /api/providers） */
let loaded = false

/**
 * 获取服务商实例 ID → 友好名称 的共享映射（惰性加载一次）。
 *
 * 映射来自 GET /api/providers 的 instances（如 inst-abc123 → 「火山方舟-主账号」）；
 * 请求失败时映射保持为空，调用方应回退显示原始实例 ID。
 *
 * @returns 实例 ID → 名称的响应式映射（共享单例，多个组件共用）
 */
export function useProviderNames(): Ref<Map<string, string>> {
  if (!loaded) {
    loaded = true
    getProviders()
      .then(({ instances }) => {
        providerNameMap.value = new Map(instances.map((i) => [i.id, i.name]))
      })
      .catch(() => {
        // 加载失败：保持空 Map，调用方回退显示原始实例 ID
      })
  }
  return providerNameMap
}
