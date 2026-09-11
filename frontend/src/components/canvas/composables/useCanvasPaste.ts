/**
 * 剪贴板粘贴组合式：全局 paste 事件处理与 Ctrl+V 兜底、Ctrl+D 复制粘贴整组。
 * 剪贴板内容分派：画布内复制的节点标记（单/多节点）→ 粘贴节点（最高优先级，复制节点已覆盖系统剪贴板）；
 * 文件（图片/视频/音频）→ 先创建加载节点再上传为自定义资产（上传进度显示在节点遮罩上）；
 * 文本 → 创建文本节点；无内容时兜底粘贴画布内复制的节点。
 * 文件识别纯函数在 canvas/clipboard.ts，节点复制标记解析在 canvas/nodeClipboard.ts。
 */

import { nextTick } from 'vue'
import type { Ref } from 'vue'
import { collectPastedMedia, buildClipboardAssetDest, type PastedMedia } from '../../../canvas/clipboard'
import { parseNodeClipboardText, type NodeClipboardPayload } from '../../../canvas/nodeClipboard'
import { boundingRect, rectsOverlap, type RectLike } from '../../../canvas/groups'
import type { CanvasGroupData, CanvasNodeData } from '../../../canvas/types'
import type { CanvasStoreApi, ScreenToFlow, FindNode, AddSelectedNodes, ShowSnackbar } from './types'
import type { CanvasUploadApi } from './useCanvasUpload'

/** useCanvasPaste 参数 */
export interface UseCanvasPasteOptions {
  /** 画布数据 store（添加节点/粘贴节点） */
  store: CanvasStoreApi
  /** 画布容器 DOM（可视区中心计算 / 可视区矩形换算） */
  flowEl: Ref<HTMLDivElement | null>
  /** Vue Flow 屏幕坐标 → 流坐标换算 */
  screenToFlowCoordinate: ScreenToFlow
  /** Vue Flow 按 id 查询内部节点 */
  findNode: FindNode
  /** Vue Flow 程序化写入选中态 */
  addSelectedNodes: AddSelectedNodes
  /** 加载节点上传组合式（先建节点 → 逐个上传，进度显示在节点遮罩上） */
  upload: CanvasUploadApi
  /** 选中控制（粘贴聚焦写入应用级选中并抑制面板弹出） */
  selection: {
    setSelectedNodes: (nodeIds: string[]) => void
    setSelectedGroups: (groupIds: string[]) => void
    setSuppressPanelOnSelect: (value: boolean) => void
  }
  /** 当前选中节点 id 列表读取（Ctrl+D 复制整组） */
  getSelectedNodeIds: () => string[]
  /** 当前选中分组 id 列表读取（Ctrl+D 复制整组） */
  getSelectedGroupIds: () => string[]
  /** 操作反馈提示 */
  showSnackbar: ShowSnackbar
  /**
   * 读取当前画布可视区矩形（流坐标；缺省不提供则不做「副本是否可见」判定）。
   * 由 AssetCanvas 用容器 `getBoundingClientRect` + `screenToFlowCoordinate` 换算。
   */
  visibleFlowRect?: () => RectLike | null
  /**
   * 把副本内容对准到视口（仅当副本完全落在可视区之外时调用）。
   * 由 AssetCanvas 用 `fitView({ nodes: [...新节点, ...新分组], ... })` 实现。
   *
   * @returns 视口是否成功对准（false = 节点尚未测量等，调用方仅提示不报错）
   */
  revealPastedEntities?: (nodeIds: string[], groupIds: string[]) => Promise<boolean>
  /**
   * 媒体粘贴前置校验（可选）：返回非空文案时阻止本次媒体粘贴并提示。
   * 蓝图编辑器未设置资产项目时使用（无项目上下文无法上传资产）。
   */
  mediaBlockedReason?: () => string | null
}

/**
 * 剪贴板粘贴组合式。
 *
 * @param options 依赖注入参数
 * @returns 粘贴事件处理器、Ctrl+V 兜底与 Ctrl+D 复制粘贴整组句柄
 */
export function useCanvasPaste(options: UseCanvasPasteOptions) {
  const { store, flowEl, screenToFlowCoordinate, findNode, addSelectedNodes, selection, getSelectedNodeIds, getSelectedGroupIds, upload, showSnackbar } = options

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
   * - 设置应用级选中（全部粘贴节点，Delete/复制等快捷键指向它们）；
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
    selection.setSelectedNodes(nodeIds)
    selection.setSuppressPanelOnSelect(true)
  }

  /**
   * 粘贴媒体文件：先创建空加载节点（上传进度显示在节点卡片遮罩上），
   * 再逐个上传到自定义资产目录（assert/custom/canvas/）并写回 assetPath，
   * 多个节点依次错位摆放，新节点全部自动聚焦（选中显示边框，不自动打开配置面板）。
   * 上传失败保留空加载节点（可直接在节点上重试/选择资产），snackbar 汇总结果。
   *
   * @param items 剪贴板媒体文件列表
   * @param unsupportedNames 不支持的文件名列表（仅用于反馈提示）
   */
  async function pasteClipboardAssets(items: PastedMedia[], unsupportedNames: string[]): Promise<void> {
    // 前置校验（蓝图模式未设置资产项目时阻止：无项目上下文无法上传）
    const blocked = options.mediaBlockedReason?.()
    if (blocked) {
      showSnackbar(blocked, 'error')
      return
    }
    const base = viewportCenterNodePosition()
    // 1. 先创建空加载节点：上传期间节点即存在，进度条显示在各节点遮罩上
    const tasks = items.map((m, index) => {
      const node = store.addNode(m.prototypeId, base.x + index * 28, base.y + index * 28)
      return { nodeId: node.id, file: m.file, dest: buildClipboardAssetDest(m.file, index) }
    })
    // 2. 立即聚焦新节点（无需等上传完成）
    await focusPastedNodes(tasks.map((t) => t.nodeId))
    // 3. 并行上传（silent：失败提示由本函数汇总，避免与 upload 组合式重复弹 snackbar）
    const results = await upload.uploadMany(tasks, { silent: true })
    const okCount = results.filter((r) => r.ok).length
    const failed = results
      .map((r, i) => ({ r, item: items[i] }))
      .filter((x): x is { r: { ok: false; error: string }; item: PastedMedia } => !x.r.ok)
    const parts: string[] = []
    if (okCount > 0) parts.push(`已创建 ${okCount} 个资产节点`)
    if (failed.length > 0) parts.push(`${failed.map((f) => f.item.file.name).join('、')} 上传失败`)
    if (unsupportedNames.length > 0) parts.push(`不支持的文件：${unsupportedNames.join('、')}`)
    if (parts.length > 0) {
      showSnackbar(parts.join('；'), okCount > 0 && failed.length === 0 && unsupportedNames.length === 0 ? 'success' : 'error')
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
   * 判断落点包围盒是否**完全**落在当前可视区之外。
   *
   * 语义：只要有任意交叠（哪怕只露出一角）就认为「用户看得见副本」，不对准视口，避免
   * 每次粘贴都跳视口打断操作；完全看不见时才对准。
   *
   * @param bounds 副本落点包围盒（流坐标）
   * @returns true = 完全在可视区外（需要对准）
   */
  function isFullyOutsideViewport(bounds: RectLike): boolean {
    const visible = options.visibleFlowRect?.()
    if (!visible) return false
    return !rectsOverlap(visible, bounds)
  }

  /**
   * 粘贴后的视口处理：副本完全落在可视区外时把视口对准副本（新节点 + 新分组），
   * 并提示落点情况；副本可见时不动视口。
   *
   * 落点提示仅在「确实对准了视口」时给出（否则会与用户眼前看到的画布矛盾）：
   * - 落点被碰撞探测挪动过（`cascaded`）→ 说明首选位置被画布已有内容占用；
   * - 未挪动 → 单纯因原内容较大而落到视野外。
   *
   * @param nodes 新粘贴的节点列表
   * @param groups 新粘贴的分组列表
   * @param cascaded 落点是否被碰撞探测挪动过
   */
  async function revealPastedIfOutside(
    nodes: CanvasNodeData[],
    groups: CanvasGroupData[],
    cascaded: boolean,
  ): Promise<void> {
    if (nodes.length === 0 && groups.length === 0) return
    const reveal = options.revealPastedEntities
    // 副本几何取「已落位的最终坐标」（store 已按落点平移），包围盒 = 新节点 ∪ 新分组
    const bounds = boundingRect([...nodes, ...groups])
    if (!bounds || !isFullyOutsideViewport(bounds)) return
    if (!reveal) return
    await nextTick()
    const ok = await reveal(nodes.map((n) => n.id), groups.map((g) => g.id))
    if (!ok) {
      console.warn('[canvas] 粘贴副本落在可视区外，但视口对准失败（节点尚未测量完成），请手动缩小画布查看')
      showSnackbar('副本粘贴在可视区之外，请缩小画布查看', 'primary')
      return
    }
    showSnackbar(cascaded ? '副本已粘贴到空白处（首选位置被占用），已自动对准' : '副本已粘贴在可视区之外，已自动对准', 'primary')
  }

  /**
   * 粘贴画布内复制的节点/分组并聚焦（节点选中显示边框、不自动打开配置面板；分组不进入聚焦）。
   * 副本落点由 store 的零重叠落点算法决定（见 `canvas/pastePlacement.ts`）；
   * 副本完全落在可视区外时才把视口对准副本。
   *
   * @param source 外部复制载荷（如系统剪贴板标记解析出的，支持跨画布/刷新后粘贴）；缺省用 store 内部剪贴板
   */
  async function pasteNodeAndFocus(source?: NodeClipboardPayload): Promise<void> {
    const { nodes, groups, cascaded } = store.pasteNodes(source)
    if (nodes.length === 0 && groups.length === 0) return
    selection.setSelectedGroups(groups.map((g) => g.id))
    await focusPastedNodes(nodes.map((n) => n.id))
    await revealPastedIfOutside(nodes, groups, cascaded)
  }

  /**
   * Ctrl+D：复制当前选中的节点与分组（含组内连线）并粘贴，聚焦新节点。
   * 与 Ctrl+V 共用同一套落点与视口跟随规则。
   */
  async function duplicateSelected(): Promise<void> {
    const nodeIds = getSelectedNodeIds()
    const groupIds = getSelectedGroupIds()
    if (nodeIds.length === 0 && groupIds.length === 0) return
    store.copyNodes(nodeIds, groupIds)
    const { nodes, groups, cascaded } = store.pasteNodes()
    if (nodes.length === 0 && groups.length === 0) return
    selection.setSelectedGroups(groups.map((g) => g.id))
    await focusPastedNodes(nodes.map((n: CanvasNodeData) => n.id))
    await revealPastedIfOutside(nodes, groups, cascaded)
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
   * 1. 画布内复制的节点标记 → 粘贴节点（最高优先级；复制节点已把「标记 + JSON」写入系统剪贴板，
   *    因此不会被剪贴板中残留的旧文本/文件抢占；输入框内也拦截，防止标记 JSON 被原生插入）；
   * 2. 焦点在输入框/文本域内 → 放行原生粘贴（如粘贴进文本节点/编辑器输入框）；
   * 3. 含图片/视频/音频文件 → 先创建对应加载节点再上传（上传进度显示在节点遮罩上）；
   * 4. 含非空文本 → 创建文本节点并写入文本；
   * 5. 无可用内容但有画布内复制的节点 → 粘贴该节点。
   *
   * @param e 剪贴板事件
   */
  function onPaste(e: ClipboardEvent): void {
    const el = e.target as HTMLElement | null
    const tag = el?.tagName
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true

    // 画布内复制的节点标记：任何焦点目标下都拦截（含输入框，避免标记 JSON 被当作普通文本粘贴）
    const text = e.clipboardData?.getData('text/plain') ?? ''
    const copiedPayload = parseNodeClipboardText(text)
    if (copiedPayload) {
      e.preventDefault()
      nodePasteFallbackArmed = false
      // 输入框内粘贴节点标记：仅吞掉，不在画布上粘贴节点（避免输入时误操作）
      if (!inInput) void pasteNodeAndFocus(copiedPayload)
      return
    }
    if (inInput) return

    const { media, unsupported } = collectPastedMedia(e.clipboardData)
    if (media.length > 0 || unsupported.length > 0) {
      // 剪贴板含文件：一律按文件处理（忽略附带文本，如复制网页图片同时携带的 html 片段）
      e.preventDefault()
      nodePasteFallbackArmed = false
      void pasteClipboardAssets(media, unsupported)
      return
    }
    // text 在上方已读取（节点标记检测共用）
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

  return { onPaste, handleCtrlV, pasteNodeAndFocus, duplicateSelected, reset }
}
