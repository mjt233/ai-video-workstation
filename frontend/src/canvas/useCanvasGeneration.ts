import { ref } from 'vue'
import { writeFs } from '../api/client'
import { runWorkflow, getTaskStatus, getTaskLogs, type WorkflowUserParamValue } from '../api/workflow'
import type { CanvasNodeData, CanvasKind } from './types'
import { canvasNodeAssetPath, sceneCanvasRelPath, stageCanvasRelPath } from './paths'
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
}

/**
 * 生成图片节点的资产生成组合式：跑工作流、轮询状态、更新节点历史。
 *
 * @param project 项目名
 * @param target 画布目标（决定产物目录与 prompt 文件位置）
 */
export function useCanvasGeneration(project: string, target: GenTarget) {
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
      target.kind === 'stage'
        ? { kind: 'stage' as const, primary: target.stage ?? '' }
        : { kind: 'scene' as const, primary: target.episode ?? '', secondary: target.shot }
    return canvasNodeAssetPath(scope, node.id, version)
  }

  /** 计算生成节点 prompt 文件相对路径（文生图工作流需要） */
  function computePromptPath(nodeId: string): string {
    if (target.kind === 'stage') {
      const rel = stageCanvasRelPath(target.stage ?? '')
      const dir = rel.replace(/canvas\.json$/, '')
      return `${dir}canvas/${nodeId}/prompt.md`
    }
    const rel = sceneCanvasRelPath(target.episode ?? '', target.shot ?? '')
    const dir = rel.replace(/canvas\.json$/, '')
    return `${dir}canvas/${nodeId}/prompt.md`
  }

  /**
   * 触发生成节点的资产生成。
   *
   * @param node 生成图片节点数据
   * @param updateConfig 更新节点配置的回调（由调用方写入 current/history）
   */
  async function generate(node: CanvasNodeData, updateConfig: (config: Record<string, unknown>) => void): Promise<void> {
    const nodeId = node.id
    if (statusByNode.value[nodeId]?.status === 'running') return

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

  /** 中断生成 */
  async function interrupt(nodeId: string): Promise<void> {
    const taskId = taskIdByNode.value[nodeId]
    if (!taskId) return
    if (pollTimers[nodeId]) {
      clearInterval(pollTimers[nodeId])
      delete pollTimers[nodeId]
    }
    statusByNode.value[nodeId] = { status: 'error', errorMsg: '已中断', taskId }
    // 现有 API 无取消端点，v1 仅停止前端轮询与状态展示
  }

  /** 清除节点状态（如失败后重试前） */
  function clearStatus(nodeId: string): void {
    delete statusByNode.value[nodeId]
  }

  return { statusByNode, setInputPaths, generate, interrupt, clearStatus, computeOutputPath }
}
