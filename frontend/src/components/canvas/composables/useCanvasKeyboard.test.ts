import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useCanvasKeyboard, type UseCanvasKeyboardOptions } from './useCanvasKeyboard'

/**
 * 构造键盘组合式的最小依赖桩。
 *
 * @param overrides 需要覆盖的参数（如 save 句柄）
 * @returns 组合式实例与可断言的桩函数
 */
function makeKeyboard(overrides: Partial<UseCanvasKeyboardOptions> = {}) {
  const undo = vi.fn()
  const redo = vi.fn()
  const keyboard = useCanvasKeyboard({
    store: { undo, redo, copyNodes: vi.fn(), disconnect: vi.fn(), canPaste: ref(false) },
    selection: {
      getSelectedNodeIds: () => [],
      getSelectedGroupIds: () => [],
      selectedEdgeId: ref(''),
      deleteSelected: vi.fn().mockResolvedValue(undefined),
    },
    menus: { closeAll: vi.fn() },
    rename: { cancelRename: vi.fn() },
    groups: { cancelRename: vi.fn(), closeColorMenu: vi.fn() },
    panel: { close: vi.fn() },
    handleCtrlV: vi.fn(),
    duplicateSelected: vi.fn(),
    ...overrides,
  })
  return { keyboard, undo, redo }
}

/**
 * 构造 keydown 事件。
 *
 * @param key 按键
 * @param init 事件初始化选项（ctrlKey 等）
 * @param target 事件目标（用于验证输入框内行为）
 * @returns 可派发/可直接调用的键盘事件
 */
function makeKeydown(key: string, init: KeyboardEventInit = {}, target?: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init })
  if (target) Object.defineProperty(event, 'target', { value: target })
  return event
}

describe('useCanvasKeyboard', () => {
  it('Ctrl+S：提供保存句柄时拦截默认行为并调用保存', () => {
    const save = vi.fn()
    const { keyboard } = makeKeyboard({ save })
    const event = makeKeydown('s', { ctrlKey: true })
    keyboard.onKeydown(event)
    expect(save).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('Ctrl+S：焦点在输入框内同样生效（手动保存的主要路径）', () => {
    const save = vi.fn()
    const { keyboard } = makeKeyboard({ save })
    const input = document.createElement('textarea')
    const event = makeKeydown('s', { ctrlKey: true }, input)
    keyboard.onKeydown(event)
    expect(save).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('Ctrl+S：未提供保存句柄时不拦截（保留浏览器原生保存）', () => {
    const { keyboard } = makeKeyboard()
    const event = makeKeydown('s', { ctrlKey: true })
    keyboard.onKeydown(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('Ctrl+Z：仍走撤销（不受保存分支影响）', () => {
    const save = vi.fn()
    const { keyboard, undo, redo } = makeKeyboard({ save })
    keyboard.onKeydown(makeKeydown('z', { ctrlKey: true }))
    expect(undo).toHaveBeenCalledTimes(1)
    keyboard.onKeydown(makeKeydown('z', { ctrlKey: true, shiftKey: true }))
    expect(redo).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
  })
})
