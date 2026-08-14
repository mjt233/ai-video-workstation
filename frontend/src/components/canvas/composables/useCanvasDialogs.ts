/**
 * 对话框与资产选择器组合式：版本历史、保存为自定义资产、设为分镜场景图/视频、
 * 资产选择器与场景图对话框状态的集中管理。
 * 「设为分镜场景图」对话框的帧加载/应用逻辑在 SetAsSceneDialog 组件内部。
 */

import { computed, reactive } from 'vue'
import type { ComputedRef } from 'vue'
import type { CanvasTarget } from '../../../canvas/api'
import { activateHistory, getNodeCurrentAssetPath, removeHistoryEntry, type HistoryEntry } from '../../../canvas/generate'
import { copyFs, deleteFs } from '../../../api/client'
import { confirm } from '../../../utils/confirm'
import type { AssetTab } from '../../asset-picker/types'
import type { CanvasStoreApi, NodeMap, ShowSnackbar } from './types'

/** useCanvasDialogs 参数 */
export interface UseCanvasDialogsOptions {
  /** 画布数据 store（历史激活/删除回写 config） */
  store: CanvasStoreApi
  /** 节点 id → 节点数据索引 */
  nodeMap: NodeMap
  /** 项目名 */
  project: string
  /** 当前画布目标（场景图/分镜视频仅分镜画布可用） */
  target: ComputedRef<CanvasTarget>
  /** 操作反馈提示 */
  showSnackbar: ShowSnackbar
}

/**
 * 对话框与资产选择器组合式。
 *
 * @param options 依赖注入参数
 * @returns 各对话框状态与操作 API
 */
export function useCanvasDialogs(options: UseCanvasDialogsOptions) {
  const { store, nodeMap, project, target, showSnackbar } = options

  // ── 版本历史 ────────────────────────────────────────────

  /** 版本历史对话框状态 */
  const historyDialog = reactive({ show: false, nodeId: '' })

  /** 历史对话框对应节点（store 更新后自动刷新，激活后「当前」标记随之更新） */
  const historyNode = computed(() => nodeMap.value[historyDialog.nodeId] ?? null)

  /** 打开版本历史对话框 */
  function openHistory(nodeId: string): void {
    historyDialog.nodeId = nodeId
    historyDialog.show = true
  }

  /**
   * 历史对话框「设为当前」：把选中历史版本激活为节点当前图片。
   * 仅改写 current 指针（history 不变），原当前图自动保留在历史中。
   *
   * @param entry 要激活的历史条目
   */
  function onActivateHistory(entry: HistoryEntry): void {
    const node = nodeMap.value[historyDialog.nodeId]
    if (!node) return
    store.updateNode(node.id, { config: activateHistory(node.config, entry) })
  }

  /**
   * 历史对话框「删除」：确认后删除该历史版本的图片文件，并从节点 history 中移除该条目。
   * 当前版本不可删除（对话框已禁用）；删除后对话框保持打开。
   *
   * @param entry 要删除的历史条目
   */
  async function onDeleteHistory(entry: HistoryEntry): Promise<void> {
    const node = nodeMap.value[historyDialog.nodeId]
    if (!node) return
    const ok = await confirm({
      title: '删除历史版本',
      content: `确定删除历史版本 v${entry.version} 的图片文件吗？此操作不可撤销。`,
      confirmText: '删除',
      confirmColor: 'error',
    })
    if (!ok) return
    try {
      await deleteFs(project, entry.path)
      store.updateNode(node.id, { config: removeHistoryEntry(node.config, entry.version) })
      showSnackbar(`已删除历史版本 v${entry.version}`, 'success')
    } catch (e) {
      showSnackbar(e instanceof Error ? e.message : '删除历史版本失败', 'error')
    }
  }

  // ── 保存为自定义资产 ────────────────────────────────────

  /** 保存为自定义资产对话框状态 */
  const saveDialog = reactive({ show: false, nodeId: '' })

  /** 保存对话框对应节点 */
  const saveDialogNode = computed(() => (saveDialog.nodeId ? nodeMap.value[saveDialog.nodeId] : undefined))

  /** 保存对话框源资产路径（节点当前输出资产） */
  const saveSourcePath = computed(() => (saveDialogNode.value ? getNodeCurrentAssetPath(saveDialogNode.value) ?? '' : ''))

  /**
   * 打开「保存为自定义资产」对话框：把节点当前输出资产复制到自定义资产目录。
   *
   * @param nodeId 节点 id
   */
  function openSaveAsset(nodeId: string): void {
    const node = nodeMap.value[nodeId]
    if (!node || !getNodeCurrentAssetPath(node)) return
    saveDialog.nodeId = nodeId
    saveDialog.show = true
  }

  // ── 设为分镜场景图 ──────────────────────────────────────

  /** 设为分镜场景图对话框状态（帧加载/应用逻辑在 SetAsSceneDialog 组件内部） */
  const sceneDialog = reactive({ show: false, nodeId: '' })

  /** 场景图对话框对应节点 */
  const sceneDialogNode = computed(() => (sceneDialog.nodeId ? nodeMap.value[sceneDialog.nodeId] : undefined))

  /**
   * 打开「设为分镜场景图」对话框（仅分镜画布；帧列表加载由对话框组件完成）。
   *
   * @param nodeId 生成节点 id
   */
  function openSetAsScene(nodeId: string): void {
    if (target.value.kind !== 'scene') return
    const node = nodeMap.value[nodeId]
    if (!node) return
    sceneDialog.nodeId = nodeId
    sceneDialog.show = true
  }

  /**
   * 设为分镜视频：把视频输出节点（生成视频/加载视频）的当前视频设为分镜视频。
   * 分镜视频为单文件 assert/scene/{集数}/{分镜}/video/0.mp4，确认后直接覆盖。
   *
   * @param nodeId 节点 id
   */
  async function openSetAsShotVideo(nodeId: string): Promise<void> {
    if (target.value.kind !== 'scene') return
    const node = nodeMap.value[nodeId]
    const source = node ? getNodeCurrentAssetPath(node) : undefined
    if (!node || !source) return
    const ep = target.value.episode
    const shot = target.value.shot
    const ok = await confirm({
      title: '设为分镜视频',
      content: `将当前视频设为分镜视频（覆盖 assert/scene/${ep}/${shot}/video/0.mp4）？`,
      confirmText: '确认',
      confirmColor: 'primary',
    })
    if (!ok) return
    try {
      await copyFs(project, source, `assert/scene/${ep}/${shot}/video/0.mp4`)
      showSnackbar('已设为分镜视频', 'success')
    } catch (e) {
      showSnackbar(e instanceof Error ? e.message : '设为分镜视频失败', 'error')
    }
  }

  // ── 资产选择器（加载图片/音频/视频节点绑定资产）────────

  /** 资产选择器状态（nodeId 记录绑定目标加载节点） */
  const picker = reactive({ show: false, nodeId: '', showVoice: false })

  /**
   * 资产选择器页签：按节点类型定制——
   * 音频加载节点提供「音频」页签（台词音频/自定义音频）；
   * 视频加载节点提供「分镜视频」页签（分镜视频/自定义视频）。
   */
  const pickerTabs = computed<AssetTab[]>(() => {
    const node = picker.nodeId ? nodeMap.value[picker.nodeId] : undefined
    if (node?.prototypeId === 'audio-loader') return ['character', 'stage', 'custom', 'audio', 'scene-stage']
    if (node?.prototypeId === 'video-loader') return ['stage', 'character', 'custom', 'video', 'scene-stage']
    return ['stage', 'character', 'custom', 'scene-stage']
  })

  /** 打开资产选择器（绑定到某加载节点；音频节点启用角色音色与音频页签） */
  function openAssetPicker(nodeId: string): void {
    const node = nodeMap.value[nodeId]
    picker.nodeId = nodeId
    picker.showVoice = node?.prototypeId === 'audio-loader'
    picker.show = true
  }

  /** 资产选择器确认：把选中的资产路径写入节点 config.assetPath */
  function onPickerConfirm(paths: string[]): void {
    const p = paths[0]
    const nodeId = picker.nodeId
    if (!p || !nodeId) return
    const node = nodeMap.value[nodeId]
    if (node) {
      store.updateNode(nodeId, { config: { ...node.config, assetPath: p } })
    }
    picker.show = false
  }

  /** 关闭全部对话框（切换画布目标时调用） */
  function resetAll(): void {
    historyDialog.show = false
    historyDialog.nodeId = ''
    saveDialog.show = false
    saveDialog.nodeId = ''
    sceneDialog.show = false
    sceneDialog.nodeId = ''
    picker.show = false
    picker.nodeId = ''
  }

  return {
    historyDialog,
    historyNode,
    openHistory,
    onActivateHistory,
    onDeleteHistory,
    saveDialog,
    saveDialogNode,
    saveSourcePath,
    openSaveAsset,
    sceneDialog,
    sceneDialogNode,
    openSetAsScene,
    openSetAsShotVideo,
    picker,
    pickerTabs,
    openAssetPicker,
    onPickerConfirm,
    resetAll,
  }
}
