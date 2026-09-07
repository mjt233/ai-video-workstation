import { computed, watch, type ComputedRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * 将详情面板的页签（v-tabs）状态同步到 URL 查询参数 `tab`，
 * 使刷新页面、浏览器前进/后退时都能正确恢复对应的页签。
 *
 * - 读：返回 URL 中合法（在 allowed 内）的页签值；缺失或非法时返回 fallback；
 * - 写（用户点击页签时）：以 replace 方式合并写入 URL 的 tab 参数
 *   （replace 不产生额外历史记录，每个历史条目的 URL 已携带当时的页签，
 *   前进/后退仍能正确恢复）；
 * - 归一化：URL 中 tab 参数非法（如旧书签、跨类型残留）时自动移除，
 *   保证 URL 与界面显示一致。
 *
 * @param allowed 当前面板允许的页签值集合（v-tab 的 value）
 * @param fallback URL 无 tab 参数或参数非法时使用的默认页签
 * @returns 可读写的 computed：模板中直接用于 v-tabs / v-tabs-window 的 v-model
 */
export function usePanelTab(allowed: readonly string[], fallback: string): ComputedRef<string> {
  const route = useRoute()
  const router = useRouter()

  const tab = computed<string>({
    get: () => {
      const raw = route.query.tab
      const value = typeof raw === 'string' ? raw : undefined
      return value && allowed.includes(value) ? value : fallback
    },
    set: (value) => {
      if (!allowed.includes(value)) return
      router.replace({ query: { ...route.query, tab: value } })
    },
  })

  // URL 中的 tab 参数非法时移除（组件挂载或路由变化时触发一次）
  watch(
    () => route.query.tab,
    (raw) => {
      const value = typeof raw === 'string' ? raw : undefined
      if (value !== undefined && !allowed.includes(value)) {
        const query = { ...route.query }
        delete query.tab
        router.replace({ query })
      }
    },
    { immediate: true },
  )

  return tab
}
