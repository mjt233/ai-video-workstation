/**
 * 键盘快捷键组合式：撤销/重做/复制/粘贴兜底/复制粘贴/删除/Esc。
 * 焦点在输入框/textarea 内时跳过（保留原生编辑行为）。
 * Ctrl+V 不 preventDefault（放行原生 paste 事件），由粘贴组合式统一分派
 * （节点复制标记 → 粘贴节点；文件 → 加载节点；文本 → 文本节点）；
 * 剪贴板为空不派发 paste 事件时，由 keydown 置兜底标记粘贴画布内复制的节点。
 * 多选语义：Ctrl+C/Ctrl+D 作用于全部选中节点；Delete 删除整组（一次确认）。
 */

import type { WritableStringRef } from './types'

/** useCanvasKeyboard 参数 */
export interface UseCanvasKeyboardOptions {
  /** 画布数据 store（撤销/重做/复制/断开连线） */
  store: {
    undo: () => void
    redo: () => void
    copyNodes: (nodeIds: string[]) => void
    disconnect: (connectionId: string) => void
    canPaste: { value: boolean }
  }
  /** 选中状态（快捷键目标节点/连线） */
  selection: {
    getSelectedNodeIds: () => string[]
    selectedEdgeId: WritableStringRef
    deleteSelected: () => Promise<void>
  }
  /** 菜单关闭（Esc） */
  menus: { closeAll: () => void }
  /** 内联重命名取消（Esc） */
  rename: { cancelRename: () => void }
  /** Ctrl+V 兜底句柄（由粘贴组合式提供） */
  handleCtrlV: () => void
  /** Ctrl+D 复制粘贴整组句柄（由粘贴组合式提供：复制选中 → 粘贴 → 聚焦新节点） */
  duplicateSelected: () => void
}

/**
 * 键盘快捷键组合式。
 *
 * @param options 依赖注入参数
 * @returns 全局 keydown 事件处理器
 */
export function useCanvasKeyboard(options: UseCanvasKeyboardOptions) {
  const { store, selection, menus, rename, handleCtrlV, duplicateSelected } = options

  /**
   * 全局键盘快捷键：撤销/重做/复制/粘贴/复制粘贴/删除。
   * 焦点在输入框/textarea 内时跳过（保留原生编辑行为）。
   *
   * @param e 键盘事件
   */
  function onKeydown(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null
    const tag = el?.tagName
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true
    if (inInput) return

    const mod = e.ctrlKey || e.metaKey

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) store.redo()
      else store.undo()
      return
    }
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      const ids = selection.getSelectedNodeIds()
      if (ids.length > 0) store.copyNodes(ids)
      return
    }
    if (mod && e.key.toLowerCase() === 'v') {
      // Ctrl+V 由全局 paste 事件统一处理（节点复制标记→粘贴节点、文件→加载节点、文本→文本节点），
      // 此处不 preventDefault 以放行原生 paste 事件。剪贴板为空时浏览器不派发 paste 事件：
      // 置兜底标记，下一轮事件循环仍未处理则粘贴画布内复制的节点。
      handleCtrlV()
      return
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      if (selection.getSelectedNodeIds().length > 0) duplicateSelected()
      return
    }
    if (e.key === 'Escape') {
      menus.closeAll()
      rename.cancelRename()
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
      e.preventDefault()
      if (selection.getSelectedNodeIds().length > 0) {
        void selection.deleteSelected()
      } else if (selection.selectedEdgeId.value) {
        store.disconnect(selection.selectedEdgeId.value)
      }
    }
  }

  return { onKeydown }
}
