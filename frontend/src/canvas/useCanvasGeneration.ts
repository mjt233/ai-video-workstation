import { ref } from 'vue'
import { writeFs } from '../api/client'
import { runWorkflow, getTaskStatus, getTaskLogs, cancelWorkflow, type WorkflowUserParamValue } from '../api/workflow'
import { extractVideoFrame, extractVideoFrameAtTime, concatVideo as requestConcatVideo, trimVideo as requestTrimVideo } from './api'
import type { VideoSubmitParams } from './videoSubmit'
import type { CanvasNodeData, CanvasKind } from './types'
import { canvasNodeOutputPath, sceneCanvasRelPath, type CanvasScope } from './paths'
import { getPrototype } from './registry'

/** 生成状态（挂在生成节点上展示；仅页面会话内的展示态，不持久化） */
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
 * 生成节点资产生成组合式：跑工作流、轮询状态（纯体验层）、通知结果。
 *
 * 产物路径为固定文件名 output.{ext}（"当前结果"为文件系统事实）：本组合式只管提交与状态展示，
 * **不再回写 config.current/history**（结果落盘由服务端引擎/路由完成，页面离开/关闭后结果依然存在，
 * 重新进入画布时按固定路径直接可见；历史由服务端 history API 管理）。
 *
 * @param project 项目名
 * @param target 画布目标（决定产物目录与 prompt 文件位置）
 */
export function useCanvasGeneration(project: string, target: GenTarget) {
  /** 当前生成目标（切换分镜/场景时通过 switchTarget 更新） */
  const targetRef = ref<GenTarget>({ ...target })
  /** nodeId → 生成状态（仅页面展示） */
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

  /** 当前画布作用域（产物路径推导用） */
  function getScope(): CanvasScope {
    if (targetRef.value.kind === 'stage') {
      return { kind: 'stage', primary: targetRef.value.stage ?? '', label: targetRef.value.label }
    }
    return { kind: 'scene', primary: targetRef.value.episode ?? '', secondary: targetRef.value.shot }
  }

  /**
   * 计算生成节点的产物路径（固定文件名 output.{ext}，扩展名取原型声明）。
   *
   * @param node 生成节点数据
   * @returns assert 相对路径
   */
  function computeOutputPath(node: CanvasNodeData): string {
    const ext = getPrototype(node.prototypeId)?.outputExt ?? 'jpg'
    return canvasNodeOutputPath(getScope(), node.id, ext)
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
   * 触发生成节点的资产生成（异步任务：提交后由服务端队列执行，轮询仅展示状态）。
   *
   * - 图片节点：走既有 prompt/inputPaths 逻辑（text-to-image / image-edit）
   * - 视频节点（video-generate）：走自包含提交参数（videoParams，组装后传入）
   * - TTS 节点（tts-generate）：按模式组装 vars（design：text/prompt；clone：text/refText/refAudioPath），
   *   克隆模式需先连接音频输入作为参考音色，产物为 .flac
   *
   * @param node 生成节点数据（图片、视频或 TTS）
   * @param videoParams 视频生成节点的自包含提交参数（仅 video-generate 需要）
   * @param onResult 任务完成（含失败）时的回调（nodeId, outputPath），供 UI 刷新产物展示；可省略
   */
  async function generate(
    node: CanvasNodeData,
    videoParams?: VideoSubmitParams,
    onResult?: (nodeId: string, outputPath: string) => void,
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
          impl: String(node.config.workflowImpl ?? ''),
          params: {
            vars: {},
            outputPath,
            userParams: (node.config.workflowParams as Record<string, WorkflowUserParamValue> | undefined) ?? {},
            video: videoParams,
          },
        })
        taskIdByNode.value[nodeId] = taskId
        poll(taskId, node, outputPath, onResult)
      } catch (e) {
        statusByNode.value[nodeId] = {
          status: 'error',
          errorMsg: e instanceof Error ? e.message : String(e),
        }
      }
      return
    }

    // ── TTS 声音生成节点：按模式组装 vars ──
    if (node.prototypeId === 'tts-generate') {
      const mode = node.config.mode === 'clone' ? 'clone' : 'design'
      const text = String(node.config.text ?? '')
      const inputPaths = inputPathsRef.value[nodeId] ?? []
      if (mode === 'clone' && inputPaths.length < 1) {
        statusByNode.value[nodeId] = { status: 'error', errorMsg: '音色克隆需先连接音频输入作为参考音色' }
        return
      }
      const workflowId = mode === 'clone' ? 'tts-voice-clone' : 'tts-voice-design'
      const vars: Record<string, string> =
        mode === 'clone'
          ? { text, refText: String(node.config.refText ?? ''), refAudioPath: JSON.stringify(inputPaths) }
          : { text, prompt: String(node.config.prompt ?? '') }
      const impl = String(node.config.workflowImpl ?? '')
      const outputPath = computeOutputPath(node)
      const userParams = (node.config.workflowParams as Record<string, WorkflowUserParamValue> | undefined) ?? {}
      statusByNode.value[nodeId] = { status: 'running' }
      try {
        const { taskId } = await runWorkflow({
          project,
          workflowId,
          impl,
          params: { vars, outputPath, userParams },
        })
        taskIdByNode.value[nodeId] = taskId
        poll(taskId, node, outputPath, onResult)
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
    const impl = String(config.workflowImpl ?? '')
    const outputPath = computeOutputPath(node)

    let vars: Record<string, string>
    if (workflowId === 'image-edit') {
      vars = { prompt, imagePaths: JSON.stringify(inputPaths), purpose: 'canvas-image' }
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
      poll(taskId, node, outputPath, onResult)
    } catch (e) {
      statusByNode.value[nodeId] = {
        status: 'error',
        errorMsg: e instanceof Error ? e.message : String(e),
      }
    }
  }

  /**
   * 轮询任务状态（纯体验层：只更新 statusByNode 展示，成功后通知结果）。
   *
   * 结果落盘不依赖本轮询（服务端独立完成）；即使轮询全部中断，重新进入画布时
   * 产物按固定路径直接可见。首轮立即查询一次，避免结果已就绪时等待 2s。
   *
   * @param taskId 任务 id
   * @param node 生成节点数据
   * @param outputPath 产物相对路径（服务端实际写入路径）
   * @param onResult 完成（含失败）回调（nodeId, outputPath），可省略
   */
  function poll(
    taskId: string,
    node: CanvasNodeData,
    outputPath: string,
    onResult?: (nodeId: string, outputPath: string) => void,
  ): void {
    if (pollTimers[node.id]) clearInterval(pollTimers[node.id])
    const tick = async (): Promise<void> => {
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

        if (done || isError) {
          clearInterval(pollTimers[node.id])
          delete pollTimers[node.id]
          if (done) onResult?.(node.id, outputPath)
        }
      } catch {
        // 轮询失败忽略，下轮重试
      }
    }
    void tick()
    pollTimers[node.id] = setInterval(() => void tick(), 2000)
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

  /**
   * 获取视频帧节点的帧提取：调用服务端 ffmpeg 接口，成功后通知结果（产物为固定 output.png）。
   *
   * 提取方式：优先按时间点（config.frameTime，「提取当前帧」写入，ffmpeg -ss 呈现序精确选帧）；
   * 无 frameTime 时按帧索引（config.frameIndex，0=首帧、1=第二帧、-1=尾帧、-2=倒数第二帧，解码序 select）。
   *
   * @param node 获取视频帧节点数据
   * @param videoPath 输入视频相对路径（来自连线输入）
   * @param onResult 完成（含失败）回调（nodeId, outputPath），可省略
   */
  async function extractFrame(
    node: CanvasNodeData,
    videoPath: string,
    onResult?: (nodeId: string, outputPath: string) => void,
  ): Promise<void> {
    const nodeId = node.id
    if (statusByNode.value[nodeId]?.status === 'running') return
    statusByNode.value[nodeId] = { status: 'running' }
    try {
      const outputPath = computeOutputPath(node)
      const time = node.config.frameTime
      const hasTime = typeof time === 'number' && Number.isFinite(time)
      const raw = node.config.frameIndex
      const frameIndex = typeof raw === 'number' && Number.isInteger(raw) ? raw : 0
      const res = hasTime
        ? await extractVideoFrameAtTime(project, videoPath, time as number, outputPath)
        : await extractVideoFrame(project, videoPath, frameIndex, outputPath)
      statusByNode.value[nodeId] = {
        status: 'success',
        lastLog: hasTime ? `已提取第 ${time} 秒处画面` : `已提取第 ${frameIndex} 帧`,
      }
      onResult?.(nodeId, res.path)
    } catch (e) {
      statusByNode.value[nodeId] = {
        status: 'error',
        errorMsg: e instanceof Error ? e.message : String(e),
      }
    }
  }

  /**
   * 拼接视频节点的视频拼接：调用服务端 ffmpeg 接口，成功后通知结果（产物为固定 output.mp4）。
   *
   * 同步路由（ffmpeg 阻塞等待），无轮询；各段视频规格须一致（服务端校验，否则报错）。
   *
   * @param node 拼接视频节点数据
   * @param videoPaths 输入视频相对路径数组（assert/ 下，按拼接顺序）
   * @param onResult 完成（含失败）回调（nodeId, outputPath），可省略
   */
  async function concatVideo(
    node: CanvasNodeData,
    videoPaths: string[],
    onResult?: (nodeId: string, outputPath: string) => void,
  ): Promise<void> {
    const nodeId = node.id
    if (statusByNode.value[nodeId]?.status === 'running') return
    statusByNode.value[nodeId] = { status: 'running' }
    try {
      const outputPath = computeOutputPath(node)
      const res = await requestConcatVideo(project, videoPaths, outputPath)
      statusByNode.value[nodeId] = {
        status: 'success',
        lastLog: `已拼接 ${videoPaths.length} 段视频`,
      }
      onResult?.(nodeId, res.path)
    } catch (e) {
      statusByNode.value[nodeId] = {
        status: 'error',
        errorMsg: e instanceof Error ? e.message : String(e),
      }
    }
  }

  /**
   * 裁剪视频节点：调用服务端 ffmpeg 接口，成功后通知结果（产物固定覆盖 output.mp4）。
   *
   * 同步路由（ffmpeg 阻塞等待），无轮询；重复裁剪时旧产物由服务端归档进历史目录。
   *
   * @param node 裁剪视频节点数据
   * @param videoPath 输入视频相对路径（来自连线输入）
   * @param onResult 完成（含失败）回调（nodeId, outputPath），可省略
   */
  async function trimVideo(
    node: CanvasNodeData,
    videoPath: string,
    onResult?: (nodeId: string, outputPath: string) => void,
  ): Promise<void> {
    const nodeId = node.id
    if (statusByNode.value[nodeId]?.status === 'running') return
    statusByNode.value[nodeId] = { status: 'running' }
    try {
      const outputPath = computeOutputPath(node)
      const startMode = node.config.startMode === 'frame' ? 'frame' : 'time'
      const rawStart = node.config.startValue
      const startValue = typeof rawStart === 'number' && Number.isFinite(rawStart) ? rawStart : 0
      const rawDuration = node.config.duration
      const duration = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : 0
      const params =
        startMode === 'frame'
          ? { startFrame: Math.trunc(startValue), duration }
          : { startTime: startValue, duration }
      const res = await requestTrimVideo(project, videoPath, params, outputPath)
      statusByNode.value[nodeId] = {
        status: 'success',
        lastLog: startMode === 'frame'
          ? `已从第 ${params.startFrame} 帧裁剪 ${duration}s`
          : `已从 ${startValue}s 处裁剪 ${duration}s`,
      }
      onResult?.(nodeId, res.path)
    } catch (e) {
      statusByNode.value[nodeId] = {
        status: 'error',
        errorMsg: e instanceof Error ? e.message : String(e),
      }
    }
  }

  /** 重置全部生成状态与轮询（切换画布目标时调用；结果已由服务端落盘，重置仅清展示态） */
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

  return { statusByNode, setInputPaths, generate, extractFrame, concatVideo, trimVideo, interrupt, clearStatus, computeOutputPath, getScope, reset, switchTarget }
}