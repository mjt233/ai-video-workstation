/**
 * 生成节点调度组合式：按节点原型分发生成动作，并向编辑器/节点卡片提供输入收集等查询。
 * 与 useCanvasGeneration（工作流执行/轮询）配合：本组合式负责收集输入、组装提交参数并回调回写 config。
 */

import { computed } from 'vue'
import { buildVideoSubmitParams } from '../../../canvas/videoSubmit'
import { collectInputPaths, collectInputs, getNodeCurrentAssetPath, type CanvasInputInfo } from '../../../canvas/generate'
import { getNodeOutputType } from '../../../canvas/connection'
import type { CanvasNodeData } from '../../../canvas/types'
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
}

/**
 * 生成节点调度组合式。
 *
 * @param options 依赖注入参数
 * @returns 生成调度与输入查询 API
 */
export function useCanvasNodeOps(options: UseCanvasNodeOpsOptions) {
  const { store, gen, nodeMap, showSnackbar, getSelectedNode } = options

  /**
   * 触发生成节点：收集输入路径 → 注入 → 跑工作流，并把 current/history 回写节点配置。
   * 视频节点（video-generate）额外组装自包含提交参数后传给 generate。
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
      const videoParams = buildVideoSubmitParams(node, {
        images: videoInputsOf(nodeId, 'image'),
        videos: videoInputsOf(nodeId, 'video'),
        audios: videoInputsOf(nodeId, 'audio'),
      })
      await gen.generate(
        node,
        (config) => {
          store.updateNode(nodeId, { config })
        },
        videoParams,
      )
      return
    }
    if (node.prototypeId === 'tts-generate') {
      // TTS 声音生成：收集音频输入路径（克隆模式参考音色）后走通用生成流程
      const paths = collectInputPaths(nodeId, store.connections.value, store.nodes.value, node.config)
      gen.setInputPaths(nodeId, paths)
      await gen.generate(node, (config) => {
        store.updateNode(nodeId, { config })
      })
      return
    }
    if (node.prototypeId !== 'image-generate') return
    const paths = collectInputPaths(nodeId, store.connections.value, store.nodes.value, node.config)
    gen.setInputPaths(nodeId, paths)
    await gen.generate(node, (config) => {
      store.updateNode(nodeId, { config })
    })
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
    await gen.extractFrame(node, videoPath, (config) => {
      store.updateNode(nodeId, { config })
    })
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
    await gen.concatVideo(node, videos.map((v) => v.path), (config) => {
      store.updateNode(nodeId, { config })
    })
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
    await gen.trimVideo(node, videoPath, (config) => {
      store.updateNode(nodeId, { config })
    })
  }

  /** 节点当前是否在生成中（供编辑器显示） */
  function isNodeRunning(nodeId: string): boolean {
    return gen.statusByNode.value[nodeId]?.status === 'running'
  }

  /** 节点当前输入资产信息（含来源节点，供编辑器预览/拖拽排序） */
  function inputsOf(nodeId: string): CanvasInputInfo[] {
    const node = nodeMap.value[nodeId]
    return collectInputs(nodeId, store.connections.value, store.nodes.value, node?.config)
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
    const all = collectInputs(nodeId, store.connections.value, store.nodes.value, node?.config)
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

  /** 上游更新角标：生成节点任一输入节点资产比本节点新（current.date 更大）则显示 */
  function isUpstreamUpdated(nodeId: string): boolean {
    const node = nodeMap.value[nodeId]
    if (!node || node.prototypeId !== 'image-generate') return false
    const cur = node.config.current as { date?: string } | undefined
    if (!cur?.date) return false
    const incoming = store.connections.value.filter((c) => c.toNodeId === nodeId)
    for (const c of incoming) {
      const src = nodeMap.value[c.fromNodeId]
      if (!getNodeCurrentAssetPath(src)) continue
      const srcCur = src.config.current as { date?: string } | undefined
      if (srcCur?.date && srcCur.date > cur.date) return true
    }
    return false
  }

  /**
   * 节点 body/editor 的 update:config → 合并写入节点 config。
   *
   * @param nodeId 节点 id
   * @param patch 配置补丁
   */
  function onUpdateConfig(nodeId: string, patch: Record<string, unknown>): void {
    const node = nodeMap.value[nodeId]
    if (!node) return
    store.updateNode(nodeId, { config: { ...node.config, ...patch } })
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
  }
}
