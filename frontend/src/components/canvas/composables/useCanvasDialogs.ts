/**
 * 对话框与资产选择器组合式：版本历史、保存为自定义资产、设为分镜场景图/视频、
 * 资产选择器与场景图对话框状态的集中管理。
 * 「设为分镜场景图」对话框的帧加载/应用逻辑在 SetAsSceneDialog 组件内部。
 */

import { computed, reactive } from 'vue'
import type { ComputedRef } from 'vue'
import type { CanvasTarget } from '../../../canvas/api'
import { getNodeCurrentAssetPath } from '../../../canvas/generate'
import type { CanvasScope } from '../../../canvas/paths'
import { copyFs } from '../../../api/client'
import { confirm } from '../../../utils/confirm'
import type { AssetTab } from '../../asset-picker/types'
import type { CanvasStoreApi, NodeMap, SaveAsAssetType, ShowSnackbar } from './types'

/** useCanvasDialogs 参数 */
export interface UseCanvasDialogsOptions {
  /** 画布数据 store（资产选择器等回写 config） */
  store: CanvasStoreApi
  /** 节点 id → 节点数据索引 */
  nodeMap: NodeMap
  /** 项目名 */
  project: string
  /** 当前画布目标（场景图/分镜视频仅分镜画布可用） */
  target: ComputedRef<CanvasTarget>
  /** 画布作用域 getter（生成类节点产物固定路径推导需要；随切换目标实时更新） */
  getScope: () => CanvasScope
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
  const { store, nodeMap, project, target, getScope, showSnackbar } = options

  // ── 版本历史 ────────────────────────────────────────────
  // 历史列表/激活/删除全部由服务端 /api/assets/:project/history* 管理
  // （CanvasAssertHistoryDialog 组件内部调用；本组合式只持有打开状态）

  /** 版本历史对话框状态 */
  const historyDialog = reactive({ show: false, nodeId: '' })

  /** 历史对话框对应节点 */
  const historyNode = computed(() => nodeMap.value[historyDialog.nodeId] ?? null)

  /** 打开版本历史对话框 */
  function openHistory(nodeId: string): void {
    historyDialog.nodeId = nodeId
    historyDialog.show = true
  }

  // ── 保存为自定义资产 ────────────────────────────────────

  /** 保存为自定义资产对话框状态 */
  const saveDialog = reactive({ show: false, nodeId: '' })

  /** 保存对话框对应节点 */
  const saveDialogNode = computed(() => (saveDialog.nodeId ? nodeMap.value[saveDialog.nodeId] : undefined))

  /** 保存对话框源资产路径（节点当前输出资产；生成类节点按固定产物路径推导） */
  const saveSourcePath = computed(() =>
    saveDialogNode.value ? getNodeCurrentAssetPath(saveDialogNode.value, getScope()) ?? '' : '',
  )

  /**
   * 打开「保存为自定义资产」对话框：把节点当前输出资产复制到自定义资产目录。
   *
   * @param nodeId 节点 id
   */
  function openSaveAsset(nodeId: string): void {
    const node = nodeMap.value[nodeId]
    if (!node || !getNodeCurrentAssetPath(node, getScope())) return
    saveDialog.nodeId = nodeId
    saveDialog.show = true
  }

  // ── 保存为（角色设计/角色设计-衍生变体/场景图/场景图-衍生变体）────

  /** 保存为（目标选择）对话框状态：nodeId 为源节点，type 为保存目标类型 */
  const saveAsDialog = reactive({ show: false, nodeId: '', type: 'character' as SaveAsAssetType })

  /** 保存对话框对应节点 */
  const saveAsDialogNode = computed(() => (saveAsDialog.nodeId ? nodeMap.value[saveAsDialog.nodeId] : undefined))

  /** 保存对话框源资产路径（节点当前输出资产；生成类节点按固定产物路径推导） */
  const saveAsSourcePath = computed(() =>
    saveAsDialogNode.value ? getNodeCurrentAssetPath(saveAsDialogNode.value, getScope()) ?? '' : '',
  )

  /**
   * 打开「保存为」目标选择对话框：把节点当前输出图片复制到
   * 角色外观 / 角色衍生变体 / 场景图 / 场景衍生变体路径（目标实体在对话框中选择）。
   *
   * @param nodeId 节点 id
   * @param type 保存目标类型（自定义资产走 openSaveAsset，不走这里）
   */
  function openSaveAs(nodeId: string, type: SaveAsAssetType): void {
    const node = nodeMap.value[nodeId]
    if (!node || !getNodeCurrentAssetPath(node, getScope())) return
    saveAsDialog.nodeId = nodeId
    saveAsDialog.type = type
    saveAsDialog.show = true
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
    const source = node ? getNodeCurrentAssetPath(node, getScope()) : undefined
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
    saveAsDialog.show = false
    saveAsDialog.nodeId = ''
    sceneDialog.show = false
    sceneDialog.nodeId = ''
    picker.show = false
    picker.nodeId = ''
  }

  return {
    historyDialog,
    historyNode,
    openHistory,
    saveDialog,
    saveDialogNode,
    saveSourcePath,
    openSaveAsset,
    saveAsDialog,
    saveAsDialogNode,
    saveAsSourcePath,
    openSaveAs,
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
