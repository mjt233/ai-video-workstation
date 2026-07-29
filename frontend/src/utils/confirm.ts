import { reactive } from 'vue'

/**
 * 确认对话框选项。
 */
export interface ConfirmOptions {
  /** 标题，默认「确认」 */
  title?: string
  /** 正文内容（与 content 同义，优先 content） */
  content?: string
  /** 正文内容别名 */
  message?: string
  /** 确认按钮文案，默认「确定」 */
  confirmText?: string
  /** 取消按钮文案，默认「取消」 */
  cancelText?: string
  /** 确认按钮颜色，默认 primary；删除类建议 error */
  confirmColor?: string
  /** 对话框最大宽度 */
  maxWidth?: number | string
}

interface ConfirmState {
  open: boolean
  title: string
  content: string
  confirmText: string
  cancelText: string
  confirmColor: string
  maxWidth: number | string
  resolve: ((value: boolean) => void) | null
}

const state = reactive<ConfirmState>({
  open: false,
  title: '确认',
  content: '',
  confirmText: '确定',
  cancelText: '取消',
  confirmColor: 'primary',
  maxWidth: 420,
  resolve: null,
})

/**
 * 供宿主组件读取的确认框状态（只读使用）。
 */
export function getConfirmState() {
  return state
}

function close(result: boolean) {
  const resolve = state.resolve
  state.open = false
  state.resolve = null
  resolve?.(result)
}

/**
 * 以 Promise 方式弹出 Vuetify 确认对话框。
 * @param options 标题、内容等配置
 * @returns 用户点击确认返回 true，取消/关闭返回 false
 *
 * @example
 * ```ts
 * const ok = await confirm({
 *   title: '确认删除',
 *   content: '此操作不可撤销',
 *   confirmText: '删除',
 *   confirmColor: 'error',
 * })
 * if (!ok) return
 * ```
 */
export function confirm(options: ConfirmOptions = {}): Promise<boolean> {
  // 若已有未关闭的确认框，先按取消处理，避免 Promise 泄漏
  if (state.open && state.resolve) {
    state.resolve(false)
  }

  state.title = options.title ?? '确认'
  state.content = options.content ?? options.message ?? ''
  state.confirmText = options.confirmText ?? '确定'
  state.cancelText = options.cancelText ?? '取消'
  state.confirmColor = options.confirmColor ?? 'primary'
  state.maxWidth = options.maxWidth ?? 420
  state.open = true

  return new Promise<boolean>((resolve) => {
    state.resolve = resolve
  })
}

/**
 * 宿主组件：用户确认。
 */
export function resolveConfirm(result: boolean) {
  if (!state.open) return
  close(result)
}

export default confirm
