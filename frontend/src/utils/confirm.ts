import { createApp, h, nextTick, ref } from 'vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { vuetify } from '../plugins/vuetify'

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

/**
 * 以 Promise 方式动态挂载 Vuetify 确认对话框。
 * 关闭后自动卸载组件并移除 DOM，无需在 App.vue 常驻实例。
 *
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
  return new Promise<boolean>((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const open = ref(true)
    let settled = false

    const app = createApp({
      setup() {
        /**
         * 关闭并卸载对话框。
         * @param result 用户是否确认
         */
        function finish(result: boolean) {
          if (settled) return
          settled = true
          open.value = false
          // 等对话框关闭动画后再卸载，避免闪断
          window.setTimeout(() => {
            app.unmount()
            container.remove()
            resolve(result)
          }, 200)
        }

        return () => h(ConfirmDialog, {
          modelValue: open.value,
          title: options.title ?? '确认',
          content: options.content ?? options.message ?? '',
          confirmText: options.confirmText ?? '确定',
          cancelText: options.cancelText ?? '取消',
          confirmColor: options.confirmColor ?? 'primary',
          maxWidth: options.maxWidth ?? 420,
          'onUpdate:modelValue': (v: boolean) => {
            if (!v) finish(false)
          },
          onConfirm: () => finish(true),
          onCancel: () => finish(false),
        })
      },
    })

    app.use(vuetify)
    app.mount(container)

    // 确保首帧打开动画正常
    void nextTick()
  })
}

export default confirm
