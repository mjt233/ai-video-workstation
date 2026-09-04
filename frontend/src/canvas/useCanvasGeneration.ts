import { ref } from 'vue'
import { writeFs } from '../api/client'
import { runWorkflow, getTaskStatus, getTaskLogs, cancelWorkflow, type WorkflowSizeConfig, type WorkflowUserParamValue } from '../api/workflow'
import {
  extractVideoFrame,
  extractVideoFrameAtTime,
  concatVideo as requestConcatVideo,
  trimVideo as requestTrimVideo,
  trimAudio as requestTrimAudio,
  getCanvasNodeInfo,
} from './api'
import type { VideoSubmitParams } from './videoSubmit'
import type { CanvasNodeData, CanvasKind } from './types'
import { canvasNodeOutputPath, sceneCanvasRelPath, stageCanvasRelPath, type CanvasScope } from './paths'
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

/**
 * 持久化的运行中任务记录（localStorage，按 项目 + 画布定义文件路径 分键）。
 *
 * 节点进入 loading 后离开资产画布 / 刷新页面 / 切换画布再回来，任务未完成时据此
 * 恢复 loading 展示并继续跟踪（workflow 任务恢复轮询、ffmpeg 任务按产物 mtime 探测完成）。
 * 任务到达终态（成功/失败/中断）时删除记录。
 */
export interface PersistedNodeTask {
  /**
   * 任务类型：
   * - workflow：服务端工作流队列任务（有 taskId，可查状态、可中断）；
   * - ffmpeg：本地同步 ffmpeg 路由任务（无 taskId，按产物 mtime 变化探测完成）。
   */
  kind: 'workflow' | 'ffmpeg'
  /** 产物相对路径（assert/ 下，固定文件名 output.{ext}） */
  outputPath: string
  /** 发起时间（毫秒，客户端时钟；ffmpeg 探测超时用） */
  startedAt: number
  /** workflow 任务 id（kind=workflow 时必有） */
  taskId?: string
  /** ffmpeg 任务提交前产物是否存在（服务端基线，完成判定用，避免客户端/服务端时钟偏差） */
  baselineExists?: boolean
  /** ffmpeg 任务提交前产物 mtime（服务端基线；无基线时用 startedAt 判定） */
  baselineMtime?: number | null
}

/** useCanvasGeneration 选项 */
export interface UseCanvasGenerationOptions {
  /**
   * 任务完成（含失败后恢复完成的场景）时的默认回调（nodeId, outputPath）：
   * 由 AssetCanvas 注入，用于刷新节点产物展示（固定路径 + mtime）。
   * 生成调用传入的 per-call 回调优先于本回调。
   */
  onResult?: (nodeId: string, outputPath: string) => void
}

/** localStorage 键前缀（任务记录按 项目 + 画布定义文件路径 分键隔离） */
const TASK_STORAGE_PREFIX = 'dsh.asset-canvas.tasks.'
/** ffmpeg 同步任务完成探测超时（毫秒）：超过后判定任务中断，避免无限 loading */
const FFMPEG_PROBE_TIMEOUT_MS = 10 * 60 * 1000
/** 轮询/探测间隔（毫秒） */
const POLL_INTERVAL_MS = 2000

/**
 * 生成节点资产生成组合式：跑工作流、轮询状态（纯体验层）、通知结果、中断，
 * 并把运行中任务持久化到 localStorage（离开画布/刷新后恢复 loading 展示）。
 *
 * 产物路径为固定文件名 output.{ext}（"当前结果"为文件系统事实）：本组合式只管提交与状态展示，
 * **不再回写 config.current/history**（结果落盘由服务端引擎/路由完成，页面离开/关闭后结果依然存在，
 * 重新进入画布时按固定路径直接可见；历史由服务端 history API 管理）。
 *
 * @param project 项目名
 * @param target 画布目标（决定产物目录、prompt 文件位置与任务持久化分键）
 * @param options 选项（默认结果回调等）
 */
export function useCanvasGeneration(project: string, target: GenTarget, options: UseCanvasGenerationOptions = {}) {
  /** 当前生成目标（切换分镜/场景时通过 switchTarget 更新） */
  const targetRef = ref<GenTarget>({ ...target })
  /** nodeId → 生成状态（仅页面展示） */
  const statusByNode = ref<Record<string, GenerateStatus>>({})
  /** nodeId → 工作流轮询句柄 */
  const pollTimers: Record<string, ReturnType<typeof setInterval>> = {}
  /** nodeId → ffmpeg 产物探测句柄（恢复后的同步任务用） */
  const outputProbeTimers: Record<string, ReturnType<typeof setInterval>> = {}
  /** 已请求中断的节点（ffmpeg 同步任务无法取消服务端执行，仅阻止其回写状态） */
  const interruptedNodes: Record<string, true> = {}

  /** nodeId → 输入资产路径（由调用方通过 setInputPaths 注入） */
  const inputPathsRef = ref<Record<string, string[]>>({})
  /** nodeId → 当前 taskId（用于中断） */
  const taskIdByNode = ref<Record<string, string>>({})

  /** 默认结果回调（恢复任务完成时刷新产物展示用） */
  const onResultCb = options.onResult

  // ── 运行中任务持久化（localStorage，离开画布/刷新后恢复 loading 展示）────────

  /**
   * 当前画布的持久化分键：{前缀}{项目}:{画布定义文件相对路径}。
   *
   * @returns 存储键；目标参数不完整（如场景画布未选子场景）时返回 null（不持久化）
   */
  function taskStorageKey(): string | null {
    const t = targetRef.value
    if (t.kind === 'stage') {
      if (!t.stage || !t.label) return null
      return `${TASK_STORAGE_PREFIX}${project}:${stageCanvasRelPath(t.stage, t.label)}`
    }
    if (!t.episode || !t.shot) return null
    return `${TASK_STORAGE_PREFIX}${project}:${sceneCanvasRelPath(t.episode, t.shot)}`
  }

  /**
   * 读取当前画布持久化的运行中任务记录。
   *
   * @returns nodeId → 任务记录（localStorage 不可用/数据损坏时返回空对象）
   */
  function readPersistedTasks(): Record<string, PersistedNodeTask> {
    const key = taskStorageKey()
    if (!key) return {}
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const out: Record<string, PersistedNodeTask> = {}
      for (const [nodeId, rec] of Object.entries(parsed as Record<string, PersistedNodeTask>)) {
        if (
          rec &&
          (rec.kind === 'workflow' || rec.kind === 'ffmpeg') &&
          typeof rec.outputPath === 'string' &&
          typeof rec.startedAt === 'number'
        ) {
          out[nodeId] = rec
        }
      }
      return out
    } catch {
      return {}
    }
  }

  /**
   * 写入当前画布的任务记录（空对象时删除存储键）。
   *
   * @param records nodeId → 任务记录
   */
  function writePersistedTasks(records: Record<string, PersistedNodeTask>): void {
    const key = taskStorageKey()
    if (!key) return
    try {
      if (Object.keys(records).length === 0) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify(records))
    } catch {
      // localStorage 不可用（隐私模式等）时静默降级为仅会话内展示
    }
  }

  /**
   * 持久化某节点进入 loading：合并写入任务记录（覆盖同节点旧记录）。
   *
   * @param nodeId 节点 id
   * @param rec 任务记录
   */
  function persistRunning(nodeId: string, rec: PersistedNodeTask): void {
    const records = readPersistedTasks()
    records[nodeId] = rec
    writePersistedTasks(records)
  }

  /**
   * 删除某节点的任务记录（任务到达终态/中断时调用）。
   *
   * @param nodeId 节点 id
   */
  function clearPersistedTask(nodeId: string): void {
    const records = readPersistedTasks()
    if (nodeId in records) {
      delete records[nodeId]
      writePersistedTasks(records)
    }
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
   */
  async function generate(
    node: CanvasNodeData,
    videoParams?: VideoSubmitParams,
    onResult?: (nodeId: string, outputPath: string) => void,
  ): Promise<void> {
    const nodeId = node.id
    if (statusByNode.value[nodeId]?.status === 'running') return
    /** 结果回调：per-call 优先，回落到 options.onResult */
    const resultCb = onResult ?? onResultCb

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
          },
        })
        taskIdByNode.value[nodeId] = taskId
        persistRunning(nodeId, { kind: 'workflow', taskId, outputPath, startedAt: Date.now() })
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
          params: { vars, outputPath, userParams },
        })
        taskIdByNode.value[nodeId] = taskId
        persistRunning(nodeId, { kind: 'workflow', taskId, outputPath, startedAt: Date.now() })
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
    const prompt = String(config.prompt ?? '')
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
          ...(config.sizeConfig ? { sizeConfig: config.sizeConfig as WorkflowSizeConfig } : {}),
        },
      })
      taskIdByNode.value[nodeId] = taskId
      persistRunning(nodeId, { kind: 'workflow', taskId, outputPath, startedAt: Date.now() })
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
          clearPersistedTask(nodeId)
          if (done) (onResult ?? onResultCb)?.(nodeId, outputPath)
        }
      } catch {
        // 轮询失败忽略，下轮重试
      }
    }
    void tick()
    pollTimers[nodeId] = setInterval(() => void tick(), POLL_INTERVAL_MS)
  }

  /** 停止某节点的全部定时器（工作流轮询 + ffmpeg 产物探测） */
  function stopNodeTimers(nodeId: string): void {
    if (pollTimers[nodeId]) {
      clearInterval(pollTimers[nodeId])
      delete pollTimers[nodeId]
    }
    if (outputProbeTimers[nodeId]) {
      clearInterval(outputProbeTimers[nodeId])
      delete outputProbeTimers[nodeId]
    }
  }

  /**
   * ffmpeg 同步任务完成探测：轮询产物 node-info，产物 mtime 变化（相对提交前基线）
   * 即判定服务端写盘完成（刷新后浏览器端无 taskId 可查，靠文件系统事实收敛）。
   * 超过 FFMPEG_PROBE_TIMEOUT_MS 仍未变化则判定任务中断，避免无限 loading。
   *
   * @param nodeId 节点 id
   * @param rec 持久化任务记录（含提交前产物基线）
   */
  function startOutputProbe(nodeId: string, rec: PersistedNodeTask): void {
    if (outputProbeTimers[nodeId]) clearInterval(outputProbeTimers[nodeId])
    const tick = async (): Promise<void> => {
      if (statusByNode.value[nodeId]?.status !== 'running') {
        stopNodeTimers(nodeId)
        return
      }
      try {
        const info = await getCanvasNodeInfo(project, rec.outputPath)
        // 等待期间可能已被中断/重置（定时器被移除）：不再覆盖终态
        if (!outputProbeTimers[nodeId]) return
        if (isOutputCompleted(info, rec)) {
          clearPersistedTask(nodeId)
          stopNodeTimers(nodeId)
          statusByNode.value[nodeId] = { status: 'success', lastLog: '任务已完成' }
          onResultCb?.(nodeId, rec.outputPath)
          return
        }
        if (Date.now() - rec.startedAt > FFMPEG_PROBE_TIMEOUT_MS) {
          clearPersistedTask(nodeId)
          stopNodeTimers(nodeId)
          statusByNode.value[nodeId] = { status: 'error', errorMsg: '任务等待超时，请重新执行' }
        }
      } catch {
        // 查询失败忽略，下轮重试
      }
    }
    void tick()
    outputProbeTimers[nodeId] = setInterval(() => void tick(), POLL_INTERVAL_MS)
  }

  /**
   * 判定 ffmpeg 任务产物是否已由服务端写盘完成（"文件系统即数据库"）。
   * 有提交前基线（服务端 mtime）时比较 mtime 变化；无基线时回落到客户端 startedAt。
   *
   * @param info 当前产物信息（服务端 node-info）
   * @param rec 持久化任务记录
   * @returns 产物是否已更新（任务完成）
   */
  function isOutputCompleted(
    info: { exists: boolean; mtime: number | null },
    rec: PersistedNodeTask,
  ): boolean {
    if (!info.exists || typeof info.mtime !== 'number') return false
    if (typeof rec.baselineExists === 'boolean') {
      if (!rec.baselineExists) return true
      return typeof rec.baselineMtime === 'number' && info.mtime > rec.baselineMtime
    }
    return info.mtime > rec.startedAt
  }

  /**
   * 中断生成：统一入口（节点卡片「中断」按钮 / 编辑器「中断」均走这里）。
   *
   * - workflow 任务：调用后端 cancel 端点 + 停轮询 + 状态置已中断 + 删除持久化记录；
   * - ffmpeg 同步任务：无服务端取消接口，停止本端探测 + 状态置已中断 + 删除持久化记录
   *   （服务端可能仍会完成写盘；同会话内未返回的请求结果会以真实成功态收敛）。
   *
   * @param nodeId 生成节点 id
   */
  async function interrupt(nodeId: string): Promise<void> {
    const status = statusByNode.value[nodeId]
    if (!status || status.status !== 'running') return
    const taskId = taskIdByNode.value[nodeId]
    interruptedNodes[nodeId] = true
    stopNodeTimers(nodeId)
    clearPersistedTask(nodeId)
    statusByNode.value[nodeId] = { status: 'error', errorMsg: '已中断', taskId }
    delete taskIdByNode.value[nodeId]
    if (!taskId) return
    try {
      await cancelWorkflow(taskId)
    } catch {
      // cancel 失败不阻断状态展示（后端任务可能已结束）
    }
  }

  /** 清除节点状态（如失败后重试前；不影响已持久化的运行中记录——真实任务仍在服务端执行） */
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
    const outputPath = computeOutputPath(node)
    await startFfmpegTask(nodeId, outputPath)
    const resultCb = onResult ?? onResultCb
    try {
      const time = node.config.frameTime
      const hasTime = typeof time === 'number' && Number.isFinite(time)
      const raw = node.config.frameIndex
      const frameIndex = typeof raw === 'number' && Number.isInteger(raw) ? raw : 0
      const res = hasTime
        ? await extractVideoFrameAtTime(project, videoPath, time as number, outputPath)
        : await extractVideoFrame(project, videoPath, frameIndex, outputPath)
      finishFfmpegTask(nodeId)
      statusByNode.value[nodeId] = {
        status: 'success',
        lastLog: hasTime ? `已提取第 ${time} 秒处画面` : `已提取第 ${frameIndex} 帧`,
      }
      resultCb?.(nodeId, res.path)
    } catch (e) {
      failFfmpegTask(nodeId, e)
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
    const outputPath = computeOutputPath(node)
    await startFfmpegTask(nodeId, outputPath)
    const resultCb = onResult ?? onResultCb
    try {
      const res = await requestConcatVideo(project, videoPaths, outputPath)
      finishFfmpegTask(nodeId)
      statusByNode.value[nodeId] = {
        status: 'success',
        lastLog: `已拼接 ${videoPaths.length} 段视频`,
      }
      resultCb?.(nodeId, res.path)
    } catch (e) {
      failFfmpegTask(nodeId, e)
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
    const outputPath = computeOutputPath(node)
    await startFfmpegTask(nodeId, outputPath)
    const resultCb = onResult ?? onResultCb
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
      const res = await requestTrimVideo(project, videoPath, params, outputPath)
      finishFfmpegTask(nodeId)
      statusByNode.value[nodeId] = {
        status: 'success',
        lastLog: startMode === 'frame'
          ? `已从第 ${params.startFrame} 帧裁剪 ${duration}s`
          : `已从 ${startValue}s 处裁剪 ${duration}s`,
      }
      resultCb?.(nodeId, res.path)
    } catch (e) {
      failFfmpegTask(nodeId, e)
    }
  }

  /**
   * 裁剪音频节点：调用服务端 ffmpeg 接口，成功后通知结果（产物固定覆盖 output.flac）。
   *
   * 同步路由（ffmpeg 阻塞等待），无轮询；重复裁剪时旧产物由服务端归档进历史目录。
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
    statusByNode.value[nodeId] = { status: 'running' }
    const outputPath = computeOutputPath(node)
    await startFfmpegTask(nodeId, outputPath)
    const resultCb = onResult ?? onResultCb
    try {
      const rawStart = node.config.startValue
      const startValue = typeof rawStart === 'number' && Number.isFinite(rawStart) ? rawStart : 0
      const rawDuration = node.config.duration
      const duration = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : 0
      const res = await requestTrimAudio(project, audioPath, { startTime: startValue, duration }, outputPath)
      finishFfmpegTask(nodeId)
      statusByNode.value[nodeId] = {
        status: 'success',
        lastLog: `已从 ${startValue}s 处裁剪 ${duration}s`,
      }
      resultCb?.(nodeId, res.path)
    } catch (e) {
      failFfmpegTask(nodeId, e)
    }
  }

  /**
   * ffmpeg 同步任务开始：读取产物基线（服务端 mtime，完成判定用）并持久化 running 记录。
   *
   * @param nodeId 节点 id
   * @param outputPath 产物相对路径
   */
  async function startFfmpegTask(nodeId: string, outputPath: string): Promise<void> {
    const startedAt = Date.now()
    const baseline = await getCanvasNodeInfo(project, outputPath).catch(
      () => ({ exists: false, mtime: null, size: null }) as { exists: boolean; mtime: number | null; size: number | null },
    )
    persistRunning(nodeId, {
      kind: 'ffmpeg',
      outputPath,
      startedAt,
      baselineExists: baseline.exists,
      baselineMtime: baseline.mtime,
    })
  }

  /**
   * ffmpeg 同步任务成功收敛：清除中断标记与持久化记录（状态由调用方写入 success）。
   *
   * @param nodeId 节点 id
   */
  function finishFfmpegTask(nodeId: string): void {
    delete interruptedNodes[nodeId]
    clearPersistedTask(nodeId)
  }

  /**
   * ffmpeg 同步任务失败收敛：清除中断标记与持久化记录；
   * 已请求中断的节点保持「已中断」错误态（服务端无取消接口，请求错误信息不覆盖）。
   *
   * @param nodeId 节点 id
   * @param e 请求错误
   */
  function failFfmpegTask(nodeId: string, e: unknown): void {
    const interrupted = !!interruptedNodes[nodeId]
    delete interruptedNodes[nodeId]
    clearPersistedTask(nodeId)
    if (interrupted) return
    statusByNode.value[nodeId] = {
      status: 'error',
      errorMsg: e instanceof Error ? e.message : String(e),
    }
  }

  /**
   * 恢复持久化的运行中任务（画布加载 / 切换目标回到本画布时调用）：
   * - workflow 任务：置 running 并恢复轮询（首轮立即查询，已终态的直接收敛并刷新产物）；
   * - ffmpeg 任务：置 running 并恢复产物 mtime 探测（服务端写盘完成即收敛成功）。
   */
  async function restore(): Promise<void> {
    const records = readPersistedTasks()
    for (const [nodeId, rec] of Object.entries(records)) {
      if (statusByNode.value[nodeId]?.status === 'running') continue
      if (rec.kind === 'workflow' && rec.taskId) {
        statusByNode.value[nodeId] = { status: 'running', taskId: rec.taskId }
        taskIdByNode.value[nodeId] = rec.taskId
        poll(rec.taskId, nodeId, rec.outputPath)
      } else {
        statusByNode.value[nodeId] = { status: 'running' }
        startOutputProbe(nodeId, rec)
      }
    }
  }

  /**
   * 重置全部生成状态与轮询（切换画布目标/卸载组件时调用）：
   * 仅清内存展示态与定时器，**不清 localStorage 记录**——运行中任务在服务端继续执行，
   * 重新进入本画布时由 restore() 恢复 loading 展示与跟踪。
   */
  function reset(): void {
    for (const id of Object.keys(pollTimers)) {
      clearInterval(pollTimers[id])
      delete pollTimers[id]
    }
    for (const id of Object.keys(outputProbeTimers)) {
      clearInterval(outputProbeTimers[id])
      delete outputProbeTimers[id]
    }
    statusByNode.value = {}
    inputPathsRef.value = {}
    taskIdByNode.value = {}
    for (const id of Object.keys(interruptedNodes)) delete interruptedNodes[id]
  }

  /**
   * 切换生成目标（如切换分镜/场景）并重置全部生成状态，随后恢复新画布的运行中任务。
   *
   * @param newTarget 新生成目标
   */
  async function switchTarget(newTarget: GenTarget): Promise<void> {
    targetRef.value = { ...newTarget }
    reset()
    await restore()
  }

  return { statusByNode, setInputPaths, generate, extractFrame, concatVideo, trimVideo, trimAudio, interrupt, clearStatus, computeOutputPath, getScope, reset, restore, switchTarget }
}