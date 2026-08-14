/**
 * 节点名称内联重命名组合式：管理重命名状态与提交逻辑。
 * 输入框 DOM（聚焦/全选）由 CanvasNodeCard 内部 watch renamingNodeId 处理。
 */

import { ref } from 'vue'
import type { CanvasStoreApi, NodeMap } from './types'

/** useCanvasRename 参数 */
export interface UseCanvasRenameOptions {
  /** 画布数据 store（回写节点名称） */
  store: CanvasStoreApi
  /** 节点 id → 节点数据索引 */
  nodeMap: NodeMap
}

/**
 * 节点名称内联重命名组合式。
 *
 * @param options 依赖注入参数
 * @returns 重命名状态与操作 API
 */
export function useCanvasRename(options: UseCanvasRenameOptions) {
  const { store, nodeMap } = options

  /** 正在内联编辑名称的节点 id（空表示未在编辑） */
  const renamingNodeId = ref('')
  /** 内联编辑输入框的临时值 */
  const renameInput = ref('')

  /**
   * 进入节点名称内联编辑模式（双击节点名称/右键菜单「重命名」触发）。
   * 输入框聚焦与全选由节点卡片组件在渲染后自行处理。
   *
   * @param nodeId 节点 id
   */
  function startRename(nodeId: string): void {
    renamingNodeId.value = nodeId
    renameInput.value = nodeMap.value[nodeId]?.name ?? ''
  }

  /**
   * 提交内联重命名（回车或失焦触发）；空名则放弃修改。
   *
   * @param nodeId 节点 id
   */
  function commitRename(nodeId: string): void {
    if (renamingNodeId.value !== nodeId) return
    const name = renameInput.value.trim()
    if (name) store.updateNode(nodeId, { name })
    renamingNodeId.value = ''
  }

  /** 取消内联重命名（Esc 触发） */
  function cancelRename(): void {
    renamingNodeId.value = ''
  }

  /** 重置重命名状态（切换画布目标时调用） */
  function reset(): void {
    renamingNodeId.value = ''
    renameInput.value = ''
  }

  return { renamingNodeId, renameInput, startRename, commitRename, cancelRename, reset }
}
