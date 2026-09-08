/**
 * LLM 会话事件消费器（纯函数）：连接态（AI 文本节点）与恢复态（AssetCanvas）
 * 共用同一套事件应用逻辑，双路径行为严格一致、可独立单测。
 *
 * 设计约定（v3.2）：
 * - thinking 增量**只累计到内存状态**（thinking 字段，供内部展示），
 *   **绝不写入 config.output**——config.output 仅保存最终正文；
 * - text 增量累计到 `text`（config.output 镜像），消费方负责节流提交
 *   （纯内存显示 viewOnlyUpdate，不写盘；终态由服务端一次性落盘）；
 * - finished / not-found 为终态：消费方各自收敛（连接态经 stream-state
 *   通知父级 adopt；恢复态直接 adoptExternalChange）。
 */

import type { CanvasTarget } from './api'
import type { LlmCanvasTarget, LlmFinishedInfo, LlmTaskEvent } from './llmSocket'

/** 流式展示状态（事件应用器的输出） */
export interface LlmStreamState {
  /** 是否仍在运行（false = 已终态：finished/not-found） */
  active: boolean
  /** 当前阶段（thinking → responding） */
  phase: 'thinking' | 'responding'
  /** 正文累计（config.output 内存镜像） */
  text: string
  /** 思考内容累计（**仅内部展示，不写入 config.output**） */
  thinking: string
  /** 警告列表（媒体输入被忽略等） */
  warnings: string[]
  /** 错误信息（failed 终态） */
  errorMsg: string
  /** 是否已收到终态事件 */
  finished: boolean
  /** 终态状态（finished 事件携带；not-found 视为 cancelled 语义的静默结束） */
  finishStatus?: 'completed' | 'failed' | 'cancelled'
  /** 终态信息（finished 载荷；含后端已落盘的 patch/rev，终态视图同步用） */
  finishInfo?: LlmFinishedInfo
}

/**
 * 创建初始流式展示状态。
 *
 * @returns 初始状态（thinking 阶段、空累计）
 */
export function createLlmStreamState(): LlmStreamState {
  return {
    active: true,
    phase: 'thinking',
    text: '',
    thinking: '',
    warnings: [],
    errorMsg: '',
    finished: false,
  }
}

/**
 * 应用一条会话事件到状态（纯函数：返回新状态，不修改入参）。
 *
 * - snapshot：用服务端累计进度整体替换（恢复态补齐显示）；
 * - thinking / text：增量累计 + 阶段切换；
 * - warning：追加警告；
 * - finished：置终态（failure 时错误信息附到 errorMsg）；
 * - not-found：置终态（静默：结果已在文件，仅结束 Loading）。
 *
 * @param state 当前状态
 * @param event 会话事件
 * @returns 应用后的新状态
 */
export function applyLlmEvent(state: LlmStreamState, event: LlmTaskEvent): LlmStreamState {
  const next: LlmStreamState = { ...state }
  switch (event.type) {
    case 'snapshot': {
      const s = event.session
      next.active = s.status === 'running'
      next.phase = s.phase === 'responding' ? 'responding' : 'thinking'
      next.text = s.text
      next.thinking = s.thinking
      next.warnings = [...s.warnings]
      next.errorMsg = s.error ?? ''
      break
    }
    case 'thinking':
      next.phase = 'thinking'
      next.thinking += event.delta
      break
    case 'text':
      next.phase = 'responding'
      next.text += event.delta
      break
    case 'warning':
      next.warnings.push(event.message)
      break
    case 'finished': {
      next.active = false
      next.finished = true
      next.finishStatus = event.info.status
      next.finishInfo = event.info
      if (event.info.status === 'failed' && event.info.error) next.errorMsg = event.info.error
      break
    }
    case 'not-found': {
      next.active = false
      next.finished = true
      // 结果已在文件：静默结束（与 cancelled 同语义，不置错误）
      next.finishStatus = 'cancelled'
      break
    }
  }
  return next
}

/** 节流提交器 */
export interface ThrottledCommit {
  /**
   * 提交当前值（超过间隔立即提交，否则合并到定时器）。
   *
   * @param value 当前累计值（消费方视场景取 state.text）
   */
  push(value: string): void
  /** 立即提交待定值并清除定时器（终态/卸载前调用） */
  flush(): void
}

/**
 * 判断会话画布 scope 是否与当前画布一致（项目由调用方另行比对，此处仅 scope 双属性过滤）。
 *
 * @param a 会话画布定位（服务端广播载荷）
 * @param b 当前画布目标
 * @returns 是否同一张画布
 */
export function sameCanvasTarget(a: LlmCanvasTarget, b: CanvasTarget): boolean {
  if (a.kind !== b.kind) return false
  if (b.kind === 'scene') return a.episode === b.episode && a.shot === b.shot
  return a.stage === b.stage && a.label === b.label
}

/** 全局终态采纳构造结果：节点 id + 实际落盘补丁 + 落盘后版本号 */
export interface LlmFinishedAdopt {
  /** 发起会话的节点 id */
  nodeId: string
  /** 后端实际落盘的 config 补丁（output / outputHistory，按存在性提取） */
  patch: Record<string, unknown>
  /** 写入后的画布版本号（savedRev 对齐基准） */
  rev: number
}

/**
 * 由全局终态广播构造画布采纳数据（纯函数，AssetCanvas 全局 finished 监听用）。
 *
 * 规则：
 * - 项目不符 / 画布 scope 不符 → null（终态为全局广播，各画布自行过滤）；
 * - `prevRev`/`rev` 缺失或 `savedRev !== info.prevRev` → null（本端未跟上全部外部
 *   写入时数据整体过期，不做部分合并，交由既有版本冲突弹窗兜底）；
 * - 载荷无 `output` 且无 `outputHistory` → null（无落盘内容，如写入跳过/降级）。
 *
 * @param info 全局终态广播载荷
 * @param project 当前项目名
 * @param target 当前画布目标
 * @param savedRev 前端当前保存版本号（须等于落盘前版本号 prevRev 才采纳）
 * @returns 采纳数据（nodeId + patch + rev）；不满足采纳条件返回 null
 */
export function buildLlmFinishedAdopt(
  info: LlmFinishedInfo,
  project: string,
  target: CanvasTarget,
  savedRev: number,
): LlmFinishedAdopt | null {
  if (info.project !== project) return null
  if (!sameCanvasTarget(info.canvas, target)) return null
  if (typeof info.rev !== 'number' || typeof info.prevRev !== 'number') return null
  if (savedRev !== info.prevRev) return null
  const patch: Record<string, unknown> = {}
  if (info.output !== undefined) patch.output = info.output
  if (info.outputHistory) patch.outputHistory = info.outputHistory
  if (info.output === undefined && !info.outputHistory) return null
  return { nodeId: info.nodeId, patch, rev: info.rev }
}

/**
 * 创建 500ms 节流提交器（流式期间内存显示提交用，两路径共用）。
 * 首条立即提交，后续最多每 intervalMs 提交一次，最后一次由 flush 收口。
 *
 * @param commit 实际提交回调（接收当前值）
 * @param intervalMs 节流间隔（默认 500ms）
 * @returns 节流提交器（push / flush）
 */
export function createThrottledCommit(commit: (value: string) => void, intervalMs = 500): ThrottledCommit {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastAt = 0
  let pendingValue: string | null = null

  const fire = (value: string): void => {
    lastAt = Date.now()
    pendingValue = null
    commit(value)
  }

  return {
    push(value: string): void {
      const now = Date.now()
      if (now - lastAt >= intervalMs) {
        fire(value)
        return
      }
      pendingValue = value
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        if (pendingValue !== null) fire(pendingValue)
      }, intervalMs - (now - lastAt))
    },
    flush(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (pendingValue !== null) fire(pendingValue)
    },
  }
}
