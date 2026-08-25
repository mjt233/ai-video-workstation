/**
 * 生成节点调度组合式：按节点原型分发生成动作，并向编辑器/节点卡片提供输入收集等查询。
 * 与 useCanvasGeneration（工作流执行/状态展示）配合：本组合式负责收集输入、组装提交参数，
 * 生成结果由服务端落盘（固定产物路径），完成后通过 onNodeResult 通知 UI 刷新展示。
 */

import { computed } from 'vue'
import { buildVideoSubmitParams } from '../../../canvas/videoSubmit'
import { collectInputPaths, collectInputs, type CanvasInputInfo } from '../../../canvas/generate'
import { getNodeOutputType } from '../../../canvas/connection'
import type { CanvasNodeData } from '../../../canvas/types'
import type { CanvasScope } from '../../../canvas/paths'
import type { CanvasGenerationApi, CanvasStoreApi, NodeMap, ShowSnackbar } from './types'

/** useCanvasNodeOps 参数 */
export interface UseCanvasNodeOpsOptions {
  /** 画布数据 store（回写 config/连接查询） */
  store: CanvasStoreApi
  /** 生成执行组合式（工作流/轮询/中断/帧提取/拼接/裁剪） */
  gen: CanvasGenerationApi
  /** 节点 id → 节点数据索引 */
  nodeMap: NodeMap
  /** 操作反馈提示 */
  showSnackbar: ShowSnackbar
  /** 当前选中节点（配置面板对应节点，供视频输入分组计算；运行期才求值，允许晚于本组合式创建） */
  getSelectedNode: () => CanvasNodeData | null
  /** 画布作用域 getter（生成类节点产物固定路径推导/输入收集需要；随切换目标实时更新） */
  getScope: () => CanvasScope
  /** 生成完成回调（nodeId, outputPath）：由 AssetCanvas 刷新节点产物展示（固定路径+mtime） */
  onNodeResult?: (nodeId: string, outputPath: string) => void
  /** 查询节点产物 mtime（上游更新角标用：输入节点产物比本节点新 → 提示） */
  getOutputMtime?: (nodeId: string) => number | null | undefined
}

/**
 * 生成节点调度组合式。
 *
 * @param options 依赖注入参数
 * @returns 生成调度与输入查询 API
 */
export function useCanvasNodeOps(options: UseCanvasNodeOpsOptions) {
  const { store, gen, nodeMap, showSnackbar, getSelectedNode, getScope, onNodeResult, getOutputMtime } = options

  /** 生成完成/失败后通知 AssetCanvas 刷新节点产物展示 */
  function applyResult(nodeId: string, outputPath: string): void {
    onNodeResult?.(nodeId, outputPath)
  }

  /**
   * 校验节点是否已选择可提交的工作流实现（仅检查非空；实现是否仍存在由服务端严格校验兜底）。
   *
   * 覆盖不经过配置面板的生成入口（右键菜单「生成」、节点卡片重试等）：
   * 未选择时不发起请求，直接以 snackbar 提示，保证提交值与界面显示一致。
   *
   * @param node 生成节点数据
   * @returns 未选择时的提示文案；已选择（非空字符串）返回 null
   */
  function missingWorkflowImplMessage(node: CanvasNodeData): string | null {
    const v = node.config.workflowImpl
    return typeof v === 'string' && v !== '' ? null : '请先在节点配置中选择工作流实现'
  }

  /**
   * 触发生成节点：收集输入路径 → 注入 → 跑工作流；结果由服务端写盘，完成后回调刷新展示。
   * 获取视频帧/拼接视频/裁剪视频节点走本地 ffmpeg 路由（不走工作流）。
   *
   * @param nodeId 生成节点 id
   */
  async function generateNode(nodeId: string): Promise<void> {
    const node = nodeMap.value[nodeId]
    if (!node) return
    gen.clearStatus(nodeId)
    if (node.prototypeId === 'video-frame-extract') {
      // 获取视频帧：本地 ffmpeg 提取（不走工作流）
      await extractNodeFrame(nodeId)
      return
    }
    if (node.prototypeId === 'video-concat') {
      // 拼接视频：本地 ffmpeg 拼接（不走工作流）
      await concatNodeVideos(nodeId)
      return
    }
    if (node.prototypeId === 'video-trim') {
      // 裁剪视频：本地 ffmpeg 裁剪（不走工作流）
      await trimNodeVideo(nodeId)
      return
    }
    if (node.prototypeId === 'video-generate') {
      const implMsg = missingWorkflowImplMessage(node)
      if (implMsg) {
        showSnackbar(implMsg, 'error')
        return
      }
      const videoParams = buildVideoSubmitParams(node, {
        images: videoInputsOf(nodeId, 'image'),
        videos: videoInputsOf(nodeId, 'video'),
        audios: videoInputsOf(nodeId, 'audio'),
      })
      await gen.generate(node, videoParams, applyResult)
      return
    }
    if (node.prototypeId === 'tts-generate') {
      const implMsg = missingWorkflowImplMessage(node)
      if (implMsg) {
        showSnackbar(implMsg, 'error')
        return
      }
      // TTS 声音生成：收集音频输入路径（克隆模式参考音色）后走通用生成流程
      const paths = collectInputPaths(nodeId, store.connections.value, store.nodes.value, node.config, undefined, getScope())
      gen.setInputPaths(nodeId, paths)
      await gen.generate(node, undefined, applyResult)
      return
    }
    if (node.prototypeId !== 'image-generate') return
    const implMsg = missingWorkflowImplMessage(node)
    if (implMsg) {
      showSnackbar(implMsg, 'error')
      return
    }
    const paths = collectInputPaths(nodeId, store.connections.value, store.nodes.value, node.config, undefined, getScope())
    gen.setInputPaths(nodeId, paths)
    await gen.generate(node, undefined, applyResult)
  }

  /** 中断生成 */
  function onInterrupt(nodeId: string): void {
    void gen.interrupt(nodeId)
  }

  /**
   * 获取视频帧节点：收集输入视频路径并触发帧提取（服务端 ffmpeg）。
   *
   * @param nodeId 节点 id
   */
  async function extractNodeFrame(nodeId: string): Promise<void> {
    const node = nodeMap.value[nodeId]
    if (!node) return
    const videos = videoInputsOf(nodeId, 'video')
    const videoPath = videos[0]?.path
    if (!videoPath) {
      showSnackbar('请先连接视频输入', 'primary')
      return
    }
    gen.clearStatus(nodeId)
    await gen.extractFrame(node, videoPath, applyResult)
  }

  /**
   * 拼接视频节点：收集有序视频输入并触发服务端 ffmpeg 拼接。
   *
   * @param nodeId 节点 id
   */
  async function concatNodeVideos(nodeId: string): Promise<void> {
    const node = nodeMap.value[nodeId]
    if (!node) return
    const videos = videoInputsOf(nodeId, 'video')
    if (videos.length < 2) {
      showSnackbar('请至少连接两段视频', 'primary')
      return
    }
    gen.clearStatus(nodeId)
    await gen.concatVideo(node, videos.map((v) => v.path), applyResult)
  }

  /**
   * 裁剪视频节点：收集第一路视频输入并触发服务端 ffmpeg 裁剪。
   *
   * @param nodeId 节点 id
   */
  async function trimNodeVideo(nodeId: string): Promise<void> {
    const node = nodeMap.value[nodeId]
    if (!node) return
    const videos = videoInputsOf(nodeId, 'video')
    const videoPath = videos[0]?.path
    if (!videoPath) {
      showSnackbar('请先连接视频输入', 'primary')
      return
    }
    const rawDuration = node.config.duration
    const duration = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : 0
    if (!(duration > 0)) {
      showSnackbar('请填写有效的持续时长', 'primary')
      return
    }
    gen.clearStatus(nodeId)
    await gen.trimVideo(node, videoPath, applyResult)
  }

  /** 节点当前是否在生成中（供编辑器显示） */
  function isNodeRunning(nodeId: string): boolean {
    return gen.statusByNode.value[nodeId]?.status === 'running'
  }

  /**
   * 给收集到的输入资产信息附上来源节点产物的版本号（mtime）。
   *
   * 用途：输入预览 URL 的缓存键。只把「来源资产实际变化（mtime 更新）」作为刷新信号，
   * 否则编辑器因配置修改等重渲染时每次用 new Date.now() 作缓存键，会把所有输入图片/
   * 视频/音频当作新资源反复下载（浪费带宽 + 配置组件闪烁）。无 mtime 时保持 undefined。
   *
   * @param list 收集到的输入资产信息
   * @returns 附带版本号的输入资产信息（原对象不可变，返回新引用）
   */
  function withVersions(list: CanvasInputInfo[]): CanvasInputInfo[] {
    if (!getOutputMtime) return list
    return list.map((i) => ({ ...i, version: getOutputMtime(i.nodeId) ?? undefined }))
  }

  /** 节点当前输入资产信息（含来源节点，供编辑器预览/拖拽排序；生成类来源按固定产物路径推导） */
  function inputsOf(nodeId: string): CanvasInputInfo[] {
    const node = nodeMap.value[nodeId]
    return withVersions(collectInputs(nodeId, store.connections.value, store.nodes.value, node?.config, undefined, getScope()))
  }

  /**
   * 收集视频生成节点的输入资产并按来源节点输出类型过滤（图片/视频/音频）。
   *
   * 生成视频节点使用单一 media 输入连接点，素材类型由来源节点类型自动归类；
   * 返回结果按 config.inputOrder 排序（collectInputs 已处理）。
   *
   * @param nodeId 目标节点 id
   * @param type 来源节点输出类型（image / video / audio）
   * @returns 该类型输入资产信息数组
   */
  function videoInputsOf(nodeId: string, type: 'image' | 'video' | 'audio'): CanvasInputInfo[] {
    const node = nodeMap.value[nodeId]
    const all = withVersions(collectInputs(nodeId, store.connections.value, store.nodes.value, node?.config, undefined, getScope()))
    return all.filter((i) => getNodeOutputType(i.nodeId, store.nodes.value) === type)
  }

  /** 视频生成/拼接节点三组输入（非这两类节点为空数组；按 config.inputOrder 排序） */
  const videoInputGroups = computed(() => {
    const panelNode = getSelectedNode()
    const proto = panelNode?.prototypeId
    if (!panelNode || (proto !== 'video-generate' && proto !== 'video-concat')) {
      return { images: [] as CanvasInputInfo[], videos: [] as CanvasInputInfo[], audios: [] as CanvasInputInfo[] }
    }
    const id = panelNode.id
    return {
      images: videoInputsOf(id, 'image'),
      videos: videoInputsOf(id, 'video'),
      audios: videoInputsOf(id, 'audio'),
    }
  })

  /**
   * 上游更新角标：任一输入节点的产物 mtime 比本节点当前产物新 → 提示重新生成。
   * （产物 mtime 由 AssetCanvas 经 getOutputMtime 提供；无 mtime 信息时返回 false）
   *
   * @param nodeId 生成节点 id
   * @returns 是否有更上游的新产物
   */
  function isUpstreamUpdated(nodeId: string): boolean {
    const node = nodeMap.value[nodeId]
    if (!node || node.prototypeId !== 'image-generate') return false
    const curMtime = getOutputMtime?.(nodeId)
    if (curMtime == null) return false
    const incoming = store.connections.value.filter((c) => c.toNodeId === nodeId)
    for (const c of incoming) {
      const src = nodeMap.value[c.fromNodeId]
      if (!src) continue
      const srcMtime = getOutputMtime?.(src.id)
      if (srcMtime != null && srcMtime > curMtime) return true
    }
    return false
  }

  /**
   * 节点 body/editor 的 update:config → 合并写入节点 config。
   *
   * 注：生成结果（current/history）不再写入 config——产物为固定路径，由服务端落盘，
   * 展示刷新走 onNodeResult/nodeOutputs。
   *
   * @param nodeId 节点 id
   * @param patch 配置补丁
   */
  function onUpdateConfig(nodeId: string, patch: Record<string, unknown>): void {
    const node = nodeMap.value[nodeId]
    if (!node) return
    store.updateNode(nodeId, { config: { ...node.config, ...patch } })
  }

  /**
   * 快捷断开某个输入：删除该来源节点到目标节点的全部连线，并清理 config.inputOrder。
   *
   * 由编辑器输入项右上角红色 x 触发（不弹确认，与右键「断开连接」一致）。
   * store.disconnect 单独压撤销栈；removeInputOrderEntry 不重复入栈（结构变更已在
   * disconnect 前快照），一次 Ctrl+Z 同时回退「连线 + inputOrder」。
   * 生成视频节点联动：disconnect 触发 connectionSync，自动移除导演台对应素材块。
   *
   * @param nodeId 目标节点（生成图片/生成视频等）id
   * @param sourceNodeId 被断开的输入来源节点 id
   */
  function disconnectInput(nodeId: string, sourceNodeId: string): void {
    const incoming = store.connections.value.filter(
      (c) => c.toNodeId === nodeId && c.fromNodeId === sourceNodeId,
    )
    for (const c of incoming) {
      store.disconnect(c.id)
    }
    store.removeInputOrderEntry(nodeId, sourceNodeId)
  }

  return {
    generateNode,
    onInterrupt,
    extractNodeFrame,
    concatNodeVideos,
    trimNodeVideo,
    isNodeRunning,
    inputsOf,
    videoInputsOf,
    videoInputGroups,
    isUpstreamUpdated,
    onUpdateConfig,
    disconnectInput,
  }
}