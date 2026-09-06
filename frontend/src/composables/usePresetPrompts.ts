import { ref, type Ref } from 'vue'
import { getPresetPrompts, type PresetPrompt } from '../api/presets'

/**
 * 预设提示词列表缓存（系统级全局共享；供系统配置「预设提示词」页与
 * AI 文本生成节点预设下拉使用，整个会话共享一次加载；
 * 设置页保存/删除后调用 refreshPresetPrompts 刷新）。
 */
const cache: Ref<PresetPrompt[]> = ref([])

/** 是否已发起过加载（无论成败，避免并发重复请求） */
let loaded = false

/** 加载中（并发去重） */
let inflight: Promise<void> | null = null

/**
 * 从 GET /api/presets 拉取预设提示词列表。
 * 失败时保留旧值并记录日志（调用方显示空列表）。
 */
async function load(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      cache.value = await getPresetPrompts()
    } catch (e) {
      console.error('[presets] 加载预设提示词列表失败:', e)
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * 获取预设提示词列表（共享缓存，首次调用自动加载）。
 *
 * @returns 响应式预设列表（空数组 = 尚未配置或加载失败）
 */
export function usePresetPrompts(): Ref<PresetPrompt[]> {
  if (!loaded) {
    loaded = true
    void load()
  }
  return cache
}

/**
 * 强制刷新预设提示词列表（系统配置保存/删除后调用，节点下拉实时更新）。
 *
 * @returns 加载 Promise（失败不抛出，内部记录日志）
 */
export function refreshPresetPrompts(): Promise<void> {
  loaded = true
  return load()
}
