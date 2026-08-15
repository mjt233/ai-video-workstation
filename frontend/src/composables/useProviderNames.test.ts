import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getProviders } from '../api/providers'

vi.mock('../api/providers', () => ({
  getProviders: vi.fn(),
}))

const mockedGetProviders = vi.mocked(getProviders)

describe('useProviderNames', () => {
  beforeEach(() => {
    // 重置模块注册表：每个用例获得全新的模块级缓存（loaded 标志与共享映射）
    vi.resetModules()
    mockedGetProviders.mockReset()
  })

  it('加载成功：构建 provider ID → 友好名称映射，且整个会话只请求一次', async () => {
    mockedGetProviders.mockResolvedValue([
      { id: 'minimax-h3', name: 'MiniMax H3', configSchema: [], config: {} },
      { id: 'volcengine-ark', name: '火山方舟', configSchema: [], config: {} },
    ])
    const { useProviderNames } = await import('./useProviderNames')

    const map = useProviderNames()
    // 异步加载完成前映射为空
    expect(map.value.size).toBe(0)
    await vi.waitFor(() => expect(map.value.size).toBe(2))
    expect(map.value.get('minimax-h3')).toBe('MiniMax H3')
    expect(map.value.get('volcengine-ark')).toBe('火山方舟')

    // 再次调用（其他组件复用）不应重复请求
    useProviderNames()
    expect(mockedGetProviders).toHaveBeenCalledTimes(1)
  })

  it('加载失败：映射保持为空，调用方回退显示原始 provider ID', async () => {
    mockedGetProviders.mockRejectedValue(new Error('network error'))
    const { useProviderNames } = await import('./useProviderNames')

    const map = useProviderNames()
    // 等待失败分支执行完（promise 链 flush）
    await vi.waitFor(() => expect(mockedGetProviders).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(map.value.size).toBe(0)
    // 调用方约定：取不到名称时回退原始 ID
    expect(map.value.get('minimax-h3') ?? 'minimax-h3').toBe('minimax-h3')
  })
})
