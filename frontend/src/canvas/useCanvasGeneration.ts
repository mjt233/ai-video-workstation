import { ref } from 'vue'
import { writeFs } from '../api/client'
import { runWorkflow, getTaskStatus, getTaskLogs, cancelWorkflow, type WorkflowUserParamValue } from '../api/workflow'
import type { VideoSubmitParams } from './videoSubmit'
import type { CanvasNodeData, CanvasKind } from './types'
import { canvasNodeAssetPath, sceneCanvasRelPath } from './paths'
import { getHistory, type HistoryEntry } from './generate'
import { nextVersion } from './types'

/** 生成状态（挂在生成节点上展示） */
export interface GenerateStatus {
  status: 'running' | 'success' | 'error'
  progress?: number
  lastLog?: string
  errorMsg?: string
  taskId?: string
}

/** 生成目标（与画布目标一致） */
export interface GenTarget {
  kind: CanvasKind
  stage?: string
  episode?: string
  shot?: string
  /** stage 画布时的子场景标签 */
  label?: string
}

/**
 * 生成图片节点的资产生成组合式：跑工作流、轮询状态、更新节点历史。
 *
 * @param project 项目名
 * @param target 画布目标（决定产物目录与 prompt 文件位置）
 */
export function useCanvasGeneration(project: string, target: GenTarget) {
  /** 当前生成目标（切换分镜/场景时通过 switchTarget 更新） */
  const targetRef = ref<GenTarget>({ ...target })
  /** nodeId → 生成状态 */
  const statusByNode = ref<Record<string, GenerateStatus>>({})
  /** nodeId → 轮询句柄 */
  const pollTimers: Record<string, ReturnType<typeof setInterval>> = {}

  /** nodeId → 输入资产路径（由调用方通过 setInputPaths 注入） */
  const inputPathsRef = ref<Record<string, string[]>>({})
  /** nodeId → 当前 taskId（用于中断） */
  const taskIdByNode = ref<Record<string, string>>({})

  /**
   * 注入某节点的输入资产路径（由 AssetCanvas 在发起生成前计算）。
   *
   * @param nodeId 节点 id
   * @param paths 输入资产相对路径数组
   */
  function setInputPaths(nodeId: string, paths: string[]): void {
    inputPathsRef.value[nodeId] = paths
  }

  /** 计算生成节点的产物路径（版本号 = 历史长度 + 1） */
  function computeOutputPath(node: CanvasNodeData): string {
    const version = nextVersion(getHistory(node.config))
    const scope =
      targetRef.value.kind === 'stage'
        ? {
            kind: 'stage' as const,
            primary: targetRef.value.stage ?? '',
            label: targetRef.value.label,
          }
        : { kind: 'scene' as const, primary: targetRef.value.episode ?? '', secondary: targetRef.value.shot }
    const base = canvasNodeAssetPath(scope, node.id, version)
    if (node.prototypeId === 'video-generate') {
      // 视频产物扩展名替换为 .mp4（图片路径助手默认 .jpg）
      return base.replace(/\.jpg$/, '.mp4')
    }
    return base
  }

  /** 计算生成节点 prompt 文件相对路径（文生图工作流需要） */
  function computePromptPath(nodeId: string): string {
    if (targetRef.value.kind === 'stage') {
      return `prompt/stage/${targetRef.value.stage ?? ''}/canvas/${targetRef.value.label ?? ''}/${nodeId}/prompt.md`
    }
    const rel = sceneCanvasRelPath(targetRef.value.episode ?? '', targetRef.value.shot ?? '')
    const dir = rel.replace(/canvas\.json$/, '')
    return `${dir}canvas/${nodeId}/prompt.md`
  }

  /**
   * 触发生成节点的资产生成。
   *
   * - 图片节点：走既有 prompt/inputPaths 逻辑（text-to-image / image-edit）
   * - 视频节点（video-generate）：走自包含提交参数（videoParams，组装后传入）
   *
   * @param node 生成节点数据（图片或视频）
   * @param updateConfig 更新节点配置的回调（由调用方写入 current/history）
   * @param videoParams 视频生成节点的自包含提交参数（仅 video-generate 需要）
   */
  async function generate(
    node: CanvasNodeData,
    updateConfig: (config: Record<string, unknown>) => void,
    videoParams?: VideoSubmitParams,
  ): Promise<void> {
    const nodeId = node.id
    if (statusByNode.value[nodeId]?.status === 'running') return

    // ── 视频生成节点：走自包含提交参数 ──
    if (node.prototypeId === 'video-generate') {
      if (!videoParams) {
        statusByNode.value[nodeId] = { status: 'error', errorMsg: '缺少视频提交参数' }
        return
      }
      statusByNode.value[nodeId] = { status: 'running' }
      try {
        const outputPath = computeOutputPath(node)
        const { taskId } = await runWorkflow({
          project,
          workflowId: 'image-to-video',
          impl: String(node.config.workflowImpl ?? 'default'),
          params: {
            vars: {},
            outputPath,
            userParams: (node.config.workflowParams as Record<string, WorkflowUserParamValue> | undefined) ?? {},
            video: videoParams,
          },
        })
        taskIdByNode.value[nodeId] = taskId
        poll(taskId, node, outputPath, updateConfig)
      } catch (e) {
        statusByNode.value[nodeId] = {
          status: 'error',
          errorMsg: e instanceof Error ? e.message : String(e),
        }
      }
      return
    }

    const config = node.config
    const prompt = String(config.prompt ?? '')
    const inputPaths = inputPathsRef.value[nodeId] ?? []
    const explicitWorkflow = typeof config.workflowId === 'string' && config.workflowId ? config.workflowId : undefined
    const workflowId = explicitWorkflow ?? (inputPaths.length > 0 ? 'image-edit' : 'text-to-image')
    const impl = String(config.workflowImpl ?? 'default')
    const outputPath = computeOutputPath(node)

    let vars: Record<string, string>
    if (workflowId === 'image-edit') {
      vars = { desc: prompt, imagePaths: JSON.stringify(inputPaths), purpose: 'canvas-image' }
    } else {
      const promptPath = computePromptPath(nodeId)
      await writeFs(project, promptPath, prompt)
      vars = { promptPath, purpose: 'canvas-image' }
    }

    const userParams = (config.workflowParams as Record<string, WorkflowUserParamValue> | undefined) ?? {}
    statusByNode.value[nodeId] = { status: 'running' }

    try {
      const { taskId } = await runWorkflow({
        project,
        workflowId,
        impl,
        params: { vars, outputPath, userParams },
      })
      taskIdByNode.value[nodeId] = taskId
      poll(taskId, node, outputPath, updateConfig)
    } catch (e) {
      statusByNode.value[nodeId] = {
        status: 'error',
        errorMsg: e instanceof Error ? e.message : String(e),
      }
    }
  }

  function poll(
    taskId: string,
    node: CanvasNodeData,
    outputPath: string,
    updateConfig: (config: Record<string, unknown>) => void,
  ): void {
    if (pollTimers[node.id]) clearInterval(pollTimers[node.id])
    pollTimers[node.id] = setInterval(async () => {
      try {
        const task = await getTaskStatus(taskId)
        const logs = await getTaskLogs(taskId).catch(() => [])
        const lastLog = logs.length > 0 ? String(logs[logs.length - 1].message) : undefined
        // 服务端终态为 completed/failed（TaskStatus = pending | running | completed | failed）
        const done = task.status === 'completed'
        const isError = task.status === 'failed' || task.status === 'error' || task.status === 'cancelled'
        statusByNode.value[node.id] = {
          status: task.status === 'running' || task.status === 'pending' ? 'running' : done ? 'success' : 'error',
          lastLog,
          taskId,
          errorMsg: task.errorMsg,
        }

        if (done) {
          clearInterval(pollTimers[node.id])
          delete pollTimers[node.id]
          const history: HistoryEntry[] = [...getHistory(node.config), { version: nextVersion(getHistory(node.config)), path: outputPath, date: new Date().toISOString() }]
          updateConfig({
            ...node.config,
            current: { version: nextVersion(getHistory(node.config)), path: outputPath, date: new Date().toISOString() },
            history,
          })
        } else if (isError) {
          clearInterval(pollTimers[node.id])
          delete pollTimers[node.id]
          statusByNode.value[node.id] = { status: 'error', errorMsg: task.errorMsg, taskId }
        }
      } catch {
        // 轮询失败忽略，下轮重试
      }
    }, 2000)
  }

  /**
   * 中断生成：调用后端 cancel 端点 + 停轮询 + 状态置已中断。
   *
   * @param nodeId 生成节点 id
   */
  async function interrupt(nodeId: string): Promise<void> {
    const taskId = taskIdByNode.value[nodeId]
    if (!taskId) return
    if (pollTimers[nodeId]) {
      clearInterval(pollTimers[nodeId])
      delete pollTimers[nodeId]
    }
    statusByNode.value[nodeId] = { status: 'error', errorMsg: '已中断', taskId }
    try {
      await cancelWorkflow(taskId)
    } catch {
      // cancel 失败不阻断状态展示（后端任务可能已结束）
    }
  }

  /** 清除节点状态（如失败后重试前） */
  function clearStatus(nodeId: string): void {
    delete statusByNode.value[nodeId]
  }

  /** 重置全部生成状态与轮询（切换画布目标时调用） */
  function reset(): void {
    for (const id of Object.keys(pollTimers)) {
      clearInterval(pollTimers[id])
      delete pollTimers[id]
    }
    statusByNode.value = {}
    inputPathsRef.value = {}
    taskIdByNode.value = {}
  }

  /**
   * 切换生成目标（如切换分镜/场景）并重置全部生成状态。
   *
   * @param newTarget 新生成目标
   */
  function switchTarget(newTarget: GenTarget): void {
    targetRef.value = { ...newTarget }
    reset()
  }

  return { statusByNode, setInputPaths, generate, interrupt, clearStatus, computeOutputPath, switchTarget }
}
