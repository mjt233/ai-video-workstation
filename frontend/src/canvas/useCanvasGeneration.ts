import { ref } from 'vue'
import { writeFs } from '../api/client'
import {
  runWorkflow,
  getTaskStatus,
  getTaskLogs,
  listTasks as listWorkflowTasks,
  type TaskResponse,
  type WorkflowSizeConfig,
  type WorkflowUserParamValue,
} from '../api/workflow'
import { cancelTask, listTasks as listActiveTasks } from '../api/tasks'
import {
  taskSocket,
  type LlmCanvasTarget,
  type TaskInfo,
  type TaskStatus,
} from './taskSocket'
import {
  extractVideoFrame,
  extractVideoFrameAtTime,
  concatVideo as requestConcatVideo,
  trimVideo as requestTrimVideo,
  trimAudio as requestTrimAudio,
  getCanvasNodeInfo,
  type CanvasTaskTarget,
  type ConcatVideoParams,
} from './api'
import { audioTrimBitrateOf, audioTrimFormatOf, audioTrimOutputExt } from './audioTrim'
import type { VideoSubmitParams } from './videoSubmit'
import type { CanvasNodeData, CanvasKind } from './types'
import { canvasNodeOutputPath, sceneCanvasRelPath, type CanvasScope } from './paths'
import { getPrototype } from './registry'

/** 生成状态（挂在节点上展示；running 由节点卡片渲染通用 loading 遮罩） */
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

/** useCanvasGeneration 选项 */
export interface UseCanvasGenerationOptions {
  /**
   * 任务完成（含失败后恢复完成的场景）时的默认回调（nodeId, outputPath）：
   * 由 AssetCanvas 注入，用于刷新节点产物展示（固定路径 + mtime）。
   * 生成调用传入的 per-call 回调优先于本回调。
   */
  onResult?: (nodeId: string, outputPath: string) => void
  /**
   * 中断请求被服务端拒绝或发送失败时的回调（nodeId, 原因文案）：
   * 由 AssetCanvas 注入（snackbar 提示），保证中断失败对用户可见、不静默。
   */
  onCancelRejected?: (nodeId: string, reason: string) => void
}

/** LLM 中断收敛超时（毫秒）：HTTP 兜底已确认但 WS 断连时本地结束 Loading */
const LLM_CONVERGE_TIMEOUT_MS = 3000
/** 工作流状态轮询间隔（毫秒；工作流任务仍是 SQLite + 轮询，ffmpeg 走 WS 推送） */
const POLL_INTERVAL_MS = 2000

/**
 * 创建「空闲」生成组合式（蓝图编辑器专用）：与 `useCanvasGeneration` **同形状**，
 * 但不订阅 WebSocket、不轮询、不恢复任务，全部执行类方法为空操作。
 *
 * 用途：`AssetCanvas` 在 `mode='blueprint'` 时注入本对象——蓝图不产生产物、不跑工作流，
 * 节点卡片的运行态/产物刷新/任务恢复逻辑天然为空，无需在模板里到处加分支。
 *
 * @returns 与 useCanvasGeneration 相同形状的空实现
 */
export function createIdleGeneration(): ReturnType<typeof useCanvasGeneration> {
  /** 恒为空的状态表（无任何节点处于运行态） */
  const statusByNode = ref<Record<string, GenerateStatus>>({})
  /** 空异步操作 */
  const noopAsync = async (): Promise<void> => {
    // 蓝图模式不执行生成类操作：有意忽略（调用方在蓝图模式下不会触达这些入口）
  }
  return {
    statusByNode,
    setInputPaths: () => {
      // 蓝图模式无输入路径收集：有意忽略
    },
    generate: noopAsync,
    extractFrame: noopAsync,
    concatVideo: noopAsync,
    trimVideo: noopAsync,
    trimAudio: noopAsync,
    interrupt: noopAsync,
    clearStatus: () => {
      // 状态表恒为空：有意忽略
    },
    // 产物路径在蓝图模式下不会被使用（产物信息刷新已跳过），保留纯推导以兼容类型
    computeOutputPath: (node: CanvasNodeData) =>
      canvasNodeOutputPath({ kind: 'stage', primary: '' }, node.id, getPrototype(node.prototypeId)?.outputExt ?? 'jpg'),
    getScope: (): CanvasScope => ({ kind: 'stage', primary: '' }),
    reset: () => {
      // 无轮询/定时器：有意忽略
    },
    dispose: () => {
      // 无订阅：有意忽略
    },
    restore: async () => {
      // 蓝图模式不恢复任务：有意忽略
    },
    switchTarget: async () => {
      // 蓝图模式不切换目标：有意忽略
    },
    beginClientRun: () => {
      // 蓝图模式无客户端运行态：有意忽略
    },
    updateClientRun: () => {
      // 蓝图模式无客户端运行态：有意忽略
    },
    endClientRun: () => {
      // 蓝图模式无客户端运行态：有意忽略
    },
    setLlmError: () => {
      // 蓝图模式无 LLM 会话：有意忽略
    },
    interruptLlm: () => {
      // 蓝图模式无 LLM 会话：有意忽略
    },
  }
}

/**
 * 生成节点资产生成组合式：跑工作流、轮询状态（纯体验层）、通知结果、中断。
 *
 * **任务状态来源**：
 * - 工作流任务（AI 生成）：提交后本地轮询 `GET /api/workflow/tasks/:id`（引擎为权威）；
 * - ffmpeg 任务（拼接/裁剪/取帧）：提交后立即返回 taskId，进度与终态由统一任务注册表经
 *   WS（`taskSocket`）广播驱动；刷新/切换画布后由 `restore()` 按 项目 + 画布 scope 恢复。
 *
 * 产物路径为固定文件名 output.{ext}（"当前结果"为文件系统事实）：本组合式只管提交与状态展示，
 * **不回写 config.current/history**（结果落盘由服务端引擎/执行器完成，页面离开/关闭后结果依然存在，
 * 重新进入画布时按固定路径直接可见；历史由服务端 history API 管理）。
 *
 * @param project 项目名
 * @param target 画布目标（决定产物目录、prompt 文件位置与任务 scope 过滤）
 * @param options 选项（默认结果回调等）
 */
export function useCanvasGeneration(project: string, target: GenTarget, options: UseCanvasGenerationOptions = {}) {
  /** 当前生成目标（切换分镜/场景时通过 switchTarget 更新） */
  const targetRef = ref<GenTarget>({ ...target })
  /** nodeId → 生成状态（仅页面展示） */
  const statusByNode = ref<Record<string, GenerateStatus>>({})
  /** nodeId → 工作流轮询句柄 */
  const pollTimers: Record<string, ReturnType<typeof setInterval>> = {}

  /** nodeId → 输入资产路径（由调用方通过 setInputPaths 注入） */
  const inputPathsRef = ref<Record<string, string[]>>({})
  /** nodeId → 当前 taskId（用于中断） */
  const taskIdByNode = ref<Record<string, string>>({})
  /** nodeId → LLM 中断收敛超时定时器（3 秒兜底：WS 断连时本地结束 Loading） */
  const llmConvergeTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  /** nodeId → 该节点 ffmpeg 任务的产物路径（终态广播时刷新产物用） */
  const ffmpegOutputByNode: Record<string, string> = {}
  /** nodeId → 结果回调（per-call 优先，统一终态广播时调用） */
  const ffmpegResultCbByNode: Record<string, ((nodeId: string, outputPath: string) => void) | undefined> = {}

  /** 默认结果回调（恢复任务完成时刷新产物展示用） */
  const onResultCb = options.onResult
  /** 中断请求被拒绝/失败回调（AssetCanvas 注入，snackbar 提示用） */
  const onCancelRejectedCb = options.onCancelRejected

  /**
   * 统一任务广播监听：ffmpeg 任务进度写节点阶段日志，终态刷新产物并结束 loading。
   *
   * 订阅一次（composable 生命周期内），按 taskIdByNode 反查节点；
   * 任务终态由服务端注册表广播，前端无需轮询。
   */
  const offTaskUpdate = taskSocket.onTaskUpdate((task) => {
    if (task.type !== 'ffmpeg') return
    const nodeId = Object.keys(taskIdByNode.value).find((id) => taskIdByNode.value[id] === task.id)
    if (!nodeId) return
    if (task.status === 'running' || task.status === 'pending') {
      const s = statusByNode.value[nodeId]
      if (s && s.status === 'running' && typeof task.progress === 'number') {
        s.progress = task.progress
        s.lastLog = `处理中 ${task.progress}%`
      }
      return
    }
    // 终态：移出任务映射后收敛节点状态
    const outputPath = ffmpegOutputByNode[nodeId] ?? ''
    const cb = ffmpegResultCbByNode[nodeId]
    delete ffmpegOutputByNode[nodeId]
    delete ffmpegResultCbByNode[nodeId]
    delete taskIdByNode.value[nodeId]
    if (task.status === 'completed') {
      const payloadPath = typeof task.payload?.outputPath === 'string' ? task.payload.outputPath : ''
      const finalPath = outputPath || payloadPath
      statusByNode.value[nodeId] = { status: 'success', lastLog: '任务已完成', progress: 100 }
      if (finalPath) (cb ?? onResultCb)?.(nodeId, finalPath)
      return
    }
    if (task.status === 'cancelled') {
      statusByNode.value[nodeId] = { status: 'error', errorMsg: '已中断' }
      return
    }
    statusByNode.value[nodeId] = { status: 'error', errorMsg: task.error ?? '任务失败' }
  })

  // ── ffmpeg 异步任务（统一任务注册表驱动：进度/终态经 WS，刷新后按 scope 恢复）────────

  /**
   * 当前画布定位（服务端任务记录的 canvas 字段，用于按 scope 恢复）。
   *
   * @returns 画布定位；目标参数不完整（如场景画布未选子场景）时返回 null
   */
  function canvasTarget(): GenTarget | null {
    const t = targetRef.value
    if (t.kind === 'stage') {
      if (!t.stage || !t.label) return null
      return { kind: 'stage', stage: t.stage, label: t.label }
    }
    if (!t.episode || !t.shot) return null
    return { kind: 'scene', episode: t.episode, shot: t.shot }
  }

  /**
   * 判断任务是否属于当前画布 scope（项目 + 画布定位一致）。
   *
   * @param task 任务摘要
   * @returns 是否属于当前画布
   */
  function isCurrentScope(task: { project?: string; canvas?: LlmCanvasTarget }): boolean {
    if (task.project !== project) return false
    const cur = canvasTarget()
    if (!cur) return false
    const c = task.canvas
    if (!c || c.kind !== cur.kind) return false
    if (cur.kind === 'scene') return c.episode === cur.episode && c.shot === cur.shot
    return c.stage === cur.stage && c.label === cur.label
  }

  /**
   * ffmpeg 任务终态收敛（由统一任务广播监听 onTaskUpdate 调用）。
   *
   * @param nodeId 节点 id
   * @param outputPath 产物相对路径（可为空：任务 payload 里的 outputPath 兜底）
   * @param status 终态
   * @param error 错误信息（仅 failed）
   * @param task 任务摘要（可选：用于从 payload.outputPath 兜底产物路径）
   */
  function onFfmpegTaskFinished(
    nodeId: string,
    outputPath: string,
    status: TaskStatus,
    error?: string,
    task?: { payload?: Record<string, unknown> },
  ): void {
    const payloadPath = typeof task?.payload?.outputPath === 'string' ? task.payload.outputPath : ''
    const finalPath = outputPath || payloadPath
    delete taskIdByNode.value[nodeId]
    delete ffmpegOutputByNode[nodeId]
    delete ffmpegResultCbByNode[nodeId]
    if (status === 'completed') {
      statusByNode.value[nodeId] = { status: 'success', lastLog: '任务已完成', progress: 100 }
      if (!finalPath) return
      // 产物存在性核验：避免「订阅时任务已结束」误报成功（产物缺失时给出可重试的错误提示）
      void getCanvasNodeInfo(project, finalPath)
        .then((info) => {
          if (info.exists) {
            onResultCb?.(nodeId, finalPath)
            return
          }
          statusByNode.value[nodeId] = { status: 'error', errorMsg: '任务已结束但未生成产物，请重新执行' }
        })
        .catch((e: unknown) => {
          console.error(
            `[canvas-gen] 产物存在性核验失败（${finalPath}）: ${e instanceof Error ? e.message : String(e)}`,
          )
          onResultCb?.(nodeId, finalPath)
        })
      return
    }
    if (status === 'cancelled') {
      statusByNode.value[nodeId] = { status: 'error', errorMsg: '已中断' }
      return
    }
    statusByNode.value[nodeId] = { status: 'error', errorMsg: error ?? '任务失败' }
  }

  /**
   * 跟踪一个 ffmpeg 异步任务：登记节点映射并订阅 WS（进度/终态）。
   *
   * 进度与终态主要由全局 `onTaskUpdate` 监听消费（task-update 广播）；
   * 此处额外订阅该 taskId 以处理「订阅时任务已结束」（刷新/重连竞态）→ not-found。
   *
   * @param nodeId 节点 id
   * @param taskId 任务 id
   * @param outputPath 产物相对路径（固定 output.{ext}）
   * @param runningLog 运行中展示的阶段文案
   * @param onResult 完成回调（per-call 优先，回落到 options.onResult）
   */
  function trackFfmpegTask(
    nodeId: string,
    taskId: string,
    outputPath: string,
    runningLog: string,
    onResult?: (nodeId: string, outputPath: string) => void,
  ): void {
    taskIdByNode.value[nodeId] = taskId
    ffmpegOutputByNode[nodeId] = outputPath
    ffmpegResultCbByNode[nodeId] = onResult
    statusByNode.value[nodeId] = { status: 'running', lastLog: runningLog, taskId, progress: 0 }
    const off = taskSocket.subscribe(taskId, (event) => {
      if (event.type !== 'not-found') return
      // 订阅时任务已结束（刷新/重连竞态）：仅结束 loading，产物以文件为准
      off()
      onFfmpegTaskFinished(nodeId, outputPath, 'completed')
    })
  }

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
   * 提交成功后把运行中任务持久化（taskId + 产物路径），离开画布/刷新后据此恢复 loading。
   *
   * @param node 生成节点数据（图片、视频或 TTS）
   * @param videoParams 视频生成节点的自包含提交参数（仅 video-generate 需要）
   * @param onResult 任务完成（含失败）时的回调（nodeId, outputPath），供 UI 刷新产物展示；可省略（回落到 options.onResult）
   * @param textPromptOverride 连线文本输入提供的外部提示词（仅图片节点使用）：非空时**优先于**
   *   config.prompt 作为工作流 prompt（image-edit 的 vars.prompt / text-to-image 的 prompt 文件内容）；
   *   未提供（undefined）或空白时沿用 config.prompt
   */
  async function generate(
    node: CanvasNodeData,
    videoParams?: VideoSubmitParams,
    onResult?: (nodeId: string, outputPath: string) => void,
    textPromptOverride?: string,
  ): Promise<void> {
    const nodeId = node.id
    if (statusByNode.value[nodeId]?.status === 'running') return
    /** 结果回调：per-call 优先，回落到 options.onResult */
    const resultCb = onResult ?? onResultCb
    /** 画布定位（随任务持久化：画布加载/切换/刷新后据此恢复节点 Loading） */
    const canvasScope = canvasTarget()

    // ── 视频生成节点：走自包含提交参数 ──
    if (node.prototypeId === 'video-generate') {
      if (!videoParams) {
        statusByNode.value[nodeId] = { status: 'error', errorMsg: '缺少视频提交参数' }
        return
      }
      const impl = String(node.config.workflowImpl ?? '')
      if (!impl) {
        statusByNode.value[nodeId] = { status: 'error', errorMsg: '请先在节点配置中选择工作流实现' }
        return
      }
      statusByNode.value[nodeId] = { status: 'running' }
      try {
        const outputPath = computeOutputPath(node)
        const { taskId } = await runWorkflow({
          project,
          workflowId: 'image-to-video',
          impl,
          params: {
            vars: {},
            outputPath,
            userParams: (node.config.workflowParams as Record<string, WorkflowUserParamValue> | undefined) ?? {},
            video: videoParams,
            nodeId,
            ...(canvasScope ? { canvas: canvasScope } : {}),
          },
        })
        taskIdByNode.value[nodeId] = taskId
        poll(taskId, nodeId, outputPath, resultCb)
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
      if (!impl) {
        statusByNode.value[nodeId] = { status: 'error', errorMsg: '请先在节点配置中选择工作流实现' }
        return
      }
      const outputPath = computeOutputPath(node)
      const userParams = (node.config.workflowParams as Record<string, WorkflowUserParamValue> | undefined) ?? {}
      statusByNode.value[nodeId] = { status: 'running' }
      try {
        const { taskId } = await runWorkflow({
          project,
          workflowId,
          impl,
          params: { vars, outputPath, userParams, nodeId, ...(canvasScope ? { canvas: canvasScope } : {}) },
        })
        taskIdByNode.value[nodeId] = taskId
        poll(taskId, nodeId, outputPath, resultCb)
      } catch (e) {
        statusByNode.value[nodeId] = {
          status: 'error',
          errorMsg: e instanceof Error ? e.message : String(e),
        }
      }
      return
    }

    const config = node.config
    // 连线文本输入（外部提示词）非空时优先于节点配置的 prompt（与生成视频节点同一规则）
    const prompt = textPromptOverride?.trim() ? textPromptOverride : String(config.prompt ?? '')
    const inputPaths = inputPathsRef.value[nodeId] ?? []
    const explicitWorkflow = typeof config.workflowId === 'string' && config.workflowId ? config.workflowId : undefined
    const workflowId = explicitWorkflow ?? (inputPaths.length > 0 ? 'image-edit' : 'text-to-image')
    const impl = String(config.workflowImpl ?? '')
    if (!impl) {
      statusByNode.value[nodeId] = { status: 'error', errorMsg: '请先在节点配置中选择工作流实现' }
      return
    }
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
        params: {
          vars,
          outputPath,
          userParams,
          nodeId,
          ...(canvasScope ? { canvas: canvasScope } : {}),
          ...(config.sizeConfig ? { sizeConfig: config.sizeConfig as WorkflowSizeConfig } : {}),
        },
      })
      taskIdByNode.value[nodeId] = taskId
      poll(taskId, nodeId, outputPath, resultCb)
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
   * 到达终态（completed/failed/cancelled）时删除持久化任务记录。
   *
   * @param taskId 任务 id
   * @param nodeId 节点 id
   * @param outputPath 产物相对路径（服务端实际写入路径）
   * @param onResult 完成（含失败）回调（nodeId, outputPath），可省略
   */
  function poll(
    taskId: string,
    nodeId: string,
    outputPath: string,
    onResult?: (nodeId: string, outputPath: string) => void,
  ): void {
    if (pollTimers[nodeId]) clearInterval(pollTimers[nodeId])
    const tick = async (): Promise<void> => {
      try {
        const task = await getTaskStatus(taskId)
        // 等待期间可能已被中断/重置（定时器被移除）：不再覆盖终态
        if (!pollTimers[nodeId]) return
        const logs = await getTaskLogs(taskId).catch(() => [])
        // 同上：两个 await 之后写状态前都要再校验一次，避免覆盖 reset/interrupt 后的状态
        if (!pollTimers[nodeId]) return
        const lastLog = logs.length > 0 ? String(logs[logs.length - 1].message) : undefined
        // 服务端终态为 completed/failed（TaskStatus = pending | running | completed | failed）
        const done = task.status === 'completed'
        const isError = task.status === 'failed' || task.status === 'error' || task.status === 'cancelled'
        statusByNode.value[nodeId] = {
          status: task.status === 'running' || task.status === 'pending' ? 'running' : done ? 'success' : 'error',
          lastLog,
          taskId,
          errorMsg: task.errorMsg,
        }

        if (done || isError) {
          clearInterval(pollTimers[nodeId])
          delete pollTimers[nodeId]
          delete taskIdByNode.value[nodeId]
          if (done) (onResult ?? onResultCb)?.(nodeId, outputPath)
        }
      } catch {
        // 轮询失败忽略，下轮重试
      }
    }
    void tick()
    pollTimers[nodeId] = setInterval(() => void tick(), POLL_INTERVAL_MS)
  }


  /**
   * 中断生成：统一入口（节点卡片「中断」按钮 / 编辑器「中断」均走这里）。
   *
   * 所有任务类型统一走 `POST /api/tasks/:taskId/cancel`（服务端路由到对应执行器：
   * ffmpeg kill 子进程并删除半截产物、LLM abort 上游、工作流 Bridge 取消/延迟取消标记）；
   * 任务管理器列表同步由服务端广播收敛。
   *
   * **收敛语义**：中断请求受理成功后不停轮询、不预置节点状态——终态（用户中断）
   * 由服务端执行器收敛后经既有机制更新到节点（工作流轮询 SQLite 终态 / ffmpeg
   * task-update 广播），避免「取消实际未生效时节点停留假『已中断』态」；
   * 请求被拒绝（如 404 NOT_CANCELABLE：任务不可中断/已结束）或发送失败时保持
   * running 态并经 `onCancelRejected` 提示用户，任务继续正常执行到终态。
   *
   * @param nodeId 生成节点 id
   */
  async function interrupt(nodeId: string): Promise<void> {
    const status = statusByNode.value[nodeId]
    if (!status || status.status !== 'running') return
    const taskId = taskIdByNode.value[nodeId]
    if (!taskId) {
      // 本地无任务凭据（提交请求尚未返回）：无法向服务端发起中断，保持运行态并告知用户
      onCancelRejectedCb?.(nodeId, '任务尚未取得中断凭据，请稍后重试')
      return
    }
    try {
      await cancelTask(taskId)
    } catch (e) {
      // 中断被服务端拒绝（404 NOT_CANCELABLE 等）或网络失败：保持 running 态，
      // 轮询/广播继续到终态；原因上抛给 UI 层提示（不静默吞掉）
      const ax = e as { response?: { data?: { error?: string } } }
      const msg = ax?.response?.data?.error ?? (e instanceof Error ? e.message : String(e))
      console.error(`[canvas-gen] 中断任务失败（${taskId}）: ${msg}`)
      onCancelRejectedCb?.(nodeId, msg)
    }
  }

  /** 清除节点状态（如失败后重试前；不影响已持久化的运行中记录——真实任务仍在服务端执行） */
  function clearStatus(nodeId: string): void {
    delete statusByNode.value[nodeId]
  }

  // ── LLM 会话状态机（标准 Loading 状态；不含任何持久化记录，恢复由服务端会话列表驱动）────

  /**
   * 进入标准 Loading（AI 文本节点生成开始 / 恢复订阅时调用）。
   *
   * @param nodeId 节点 id
   * @param lastLog 阶段日志（Thinking… / 正在响应…）
   * @param taskId 会话 id（中断凭据；可省略）
   */
  function beginClientRun(nodeId: string, lastLog?: string, taskId?: string): void {
    statusByNode.value[nodeId] = { status: 'running', ...(lastLog ? { lastLog } : {}), ...(taskId ? { taskId } : {}) }
  }

  /**
   * 更新节点阶段日志（仅 running 态生效；thinking→responding 阶段切换时调用）。
   *
   * @param nodeId 节点 id
   * @param log 阶段日志
   */
  function updateClientRun(nodeId: string, log: string): void {
    const s = statusByNode.value[nodeId]
    if (s && s.status === 'running') s.lastLog = log
  }

  /**
   * 结束节点标准 Loading（终态收敛 / not-found / 重连对账时调用；幂等）。
   *
   * @param nodeId 节点 id
   */
  function endClientRun(nodeId: string): void {
    delete statusByNode.value[nodeId]
    clearLlmConvergeTimeout(nodeId)
  }

  /**
   * 置节点失败错误态（AI 文本节点终态 failed：自定义遮罩红字提示）。
   *
   * @param nodeId 节点 id
   * @param errorMsg 错误信息
   */
  function setLlmError(nodeId: string, errorMsg: string): void {
    statusByNode.value[nodeId] = { status: 'error', errorMsg }
  }

  /**
   * 中断 AI 文本节点会话（标准 Loading 遮罩「中断」按钮 / 编辑器中断入口）：
   * taskSocket.cancel（WS 优先 + HTTP 兜底）→ 等待服务端 finished(cancelled) 收敛
   * （后端写部分输出）；3 秒收敛超时兜底——HTTP 兜底已确认但 WS 已断时本地结束
   * Loading（幂等，重连后快照对账）。
   *
   * @param nodeId 节点 id
   */
  function interruptLlm(nodeId: string): void {
    const status = statusByNode.value[nodeId]
    if (!status || status.status !== 'running') return
    const taskId = status.taskId
    if (taskId) taskSocket.cancel(taskId)
    clearLlmConvergeTimeout(nodeId)
    llmConvergeTimers[nodeId] = setTimeout(() => {
      // 收敛超时兜底：WS 断连时本地结束 Loading（服务端仍会完成取消与落盘）
      delete llmConvergeTimers[nodeId]
      endClientRun(nodeId)
    }, LLM_CONVERGE_TIMEOUT_MS)
  }

  /**
   * 清除节点中断收敛超时定时器（终态收敛/重置时调用）。
   *
   * @param nodeId 节点 id
   */
  function clearLlmConvergeTimeout(nodeId: string): void {
    const t = llmConvergeTimers[nodeId]
    if (t) {
      clearTimeout(t)
      delete llmConvergeTimers[nodeId]
    }
  }

  /**
   * 获取视频帧节点：提交服务端 ffmpeg 异步任务（产物为固定 output.png）。
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
    const outputPath = computeOutputPath(node)
    const time = node.config.frameTime
    const hasTime = typeof time === 'number' && Number.isFinite(time)
    const raw = node.config.frameIndex
    const frameIndex = typeof raw === 'number' && Number.isInteger(raw) ? raw : 0
    const log = hasTime ? `正在提取第 ${time} 秒处画面…` : `正在提取第 ${frameIndex} 帧…`
    try {
      const { taskId } = hasTime
        ? await extractVideoFrameAtTime(project, videoPath, time as number, outputPath, taskTarget(nodeId))
        : await extractVideoFrame(project, videoPath, frameIndex, outputPath, taskTarget(nodeId))
      trackFfmpegTask(nodeId, taskId, outputPath, log, onResult)
    } catch (e) {
      statusByNode.value[nodeId] = { status: 'error', errorMsg: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 拼接视频节点：提交服务端 ffmpeg 异步任务（产物为固定 output.mp4）。
   *
   * 编码方式（copy / reencode）与输出尺寸策略随节点 config 提交；
   * 进度与终态经 WS 推送（任务管理器可见、可中断）。
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
    const outputPath = computeOutputPath(node)
    const mode = node.config.mode === 'copy' ? 'copy' : 'reencode'
    const sizeMode =
      node.config.sizeMode === 'custom' || node.config.sizeMode === 'min' ? node.config.sizeMode : 'max'
    const rawWidth = node.config.width
    const rawHeight = node.config.height
    const width = typeof rawWidth === 'number' && Number.isFinite(rawWidth) ? rawWidth : undefined
    const height = typeof rawHeight === 'number' && Number.isFinite(rawHeight) ? rawHeight : undefined
    // 自然过渡仅重编码生效：copy 模式不提交（服务端忽略，避免白名单误判）
    const transition = mode === 'reencode' && node.config.transition === true ? true : undefined
    const rawCrossfade = node.config.crossfadeDuration
    const crossfadeDuration =
      transition && typeof rawCrossfade === 'number' && Number.isFinite(rawCrossfade) ? rawCrossfade : undefined
    const params: ConcatVideoParams = {
      mode,
      ...(mode === 'reencode' ? { sizeMode } : {}),
      ...(transition ? { transition, crossfadeDuration } : {}),
      ...(mode === 'reencode' && sizeMode === 'custom' && width && height ? { width, height } : {}),
    }
    try {
      const { taskId } = await requestConcatVideo(project, videoPaths, outputPath, params, taskTarget(nodeId))
      trackFfmpegTask(nodeId, taskId, outputPath, `正在${mode === 'copy' ? '无损' : '重编码'}拼接 ${videoPaths.length} 段视频…`, onResult)
    } catch (e) {
      statusByNode.value[nodeId] = { status: 'error', errorMsg: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 裁剪视频节点：提交服务端 ffmpeg 异步任务（产物固定覆盖 output.mp4）。
   *
   * 重复裁剪时旧产物由服务端归档进历史目录；进度与终态经 WS 推送。
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
    const outputPath = computeOutputPath(node)
    try {
      const startMode = node.config.startMode === 'frame' ? 'frame' : 'time'
      const rawStart = node.config.startValue
      const startValue = typeof rawStart === 'number' && Number.isFinite(rawStart) ? rawStart : 0
      const rawDuration = node.config.duration
      const duration = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : 0
      const params =
        startMode === 'frame'
          ? { startFrame: Math.trunc(startValue), duration }
          : { startTime: startValue, duration }
      const { taskId } = await requestTrimVideo(project, videoPath, params, outputPath, taskTarget(nodeId))
      const log =
        startMode === 'frame'
          ? `正在从第 ${params.startFrame} 帧裁剪 ${duration}s…`
          : `正在从 ${startValue}s 处裁剪 ${duration}s…`
      trackFfmpegTask(nodeId, taskId, outputPath, log, onResult)
    } catch (e) {
      statusByNode.value[nodeId] = { status: 'error', errorMsg: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 裁剪音频节点：提交服务端 ffmpeg 异步任务。
   *
   * 产物固定覆盖 output.{ext}——扩展名按节点输出格式解析（audioTrimOutputExt：
   * 显式 wav/flac/mp3 取对应扩展名；「原格式」跟随输入音频扩展名），随裁剪结果
   * 由服务端落盘；实际扩展名由 AssetCanvas handleNodeResult 静默写回 config.outputExt 镜像。
   *
   * @param node 裁剪音频节点数据
   * @param audioPath 输入音频相对路径（来自连线输入）
   * @param onResult 完成（含失败）回调（nodeId, outputPath），可省略
   */
  async function trimAudio(
    node: CanvasNodeData,
    audioPath: string,
    onResult?: (nodeId: string, outputPath: string) => void,
  ): Promise<void> {
    const nodeId = node.id
    if (statusByNode.value[nodeId]?.status === 'running') return
    // 输出扩展名按节点输出格式解析（「原格式」需输入音频路径才能定扩展名）
    const outputPath = canvasNodeOutputPath(getScope(), node.id, audioTrimOutputExt(node.config, audioPath))
    try {
      const rawStart = node.config.startValue
      const startValue = typeof rawStart === 'number' && Number.isFinite(rawStart) ? rawStart : 0
      const rawDuration = node.config.duration
      const duration = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : 0
      const { taskId } = await requestTrimAudio(
        project,
        audioPath,
        {
          startTime: startValue,
          duration,
          format: audioTrimFormatOf(node.config),
          mp3Bitrate: audioTrimBitrateOf(node.config),
        },
        outputPath,
        taskTarget(nodeId),
      )
      trackFfmpegTask(nodeId, taskId, outputPath, `正在从 ${startValue}s 处裁剪 ${duration}s…`, onResult)
    } catch (e) {
      statusByNode.value[nodeId] = { status: 'error', errorMsg: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 构造任务画布定位（提交给服务端，供任务管理器展示与刷新后按 scope 恢复）。
   *
   * @param nodeId 发起节点 id
   * @returns 任务提交目标
   */
  function taskTarget(nodeId: string): CanvasTaskTarget {
    const c = canvasTarget()
    return { nodeId, ...(c ? { canvas: c } : {}) }
  }


  /**
   * 当前画布上仍在运行的任务（画布恢复 Loading 用）。
   */
  interface RestoreEntry {
    /** 任务 id */
    taskId: string
    /** 发起节点 id */
    nodeId: string
    /** 任务类型（决定跟踪方式：ffmpeg 走 WS 广播，工作流走 SQLite 轮询） */
    kind: 'ffmpeg' | 'workflow'
    /** 产物相对路径（终态刷新产物展示用） */
    outputPath: string
  }

  /**
   * 读取统一任务注册表的活跃任务快照。
   *
   * WS 全量快照尚未到达（连接建立窗口 / 断线重连中）时走 HTTP 兜底 `GET /api/tasks`：
   * 否则画布加载早于 WS 快照会漏恢复运行中任务（Loading 被误清除）。
   *
   * @returns 活跃任务摘要列表
   */
  async function activeRegistryTasks(): Promise<TaskInfo[]> {
    if (taskSocket.snapshotReady.value) return taskSocket.tasks.value
    try {
      return await listActiveTasks(project)
    } catch (e) {
      // HTTP 兜底失败：回退 WS 已收到的（可能为空）列表并打日志，不阻断画布加载
      console.error(
        `[canvas-gen] 活跃任务列表获取失败（回退 WS 快照）: ${e instanceof Error ? e.message : String(e)}`,
      )
      return taskSocket.tasks.value
    }
  }

  /**
   * 收集当前画布上仍在运行的任务（restore 的数据源）。
   *
   * 两路合并（按 taskId 去重）：
   * 1. **统一任务注册表**（WS 快照 / HTTP 兜底）：ffmpeg 与工作流任务的运行态；
   * 2. **SQLite 工作流任务**（pending / running）：工作流任务的持久化权威。注册表只在
   *    引擎开始执行时登记，本地排队窗口（引擎 2s tick）与服务重启期间注册表为空，
   *    仅凭注册表会漏恢复 → 补查 SQLite，保证「任务没跑完则节点保持加载中」。
   *
   * 统一过滤：项目一致 + 画布 scope 一致 + 节点仍在当前画布上（已删除节点不恢复）。
   *
   * @param knownNodeIds 当前画布上的节点 id 集合（过滤已删除节点的任务；可省略）
   * @returns 运行中任务条目
   */
  async function collectRunningTasks(knownNodeIds?: Set<string>): Promise<RestoreEntry[]> {
    const entries = new Map<string, RestoreEntry>()
    for (const task of await activeRegistryTasks()) {
      if (task.type !== 'ffmpeg' && task.type !== 'workflow') continue
      if (!task.nodeId) continue
      if (task.status !== 'running' && task.status !== 'pending') continue
      if (!isCurrentScope(task)) continue
      if (knownNodeIds && !knownNodeIds.has(task.nodeId)) continue
      entries.set(task.id, {
        taskId: task.id,
        nodeId: task.nodeId,
        kind: task.type,
        outputPath: typeof task.payload?.outputPath === 'string' ? task.payload.outputPath : '',
      })
    }
    for (const status of ['running', 'pending'] as const) {
      let tasks: TaskResponse[]
      try {
        tasks = await listWorkflowTasks(project, status)
      } catch (e) {
        // 补查失败不影响注册表结果（仅可能漏排队窗口内的任务），打日志继续
        console.error(
          `[canvas-gen] 工作流任务补查失败（${status}）: ${e instanceof Error ? e.message : String(e)}`,
        )
        continue
      }
      for (const task of tasks) {
        const nodeId = task.params?.nodeId
        if (!nodeId || entries.has(task.taskId)) continue
        if (!isCurrentScope({ project, canvas: task.params?.canvas })) continue
        if (knownNodeIds && !knownNodeIds.has(nodeId)) continue
        entries.set(task.taskId, {
          taskId: task.taskId,
          nodeId,
          kind: 'workflow',
          outputPath: task.params?.outputPath ?? '',
        })
      }
    }
    return [...entries.values()]
  }

  /**
   * 恢复当前画布上未结束任务的 Loading 展示（画布加载 / 切换目标回到本画布时调用）。
   *
   * 任务未到终态前节点持续保持加载中（工作流任务续跑本地轮询、ffmpeg 任务重订阅 WS 广播），
   * 终态收敛时刷新产物展示；节点已在本会话跟踪中（本地提交后未离开画布）不重复接管。
   *
   * @param knownNodeIds 当前画布上的节点 id 集合（用于过滤已删除节点的任务）
   */
  async function restore(knownNodeIds?: Set<string>): Promise<void> {
    for (const entry of await collectRunningTasks(knownNodeIds)) {
      if (statusByNode.value[entry.nodeId]?.status === 'running') continue
      const { nodeId, taskId, outputPath } = entry
      taskIdByNode.value[nodeId] = taskId
      statusByNode.value[nodeId] = { status: 'running', lastLog: '任务进行中…', taskId }
      if (entry.kind === 'workflow') {
        // 工作流任务：续跑本地轮询（SQLite 为权威，含阶段日志与终态）
        poll(taskId, nodeId, outputPath)
        continue
      }
      // ffmpeg 任务：进度/终态由 WS 广播驱动；重订阅以处理「订阅时任务已结束」竞态
      const off = taskSocket.subscribe(taskId, (event) => {
        if (event.type !== 'not-found') return
        off()
        onFfmpegTaskFinished(nodeId, outputPath, 'completed')
      })
    }
  }

  /**
   * 重置全部生成状态与轮询（切换画布目标/卸载组件时调用）：
   * 仅清内存展示态与定时器——运行中任务在服务端继续执行（统一任务注册表 + 工作流
   * SQLite 记录是运行态事实源），重新进入本画布时由 restore() 按 scope 恢复 loading
   * 展示与跟踪（任务未结束则一直保持加载中）。
   */
  function reset(): void {
    for (const id of Object.keys(pollTimers)) {
      clearInterval(pollTimers[id])
      delete pollTimers[id]
    }
    for (const id of Object.keys(llmConvergeTimers)) {
      clearTimeout(llmConvergeTimers[id])
      delete llmConvergeTimers[id]
    }
    for (const id of Object.keys(ffmpegOutputByNode)) delete ffmpegOutputByNode[id]
    for (const id of Object.keys(ffmpegResultCbByNode)) delete ffmpegResultCbByNode[id]
    statusByNode.value = {}
    inputPathsRef.value = {}
    taskIdByNode.value = {}
  }

  /** 释放资源（组件卸载）：退订统一任务广播监听（定时器由 reset 清理） */
  function dispose(): void {
    reset()
    offTaskUpdate()
  }

  /**
   * 切换生成目标（如切换分镜/场景）并重置全部生成状态，随后恢复新画布的运行中任务。
   *
   * @param newTarget 新生成目标
   * @param knownNodeIds 新画布上的节点 id 集合（恢复过滤用，可省略）
   */
  async function switchTarget(newTarget: GenTarget, knownNodeIds?: Set<string>): Promise<void> {
    targetRef.value = { ...newTarget }
    reset()
    await restore(knownNodeIds)
  }

  return { statusByNode, setInputPaths, generate, extractFrame, concatVideo, trimVideo, trimAudio, interrupt, clearStatus, computeOutputPath, getScope, reset, dispose, restore, switchTarget, beginClientRun, updateClientRun, endClientRun, setLlmError, interruptLlm }
}
