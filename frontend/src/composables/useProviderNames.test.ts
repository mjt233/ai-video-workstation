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

  it('加载成功：构建实例 ID → 友好名称映射，且整个会话只请求一次', async () => {
    mockedGetProviders.mockResolvedValue({
      types: [
        { id: 'minimax-h3', name: 'MiniMax', configSchema: [] },
        { id: 'volcengine-ark', name: '火山方舟', configSchema: [] },
      ],
      instances: [
        { id: 'inst-1', type: 'volcengine-ark', name: '火山方舟-主账号', config: {} },
        { id: 'inst-2', type: 'minimax-h3', name: 'MiniMax-主账号', config: {} },
      ],
    })
    const { useProviderNames } = await import('./useProviderNames')

    const map = useProviderNames()
    // 异步加载完成前映射为空
    expect(map.value.size).toBe(0)
    await vi.waitFor(() => expect(map.value.size).toBe(2))
    expect(map.value.get('inst-1')).toBe('火山方舟-主账号')
    expect(map.value.get('inst-2')).toBe('MiniMax-主账号')

    // 再次调用（其他组件复用）不应重复请求
    useProviderNames()
    expect(mockedGetProviders).toHaveBeenCalledTimes(1)
  })

  it('加载失败：映射保持为空，调用方回退显示原始实例 ID', async () => {
    mockedGetProviders.mockRejectedValue(new Error('network error'))
    const { useProviderNames } = await import('./useProviderNames')

    const map = useProviderNames()
    // 等待失败分支执行完（promise 链 flush）
    await vi.waitFor(() => expect(mockedGetProviders).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(map.value.size).toBe(0)
    // 调用方约定：取不到名称时回退原始实例 ID
    expect(map.value.get('inst-1') ?? 'inst-1').toBe('inst-1')
  })
})
