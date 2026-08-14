/**
 * 剪贴板粘贴组合式：全局 paste 事件处理与 Ctrl+V 兜底。
 * 剪贴板内容分派：文件（图片/视频/音频）→ 上传为自定义资产并创建加载节点；
 * 文本 → 创建文本节点；画布内复制的节点 → 粘贴节点。
 * 文件识别纯函数在 canvas/clipboard.ts。
 */

import { nextTick } from 'vue'
import type { Ref } from 'vue'
import { collectPastedMedia, buildClipboardAssetDest, type PastedMedia } from '../../../canvas/clipboard'
import { uploadFs } from '../../../api/client'
import type { CanvasStoreApi, ScreenToFlow, FindNode, AddSelectedNodes, ShowSnackbar } from './types'

/** useCanvasPaste 参数 */
export interface UseCanvasPasteOptions {
  /** 画布数据 store（添加节点/粘贴节点） */
  store: CanvasStoreApi
  /** 项目名（上传目标） */
  project: string
  /** 画布容器 DOM（可视区中心计算） */
  flowEl: Ref<HTMLDivElement | null>
  /** Vue Flow 屏幕坐标 → 流坐标换算 */
  screenToFlowCoordinate: ScreenToFlow
  /** Vue Flow 按 id 查询内部节点 */
  findNode: FindNode
  /** Vue Flow 程序化写入选中态 */
  addSelectedNodes: AddSelectedNodes
  /** 选中控制（粘贴聚焦写入应用级选中并抑制面板弹出） */
  selection: {
    setSelectedNode: (nodeId: string) => void
    setSuppressPanelOnSelect: (value: boolean) => void
  }
  /** 操作反馈提示 */
  showSnackbar: ShowSnackbar
}

/**
 * 剪贴板粘贴组合式。
 *
 * @param options 依赖注入参数
 * @returns 粘贴事件处理器与 Ctrl+V 兜底句柄
 */
export function useCanvasPaste(options: UseCanvasPasteOptions) {
  const { store, project, flowEl, screenToFlowCoordinate, findNode, addSelectedNodes, selection, showSnackbar } = options

  /** 粘贴兜底标记：剪贴板为空时浏览器不派发 paste 事件，由 keydown 置位、宏任务兜底粘贴内部复制的节点 */
  let nodePasteFallbackArmed = false

  /**
   * 计算画布可视区中心对应的流坐标（再减去默认节点尺寸一半，使新节点落在可视区正中）。
   *
   * @returns 新节点放置的流坐标
   */
  function viewportCenterNodePosition(): { x: number; y: number } {
    const rect = flowEl.value?.getBoundingClientRect()
    if (rect) {
      const p = screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      return { x: Math.round(p.x - 120), y: Math.round(p.y - 80) }
    }
    return { x: 80, y: 80 }
  }

  /**
   * 程序化选中（聚焦）新粘贴的节点：
   * - 写入 Vue Flow 内部选中态 → 节点显示选中边框与可调整大小的缩放控制点；
   * - 设置应用级选中（Delete/复制等快捷键指向新节点）；
   * - 抑制配置面板自动弹出（仅用户点击节点才打开配置面板）。
   *
   * @param nodeIds 新节点 id 列表（全部选中）
   */
  async function focusPastedNodes(nodeIds: string[]): Promise<void> {
    if (nodeIds.length === 0) return
    // 等 Vue Flow 应用新节点（内部 nodeLookup 更新）后再写入选中态
    await nextTick()
    const flowNodeObjs = nodeIds
      .map((id) => findNode(id))
      .filter((n): n is NonNullable<ReturnType<FindNode>> => !!n)
    if (flowNodeObjs.length > 0) addSelectedNodes(flowNodeObjs)
    selection.setSelectedNode(nodeIds[nodeIds.length - 1] ?? '')
    selection.setSuppressPanelOnSelect(true)
  }

  /**
   * 粘贴媒体文件：逐个上传到自定义资产目录（assert/custom/canvas/），
   * 成功后创建对应加载节点（加载图片/视频/音频），多个节点依次错位摆放，
   * 新节点全部自动聚焦（选中显示边框，不自动打开配置面板）。
   *
   * @param items 剪贴板媒体文件列表
   * @param unsupportedNames 不支持的文件名列表（仅用于反馈提示）
   */
  async function pasteClipboardAssets(items: PastedMedia[], unsupportedNames: string[]): Promise<void> {
    const base = viewportCenterNodePosition()
    const results = await Promise.all(
      items.map(async (m, index) => {
        const dest = buildClipboardAssetDest(m.file, index)
        try {
          const res = await uploadFs(project, dest, m.file)
          if (res.success && res.path) return { ok: true as const, path: res.path, prototypeId: m.prototypeId }
          return { ok: false as const, name: m.file.name }
        } catch {
          return { ok: false as const, name: m.file.name }
        }
      }),
    )
    const ok = results.filter((r): r is Extract<(typeof results)[number], { ok: true }> => r.ok)
    const failed = results.filter((r): r is Extract<(typeof results)[number], { ok: false }> => !r.ok)
    const createdIds: string[] = []
    ok.forEach((r, i) => {
      const node = store.addNode(r.prototypeId, base.x + i * 28, base.y + i * 28, { assetPath: r.path })
      createdIds.push(node.id)
    })
    if (createdIds.length > 0) await focusPastedNodes(createdIds)
    const parts: string[] = []
    if (ok.length > 0) parts.push(`已创建 ${ok.length} 个资产节点`)
    if (failed.length > 0) parts.push(`${failed.map((f) => f.name).join('、')} 上传失败`)
    if (unsupportedNames.length > 0) parts.push(`不支持的文件：${unsupportedNames.join('、')}`)
    if (parts.length > 0) {
      showSnackbar(parts.join('；'), ok.length > 0 && failed.length === 0 && unsupportedNames.length === 0 ? 'success' : 'error')
    }
  }

  /**
   * 粘贴文本：在画布可视区中心创建文本节点并写入文本内容，聚焦新节点。
   *
   * @param text 剪贴板文本
   */
  async function pasteClipboardText(text: string): Promise<void> {
    const pos = viewportCenterNodePosition()
    const node = store.addNode('text', pos.x, pos.y, { text })
    await focusPastedNodes([node.id])
  }

  /**
   * 粘贴画布内复制的节点并聚焦（选中显示边框，不自动打开配置面板）。
   */
  async function pasteNodeAndFocus(): Promise<void> {
    const node = store.pasteNode()
    if (!node) return
    await focusPastedNodes([node.id])
  }

  /**
   * Ctrl+V 兜底：剪贴板为空时浏览器不派发 paste 事件，
   * 置位标记后下一轮事件循环仍未处理则粘贴画布内复制的节点。
   */
  function handleCtrlV(): void {
    if (store.canPaste.value) {
      nodePasteFallbackArmed = true
      setTimeout(() => {
        if (nodePasteFallbackArmed) {
          nodePasteFallbackArmed = false
          void pasteNodeAndFocus()
        }
      }, 0)
    }
  }

  /**
   * 全局粘贴事件（Ctrl+V）：按剪贴板内容类型分派——
   * 1. 焦点在输入框/文本域内 → 放行原生粘贴（如粘贴进文本节点/编辑器输入框）；
   * 2. 含图片/视频/音频文件 → 上传为自定义资产并创建对应加载节点；
   * 3. 含非空文本 → 创建文本节点并写入文本；
   * 4. 无可用内容但有画布内复制的节点 → 粘贴该节点。
   *
   * @param e 剪贴板事件
   */
  function onPaste(e: ClipboardEvent): void {
    const el = e.target as HTMLElement | null
    const tag = el?.tagName
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true
    if (inInput) return

    const { media, unsupported } = collectPastedMedia(e.clipboardData)
    if (media.length > 0 || unsupported.length > 0) {
      // 剪贴板含文件：一律按文件处理（忽略附带文本，如复制网页图片同时携带的 html 片段）
      e.preventDefault()
      nodePasteFallbackArmed = false
      void pasteClipboardAssets(media, unsupported)
      return
    }
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (text.trim()) {
      e.preventDefault()
      nodePasteFallbackArmed = false
      void pasteClipboardText(text)
      return
    }
    if (store.canPaste.value) {
      e.preventDefault()
      nodePasteFallbackArmed = false
      void pasteNodeAndFocus()
    }
  }

  /** 重置兜底标记（切换画布目标时调用） */
  function reset(): void {
    nodePasteFallbackArmed = false
  }

  return { onPaste, handleCtrlV, pasteNodeAndFocus, reset }
}
