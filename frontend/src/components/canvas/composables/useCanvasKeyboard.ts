/**
 * 键盘快捷键组合式：撤销/重做/复制/粘贴兜底/复制粘贴/删除/保存（可选）/Esc。
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
    copyNodes: (nodeIds: string[], groupIds?: string[]) => void
    disconnect: (connectionId: string) => void
    canPaste: { value: boolean }
  }
  /** 选中状态（快捷键目标节点/分组/连线） */
  selection: {
    getSelectedNodeIds: () => string[]
    /** 读取当前选中分组 id 列表（Ctrl+C / Ctrl+D / Delete 覆盖分组） */
    getSelectedGroupIds: () => string[]
    selectedEdgeId: WritableStringRef
    deleteSelected: () => Promise<void>
  }
  /** 菜单关闭（Esc） */
  menus: { closeAll: () => void }
  /** 内联重命名取消（Esc） */
  rename: { cancelRename: () => void }
  /** 分组标题内联重命名取消 + 分组色板菜单关闭（Esc） */
  groups: { cancelRename: () => void; closeColorMenu: () => void }
  /** 配置面板关闭（Esc；仅隐藏面板，保留节点选中与关联高亮） */
  panel: { close: () => void }
  /** Ctrl+V 兜底句柄（由粘贴组合式提供） */
  handleCtrlV: () => void
  /** Ctrl+D 复制粘贴整组句柄（由粘贴组合式提供：复制选中 → 粘贴 → 聚焦新节点） */
  duplicateSelected: () => void
  /**
   * Ctrl+S 保存句柄（可选）。
   *
   * 仅手动保存模式（蓝图编辑器）提供：提供后 Ctrl+S 拦截浏览器默认行为并调用该句柄；
   * 未提供时不拦截（主画布自动保存，保留浏览器原生「保存网页」行为）。
   */
  save?: () => void
}

/**
 * 键盘快捷键组合式。
 *
 * @param options 依赖注入参数
 * @returns 全局 keydown 事件处理器
 */
export function useCanvasKeyboard(options: UseCanvasKeyboardOptions) {
  const { store, selection, menus, rename, groups, panel, handleCtrlV, duplicateSelected, save } = options

  /**
   * 全局键盘快捷键：撤销/重做/复制/粘贴/复制粘贴/删除/保存。
   * 焦点在输入框/textarea 内时跳过（保留原生编辑行为）。
   *
   * @param e 键盘事件
   */
  function onKeydown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey

    // Ctrl+S 保存：在输入框内也生效（手动保存模式下的主要保存路径；
    // 浏览器原生「保存网页」对文本框没有意义）。未提供保存句柄时不拦截。
    if (mod && e.key.toLowerCase() === 's') {
      if (!save) return
      e.preventDefault()
      save()
      return
    }

    const el = e.target as HTMLElement | null
    const tag = el?.tagName
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true
    if (inInput) return

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) store.redo()
      else store.undo()
      return
    }
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      const ids = selection.getSelectedNodeIds()
      const groupIds = selection.getSelectedGroupIds()
      if (ids.length + groupIds.length > 0) store.copyNodes(ids, groupIds)
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
      if (selection.getSelectedNodeIds().length + selection.getSelectedGroupIds().length > 0) duplicateSelected()
      return
    }
    if (e.key === 'Escape') {
      menus.closeAll()
      rename.cancelRename()
      groups.cancelRename()
      groups.closeColorMenu()
      // 关闭配置面板（仅隐藏，保留节点选中；焦点在输入框内时已被上方 inInput 拦截，不会误触发）
      panel.close()
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
      e.preventDefault()
      if (selection.getSelectedNodeIds().length + selection.getSelectedGroupIds().length > 0) {
        void selection.deleteSelected()
      } else if (selection.selectedEdgeId.value) {
        store.disconnect(selection.selectedEdgeId.value)
      }
    }
  }

  return { onKeydown }
}
